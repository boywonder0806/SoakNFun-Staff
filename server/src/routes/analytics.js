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
// Attendance is counted the way RocketRez's own attendance report counts
// it: gate-entry line items (type = 'Rate' on the park-admission event)
// matched on the ticket's EVENT (visit) date — not the order's purchase
// date. Advance web sales are bought days before the visit, so purchase
// date under-counts today and over-counts future days. Money metrics
// (in-park spend, pass sales, the revenue KPIs) stay on business_date —
// they answer "what was collected in this range". Pass SALES are
// type = 'Membership' and are revenue, not attendance. Remaining gap vs
// the gate: the Orders API sees bookings, not turnstile scans, so
// booked-but-not-yet-arrived guests are included. RevPAC and labor-cost
// KPIs were deliberately left out — no park-capacity or wage data exists
// in any connected system.
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
    // Visit-date basis for everything attendance-shaped
    const gateJoin = `
      FROM analytics_order_line_items li
      JOIN analytics_orders o ON o.order_id = li.order_id
      WHERE o.status = 'Active' AND li.type = 'Rate'
        AND li.event_name ILIKE '%Admission%'
        AND li.event_date BETWEEN $1 AND $2${parkSql}`;

    const [attendance, attByPark, gaByRate, channel, passSales, inPark, nayax] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(li.quantity), 0)::int                                                                   AS "total",
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%General Admission Rate%'), 0)::int            AS "paid",
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%Season Pass Redemption%'), 0)::int             AS "passholders",
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%Employee Pass Redemption%'), 0)::int            AS "employees",
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%Group%'), 0)::int                               AS "groups",
           COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%Sunshine Ticket%' OR li.name ILIKE '%Bring A Friend%'
                                          OR li.name ILIKE '%Comp Ticket%'), 0)::int                               AS "comps"
         ${gateJoin}`,
        params
      ),
      pool.query(
        `SELECT o.park AS "park", SUM(li.quantity)::int AS "quantity"
         ${gateJoin} AND o.park IS NOT NULL
         GROUP BY o.park ORDER BY o.park`,
        params
      ),
      pool.query(
        `SELECT li.rate_type                        AS "rateType",
                SUM(li.quantity)::int                AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float  AS "revenue"
         ${gateJoin} AND li.name ILIKE '%General Admission Rate%'
         GROUP BY li.rate_type ORDER BY "revenue" DESC`,
        params
      ),
      pool.query(
        `SELECT o.is_web_order                       AS "isWebOrder",
                SUM(li.quantity)::int                 AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float   AS "revenue"
         ${gateJoin} AND li.name ILIKE '%General Admission Rate%'
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
      // Nayax locker totals are keyed into RocketRez manually as a bulk
      // order — until that's done, rentals (and per cap) run low. Compare
      // days the park actually operated (had any sales) against days with
      // a Nayax entry, so multi-day ranges can flag partial coverage.
      pool.query(
        `SELECT o.park AS "park",
                COUNT(DISTINCT o.business_date)::int AS "operatingDays",
                COUNT(DISTINCT o.business_date) FILTER (WHERE o.sales_office_name ILIKE '%Nayax%')::int AS "nayaxDays"
         FROM analytics_orders o
         WHERE o.status = 'Active' AND o.business_date BETWEEN $1 AND $2${parkSql}
           AND o.park IS NOT NULL
         GROUP BY o.park`,
        params
      ),
    ]);

    const att = attendance.rows[0];
    const totalAttendance = att.total;
    // Anything on the admission event that didn't match a bucket pattern —
    // surfaced instead of silently dropped, so new ticket types show up.
    const other = Math.max(0, totalAttendance - (att.paid + att.passholders + att.employees + att.groups + att.comps));
    const ip = inPark.rows[0];
    const inParkTotal = ip.fnb + ip.rentals + ip.merch;
    const gaRevenue = gaByRate.rows.reduce((s, r) => s + r.revenue, 0);
    const passSalesTotal = passSales.rows.reduce((s, r) => ({ quantity: s.quantity + r.quantity, revenue: s.revenue + r.revenue }), { quantity: 0, revenue: 0 });
    const web  = channel.rows.find(r => r.isWebOrder)  || { quantity: 0, revenue: 0 };
    const gate = channel.rows.find(r => !r.isWebOrder) || { quantity: 0, revenue: 0 };
    const lockerStatus = nayax.rows.map(r => ({
      park: r.park,
      operatingDays: r.operatingDays,
      nayaxDays: r.nayaxDays,
      missingDays: Math.max(0, r.operatingDays - r.nayaxDays),
    }));

    res.json({
      attendance: { ...att, other, byPark: attByPark.rows,
                    passholderShare: totalAttendance ? att.passholders / totalAttendance : 0 },
      admissions: { revenue: gaRevenue, byRateType: gaByRate.rows,
                    channels: { online: { quantity: web.quantity, revenue: web.revenue },
                                gate:   { quantity: gate.quantity, revenue: gate.revenue } } },
      passSales:  { ...passSalesTotal, byProduct: passSales.rows },
      inPark:     { total: inParkTotal, ...ip, lockerStatus,
                    perCap: totalAttendance ? inParkTotal / totalAttendance : 0 },
    });
  } catch (err) {
    console.error('analytics daily error:', err.message);
    res.status(500).json({ error: 'Failed to load daily report' });
  }
});

