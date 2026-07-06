/**
 * Crew order service — the single source for RocketRez crew-order data.
 *
 * Live requests fetch from RocketRez (short in-memory cache) and write
 * through to the crew_orders table. A nightly cron re-syncs a trailing
 * window so voids, refunds, and corrections made after the fact are
 * reflected in stored history.
 */
import pool from '../db/index.js';

// ── Schema ────────────────────────────────────────────────────────────────────

pool.query(`CREATE TABLE IF NOT EXISTS crew_orders (
  order_id       BIGINT PRIMARY KEY,
  order_date     TIMESTAMPTZ NOT NULL,
  business_date  DATE NOT NULL,
  employee_name  TEXT NOT NULL,
  home_park      TEXT NOT NULL,
  park           TEXT,
  status         TEXT NOT NULL,
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  payroll        NUMERIC(10,2) NOT NULL DEFAULT 0,
  card_cash      NUMERIC(10,2) NOT NULL DEFAULT 0,
  token_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  comp           NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  items          JSONB NOT NULL DEFAULT '[]',
  cashier        TEXT,
  cross_park     BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).then(() => Promise.all([
  pool.query('CREATE INDEX IF NOT EXISTS idx_crew_orders_employee ON crew_orders (employee_name, home_park)'),
  pool.query('CREATE INDEX IF NOT EXISTS idx_crew_orders_bdate ON crew_orders (business_date)'),
])).catch(e => console.error('crew_orders migration:', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS crew_order_sync_log (
  id            SERIAL PRIMARY KEY,
  range_start   DATE NOT NULL,
  range_end     DATE NOT NULL,
  orders_synced INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL,
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('crew_order_sync_log migration:', e.message));

// HR review decisions on cross-park purchasing: 'approved' means the employee
// is allowed to buy at the other park and is no longer flagged; 'denied' keeps
// the flag and records that it was reviewed. No row = not yet reviewed.
pool.query(`CREATE TABLE IF NOT EXISTS crew_crosspark_reviews (
  id            SERIAL PRIMARY KEY,
  employee_name TEXT NOT NULL,
  home_park     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('approved','denied')),
  reviewed_by   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_name, home_park)
)`).catch(e => console.error('crew_crosspark_reviews migration:', e.message));

// ── RocketRez auth ────────────────────────────────────────────────────────────

let rrCachedToken = null;
let rrTokenExpiry = 0;

export async function getRRToken() {
  if (rrCachedToken && Date.now() < rrTokenExpiry - 60_000) return rrCachedToken;
  const res = await fetch(`${process.env.ROCKETREZ_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.ROCKETREZ_CLIENT_ID,
      client_secret: process.env.ROCKETREZ_CLIENT_SECRET,
      scope: 'read_orders',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`RocketRez auth failed: ${res.status}`);
  const data = await res.json();
  rrCachedToken = data.data.access_token;
  rrTokenExpiry = new Date(data.data.expiry).getTime();
  return rrCachedToken;
}

// ── Fetch + classify ──────────────────────────────────────────────────────────
// Crew orders are kept in ALL statuses here (voids/refunds must overwrite
// stored rows); the live breakdown filters to Active at build time.

const crewOrderCache = new Map(); // "start:end" → { orders, fetchedAt }
const CREW_TTL_TODAY = 5 * 60 * 1000;
const CREW_TTL_PAST  = 60 * 60 * 1000;

export function centralToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// RocketRez throttles bursts with 429s — honor Retry-After and back off
// instead of failing the whole request chain.
async function rrFetch(url, options, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, options);
    if (r.status !== 429 || attempt >= attempts) return r;
    const retryAfter = parseFloat(r.headers.get('retry-after'));
    const waitMs = !isNaN(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1);
    console.warn(`RocketRez 429 — retrying in ${waitMs}ms (attempt ${attempt}/${attempts})`);
    await sleep(waitMs);
  }
}

