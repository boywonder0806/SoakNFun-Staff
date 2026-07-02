import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import pool from '../db/index.js';
import { requireSysAdmin, requireHR } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Unifi Protect NVR proxy ───────────────────────────────────────────────────
// NVRs use self-signed TLS certs — skip verification for internal requests only
const nvrAgent = new https.Agent({ rejectUnauthorized: false });

// In-memory map of short-lived tokens for streaming footage to the browser
// (video tags can't send Authorization headers, so we gate on a time-limited UUID)
const footageTokens = new Map(); // token → { cameraId, startMs, endMs, expires }
setInterval(() => {
  const now = Date.now();
  for (const [t, d] of footageTokens) if (d.expires < now) footageTokens.delete(t);
}, 60_000);

export function nvrRequest(urlPath, { method = 'GET', body, headers = {} } = {}) {
  const nvrUrl = (process.env.PROTECT_NVR_URL || '').replace(/\/$/, '');
  const apiKey = process.env.PROTECT_API_KEY;
  if (!nvrUrl || !apiKey) return Promise.reject(new Error('Protect NVR not configured'));

  return new Promise((resolve, reject) => {
    // Concatenate directly — new URL(absolutePath, base) drops the base path
    const url  = new URL(nvrUrl + urlPath);
    const buf  = body ? Buffer.from(JSON.stringify(body)) : null;
    const req  = https.request({
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method,
      headers: {
        'X-API-KEY': apiKey,
        'Accept-Encoding': 'identity',
        ...(buf ? { 'Content-Type': 'application/json', 'Content-Length': buf.length } : {}),
        ...headers,
      },
      agent: nvrAgent,
    }, resolve);
    req.on('error', reject);
    if (buf) req.write(buf);
    req.end();
  });
}

// ── UniFi OS session auth (private Protect API) ──────────────────────────────
// Protect's public Integration API (X-API-KEY) has no historical video export
// on this NVR version (7.1.x) — export lives on the private API, which only
// accepts a local UniFi OS user session (TOKEN cookie), the same auth the
// Protect web UI uses. We log in once and cache the session cookie.
let protectSession = null; // { cookie, csrf, expires }

async function getProtectSession(forceRefresh = false) {
  const nvrUrl = (process.env.PROTECT_NVR_URL || '').replace(/\/$/, '');
  const user   = process.env.PROTECT_LOCAL_USERNAME;
  const pass   = process.env.PROTECT_LOCAL_PASSWORD;
  if (!nvrUrl || !user || !pass) {
    throw new Error('Video export requires PROTECT_LOCAL_USERNAME and PROTECT_LOCAL_PASSWORD (a local UniFi OS user) in the server .env');
  }
  if (!forceRefresh && protectSession && Date.now() < protectSession.expires) {
    return protectSession;
  }

  const body = Buffer.from(JSON.stringify({ username: user, password: pass, rememberMe: true }));
  const loginRes = await new Promise((resolve, reject) => {
    const url = new URL(nvrUrl + '/api/auth/login');
    const req = https.request({
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': body.length },
      agent:    nvrAgent,
    }, resolve);
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  loginRes.resume(); // drain the body — we only need the headers

  if (loginRes.statusCode !== 200) {
    protectSession = null;
    throw new Error(`UniFi OS login failed (status ${loginRes.statusCode}) — check PROTECT_LOCAL_USERNAME / PROTECT_LOCAL_PASSWORD`);
  }

  const setCookies  = loginRes.headers['set-cookie'] || [];
  const tokenCookie = setCookies.map(c => c.split(';')[0]).find(c => c.startsWith('TOKEN='));
  if (!tokenCookie) {
    protectSession = null;
    throw new Error('UniFi OS login succeeded but returned no session cookie');
  }

  protectSession = {
    cookie:  tokenCookie,
    csrf:    loginRes.headers['x-csrf-token'] || loginRes.headers['x-updated-csrf-token'] || null,
    // UniFi OS sessions last hours, but re-login every 30 min to stay safe
    expires: Date.now() + 30 * 60_000,
  };
  return protectSession;
}

// GET against the private Protect API using the cached session cookie
function nvrSessionRequest(urlPath, session) {
  const nvrUrl = (process.env.PROTECT_NVR_URL || '').replace(/\/$/, '');
  return new Promise((resolve, reject) => {
    const url = new URL(nvrUrl + urlPath);
    const req = https.request({
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method:   'GET',
      headers: {
        Cookie: session.cookie,
        'Accept-Encoding': 'identity',
        ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}),
      },
      agent: nvrAgent,
    }, resolve);
    // Exports of long clips can take a while to start, but if the NVR goes
    // quiet for 3 minutes the request is dead — bail instead of hanging
    req.setTimeout(180_000, () => req.destroy(new Error('NVR export timed out')));
    req.on('error', reject);
    req.end();
  });
}

// ── Idempotent migrations ─────────────────────────────────────────────────────
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_hr_access BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_hr_manager BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});

