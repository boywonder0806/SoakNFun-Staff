/**
 * Automations tab — registry + execution history for server-side cron jobs
 * and integrations (see services/automations.js for the schema/tracking
 * mechanics). Sysadmin-only, same as the rest of /api/admin.
 */
import { Router } from 'express';
import pool from '../db/index.js';
import { requireSysAdmin } from '../middleware/auth.js';
import { runTracked } from '../services/automations.js';
import { syncCrewLineToProtect } from '../services/protectPos.js';
import { syncRange, syncTrailingDays as syncAnalyticsTrailingDays } from '../services/analyticsOrders.js';
import { syncTrailingDays as syncCrewTrailingDays } from '../services/crewOrders.js';
import { centralToday } from '../services/rocketrez.js';
import { runCallbackDigestNow } from '../cron/callbackDigest.js';

const router = Router();
router.use(requireSysAdmin);

const CATEGORIES = new Set(['sync', 'integration', 'notification', 'other']);

// A managed job is "stale" once it's gone this long past its own expected
// interval without a fresh run — 2x the interval plus a flat 30-min buffer,
// so ordinary scheduling jitter doesn't false-positive, while a genuinely
// stuck job still gets flagged well before a human would notice on their own.
function staleAfterMinutes(expectedIntervalMinutes) {
  return expectedIntervalMinutes ? expectedIntervalMinutes * 2 + 30 : null;
}

function computeHealth(row) {
  if (!row.isActive) return 'inactive';
  if (row.source === 'manual') return 'manual';
  if (!row.lastStatus) return 'unknown';
  if (row.lastStatus === 'error') return 'error';
  const staleAfter = staleAfterMinutes(row.expectedIntervalMinutes);
  if (staleAfter && row.lastStartedAt) {
    const ageMinutes = (Date.now() - new Date(row.lastStartedAt).getTime()) / 60_000;
    if (ageMinutes > staleAfter) return 'stale';
  }
  return 'healthy';
}

// Runnable on demand from the "Run Now" button — only for jobs where an
// ad hoc run is safe and useful. callback-digest already tracks itself
// (runCallbackDigestNow -> runTracked internally), so it's called directly
// rather than wrapped again here.
const RUNNERS = {
  'analytics-sync-today': () => runTracked('analytics-sync-today', async () => {
    const today = centralToday();
    const written = await syncRange(today, today, 'today');
    return `${written} orders synced (manual run)`;
  }),
  'protect-pos-crewline': () => runTracked('protect-pos-crewline', syncCrewLineToProtect),
  'crew-order-sync': () => runTracked('crew-order-sync', async () => {
    const written = await syncCrewTrailingDays(30, 'manual');
    return `${written} orders synced (manual run)`;
  }),
  'analytics-sync-recent': () => runTracked('analytics-sync-recent', async () => {
    const written = await syncAnalyticsTrailingDays(7, 'manual');
    return `${written} orders synced (manual run)`;
  }),
  'callback-digest': req => runCallbackDigestNow(req.user?.name || 'Admin console'),
};

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'automation';
}

