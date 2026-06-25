import { Router } from 'express';
import multer from 'multer';
import pool from '../db/index.js';
import { requireSysAdmin, requireHR, requireHRManager } from '../middleware/auth.js';

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

pool.query(`CREATE TABLE IF NOT EXISTS meal_deductions (
  id               SERIAL PRIMARY KEY,
  upload_id        INTEGER NOT NULL REFERENCES meal_deduction_uploads(id) ON DELETE CASCADE,
  employee_name    TEXT NOT NULL,
  transaction_date DATE,
  item_description TEXT,
  amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('meal_deductions migration:', e.message));

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
              mdu.row_count AS "rowCount", mdu.total_amount AS "totalAmount",
              mdu.created_at AS "createdAt", e.name AS "uploadedByName"
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
              amount
       FROM meal_deductions
       WHERE upload_id = $1
       ORDER BY employee_name, transaction_date NULLS LAST, id`,
      [id]
    );

    // Group by employee
    const grouped = {};
    for (const d of deductions) {
      if (!grouped[d.employeeName]) {
        grouped[d.employeeName] = { employeeName: d.employeeName, transactionCount: 0, totalAmount: 0, transactions: [] };
      }
      grouped[d.employeeName].transactionCount++;
      grouped[d.employeeName].totalAmount += parseFloat(d.amount);
      grouped[d.employeeName].transactions.push({ id: d.id, date: d.date, description: d.description, amount: d.amount });
    }

    const breakdown = Object.values(grouped)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      .map(g => ({ ...g, totalAmount: g.totalAmount.toFixed(2) }));

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

  // Resolve columns — prefer explicit params, fall back to auto-detect
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

  // Process rows
  const periodLabel = req.body.periodLabel?.trim() || null;
  const filename    = req.file.originalname;

  let totalAmount = 0;
  const deductions = [];

  for (const row of rows) {
    const empName = row[employeeCol]?.trim();
    if (!empName) continue;
    const amount = parseAmount(row[amountCol]);
    if (amount === 0 && !row[amountCol]?.trim()) continue;
    const date = dateCol ? parseDate(row[dateCol]) : null;
    const desc = descCol ? row[descCol]?.trim() || null : null;
    totalAmount += amount;
    deductions.push({ employeeName: empName, amount, date, description: desc });
  }

  if (deductions.length === 0) {
    return res.status(400).json({ error: 'No valid deduction rows found. Check that the Employee and Amount columns are correct.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [uploadRow] } = await client.query(
      `INSERT INTO meal_deduction_uploads
         (uploaded_by, filename, period_label, row_count, total_amount, employee_col, amount_col, date_col, desc_col)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, filename, period_label AS "periodLabel", row_count AS "rowCount",
                 total_amount AS "totalAmount", created_at AS "createdAt"`,
      [req.user.id, filename, periodLabel, deductions.length, totalAmount.toFixed(2),
       employeeCol, amountCol, dateCol || null, descCol || null]
    );
    for (const d of deductions) {
      await client.query(
        `INSERT INTO meal_deductions (upload_id, employee_name, transaction_date, item_description, amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [uploadRow.id, d.employeeName, d.date, d.description, d.amount]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ upload: uploadRow });
  } catch (err) {
    await client.query('ROLLBACK');
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
