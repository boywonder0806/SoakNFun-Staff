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

// GET /api/analytics/revenue-breakdown?granularity=hour|day|week|month
// Companion to /revenue-trend for the Revenue Trends page: revenue split by
// business category and by sales channel per bucket, plus day-of-week
// averages. Category revenue comes from line-item subtotals (pre-tax), so
// the stack won't exactly equal the order-total headline — that's expected
// and labeled in the UI. Channel and DOW figures use order totals.
// Known nuance: '(UP)' upgrade memberships are appended to the guest's
// original GA order, so in the passes category they land on the GA purchase
// date. Every category here is deliberately order-date based; the Season
// Passes page re-dates upgrades to visit day where it matters.
router.get('/revenue-breakdown', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const granularity = ['hour', 'day', 'week', 'month'].includes(req.query.granularity) ? req.query.granularity : 'day';
    const params = [start, end];
    const parkSql = parkFilter(req, params).replace(' AND park', ' AND o.park');

    const liBucket = granularity === 'hour'
      ? `to_char(date_trunc('hour', o.created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM')`
      : granularity === 'day' ? `o.business_date::text`
      : `date_trunc('${granularity}', o.business_date)::date::text`;
    const liOrder = granularity === 'hour'
      ? `date_trunc('hour', o.created_date AT TIME ZONE 'America/Chicago')` : '1';

    const [categories, channels, dow] = await Promise.all([
      pool.query(
        `SELECT ${liBucket} AS "bucket",
           COALESCE(SUM(li.subtotal) FILTER (WHERE li.type = 'Rate' AND li.event_name ILIKE '%Admission%'), 0)::float AS "admissions",
           COALESCE(SUM(li.subtotal) FILTER (WHERE TRIM(li.sales_office_name) ILIKE '%Food & Beverage%'
             OR TRIM(li.sales_office_name) ILIKE '%Crew Kitchen%'
             OR TRIM(li.sales_office_name) ILIKE '%Cabana Services%'), 0)::float                                       AS "fnb",
           COALESCE(SUM(li.subtotal) FILTER (WHERE li.type = 'Membership'), 0)::float                                   AS "passes",
           COALESCE(SUM(li.subtotal) FILTER (WHERE TRIM(li.sales_office_name) ILIKE '%Gift Shop%'), 0)::float            AS "retail",
           COALESCE(SUM(li.subtotal) FILTER (WHERE li.type = 'Rate' AND (li.name ILIKE '%Cabana%'
             OR li.name ILIKE '%Covered Area%')), 0)::float                                                               AS "cabanas",
           COALESCE(SUM(li.subtotal) FILTER (WHERE TRIM(li.sales_office_name) ILIKE '%Parking%'
             OR li.name ILIKE '%Parking%'), 0)::float                                                                      AS "parking",
           COALESCE(SUM(li.subtotal), 0)::float                                                                             AS "total"
         FROM analytics_order_line_items li
         JOIN analytics_orders o ON o.order_id = li.order_id
         WHERE o.status = 'Active' AND o.business_date BETWEEN $1 AND $2${parkSql}
         GROUP BY ${liBucket}${liOrder === '1' ? '' : `, ${liOrder}`}
         ORDER BY ${liOrder === '1' ? '1' : liOrder}`,
        params
      ),
      pool.query(
        `SELECT ${liBucket.replaceAll('o.created_date', 'created_date').replaceAll('o.business_date', 'business_date')} AS "bucket",
                COALESCE(SUM(total) FILTER (WHERE is_web_order), 0)::float      AS "online",
                COALESCE(SUM(total) FILTER (WHERE NOT is_web_order), 0)::float   AS "inPerson"
         FROM analytics_orders o
         WHERE status = 'Active' AND business_date BETWEEN $1 AND $2${parkSql}
         GROUP BY 1${liOrder === '1' ? '' : `, ${liOrder.replaceAll('o.created_date', 'created_date')}`}
         ORDER BY ${liOrder === '1' ? '1' : liOrder.replaceAll('o.created_date', 'created_date')}`,
        params
      ),
      pool.query(
        `SELECT to_char(business_date, 'Dy') AS "dow",
                COUNT(DISTINCT business_date)::int AS "days",
                COALESCE(SUM(total), 0)::float AS "revenue"
         FROM analytics_orders o
         WHERE status = 'Active' AND business_date BETWEEN $1 AND $2${parkSql}
         GROUP BY to_char(business_date, 'Dy'), to_char(business_date, 'ID')
         ORDER BY to_char(business_date, 'ID')`,
        params
      ),
    ]);

    res.json({
      granularity,
      categories: categories.rows.map(r => ({ ...r, other: Math.max(0, r.total - (r.admissions + r.fnb + r.passes + r.retail + r.cabanas + r.parking)) })),
      channels: channels.rows,
      dow: dow.rows.map(r => ({ dow: r.dow, days: r.days, avgRevenue: r.days ? r.revenue / r.days : 0 })),
    });
  } catch (err) {
    console.error('analytics revenue-breakdown error:', err.message);
    res.status(500).json({ error: 'Failed to load revenue breakdown' });
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
      // Pass sales: '(UP)' upgrade memberships are APPENDED to the guest's
      // original GA order, so business_date would backdate them to the GA
      // purchase date (weeks earlier for advance web buys). Date upgrades
      // by the GA ticket's visit date on the same order instead, falling
      // back to business_date for standalone upgrade orders.
      pool.query(
        `SELECT li.name                               AS "name",
                SUM(li.quantity)::int                  AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float    AS "revenue"
         FROM analytics_order_line_items li
         JOIN analytics_orders o ON o.order_id = li.order_id
         WHERE o.status = 'Active' AND li.type = 'Membership'
           AND (CASE WHEN li.name ILIKE '%(UP)%' THEN COALESCE(
                  (SELECT MIN(li2.event_date) FROM analytics_order_line_items li2
                   WHERE li2.order_id = o.order_id AND li2.type = 'Rate'
                     AND li2.event_name ILIKE '%Admission%'), o.business_date)
                ELSE o.business_date END) BETWEEN $1 AND $2${parkSql}
         GROUP BY li.name ORDER BY "revenue" DESC`,
        params
      ),
      // Rentals vs F&B is classified per ITEM, not per office: the Cabana
      // Services office mostly sells food delivered to cabanas (burgers,
      // daiquiris — that's F&B), while actual cabana/sundeck reservations
      // are Rate-type bookings sold mainly through Web Sales. Office-based
      // bucketing counted cabana food as rentals and missed ~$90K/mo of
      // real cabana rental revenue entirely.
      pool.query(
        `SELECT
           COALESCE(SUM(li.subtotal) FILTER (WHERE
             li.sales_office_name ILIKE '%Food & Beverage%'
             OR (li.sales_office_name ILIKE '%Cabana%' AND li.type <> 'Rate')
             OR (li.type = 'Product' AND li.name ILIKE '%Cabana%')
           ), 0)::float AS "fnb",
           COALESCE(SUM(li.subtotal) FILTER (WHERE
             li.sales_office_name ILIKE '%Locker%'
             OR (li.type = 'Rate' AND (li.name ILIKE '%Cabana%' OR li.name ILIKE 'Sundeck%'
                                       OR li.sales_office_name ILIKE '%Cabana%'))
           ), 0)::float AS "rentals",
           COALESCE(SUM(li.subtotal) FILTER (WHERE li.sales_office_name ILIKE '%Gift Shop%'), 0)::float AS "merch"
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
// Purchased guest drinks only. Products are bucketed by name pattern:
// alcoholic (daiquiris, beer, seltzer, cocktails — '%Cocktail%' safely
// misses 'Mocktail'), frozen (lemonade / melonade), bottled (drinks, water,
// Gatorade), other (dirty soda, mocktails). Deliberately excluded (owner's
// call): souvenir cups, floats, all '(BB Employee)' crew-priced items, and
// $0 register comps. The park's free soda stations aren't rung up in
// RocketRez at all, so they can't be reported on from any connected system.
const DRINK_CTE = `
  WITH drink_items AS (
    SELECT li.name, li.quantity, li.subtotal,
           o.business_date, o.created_date,
      CASE
        WHEN li.name ILIKE 'Daiquiri%' OR li.name ILIKE 'Beer (%'
          OR li.name ILIKE 'Seltzer%' OR li.name ILIKE '%Cocktail%'          THEN 'alcoholic'
        WHEN li.name ILIKE 'Frozen Lemonade%' OR li.name ILIKE 'Frozen Melonade%' THEN 'frozen'
        WHEN li.name ILIKE 'Bottled Drink%' OR li.name ILIKE 'Bottled Water%'
          OR li.name ILIKE 'Bottle Drink%' OR li.name ILIKE '%Gatorade%'      THEN 'bottled'
        WHEN li.name ILIKE 'Dirty Soda%' OR li.name ILIKE 'Mocktail%'          THEN 'other'
      END AS category
    FROM analytics_order_line_items li
    JOIN analytics_orders o ON o.order_id = li.order_id
    WHERE o.status = 'Active' AND o.park = 'BB' AND o.business_date BETWEEN $1 AND $2
      AND li.name NOT ILIKE '%(BB Employee)%' AND li.subtotal > 0
  )`;

router.get('/drinks', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const singleDay = start === end;

    const trendSql = singleDay
      ? `SELECT to_char(date_trunc('hour', created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM') AS "bucket",
                COALESCE(SUM(quantity), 0)::int   AS "quantity",
                COALESCE(SUM(subtotal), 0)::float  AS "revenue"
         FROM drink_items WHERE category IS NOT NULL
         GROUP BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')
         ORDER BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')`
      : `SELECT business_date::text                AS "bucket",
                COALESCE(SUM(quantity), 0)::int   AS "quantity",
                COALESCE(SUM(subtotal), 0)::float  AS "revenue"
         FROM drink_items WHERE category IS NOT NULL
         GROUP BY 1 ORDER BY 1`;

    const [byProduct, trend, attendance] = await Promise.all([
      pool.query(
        `${DRINK_CTE}
         SELECT name, category,
                SUM(quantity)::int                 AS "quantity",
                COALESCE(SUM(subtotal), 0)::float   AS "revenue"
         FROM drink_items WHERE category IS NOT NULL
         GROUP BY name, category ORDER BY "revenue" DESC`,
        params
      ),
      pool.query(`${DRINK_CTE} ${trendSql}`, params),
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
    const totals = { quantity: 0, revenue: 0 };
    for (const p of byProduct.rows) {
      const c = categories[p.category] ||= { quantity: 0, revenue: 0 };
      c.quantity += p.quantity;
      c.revenue  += p.revenue;
      totals.quantity += p.quantity;
      totals.revenue  += p.revenue;
    }

    res.json({
      categories, totals,
      byProduct: byProduct.rows,
      trend: trend.rows,
      granularity: singleDay ? 'hour' : 'day',
      attendance: attendance.rows[0].total,
    });
  } catch (err) {
    console.error('analytics drinks error:', err.message);
    res.status(500).json({ error: 'Failed to load drink report' });
  }
});

// GET /api/analytics/cabanas — the Blue Bayou cabana report. BB-only, park
// filter ignored (GI's cabana program is too small to matter yet).
//
// Two halves with different date bases, same split as /daily:
// - BOOKINGS are 'Blue Bayou Cabana N' rate items counted on their EVENT
//   (visit) date — cabanas are booked days ahead, so purchase date would
//   put the booking on the wrong day. Occupancy = booked ÷ (8 cabanas ×
//   operating days), where operating days are days with gate activity,
//   capped at today so future days don't dilute the denominator.
//   'Blue Bayou Covered Area N' (the groups pavilion) is reported
//   separately, not in occupancy.
// - FOOD is every Product line item whose name carries the '(CS-BB)' tag —
//   per the owner, that suffix is the authoritative marker for cabana
//   items. Counted on business_date, when the money moved. $0 'CABANA N'
//   items are excluded: they're print markers manual orders attach so the
//   slip shows the cabana, not sales. Ordering channel: orders created by
//   the 'BB - Covered Area Services' web engine (salesperson name, which
//   coincides with is_web_order) are guest self-service; orders rung by a
//   named user in the Cabana Services office are manual/staff orders.
const CABANA_RATE = `li.type = 'Rate' AND li.name ILIKE 'Blue Bayou Cabana%'`;
const CABANA_FOOD_CTE = `
  WITH food_items AS (
    SELECT li.name, li.quantity, li.subtotal,
           o.order_id, o.business_date, o.created_date,
           (o.is_web_order OR o.sales_person_name ILIKE '%Covered Area Service%') AS is_engine,
      CASE
        WHEN li.name ILIKE '%Daiquiri%' OR li.name ILIKE '%Cocktail%' OR li.name ILIKE '%Michelob%'
          OR li.name ILIKE '%Corona%' OR li.name ILIKE '%Miller%' OR li.name ILIKE '%Bud Light%'
          OR li.name ILIKE '%Abita%' OR li.name ILIKE '%Coors%' OR li.name ILIKE '%Modelo%'
          OR li.name ILIKE '%Twisted Tea%' OR li.name ILIKE '%Truly%' OR li.name ILIKE '%Absolut%' THEN 'alcohol'
        WHEN li.name ILIKE '%Bottled%' OR li.name ILIKE '%Frozen Lemonade%'
          OR li.name ILIKE '%Frozen Melonade%' OR li.name ILIKE '%Gatorde%'                         THEN 'drinks'
        ELSE 'food'
      END AS category
    FROM analytics_order_line_items li
    JOIN analytics_orders o ON o.order_id = li.order_id
    WHERE o.status = 'Active' AND o.park = 'BB' AND o.business_date BETWEEN $1 AND $2
      AND li.type = 'Product' AND li.name LIKE '%(CS-BB)%'
      AND li.name NOT ILIKE 'CABANA %' AND li.subtotal > 0
  )`;

router.get('/cabanas', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const singleDay = start === end;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

    const bookedJoin = `
      FROM analytics_order_line_items li
      JOIN analytics_orders o ON o.order_id = li.order_id
      WHERE o.status = 'Active' AND ${CABANA_RATE} AND li.event_date BETWEEN $1 AND $2`;

    const foodTrendSql = singleDay
      ? `SELECT to_char(date_trunc('hour', created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM') AS "bucket",
                COUNT(DISTINCT order_id)::int      AS "orders",
                COALESCE(SUM(subtotal), 0)::float   AS "revenue"
         FROM food_items
         GROUP BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')
         ORDER BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')`
      : `SELECT business_date::text AS "bucket",
                COUNT(DISTINCT order_id)::int      AS "orders",
                COALESCE(SUM(subtotal), 0)::float   AS "revenue"
         FROM food_items GROUP BY 1 ORDER BY 1`;

    const [byCabana, coveredArea, channels, leadTime, byDow, bookTrend, operatingDays, foodItems, foodTotals, foodTrend] = await Promise.all([
      pool.query(
        `SELECT li.name AS "name", SUM(li.quantity)::int AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float AS "revenue"
         ${bookedJoin} GROUP BY li.name ORDER BY li.name`,
        params
      ),
      pool.query(
        `SELECT COALESCE(SUM(li.quantity), 0)::int AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float AS "revenue"
         FROM analytics_order_line_items li
         JOIN analytics_orders o ON o.order_id = li.order_id
         WHERE o.status = 'Active' AND li.type = 'Rate'
           AND li.name ILIKE 'Blue Bayou Covered Area%' AND li.event_date BETWEEN $1 AND $2`,
        params
      ),
      pool.query(
        `SELECT o.is_web_order AS "isWebOrder", SUM(li.quantity)::int AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float AS "revenue"
         ${bookedJoin} GROUP BY o.is_web_order`,
        params
      ),
      pool.query(
        `SELECT COALESCE(AVG(li.event_date - o.business_date), 0)::float AS "avgDays",
                COUNT(*) FILTER (WHERE li.event_date - o.business_date <= 0)::int                                        AS "sameDay",
                COUNT(*) FILTER (WHERE li.event_date - o.business_date BETWEEN 1 AND 3)::int                              AS "d1to3",
                COUNT(*) FILTER (WHERE li.event_date - o.business_date BETWEEN 4 AND 7)::int                               AS "d4to7",
                COUNT(*) FILTER (WHERE li.event_date - o.business_date BETWEEN 8 AND 14)::int                               AS "d8to14",
                COUNT(*) FILTER (WHERE li.event_date - o.business_date > 14)::int                                            AS "d15plus"
         ${bookedJoin}`,
        params
      ),
      pool.query(
        `SELECT to_char(li.event_date, 'Dy') AS "dow",
                SUM(li.quantity)::int AS "booked",
                COUNT(DISTINCT li.event_date)::int AS "days"
         ${bookedJoin} GROUP BY to_char(li.event_date, 'Dy'), to_char(li.event_date, 'ID')
         ORDER BY to_char(li.event_date, 'ID')`,
        params
      ),
      pool.query(
        `SELECT li.event_date::text AS "bucket", SUM(li.quantity)::int AS "booked",
                COALESCE(SUM(li.subtotal), 0)::float AS "revenue"
         ${bookedJoin} GROUP BY li.event_date ORDER BY li.event_date`,
        params
      ),
      pool.query(
        `SELECT COUNT(DISTINCT li.event_date)::int AS "days"
         FROM analytics_order_line_items li
         JOIN analytics_orders o ON o.order_id = li.order_id
         WHERE o.status = 'Active' AND o.park = 'BB' AND li.type = 'Rate'
           AND li.event_name ILIKE '%Admission%'
           AND li.event_date BETWEEN $1 AND LEAST($2::date, $3::date)`,
        [start, end, today]
      ),
      pool.query(
        `${CABANA_FOOD_CTE}
         SELECT name, category, SUM(quantity)::int AS "quantity",
                COALESCE(SUM(subtotal), 0)::float AS "revenue"
         FROM food_items GROUP BY name, category ORDER BY "revenue" DESC`,
        params
      ),
      pool.query(
        `${CABANA_FOOD_CTE}
         SELECT COUNT(DISTINCT order_id)::int AS "orders",
                COUNT(DISTINCT order_id) FILTER (WHERE is_engine)::int AS "engineOrders",
                COALESCE(SUM(subtotal), 0)::float AS "revenue",
                COALESCE(SUM(subtotal) FILTER (WHERE is_engine), 0)::float AS "engineRevenue"
         FROM food_items`,
        params
      ),
      pool.query(`${CABANA_FOOD_CTE} ${foodTrendSql}`, params),
    ]);

    // All 8 cabanas, zero-filled, so empty ones are visible on the page
    const cabanas = Array.from({ length: 8 }, (_, i) => {
      const name = `Blue Bayou Cabana ${i + 1}`;
      const row = byCabana.rows.find(r => r.name === name);
      return { cabana: i + 1, quantity: row?.quantity || 0, revenue: row?.revenue || 0 };
    });
    const booked = cabanas.reduce((s, c) => s + c.quantity, 0);
    const bookingRevenue = cabanas.reduce((s, c) => s + c.revenue, 0);
    const days = operatingDays.rows[0].days;
    const web = channels.rows.find(r => r.isWebOrder) || { quantity: 0, revenue: 0 };
    const gate = channels.rows.find(r => !r.isWebOrder) || { quantity: 0, revenue: 0 };
    const lt = leadTime.rows[0];
    const food = foodTotals.rows[0];

    const foodCategories = { food: { quantity: 0, revenue: 0 }, alcohol: { quantity: 0, revenue: 0 }, drinks: { quantity: 0, revenue: 0 } };
    for (const p of foodItems.rows) {
      foodCategories[p.category].quantity += p.quantity;
      foodCategories[p.category].revenue += p.revenue;
    }

    res.json({
      bookings: {
        booked,
        revenue: bookingRevenue,
        avgRate: booked ? bookingRevenue / booked : 0,
        occupancy: days ? booked / (8 * days) : null,
        operatingDays: days,
        byCabana: cabanas,
        byDow: byDow.rows.map(r => ({ ...r, occupancy: r.days ? r.booked / (8 * r.days) : 0 })),
        leadTime: {
          avgDays: lt.avgDays,
          buckets: [
            { label: 'Same day', count: lt.sameDay },
            { label: '1–3 days', count: lt.d1to3 },
            { label: '4–7 days', count: lt.d4to7 },
            { label: '8–14 days', count: lt.d8to14 },
            { label: '15+ days', count: lt.d15plus },
          ],
        },
        channels: { online: { quantity: web.quantity, revenue: web.revenue },
                    inPerson: { quantity: gate.quantity, revenue: gate.revenue } },
        coveredArea: coveredArea.rows[0],
        trend: bookTrend.rows,
      },
      food: {
        revenue: food.revenue,
        orders: food.orders,
        channels: {
          engine: { orders: food.engineOrders, revenue: food.engineRevenue },
          manual: { orders: food.orders - food.engineOrders, revenue: food.revenue - food.engineRevenue },
        },
        avgOrder: food.orders ? food.revenue / food.orders : 0,
        perCabana: booked ? food.revenue / booked : 0,
        categories: foodCategories,
        topItems: foodItems.rows.slice(0, 12),
        trend: foodTrend.rows,
        granularity: singleDay ? 'hour' : 'day',
      },
    });
  } catch (err) {
    console.error('analytics cabanas error:', err.message);
    res.status(500).json({ error: 'Failed to load cabana report' });
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

// GET /api/analytics/payment-methods — advanced tender report.
//
// RocketRez method names encode "{park} - {processor} - [wallet -] {brand}"
// (e.g. 'GI - Stripe 2.0 - Apple Pay - Visa'), so groups and card brands are
// parsed straight out of the name. Groups: card (Stripe, no wallet), wallet
// (Apple/Google Pay), paypal, cash, other (payroll deduction, Nayax, prepaid
// pass, checks, tokens — individually visible in the methods table).
// Negative payment amounts are refunds; transaction counts and averages use
// positive payments only so refunds don't drag the averages.
router.get('/payment-methods', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const parkSql = parkFilter(req, params).replace(' AND park', ' AND o.park');
    const singleDay = start === end;

    const paysCte = `
      WITH pays AS (
        SELECT o.business_date, o.created_date,
               (pm->>'paymentAmount')::numeric AS amount,
               pm->>'paymentMethod'            AS method,
          CASE
            WHEN pm->>'paymentMethod' ILIKE '%Apple Pay%'
              OR pm->>'paymentMethod' ILIKE '%Google Pay%' THEN 'wallet'
            WHEN pm->>'paymentMethod' ILIKE '%PayPal%'      THEN 'paypal'
            WHEN pm->>'paymentMethod' ILIKE '%Cash%'         THEN 'cash'
            WHEN pm->>'paymentMethod' ILIKE '%Stripe%'        THEN 'card'
            ELSE 'other'
          END AS grp,
          CASE
            WHEN pm->>'paymentMethod' ILIKE '%Visa%'             THEN 'Visa'
            WHEN pm->>'paymentMethod' ILIKE '%Mastercard%'        THEN 'Mastercard'
            WHEN pm->>'paymentMethod' ILIKE '%Discover%'           THEN 'Discover'
            WHEN pm->>'paymentMethod' ILIKE '%American Express%'    THEN 'American Express'
          END AS brand
        FROM analytics_orders o, jsonb_array_elements(o.payment_methods) pm
        WHERE o.status = 'Active' AND o.business_date BETWEEN $1 AND $2${parkSql}
      )`;

    const trendSql = singleDay
      ? `SELECT to_char(date_trunc('hour', created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM') AS "bucket",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'card'), 0)::float   AS "card",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'cash'), 0)::float    AS "cash",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'wallet'), 0)::float   AS "wallet",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'paypal'), 0)::float    AS "paypal",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'other'), 0)::float      AS "other"
         FROM pays
         GROUP BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')
         ORDER BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')`
      : `SELECT business_date::text AS "bucket",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'card'), 0)::float   AS "card",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'cash'), 0)::float    AS "cash",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'wallet'), 0)::float   AS "wallet",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'paypal'), 0)::float    AS "paypal",
                COALESCE(SUM(amount) FILTER (WHERE grp = 'other'), 0)::float      AS "other"
         FROM pays GROUP BY 1 ORDER BY 1`;

    const [groups, brands, methods, trend, kpis] = await Promise.all([
      pool.query(
        `${paysCte}
         SELECT grp AS "group",
                COALESCE(SUM(amount), 0)::float                                  AS "amount",
                COUNT(*) FILTER (WHERE amount > 0)::int                           AS "transactions",
                COALESCE(AVG(amount) FILTER (WHERE amount > 0), 0)::float          AS "avgTransaction",
                COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)::float          AS "refunded",
                COUNT(*) FILTER (WHERE amount < 0)::int                              AS "refundCount"
         FROM pays GROUP BY grp ORDER BY "amount" DESC`,
        params
      ),
      pool.query(
        `${paysCte}
         SELECT brand AS "brand",
                COALESCE(SUM(amount), 0)::float          AS "amount",
                COUNT(*) FILTER (WHERE amount > 0)::int   AS "transactions"
         FROM pays WHERE brand IS NOT NULL
         GROUP BY brand ORDER BY "amount" DESC`,
        params
      ),
      pool.query(
        `${paysCte}
         SELECT method AS "method",
                COALESCE(SUM(amount), 0)::float                                  AS "amount",
                COUNT(*) FILTER (WHERE amount > 0)::int                           AS "transactions",
                COALESCE(AVG(amount) FILTER (WHERE amount > 0), 0)::float          AS "avgTransaction",
                COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)::float          AS "refunded"
         FROM pays GROUP BY method ORDER BY "amount" DESC`,
        params
      ),
      pool.query(`${paysCte} ${trendSql}`, params),
      pool.query(
        `${paysCte}
         SELECT COALESCE(SUM(amount), 0)::float                                  AS "total",
                COUNT(*) FILTER (WHERE amount > 0)::int                           AS "transactions",
                COALESCE(AVG(amount) FILTER (WHERE amount > 0), 0)::float          AS "avgTransaction",
                COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)::float          AS "refunded",
                COUNT(*) FILTER (WHERE amount < 0)::int                              AS "refundCount"
         FROM pays`,
        params
      ),
    ]);

    res.json({
      kpis: kpis.rows[0],
      groups: groups.rows,
      brands: brands.rows,
      methods: methods.rows,
      trend: trend.rows,
      granularity: singleDay ? 'hour' : 'day',
    });
  } catch (err) {
    console.error('analytics payment-methods error:', err.message);
    res.status(500).json({ error: 'Failed to load payment method breakdown' });
  }
});

// GET /api/analytics/refunds — refund analytics. A "refund" is any negative
// payment on an order (RocketRez records refunds as negative paymentAmount
// entries), regardless of order status: Active orders carry partial/full
// refunds (a fully-refunded Active order nets to total = 0), and Void /
// Cancelled orders keep their reversal payments too. "Who" is the
// salesperson on the order — for gate sales that's the crew member at the
// register; web-engine refunds show the engine name (e.g. 'GI - Public
// Sales'), since RocketRez doesn't expose the refunding user separately.
router.get('/refunds', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const parkSql = parkFilter(req, params).replace(' AND park', ' AND o.park');
    const singleDay = start === end;

    const refundsCte = `
      WITH pays AS (
        SELECT o.order_id, o.business_date, o.created_date, o.park, o.status,
               o.sales_person_name, o.sales_office_name, o.primary_contact_name, o.contact_group_name,
               (pm->>'paymentAmount')::numeric AS amt,
               pm->>'paymentMethod'            AS method,
          CASE
            WHEN pm->>'paymentMethod' ILIKE '%Apple Pay%'
              OR pm->>'paymentMethod' ILIKE '%Google Pay%' THEN 'Digital Wallet'
            WHEN pm->>'paymentMethod' ILIKE '%PayPal%'      THEN 'PayPal'
            WHEN pm->>'paymentMethod' ILIKE '%Cash%'         THEN 'Cash'
            WHEN pm->>'paymentMethod' ILIKE '%Stripe%'        THEN 'Card'
            ELSE 'Other'
          END AS grp
        FROM analytics_orders o, jsonb_array_elements(o.payment_methods) pm
        WHERE o.business_date BETWEEN $1 AND $2${parkSql}
      ),
      refund_orders AS (
        SELECT order_id, business_date, created_date, park, status,
               sales_person_name, sales_office_name, primary_contact_name, contact_group_name,
               -SUM(amt) FILTER (WHERE amt < 0)      AS refunded,
               COALESCE(SUM(amt) FILTER (WHERE amt > 0), 0) AS charged,
               string_agg(DISTINCT grp, ', ') FILTER (WHERE amt < 0) AS methods
        FROM pays
        GROUP BY 1,2,3,4,5,6,7,8,9
        HAVING SUM(amt) FILTER (WHERE amt < 0) IS NOT NULL
      ),
      marked AS (
        SELECT r.*, (f.order_id IS NOT NULL) AS flagged, f.note AS flag_note, f.flagged_by
        FROM refund_orders r
        LEFT JOIN analytics_refund_flags f ON f.order_id = r.order_id
      )`;

    const trendSql = singleDay
      ? `SELECT to_char(date_trunc('hour', created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM') AS "bucket",
                COALESCE(SUM(refunded), 0)::float AS "refunded", COUNT(*)::int AS "orders"
         FROM marked WHERE NOT flagged
         GROUP BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')
         ORDER BY date_trunc('hour', created_date AT TIME ZONE 'America/Chicago')`
      : `SELECT business_date::text AS "bucket",
                COALESCE(SUM(refunded), 0)::float AS "refunded", COUNT(*)::int AS "orders"
         FROM marked WHERE NOT flagged GROUP BY 1 ORDER BY 1`;

    const [kpis, trend, byPerson, byOffice, byMethod, detail] = await Promise.all([
      pool.query(
        `${refundsCte}
         SELECT COALESCE(SUM(refunded) FILTER (WHERE NOT flagged), 0)::float             AS "refunded",
                COUNT(*) FILTER (WHERE NOT flagged)::int                                  AS "refundOrders",
                COALESCE(AVG(refunded) FILTER (WHERE NOT flagged), 0)::float               AS "avgRefund",
                COUNT(*) FILTER (WHERE NOT flagged AND refunded >= charged - 0.01)::int     AS "fullRefunds",
                COUNT(*) FILTER (WHERE NOT flagged AND status = 'Void')::int                 AS "voids",
                COUNT(*) FILTER (WHERE NOT flagged AND status = 'Cancelled')::int             AS "cancellations",
                COUNT(*) FILTER (WHERE flagged)::int                                           AS "flaggedCount",
                COALESCE(SUM(refunded) FILTER (WHERE flagged), 0)::float                        AS "flaggedAmount",
                (SELECT COALESCE(SUM(amt), 0) FROM pays WHERE amt > 0)::float                    AS "grossCollected",
                (SELECT COUNT(DISTINCT order_id) FROM pays)::int                                  AS "totalOrders"
         FROM marked`,
        params
      ),
      pool.query(`${refundsCte} ${trendSql}`, params),
      pool.query(
        `${refundsCte}
         SELECT COALESCE(NULLIF(TRIM(sales_person_name), ''), 'Unattributed') AS "person",
                COUNT(*)::int AS "orders", COALESCE(SUM(refunded), 0)::float AS "refunded"
         FROM marked WHERE NOT flagged GROUP BY 1 ORDER BY "refunded" DESC LIMIT 12`,
        params
      ),
      pool.query(
        `${refundsCte}
         SELECT COALESCE(NULLIF(TRIM(sales_office_name), ''), 'Unattributed') AS "office",
                COUNT(*)::int AS "orders", COALESCE(SUM(refunded), 0)::float AS "refunded"
         FROM marked WHERE NOT flagged GROUP BY 1 ORDER BY "refunded" DESC`,
        params
      ),
      pool.query(
        `${refundsCte}
         SELECT grp AS "method", COUNT(*)::int AS "payments",
                COALESCE(-SUM(amt), 0)::float AS "refunded"
         FROM pays WHERE amt < 0
           AND order_id NOT IN (SELECT order_id FROM analytics_refund_flags)
         GROUP BY grp ORDER BY "refunded" DESC`,
        params
      ),
      pool.query(
        `${refundsCte}
         SELECT order_id::text AS "orderId", business_date::text AS "date", park, status,
                sales_person_name AS "salesperson", sales_office_name AS "office",
                COALESCE(NULLIF(TRIM(primary_contact_name), ''), NULLIF(TRIM(contact_group_name), '')) AS "customer",
                charged::float AS "charged", refunded::float AS "refunded", methods,
                (refunded >= charged - 0.01) AS "isFull",
                flagged, flag_note AS "flagNote", flagged_by AS "flaggedBy"
         FROM marked ORDER BY business_date DESC, refunded DESC LIMIT 200`,
        params
      ),
    ]);

    res.json({
      kpis: kpis.rows[0] || { refunded: 0, refundOrders: 0, avgRefund: 0, fullRefunds: 0, voids: 0, cancellations: 0, flaggedCount: 0, flaggedAmount: 0, grossCollected: 0, totalOrders: 0 },
      trend: trend.rows,
      granularity: singleDay ? 'hour' : 'day',
      byPerson: byPerson.rows,
      byOffice: byOffice.rows,
      byMethod: byMethod.rows,
      detail: detail.rows,
    });
  } catch (err) {
    console.error('analytics refunds error:', err.message);
    res.status(500).json({ error: 'Failed to load refund report' });
  }
});

