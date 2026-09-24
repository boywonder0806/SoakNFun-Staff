import { Router } from 'express';
import { requireAnalytics } from '../middleware/auth.js';
import { createSharedReport, listSharedReports, updateSharedReport, setRevoked, deleteSharedReport, setSharedReportPin, getSharedReport, listRecipients, addRecipient, getRecipient, regenerateRecipientPin, setRecipientRevoked, deleteRecipient, markRecipientEmailed, listViews } from '../services/sharedReports.js';
import { sendSharedReportInvite } from '../services/email.js';

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

// PUT /api/analytics/shared-reports/:token — republish corrected content to the same link
router.put('/:token', async (req, res) => {
  try {
    const { title, html } = req.body || {};
    if (!title && !html) return res.status(400).json({ error: 'title or html required' });
    const ok = await updateSharedReport(req.params.token, { title, html });
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ url: publicUrl(req, req.params.token) });
  } catch (err) {
    console.error('shared-reports update error:', err.message);
    res.status(500).json({ error: 'Failed to update shared report' });
  }
});

// PATCH /api/analytics/shared-reports/:token/pin — set a PIN ({ pin: "7593" }) or clear it ({ pin: null })
router.patch('/:token/pin', async (req, res) => {
  try {
    const pin = req.body?.pin;
    if (pin != null && !/^\d{4,8}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be 4–8 digits' });
    const ok = await setSharedReportPin(req.params.token, pin ? String(pin) : null);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ hasPin: !!pin });
  } catch (err) {
    console.error('shared-reports pin error:', err.message);
    res.status(500).json({ error: 'Failed to update PIN' });
  }
});

// ── Per-person access ────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const actor = (req) => req.user?.name || [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ') || null;
const publicRecipient = (r) => ({ id: r.id, email: r.email, name: r.name, pin: r.pin, revoked: r.revoked, created_at: r.created_at, created_by: r.created_by, last_emailed_at: r.last_emailed_at, view_count: r.view_count, first_viewed_at: r.first_viewed_at, last_viewed_at: r.last_viewed_at });

async function emailInvite(req, report, recipient) {
  const ok = await sendSharedReportInvite({ toEmail: recipient.email, toName: recipient.name, reportTitle: report.title, url: publicUrl(req, report.token), pin: recipient.pin, invitedBy: actor(req), triggeredBy: actor(req) });
  if (ok) await markRecipientEmailed(recipient.id);
  return ok;
}

// GET /:token/recipients — people with access + recent activity
router.get('/:token/recipients', async (req, res) => {
  try {
    const report = await getSharedReport(req.params.token);
    if (!report) return res.status(404).json({ error: 'Not found' });
    const [recipients, views] = await Promise.all([listRecipients(report.token), listViews(report.token, 200)]);
    res.json({ recipients: recipients.map(publicRecipient), views, hasGeneralPin: !!report.pin_hash });
  } catch (err) {
    console.error('shared-reports recipients error:', err.message);
    res.status(500).json({ error: 'Failed to load recipients' });
  }
});

// POST /:token/recipients { email, name, sendEmail } — grant a person access with their own PIN
router.post('/:token/recipients', async (req, res) => {
  try {
    const report = await getSharedReport(req.params.token);
    if (!report) return res.status(404).json({ error: 'Not found' });
    const { email, name, sendEmail = true } = req.body || {};
    if (!email || !EMAIL_RE.test(String(email).trim())) return res.status(400).json({ error: 'A valid email address is required' });
    const recipient = await addRecipient({ token: report.token, email: String(email), name, createdBy: actor(req) });
    if (!recipient) return res.status(409).json({ error: 'That email already has access to this report' });
    const emailed = sendEmail ? await emailInvite(req, report, recipient) : false;
    res.json({ recipient: publicRecipient({ ...recipient, last_emailed_at: emailed ? new Date() : null }), emailed });
  } catch (err) {
    console.error('shared-reports add recipient error:', err.message);
    res.status(500).json({ error: 'Failed to add recipient' });
  }
});

// POST /:token/recipients/:id/resend — email the current PIN again
router.post('/:token/recipients/:id/resend', async (req, res) => {
  try {
    const report = await getSharedReport(req.params.token);
    const recipient = report && await getRecipient(report.token, Number(req.params.id));
    if (!recipient) return res.status(404).json({ error: 'Not found' });
    const emailed = await emailInvite(req, report, recipient);
    res.json({ emailed });
  } catch (err) {
    console.error('shared-reports resend error:', err.message);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// POST /:token/recipients/:id/regenerate { sendEmail } — new PIN (invalidates their current unlock)
router.post('/:token/recipients/:id/regenerate', async (req, res) => {
  try {
    const report = await getSharedReport(req.params.token);
    if (!report) return res.status(404).json({ error: 'Not found' });
    const recipient = await regenerateRecipientPin(report.token, Number(req.params.id));
    if (!recipient) return res.status(404).json({ error: 'Not found' });
    const emailed = req.body?.sendEmail === false ? false : await emailInvite(req, report, recipient);
    res.json({ recipient: publicRecipient(recipient), emailed });
  } catch (err) {
    console.error('shared-reports regenerate error:', err.message);
    res.status(500).json({ error: 'Failed to regenerate PIN' });
  }
});

// PATCH /:token/recipients/:id { revoked }
router.patch('/:token/recipients/:id', async (req, res) => {
  try {
    const ok = await setRecipientRevoked(req.params.token, Number(req.params.id), req.body?.revoked !== false);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ revoked: req.body?.revoked !== false });
  } catch (err) {
    console.error('shared-reports recipient revoke error:', err.message);
    res.status(500).json({ error: 'Failed to update recipient' });
  }
});

// DELETE /:token/recipients/:id
router.delete('/:token/recipients/:id', async (req, res) => {
  try {
    const ok = await deleteRecipient(req.params.token, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('shared-reports recipient delete error:', err.message);
    res.status(500).json({ error: 'Failed to remove recipient' });
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