export async function fetchCrewOrders(startDate, endDate) {
  const ttl    = endDate >= centralToday() ? CREW_TTL_TODAY : CREW_TTL_PAST;
  const key    = `${startDate}:${endDate}`;
  const cached = crewOrderCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached;

  const token = await getRRToken();
  const base  = (process.env.ROCKETREZ_BASE_URL || '').replace(/\/$/, '');

  const orders = [];
  let pageIndex = 0;
  while (true) {
    const url = `${base}/v1/orders?startDate=${startDate}&endDate=${endDate}&pageSize=250&pageIndex=${pageIndex}`;
    const r = await rrFetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`RocketRez orders API: ${r.status}`);
    const data  = await r.json();
    const batch = Array.isArray(data.data) ? data.data : [];
    orders.push(...batch.filter(o => o.contactGroupName?.trim()));
    if (batch.length < 250) break;
    pageIndex++;
  }

  const entry = { orders, fetchedAt: Date.now() };
  crewOrderCache.set(key, entry);
  for (const [k, v] of crewOrderCache) {
    if (Date.now() - v.fetchedAt > CREW_TTL_PAST) crewOrderCache.delete(k);
  }

  // Write through to the history table — deliberately not awaited so the
  // live request isn't slowed down by the database.
  upsertOrders(orders).catch(e => console.error('crew order write-through:', e.message));

  return entry;
}

// A line item's revenue lives in rateTypes[].subTotal — li.subTotal doesn't
// exist on RocketRez's response shape (can carry multiple rateTypes).
export function rrLineItemRevenue(li) {
  return (li.rateTypes || []).reduce((sum, rt) => sum + (rt.subTotal || 0), 0);
}

export function classifyCrewPayments(paymentMethods, orderTotal) {
  const buckets = { payroll: 0, card: 0, cash: 0, token: 0, comp: 0 };
  for (const pm of (paymentMethods || [])) {
    const m   = (pm.paymentMethod || '').toLowerCase();
    const amt = pm.paymentAmount || 0;
    if      (m.includes('payroll'))                                            buckets.payroll += amt;
    else if (m.includes('token'))                                              buckets.token   += amt;
    else if (m.includes('cash') && !m.includes('card'))                        buckets.cash    += amt;
    else if (m.includes('stripe') || m.includes('card') || m.includes('visa') ||
             m.includes('mastercard') || m.includes('amex') || m.includes('discover') ||
             m.includes('nayax') || m.includes('paypal') || m.includes('pre-paid')) buckets.card += amt;
    else                                                                       buckets.comp    += amt;
  }
  if (!paymentMethods?.length) buckets.comp += orderTotal || 0;

  const LABEL = { payroll: 'payroll_deduction', card: 'stripe', cash: 'cash', token: 'token', comp: 'comp' };
  const dominant = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
  return { ...buckets, primary: LABEL[dominant[1] > 0 ? dominant[0] : 'comp'] };
}

export function orderPark(order) {
  const office = (order.salesOfficeName || '').trim().toUpperCase();
  if (office.startsWith('BB')) return 'BB';
  if (office.startsWith('GI')) return 'GI';
  return null;
}

// Normalize one RocketRez order into the stored/served row shape
function mapOrder(order) {
  const rawName  = order.contactGroupName.trim();
  const homePark = /^\(BB\)/i.test(rawName) ? 'BB' : 'GI';
  const name     = rawName.replace(/^\(BB\)\s*/i, '').trim();
  if (!name) return null;

  const pay  = classifyCrewPayments(order.paymentMethods, order.total);
  const park = orderPark(order) || homePark;
  const items = (order.lineItems || [])
    .map(li => ({
      name: (li.name || '')
        .replace(/\s*\((BB|GI)\s*Employee\)/gi, '')
        .replace(/\s*-\s*Token\b/gi, '')
        .trim(),
      amount: +rrLineItemRevenue(li).toFixed(2),
    }))
    .filter(li => li.name);

  return {
    orderId:      order.id,
    date:         order.createdDate,
    businessDate: new Date(order.createdDate).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }),
    employeeName: name,
    homePark,
    park,
    status:       order.status,
    total:        +(order.total || 0).toFixed(2),
    payroll:      +pay.payroll.toFixed(2),
    cardCash:     +(pay.card + pay.cash).toFixed(2),
    token:        +pay.token.toFixed(2),
    comp:         +pay.comp.toFixed(2),
    paymentMethod: pay.primary,
    items,
    cashier: [order.salesPersonFirstName, order.salesPersonLastName].filter(Boolean).join(' ')
      .replace(/^BB\s*-?\s*/i, '').trim() || null,
    crossPark: park !== homePark,
  };
}

// ── Live breakdown (Active orders only) ───────────────────────────────────────

