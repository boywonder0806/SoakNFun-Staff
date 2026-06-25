import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../db/index.js';
import { requireSysAdmin, requireHR } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
  for (const row of rows) {
    const rawName = row['Grouping Header']?.trim();
    // Only process rows that have both an employee name and a transaction date
    if (!rawName || !row['EventDate']?.trim()) continue;
    // Strip any "(XX) " prefix like "(BB) "
    const employeeName = rawName.replace(/^\([^)]+\)\s*/i, '').trim();
    if (!employeeName) continue;

    const amount      = parseAmount(row['textBox18']);
    const date        = parseDate(row['EventDate']);
    // Strip "(BB Employee)" / "(Employee)" suffixes from item names
    const description = (row['Rate/ProductName'] || '')
      .replace(/\s*\([^)]*employee[^)]*\)\s*/gi, '').trim() || null;
    const paymentMethod = parsePaymentMethod(row['PaymentHistory']);
    const park          = parsePark(row['PaymentHistory']);
    // The actual order ID lives in textBox6, not the OrderId column
    const orderId = row['textBox6']?.trim() || null;

    deductions.push({ employeeName, amount, date, description, paymentMethod, orderId, park });
  }
  return deductions;
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
        parks: new Set(), namePrefix: null, items: [],
      };
    }
    const g = byEmployee[d.employeeName];
    if      (d.paymentMethod === 'payroll_deduction') g.payrollTotal += d.amount;
    else if (d.paymentMethod === 'stripe')            g.stripeTotal  += d.amount;
    else if (d.paymentMethod === 'cash')              g.cashTotal    += d.amount;
    else if (d.paymentMethod === 'comp')              g.compTotal    += d.amount;
    else                                              g.otherTotal   += d.amount;
    if (d.park) g.parks.add(d.park);
    g.items.push({ item: d.description, amount: d.amount, method: d.paymentMethod, park: d.park });

    if (d.description && d.amount > 0) {
      if (!itemPriceMap[d.description]) itemPriceMap[d.description] = new Set();
      itemPriceMap[d.description].add(+d.amount.toFixed(2));
    }
  }

  const employeeSummaries = Object.entries(byEmployee).map(([name, g]) => ({
    name,
    parks: [...g.parks],
    payrollDeduction: +g.payrollTotal.toFixed(2),
    paidViaCreditCard: +g.stripeTotal.toFixed(2),
    paidViaCash: +g.cashTotal.toFixed(2),
    comped: +g.compTotal.toFixed(2),
    itemCount: g.items.length,
    items: g.items,
  }));

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
              park
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
          transactions: [],
        };
      }
      const g = grouped[d.employeeName];
      g.transactionCount++;
      g.totalAmount += parseFloat(d.amount);
      if (d.paymentMethod === 'payroll_deduction') g.payrollTotal += parseFloat(d.amount);
      if (d.park) g.parks.add(d.park);
      g.transactions.push({
        id: d.id,
        date: d.date,
        description: d.description,
        amount: d.amount,
        paymentMethod: d.paymentMethod,
        orderId: d.orderId,
        park: d.park,
      });
    }

    const breakdown = Object.values(grouped)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      .map(g => {
        const parksArr = [...g.parks];
        return {
          ...g,
          parks: parksArr,
          // primary park: single park if consistent, 'MULTI' if cross-park, null if unknown
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
           (upload_id, employee_name, transaction_date, item_description, amount, payment_method, order_id, park)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uploadRow.id, d.employeeName, d.date, d.description, d.amount,
         d.paymentMethod || 'payroll_deduction', d.orderId || null, d.park || null]
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
