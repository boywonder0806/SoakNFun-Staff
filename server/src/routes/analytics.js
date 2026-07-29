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