// POST /api/analytics/refunds/:orderId/flag — mark an order's refund as "not
// a true refund" (register mistake etc.) with a note; the refunds dashboard
// excludes it from every aggregate. Upserts so the note can be edited.
router.post('/refunds/:orderId/flag', async (req, res) => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'Invalid order id' });
    const note = (req.body?.note || '').trim().slice(0, 500) || null;
    const by = req.user?.name || req.user?.email || `user ${req.user?.id}`;
    await pool.query(
      `INSERT INTO analytics_refund_flags (order_id, note, flagged_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_id) DO UPDATE SET note = EXCLUDED.note, flagged_by = EXCLUDED.flagged_by, flagged_at = NOW()`,
      [orderId, note, by]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('analytics refund flag error:', err.message);
    res.status(500).json({ error: 'Failed to flag order' });
  }
});

// DELETE /api/analytics/refunds/:orderId/flag — restore the order to the
// refund calculations.
router.delete('/refunds/:orderId/flag', async (req, res) => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'Invalid order id' });
    await pool.query('DELETE FROM analytics_refund_flags WHERE order_id = $1', [orderId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('analytics refund unflag error:', err.message);
    res.status(500).json({ error: 'Failed to unflag order' });
  }
});

// GET /api/analytics/reports/cash-out — cashier cash-drawer reconciliation
// report. Grouped by salesperson, matching RocketRez's own "Employee/Web
// Engine" grouping on the printed Cash Out Report, then by tender. The cash
// total per cashier is the number that matters for drawer reconciliation —
// it nets out any cash refunds, since those physically leave the drawer too.
// Terminal and GL Code from the native report aren't exposed by the Orders
// API this app syncs from, so they're intentionally left off here.
router.get('/reports/cash-out', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const parkSql = parkFilter(req, params).replace(' AND park', ' AND o.park');

    const { rows } = await pool.query(
      `SELECT o.order_id::text AS "orderId", o.business_date::text AS "date",
              to_char(o.created_date AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM') AS "time",
              o.park, o.sales_office_name AS "office",
              COALESCE(NULLIF(TRIM(o.sales_person_name), ''), 'Unattributed') AS "cashier",
              pm->>'paymentMethod' AS "method",
              (pm->>'paymentAmount')::numeric::float AS "amount"
       FROM analytics_orders o, jsonb_array_elements(o.payment_methods) pm
       WHERE o.status = 'Active' AND o.business_date BETWEEN $1 AND $2${parkSql}
       ORDER BY o.business_date, o.sales_person_name, o.created_date`,
      params
    );

    const round2 = n => Math.round(n * 100) / 100;
    const dateMap = new Map();
    let totalCash = 0, totalAll = 0;
    const allOrderIds = new Set();

    for (const r of rows) {
      totalAll += r.amount;
      allOrderIds.add(r.orderId);
      const isCash = /cash/i.test(r.method);
      if (isCash) totalCash += r.amount;

      let d = dateMap.get(r.date);
      if (!d) dateMap.set(r.date, d = { date: r.date, cashiers: new Map() });
      let c = d.cashiers.get(r.cashier);
      if (!c) d.cashiers.set(r.cashier, c = { cashier: r.cashier, total: 0, cashTotal: 0, orderIds: new Set(), methods: new Map() });
      c.total += r.amount;
      if (isCash) c.cashTotal += r.amount;
      c.orderIds.add(r.orderId);
      let m = c.methods.get(r.method);
      if (!m) c.methods.set(r.method, m = { method: r.method, total: 0, payments: [] });
      m.total += r.amount;
      m.payments.push({ orderId: r.orderId, time: r.time, office: r.office, park: r.park, amount: round2(r.amount) });
    }

    const dateGroups = [...dateMap.values()].map(d => ({
      date: d.date,
      cashiers: [...d.cashiers.values()]
        .map(c => ({
          cashier: c.cashier,
          total: round2(c.total),
          cashTotal: round2(c.cashTotal),
          orderCount: c.orderIds.size,
          methods: [...c.methods.values()]
            .map(m => ({ ...m, total: round2(m.total) }))
            .sort((a, b) => b.total - a.total),
        }))
        .sort((a, b) => b.cashTotal - a.cashTotal || b.total - a.total),
    })).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      kpis: {
        totalCash: round2(totalCash),
        totalAll: round2(totalAll),
        cashierCount: new Set(rows.map(r => r.cashier)).size,
        orderCount: allOrderIds.size,
      },
      dateGroups,
    });
  } catch (err) {
    console.error('analytics cash-out report error:', err.message);
    res.status(500).json({ error: 'Failed to load cash out report' });
  }
});