// GET /api/analytics/drinks — the Blue Bayou beverage report. BB-only by
// design (the drink program lives there), so the park filter is ignored.
//
// Products are bucketed by name pattern: alcoholic (daiquiris, beer, seltzer,
// cocktails — '%Cocktail%' safely misses 'Mocktail'), frozen (lemonade /
// melonade), bottled (drinks, water, Gatorade), fountain (souvenir-cup
// program + crew cups), other (floats, dirty soda, mocktails). GA-with-cup
// bundles are type 'Rate' and stay out — they're admissions revenue.
//
// Channel is the paid-vs-free axis: 'crew' for the (BB Employee)-priced
// variants (contact_group_name carries the crew member), 'comp' for $0
// giveaways, 'paid' otherwise. Free retail value is estimated client-side
// from each product's paid unit price.
const DRINK_CTE = `
  WITH drink_items AS (
    SELECT li.name, li.quantity, li.subtotal, li.price,
           o.order_id, o.business_date, o.created_date,
           o.contact_group_name, o.primary_contact_name,
      CASE
        WHEN li.name ILIKE 'Daiquiri%' OR li.name ILIKE 'Beer (%'
          OR li.name ILIKE 'Seltzer%' OR li.name ILIKE '%Cocktail%'          THEN 'alcoholic'
        WHEN li.name ILIKE 'Frozen Lemonade%' OR li.name ILIKE 'Frozen Melonade%' THEN 'frozen'
        WHEN li.name ILIKE 'Bottled Drink%' OR li.name ILIKE 'Bottled Water%'
          OR li.name ILIKE 'Bottle Drink%' OR li.name ILIKE '%Gatorade%'      THEN 'bottled'
        WHEN (li.name ILIKE '%Souvenir Cup%' AND li.type = 'Product')
          OR li.name ILIKE 'Crew Drink Cup%'                                  THEN 'fountain'
        WHEN li.name ILIKE 'Float%' OR li.name ILIKE 'Dirty Soda%'
          OR li.name ILIKE 'Mocktail%'                                        THEN 'other'
      END AS category,
      CASE
        WHEN li.name ILIKE '%(BB Employee)%' THEN 'crew'
        WHEN li.subtotal = 0                 THEN 'comp'
        ELSE 'paid'
      END AS channel
    FROM analytics_order_line_items li
    JOIN analytics_orders o ON o.order_id = li.order_id
    WHERE o.status = 'Active' AND o.park = 'BB' AND o.business_date BETWEEN $1 AND $2
  )`;

