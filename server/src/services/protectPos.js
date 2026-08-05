/**
 * Posts RocketRez orders to UniFi Protect as POS transaction events, so the
 * transaction overlays on the matching camera's recorded footage.
 *
 * Scope is deliberately narrow: only the 'BB Crew Kitchen' sales office ->
 * the Crew Line camera. RocketRez's Orders API exposes no terminal/register
 * field anywhere (checked every nested key on a real order, and probed for
 * a terminals/registers/reports endpoint — all 404), so sales office is the
 * finest-grained signal available. Crew Kitchen is the one office that maps
 * cleanly to a single physical line with no other stands mixed in — most
 * other offices (e.g. BB Food & Beverage) cover many stands park-wide and
 * would misattribute other registers' sales onto one camera's footage.
 *
 * Idempotency: Protect's own externalId dedup is in-memory/per-process and
 * resets on restart, so it can't be trusted alone — analytics_pos_events is
 * the durable record of what's already been posted, checked before every
 * send. Failures are retried (capped) on the next sync tick; successes never
 * repost.
 */
import pool from '../db/index.js';
import { Agent } from 'undici';

// The NVR presents a self-signed cert (same reason the DB pool and the
// Protect camera-auth curl checks use rejectUnauthorized: false) — scoped to
// just this Agent so it never weakens TLS for RocketRez/Stripe/anything else.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

pool.query(`CREATE TABLE IF NOT EXISTS analytics_pos_events (
  order_id   BIGINT PRIMARY KEY,
  camera_id  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'posted',
  event_id   TEXT,
  attempts   INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  posted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('analytics_pos_events migration:', e.message));

const MAX_ATTEMPTS = 5;

function cameraId() {
  return process.env.PROTECT_CREW_LINE_CAMERA_ID;
}

async function postTransaction(camId, payload) {
  const url = `${process.env.PROTECT_NVR_URL}/proxy/protect/integration/v1/pos/cameras/${camId}/transactions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.PROTECT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    dispatcher: insecureAgent,
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

// order.total < 0 covers the rare fully-refunded Crew Kitchen order; Protect
// wants a non-negative amount plus a direction, not a signed amount.
function buildPayload(order, lineItems) {
  const total = Number(order.total);
  return {
    type: total < 0 ? 'refund' : 'sale',
    externalId: `bayoustaff-order-${order.order_id}`,
    amount: Math.abs(total),
    currency: 'USD',
    lineItems: lineItems.slice(0, 200).map(li => ({
      title: li.name,
      quantity: li.quantity,
      price: Number(li.price),
    })),
    location: {
      id: order.sales_office_id != null ? String(order.sales_office_id) : '',
      name: (order.sales_office_name || '').trim(),
    },
    paymentTypes: (order.payment_methods || [])
      .map(pm => pm.paymentMethod).filter(Boolean).slice(0, 20),
    timestamp: new Date(order.created_date).getTime(),
  };
}

async function recordSuccess(orderId, camId, eventId) {
  await pool.query(
    `INSERT INTO analytics_pos_events (order_id, camera_id, status, event_id, posted_at)
     VALUES ($1, $2, 'posted', $3, NOW())
     ON CONFLICT (order_id) DO UPDATE SET
       status = 'posted', camera_id = EXCLUDED.camera_id, event_id = EXCLUDED.event_id, posted_at = NOW()`,
    [orderId, camId, eventId || null]
  );
}

async function recordFailure(orderId, camId, message) {
  console.error(`Protect POS post failed for order ${orderId}:`, message);
  await pool.query(
    `INSERT INTO analytics_pos_events (order_id, camera_id, status, attempts, last_error, posted_at)
     VALUES ($1, $2, 'failed', 1, $3, NOW())
     ON CONFLICT (order_id) DO UPDATE SET
       status = 'failed', attempts = analytics_pos_events.attempts + 1,
       last_error = EXCLUDED.last_error, posted_at = NOW()`,
    [orderId, camId, message]
  );
}

// Finds Crew Kitchen orders from the last 23h (Protect rejects anything
// >24h old — the 1h margin covers however long a run takes) not yet posted
// (or failed with attempts still under the cap), posts each, and records
// the outcome. Safe to call repeatedly — already-posted orders are skipped.
export async function syncCrewLineToProtect() {
  const camId = cameraId();
  if (!camId || !process.env.PROTECT_API_KEY) return; // not configured on this environment — no-op

  const { rows: orders } = await pool.query(
    `SELECT o.order_id, o.created_date, o.total, o.sales_office_id, o.sales_office_name, o.payment_methods
     FROM analytics_orders o
     LEFT JOIN analytics_pos_events e ON e.order_id = o.order_id
     WHERE o.status = 'Active'
       AND TRIM(o.sales_office_name) = 'BB Crew Kitchen'
       AND o.created_date > NOW() - INTERVAL '23 hours'
       AND (e.order_id IS NULL OR (e.status = 'failed' AND e.attempts < $1))
     ORDER BY o.created_date`,
    [MAX_ATTEMPTS]
  );
  if (!orders.length) return;

  const { rows: liRows } = await pool.query(
    `SELECT order_id, name, quantity, price, subtotal FROM analytics_order_line_items
     WHERE order_id = ANY($1::bigint[])`,
    [orders.map(o => o.order_id)]
  );
  const liByOrder = new Map();
  for (const li of liRows) {
    if (!liByOrder.has(li.order_id)) liByOrder.set(li.order_id, []);
    liByOrder.get(li.order_id).push(li);
  }

  let posted = 0, failed = 0;
  for (const order of orders) {
    const payload = buildPayload(order, liByOrder.get(order.order_id) || []);
    try {
      const { ok, status, body } = await postTransaction(camId, payload);
      if (ok) {
        await recordSuccess(order.order_id, camId, body?.eventId);
        posted++;
      } else if (status === 409) {
        // Protect is mid-processing a duplicate of this externalId — leave
        // unrecorded so the next tick retries once it clears.
        console.warn(`Protect POS 409 for order ${order.order_id}, will retry next tick`);
      } else {
        await recordFailure(order.order_id, camId, `HTTP ${status}: ${JSON.stringify(body)}`);
        failed++;
      }
    } catch (e) {
      await recordFailure(order.order_id, camId, e.message);
      failed++;
    }
  }
  if (posted || failed) console.log(`Protect POS sync (Crew Line): ${posted} posted, ${failed} failed`);
}