pool.query(`CREATE TABLE IF NOT EXISTS meal_deduction_uploads (
  id           SERIAL PRIMARY KEY,
  uploaded_by  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  filename     TEXT,
  period_label TEXT,
  row_count    INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  employee_col TEXT,
  amount_col   TEXT,
  date_col     TEXT,
  desc_col     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('meal_deduction_uploads migration:', e.message));

pool.query(`ALTER TABLE meal_deduction_uploads ADD COLUMN IF NOT EXISTS report_type TEXT`).catch(() => {});
pool.query(`ALTER TABLE meal_deduction_uploads ADD COLUMN IF NOT EXISTS payroll_total NUMERIC(10,2) NOT NULL DEFAULT 0`).catch(() => {});
pool.query(`ALTER TABLE meal_deduction_uploads ADD COLUMN IF NOT EXISTS ai_analysis JSONB`).catch(() => {});

pool.query(`CREATE TABLE IF NOT EXISTS meal_deductions (
  id               SERIAL PRIMARY KEY,
  upload_id        INTEGER NOT NULL REFERENCES meal_deduction_uploads(id) ON DELETE CASCADE,
  employee_name    TEXT NOT NULL,
  transaction_date DATE,
  item_description TEXT,
  amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('meal_deductions migration:', e.message));

pool.query(`ALTER TABLE meal_deductions ADD COLUMN IF NOT EXISTS payment_method TEXT`).catch(() => {});
pool.query(`ALTER TABLE meal_deductions ADD COLUMN IF NOT EXISTS order_id TEXT`).catch(() => {});
pool.query(`ALTER TABLE meal_deductions ADD COLUMN IF NOT EXISTS park TEXT`).catch(() => {});
pool.query(`ALTER TABLE meal_deductions ADD COLUMN IF NOT EXISTS home_park TEXT`).catch(() => {});
// Upgrade date-only column to full timestamp so we can store time-of-day
pool.query(`ALTER TABLE meal_deductions ALTER COLUMN transaction_date TYPE TIMESTAMP USING transaction_date::timestamp`).catch(() => {});

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  const cleaned = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const lines   = cleaned.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  function parseLine(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if ((ch === ',' || ch === '\t') && !inQuotes) {
        fields.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  }

  const rawHeaders = parseLine(lines[0]);
  const headers    = rawHeaders.map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseLine(lines[i]);
    const row  = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] ?? '').replace(/^"|"$/g, '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

function detectCol(headers, patterns) {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const p of patterns) {
    const idx = lower.indexOf(p);
    if (idx !== -1) return headers[idx];
  }
  for (const p of patterns) {
    const idx = lower.findIndex(h => h.includes(p));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

const EMPLOYEE_PATTERNS = ['employee name', 'employee', 'staff name', 'staff', 'name', 'worker', 'associate', 'team member'];
const AMOUNT_PATTERNS   = ['amount', 'total', 'price', 'deduction', 'cost', 'charge', 'meal total', 'meal cost', 'meal amount', 'subtotal'];
const DATE_PATTERNS     = ['date', 'transaction date', 'order date', 'purchase date', 'sale date', 'created at', 'created'];
const DESC_PATTERNS     = ['description', 'item', 'item name', 'product', 'menu item', 'notes', 'details'];

function parseAmount(str) {
  if (!str) return 0;
  let s = String(str).trim().replace(/[$€£¥\s,]/g, '');
  if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1);
  const val = parseFloat(s);
  return isNaN(val) ? 0 : val;
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Combines EventDate + EventTime from Rocket Rez CSV into a full ISO timestamp.
// EventDate is typically "M/D/YYYY", EventTime is "H:MM:SS AM/PM".
function parseDateTimeRR(dateStr, timeStr) {
  if (!dateStr?.trim()) return null;
  const combined = timeStr?.trim()
    ? `${dateStr.trim()} ${timeStr.trim()}`
    : dateStr.trim();
  const d = new Date(combined);
  if (!isNaN(d.getTime())) return d.toISOString();
  // Fall back to date-only if combined parse fails
  const fallback = new Date(dateStr.trim());
  return isNaN(fallback.getTime()) ? null : fallback.toISOString().slice(0, 10);
}

// ── Rocket Rez report parsing ─────────────────────────────────────────────────

// Detected by presence of these specific column names
function isRocketRezFormat(headers) {
  return headers.includes('Grouping Header') &&
         headers.includes('PaymentHistory') &&
         headers.includes('Rate/ProductName');
}

// PaymentHistory format: "MM/DD/YYYY  $AMOUNT        BB - METHOD"  or  "GI - METHOD"
function parsePaymentMethod(paymentHistory) {
  if (!paymentHistory?.trim()) return 'comp';
  const lower = paymentHistory.toLowerCase();
  if (lower.includes('payroll deduction')) return 'payroll_deduction';
  if (lower.includes('stripe'))            return 'stripe';
  if (lower.includes('cash'))              return 'cash';
  if (lower.includes('credit'))            return 'credit';
  return 'other';
}

// Extract park code from PaymentHistory: "BB" = Blue Bayou, "GI" = Gulf Islands
function parsePark(paymentHistory) {
  if (!paymentHistory?.trim()) return null;
  const match = paymentHistory.match(/\b(BB|GI)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function parseRocketRezReport(rows) {
  const deductions = [];
  const skippedTokens = [];

  for (const row of rows) {
    const rawName = row['Grouping Header']?.trim();
    if (!rawName || !row['EventDate']?.trim()) continue;

    // Capture home park from name prefix before stripping it
    const prefixMatch  = rawName.match(/^\(([^)]+)\)/i);
    const rawPrefix    = prefixMatch?.[1]?.toUpperCase();
    const homePark     = (rawPrefix === 'BB' || rawPrefix === 'GI') ? rawPrefix : null;

    const employeeName = rawName.replace(/^\([^)]+\)\s*/i, '').trim();
    if (!employeeName) continue;

    // Token redemptions are pre-paid benefits — not payroll charges, skip them
    if (row['PaymentHistory']?.toLowerCase().includes('token')) continue;

    const amount      = parseAmount(row['textBox18']);
    const date        = parseDateTimeRR(row['EventDate'], row['EventTime']);
    const description = (row['Rate/ProductName'] || '')
      .replace(/\s*\([^)]*employee[^)]*\)\s*/gi, '').trim() || null;
    const paymentMethod = parsePaymentMethod(row['PaymentHistory']);
    const park          = parsePark(row['PaymentHistory']);
    const orderId = row['textBox6']?.trim() || null;

    deductions.push({ employeeName, amount, date, description, paymentMethod, orderId, park, homePark });
  }

  return deductions;
}

