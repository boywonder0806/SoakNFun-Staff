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

// GET /api/analytics/revenue-trend?granularity=hour|day|week|month
// "hour" buckets by order timestamp (Central) — meant for single-day views.
router.get('/revenue-trend', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const granularity = ['hour', 'day', 'week', 'month'].includes(req.query.granularity) ? req.query.granularity : 'day';
    const params = [start, end];
    const parkSql = parkFilter(req, params);

    if (granularity === 'hour') {
      const { rows } = await pool.query(
        `SELECT to_char(date_trunc('hour', created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM') AS "bucket",
                COUNT(*)::int                                                                          AS "orderCount",
                COALESCE(SUM(total), 0)::float                                                          AS "revenue"
         FROM analytics_orders
         WHERE status = 'Active' AND business_date BETWEEN $1 AND $2${parkSql}
         GROUP BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')
         ORDER BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')`,
        params
      );
      return res.json({ rows, granularity });
    }

    const bucket = granularity === 'day' ? 'business_date' : `date_trunc('${granularity}', business_date)`;
    const { rows } = await pool.query(
      `SELECT ${bucket}::date::text                      AS "bucket",
              COUNT(*)::int                               AS "orderCount",
              COALESCE(SUM(total), 0)::float               AS "revenue"
       FROM analytics_orders
       WHERE status = 'Active' AND business_date BETWEEN $1 AND $2${parkSql}
       GROUP BY 1 ORDER BY 1`,
      params
    );
    res.json({ rows, granularity });
  } catch (err) {
    console.error('analytics revenue-trend error:', err.message);
    res.status(500).json({ error: 'Failed to load revenue trend' });
  }
});

// GET /api/analytics/daily — the waterpark daily report: attendance &
// ticketing, in-park spend, and per-cap, for the requested range.
//
// Attendance is counted from gate-entry line items (type = 'Rate'):
// paid General Admission, season-pass redemptions, employee passes, and
// comp/promo redemptions (Sunshine Ticket, Bring A Friend). Pass SALES are
// type = 'Membership' and are revenue, not attendance. RevPAC and
// labor-cost KPIs were deliberately left out — no park-capacity or wage
// data exists in any connected system.
router.get('/daily', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    let parkSql = '';
    const park = (req.query.park || '').toUpperCase();
    if (park === 'BB' || park === 'GI') {
      params.push(park);
      parkSql = ` AND o.park = $${params.length}`;
    }
    const baseJoin = `
      FROM analytics_order_line_items li
      JOIN analytics_orders o ON o.order_id = li.order_id
      WHERE o.status = 'Active' AND o.business_date BETWEEN $1 AND $2${parkSql}`;

    const [attendance, gaByRate, channel, passSales, inPark] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%General Admission Rate%'), 0)::int          AS "paid",
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%Season Pass Redemption%'), 0)::int           AS "passholders",
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%Employee Pass Redemption%'), 0)::int          AS "employees",
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%Sunshine Ticket%'
                                          OR li.name ILIKE '%Bring A Friend%'), 0)::int                          AS "comps"
         ${baseJoin}
           AND li.type = 'Rate'
           AND (li.name ILIKE '%General Admission Rate%' OR li.name ILIKE '%Park Admission%'
                OR li.name ILIKE '%Sunshine Ticket%' OR li.name ILIKE '%Bring A Friend%')`,
        params
      ),
      pool.query(
        `SELECT li.rate_type                        AS "rateType",
                SUM(li.quantity)::int                AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float  AS "revenue"
         ${baseJoin} AND li.type = 'Rate' AND li.name ILIKE '%General Admission Rate%'
         GROUP BY li.rate_type ORDER BY "revenue" DESC`,
        params
      ),
      pool.query(
        `SELECT o.is_web_order                       AS "isWebOrder",
                SUM(li.quantity)::int                 AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float   AS "revenue"
         ${baseJoin} AND li.type = 'Rate' AND li.name ILIKE '%General Admission Rate%'
         GROUP BY o.is_web_order`,
        params
      ),
      pool.query(
        `SELECT li.name                               AS "name",
                SUM(li.quantity)::int                  AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float    AS "revenue"
         ${baseJoin} AND li.type = 'Membership'
         GROUP BY li.name ORDER BY "revenue" DESC`,
        params
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(li.subtotal) FILTER (WHERE li.sales_office_name ILIKE '%Food & Beverage%'), 0)::float AS "fnb",
           COALESCE(SUM(li.subtotal) FILTER (WHERE li.sales_office_name ILIKE '%Locker%'
                                          OR li.sales_office_name ILIKE '%Cabana%'), 0)::float                AS "rentals",
           COALESCE(SUM(li.subtotal) FILTER (WHERE li.sales_office_name ILIKE '%Gift Shop%'), 0)::float        AS "merch"
         ${baseJoin}`,
        params
      ),
    ]);

    const att = attendance.rows[0];
    const totalAttendance = att.paid + att.passholders + att.employees + att.comps;
    const ip = inPark.rows[0];
    const inParkTotal = ip.fnb + ip.rentals + ip.merch;
    const gaRevenue = gaByRate.rows.reduce((s, r) => s + r.revenue, 0);
    const passSalesTotal = passSales.rows.reduce((s, r) => ({ quantity: s.quantity + r.quantity, revenue: s.revenue + r.revenue }), { quantity: 0, revenue: 0 });
    const web  = channel.rows.find(r => r.isWebOrder)  || { quantity: 0, revenue: 0 };
    const gate = channel.rows.find(r => !r.isWebOrder) || { quantity: 0, revenue: 0 };

    res.json({
      attendance: { total: totalAttendance, ...att,
                    passholderShare: totalAttendance ? att.passholders / totalAttendance : 0 },
      admissions: { revenue: gaRevenue, byRateType: gaByRate.rows,
                    channels: { online: { quantity: web.quantity, revenue: web.revenue },
                                gate:   { quantity: gate.quantity, revenue: gate.revenue } } },
      passSales:  { ...passSalesTotal, byProduct: passSales.rows },
      inPark:     { total: inParkTotal, ...ip,
                    perCap: totalAttendance ? inParkTotal / totalAttendance : 0 },
    });
  } catch (err) {
    console.error('analytics daily error:', err.message);
    res.status(500).json({ error: 'Failed to load daily report' });
  }
});