// GET /api/admin/automations
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.key, a.name, a.description, a.category,
             a.schedule_description AS "scheduleDescription",
             a.expected_interval_minutes AS "expectedIntervalMinutes",
             a.source, a.is_active AS "isActive", a.notes,
             a.created_at AS "createdAt", a.updated_at AS "updatedAt",
             lr.status AS "lastStatus", lr.started_at AS "lastStartedAt",
             lr.finished_at AS "lastFinishedAt", lr.duration_ms AS "lastDurationMs",
             lr.summary AS "lastSummary", lr.error AS "lastError",
             COALESCE(stats.total_runs, 0)::int AS "recentRunCount",
             COALESCE(stats.success_runs, 0)::int AS "recentSuccessCount",
             stats.avg_duration_ms AS "avgDurationMs"
      FROM automations a
      LEFT JOIN LATERAL (
        SELECT status, started_at, finished_at, duration_ms, summary, error
        FROM automation_runs r WHERE r.automation_key = a.key
        ORDER BY r.started_at DESC LIMIT 1
      ) lr ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_runs, COUNT(*) FILTER (WHERE status = 'success') AS success_runs,
               AVG(duration_ms) AS avg_duration_ms
        FROM (SELECT * FROM automation_runs r2 WHERE r2.automation_key = a.key
              ORDER BY r2.started_at DESC LIMIT 20) recent
      ) stats ON true
      ORDER BY a.source ASC, a.category, a.name`
    );
    const automations = rows.map(r => ({ ...r, health: computeHealth(r), canRunNow: !!RUNNERS[r.key] }));
    res.json({ automations });
  } catch (err) {
    console.error('admin automations list error:', err.message);
    res.status(500).json({ error: 'Failed to load automations' });
  }
});

// GET /api/admin/automations/:key/runs?limit=50
router.get('/:key/runs', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const { rows } = await pool.query(
      `SELECT id, status, started_at AS "startedAt", finished_at AS "finishedAt",
              duration_ms AS "durationMs", summary, error
       FROM automation_runs WHERE automation_key = $1
       ORDER BY started_at DESC LIMIT $2`,
      [req.params.key, limit]
    );
    res.json({ runs: rows });
  } catch (err) {
    console.error('admin automation runs error:', err.message);
    res.status(500).json({ error: 'Failed to load run history' });
  }
});

// POST /api/admin/automations — manual (documentation-only) entry
router.post('/', async (req, res) => {
  try {
    const { name, description, category, scheduleDescription, notes } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    const cat = CATEGORIES.has(category) ? category : 'other';

    let key = slugify(name);
    const { rows: existing } = await pool.query('SELECT 1 FROM automations WHERE key = $1', [key]);
    if (existing.length) key = `${key}-${Date.now().toString(36)}`;

    const { rows } = await pool.query(
      `INSERT INTO automations (key, name, description, category, schedule_description, source, is_active, notes)
       VALUES ($1, $2, $3, $4, $5, 'manual', TRUE, $6)
       RETURNING key`,
      [key, name.trim(), description || null, cat, scheduleDescription || null, notes || null]
    );
    res.status(201).json({ key: rows[0].key });
  } catch (err) {
    console.error('admin automation create error:', err.message);
    res.status(500).json({ error: 'Failed to create automation' });
  }
});

// PATCH /api/admin/automations/:key
// Managed rows only accept notes/isActive — everything else is reasserted
// from code on the next boot, so editing it here would just be undone.
router.patch('/:key', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT source FROM automations WHERE key = $1', [req.params.key]);
    if (!existing.length) return res.status(404).json({ error: 'Automation not found' });
    const isManual = existing[0].source === 'manual';

    const fields = [];
    const params = [];
    function set(col, value) { params.push(value); fields.push(`${col} = $${params.length}`); }

    if (isManual) {
      const { name, description, category, scheduleDescription } = req.body || {};
      if (name !== undefined) { if (!name?.trim()) return res.status(400).json({ error: 'Name cannot be blank' }); set('name', name.trim()); }
      if (description !== undefined) set('description', description || null);
      if (category !== undefined) set('category', CATEGORIES.has(category) ? category : 'other');
      if (scheduleDescription !== undefined) set('schedule_description', scheduleDescription || null);
    }
    if (req.body?.notes !== undefined) set('notes', req.body.notes || null);
    if (req.body?.isActive !== undefined) set('is_active', !!req.body.isActive);

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.key);
    await pool.query(`UPDATE automations SET ${fields.join(', ')}, updated_at = NOW() WHERE key = $${params.length}`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error('admin automation update error:', err.message);
    res.status(500).json({ error: 'Failed to update automation' });
  }
});

// DELETE /api/admin/automations/:key — manual entries only; a managed one
// would just reappear on the next boot, so deleting it wouldn't do anything.
router.delete('/:key', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT source FROM automations WHERE key = $1', [req.params.key]);
    if (!rows.length) return res.status(404).json({ error: 'Automation not found' });
    if (rows[0].source !== 'manual') {
      return res.status(400).json({ error: 'This automation is defined in code — remove it there, not here' });
    }
    await pool.query('DELETE FROM automations WHERE key = $1', [req.params.key]);
    res.json({ ok: true });
  } catch (err) {
    console.error('admin automation delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete automation' });
  }
});

// POST /api/admin/automations/:key/run — trigger a supported job on demand
router.post('/:key/run', async (req, res) => {
  const runner = RUNNERS[req.params.key];
  if (!runner) return res.status(400).json({ error: 'No manual trigger is available for this automation' });
  try {
    const result = await runner(req);
    res.json({ ok: true, summary: typeof result === 'string' ? result : null });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Run failed' });
  }
});

export default router;
