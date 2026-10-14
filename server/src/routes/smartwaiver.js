import { Router } from 'express';
import { requireAnalytics } from '../middleware/auth.js';
import { swQuery } from '../db/smartwaiver.js';
import { getStatus, isConfigured, ensureSchema } from '../services/smartwaiver.js';

/**
 * Read-only views over the `smartwaiver` schema.
 * Mounted at /api/smartwaiver; analytics-dashboard access required.
 */
const router = Router();
router.use(requireAnalytics);

router.use((req, res, next) => {
  if (!isConfigured()) return res.status(503).json({ error: 'Smartwaiver sync is not configured on this server' });
  next();
});

// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD on createdOn (UTC dates).
function rangeClause(q, params) {
  const where = [];
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) { params.push(q.from); where.push(`created_on >= $${params.length}::date`); }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) { params.push(q.to); where.push(`created_on < ($${params.length}::date + 1)`); }
  if (q.templateId) { params.push(String(q.templateId)); where.push(`template_id = $${params.length}`); }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

router.get('/status', async (req, res) => {
  try { res.json(await getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/summary', async (req, res) => {
  try {
    await ensureSchema();
    const params = [];
    const where = rangeClause(req.query, params);
    const [totals, months, templates] = await Promise.all([
      swQuery(`SELECT COUNT(*)::int AS waivers, COALESCE(SUM(participant_count),0)::int AS participants,
                      COUNT(DISTINCT address_zip5)::int AS zips, COUNT(*) FILTER (WHERE marketing_allowed)::int AS marketing_opt_in
               FROM smartwaiver.waivers ${where}`, params),
      swQuery(`SELECT to_char(created_on AT TIME ZONE 'America/Chicago', 'YYYY-MM') AS month, COUNT(*)::int AS waivers
               FROM smartwaiver.waivers ${where} GROUP BY 1 ORDER BY 1`, params),
      swQuery(`SELECT template_id, title, COUNT(*)::int AS waivers FROM smartwaiver.waivers ${where} GROUP BY 1, 2 ORDER BY 3 DESC`, params),
    ]);
    res.json({ totals: totals.rows[0], byMonth: months.rows, byTemplate: templates.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/zips', async (req, res) => {
  try {
    await ensureSchema();
    const params = [];
    const where = rangeClause(req.query, params);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 10000);
    params.push(limit);
    const { rows } = await swQuery(
      `SELECT address_zip5 AS zip, COUNT(*)::int AS waivers,
              MODE() WITHIN GROUP (ORDER BY upper(address_state)) AS state,
              MODE() WITHIN GROUP (ORDER BY initcap(address_city)) AS city
       FROM smartwaiver.waivers ${where ? `${where} AND` : 'WHERE'} address_zip5 IS NOT NULL
       GROUP BY address_zip5 ORDER BY waivers DESC, zip LIMIT $${params.length}`, params);
    res.json({ zips: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/states', async (req, res) => {
  try {
    await ensureSchema();
    const params = [];
    const where = rangeClause(req.query, params);
    const { rows } = await swQuery(
      `SELECT COALESCE(NULLIF(upper(address_state), ''), '?') AS state, COUNT(*)::int AS waivers
       FROM smartwaiver.waivers ${where} GROUP BY 1 ORDER BY 2 DESC`, params);
    res.json({ states: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
