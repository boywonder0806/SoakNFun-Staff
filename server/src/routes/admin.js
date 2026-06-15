import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/index.js';
import { requireAdmin, requireSysAdmin } from '../middleware/auth.js';
import { sendWelcomeEmail, sendReceptionWelcomeEmail, resendStaffWelcomeEmail } from '../services/email.js';

const router = Router();

// Idempotent column migrations
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url TEXT').catch(() => {});
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS force_password_reset BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_reception_access BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_reception_manager BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_handle_callbacks BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query(`CREATE TABLE IF NOT EXISTS employee_notes (
  id         SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  author_id  INT NOT NULL REFERENCES employees(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.error('employee_notes migration:', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS activity_logs (
  id          SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(id) ON DELETE SET NULL,
  event       TEXT NOT NULL,
  details     JSONB DEFAULT '{}',
  actor_id    INT REFERENCES employees(id) ON DELETE SET NULL,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.error('activity_logs migration:', e.message));

pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_emp
  ON activity_logs(employee_id)`).catch(() => {});

// ── Activity log helper ───────────────────────────────────────────────────────
async function logEvent(employeeId, event, details = {}, actorId = null, ip = null) {
  try {
    await pool.query(
      `INSERT INTO activity_logs (employee_id, event, details, actor_id, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [employeeId || null, event, JSON.stringify(details), actorId || null, ip || null]
    );
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getWeekDates(mondayStr) {
  const base = new Date(mondayStr + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function getTwoWeekDates(mondayStr) {
  const base = new Date(mondayStr + 'T00:00:00');
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

const SHIFT_SELECT = `id, employee_id AS "employeeId", date::text, start_time AS start,
  end_time AS end, department, position, location, COALESCE(notes,'') AS notes`;

// Returns null for sysadmin (no filter), or the manager's departments array
function managerDepts(req) {
  if (req.user.role === 'sysadmin') return null;
  return req.user.departments ?? [];
}

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get('/stats', requireAdmin, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const depts = managerDepts(req);
  try {
    const [staffRes, todayRes, weekRes] = await Promise.all([
      depts
        ? pool.query(`SELECT COUNT(*) FROM employees WHERE is_active = true AND role = 'crew_member' AND departments && $1::text[]`, [depts])
        : pool.query(`SELECT COUNT(*) FROM employees WHERE is_active = true AND role = 'crew_member'`),
      depts
        ? pool.query(`SELECT COUNT(*) FROM shifts WHERE date = $1 AND department = ANY($2::text[])`, [today, depts])
        : pool.query(`SELECT COUNT(*) FROM shifts WHERE date = $1`, [today]),
      depts
        ? pool.query(`SELECT COUNT(*) FROM shifts WHERE date >= date_trunc('week', CURRENT_DATE) AND department = ANY($1::text[])`, [depts])
        : pool.query(`SELECT COUNT(*) FROM shifts WHERE date >= date_trunc('week', CURRENT_DATE)`),
    ]);
    res.json({
      totalStaff:     parseInt(staffRes.rows[0].count),
      onDutyToday:    parseInt(todayRes.rows[0].count),
      shiftsThisWeek: parseInt(weekRes.rows[0].count),
      openRequests:   0,
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── Employees ─────────────────────────────────────────────────────────────────
router.get('/employees', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, department, departments, position,
              avatar, phone, hire_date AS "hireDate", is_active AS "isActive",
              photo_url AS "photoUrl", is_locked AS "isLocked",
              created_at AS "createdAt",
              COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess",
              COALESCE(is_reception_manager, FALSE) AS "isReceptionManager"
       FROM employees ORDER BY name`
    );
    res.json({ employees: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

router.patch('/employees/:id/password', requireAdmin, async (req, res) => {
  const { password, forceReset = false } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const empId = parseInt(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE employees SET password_hash = $1, force_password_reset = $2 WHERE id = $3`,
      [hash, forceReset === true, empId]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    logEvent(empId, 'Password reset', { forceReset }, req.user.id, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

const VALID_DEPARTMENTS = ['Aquatics', 'Guest Services', 'Food & Beverage', 'Cleaning Crew', 'Management'];
router.patch('/employees/:id/role', requireSysAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['crew_member', 'manager', 'sysadmin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET role = $1 WHERE id = $2
       RETURNING id, email, name, role, department, departments, position, avatar, phone`,
      [role, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

router.patch('/employees/:id/departments', requireAdmin, async (req, res) => {
  const { departments } = req.body;
  if (!Array.isArray(departments)) {
    return res.status(400).json({ error: 'departments must be an array.' });
  }
  const invalid = departments.filter(d => !VALID_DEPARTMENTS.includes(d));
  if (invalid.length) {
    return res.status(400).json({ error: `Invalid departments: ${invalid.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET departments = $1, department = $2 WHERE id = $3
       RETURNING id, email, name, role, department, departments, position, avatar, phone`,
      [departments, departments[0] || null, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update departments' });
  }
});

router.patch('/employees/:id/lock', requireAdmin, async (req, res) => {
  const { locked } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET is_locked = $1 WHERE id = $2
       RETURNING id, is_locked AS "isLocked"`,
      [locked === true, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    logEvent(parseInt(req.params.id), locked ? 'Account locked' : 'Account unlocked', {}, req.user.id, req.ip);
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lock status' });
  }
});

// ── Staff management (crew members) ──────────────────────────────────────────
router.get('/staff/check', requireAdmin, async (req, res) => {
  const { name, email } = req.query;
  const result = { emailMatch: null, nameMatches: [], netchexMatches: [] };
  try {
    if (email?.trim()) {
      const { rows } = await pool.query(
        `SELECT id, name, email, department, position FROM employees WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email.trim()]
      );
      result.emailMatch = rows[0] ?? null;
    }
    if (name?.trim()) {
      const words = name.trim().split(/\s+/).filter(w => w.length > 1);
      if (words.length) {
        const { rows } = await pool.query(
          `SELECT id, name, email, department FROM employees WHERE name ILIKE $1 LIMIT 5`,
          [`%${words.join('%')}%`]
        );
        result.nameMatches = rows;
      }
      const firstName = name.trim().split(/\s+/)[0];
      if (firstName.length > 1) {
        const { rows: nx } = await pool.query(
          `SELECT employee_name AS "employeeName", COUNT(*)::int AS "shiftCount"
           FROM netchex_shifts
           WHERE employee_name ILIKE $1 AND employee_id IS NULL
           GROUP BY employee_name ORDER BY "shiftCount" DESC LIMIT 5`,
          [`%${firstName}%`]
        );
        result.netchexMatches = nx;
      }
    }
    res.json(result);
  } catch (err) {
    console.error('Staff check error:', err.message);
    res.status(500).json({ error: 'Check failed.' });
  }
});

router.post('/staff', requireAdmin, async (req, res) => {
  const { name, email, phone, department, position, hireDate, password, linkNetchexName } = req.body;
  if (!name?.trim() || !email?.trim() || !department || !password) {
    return res.status(400).json({ error: 'Name, email, department, and password are required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: dup } = await client.query(
      `SELECT id FROM employees WHERE LOWER(email) = LOWER($1)`, [email.trim()]
    );
    if (dup.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const parts = name.trim().split(/\s+/);
    const avatar = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.trim().slice(0, 2).toUpperCase();
    const { rows: [emp] } = await client.query(
      `INSERT INTO employees
         (name, email, password_hash, role, department, departments, position, phone, hire_date, avatar, force_password_reset)
       VALUES ($1,$2,$3,'crew_member',$4,$5,$6,$7,$8,$9,TRUE)
       RETURNING id, name, email, role, department, departments, position, phone,
                 hire_date AS "hireDate", avatar, is_active AS "isActive",
                 is_locked AS "isLocked", photo_url AS "photoUrl"`,
      [name.trim(), email.trim().toLowerCase(), hash, department, [department],
       position?.trim() || null, phone?.trim() || null, hireDate || null, avatar]
    );
    if (linkNetchexName) {
      await client.query(
        `UPDATE netchex_shifts SET employee_id = $1
         WHERE LOWER(employee_name) = LOWER($2) AND employee_id IS NULL`,
        [emp.id, linkNetchexName]
      );
    }
    await client.query('COMMIT');
    sendWelcomeEmail({ toEmail: emp.email, toName: emp.name, tempPassword: password });
    res.status(201).json({ employee: emp });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create staff error:', err.message);
    res.status(500).json({ error: 'Failed to create staff member.' });
  } finally {
    client.release();
  }
});

router.patch('/staff/:id', requireAdmin, async (req, res) => {
  const { name, email, phone, position, department, hireDate } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET
         name       = COALESCE($1, name),
         email      = COALESCE($2, email),
         phone      = COALESCE($3, phone),
         position   = COALESCE($4, position),
         department = COALESCE($5, department),
         hire_date  = COALESCE($6::date, hire_date)
       WHERE id = $7 AND role = 'crew_member'
       RETURNING id, name, email, role, department, departments, position, phone,
                 hire_date AS "hireDate", avatar, is_active AS "isActive",
                 is_locked AS "isLocked", photo_url AS "photoUrl",
                 COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess",
                 COALESCE(is_reception_manager, FALSE) AS "isReceptionManager"`,
      [name||null, email||null, phone||null, position||null, department||null,
       hireDate||null, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff member not found.' });
    logEvent(parseInt(req.params.id), 'Profile updated', {}, req.user.id, req.ip);
    res.json({ employee: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update staff member.' });
  }
});

router.patch('/staff/:id/reception-manager', requireAdmin, async (req, res) => {
  const { isManager } = req.body;
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET is_reception_manager = $1 WHERE id = $2 AND role = 'crew_member'
       RETURNING id, COALESCE(is_reception_manager, FALSE) AS "isReceptionManager"`,
      [isManager === true, empId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff member not found.' });
    logEvent(empId, isManager ? 'Reception manager role granted' : 'Reception manager role removed', {}, req.user.id, req.ip);
    res.json({ employee: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reception manager status.' });
  }
});

router.patch('/staff/:id/reception-access', requireAdmin, async (req, res) => {
  const { hasAccess } = req.body;
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET has_reception_access = $1 WHERE id = $2 AND role != 'sysadmin'
       RETURNING id, name, email, COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess"`,
      [hasAccess === true, empId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff member not found.' });
    logEvent(empId, hasAccess ? 'Reception access granted' : 'Reception access revoked', {}, req.user.id, req.ip);
    if (hasAccess === true) {
      sendReceptionWelcomeEmail({ toEmail: rows[0].email, toName: rows[0].name });
    }
    const { name, email, ...employee } = rows[0];
    res.json({ employee });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reception access.' });
  }
});

router.post('/staff/:id/resend-reception-invite', requireAdmin, async (req, res) => {
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess"
       FROM employees WHERE id = $1 AND role != 'sysadmin'`,
      [empId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff member not found.' });
    if (!rows[0].hasReceptionAccess) return res.status(400).json({ error: 'Staff member does not have reception access.' });
    await sendReceptionWelcomeEmail({ toEmail: rows[0].email, toName: rows[0].name });
    logEvent(empId, 'Reception portal invite resent', {}, req.user.id, req.ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resend invite.' });
  }
});

router.post('/staff/:id/resend-welcome', requireAdmin, async (req, res) => {
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email FROM employees WHERE id = $1 AND role != 'sysadmin'`,
      [empId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff member not found.' });
    await resendStaffWelcomeEmail({ toEmail: rows[0].email, toName: rows[0].name });
    logEvent(empId, 'Welcome email resent', {}, req.user.id, req.ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send welcome email.' });
  }
});

// ── Staff detail tabs ─────────────────────────────────────────────────────────
router.get('/staff/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, department, departments, position, phone,
              hire_date AS "hireDate", avatar, is_active AS "isActive",
              is_locked AS "isLocked", photo_url AS "photoUrl",
              created_at AS "createdAt",
              COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess",
              COALESCE(is_reception_manager, FALSE) AS "isReceptionManager"
       FROM employees WHERE id = $1 AND role = 'crew_member'`,
      [parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff member not found' });
    res.json({ employee: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff member' });
  }
});

router.get('/staff/:id/schedule', requireAdmin, async (req, res) => {
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT id, date::text, start_time AS start, end_time AS end,
              department, position, location, COALESCE(notes,'') AS notes
       FROM shifts WHERE employee_id = $1
       ORDER BY date DESC, start_time DESC LIMIT 60`,
      [empId]
    );
    res.json({ shifts: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

router.get('/staff/:id/timeoff', requireAdmin, async (req, res) => {
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT id, start_date::text AS "startDate", end_date::text AS "endDate",
              reason, status, review_notes AS "reviewNotes", created_at AS "createdAt"
       FROM time_off_requests WHERE employee_id = $1
       ORDER BY created_at DESC`,
      [empId]
    );
    res.json({ requests: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch time off' });
  }
});

router.get('/staff/:id/notes', requireAdmin, async (req, res) => {
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.body, n.created_at AS "createdAt",
              n.author_id AS "authorId", e.name AS "authorName"
       FROM employee_notes n JOIN employees e ON e.id = n.author_id
       WHERE n.employee_id = $1
       ORDER BY n.created_at DESC`,
      [empId]
    );
    res.json({ notes: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

router.post('/staff/:id/notes', requireAdmin, async (req, res) => {
  const empId = parseInt(req.params.id);
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Note body is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO employee_notes (employee_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at AS "createdAt", author_id AS "authorId"`,
      [empId, req.user.id, body.trim()]
    );
    res.status(201).json({ note: { ...rows[0], authorName: req.user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// GET /api/admin/logs — all activity logs for sysadmin view
router.get('/logs', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.event, l.details, l.ip_address AS "ipAddress",
              l.created_at AS "createdAt",
              e.name AS "employeeName", e.email AS "employeeEmail", e.avatar AS "employeeAvatar",
              a.name AS "actorName"
       FROM activity_logs l
       LEFT JOIN employees e ON e.id = l.employee_id
       LEFT JOIN employees a ON a.id = l.actor_id
       ORDER BY l.created_at DESC LIMIT 200`
    );
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

router.get('/staff/:id/logs', requireAdmin, async (req, res) => {
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.event, l.details, l.ip_address AS "ipAddress",
              l.created_at AS "createdAt",
              a.name AS "actorName"
       FROM activity_logs l
       LEFT JOIN employees a ON a.id = l.actor_id
       WHERE l.employee_id = $1
       ORDER BY l.created_at DESC LIMIT 50`,
      [empId]
    );
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

router.patch('/staff/:id/force-reset', requireAdmin, async (req, res) => {
  const empId = parseInt(req.params.id);
  try {
    await pool.query(
      `UPDATE employees SET force_password_reset = TRUE WHERE id = $1`, [empId]
    );
    logEvent(empId, 'Password reset required', {}, req.user.id, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set force reset' });
  }
});

router.patch('/staff/:id/status', requireAdmin, async (req, res) => {
  const { isActive } = req.body;
  const empId = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET is_active = $1 WHERE id = $2
       RETURNING id, is_active AS "isActive"`,
      [isActive === true, empId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Staff member not found' });
    logEvent(empId, isActive ? 'Account reactivated' : 'Account deactivated', {}, req.user.id, req.ip);
    res.json({ employee: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update account status' });
  }
});

router.delete('/staff/notes/:noteId', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM employee_notes WHERE id = $1 AND (author_id = $2 OR $3 = 'sysadmin')`,
      [parseInt(req.params.noteId), req.user.id, req.user.role]
    );
    if (!rowCount) return res.status(404).json({ error: 'Note not found or not authorized' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// ── Daily schedule view ───────────────────────────────────────────────────────
router.get('/schedule', requireAdmin, async (req, res) => {
  const target = req.query.date || new Date().toISOString().slice(0, 10);
  const depts = managerDepts(req);
  try {
    const { rows } = depts
      ? await pool.query(
          `SELECT s.id, s.employee_id AS "employeeId", s.date::text, s.start_time AS start,
                  s.end_time AS end, s.department, s.position, s.location,
                  COALESCE(s.notes,'') AS notes, e.name AS "employeeName", e.avatar
           FROM shifts s JOIN employees e ON e.id = s.employee_id
           WHERE s.date = $1 AND s.department = ANY($2::text[]) ORDER BY s.start_time`,
          [target, depts]
        )
      : await pool.query(
          `SELECT s.id, s.employee_id AS "employeeId", s.date::text, s.start_time AS start,
                  s.end_time AS end, s.department, s.position, s.location,
                  COALESCE(s.notes,'') AS notes, e.name AS "employeeName", e.avatar
           FROM shifts s JOIN employees e ON e.id = s.employee_id
           WHERE s.date = $1 ORDER BY s.start_time`,
          [target]
        );
    res.json({ date: target, shifts: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// ── Scheduler (current week) ──────────────────────────────────────────────────
router.get('/scheduler', requireAdmin, async (req, res) => {
  const weekStart = req.query.weekStart || getMondayOfWeek(new Date());
  const days = getWeekDates(weekStart);
  const depts = managerDepts(req);
  try {
    const [empRes, shiftRes] = await Promise.all([
      depts
        ? pool.query(`SELECT id, email, name, role, department, departments, position, avatar, phone,
                             hire_date AS "hireDate" FROM employees WHERE is_active = true AND role = 'crew_member' AND departments && $1::text[] ORDER BY name`, [depts])
        : pool.query(`SELECT id, email, name, role, department, departments, position, avatar, phone,
                             hire_date AS "hireDate" FROM employees WHERE is_active = true AND role = 'crew_member' ORDER BY name`),
      depts
        ? pool.query(`SELECT ${SHIFT_SELECT} FROM shifts WHERE date = ANY($1::date[]) AND department = ANY($2::text[]) ORDER BY date, start_time`, [days, depts])
        : pool.query(`SELECT ${SHIFT_SELECT} FROM shifts WHERE date = ANY($1::date[]) ORDER BY date, start_time`, [days]),
    ]);
    res.json({ weekStart, days, employees: empRes.rows, shifts: shiftRes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scheduler' });
  }
});

router.post('/scheduler/shifts', requireAdmin, async (req, res) => {
  const { employeeId, date, start, end, department, position, location, notes } = req.body;
  if (!employeeId || !date || !start || !end) {
    return res.status(400).json({ error: 'employeeId, date, start, and end are required.' });
  }
  const depts = managerDepts(req);
  if (depts && department && !depts.includes(department)) {
    return res.status(403).json({ error: 'You do not have access to this department.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO shifts (employee_id,date,start_time,end_time,department,position,location,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SHIFT_SELECT}`,
      [parseInt(employeeId), date, start, end, department||'', position||'', location||'', notes||'']
    );
    res.status(201).json({ shift: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create shift' });
  }
});

router.patch('/scheduler/shifts/:id', requireAdmin, async (req, res) => {
  const { employeeId, date, start, end, department, position, location, notes } = req.body;
  const depts = managerDepts(req);
  if (depts) {
    const { rows: cur } = await pool.query(`SELECT department FROM shifts WHERE id = $1`, [parseInt(req.params.id)]);
    if (!cur[0]) return res.status(404).json({ error: 'Shift not found.' });
    if (!depts.includes(cur[0].department)) return res.status(403).json({ error: 'You do not have access to this department.' });
    if (department && !depts.includes(department)) return res.status(403).json({ error: 'You do not have access to this department.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE shifts SET
         employee_id = COALESCE($1, employee_id),
         date        = COALESCE($2::date, date),
         start_time  = COALESCE($3::time, start_time),
         end_time    = COALESCE($4::time, end_time),
         department  = COALESCE($5, department),
         position    = COALESCE($6, position),
         location    = COALESCE($7, location),
         notes       = COALESCE($8, notes)
       WHERE id = $9 RETURNING ${SHIFT_SELECT}`,
      [employeeId ? parseInt(employeeId) : null,
       date||null, start||null, end||null,
       department??null, position??null, location??null, notes??null,
       parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Shift not found.' });
    res.json({ shift: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

router.delete('/scheduler/shifts/:id', requireAdmin, async (req, res) => {
  const depts = managerDepts(req);
  if (depts) {
    const { rows: cur } = await pool.query(`SELECT department FROM shifts WHERE id = $1`, [parseInt(req.params.id)]);
    if (!cur[0]) return res.status(404).json({ error: 'Shift not found.' });
    if (!depts.includes(cur[0].department)) return res.status(403).json({ error: 'You do not have access to this department.' });
  }
  try {
    const { rowCount } = await pool.query(`DELETE FROM shifts WHERE id = $1`, [parseInt(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Shift not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete shift' });
  }
});

// ── Plan Schedule (draft) ─────────────────────────────────────────────────────
router.get('/scheduler/plan', requireAdmin, async (req, res) => {
  const weekStart = req.query.weekStart || getMondayOfWeek(new Date());
  const days = getWeekDates(weekStart);
  const depts = managerDepts(req);
  try {
    const [empRes, shiftRes] = await Promise.all([
      depts
        ? pool.query(`SELECT id, email, name, role, department, departments, position, avatar, phone,
                             hire_date AS "hireDate" FROM employees WHERE is_active = true AND role = 'crew_member' AND departments && $1::text[] ORDER BY name`, [depts])
        : pool.query(`SELECT id, email, name, role, department, departments, position, avatar, phone,
                             hire_date AS "hireDate" FROM employees WHERE is_active = true AND role = 'crew_member' ORDER BY name`),
      depts
        ? pool.query(`SELECT ${SHIFT_SELECT} FROM draft_shifts WHERE date = ANY($1::date[]) AND department = ANY($2::text[]) ORDER BY date, start_time`, [days, depts])
        : pool.query(`SELECT ${SHIFT_SELECT} FROM draft_shifts WHERE date = ANY($1::date[]) ORDER BY date, start_time`, [days]),
    ]);
    res.json({ weekStart, days, employees: empRes.rows, shifts: shiftRes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

router.post('/scheduler/plan/shifts', requireAdmin, async (req, res) => {
  const { employeeId, date, start, end, department, position, location, notes } = req.body;
  if (!employeeId || !date || !start || !end) {
    return res.status(400).json({ error: 'employeeId, date, start, and end are required.' });
  }
  const depts = managerDepts(req);
  if (depts && department && !depts.includes(department)) {
    return res.status(403).json({ error: 'You do not have access to this department.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO draft_shifts (employee_id,date,start_time,end_time,department,position,location,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${SHIFT_SELECT}`,
      [parseInt(employeeId), date, start, end, department||'', position||'', location||'', notes||'']
    );
    res.status(201).json({ shift: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create draft shift' });
  }
});

router.patch('/scheduler/plan/shifts/:id', requireAdmin, async (req, res) => {
  const { employeeId, date, start, end, department, position, location, notes } = req.body;
  const depts = managerDepts(req);
  if (depts) {
    const { rows: cur } = await pool.query(`SELECT department FROM draft_shifts WHERE id = $1`, [parseInt(req.params.id)]);
    if (!cur[0]) return res.status(404).json({ error: 'Draft shift not found.' });
    if (!depts.includes(cur[0].department)) return res.status(403).json({ error: 'You do not have access to this department.' });
    if (department && !depts.includes(department)) return res.status(403).json({ error: 'You do not have access to this department.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE draft_shifts SET
         employee_id = COALESCE($1, employee_id),
         date        = COALESCE($2::date, date),
         start_time  = COALESCE($3::time, start_time),
         end_time    = COALESCE($4::time, end_time),
         department  = COALESCE($5, department),
         position    = COALESCE($6, position),
         location    = COALESCE($7, location),
         notes       = COALESCE($8, notes)
       WHERE id = $9 RETURNING ${SHIFT_SELECT}`,
      [employeeId ? parseInt(employeeId) : null,
       date||null, start||null, end||null,
       department??null, position??null, location??null, notes??null,
       parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Draft shift not found.' });
    res.json({ shift: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update draft shift' });
  }
});

router.delete('/scheduler/plan/shifts/:id', requireAdmin, async (req, res) => {
  const depts = managerDepts(req);
  if (depts) {
    const { rows: cur } = await pool.query(`SELECT department FROM draft_shifts WHERE id = $1`, [parseInt(req.params.id)]);
    if (!cur[0]) return res.status(404).json({ error: 'Draft shift not found.' });
    if (!depts.includes(cur[0].department)) return res.status(403).json({ error: 'You do not have access to this department.' });
  }
  try {
    const { rowCount } = await pool.query(`DELETE FROM draft_shifts WHERE id = $1`, [parseInt(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Draft shift not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete draft shift' });
  }
});

router.post('/scheduler/plan/publish', requireAdmin, async (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required.' });
  const depts = managerDepts(req);
  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');
    const { rows: drafts } = depts
      ? await pgClient.query(
          `SELECT * FROM draft_shifts WHERE date >= $1 AND date <= $2 AND department = ANY($3::text[])`,
          [from, to, depts]
        )
      : await pgClient.query(
          `SELECT * FROM draft_shifts WHERE date >= $1 AND date <= $2`, [from, to]
        );
    if (!drafts.length) { await pgClient.query('COMMIT'); return res.json({ published: 0 }); }
    for (const d of drafts) {
      await pgClient.query(
        `INSERT INTO shifts (employee_id,date,start_time,end_time,department,position,location,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [d.employee_id, d.date, d.start_time, d.end_time, d.department, d.position, d.location, d.notes]
      );
    }
    if (depts) {
      await pgClient.query(
        `DELETE FROM draft_shifts WHERE date >= $1 AND date <= $2 AND department = ANY($3::text[])`,
        [from, to, depts]
      );
    } else {
      await pgClient.query(`DELETE FROM draft_shifts WHERE date >= $1 AND date <= $2`, [from, to]);
    }
    await pgClient.query('COMMIT');
    res.json({ published: drafts.length });
  } catch (err) {
    await pgClient.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to publish shifts' });
  } finally {
    pgClient.release();
  }
});

// ── SysAdmin ──────────────────────────────────────────────────────────────────
router.get('/sysadmin/users', requireSysAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, department, departments, position,
              avatar, phone, hire_date AS "hireDate", is_active AS "isActive", created_at AS "createdAt",
              photo_url AS "photoUrl", is_locked AS "isLocked",
              COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess"
       FROM employees WHERE role != 'crew_member' ORDER BY name`
    );
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/sysadmin/users', requireSysAdmin, async (req, res) => {
  const { email, password, name, role, department, departments, position, avatar, phone, hireDate } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, and name are required.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO employees (email,password_hash,name,role,department,departments,position,avatar,phone,hire_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, email, name, role, department, departments, position, avatar, phone, hire_date AS "hireDate"`,
      [email.toLowerCase().trim(), hash, name, role||'crew_member',
       department||null, departments||[], position||null, avatar||null, phone||null, hireDate||null]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists.' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ── Department Roles & Positions ─────────────────────────────────────────────
router.get('/departments/roles', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, department, name, type, sort_order, description AS "schedulingNotes"
       FROM department_roles ORDER BY department, type, sort_order, id`
    );
    res.json({ roles: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch department roles' });
  }
});

router.post('/departments/:dept/roles', requireAdmin, async (req, res) => {
  const { name, type = 'role', schedulingNotes } = req.body;
  const department = decodeURIComponent(req.params.dept);
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!['role', 'position'].includes(type)) return res.status(400).json({ error: 'type must be role or position' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO department_roles (department, name, type, sort_order, description, min_count, max_count)
       VALUES ($1, $2, $3,
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM department_roles WHERE department = $1 AND type = $3),
         $4, 1, 1)
       RETURNING id, department, name, type, sort_order, description AS "schedulingNotes"`,
      [department, name.trim(), type, schedulingNotes?.trim() || null]
    );
    res.status(201).json({ role: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Name already exists for this type.' });
    res.status(500).json({ error: 'Failed to add entry' });
  }
});

router.patch('/departments/roles/reorder', requireAdmin, async (req, res) => {
  const { items } = req.body; // [{ id, sortOrder }]
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items is required' });
  try {
    for (const item of items) {
      await pool.query(
        `UPDATE department_roles SET sort_order = $1 WHERE id = $2`,
        [item.sortOrder, parseInt(item.id)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

router.patch('/departments/roles/:id', requireAdmin, async (req, res) => {
  const { name, schedulingNotes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE department_roles
       SET name = $1, description = $2
       WHERE id = $3
       RETURNING id, department, name, type, sort_order, description AS "schedulingNotes"`,
      [name.trim(), schedulingNotes?.trim() ?? null, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ role: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Name already exists for this type.' });
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

router.delete('/departments/roles/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM department_roles WHERE id = $1`, [parseInt(req.params.id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// ── Time Off Requests (Admin) ─────────────────────────────────────────────────
router.get('/time-off', requireAdmin, async (req, res) => {
  const depts = managerDepts(req);
  try {
    const { rows } = depts
      ? await pool.query(
          `SELECT tor.id, tor.employee_id AS "employeeId", e.name AS "employeeName", e.avatar,
                  tor.start_date::text AS "startDate", tor.end_date::text AS "endDate",
                  tor.reason, tor.status, tor.review_notes AS "reviewNotes", tor.created_at AS "createdAt"
           FROM time_off_requests tor JOIN employees e ON e.id = tor.employee_id
           WHERE e.departments && $1::text[] ORDER BY tor.created_at DESC`,
          [depts]
        )
      : await pool.query(
          `SELECT tor.id, tor.employee_id AS "employeeId", e.name AS "employeeName", e.avatar,
                  tor.start_date::text AS "startDate", tor.end_date::text AS "endDate",
                  tor.reason, tor.status, tor.review_notes AS "reviewNotes", tor.created_at AS "createdAt"
           FROM time_off_requests tor JOIN employees e ON e.id = tor.employee_id
           ORDER BY tor.created_at DESC`
        );
    res.json({ requests: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch time off requests' });
  }
});

router.patch('/time-off/:id', requireAdmin, async (req, res) => {
  const { status, reviewNotes } = req.body;
  if (!['approved', 'denied'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or denied' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE time_off_requests
       SET status = $1, review_notes = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $4
       RETURNING id, status, review_notes AS "reviewNotes"`,
      [status, reviewNotes || null, req.user.id, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Request not found' });
    res.json({ request: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// ── Open Shifts (Admin) ───────────────────────────────────────────────────────
router.get('/open-shifts', requireAdmin, async (req, res) => {
  const depts = managerDepts(req);
  try {
    const { rows } = depts
      ? await pool.query(
          `SELECT os.id, os.date::text, os.start_time AS start, os.end_time AS end,
                  os.department, os.position, os.notes,
                  os.claimed_by AS "claimedBy", e.name AS "claimedByName",
                  os.created_at AS "createdAt"
           FROM open_shifts os LEFT JOIN employees e ON e.id = os.claimed_by
           WHERE os.department = ANY($1::text[]) ORDER BY os.date, os.start_time`,
          [depts]
        )
      : await pool.query(
          `SELECT os.id, os.date::text, os.start_time AS start, os.end_time AS end,
                  os.department, os.position, os.notes,
                  os.claimed_by AS "claimedBy", e.name AS "claimedByName",
                  os.created_at AS "createdAt"
           FROM open_shifts os LEFT JOIN employees e ON e.id = os.claimed_by
           ORDER BY os.date, os.start_time`
        );
    res.json({ shifts: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch open shifts' });
  }
});

router.post('/open-shifts', requireAdmin, async (req, res) => {
  const { date, start, end, department, position, notes } = req.body;
  if (!date || !start || !end || !department) {
    return res.status(400).json({ error: 'date, start, end, department are required' });
  }
  const depts = managerDepts(req);
  if (depts && !depts.includes(department)) {
    return res.status(403).json({ error: 'You do not have access to this department.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO open_shifts (date, start_time, end_time, department, position, notes, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, date::text, start_time AS start, end_time AS end,
                 department, position, notes, created_at AS "createdAt"`,
      [date, start, end, department, position || null, notes || null, req.user.id]
    );
    res.status(201).json({ shift: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to post open shift' });
  }
});

router.delete('/open-shifts/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM open_shifts WHERE id = $1`, [parseInt(req.params.id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete open shift' });
  }
});

// ── Certifications ────────────────────────────────────────────────────────────
router.get('/certifications', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, department, description, created_at AS "createdAt"
       FROM certifications ORDER BY name`
    );
    res.json({ certifications: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch certifications' });
  }
});

router.post('/certifications', requireSysAdmin, async (req, res) => {
  const { name, department, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO certifications (name, department, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, department, description, created_at AS "createdAt"`,
      [name.trim(), department || null, description || null]
    );
    res.status(201).json({ certification: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Certification name already exists.' });
    res.status(500).json({ error: 'Failed to create certification' });
  }
});

router.patch('/certifications/:id', requireSysAdmin, async (req, res) => {
  const { name, department, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE certifications SET name = $1, department = $2, description = $3
       WHERE id = $4
       RETURNING id, name, department, description, created_at AS "createdAt"`,
      [name.trim(), department || null, description || null, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Certification not found' });
    res.json({ certification: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Certification name already exists.' });
    res.status(500).json({ error: 'Failed to update certification' });
  }
});

router.delete('/certifications/:id', requireSysAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM certifications WHERE id = $1`, [parseInt(req.params.id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Certification not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete certification' });
  }
});

router.get('/employees/:id/certifications', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.department, c.description, ec.issued_date AS "issuedDate"
       FROM employee_certifications ec
       JOIN certifications c ON c.id = ec.certification_id
       WHERE ec.employee_id = $1
       ORDER BY c.name`,
      [parseInt(req.params.id)]
    );
    res.json({ certifications: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch employee certifications' });
  }
});

router.post('/employees/:id/certifications', requireSysAdmin, async (req, res) => {
  const { certificationId, issuedDate } = req.body;
  if (!certificationId) return res.status(400).json({ error: 'certificationId is required' });
  try {
    await pool.query(
      `INSERT INTO employee_certifications (employee_id, certification_id, issued_date)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [parseInt(req.params.id), parseInt(certificationId), issuedDate || null]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add certification' });
  }
});

router.delete('/employees/:id/certifications/:certId', requireSysAdmin, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM employee_certifications WHERE employee_id = $1 AND certification_id = $2`,
      [parseInt(req.params.id), parseInt(req.params.certId)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove certification' });
  }
});

// ── SysAdmin ──────────────────────────────────────────────────────────────────
router.patch('/sysadmin/users/:id/photo', requireSysAdmin, async (req, res) => {
  const { photoUrl } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET photo_url = $1 WHERE id = $2
       RETURNING id, photo_url AS "photoUrl"`,
      [photoUrl || null, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update photo' });
  }
});

router.patch('/sysadmin/users/:id', requireSysAdmin, async (req, res) => {
  const { name, email, role, department, departments, position, phone, isActive } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET
         name        = COALESCE($1, name),
         email       = COALESCE($2, email),
         role        = COALESCE($3, role),
         department  = COALESCE($4, department),
         departments = COALESCE($5, departments),
         position    = COALESCE($6, position),
         phone       = COALESCE($7, phone),
         is_active   = COALESCE($8, is_active)
       WHERE id = $9
       RETURNING id, email, name, role, department, departments, position, avatar, phone, is_active AS "isActive"`,
      [name||null, email||null, role||null, department||null,
       departments||null, position||null, phone||null,
       isActive !== undefined ? isActive : null, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

export default router;