// ── Deterministic cross-park detection ───────────────────────────────────────
// Flags any transaction where an employee's home park (from name prefix) differs
// from the park where the transaction was actually processed (from PaymentHistory).
function detectCrossParkAnomalies(deductions) {
  const byEmployee = {};
  for (const d of deductions) {
    if (!d.homePark || !d.park || d.homePark === d.park) continue;
    if (!byEmployee[d.employeeName]) {
      byEmployee[d.employeeName] = { homePark: d.homePark, crossParks: new Set(), count: 0 };
    }
    byEmployee[d.employeeName].crossParks.add(d.park);
    byEmployee[d.employeeName].count++;
  }

  const PARK_NAME = { BB: 'Blue Bayou', GI: 'Gulf Islands' };
  return Object.entries(byEmployee).map(([name, data]) => ({
    type: 'cross_park',
    employee: name,
    description: `${name} is a ${PARK_NAME[data.homePark] || data.homePark} employee but ${data.count} transaction(s) were processed at ${[...data.crossParks].map(p => PARK_NAME[p] || p).join(', ')}. Verify this was intentional and ensure it is billed to the correct park's payroll.`,
    severity: 'high',
  }));
}

// ── AI anomaly analysis ───────────────────────────────────────────────────────

async function analyzeWithAI(deductions) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || deductions.length === 0) return null;

  // Build per-employee totals and item price variation map
  const byEmployee = {};
  const itemPriceMap = {};

  for (const d of deductions) {
    if (!byEmployee[d.employeeName]) {
      byEmployee[d.employeeName] = {
        payrollTotal: 0, stripeTotal: 0, cashTotal: 0, compTotal: 0, otherTotal: 0,
        parks: new Set(), homePark: null, items: [],
      };
    }
    const g = byEmployee[d.employeeName];
    if      (d.paymentMethod === 'payroll_deduction') g.payrollTotal += d.amount;
    else if (d.paymentMethod === 'stripe')            g.stripeTotal  += d.amount;
    else if (d.paymentMethod === 'cash')              g.cashTotal    += d.amount;
    else if (d.paymentMethod === 'comp')              g.compTotal    += d.amount;
    else                                              g.otherTotal   += d.amount;
    if (d.park) g.parks.add(d.park);
    if (d.homePark && !g.homePark) g.homePark = d.homePark;
    g.items.push({ item: d.description, amount: d.amount, method: d.paymentMethod, park: d.park });

    if (d.description && d.amount > 0) {
      if (!itemPriceMap[d.description]) itemPriceMap[d.description] = new Set();
      itemPriceMap[d.description].add(+d.amount.toFixed(2));
    }
  }

  const employeeSummaries = Object.entries(byEmployee).map(([name, g]) => {
    const transParks = [...g.parks];
    const crossParkItems = g.homePark
      ? g.items.filter(t => t.park && t.park !== g.homePark)
      : [];
    return {
      name,
      homePark: g.homePark,
      transactionParks: transParks,
      crossParkTransactionCount: crossParkItems.length,
      payrollDeduction: +g.payrollTotal.toFixed(2),
      paidViaCreditCard: +g.stripeTotal.toFixed(2),
      paidViaCash: +g.cashTotal.toFixed(2),
      comped: +g.compTotal.toFixed(2),
      itemCount: g.items.length,
      items: g.items,
    };
  });

  const priceVariations = Object.entries(itemPriceMap)
    .filter(([, set]) => set.size > 1)
    .map(([item, set]) => ({ item, prices: [...set].sort((a, b) => a - b) }));

  const prompt = `You are an HR analyst reviewing employee meal purchase records from a waterpark. Analyze for anomalies.

EMPLOYEE SUMMARIES (${employeeSummaries.length} employees, ${deductions.length} transactions):
${JSON.stringify(employeeSummaries, null, 2)}

MENU ITEM PRICE VARIATIONS (same item seen at different prices):
${priceVariations.length ? JSON.stringify(priceVariations, null, 2) : 'None detected'}

Context:
- This is a multi-park waterpark company with two locations: Blue Bayou Waterpark (BB) and Gulf Islands Waterpark (GI)
- Park is determined by the payment method prefix: "BB -" = Blue Bayou, "GI -" = Gulf Islands
- Some employee names have a "(BB)" prefix in the system but the payment history park code is the authoritative source
- Each park runs its own payroll, so BB transactions must be separated from GI transactions

Payment method key:
- payroll_deduction = will be deducted from paycheck at their respective park
- stripe/credit card = employee already paid by credit card (do NOT also deduct from payroll)
- cash = employee already paid with cash (do NOT also deduct from payroll)
- comp = $0 charge / free item (needs manager authorization)

Identify and flag:
1. Employees with payroll deductions significantly higher than the median (over-purchasing)
2. Price inconsistencies for the same menu item across employees
3. $0 comp items that need manager justification (who authorized a free item?)
4. Employees who paid via credit card or cash (do NOT deduct from payroll — they already paid)
5. Employees whose transactions span both BB and GI parks (may indicate data mixup or inter-park work)
6. Any other patterns worth HR attention

Report at most 12 anomalies — the most important ones — and keep each description under 30 words.

Reply ONLY with valid JSON, no markdown, no explanation outside the JSON:
{
  "summary": "1-2 sentence overview of key findings including park breakdown",
  "anomalies": [
    {
      "type": "high_total|price_inconsistency|comp_item|already_paid|cross_park|other",
      "employee": "Employee Name or null for report-level",
      "description": "Clear, concise description of the issue",
      "severity": "low|medium|high"
    }
  ],
  "payrollDeductionNote": "Note covering total payroll split by park (BB vs GI) and any already-paid transactions"
}`;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      // Busy days produce long anomaly lists — 1024 truncated mid-JSON
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch (err) {
    console.error('AI analysis error:', err.message);
    return null;
  }
}

