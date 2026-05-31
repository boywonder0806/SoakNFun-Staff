import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, name, role, department, departments,
              position, avatar, phone, hire_date AS "hireDate", is_active AS "isActive",
              force_password_reset AS "mustChangePassword", is_locked AS "isLocked",
              COALESCE(has_reception_access, FALSE) AS "hasReceptionAccess"
       FROM employees WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
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
       RETURNING id, email, name, role, department, departments, position, avatar, phone`,
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

export default router;
