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

function nvrRequest(urlPath, { method = 'GET', body } = {}) {
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
        ...(buf ? { 'Content-Type': 'application/json', 'Content-Length': buf.length } : {}),
      },
      agent: nvrAgent,
    }, resolve);
    req.on('error', reject);
    if (buf) req.write(buf);
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
      max_tokens: 1024,
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

router.get('/meal-deductions/:id', requireHR, async (req, res) => {
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
    let raw = '';
    for await (const chunk of nvrRes) raw += chunk;
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
    const nvrRes = await nvrRequest('/proxy/protect/api/video/export', {
      method: 'POST',
      body: { camera: data.cameraId, start: data.startMs, end: data.endMs, type: 'video' },
    });

    if (nvrRes.statusCode !== 200) {
      return res.status(nvrRes.statusCode || 404).send('Footage not available for this time range');
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="footage.mp4"');
    if (nvrRes.headers['content-length']) {
      res.setHeader('Content-Length', nvrRes.headers['content-length']);
      res.setHeader('Accept-Ranges', 'bytes');
    }
    nvrRes.pipe(res);
  } catch (err) {
    res.status(502).send('Cannot reach Protect NVR');
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
