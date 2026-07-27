import { Router } from 'express';
import pool from '../db/index.js';
import { requireAnalytics } from '../middleware/auth.js';
import { getSyncStatus } from '../services/analyticsOrders.js';

const router = Router();
router.use(requireAnalytics);

// Every route reads from analytics_orders/analytics_order_line_items —
// never live RocketRez. Data freshness is whatever the sync cron last wrote
// (see /sync-status); see analyticsOrderSync.js for the tiered schedule.

function dateRange(req) {
  const end   = req.query.endDate   || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const start = req.query.startDate || new Date(new Date(end).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  return { start, end };
}

function parkFilter(req, params) {
  const park = (req.query.park || '').toUpperCase();
  if (park === 'BB' || park === 'GI') {
    params.push(park);
    return ` AND park = $${params.length}`;
  }
  return '';
}

// GET /api/analytics/overview
router.get('/overview', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const parkSql = parkFilter(req, params);
    const { rows: [row] } = await pool.query(
      `SELECT
         COUNT(*)::int                                   AS "orderCount",
         COALESCE(SUM(total), 0)::float                  AS "revenue",
         COALESCE(SUM(discount_total), 0)::float          AS "discountTotal",
         COALESCE(SUM(tax_total), 0)::float                AS "taxTotal",
         COALESCE(AVG(total), 0)::float                    AS "avgOrderValue",
         COUNT(*) FILTER (WHERE is_web_order)::int          AS "webOrderCount",
         COUNT(*) FILTER (WHERE NOT is_web_order)::int      AS "inPersonOrderCount"
       FROM analytics_orders
       WHERE status = 'Active' AND business_date BETWEEN $1 AND $2${parkSql}`,
      params
    );
    res.json(row);
  } catch (err) {
    console.error('analytics overview error:', err.message);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// GET /api/analytics/revenue-trend?granularity=day|week|month
router.get('/revenue-trend', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const granularity = ['day', 'week', 'month'].includes(req.query.granularity) ? req.query.granularity : 'day';
    const bucket = granularity === 'day' ? 'business_date' : `date_trunc('${granularity}', business_date)`;
    const params = [start, end];
    const parkSql = parkFilter(req, params);
    const { rows } = await pool.query(
      `SELECT ${bucket}::date::text                      AS "bucket",
              COUNT(*)::int                               AS "orderCount",
              COALESCE(SUM(total), 0)::float               AS "revenue"
       FROM analytics_orders
       WHERE status = 'Active' AND business_date BETWEEN $1 AND $2${parkSql}
       GROUP BY 1 ORDER BY 1`,
      params
    );
    res.json({ rows });
  } catch (err) {
    console.error('analytics revenue-trend error:', err.message);
    res.status(500).json({ error: 'Failed to load revenue trend' });
  }
});

// GET /api/analytics/products
router.get('/products', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    let parkSql = '';
    const park = (req.query.park || '').toUpperCase();
    if (park === 'BB' || park === 'GI') {
      params.push(park);
      parkSql = ` AND o.park = $${params.length}`;
    }
    let officeSql = '';
    if (req.query.office) {
      params.push(req.query.office);
      officeSql = ` AND li.sales_office_name = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT li.name                                    AS "name",
              SUM(li.quantity)::int                        AS "quantity",
              COALESCE(SUM(li.subtotal), 0)::float          AS "revenue"
       FROM analytics_order_line_items li
       JOIN analytics_orders o ON o.order_id = li.order_id
       WHERE o.status = 'Active' AND o.business_date BETWEEN $1 AND $2
             AND li.name IS NOT NULL${parkSql}${officeSql}
       GROUP BY li.name
       ORDER BY "revenue" DESC
       LIMIT 50`,
      params
    );
    res.json({ rows });
  } catch (err) {
    console.error('analytics products error:', err.message);
    res.status(500).json({ error: 'Failed to load product mix' });
  }
});

// GET /api/analytics/offices
router.get('/offices', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const parkSql = parkFilter(req, params);
    const { rows } = await pool.query(
      `SELECT sales_office_name                           AS "office",
              park                                          AS "park",
              COUNT(*)::int                                 AS "orderCount",
              COALESCE(SUM(total), 0)::float                 AS "revenue"
       FROM analytics_orders
       WHERE status = 'Active' AND business_date BETWEEN $1 AND $2
             AND sales_office_name IS NOT NULL${parkSql}
       GROUP BY sales_office_name, park
       ORDER BY "revenue" DESC`,
      params
    );
    res.json({ rows });
  } catch (err) {
    console.error('analytics offices error:', err.message);
    res.status(500).json({ error: 'Failed to load office breakdown' });
  }
});

// GET /api/analytics/payment-methods
router.get('/payment-methods', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const parkSql = parkFilter(req, params);
    const { rows } = await pool.query(
      `SELECT pm->>'paymentMethod'                        AS "method",
              COALESCE(SUM((pm->>'paymentAmount')::numeric), 0)::float AS "amount"
       FROM analytics_orders o, jsonb_array_elements(o.payment_methods) pm
       WHERE o.status = 'Active' AND o.business_date BETWEEN $1 AND $2${parkSql}
       GROUP BY 1
       ORDER BY "amount" DESC`,
      params
    );
    res.json({ rows });
  } catch (err) {
    console.error('analytics payment-methods error:', err.message);
    res.status(500).json({ error: 'Failed to load payment method breakdown' });
  }
});

// GET /api/analytics/sync-status
router.get('/sync-status', async (_req, res) => {
  try {
    res.json(await getSyncStatus());
  } catch (err) {
    console.error('analytics sync-status error:', err.message);
    res.status(500).json({ error: 'Failed to load sync status' });
  }
});

export default router;
