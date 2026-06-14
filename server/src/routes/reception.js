import { Router } from 'express';
import pool from '../db/index.js';
import { requireReception, requireSysAdmin } from '../middleware/auth.js';

const router = Router();

// Idempotent migrations
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_reception_access BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});

pool.query(`CREATE TABLE IF NOT EXISTS call_log (
  id             SERIAL PRIMARY KEY,
  logged_by      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  caller_name    VARCHAR(255),
  caller_phone   VARCHAR(50),
  call_direction VARCHAR(10) NOT NULL DEFAULT 'inbound',
  reason         TEXT,
  notes          TEXT,
  resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('call_log migration:', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS lost_found (
  id               SERIAL PRIMARY KEY,
  logged_by        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  item_description TEXT NOT NULL,
  location_found   VARCHAR(255),
  found_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  owner_name       VARCHAR(255),
  owner_contact    VARCHAR(255),
  status           VARCHAR(20) NOT NULL DEFAULT 'unclaimed',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
)`).catch(e => console.error('lost_found migration:', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS callback_requests (
  id                 SERIAL PRIMARY KEY,
  logged_by          INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  caller_name        VARCHAR(255) NOT NULL,
  caller_phone       VARCHAR(50) NOT NULL,
  reason             TEXT,
  requested_staff_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  completed_by       INTEGER REFERENCES employees(id) ON DELETE SET NULL
)`).catch(e => console.error('callback_requests migration:', e.message));

// ── Access management (sysadmin only) ─────────────────────────────────────────
router.patch('/access/:id', requireSysAdmin, async (req, res) => {
  const { access } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET has_reception_access = $1 WHERE id = $2
       RETURNING id, has_reception_access AS "hasReceptionAccess"`,
      [access === true, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reception access' });
  }
});

// ── Call Log ──────────────────────────────────────────────────────────────────
router.get('/calls', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cl.id, cl.caller_name AS "callerName", cl.caller_phone AS "callerPhone",
              cl.call_direction AS "callDirection", cl.reason, cl.notes, cl.resolved,
              cl.created_at AS "createdAt",
              e.name AS "loggedByName"
       FROM call_log cl
       LEFT JOIN employees e ON cl.logged_by = e.id
       ORDER BY cl.created_at DESC
       LIMIT 300`
    );
    res.json({ calls: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch call log' });
  }
});

router.post('/calls', requireReception, async (req, res) => {
  const { callerName, callerPhone, callDirection = 'inbound', reason, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO call_log (logged_by, caller_name, caller_phone, call_direction, reason, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, caller_name AS "callerName", caller_phone AS "callerPhone",
                 call_direction AS "callDirection", reason, notes, resolved,
                 created_at AS "createdAt"`,
      [req.user.id, callerName || null, callerPhone || null, callDirection, reason || null, notes || null]
    );
    res.status(201).json({ call: { ...rows[0], loggedByName: req.user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log call' });
  }
});

router.patch('/calls/:id', requireReception, async (req, res) => {
  const { resolved, notes } = req.body;
  const fields = [];
  const vals   = [];
  if (resolved !== undefined) { fields.push(`resolved = $${vals.length + 1}`); vals.push(resolved); }
  if (notes    !== undefined) { fields.push(`notes    = $${vals.length + 1}`); vals.push(notes); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(parseInt(req.params.id));
  try {
    const { rows } = await pool.query(
      `UPDATE call_log SET ${fields.join(', ')} WHERE id = $${vals.length}
       RETURNING id, caller_name AS "callerName", caller_phone AS "callerPhone",
                 call_direction AS "callDirection", reason, notes, resolved,
                 created_at AS "createdAt"`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Call not found' });
    res.json({ call: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update call' });
  }
});

router.delete('/calls/:id', requireReception, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM call_log WHERE id = $1', [parseInt(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Call not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete call' });
  }
});

// ── Lost & Found ──────────────────────────────────────────────────────────────
router.get('/lost-found', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT lf.id, lf.item_description AS "itemDescription", lf.location_found AS "locationFound",
              lf.found_date::text AS "foundDate", lf.owner_name AS "ownerName",
              lf.owner_contact AS "ownerContact", lf.status, lf.notes,
              lf.created_at AS "createdAt", lf.resolved_at AS "resolvedAt",
              e.name AS "loggedByName"
       FROM lost_found lf
       LEFT JOIN employees e ON lf.logged_by = e.id
       ORDER BY lf.created_at DESC
       LIMIT 300`
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lost and found' });
  }
});

router.post('/lost-found', requireReception, async (req, res) => {
  const { itemDescription, locationFound, foundDate, ownerName, ownerContact, notes } = req.body;
  if (!itemDescription?.trim()) return res.status(400).json({ error: 'Item description is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO lost_found (logged_by, item_description, location_found, found_date, owner_name, owner_contact, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, item_description AS "itemDescription", location_found AS "locationFound",
                 found_date::text AS "foundDate", owner_name AS "ownerName",
                 owner_contact AS "ownerContact", status, notes, created_at AS "createdAt"`,
      [req.user.id, itemDescription.trim(), locationFound || null,
       foundDate || null, ownerName || null, ownerContact || null, notes || null]
    );
    res.status(201).json({ item: { ...rows[0], loggedByName: req.user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log item' });
  }
});

