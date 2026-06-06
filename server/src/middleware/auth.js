import jwt from 'jsonwebtoken';

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
  requireAuth(req, res, () => {
    if (!req.user.hasReceptionAccess) {
      return res.status(403).json({ error: 'Reception portal access required' });
    }
    next();
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
