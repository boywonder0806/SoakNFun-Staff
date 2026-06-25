import jwt from 'jsonwebtoken';
import pool from '../db/index.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'manager' && req.user.role !== 'sysadmin') {
      return res.status(403).json({ error: 'Manager access required' });
    }
    next();
  });
}

export function requireSysAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'sysadmin') {
      return res.status(403).json({ error: 'System administrator access required' });
    }
    next();
  });
}

export function requireReception(req, res, next) {
  requireAuth(req, res, async () => {
    if (!req.user.hasReceptionAccess) {
      return res.status(403).json({ error: 'Reception portal access required' });
    }
    try {
      const { rows } = await pool.query(
        'SELECT is_active, has_reception_access FROM employees WHERE id = $1',
        [req.user.id]
      );
      const emp = rows[0];
      if (!emp || !emp.is_active) {
        return res.status(401).json({ error: 'Your account has been deactivated. Please contact your administrator.' });
      }
      if (!emp.has_reception_access) {
        return res.status(403).json({ error: 'Your reception portal access has been revoked. Please contact your administrator.' });
      }
      next();
    } catch {
      res.status(500).json({ error: 'Failed to verify account status' });
    }
  });
}

export function requireHR(req, res, next) {
  requireAuth(req, res, async () => {
    if (!req.user.hasHrAccess) {
      return res.status(403).json({ error: 'HR portal access required' });
    }
    try {
      const { rows } = await pool.query(
        'SELECT is_active, has_hr_access FROM employees WHERE id = $1',
        [req.user.id]
      );
      const emp = rows[0];
      if (!emp || !emp.is_active) {
        return res.status(401).json({ error: 'Your account has been deactivated. Please contact your administrator.' });
      }
      if (!emp.has_hr_access) {
        return res.status(403).json({ error: 'Your HR portal access has been revoked. Please contact your administrator.' });
      }
      next();
    } catch {
      res.status(500).json({ error: 'Failed to verify account status' });
    }
  });
}

export function requireHRManager(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      const { rows } = await pool.query(
        'SELECT is_active, has_hr_access, is_hr_manager FROM employees WHERE id = $1',
        [req.user.id]
      );
      const emp = rows[0];
      if (!emp || !emp.is_active) {
        return res.status(401).json({ error: 'Your account has been deactivated.' });
      }
      if (!emp.has_hr_access) {
        return res.status(403).json({ error: 'HR portal access required.' });
      }
      if (!emp.is_hr_manager) {
        return res.status(403).json({ error: 'HR Manager access required.' });
      }
      next();
    } catch {
      res.status(500).json({ error: 'Failed to verify account status' });
    }
  });
}

export function requireManagement(req, res, next) {
  requireAuth(req, res, () => {
    const depts = req.user.departments ?? [];
    if (req.user.role === 'sysadmin' || depts.includes('Management')) {
      next();
    } else {
      res.status(403).json({ error: 'Management department access required' });
    }
  });
}

export function requireReceptionManager(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      const { rows } = await pool.query(
        'SELECT is_active, has_reception_access, is_reception_manager FROM employees WHERE id = $1',
        [req.user.id]
      );
      const emp = rows[0];
      if (!emp || !emp.is_active) {
        return res.status(401).json({ error: 'Your account has been deactivated.' });
      }
      if (!emp.has_reception_access) {
        return res.status(403).json({ error: 'Reception portal access required.' });
      }
      if (!emp.is_reception_manager) {
        return res.status(403).json({ error: 'Reception Manager access required.' });
      }
      next();
    } catch {
      res.status(500).json({ error: 'Failed to verify account status' });
    }
  });
}
