import { Router } from 'express';
import pool from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

pool.query(`CREATE TABLE IF NOT EXISTS sunshine_days (
  id               SERIAL PRIMARY KEY,
  date             DATE        NOT NULL,
  start_time       TIME        NOT NULL,
  end_time         TIME,
  duration_minutes INTEGER,
  notes            TEXT,
  logged_by        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.error('sunshine_days migration:', e.message));

function calcDuration(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? mins : null;
}

// ── Public: login screen quick-view ──────────────────────────────────────────
// GET /api/operations/sunshine/recent  (no auth — shown on login screen)
// Only returns closures that actually triggered the 90-minute policy
router.get('/sunshine/recent', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, date::text, start_time::text AS "startTime",
              end_time::text AS "endTime", duration_minutes AS "durationMinutes", notes
       FROM sunshine_days
       WHERE duration_minutes >= 90
       ORDER BY date DESC, start_time DESC
       LIMIT 5`
    );
    res.json({ entries: rows });
  } catch (err) {
    console.error('Sunshine recent error:', err.message);
    res.status(500).json({ error: 'Failed to fetch recent closures' });
  }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/operations/sunshine
router.get('/sunshine', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.date::text, s.start_time::text AS "startTime",
              s.end_time::text AS "endTime", s.duration_minutes AS "durationMinutes",
              s.notes, s.created_at AS "createdAt",
              e.name AS "loggedByName"
       FROM sunshine_days s
       LEFT JOIN employees e ON e.id = s.logged_by
       ORDER BY s.date DESC, s.start_time DESC`
    );
    res.json({ entries: rows });
  } catch (err) {
    console.error('Sunshine list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch closure log' });
  }
});

// POST /api/operations/sunshine
router.post('/sunshine', requireAdmin, async (req, res) => {
  const { date, startTime, endTime, notes } = req.body;
  if (!date || !startTime) return res.status(400).json({ error: 'date and startTime are required' });
  const duration = calcDuration(startTime, endTime);
  try {
    const { rows } = await pool.query(
      `INSERT INTO sunshine_days (date, start_time, end_time, duration_minutes, notes, logged_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, date::text, start_time::text AS "startTime",
                 end_time::text AS "endTime", duration_minutes AS "durationMinutes",
                 notes, created_at AS "createdAt"`,
      [date, startTime, endTime || null, duration, notes || null, req.user.id]
    );
    rows[0].loggedByName = req.user.name;
    res.status(201).json({ entry: rows[0] });
  } catch (err) {
    console.error('Sunshine create error:', err.message);
    res.status(500).json({ error: 'Failed to log closure' });
  }
});

// PATCH /api/operations/sunshine/:id
router.patch('/sunshine/:id', requireAdmin, async (req, res) => {
  const { date, startTime, endTime, notes } = req.body;
  const duration = calcDuration(startTime, endTime);
  try {
    const { rows } = await pool.query(
      `UPDATE sunshine_days
       SET date             = COALESCE($1::date,  date),
           start_time       = COALESCE($2::time,  start_time),
           end_time         = COALESCE($3::time,  end_time),
           duration_minutes = COALESCE($4,        duration_minutes),
           notes            = COALESCE($5,        notes)
       WHERE id = $6
       RETURNING id, date::text, start_time::text AS "startTime",
                 end_time::text AS "endTime", duration_minutes AS "durationMinutes",
                 notes, created_at AS "createdAt"`,
      [date || null, startTime || null, endTime || null, duration, notes ?? null, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found' });
    const emp = await pool.query('SELECT name FROM employees WHERE id = $1', [req.user.id]);
    rows[0].loggedByName = emp.rows[0]?.name ?? req.user.name;
    res.json({ entry: rows[0] });
  } catch (err) {
    console.error('Sunshine update error:', err.message);
    res.status(500).json({ error: 'Failed to update closure' });
  }
});

// DELETE /api/operations/sunshine/:id
router.delete('/sunshine/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM sunshine_days WHERE id = $1', [parseInt(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Sunshine delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

export default router;
