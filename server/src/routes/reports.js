import { Router } from 'express';
import pool from '../db/index.js';
import { requireManagement } from '../middleware/auth.js';

const router = Router();

// GET /api/reports/schedule?weekStart=YYYY-MM-DD
router.get('/schedule', requireManagement, async (req, res) => {
  const { weekStart } = req.query;
  if (!weekStart) return res.status(400).json({ error: 'weekStart is required' });
  const base = new Date(weekStart + 'T00:00:00');
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  try {
    const { rows } = await pool.query(
      `SELECT s.date::text, s.start_time AS start, s.end_time AS end,
              s.department, s.position, s.location, s.notes,
              e.name AS "employeeName", e.avatar
       FROM shifts s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.date = ANY($1::date[])
       ORDER BY s.date, s.department, s.start_time, e.name`,
      [days]
    );
    res.json({ shifts: rows, days });
  } catch (err) {
    console.error('Report error (schedule):', err.message);
    res.status(500).json({ error: 'Failed to generate schedule report' });
  }
});

// GET /api/reports/roster
router.get('/roster', requireManagement, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, department, departments, position, role,
              hire_date::text AS "hireDate", avatar
       FROM employees
       WHERE is_active = true
       ORDER BY department, name`
    );
    res.json({ employees: rows });
  } catch (err) {
    console.error('Report error (roster):', err.message);
    res.status(500).json({ error: 'Failed to generate roster report' });
  }
});

// GET /api/reports/hours?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/hours', requireManagement, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.name, e.department, e.avatar,
              COUNT(s.id)::int AS "shiftCount",
              COALESCE(ROUND(SUM(
                EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600
              )::numeric, 2), 0) AS "totalHours"
       FROM employees e
       LEFT JOIN shifts s ON s.employee_id = e.id
         AND s.date >= $1 AND s.date <= $2
       WHERE e.is_active = true AND e.role = 'crew_member'
       GROUP BY e.id, e.name, e.department, e.avatar
       ORDER BY e.department, e.name`,
      [from, to]
    );
    res.json({ employees: rows, from, to });
  } catch (err) {
    console.error('Report error (hours):', err.message);
    res.status(500).json({ error: 'Failed to generate hours report' });
  }
});

// GET /api/reports/coverage?weekStart=YYYY-MM-DD
router.get('/coverage', requireManagement, async (req, res) => {
  const { weekStart } = req.query;
  if (!weekStart) return res.status(400).json({ error: 'weekStart is required' });
  const base = new Date(weekStart + 'T00:00:00');
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  try {
    const { rows } = await pool.query(
      `SELECT s.date::text, s.department,
              COUNT(DISTINCT s.employee_id)::int AS "staffCount",
              COUNT(s.id)::int AS "shiftCount"
       FROM shifts s
       WHERE s.date = ANY($1::date[])
       GROUP BY s.date, s.department
       ORDER BY s.date, s.department`,
      [days]
    );
    res.json({ coverage: rows, days });
  } catch (err) {
    console.error('Report error (coverage):', err.message);
    res.status(500).json({ error: 'Failed to generate coverage report' });
  }
});

// GET /api/reports/timeoff?from=YYYY-MM-DD&to=YYYY-MM-DD&status=all|pending|approved|denied
router.get('/timeoff', requireManagement, async (req, res) => {
  const { from, to, status = 'all' } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    const statusClause = status !== 'all' ? `AND t.status = '${status}'` : '';
    const { rows } = await pool.query(
      `SELECT e.name AS "employeeName", e.department, e.avatar,
              t.start_date::text AS "startDate", t.end_date::text AS "endDate",
              t.reason, t.status, t.review_notes AS "reviewNotes",
              t.created_at AS "createdAt"
       FROM time_off_requests t
       JOIN employees e ON e.id = t.employee_id
       WHERE t.start_date >= $1 AND t.start_date <= $2 ${statusClause}
       ORDER BY t.status, t.start_date, e.name`,
      [from, to]
    );
    res.json({ requests: rows, from, to });
  } catch (err) {
    console.error('Report error (timeoff):', err.message);
    res.status(500).json({ error: 'Failed to generate time-off report' });
  }
});

export default router;