// GET /api/analytics/weather — current conditions + today's high/precip at
// the park (Tomorrow.io), cached 10 minutes so dashboard refreshes don't
// burn the API quota.
let weatherCache = { data: null, fetchedAt: 0 };
router.get('/weather', async (_req, res) => {
  try {
    if (weatherCache.data && Date.now() - weatherCache.fetchedAt < 10 * 60 * 1000) {
      return res.json(weatherCache.data);
    }
    const loc = encodeURIComponent(`${process.env.TOMORROW_LOCATION} US`);
    const key = process.env.TOMORROW_API_KEY;
    const [nowRes, fcRes] = await Promise.all([
      fetch(`https://api.tomorrow.io/v4/weather/realtime?location=${loc}&apikey=${key}&units=imperial`),
      fetch(`https://api.tomorrow.io/v4/weather/forecast?location=${loc}&apikey=${key}&units=imperial&timesteps=1d`),
    ]);
    if (!nowRes.ok) throw new Error(`Tomorrow.io realtime: ${nowRes.status}`);
    const now = (await nowRes.json()).data.values;
    let today = null;
    if (fcRes.ok) {
      const fc = await fcRes.json();
      const d = fc.timelines?.daily?.[0]?.values;
      if (d) today = { high: d.temperatureMax, low: d.temperatureMin, precipChance: d.precipitationProbabilityMax };
    }
    const data = {
      temperature: now.temperature,
      feelsLike: now.temperatureApparent,
      humidity: now.humidity,
      precipChance: now.precipitationProbability,
      uvIndex: now.uvIndex,
      windSpeed: now.windSpeed,
      weatherCode: now.weatherCode,
      today,
      fetchedAt: new Date().toISOString(),
    };
    weatherCache = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (err) {
    console.error('analytics weather error:', err.message);
    res.status(500).json({ error: 'Failed to load weather' });
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