router.get('/drinks', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const singleDay = start === end;

    const trendSql = singleDay
      ? `SELECT to_char(date_trunc('hour', created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM') AS "bucket",
                COALESCE(SUM(quantity) FILTER (WHERE channel = 'paid'), 0)::int     AS "paidQty",
                COALESCE(SUM(subtotal) FILTER (WHERE channel = 'paid'), 0)::float    AS "paidRevenue",
                COALESCE(SUM(quantity) FILTER (WHERE channel <> 'paid'), 0)::int      AS "freeQty"
         FROM drink_items WHERE category IS NOT NULL
         GROUP BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')
         ORDER BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')`
      : `SELECT business_date::text                                                  AS "bucket",
                COALESCE(SUM(quantity) FILTER (WHERE channel = 'paid'), 0)::int     AS "paidQty",
                COALESCE(SUM(subtotal) FILTER (WHERE channel = 'paid'), 0)::float    AS "paidRevenue",
                COALESCE(SUM(quantity) FILTER (WHERE channel <> 'paid'), 0)::int      AS "freeQty"
         FROM drink_items WHERE category IS NOT NULL
         GROUP BY 1 ORDER BY 1`;

    const [byProduct, trend, freeByCustomer, attendance] = await Promise.all([
      pool.query(
        `${DRINK_CTE}
         SELECT name, category,
                COALESCE(SUM(quantity) FILTER (WHERE channel = 'paid'), 0)::int    AS "paidQty",
                COALESCE(SUM(subtotal) FILTER (WHERE channel = 'paid'), 0)::float   AS "paidRevenue",
                COALESCE(SUM(quantity) FILTER (WHERE channel = 'crew'), 0)::int      AS "crewQty",
                COALESCE(SUM(subtotal) FILTER (WHERE channel = 'crew'), 0)::float     AS "crewRevenue",
                COALESCE(SUM(quantity) FILTER (WHERE channel = 'comp'), 0)::int        AS "compQty",
                COALESCE(MAX(price) FILTER (WHERE channel = 'paid' AND price > 0),
                         MAX(price), 0)::float                                          AS "unitPrice"
         FROM drink_items WHERE category IS NOT NULL
         GROUP BY name, category ORDER BY "paidRevenue" DESC`,
        params
      ),
      pool.query(`${DRINK_CTE} ${trendSql}`, params),
      pool.query(
        `${DRINK_CTE}
         SELECT COALESCE(NULLIF(TRIM(contact_group_name), ''),
                         NULLIF(TRIM(primary_contact_name), ''), 'Unattributed') AS "customer",
                SUM(quantity)::int                                                 AS "quantity",
                COALESCE(SUM(subtotal), 0)::float                                   AS "collected",
                COUNT(DISTINCT order_id)::int                                        AS "orders"
         FROM drink_items WHERE category IS NOT NULL AND channel <> 'paid'
         GROUP BY 1 ORDER BY "quantity" DESC LIMIT 20`,
        params
      ),
      pool.query(
        `SELECT COALESCE(SUM(li.quantity), 0)::int AS "total"
         FROM analytics_order_line_items li
         JOIN analytics_orders o ON o.order_id = li.order_id
         WHERE o.status = 'Active' AND o.park = 'BB' AND li.type = 'Rate'
           AND li.event_name ILIKE '%Admission%' AND li.event_date BETWEEN $1 AND $2`,
        params
      ),
    ]);

    const categories = {};
    const channels = { paid: { quantity: 0, revenue: 0 }, crew: { quantity: 0, revenue: 0 }, comp: { quantity: 0, revenue: 0 } };
    let freeRetailValue = 0;
    for (const p of byProduct.rows) {
      const c = categories[p.category] ||= { quantity: 0, revenue: 0, freeQty: 0 };
      c.quantity += p.paidQty;
      c.revenue  += p.paidRevenue;
      c.freeQty  += p.crewQty + p.compQty;
      channels.paid.quantity += p.paidQty;  channels.paid.revenue += p.paidRevenue;
      channels.crew.quantity += p.crewQty;  channels.crew.revenue += p.crewRevenue;
      channels.comp.quantity += p.compQty;
      freeRetailValue += p.unitPrice * (p.crewQty + p.compQty);
    }

    res.json({
      categories, channels,
      // What the giveaway would have sold for, minus what crew actually paid
      freeSubsidy: Math.max(0, freeRetailValue - channels.crew.revenue),
      byProduct: byProduct.rows,
      trend: trend.rows,
      granularity: singleDay ? 'hour' : 'day',
      freeByCustomer: freeByCustomer.rows,
      attendance: attendance.rows[0].total,
    });
  } catch (err) {
    console.error('analytics drinks error:', err.message);
    res.status(500).json({ error: 'Failed to load drink report' });
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