// ── Access management ─────────────────────────────────────────────────────────
router.patch('/access/:id', requireSysAdmin, async (req, res) => {
  const { access } = req.body;
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE employees
       SET has_hr_access = $1
       WHERE id = $2
       RETURNING id,
                 has_hr_access    AS "hasHrAccess",
                 is_hr_manager    AS "isHrManager"`,
      [access === true, empId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update HR access' });
  }
});

// ── Meal Deductions ───────────────────────────────────────────────────────────

router.get('/meal-deductions', requireHR, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mdu.id, mdu.filename, mdu.period_label AS "periodLabel",
              mdu.row_count AS "rowCount",
              mdu.total_amount AS "totalAmount",
              COALESCE(mdu.payroll_total, mdu.total_amount) AS "payrollTotal",
              mdu.report_type AS "reportType",
              mdu.employee_col AS "employeeCol",
              mdu.amount_col AS "amountCol",
              mdu.created_at AS "createdAt",
              e.name AS "uploadedByName"
       FROM meal_deduction_uploads mdu
       LEFT JOIN employees e ON mdu.uploaded_by = e.id
       ORDER BY mdu.created_at DESC`
    );
    res.json({ uploads: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// :id constrained to digits so it can't swallow /meal-deductions/live
router.get('/meal-deductions/:id(\\d+)', requireHR, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { rows: [upload] } = await pool.query(
      `SELECT mdu.id, mdu.filename, mdu.period_label AS "periodLabel",
              mdu.row_count AS "rowCount",
              mdu.total_amount AS "totalAmount",
              COALESCE(mdu.payroll_total, mdu.total_amount) AS "payrollTotal",
              mdu.report_type AS "reportType",
              mdu.ai_analysis AS "aiAnalysis",
              mdu.created_at AS "createdAt",
              e.name AS "uploadedByName"
       FROM meal_deduction_uploads mdu
       LEFT JOIN employees e ON mdu.uploaded_by = e.id
       WHERE mdu.id = $1`,
      [id]
    );
    if (!upload) return res.status(404).json({ error: 'Upload not found' });

    const { rows: deductions } = await pool.query(
      `SELECT id, employee_name AS "employeeName",
              transaction_date AS "date",
              item_description AS "description",
              amount,
              COALESCE(payment_method, 'payroll_deduction') AS "paymentMethod",
              order_id AS "orderId",
              park,
              home_park AS "homePark"
       FROM meal_deductions
       WHERE upload_id = $1
       ORDER BY employee_name, transaction_date NULLS LAST, id`,
      [id]
    );

    // Group by employee
    const grouped = {};
    for (const d of deductions) {
      if (!grouped[d.employeeName]) {
        grouped[d.employeeName] = {
          employeeName: d.employeeName,
          transactionCount: 0,
          totalAmount: 0,
          payrollTotal: 0,
          parks: new Set(),
          homePark: null,
          crossParkCount: 0,
          transactions: [],
        };
      }
      const g = grouped[d.employeeName];
      g.transactionCount++;
      g.totalAmount += parseFloat(d.amount);
      if (d.paymentMethod === 'payroll_deduction') g.payrollTotal += parseFloat(d.amount);
      if (d.park) g.parks.add(d.park);
      if (d.homePark && !g.homePark) g.homePark = d.homePark;
      const isCrossPark = !!(d.homePark && d.park && d.homePark !== d.park);
      if (isCrossPark) g.crossParkCount++;
      g.transactions.push({
        id: d.id,
        date: d.date,
        description: d.description,
        amount: d.amount,
        paymentMethod: d.paymentMethod,
        orderId: d.orderId,
        park: d.park,
        homePark: d.homePark,
        crossPark: isCrossPark,
      });
    }

    const breakdown = Object.values(grouped)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      .map(g => {
        const parksArr = [...g.parks];
        return {
          ...g,
          parks: parksArr,
          park: parksArr.length === 1 ? parksArr[0] : (parksArr.length > 1 ? 'MULTI' : null),
          totalAmount:  g.totalAmount.toFixed(2),
          payrollTotal: g.payrollTotal.toFixed(2),
        };
      });

    res.json({ upload, breakdown });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch breakdown' });
  }
});

router.post('/meal-deductions/upload', requireHR, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const text = req.file.buffer.toString('utf-8');
  const parsed = parseCSV(text);
  if (!parsed || parsed.rows.length === 0) {
    return res.status(400).json({ error: 'Could not parse CSV — file appears empty or invalid.' });
  }

  const { headers, rows } = parsed;
  const periodLabel = req.body.periodLabel?.trim() || null;
  const filename    = req.file.originalname;

  let deductions = [];
  let reportType = 'generic';

  // ── Rocket Rez path ─────────────────────────────────────────────────────────
  if (isRocketRezFormat(headers)) {
    reportType = 'rocket_rez';
    deductions = parseRocketRezReport(rows);
    if (deductions.length === 0) {
      return res.status(400).json({ error: 'No valid transactions found in Rocket Rez report.' });
    }
  }

  // ── Generic CSV path ────────────────────────────────────────────────────────
  else {
    const employeeCol = req.body.employeeCol || detectCol(headers, EMPLOYEE_PATTERNS);
    const amountCol   = req.body.amountCol   || detectCol(headers, AMOUNT_PATTERNS);
    const dateCol     = req.body.dateCol     || detectCol(headers, DATE_PATTERNS);
    const descCol     = req.body.descCol     || detectCol(headers, DESC_PATTERNS);

    if (!employeeCol || !amountCol) {
      return res.json({
        needsMapping: true,
        headers,
        detected: {
          employeeCol: employeeCol || null,
          amountCol:   amountCol   || null,
          dateCol:     dateCol     || null,
          descCol:     descCol     || null,
        },
      });
    }

    for (const row of rows) {
      const empName = row[employeeCol]?.trim();
      if (!empName) continue;
      const amount = parseAmount(row[amountCol]);
      if (amount === 0 && !row[amountCol]?.trim()) continue;
      const date = dateCol ? parseDate(row[dateCol]) : null;
      const desc = descCol ? row[descCol]?.trim() || null : null;
      deductions.push({ employeeName: empName, amount, date, description: desc, paymentMethod: 'payroll_deduction', orderId: null });
    }

    if (deductions.length === 0) {
      return res.status(400).json({ error: 'No valid deduction rows found. Check that the Employee and Amount columns are correct.' });
    }
  }

  const totalAmount   = deductions.reduce((s, d) => s + d.amount, 0);
  const payrollTotal  = deductions.reduce((s, d) => s + (d.paymentMethod === 'payroll_deduction' ? d.amount : 0), 0);

  // ── AI analysis (best-effort, non-blocking) ──────────────────────────────────
  let aiAnalysis = null;
  try {
    aiAnalysis = await analyzeWithAI(deductions);
  } catch (err) {
    console.error('AI analysis skipped:', err.message);
  }

  // Always inject server-detected cross-park anomalies — deterministic, not AI-dependent
  const crossParkAnomalies = detectCrossParkAnomalies(deductions);
  if (crossParkAnomalies.length > 0) {
    if (aiAnalysis) {
      // Remove any AI-generated cross_park entries for the same employees to avoid dupes
      const cpNames = new Set(crossParkAnomalies.map(a => a.employee));
      aiAnalysis.anomalies = (aiAnalysis.anomalies || []).filter(
        a => !(a.type === 'cross_park' && cpNames.has(a.employee))
      );
      aiAnalysis.anomalies.unshift(...crossParkAnomalies);
    } else {
      aiAnalysis = {
        summary: `${crossParkAnomalies.length} cross-park transaction(s) detected that require review.`,
        anomalies: crossParkAnomalies,
        payrollDeductionNote: 'Cross-park transactions must be reviewed before processing payroll to ensure charges are billed to the correct park.',
      };
    }
  }

  // ── Persist ──────────────────────────────────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [uploadRow] } = await client.query(
      `INSERT INTO meal_deduction_uploads
         (uploaded_by, filename, period_label, row_count, total_amount, payroll_total,
          report_type, ai_analysis,
          employee_col, amount_col, date_col, desc_col)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, filename,
                 period_label AS "periodLabel",
                 row_count AS "rowCount",
                 total_amount AS "totalAmount",
                 COALESCE(payroll_total, total_amount) AS "payrollTotal",
                 report_type AS "reportType",
                 ai_analysis AS "aiAnalysis",
                 created_at AS "createdAt"`,
      [
        req.user.id, filename, periodLabel, deductions.length,
        totalAmount.toFixed(2), payrollTotal.toFixed(2),
        reportType, aiAnalysis ? JSON.stringify(aiAnalysis) : null,
        reportType === 'generic' ? (req.body.employeeCol || null) : null,
        reportType === 'generic' ? (req.body.amountCol   || null) : null,
        reportType === 'generic' ? (req.body.dateCol     || null) : null,
        reportType === 'generic' ? (req.body.descCol     || null) : null,
      ]
    );

    for (const d of deductions) {
      await client.query(
        `INSERT INTO meal_deductions
           (upload_id, employee_name, transaction_date, item_description, amount, payment_method, order_id, park, home_park)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uploadRow.id, d.employeeName, d.date, d.description, d.amount,
         d.paymentMethod || 'payroll_deduction', d.orderId || null, d.park || null, d.homePark || null]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ upload: uploadRow });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Failed to save deduction data.' });
  } finally {
    client.release();
  }
});

// ── Unifi Protect endpoints ───────────────────────────────────────────────────

// List all cameras from the NVR, plus which ones are configured per park
router.get('/protect/cameras', requireHR, async (req, res) => {
  const configured = !!(process.env.PROTECT_NVR_URL && process.env.PROTECT_API_KEY);
  if (!configured) return res.json({ cameras: [], configured: false });

  try {
    const nvrRes = await nvrRequest('/proxy/protect/integration/v1/cameras');
    if (nvrRes.statusCode !== 200) {
      nvrRes.resume();
      return res.status(502).json({ error: `NVR returned status ${nvrRes.statusCode}`, configured });
    }
    const raw = await new Promise((resolve, reject) => {
      const chunks = [];
      nvrRes.on('data', chunk => chunks.push(chunk));
      nvrRes.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      nvrRes.on('error', reject);
    });
    const all = JSON.parse(raw);
    res.json({
      configured: true,
      cameras: (Array.isArray(all) ? all : [])
        .map(c => ({ id: c.id, name: c.name || c.id, state: c.state, type: c.type })),
      configuredCameras: {
        BB: (process.env.PROTECT_BB_CAMERA_IDS || '').split(',').filter(Boolean),
        GI: (process.env.PROTECT_GI_CAMERA_IDS || '').split(',').filter(Boolean),
      },
    });
  } catch (err) {
    console.error('Protect cameras error:', err.message);
    res.status(502).json({ error: 'Cannot reach Protect NVR: ' + err.message, configured });
  }
});

// Issue a 5-minute token so the browser can stream footage without an auth header
router.post('/protect/footage-token', requireHR, (req, res) => {
  if (!process.env.PROTECT_NVR_URL || !process.env.PROTECT_API_KEY) {
    return res.status(503).json({ error: 'Protect NVR not configured on this server' });
  }
  if (!process.env.PROTECT_LOCAL_USERNAME || !process.env.PROTECT_LOCAL_PASSWORD) {
    return res.status(503).json({ error: 'Video export not configured — add PROTECT_LOCAL_USERNAME and PROTECT_LOCAL_PASSWORD (a local UniFi OS user with Protect access) to the server .env' });
  }
  const { cameraId, startMs, endMs } = req.body;
  if (!cameraId || !startMs || !endMs) {
    return res.status(400).json({ error: 'cameraId, startMs, and endMs are required' });
  }
  const start = parseInt(startMs);
  const end   = parseInt(endMs);
  if (isNaN(start) || isNaN(end) || end <= start) {
    return res.status(400).json({ error: 'Invalid time range' });
  }
  if (end - start > 60 * 60 * 1000) {
    return res.status(400).json({ error: 'Clip too long — max 1 hour' });
  }
  const token = randomUUID();
  footageTokens.set(token, { cameraId, startMs: start, endMs: end, expires: Date.now() + 5 * 60_000 });
  res.json({ token, expiresIn: 300 });
});

// Stream an MP4 clip — gated by the single-use token above, no auth header needed
router.get('/protect/footage-stream', async (req, res) => {
  const data = footageTokens.get(req.query.token);
  if (!data || data.expires < Date.now()) {
    footageTokens.delete(req.query.token);
    return res.status(401).send('Footage token expired or invalid');
  }

  try {
    // The private export API is GET with query params (the same call the
    // Protect web UI makes), authenticated by the UniFi OS session cookie.
    // channel=1 exports the Medium recording (720p/1280px) — ~40x smaller and
    // near-instant vs the 4K High stream; plenty for identifying staff.
    const qs = `camera=${encodeURIComponent(data.cameraId)}&start=${data.startMs}&end=${data.endMs}&channel=1&filename=footage.mp4`;

    let session = await getProtectSession();
    let nvrRes  = await nvrSessionRequest(`/proxy/protect/api/video/export?${qs}`, session);

    // Session may have been revoked server-side — re-login once and retry
    if (nvrRes.statusCode === 401 || nvrRes.statusCode === 403) {
      nvrRes.resume();
      session = await getProtectSession(true);
      nvrRes  = await nvrSessionRequest(`/proxy/protect/api/video/export?${qs}`, session);
    }

    if (nvrRes.statusCode !== 200) {
      nvrRes.resume();
      console.error(`Protect export failed: status ${nvrRes.statusCode} for camera ${data.cameraId}`);
      return res.status(502).send(
        nvrRes.statusCode === 404
          ? 'No recorded footage exists for this camera in that time range'
          : `NVR export failed (status ${nvrRes.statusCode})`
      );
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="footage.mp4"');
    if (nvrRes.headers['content-length']) {
      res.setHeader('Content-Length', nvrRes.headers['content-length']);
      res.setHeader('Accept-Ranges', 'bytes');
    }
    nvrRes.pipe(res);
    // If the browser closes the player mid-stream, stop pulling from the NVR
    res.on('close', () => nvrRes.destroy());
  } catch (err) {
    console.error('Protect footage-stream error:', err.message);
    res.status(502).send(err.message.includes('PROTECT_LOCAL') ? err.message : 'Cannot reach Protect NVR: ' + err.message);
  }
});

// ── Live Meal Deductions (RocketRez) ─────────────────────────────────────────
// Source of truth is the RocketRez orders API. Any order with a
// contactGroupName is a crew order: "(BB) Name" = Blue Bayou crew,
// no prefix = Gulf Islands crew. Only Active orders count — Cancelled,
// Void, Estimate, and Return Processed orders are excluded.
let rrCachedToken = null;
let rrTokenExpiry = 0;

async function getRRToken() {
  if (rrCachedToken && Date.now() < rrTokenExpiry - 60_000) return rrCachedToken;
  const res = await fetch(`${process.env.ROCKETREZ_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.ROCKETREZ_CLIENT_ID,
      client_secret: process.env.ROCKETREZ_CLIENT_SECRET,
      scope: 'read_orders',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`RocketRez auth failed: ${res.status}`);
  const data = await res.json();
  rrCachedToken = data.data.access_token;
  rrTokenExpiry = new Date(data.data.expiry).getTime();
  return rrCachedToken;
}

// Crew-order cache — today's data refreshes every 5 min, past days hourly
const crewOrderCache = new Map(); // "start:end" → { orders, fetchedAt }
const CREW_TTL_TODAY = 5 * 60 * 1000;
const CREW_TTL_PAST  = 60 * 60 * 1000;

async function fetchCrewOrders(startDate, endDate) {
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const ttl    = endDate >= today ? CREW_TTL_TODAY : CREW_TTL_PAST;
  const key    = `${startDate}:${endDate}`;
  const cached = crewOrderCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached;

  const token = await getRRToken();
  const base  = (process.env.ROCKETREZ_BASE_URL || '').replace(/\/$/, '');

  const orders = [];
  let pageIndex = 0;
  while (true) {
    const url = `${base}/v1/orders?startDate=${startDate}&endDate=${endDate}&pageSize=250&pageIndex=${pageIndex}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`RocketRez orders API: ${r.status}`);
    const data  = await r.json();
    const batch = Array.isArray(data.data) ? data.data : [];
    orders.push(...batch.filter(o => o.contactGroupName?.trim() && o.status === 'Active'));
    if (batch.length < 250) break;
    pageIndex++;
  }

  const entry = { orders, fetchedAt: Date.now() };
  crewOrderCache.set(key, entry);
  for (const [k, v] of crewOrderCache) {
    if (Date.now() - v.fetchedAt > CREW_TTL_PAST) crewOrderCache.delete(k);
  }
  return entry;
}

// A line item's revenue lives in rateTypes[].subTotal — li.subTotal doesn't
// exist on RocketRez's response shape (can carry multiple rateTypes).
function rrLineItemRevenue(li) {
  return (li.rateTypes || []).reduce((sum, rt) => sum + (rt.subTotal || 0), 0);
}

// Classify an order's payments into buckets and pick the dominant method
// using the legacy paymentMethod vocabulary the UI already understands.
function classifyCrewPayments(paymentMethods, orderTotal) {
  const buckets = { payroll: 0, card: 0, cash: 0, token: 0, comp: 0 };
  for (const pm of (paymentMethods || [])) {
    const m   = (pm.paymentMethod || '').toLowerCase();
    const amt = pm.paymentAmount || 0;
    if      (m.includes('payroll'))                                            buckets.payroll += amt;
    else if (m.includes('token'))                                              buckets.token   += amt;
    else if (m.includes('cash') && !m.includes('card'))                        buckets.cash    += amt;
    else if (m.includes('stripe') || m.includes('card') || m.includes('visa') ||
             m.includes('mastercard') || m.includes('amex') || m.includes('discover') ||
             m.includes('nayax') || m.includes('paypal') || m.includes('pre-paid')) buckets.card += amt;
    else                                                                       buckets.comp    += amt;
  }
  if (!paymentMethods?.length) buckets.comp += orderTotal || 0;

  const LABEL = { payroll: 'payroll_deduction', card: 'stripe', cash: 'cash', token: 'token', comp: 'comp' };
  const dominant = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
  return { ...buckets, primary: LABEL[dominant[1] > 0 ? dominant[0] : 'comp'] };
}

// Which park a transaction happened at, from the sales office prefix
function orderPark(order) {
  const office = (order.salesOfficeName || '').trim().toUpperCase();
  if (office.startsWith('BB')) return 'BB';
  if (office.startsWith('GI')) return 'GI';
  return null;
}

// Build the per-employee breakdown in the exact shape the client renders
function buildLiveBreakdown(orders) {
  const grouped = {};
  const meta = { totalOrders: 0, totalAmount: 0, payrollTotal: 0, cardCashTotal: 0, tokenTotal: 0, compTotal: 0, parkPayroll: {} };

  for (const order of orders) {
    const rawName  = order.contactGroupName.trim();
    const homePark = /^\(BB\)/i.test(rawName) ? 'BB' : 'GI';
    const name     = rawName.replace(/^\(BB\)\s*/i, '').trim();
    if (!name) continue;

    const pay   = classifyCrewPayments(order.paymentMethods, order.total);
    const park  = orderPark(order) || homePark;
    const items = (order.lineItems || [])
      .map(li => ({
        name: (li.name || '')
          .replace(/\s*\((BB|GI)\s*Employee\)/gi, '')
          .replace(/\s*-\s*Token\b/gi, '')
          .trim(),
        amount: +rrLineItemRevenue(li).toFixed(2),
      }))
      .filter(li => li.name);

    if (!grouped[name]) {
      grouped[name] = {
        employeeName: name, transactionCount: 0, totalAmount: 0, payrollTotal: 0,
        parks: new Set(), homePark, crossParkCount: 0, transactions: [],
      };
    }
    const g = grouped[name];
    const crossPark = park !== homePark;

    g.transactionCount++;
    g.totalAmount   += order.total || 0;
    g.payrollTotal  += pay.payroll;
    g.parks.add(park);
    if (crossPark) g.crossParkCount++;
    g.transactions.push({
      date:          order.createdDate,
      orderId:       order.id,
      description:   items.map(i => i.name).join(', ') || null,
      items,
      amount:        +(order.total || 0).toFixed(2),
      paymentMethod: pay.primary,
      payroll:       +pay.payroll.toFixed(2),
      cardCash:      +(pay.card + pay.cash).toFixed(2),
      token:         +pay.token.toFixed(2),
      park,
      homePark,
      crossPark,
      cashier:       [order.salesPersonFirstName, order.salesPersonLastName].filter(Boolean).join(' ')
                       .replace(/^BB\s*-?\s*/i, '').trim() || null,
    });

    meta.totalOrders++;
    meta.totalAmount   += order.total || 0;
    meta.payrollTotal  += pay.payroll;
    meta.cardCashTotal += pay.card + pay.cash;
    meta.tokenTotal    += pay.token;
    meta.compTotal     += pay.comp;
    if (pay.payroll > 0) {
      meta.parkPayroll[park] = +((meta.parkPayroll[park] || 0) + pay.payroll).toFixed(2);
    }
  }

  const breakdown = Object.values(grouped)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
    .map(g => {
      const parksArr = [...g.parks].sort();
      g.transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
      return {
        ...g,
        parks: parksArr,
        park:  parksArr.length === 1 ? parksArr[0] : (parksArr.length > 1 ? 'MULTI' : null),
        totalAmount:  g.totalAmount.toFixed(2),
        payrollTotal: g.payrollTotal.toFixed(2),
      };
    });

  for (const k of ['totalAmount', 'payrollTotal', 'cardCashTotal', 'tokenTotal', 'compTotal']) {
    meta[k] = +meta[k].toFixed(2);
  }
  return { meta, breakdown };
}

router.get('/meal-deductions/live', requireHR, async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate || endDate < startDate) {
    return res.status(400).json({ error: 'Valid startDate and endDate are required (YYYY-MM-DD)' });
  }
  if ((new Date(endDate) - new Date(startDate)) / 86_400_000 > 92) {
    return res.status(400).json({ error: 'Date range too large — max 92 days' });
  }
  if (!process.env.ROCKETREZ_CLIENT_ID || !process.env.ROCKETREZ_CLIENT_SECRET) {
    return res.status(503).json({ error: 'RocketRez credentials not configured on this server' });
  }

  try {
    const { orders, fetchedAt } = await fetchCrewOrders(startDate, endDate);
    const { meta, breakdown }   = buildLiveBreakdown(orders);
    res.json({ startDate, endDate, fetchedAt: new Date(fetchedAt).toISOString(), meta, breakdown });
  } catch (err) {
    console.error('Live meal deductions error:', err.message);
    res.status(502).json({ error: 'RocketRez sync failed: ' + err.message });
  }
});

// On-demand AI anomaly analysis over a live date range
router.post('/meal-deductions/live/analyze', requireHR, async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate || endDate < startDate) {
    return res.status(400).json({ error: 'Valid startDate and endDate are required' });
  }
  if ((new Date(endDate) - new Date(startDate)) / 86_400_000 > 31) {
    return res.status(400).json({ error: 'AI analysis supports ranges up to 31 days' });
  }

  try {
    const { orders }    = await fetchCrewOrders(startDate, endDate);
    const { breakdown } = buildLiveBreakdown(orders);

    // Flatten to the row shape analyzeWithAI expects; cap prompt size
    const rows = breakdown.flatMap(b => b.transactions.map(t => ({
      employeeName:  b.employeeName,
      paymentMethod: t.paymentMethod,
      amount:        t.amount,
      description:   (t.description || '').slice(0, 100),
      park:          t.park,
      homePark:      t.homePark,
    }))).slice(0, 800);

    if (!rows.length) return res.json({ aiAnalysis: null });

    const [ai, crossPark] = [await analyzeWithAI(rows), detectCrossParkAnomalies(rows)];
    const aiAnalysis = ai || { summary: null, anomalies: [], payrollDeductionNote: null };

    // Merge deterministic cross-park flags, skipping employees the AI already flagged
    const flagged = new Set((aiAnalysis.anomalies || []).filter(a => a.type === 'cross_park').map(a => a.employee));
    aiAnalysis.anomalies = [
      ...(aiAnalysis.anomalies || []),
      ...crossPark.filter(a => !flagged.has(a.employee)),
    ];

    res.json({ aiAnalysis });
  } catch (err) {
    console.error('Live AI analysis error:', err.message);
    res.status(502).json({ error: 'Analysis failed: ' + err.message });
  }
});

router.delete('/meal-deductions/:id', requireHR, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM meal_deduction_uploads WHERE id = $1',
      [parseInt(req.params.id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Upload not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete upload' });
  }
});

export default router;
