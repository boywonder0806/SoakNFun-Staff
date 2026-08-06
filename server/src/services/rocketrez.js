/**
 * Shared RocketRez API client — OAuth2 token caching, 429-aware fetch, and
 * generic order pagination. Consumed by crewOrders.js and analyticsOrders.js.
 */

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

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Bulk-pull gate ────────────────────────────────────────────────────────
// Crew order sync, and analytics sync's today/recent/nightly tiers, each run
// on their own independent cron schedule — several land on the same minute
// (all fire at :00/:05/:15, and both nightly jobs at 5 AM Central). Left
// uncoordinated, two paginated pulls firing at once blow through RocketRez's
// burst limit and produce sustained 429s that exhaust rrFetch's own retry
// budget, aborting the whole sync. Funnel every bulk pull through one queue
// so only one is ever in flight, regardless of how many jobs start together.
let rrGateTail = Promise.resolve();
function withRRGate(fn) {
  const run = rrGateTail.then(fn, fn);
  rrGateTail = run.then(() => {}, () => {}); // next caller waits regardless of outcome
  return run;
}

// RocketRez throttles bursts with 429s — honor Retry-After and back off
// instead of failing the whole request chain.
export async function rrFetch(url, options, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, options);
    if (r.status !== 429 || attempt >= attempts) return r;
    const retryAfter = parseFloat(r.headers.get('retry-after'));
    const waitMs = !isNaN(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1);
    console.warn(`RocketRez 429 — retrying in ${waitMs}ms (attempt ${attempt}/${attempts})`);
    await sleep(waitMs);
  }
}

export function centralToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

export function centralDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// Pages through GET /v1/orders for a date range, unfiltered — returns every
// order RocketRez has for the window, regardless of type or sales office.
// Gated (see withRRGate above) so concurrent callers queue instead of racing.
export function fetchOrdersRaw(startDate, endDate) {
  return withRRGate(() => fetchOrdersRawInner(startDate, endDate));
}

async function fetchOrdersRawInner(startDate, endDate) {
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
    orders.push(...batch);
    if (batch.length < 250) break;
    pageIndex++;
  }
  return orders;
}

// A line item's revenue lives in rateTypes[].subTotal — li.subTotal doesn't
// exist on RocketRez's response shape (a line item can carry multiple rate types).
export function rrLineItemRevenue(li) {
  return (li.rateTypes || []).reduce((sum, rt) => sum + (rt.subTotal || 0), 0);
}

export function orderPark(order) {
  const office = (order.salesOfficeName || '').trim().toUpperCase();
  if (office.startsWith('BB')) return 'BB';
  if (office.startsWith('GI')) return 'GI';
  return null;
}
