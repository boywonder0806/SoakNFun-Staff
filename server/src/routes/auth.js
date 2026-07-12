import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../services/email.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

pool.query(
  'ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_reception_access BOOLEAN NOT NULL DEFAULT FALSE'
).catch(e => console.error('auth migration (has_reception_access):', e.message));
pool.query(
  'ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_hr_access BOOLEAN NOT NULL DEFAULT FALSE'
).catch(e => console.error('auth migration (has_hr_access):', e.message));
pool.query(
  'ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_hr_manager BOOLEAN NOT NULL DEFAULT FALSE'
).catch(e => console.error('auth migration (is_hr_manager):', e.message));
// BayouBot access used to piggyback on HR access — give it its own flag,
// seeding existing HR users so nobody loses access. The NULL-check makes the
// backfill one-time: after it runs, new rows get the FALSE default.
// Staff portal is in early development — access is opt-in. Seed sysadmins so
// they can grant others from the Admin Console; everyone else defaults off.
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_staff_access BOOLEAN')
  .then(() => pool.query(`UPDATE employees SET has_staff_access = (role = 'sysadmin') WHERE has_staff_access IS NULL`))
  .then(() => pool.query('ALTER TABLE employees ALTER COLUMN has_staff_access SET DEFAULT FALSE'))
  .catch(e => console.error('auth migration (has_staff_access):', e.message));
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_bot_access BOOLEAN')
  .then(() => pool.query(`UPDATE employees SET has_bot_access = COALESCE(has_hr_access, FALSE) WHERE has_bot_access IS NULL`))
  .then(() => pool.query('ALTER TABLE employees ALTER COLUMN has_bot_access SET DEFAULT FALSE'))
  .catch(e => console.error('auth migration (has_bot_access):', e.message));
pool.query(
  'ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_tickets_access BOOLEAN NOT NULL DEFAULT FALSE'
).catch(e => console.error('auth migration (has_tickets_access):', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('password_reset_tokens migration:', e.message));

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    let rows;
    try {
      ({ rows } = await pool.query(
        `SELECT id, email, password_hash, name, role, department, departments,
                position, avatar, phone, hire_date AS "hireDate", is_active AS "isActive",
                force_password_reset AS "mustChangePassword", is_locked AS "isLocked",
                COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess",
                COALESCE(is_reception_manager, FALSE) AS "isReceptionManager",
                COALESCE(has_hr_access, FALSE) AS "hasHrAccess",
                COALESCE(is_hr_manager, FALSE) AS "isHrManager",
                COALESCE(has_bot_access, FALSE) AS "hasBotAccess",
                COALESCE(has_tickets_access, FALSE) AS "hasTicketsAccess",
                COALESCE(has_staff_access, FALSE) AS "hasStaffAccess"
         FROM employees WHERE email = $1`,
        [email.toLowerCase().trim()]
      ));
    } catch (colErr) {
      // Column doesn't exist yet — fall back to query without it
      if (colErr.code === '42703') {
        ({ rows } = await pool.query(
          `SELECT id, email, password_hash, name, role, department, departments,
                  position, avatar, phone, hire_date AS "hireDate", is_active AS "isActive",
                  force_password_reset AS "mustChangePassword", is_locked AS "isLocked"
           FROM employees WHERE email = $1`,
          [email.toLowerCase().trim()]
        ));
        if (rows[0]) {
          rows[0].hasReceptionAccess = false;
          rows[0].hasHrAccess = false;
          rows[0].isHrManager = false;
          rows[0].hasBotAccess = false;
          rows[0].hasTicketsAccess = false;
          rows[0].hasStaffAccess = false;
        }
      } else {
        throw colErr;
      }
    }

    const user = rows[0];
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.isLocked) {
      return res.status(403).json({ error: 'This account has been locked. Please contact your administrator.' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const { password_hash, isActive, ...safeUser } = user;
    const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: '8h' });
    pool.query(
      `INSERT INTO activity_logs (employee_id, event, ip_address) VALUES ($1, 'Login', $2)`,
      [user.id, req.ip || null]
    ).catch(() => {});
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  pool.query(
    `INSERT INTO activity_logs (employee_id, event, ip_address) VALUES ($1, 'Logout', $2)`,
    [req.user.id, req.ip || null]
  ).catch(() => {});
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const { iat, exp, ...user } = req.user;
  res.json({ user });
});

// POST /api/auth/change-password — for forced reset on first login
router.post('/change-password', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `UPDATE employees SET password_hash = $1, force_password_reset = FALSE
       WHERE id = $2
       RETURNING id, email, name, role, department, departments, position, avatar, phone,
                 is_locked AS "isLocked",
                 COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess",
                 COALESCE(has_hr_access, FALSE) AS "hasHrAccess",
                 COALESCE(is_hr_manager, FALSE) AS "isHrManager",
                 COALESCE(has_bot_access, FALSE) AS "hasBotAccess",
                 COALESCE(has_tickets_access, FALSE) AS "hasTicketsAccess",
                 COALESCE(has_staff_access, FALSE) AS "hasStaffAccess"`,
      [hash, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const updatedUser = { ...rows[0], mustChangePassword: false };
    const token = jwt.sign(updatedUser, JWT_SECRET, { expiresIn: '8h' });
    pool.query(
      `INSERT INTO activity_logs (employee_id, event, actor_id, ip_address) VALUES ($1, 'Password changed', $1, $2)`,
      [req.user.id, req.ip || null]
    ).catch(() => {});
    res.json({ token, user: updatedUser });
  } catch (err) {
    console.error('Change password error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  // Always return 200 to prevent email enumeration
  res.json({ ok: true });
  if (!email?.trim()) return;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email FROM employees WHERE LOWER(email) = LOWER($1) AND is_active = TRUE`,
      [email.trim()]
    );
    if (!rows[0]) return;
    const token     = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query(
      `INSERT INTO password_reset_tokens (employee_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [rows[0].id, tokenHash]
    );
    await sendPasswordResetEmail({ toEmail: rows[0].email, toName: rows[0].name, resetToken: token });
  } catch (err) {
    console.error('Forgot password error:', err.message);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 6) {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const { rows } = await pool.query(
      `SELECT prt.id, prt.employee_id
       FROM password_reset_tokens prt
       WHERE prt.token_hash = $1
         AND prt.expires_at > NOW()
         AND prt.used_at IS NULL`,
      [tokenHash]
    );
    if (!rows[0]) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE employees SET password_hash = $1, force_password_reset = FALSE WHERE id = $2`,
      [hash, rows[0].employee_id]
    );
    await pool.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [rows[0].id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

export default router;
