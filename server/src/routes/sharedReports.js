import { Router } from 'express';
import { requireAnalytics } from '../middleware/auth.js';
import { createSharedReport, listSharedReports, setRevoked, deleteSharedReport } from '../services/sharedReports.js';

const router = Router();
router.use(requireAnalytics);

function publicUrl(req, token) {
  // Shared links are always handed out on the analytics domain regardless of
  // which host issued the request, so they read naturally to whoever gets them.
  const host = process.env.NODE_ENV === 'production' ? 'analytics.bluebayoustaff.com' : req.get('host');
  const proto = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
  return `${proto}://${host}/shared/${token}`;
}

// POST /api/analytics/shared-reports — publish a new report
router.post('/', async (req, res) => {
  try {
    const { title, html, expiresInDays } = req.body || {};
    if (!title || !html) return res.status(400).json({ error: 'title and html are required' });
    const createdBy = req.user?.name || [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ') || req.user?.id || null;
    const { token, expiresAt } = await createSharedReport({ title, html, createdBy, expiresInDays });
    res.json({ token, url: publicUrl(req, token), expiresAt });
  } catch (err) {
    console.error('shared-reports create error:', err.message);
    res.status(500).json({ error: 'Failed to create shared report' });
  }
});

// GET /api/analytics/shared-reports — list for the management page
router.get('/', async (req, res) => {
  try {
    const rows = await listSharedReports();
    res.json(rows.map(r => ({ ...r, url: publicUrl(req, r.token) })));
  } catch (err) {
    console.error('shared-reports list error:', err.message);
    res.status(500).json({ error: 'Failed to load shared reports' });
  }
});

// PATCH /api/analytics/shared-reports/:token/revoke — toggle revoked
router.patch('/:token/revoke', async (req, res) => {
  try {
    const revoked = req.body?.revoked !== false; // default true
    const ok = await setRevoked(req.params.token, revoked);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ revoked });
  } catch (err) {
    console.error('shared-reports revoke error:', err.message);
    res.status(500).json({ error: 'Failed to update shared report' });
  }
});

// DELETE /api/analytics/shared-reports/:token
router.delete('/:token', async (req, res) => {
  try {
    const ok = await deleteSharedReport(req.params.token);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('shared-reports delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete shared report' });
  }
});

export default router;