// ── Range loader — database for past days, RocketRez only for today ──────────
// Past business dates are already in crew_orders (write-through + nightly 5 AM
// re-sync), so a date-range search shouldn't re-pull them from RocketRez. Only
// today can't be served from the table, since sales are still coming in.

async function queryStoredRows(startDate, endDate) {
  const { rows } = await pool.query(
    `SELECT order_id AS "orderId", order_date AS "date", business_date::text AS "businessDate",
            employee_name AS "employeeName", home_park AS "homePark", park,
            total::float AS total, payroll::float AS payroll, card_cash::float AS "cardCash",
            token_amount::float AS token, comp::float AS comp,
            payment_method AS "paymentMethod", items, cashier, cross_park AS "crossPark"
     FROM crew_orders
     WHERE status = 'Active' AND business_date BETWEEN $1 AND $2`,
    [startDate, endDate]
  );
  return rows;
}

function mapActiveOrders(orders) {
  return orders.filter(o => o.status === 'Active').map(mapOrder).filter(Boolean);
}

export async function getOrdersForRange(startDate, endDate) {
  const today = centralToday();
  const { rows: [cov] } = await pool.query(
    `SELECT MIN(business_date)::text AS earliest FROM crew_orders`
  );
  // The table is only authoritative from its earliest synced date — ranges
  // reaching further back still need a full RocketRez pull.
  const dbCanServe = cov.earliest && startDate >= cov.earliest;

  if (dbCanServe && endDate < today) {
    return { rows: await queryStoredRows(startDate, endDate), source: 'database', fetchedAt: Date.now() };
  }

  if (dbCanServe && startDate < today) {
    const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000)
      .toISOString().slice(0, 10);
    const [stored, live] = await Promise.all([
      queryStoredRows(startDate, yesterday),
      fetchCrewOrders(today, endDate),
    ]);
    return { rows: [...stored, ...mapActiveOrders(live.orders)], source: 'database+live', fetchedAt: live.fetchedAt };
  }

  const { orders, fetchedAt } = await fetchCrewOrders(startDate, endDate);
  return { rows: mapActiveOrders(orders), source: 'live', fetchedAt };
}

export function buildLiveBreakdown(orders) {
  return buildBreakdownFromRows(mapActiveOrders(orders));
}

// Map of "name|homePark" (name lowercased) → 'approved' | 'denied'
export async function getCrossParkReviews() {
  const { rows } = await pool.query(
    `SELECT employee_name, home_park, status FROM crew_crosspark_reviews`
  );
  return new Map(rows.map(r => [`${r.employee_name.toLowerCase()}|${r.home_park}`, r.status]));
}

export function crossParkReviewKey(employeeName, homePark) {
  return `${(employeeName || '').toLowerCase()}|${homePark}`;
}