// GET /api/analytics/season-passes — season pass program report.
//
// Three distinct signals, two date bases (same split as /daily):
// - SALES are type='Membership' line items. Products whose name carries the
//   '(UP)' suffix are day-ticket-to-season-pass UPGRADES: per the owner, the
//   (UP) membership is APPENDED to the guest's original GA ticket order, so
//   the order's business_date is the GA PURCHASE date, not the upgrade date
//   (36% of upgrade orders differ, by up to 55 days for advance web buys).
//   Upgrades are therefore dated by the GA ticket's EVENT (visit) date on
//   the same order — the day the guest was physically at the park upgrading
//   — falling back to business_date for standalone upgrade orders with no
//   GA item (~15%). New/comp pass sales stay on business_date: they're
//   bought outright that day. $0 memberships (investor / comped) are
//   counted separately so giveaways don't dilute average prices.
//   Replacement fees ($10 Product items) are tracked as their own bucket.
// - REDEMPTIONS ('% Season Pass Redemption' rate items, always $0) are
//   passholder gate visits, counted on EVENT (visit) date like attendance.
// - Upgrade capture = upgrades per 100 GA guests in the range, both on
//   visit-date basis — how well the gate converts day guests into
//   passholders. (Same-basis on both sides; previously compared against GA
//   tickets *sold*, which mixed purchase and visit dates.)
//
// The park filter applies to o.park: where the pass was SOLD for sales,
// which park's gate scanned it for redemptions. Two-park passes sold at BB
// count under BB — there is no park-neutral ledger in the source data.
router.get('/season-passes', async (req, res) => {
  try {
    const { start, end } = dateRange(req);
    const params = [start, end];
    const parkSql = parkFilter(req, params).replace(' AND park', ' AND o.park');
    const singleDay = start === end;

    // Effective date of a membership line item: (UP) upgrades ride the GA
    // ticket's visit date on the same order; everything else (and standalone
    // upgrades) uses the order's business_date.
    const effDate = `
      CASE WHEN li.name ILIKE '%(UP)%' THEN COALESCE(
        (SELECT MIN(li2.event_date) FROM analytics_order_line_items li2
         WHERE li2.order_id = o.order_id AND li2.type = 'Rate'
           AND li2.event_name ILIKE '%Admission%'), o.business_date)
      ELSE o.business_date END`;

    const salesJoin = `
      FROM analytics_order_line_items li
      JOIN analytics_orders o ON o.order_id = li.order_id
      WHERE o.status = 'Active' AND li.type = 'Membership'
        AND (${effDate}) BETWEEN $1 AND $2${parkSql}`;
    const redemptionJoin = `
      FROM analytics_order_line_items li
      JOIN analytics_orders o ON o.order_id = li.order_id
      WHERE o.status = 'Active' AND li.type = 'Rate'
        AND li.name ILIKE '%Season Pass Redemption%'
        AND li.event_date BETWEEN $1 AND $2${parkSql}`;

    const kindCase = `
      CASE WHEN li.name ILIKE '%(UP)%' THEN 'upgrade'
           WHEN li.subtotal > 0        THEN 'new'
           ELSE 'comp' END`;
    const familyCase = `
      CASE WHEN li.name ILIKE '%Investor%' OR li.name ILIKE '%Comped%' THEN 'Comp / Investor'
           WHEN li.name ILIKE '%Premium Two-Park%'                      THEN 'Premium Two-Park'
           WHEN li.name ILIKE '%Two-Park%'                               THEN 'Two-Park'
           WHEN li.name ILIKE '%Blue Bayou%'                              THEN 'Blue Bayou'
           WHEN li.name ILIKE '%Gulf Islands%' OR li.name ILIKE 'GI %'     THEN 'Gulf Islands'
           ELSE 'Other' END`;

    // Upgrades only ever happen in person at the park (per the owner — you
    // can't buy one in advance), so an upgrade's order.created_date is never
    // the upgrade moment itself when it's appended to an existing GA order:
    // it's whenever that order was ORIGINALLY created, which for an
    // advance-purchased GA ticket can be weeks before the actual upgrade,
    // and even for a same-day walk-up ticket may just be when the GA ticket
    // (not the upgrade) was rung up. RocketRez records no per-line-item
    // timestamp for the append (documented in analyticsOrders.js — the same
    // reason line items are replaced rather than diffed on sync), so there
    // is no hour we can trust for an upgrade at all. Hourly view therefore
    // tracks 'new' pass purchases only, where created_date reliably IS the
    // purchase moment; the day's upgrade total is surfaced as a plain
    // non-hourly figure instead of a fabricated hour.
    const salesTrendSql = singleDay
      ? `SELECT to_char(date_trunc('hour', o.created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM') AS "bucket",
                COALESCE(SUM(li.quantity), 0)::int    AS "newQty",
                COALESCE(SUM(li.subtotal), 0)::float   AS "newRevenue"
         ${salesJoin} AND ${kindCase} = 'new'
         GROUP BY date_trunc('hour', o.created_date AT TIME ZONE 'America/Chicago')
         ORDER BY date_trunc('hour', o.created_date AT TIME ZONE 'America/Chicago')`
      : `SELECT (${effDate})::text AS "bucket",
                COALESCE(SUM(li.quantity) FILTER (WHERE ${kindCase} = 'new'), 0)::int      AS "newQty",
                COALESCE(SUM(li.subtotal) FILTER (WHERE ${kindCase} = 'new'), 0)::float     AS "newRevenue",
                COALESCE(SUM(li.quantity) FILTER (WHERE ${kindCase} = 'upgrade'), 0)::int    AS "upgradeQty",
                COALESCE(SUM(li.subtotal) FILTER (WHERE ${kindCase} = 'upgrade'), 0)::float   AS "upgradeRevenue"
         ${salesJoin} GROUP BY 1 ORDER BY 1`;

    const [byProduct, salesTrend, redemptions, redemptionTrend, gaSold, replacementFees] = await Promise.all([
      pool.query(
        `SELECT li.name AS "name", ${kindCase} AS "kind", ${familyCase} AS "family",
                SUM(li.quantity)::int AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float AS "revenue"
         ${salesJoin}
         GROUP BY li.name, 2, 3 ORDER BY "revenue" DESC, "quantity" DESC`,
        params
      ),
      pool.query(salesTrendSql, params),
      pool.query(
        `SELECT COALESCE(SUM(li.quantity), 0)::int AS "total",
                COALESCE(SUM(li.quantity) FILTER (WHERE li.name ILIKE '%Premium%'), 0)::int AS "premium",
                COALESCE(SUM(li.quantity) FILTER (WHERE o.park = 'BB'), 0)::int AS "bb",
                COALESCE(SUM(li.quantity) FILTER (WHERE o.park = 'GI'), 0)::int AS "gi"
         ${redemptionJoin}`,
        params
      ),
      pool.query(
        singleDay
          ? `SELECT to_char(date_trunc('hour', o.created_date AT TIME ZONE 'America/Chicago'), 'FMHH12AM') AS "bucket",
                    SUM(li.quantity)::int AS "visits"
             ${redemptionJoin}
             GROUP BY date_trunc('hour', o.created_date AT TIME ZONE 'America/Chicago')
             ORDER BY date_trunc('hour', o.created_date AT TIME ZONE 'America/Chicago')`
          : `SELECT li.event_date::text AS "bucket", SUM(li.quantity)::int AS "visits"
             ${redemptionJoin} GROUP BY 1 ORDER BY 1`,
        params
      ),
      pool.query(
        `SELECT COALESCE(SUM(li.quantity), 0)::int AS "total"
         FROM analytics_order_line_items li
         JOIN analytics_orders o ON o.order_id = li.order_id
         WHERE o.status = 'Active' AND li.type = 'Rate'
           AND li.name ILIKE '%General Admission Rate%'
           AND li.event_date BETWEEN $1 AND $2${parkSql}`,
        params
      ),
      pool.query(
        `SELECT COALESCE(SUM(li.quantity), 0)::int AS "quantity",
                COALESCE(SUM(li.subtotal), 0)::float AS "revenue"
         FROM analytics_order_line_items li
         JOIN analytics_orders o ON o.order_id = li.order_id
         WHERE o.status = 'Active' AND li.name ILIKE '%Season Pass Replacement Fee%'
           AND o.business_date BETWEEN $1 AND $2${parkSql}`,
        params
      ),
    ]);

    const kinds = { new: { quantity: 0, revenue: 0 }, upgrade: { quantity: 0, revenue: 0 }, comp: { quantity: 0, revenue: 0 } };
    const families = {};
    for (const p of byProduct.rows) {
      kinds[p.kind].quantity += p.quantity;
      kinds[p.kind].revenue  += p.revenue;
      const f = families[p.family] ||= { quantity: 0, revenue: 0 };
      f.quantity += p.quantity;
      f.revenue  += p.revenue;
    }
    const ga = gaSold.rows[0].total;

    res.json({
      kinds,
      families,
      // upgrades per 100 GA guests in range — both sides on visit-date basis
      upgradeCapture: ga ? (kinds.upgrade.quantity / ga) * 100 : null,
      gaGuests: ga,
      replacementFees: replacementFees.rows[0],
      byProduct: byProduct.rows,
      salesTrend: salesTrend.rows,
      redemptions: redemptions.rows[0],
      redemptionTrend: redemptionTrend.rows,
      granularity: singleDay ? 'hour' : 'day',
    });
  } catch (err) {
    console.error('analytics season-passes error:', err.message);
    res.status(500).json({ error: 'Failed to load season pass report' });
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
