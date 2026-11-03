/**
 * Pulls a historical date range of RocketRez orders into analytics_orders in
 * weekly chunks (the same upsert the live sync uses, so re-running is safe).
 *
 *   node server/scripts/backfill-orders.mjs 2023-11-01 2024-11-12
 */
import 'dotenv/config';
import pool from '../src/db/index.js';
import { syncRange } from '../src/services/analyticsOrders.js';
import { sleep } from '../src/services/rocketrez.js';

const [start, end] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) { console.error('usage: backfill-orders.mjs YYYY-MM-DD YYYY-MM-DD'); process.exit(1); }

const day = s => new Date(s + 'T12:00:00Z'), iso = d => d.toISOString().slice(0, 10);
let total = 0, failed = [];
for (let c = day(start); c <= day(end); c = new Date(c.getTime() + 7 * 86_400_000)) {
  const a = iso(c), b = iso(new Date(Math.min(c.getTime() + 6 * 86_400_000, day(end).getTime())));
  try { const n = await syncRange(a, b, 'backfill'); total += n; console.log(`${a} → ${b}: ${n} orders (total ${total})`); }
  catch (e) { failed.push(a); console.log(`${a} → ${b}: FAILED ${e.message}`); }
  await sleep(1500);
}
console.log(`DONE ${total} orders, ${failed.length} failed chunk(s)${failed.length ? ': ' + failed.join(', ') : ''}`);
await pool.end();