export function buildBreakdownFromRows(rows) {
  const grouped = {};
  const meta = { totalOrders: 0, totalAmount: 0, payrollTotal: 0, cardCashTotal: 0, tokenTotal: 0, compTotal: 0, parkPayroll: {} };

  for (const m of rows) {
    if (!grouped[m.employeeName]) {
      grouped[m.employeeName] = {
        employeeName: m.employeeName, transactionCount: 0, totalAmount: 0, payrollTotal: 0,
        parks: new Set(), homePark: m.homePark, crossParkCount: 0, transactions: [],
      };
    }
    const g = grouped[m.employeeName];
    g.transactionCount++;
    g.totalAmount  += m.total;
    g.payrollTotal += m.payroll;
    g.parks.add(m.park);
    if (m.crossPark) g.crossParkCount++;
    g.transactions.push({
      date: m.date, orderId: m.orderId,
      description: m.items.map(i => i.name).join(', ') || null,
      items: m.items, amount: m.total, paymentMethod: m.paymentMethod,
      payroll: m.payroll, cardCash: m.cardCash, token: m.token,
      park: m.park, homePark: m.homePark, crossPark: m.crossPark, cashier: m.cashier,
    });

    meta.totalOrders++;
    meta.totalAmount   += m.total;
    meta.payrollTotal  += m.payroll;
    meta.cardCashTotal += m.cardCash;
    meta.tokenTotal    += m.token;
    meta.compTotal     += m.comp;
    if (m.payroll > 0) {
      meta.parkPayroll[m.park] = +((meta.parkPayroll[m.park] || 0) + m.payroll).toFixed(2);
    }
  }

  const breakdown = Object.values(grouped)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
    .map(g => {
      const parksArr = [...g.parks].sort();
      g.transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
      return {
        ...g,
        parks: parksArr,
        park:  parksArr.length === 1 ? parksArr[0] : (parksArr.length > 1 ? 'MULTI' : null),
        totalAmount:  g.totalAmount.toFixed(2),
        payrollTotal: g.payrollTotal.toFixed(2),
      };
    });

  for (const k of ['totalAmount', 'payrollTotal', 'cardCashTotal', 'tokenTotal', 'compTotal']) {
    meta[k] = +meta[k].toFixed(2);
  }
  return { meta, breakdown };
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function upsertOrders(orders) {
  const rows = orders.map(mapOrder).filter(Boolean);
  let written = 0;

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = [];
    const params = [];
    chunk.forEach((r, j) => {
      const b = j * 16;
      values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16})`);
      params.push(
        r.orderId, r.date, r.businessDate, r.employeeName, r.homePark, r.park,
        r.status, r.total, r.payroll, r.cardCash, r.token, r.comp,
        r.paymentMethod, JSON.stringify(r.items), r.cashier, r.crossPark,
      );
    });
    await pool.query(
      `INSERT INTO crew_orders (
         order_id, order_date, business_date, employee_name, home_park, park,
         status, total, payroll, card_cash, token_amount, comp,
         payment_method, items, cashier, cross_park
       ) VALUES ${values.join(',')}
       ON CONFLICT (order_id) DO UPDATE SET
         order_date = EXCLUDED.order_date, business_date = EXCLUDED.business_date,
         employee_name = EXCLUDED.employee_name, home_park = EXCLUDED.home_park,
         park = EXCLUDED.park, status = EXCLUDED.status, total = EXCLUDED.total,
         payroll = EXCLUDED.payroll, card_cash = EXCLUDED.card_cash,
         token_amount = EXCLUDED.token_amount, comp = EXCLUDED.comp,
         payment_method = EXCLUDED.payment_method, items = EXCLUDED.items,
         cashier = EXCLUDED.cashier, cross_park = EXCLUDED.cross_park,
         synced_at = NOW()`,
      params
    );
    written += chunk.length;
  }
  return written;
}

// ── Sync jobs ─────────────────────────────────────────────────────────────────

function dateStr(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// Sync a trailing window in weekly chunks so a long backfill can't produce
// one enormous RocketRez request or DB transaction.
export async function syncTrailingDays(days, source) {
  const end = new Date();
  let totalWritten = 0;
  let cursor = new Date(end.getTime() - (days - 1) * 86_400_000);

  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + 6 * 86_400_000, end.getTime()));
    const { orders } = await fetchCrewOrders(dateStr(cursor), dateStr(chunkEnd));
    totalWritten += await upsertOrders(orders);
    cursor = new Date(chunkEnd.getTime() + 86_400_000);
    await sleep(1000); // breathe between chunks — background syncs shouldn't crowd out live traffic
  }

  await pool.query(
    `INSERT INTO crew_order_sync_log (range_start, range_end, orders_synced, source)
     VALUES ($1, $2, $3, $4)`,
    [dateStr(new Date(end.getTime() - (days - 1) * 86_400_000)), dateStr(end), totalWritten, source]
  );
  console.log(`Crew order sync (${source}): ${totalWritten} orders over ${days} days`);
  return totalWritten;
}

// First boot with an empty table: pull a season's worth of history
export async function ensureBackfilled() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM crew_orders');
  if (rows[0].n > 0) return false;
  console.log('crew_orders is empty — backfilling 90 days of history…');
  await syncTrailingDays(90, 'backfill');
  return true;
}

export async function getSyncStatus() {
  const [{ rows: [counts] }, { rows: [last] }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS "totalOrders",
                       MIN(business_date)::text AS earliest,
                       MAX(business_date)::text AS latest
                FROM crew_orders WHERE status = 'Active'`),
    pool.query(`SELECT range_start::text AS "rangeStart", range_end::text AS "rangeEnd",
                       orders_synced AS "ordersSynced", source, ran_at AS "ranAt"
                FROM crew_order_sync_log ORDER BY ran_at DESC LIMIT 1`),
  ]);
  return { ...counts, lastSync: last || null };
}
