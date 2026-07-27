/**
 * Analytics order service — persists every RocketRez order (all parks, all
 * sales offices, not just crew) so the analytics dashboard can query fast
 * historical aggregates from Postgres instead of paging RocketRez live.
 *
 * RocketRez lets line items get appended to an existing order on a later
 * date, and doesn't reliably expose when that happened (no per-line-item
 * timestamp, and `modifiedDate` isn't reliably bumped either). Because of
 * that, line items are always fully deleted and reinserted for an order on
 * every sync rather than diffed — the sync tiers in analyticsOrderSync.js
 * control how quickly a given order's current state is reflected.
 */
import pool from '../db/index.js';
import { fetchOrdersRaw, centralDate, orderPark, sleep } from './rocketrez.js';

// ── Schema ────────────────────────────────────────────────────────────────────

pool.query(`CREATE TABLE IF NOT EXISTS analytics_orders (
  order_id              BIGINT PRIMARY KEY,
  created_date          TIMESTAMPTZ NOT NULL,
  business_date         DATE NOT NULL,
  status                TEXT NOT NULL,
  sales_office_id       INTEGER,
  sales_office_name     TEXT,
  park                  TEXT,
  is_web_order          BOOLEAN NOT NULL DEFAULT FALSE,
  sales_person_name     TEXT,
  contact_group_name    TEXT,
  primary_contact_name  TEXT,
  primary_contact_email TEXT,
  sub_total             NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_total        NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_total              NUMERIC(10,2) NOT NULL DEFAULT 0,
  gratuity_total         NUMERIC(10,2) NOT NULL DEFAULT 0,
  variable_fee_total     NUMERIC(10,2) NOT NULL DEFAULT 0,
  total                  NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_methods        JSONB NOT NULL DEFAULT '[]',
  synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`)
  // The line-items table FKs to this one, so it must exist first — chain
  // rather than firing both CREATE TABLEs independently.
  .then(() => Promise.all([
    pool.query('CREATE INDEX IF NOT EXISTS idx_analytics_orders_bdate ON analytics_orders (business_date)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_analytics_orders_park_bdate ON analytics_orders (park, business_date)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_analytics_orders_office ON analytics_orders (sales_office_name)'),
  ]))
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS analytics_order_line_items (
    id                 BIGSERIAL PRIMARY KEY,
    order_id           BIGINT NOT NULL REFERENCES analytics_orders(order_id) ON DELETE CASCADE,
    line_item_id       BIGINT,
    name               TEXT,
    type               TEXT,
    product_id         INTEGER,
    sales_office_name  TEXT,
    rate_type          TEXT,
    quantity           INTEGER NOT NULL DEFAULT 0,
    price              NUMERIC(10,2) NOT NULL DEFAULT 0,
    subtotal           NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_total          NUMERIC(10,2) NOT NULL DEFAULT 0,
    event_name         TEXT,
    event_date         DATE
  )`))
  .then(() => Promise.all([
    pool.query('CREATE INDEX IF NOT EXISTS idx_analytics_li_order ON analytics_order_line_items (order_id)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_analytics_li_product ON analytics_order_line_items (product_id)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_analytics_li_name ON analytics_order_line_items (name)'),
  ]))
  .catch(e => console.error('analytics_orders/line_items migration:', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS analytics_order_sync_log (
  id            SERIAL PRIMARY KEY,
  range_start   DATE NOT NULL,
  range_end     DATE NOT NULL,
  orders_synced INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL,
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('analytics_order_sync_log migration:', e.message));

// ── Mapping ───────────────────────────────────────────────────────────────────

function mapOrderRow(order) {
  return {
    orderId:             order.id,
    createdDate:         order.createdDate,
    businessDate:        centralDate(order.createdDate),
    status:              order.status,
    salesOfficeId:       order.salesOfficeId ?? null,
    salesOfficeName:     order.salesOfficeName || null,
    park:                orderPark(order),
    isWebOrder:          !!order.isWebOrder,
    salesPersonName:     [order.salesPersonFirstName, order.salesPersonLastName].filter(Boolean).join(' ').trim() || null,
    contactGroupName:    order.contactGroupName?.trim() || null,
    primaryContactName:  [order.primaryContact?.firstName, order.primaryContact?.lastName].filter(Boolean).join(' ').trim() || null,
    primaryContactEmail: order.primaryContact?.email || null,
    subTotal:            order.subTotal || 0,
    discountTotal:       order.discountTotal || 0,
    taxTotal:            order.taxTotal || 0,
    gratuityTotal:       order.gratuityTotal || 0,
    variableFeeTotal:    order.variableFeeTotal || 0,
    total:               order.total || 0,
    paymentMethods:      order.paymentMethods || [],
  };
}

function mapLineItemRows(order) {
  const rows = [];
  for (const li of order.lineItems || []) {
    const rateTypes = li.rateTypes?.length ? li.rateTypes : [{}];
    for (const rt of rateTypes) {
      rows.push({
        orderId:         order.id,
        lineItemId:      li.id ?? null,
        name:            (li.name || '').trim() || null,
        type:            li.type || null,
        productId:       li.productId ?? null,
        salesOfficeName: li.salesOfficeName || null,
        rateType:        rt.rateType || null,
        quantity:        rt.quantity || 0,
        price:           rt.price || 0,
        subtotal:        rt.subTotal || 0,
        taxTotal:        rt.taxTotal || 0,
        eventName:       li.event?.name || null,
        eventDate:       li.event?.schedule?.date || null,
      });
    }
  }
  return rows;
}

// ── Persistence ───────────────────────────────────────────────────────────────
// Line items are always fully replaced for an order (delete + reinsert),
// never diffed — RocketRez only ever gives us an order's current full state.

export async function upsertOrders(rawOrders) {
  let written = 0;

  for (let i = 0; i < rawOrders.length; i += 500) {
    const chunk    = rawOrders.slice(i, i + 500);
    const orderIds = chunk.map(o => o.id);
    const orderRows = chunk.map(mapOrderRow);
    const liRows     = chunk.flatMap(mapLineItemRows);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const oValues = [];
      const oParams = [];
      orderRows.forEach((r, j) => {
        const b = j * 19;
        oValues.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19}::jsonb)`);
        oParams.push(
          r.orderId, r.createdDate, r.businessDate, r.status, r.salesOfficeId, r.salesOfficeName,
          r.park, r.isWebOrder, r.salesPersonName, r.contactGroupName, r.primaryContactName,
          r.primaryContactEmail, r.subTotal, r.discountTotal, r.taxTotal, r.gratuityTotal,
          r.variableFeeTotal, r.total, JSON.stringify(r.paymentMethods),
        );
      });
      if (oValues.length) {
        await client.query(
          `INSERT INTO analytics_orders (
             order_id, created_date, business_date, status, sales_office_id, sales_office_name,
             park, is_web_order, sales_person_name, contact_group_name, primary_contact_name,
             primary_contact_email, sub_total, discount_total, tax_total, gratuity_total,
             variable_fee_total, total, payment_methods
           ) VALUES ${oValues.join(',')}
           ON CONFLICT (order_id) DO UPDATE SET
             created_date = EXCLUDED.created_date, business_date = EXCLUDED.business_date,
             status = EXCLUDED.status, sales_office_id = EXCLUDED.sales_office_id,
             sales_office_name = EXCLUDED.sales_office_name, park = EXCLUDED.park,
             is_web_order = EXCLUDED.is_web_order, sales_person_name = EXCLUDED.sales_person_name,
             contact_group_name = EXCLUDED.contact_group_name, primary_contact_name = EXCLUDED.primary_contact_name,
             primary_contact_email = EXCLUDED.primary_contact_email, sub_total = EXCLUDED.sub_total,
             discount_total = EXCLUDED.discount_total, tax_total = EXCLUDED.tax_total,
             gratuity_total = EXCLUDED.gratuity_total, variable_fee_total = EXCLUDED.variable_fee_total,
             total = EXCLUDED.total, payment_methods = EXCLUDED.payment_methods, synced_at = NOW()`,
          oParams
        );
      }

      if (orderIds.length) {
        await client.query('DELETE FROM analytics_order_line_items WHERE order_id = ANY($1::bigint[])', [orderIds]);
      }

      for (let j = 0; j < liRows.length; j += 300) {
        const liChunk = liRows.slice(j, j + 300);
        const lValues = [];
        const lParams = [];
        liChunk.forEach((r, k) => {
          const b = k * 13;
          lValues.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13})`);
          lParams.push(
            r.orderId, r.lineItemId, r.name, r.type, r.productId, r.salesOfficeName,
            r.rateType, r.quantity, r.price, r.subtotal, r.taxTotal, r.eventName, r.eventDate,
          );
        });
        if (lValues.length) {
          await client.query(
            `INSERT INTO analytics_order_line_items (
               order_id, line_item_id, name, type, product_id, sales_office_name,
               rate_type, quantity, price, subtotal, tax_total, event_name, event_date
             ) VALUES ${lValues.join(',')}`,
            lParams
          );
        }
      }

      await client.query('COMMIT');
      written += orderRows.length;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return written;
}

// ── Sync jobs ─────────────────────────────────────────────────────────────────

function dateStr(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

export async function syncRange(startDate, endDate, source) {
  const orders = await fetchOrdersRaw(startDate, endDate);
  const written = await upsertOrders(orders);
  await pool.query(
    `INSERT INTO analytics_order_sync_log (range_start, range_end, orders_synced, source)
     VALUES ($1, $2, $3, $4)`,
    [startDate, endDate, written, source]
  );
  return written;
}

// Sync a trailing window in weekly chunks so a long backfill can't produce
// one enormous RocketRez request or DB transaction.
export async function syncTrailingDays(days, source) {
  const end = new Date();
  let totalWritten = 0;
  let cursor = new Date(end.getTime() - (days - 1) * 86_400_000);

  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + 6 * 86_400_000, end.getTime()));
    const orders = await fetchOrdersRaw(dateStr(cursor), dateStr(chunkEnd));
    totalWritten += await upsertOrders(orders);
    cursor = new Date(chunkEnd.getTime() + 86_400_000);
    await sleep(1000); // breathe between chunks — background syncs shouldn't crowd out live traffic
  }

  await pool.query(
    `INSERT INTO analytics_order_sync_log (range_start, range_end, orders_synced, source)
     VALUES ($1, $2, $3, $4)`,
    [dateStr(new Date(end.getTime() - (days - 1) * 86_400_000)), dateStr(end), totalWritten, source]
  );
  console.log(`Analytics order sync (${source}): ${totalWritten} orders over ${days} days`);
  return totalWritten;
}

// First boot with an empty table: pull a season's worth of history
export async function ensureBackfilled() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM analytics_orders');
  if (rows[0].n > 0) return false;
  console.log('analytics_orders is empty — backfilling 90 days of history…');
  await syncTrailingDays(90, 'backfill');
  return true;
}

export async function getSyncStatus() {
  const [{ rows: [counts] }, { rows: [last] }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS "totalOrders",
                       MIN(business_date)::text AS earliest,
                       MAX(business_date)::text AS latest
                FROM analytics_orders WHERE status = 'Active'`),
    pool.query(`SELECT range_start::text AS "rangeStart", range_end::text AS "rangeEnd",
                       orders_synced AS "ordersSynced", source, ran_at AS "ranAt"
                FROM analytics_order_sync_log ORDER BY ran_at DESC LIMIT 1`),
  ]);
  return { ...counts, lastSync: last || null };
}