router.patch('/lost-found/:id', requireReception, async (req, res) => {
  const { status, ownerName, ownerContact, notes } = req.body;
  const fields = [];
  const vals   = [];
  if (status       !== undefined) { fields.push(`status        = $${vals.length + 1}`); vals.push(status); }
  if (ownerName    !== undefined) { fields.push(`owner_name    = $${vals.length + 1}`); vals.push(ownerName); }
  if (ownerContact !== undefined) { fields.push(`owner_contact = $${vals.length + 1}`); vals.push(ownerContact); }
  if (notes        !== undefined) { fields.push(`notes         = $${vals.length + 1}`); vals.push(notes); }
  if (status && status !== 'unclaimed') {
    fields.push(`resolved_at = NOW()`);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(parseInt(req.params.id));
  try {
    const { rows } = await pool.query(
      `UPDATE lost_found SET ${fields.join(', ')} WHERE id = $${vals.length}
       RETURNING id, item_description AS "itemDescription", location_found AS "locationFound",
                 found_date::text AS "foundDate", owner_name AS "ownerName",
                 owner_contact AS "ownerContact", status, notes,
                 created_at AS "createdAt", resolved_at AS "resolvedAt"`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
    res.json({ item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// ── Callback Requests ─────────────────────────────────────────────────────────
router.get('/callbacks', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cb.id, cb.caller_name AS "callerName", cb.caller_phone AS "callerPhone",
              cb.reason, cb.status, cb.notes,
              cb.created_at AS "createdAt", cb.completed_at AS "completedAt",
              e.name  AS "loggedByName",
              rs.id   AS "requestedStaffId", rs.name AS "requestedStaffName",
              ce.name AS "completedByName"
       FROM callback_requests cb
       LEFT JOIN employees e  ON cb.logged_by          = e.id
       LEFT JOIN employees rs ON cb.requested_staff_id  = rs.id
       LEFT JOIN employees ce ON cb.completed_by        = ce.id
       ORDER BY cb.status = 'pending' DESC, cb.created_at DESC
       LIMIT 300`
    );
    res.json({ callbacks: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch callbacks' });
  }
});

router.post('/callbacks', requireReception, async (req, res) => {
  const { callerName, callerPhone, reason, requestedStaffId, notes } = req.body;
  if (!callerName?.trim())  return res.status(400).json({ error: 'Caller name is required' });
  if (!callerPhone?.trim()) return res.status(400).json({ error: 'Caller phone is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO callback_requests (logged_by, caller_name, caller_phone, reason, requested_staff_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, caller_name AS "callerName", caller_phone AS "callerPhone",
                 reason, status, notes, created_at AS "createdAt"`,
      [req.user.id, callerName.trim(), callerPhone.trim(),
       reason || null, requestedStaffId || null, notes || null]
    );
    res.status(201).json({ callback: { ...rows[0], loggedByName: req.user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log callback' });
  }
});

router.patch('/callbacks/:id', requireReception, async (req, res) => {
  const { status, notes, callerName, callerPhone, reason, requestedStaffId } = req.body;
  const fields = [];
  const vals   = [];
  if (callerName       !== undefined) { fields.push(`caller_name        = $${vals.length + 1}`); vals.push(callerName || null); }
  if (callerPhone      !== undefined) { fields.push(`caller_phone       = $${vals.length + 1}`); vals.push(callerPhone || null); }
  if (reason           !== undefined) { fields.push(`reason             = $${vals.length + 1}`); vals.push(reason || null); }
  if (requestedStaffId !== undefined) { fields.push(`requested_staff_id = $${vals.length + 1}`); vals.push(requestedStaffId || null); }
  if (status !== undefined) {
    fields.push(`status = $${vals.length + 1}`);
    vals.push(status);
    if (status === 'completed' || status === 'unable_to_reach') {
      fields.push(`completed_at = NOW()`);
      fields.push(`completed_by = $${vals.length + 1}`);
      vals.push(req.user.id);
    }
  }
  if (notes !== undefined) { fields.push(`notes = $${vals.length + 1}`); vals.push(notes || null); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(parseInt(req.params.id));
  try {
    const { rowCount } = await pool.query(
      `UPDATE callback_requests SET ${fields.join(', ')} WHERE id = $${vals.length}`,
      vals
    );
    if (!rowCount) return res.status(404).json({ error: 'Callback not found' });
    const { rows } = await pool.query(
      `SELECT cb.id, cb.caller_name AS "callerName", cb.caller_phone AS "callerPhone",
              cb.reason, cb.status, cb.notes,
              cb.created_at AS "createdAt", cb.completed_at AS "completedAt",
              e.name  AS "loggedByName",
              rs.id   AS "requestedStaffId", rs.name AS "requestedStaffName",
              ce.name AS "completedByName"
       FROM callback_requests cb
       LEFT JOIN employees e  ON cb.logged_by          = e.id
       LEFT JOIN employees rs ON cb.requested_staff_id  = rs.id
       LEFT JOIN employees ce ON cb.completed_by        = ce.id
       WHERE cb.id = $1`,
      [parseInt(req.params.id)]
    );
    res.json({ callback: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update callback' });
  }
});

router.delete('/callbacks/:id', requireReception, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM callback_requests WHERE id = $1', [parseInt(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Callback not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete callback' });
  }
});

// Staff list for callback "requested staff" dropdown
router.get('/staff', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, position, department FROM employees WHERE is_active = TRUE ORDER BY name`
    );
    res.json({ staff: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

export default router;
