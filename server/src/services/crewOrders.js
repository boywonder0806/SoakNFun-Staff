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
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

export function buildLiveBreakdown(orders) {
  const grouped = {};
  const meta = { totalOrders: 0, totalAmount: 0, payrollTotal: 0, cardCashTotal: 0, tokenTotal: 0, compTotal: 0, parkPayroll: {} };

  for (const order of orders) {
    if (order.status !== 'Active') continue;
    const m = mapOrder(order);
    if (!m) continue;

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
