import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireBot } from '../middleware/auth.js';

const router    = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── RocketRez auth ─────────────────────────────────────────────────────────
let rrCachedToken = null;
let rrTokenExpiry = 0;

async function getRRToken() {
  if (rrCachedToken && Date.now() < rrTokenExpiry - 60_000) return rrCachedToken;
  const res = await fetch(`${process.env.ROCKETREZ_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.ROCKETREZ_CLIENT_ID,
      client_secret: process.env.ROCKETREZ_CLIENT_SECRET,
      scope:         'read_orders',
      grant_type:    'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`RocketRez auth failed: ${res.status}`);
  const data = await res.json();
  rrCachedToken = data.data.access_token;
  rrTokenExpiry = new Date(data.data.expiry).getTime();
  return rrCachedToken;
}

// Order cache — keyed by "startDate:endDate"
// Historical dates cache for 1 hour; today's data refreshes every 5 minutes
const orderCache = new Map();
const TTL_TODAY = 5  * 60 * 1000;
const TTL_PAST  = 60 * 60 * 1000;

// Fetch every order in a date range — no filtering, with caching
async function fetchAllOrders(startDate, endDate) {
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const ttl    = endDate >= today ? TTL_TODAY : TTL_PAST;
  const key    = `${startDate}:${endDate}`;
  const cached = orderCache.get(key);

  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.data;
  }

  const token = await getRRToken();
  const base  = process.env.ROCKETREZ_BASE_URL;
  let pageIndex = 0;
  const all = [];

  while (true) {
    const url = `${base}/v1/orders?startDate=${startDate}&endDate=${endDate}&pageSize=250&pageIndex=${pageIndex}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`RocketRez orders failed: ${res.status}`);
    const json  = await res.json();
    const batch = json.data || [];
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 250) break;
    pageIndex++;
  }

  orderCache.set(key, { data: all, fetchedAt: Date.now() });

  // Evict stale entries so a long-running process doesn't accumulate
  // every date range ever queried.
  for (const [k, v] of orderCache) {
    if (Date.now() - v.fetchedAt > TTL_PAST) orderCache.delete(k);
  }

  return all;
}

// ── Payment helpers ────────────────────────────────────────────────────────
function classifyPayments(paymentMethods) {
  let payroll = 0, cashCard = 0, token = 0, prePaid = 0, comp = 0;
  if (!paymentMethods?.length) return { payroll, cashCard, token, prePaid, comp };
  for (const pm of paymentMethods) {
    const m   = (pm.paymentMethod || '').toLowerCase();
    const amt = pm.paymentAmount  || 0;
    if      (m.includes('payroll'))                                                                        payroll  += amt;
    else if (m.includes('token'))                                                                          token    += amt;
    else if (m.includes('pre-paid'))                                                                       prePaid  += amt;
    else if (m.includes('stripe') || m.includes('card') || m.includes('cash') ||
             m.includes('mastercard') || m.includes('visa') || m.includes('amex') ||
             m.includes('discover') || m.includes('nayax') || m.includes('paypal'))                        cashCard += amt;
    else                                                                                                   comp     += amt;
  }
  return { payroll, cashCard, token, prePaid, comp };
}

// Exclude Cancelled, Void, Estimate and Return Processed orders from revenue
// aggregates — these inflate totals by ~$100k/month in the live data.
// get_order_by_id still returns any status since you may look up a cancelled order.
const ACTIVE_STATUSES = new Set(['Active']);
function activeOnly(orders) {
  return orders.filter(o => ACTIVE_STATUSES.has(o.status));
}

// Filter orders to a single park by sales office name prefix ("BB ..." / "GI ...").
// Park-agnostic offices (Admin, Accounting, etc.) are excluded from BB/GI-specific
// filters since they don't belong to either park.
function filterByPark(orders, park) {
  if (!park || park === 'both') return orders;
  const prefix = park.toUpperCase();
  return orders.filter(o => (o.salesOfficeName || '').trim().toUpperCase().startsWith(prefix));
}

// Scale the per-call order cap to the size of the date range — narrow ranges
// can afford far more detail per order than wide ones without bloating the
// tool result sent to the model.
function limitForDateRange(startDate, endDate) {
  const days = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86_400_000) + 1);
  if (days <= 1)  return 500;
  if (days <= 3)  return 400;
  if (days <= 7)  return 300;
  if (days <= 14) return 200;
  return 150;
}

// A line item's actual revenue lives in rateTypes[].subTotal, not on the
// line item itself — li.subTotal doesn't exist on RocketRez's response shape.
// A line item can carry multiple rateTypes (e.g. bundled components), so sum them.
function lineItemRevenue(li) {
  return (li.rateTypes || []).reduce((sum, rt) => sum + (rt.subTotal || 0), 0);
}

function paymentTypeLabel(paymentMethod) {
  const m = (paymentMethod || '').toLowerCase();
  if (m.includes('payroll'))                                                              return 'Payroll Deduction';
  if (m.includes('token'))                                                                return 'Token';
  if (m.includes('pre-paid'))                                                             return 'Pre-Paid Pass';
  if (m.includes('nayax'))                                                                return 'Nayax (Kiosk)';
  if (m.includes('paypal'))                                                               return 'PayPal';
  if (m.includes('cash'))                                                                 return 'Cash';
  if (m.includes('stripe') || m.includes('card') || m.includes('mastercard') ||
      m.includes('visa') || m.includes('amex') || m.includes('discover'))                return 'Card';
  return 'Comp / Other';
}

// ── Tool 1: Full order summary (all order types) ───────────────────────────
async function toolGetOrderSummary(startDate, endDate, park = 'both') {
  const orders = activeOnly(filterByPark(await fetchAllOrders(startDate, endDate), park));

  // Accumulators
  const officeMap    = {};
  const itemMap      = {};
  const hourMap      = {};
  const pmTypeMap    = {};
  let totalRevenue   = 0;
  let crewCount      = 0;
  let crewRevenue    = 0;

  for (const order of orders) {
    const rev    = order.total || 0;
    totalRevenue += rev;

    const isCrew = !!order.contactGroupName?.trim();
    if (isCrew) { crewCount++; crewRevenue += rev; }

    // By sales office
    const office = order.salesOfficeName || 'Unknown';
    if (!officeMap[office]) officeMap[office] = { orderCount: 0, revenue: 0 };
    officeMap[office].orderCount++;
    officeMap[office].revenue = +(officeMap[office].revenue + rev).toFixed(2);

    // By payment type
    for (const pm of (order.paymentMethods || [])) {
      const label = paymentTypeLabel(pm.paymentMethod);
      if (!pmTypeMap[label]) pmTypeMap[label] = 0;
      pmTypeMap[label] = +(pmTypeMap[label] + (pm.paymentAmount || 0)).toFixed(2);
    }

    // By hour (Central Time)
    const hour = new Date(order.createdDate).toLocaleString('en-US', {
      hour: '2-digit', hour12: false, timeZone: 'America/Chicago',
    }).padStart(2, '0') + ':00';
    if (!hourMap[hour]) hourMap[hour] = { orderCount: 0, revenue: 0 };
    hourMap[hour].orderCount++;
    hourMap[hour].revenue = +(hourMap[hour].revenue + rev).toFixed(2);

    // By line item
    for (const li of (order.lineItems || [])) {
      const name = (li.name || 'Unknown').trim();
      if (!itemMap[name]) itemMap[name] = { count: 0, revenue: 0 };
      itemMap[name].count++;
      itemMap[name].revenue = +(itemMap[name].revenue + lineItemRevenue(li)).toFixed(2);
    }
  }

  const bySalesOffice = Object.entries(officeMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  const topLineItems = Object.entries(itemMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const byHour = Object.entries(hourMap)
    .map(([hour, v]) => ({ hour, ...v }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  return {
    park,
    startDate,
    endDate,
    totalOrders:   orders.length,
    totalRevenue:  +totalRevenue.toFixed(2),
    byPaymentType: pmTypeMap,
    bySalesOffice,
    topLineItems,
    byHour,
    crewOrders: { count: crewCount, revenue: +crewRevenue.toFixed(2) },
    availableSalesOffices: [...new Set(orders.map(o => o.salesOfficeName).filter(Boolean))].sort(),
  };
}

// ── Tool 2: Crew orders — employee-level payroll breakdown ─────────────────
async function toolGetCrewOrders(startDate, endDate, park = 'both') {
  const orders = activeOnly(await fetchAllOrders(startDate, endDate))
    .filter(o => o.contactGroupName?.trim());

  const byEmp = {};
  for (const order of orders) {
    const rawName  = order.contactGroupName.trim();
    const isBB     = /^\(BB\)/i.test(rawName);
    const empPark  = isBB ? 'BB' : 'GI';
    const name     = rawName.replace(/^\(BB\)\s*/i, '').trim();
    if (!name) continue;
    if (park !== 'both' && empPark !== park.toUpperCase()) continue;

    const key = `${empPark}:${name}`;
    if (!byEmp[key]) {
      byEmp[key] = { name, park: empPark, orderCount: 0, payrollTotal: 0, cashCardTotal: 0, tokenTotal: 0, compTotal: 0, orders: [] };
    }

    const { payroll, cashCard, token, comp } = classifyPayments(order.paymentMethods);
    byEmp[key].payrollTotal   += payroll;
    byEmp[key].cashCardTotal  += cashCard;
    byEmp[key].tokenTotal     += token;
    byEmp[key].compTotal      += comp;
    byEmp[key].orderCount++;
    byEmp[key].orders.push({
      orderId:  order.id,
      date:     order.createdDate,
      items:    (order.lineItems || [])
        .map(li => ({
          name:   (li.name || '').replace(/\s*\((BB|GI)\s*Employee\)/gi, '').replace(/\s*-\s*Token\b/gi, '').trim(),
          amount: lineItemRevenue(li),
        }))
        .filter(li => li.name),
      payroll:  +payroll.toFixed(2),
      cashCard: +cashCard.toFixed(2),
      token:    +token.toFixed(2),
      comp:     +comp.toFixed(2),
    });
  }

  const breakdown = Object.values(byEmp)
    .map(e => ({
      ...e,
      payrollTotal:  +e.payrollTotal.toFixed(2),
      cashCardTotal: +e.cashCardTotal.toFixed(2),
      tokenTotal:    +e.tokenTotal.toFixed(2),
      compTotal:     +e.compTotal.toFixed(2),
    }))
    .sort((a, b) => b.payrollTotal - a.payrollTotal);

  const totals = breakdown.reduce((s, e) => ({
    employees: s.employees + 1,
    orders:    s.orders    + e.orderCount,
    payroll:   +(s.payroll   + e.payrollTotal).toFixed(2),
    cashCard:  +(s.cashCard  + e.cashCardTotal).toFixed(2),
    token:     +(s.token     + e.tokenTotal).toFixed(2),
    comp:      +(s.comp      + e.compTotal).toFixed(2),
  }), { employees: 0, orders: 0, payroll: 0, cashCard: 0, token: 0, comp: 0 });

  return { park, startDate, endDate, totals, breakdown };
}

// ── Tool 3: Orders by sales office — individual order detail ───────────────
async function toolGetOrdersByOffice(startDate, endDate, salesOfficeName, sortOrder = 'desc') {
  const allOrders = activeOnly(await fetchAllOrders(startDate, endDate));
  const filtered  = allOrders.filter(o =>
    (o.salesOfficeName || '').toLowerCase().includes(salesOfficeName.toLowerCase())
  );

  // Sort before slicing so the cap always captures the right end of the dataset
  filtered.sort((a, b) => sortOrder === 'asc'
    ? new Date(a.createdDate) - new Date(b.createdDate)
    : new Date(b.createdDate) - new Date(a.createdDate)
  );

  const LIMIT = limitForDateRange(startDate, endDate);
  const slice = filtered.slice(0, LIMIT);

  const mapped = slice.map(o => ({
    orderId:      o.id,
    date:         o.createdDate,
    status:       o.status,
    isWebOrder:   o.isWebOrder || false,
    salesOffice:  o.salesOfficeName,
    salesPerson:  `${o.salesPersonFirstName || ''} ${o.salesPersonLastName || ''}`.trim() || null,
    contactGroup: o.contactGroupName || null,
    customer:     o.primaryContact ? {
      name: `${o.primaryContact.firstName || ''} ${o.primaryContact.lastName || ''}`.trim(),
    } : null,
    total:        o.total,
    paymentTypes: (o.paymentMethods || []).map(pm => ({
      type:   paymentTypeLabel(pm.paymentMethod),
      raw:    pm.paymentMethod,
      amount: pm.paymentAmount,
    })),
    items: (o.lineItems || []).map(li => ({
      name:   (li.name || '').trim(),
      amount: lineItemRevenue(li),
      event:  li.event ? {
        type:      li.event.type,
        name:      li.event.name,
        date:      li.event.schedule?.date || null,
        startTime: li.event.schedule?.startTime || null,
        endTime:   li.event.schedule?.endTime || null,
      } : null,
    })),
  }));

  return {
    salesOfficeName,
    startDate,
    endDate,
    totalMatching:    filtered.length,
    returned:         mapped.length,
    truncated:        filtered.length > LIMIT,
    totalRevenue:     +filtered.reduce((s, o) => s + (o.total || 0), 0).toFixed(2),
    orders:           mapped,
  };
}

// ── Tool 4: Keyword search across all line items ───────────────────────────
async function toolSearchLineItems(startDate, endDate, keyword, park = 'both', salesOfficeName = null) {
  let orders = activeOnly(filterByPark(await fetchAllOrders(startDate, endDate), park));
  if (salesOfficeName) {
    const officeKw = salesOfficeName.toLowerCase();
    orders = orders.filter(o => (o.salesOfficeName || '').toLowerCase().includes(officeKw));
  }
  const kw = keyword.toLowerCase();

  const variantMap = {};
  let totalCount   = 0;
  let totalRevenue = 0;

  for (const order of orders) {
    for (const li of (order.lineItems || [])) {
      const raw  = (li.name || '').trim();
      const norm = raw.toLowerCase()
        // strip employee/crew suffixes so "Cheeseburger (BB Employee)" matches "cheeseburger"
        .replace(/\s*\((bb|gi)\s*employee\)/gi, '')
        .replace(/\s*-\s*token\b/gi, '')
        .trim();

      if (!norm.includes(kw)) continue;

      const rev = lineItemRevenue(li);
      if (!variantMap[raw]) variantMap[raw] = { count: 0, revenue: 0 };
      variantMap[raw].count++;
      variantMap[raw].revenue = +(variantMap[raw].revenue + rev).toFixed(2);
      totalCount++;
      totalRevenue += rev;
    }
  }

  const variants = Object.entries(variantMap)
    .map(([name, v]) => ({ name, count: v.count, revenue: v.revenue }))
    .sort((a, b) => b.count - a.count);

  return {
    keyword,
    park,
    salesOfficeName: salesOfficeName || null,
    startDate,
    endDate,
    totalCount,
    totalRevenue: +totalRevenue.toFixed(2),
    variantCount: variants.length,
    variants,
  };
}

// ── Tool 5: Single order lookup ────────────────────────────────────────────
async function toolGetOrderById(orderId) {
  const token = await getRRToken();
  const base  = process.env.ROCKETREZ_BASE_URL;
  const res   = await fetch(`${base}/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) throw new Error(`Order #${orderId} not found`);
  if (!res.ok) throw new Error(`RocketRez order lookup failed: ${res.status}`);
  const json  = await res.json();
  const order = json.data;
  return {
    orderId:        order.id,
    orderUrl:       order.orderUrl,
    date:           order.createdDate,
    modifiedDate:   order.modifiedDate,
    status:         order.status,
    isWebOrder:     order.isWebOrder,
    salesOffice:    order.salesOfficeName,
    salesPerson:    `${order.salesPersonFirstName || ''} ${order.salesPersonLastName || ''}`.trim() || null,
    contactGroup:   order.contactGroupName || null,
    subtotal:       order.subTotal,
    discountTotal:  order.discountTotal || 0,
    taxTotal:       order.taxTotal || 0,
    gratuityTotal:  order.gratuityTotal || 0,
    variableFeeTotal: order.variableFeeTotal || 0,
    total:          order.total,
    customer: order.primaryContact ? {
      name:  `${order.primaryContact.firstName || ''} ${order.primaryContact.lastName || ''}`.trim(),
      email: order.primaryContact.email || null,
      phone: order.primaryContact.phone || null,
      billingAddress: order.primaryContact.billingAddress || null,
    } : null,
    paymentMethods: (order.paymentMethods || []).map(pm => ({
      method: pm.paymentMethod,
      amount: pm.paymentAmount,
    })),
    lineItems: (order.lineItems || []).map(li => ({
      name:       li.name,
      type:       li.type,
      salesOffice: li.salesOfficeName,
      amount:     lineItemRevenue(li),
      serials:    (li.rateTypes || []).flatMap(rt => rt.serials || []),
      taxItems:   (li.rateTypes || []).flatMap(rt => rt.taxItems || []).map(t => ({
        type:   t.taxType,
        amount: t.taxAmount,
      })),
      event: li.event ? {
        type:      li.event.type,
        name:      li.event.name,
        date:      li.event.schedule?.date || null,
        startTime: li.event.schedule?.startTime || null,
        endTime:   li.event.schedule?.endTime || null,
      } : null,
    })),
    questions: (order.questions || []).map(q => ({
      question: q.question,
      answer:   q.answer,
    })),
  };
}

// ── Static system prompt (cached) ─────────────────────────────────────────
// Keep dynamic content (dates, user name) OUT of this block — any change to
// the prefix invalidates the cache. Dynamic context is appended as a second,
// uncached system block inside the request handler.
const STATIC_SYSTEM = `You are BayouBot, an AI assistant for Blue Bayou and Gulf Islands Waterpark management. You have real-time access to all order data from RocketRez — tickets, food & beverage, online sales, crew meals, merchandise, everything.

You have five tools:
1. get_order_summary — broad view of all orders: revenue by department, top items, hourly patterns, payment types. Start here for questions about overall performance or revenue.
2. get_crew_orders — employee-level breakdown of crew meal orders with payroll deductions.
3. get_orders_by_office — individual order details filtered to a specific sales office.
4. search_line_items — keyword search across EVERY line item in every order, finding all name variants automatically. ALWAYS use this when the user asks about a specific item by name (cheeseburger, fries, admission ticket, funnel cake, etc.). Item names in RocketRez have suffixes like "(BB Employee)", combo names, location prefixes — this tool handles all of that automatically and sums across all variants. Never try to answer item-count questions from the top-30 list in get_order_summary. IMPORTANT: If a search returns 0 results, do NOT immediately tell the user nothing was found — automatically retry with a shorter, broader keyword (e.g. "phone case" → retry "phone"; "funnel cake" → retry "funnel"; "admission ticket" → retry "admission") before concluding there were no sales. If a second retry also returns 0, do NOT stop and ask — instead automatically call get_orders_by_office for the most relevant department (e.g. "BB Food & Beverage" for a food/drink question) and scan the returned item names to find what the product is actually called in RocketRez, then re-run the search with the correct name. Only report zero to the user after you have done this item-name discovery step and still found nothing.
5. get_order_by_id — full detail on a single specific order by ID.

Two locations — Blue Bayou (BB) and Gulf Islands (GI):
get_order_summary, get_crew_orders, and search_line_items all take a required "park" argument ('BB', 'GI', or 'both'). Before calling any of these, check whether the user has specified which park they mean — either in this message or earlier in the conversation. If it's not clear, STOP and ask a short clarifying question (e.g. "Just Blue Bayou, just Gulf Islands, or both combined?") instead of calling the tool or guessing. Do not default to 'both' on your own judgment. Once the user states a park (in this message or a prior one in the conversation), remember it for the rest of the conversation and don't ask again unless they ask about the other park or switch topics significantly. get_orders_by_office and get_order_by_id don't need this since the office name or order ID already pins down the scope.

IMPORTANT — sales office context must survive park clarification: If the user's original message mentions a specific location (e.g. "gift shop", "food & beverage", "cabana") and you ask a follow-up to clarify the park, you MUST remember that location and use it as salesOfficeName in the tool call once you know the park. Do NOT drop the location filter just because it arrived in a prior turn. Example: user says "bottled drinks in the gift shop" → you ask "which park?" → user says "Blue Bayou" → you call search_line_items with keyword="bottled", park="BB", salesOfficeName="BB Gift Shop". Never answer a location-specific question with park-wide data.

IMPORTANT — infer park from office name: If the user explicitly names a sales office that starts with "BB" or "GI" (e.g. "BB Gift Shop", "GI Gully's Gift Shop", "BB Food & Beverage"), or if they say a generic office name (e.g. "gift shop") AND have already stated a park earlier in the conversation, do NOT ask for park clarification — infer it directly. Only ask for park when you genuinely cannot determine it from context.

Sales office names (use these exact strings for salesOfficeName):
- BB Admissions (parking, admissions, gate)
- BB Food & Beverage
- BB Gift Shop
- BB Crew Kitchen (crew/employee meals at BB)
- BB Web Sales (online ticket purchases, BB website)
- BB Cabana Services
- BB - Lockers (Nayax Sales)
- GI Admissions
- GI Food & Beverage
- GI Gully's Gift Shop (GI gift shop)
- GI Web Sales (online ticket purchases, GI website)
- GI Cabana Services
- GI Groups
- GI - Lockers (Nayax Sales)
When a user says "gift shop" for BB, use "BB Gift Shop". When they say "gift shop" for GI, use "GI Gully's Gift Shop". "Admissions" or "parking" = Admissions office. "Food" or "F&B" = Food & Beverage.

Item naming conventions in RocketRez:
- BB items have a "(BB)" suffix: "Bottled Drink (BB)", "Pizza (BB)"
- GI items have no park suffix: "Fries Cafe", "Chicken Tenders"
- Employee/crew items have "(BB Employee)", "(GI Employee)", "(Employee)", or "- employee" suffix
- Season pass redemptions appear as "BB Park Admission - Season Pass Redemption" and "GI Park Admission - Season Pass Redemption"
- Some GI items have asterisk variants: "Bottle Drink *", "Chips*" — these are the same products
- Parking at BB shows as "Parking Fee (BB)" or "BB Parking"
- When searching, use the shortest core word: "drink" not "bottled drink", "fries" not "french fries"

Salesperson naming in RocketRez:
- BB staff appear as "BB - Name", "BB- Name", "BB-Name" or "BB Name" (inconsistent spacing/dash)
- GI staff appear as plain "First Last" (sometimes ALL CAPS)
- System/web accounts (not real employees): "BB - General Sales Web Engine", "BB - Season Pass Web Engine", "GI - Public Sales", "GI - SOAR", "GI - Season Passes", "GI - Consignment Admission", "GI - Covered Area Services", "Ticket 1 GIWP"
- When reporting a cashier name, strip the "BB - ", "BB- ", "BB-" prefix for readability

Payment types in this system:
- Card: Stripe (Visa/Mastercard/Amex/Discover), Apple Pay, Google Pay, PayPal, Nayax kiosk
- Cash: cash transactions
- Token: token redemptions (internal currency)
- Pre-Paid Pass: pre-sold pass redemptions (revenue was collected at time of purchase)
- Payroll Deduction: employee payroll deductions

Order status: only 'Active' orders represent completed transactions. Cancelled, Void, Estimate (open/incomplete tabs), and Return Processed orders are automatically excluded from all revenue and count figures returned by the tools. If a user asks about a cancelled or voided order specifically, use get_order_by_id.

Formatting:
- Dollar amounts: $X.XX
- Use markdown tables for multi-column comparisons
- Be direct and specific — management needs clear answers
- For item searches: always report the total count across all variants first, then show the variant breakdown so the user can see every name used
- When comparing departments or time periods, always show the numbers side by side
- When you report numbers, state which park(s) and office they cover`;

// ── Tool definitions for Claude ────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_order_summary',
    description: `Fetch a comprehensive summary of ALL orders (tickets, food, merchandise, crew meals, online sales, everything) for a date range. Returns:
- Total order count and revenue
- Revenue broken down by payment type (card, cash, payroll, token, comp)
- Revenue and order count per sales office (ticketing, food & beverage, online, etc.)
- Top 30 line items by order count (with revenue)
- Hourly order distribution
- Crew order subtotals
- List of all sales office names available for drill-down
All totals/breakdowns are scoped to the requested park only — pass 'both' only after the user has confirmed they want combined numbers.
Use this first when the user asks about revenue, sales, comparisons between departments, busiest times, popular items, or anything that requires a broad view of operations.`,
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
        park:      { type: 'string', enum: ['BB', 'GI', 'both'], description: "Which park to scope the data to: 'BB' (Blue Bayou), 'GI' (Gulf Islands), or 'both' (combined). Only use 'both' if the user explicitly asked for combined/total numbers across both parks." },
      },
      required: ['startDate', 'endDate', 'park'],
    },
  },
  {
    name: 'get_crew_orders',
    description: `Fetch crew meal orders with a per-employee breakdown, scoped to the requested park. Returns each employee's name, park (BB = Blue Bayou, GI = Gulf Islands), order count, payroll deduction total, cash/card total, token total, and the individual orders with items and amounts. Use this when the user asks specifically about employee spending, payroll deductions, or crew meal details.`,
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
        park:      { type: 'string', enum: ['BB', 'GI', 'both'], description: "Which park to scope the data to: 'BB' (Blue Bayou), 'GI' (Gulf Islands), or 'both' (combined). Only use 'both' if the user explicitly asked for combined/total numbers across both parks." },
      },
      required: ['startDate', 'endDate', 'park'],
    },
  },
  {
    name: 'get_orders_by_office',
    description: `Fetch individual order details filtered to a specific sales office (e.g. "GI Food & Beverage", "BB Ticketing", "Online Sales"). Returns up to 150-500 individual orders depending on how wide the date range is (narrower ranges return more detail per call), sorted NEWEST FIRST so the most recent orders are always in the result even on busy days where total orders exceed the cap. Each order includes line items, payment methods, totals, status, salesPerson (the cashier/employee who processed the order — use this to answer "who was working the register"), customer name, and — for bookable line items (tours, rentals, rides) — the specific event name and scheduled date/start/end time. Use this when the user wants to see specific orders, find the most recent/last occurrence of something, identify which cashier was working a register at a given time, identify which guest placed an order, or drill into a particular department. The salesOfficeName is matched as a case-insensitive substring so "food" will match "GI Food & Beverage", and "BB Admissions" or just "admissions" will match parking/admissions orders. NOTE: on high-volume days this tool may be truncated — for COUNT or SUM questions use search_line_items instead, which aggregates across all orders with no truncation.`,
    input_schema: {
      type: 'object',
      properties: {
        startDate:       { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:         { type: 'string', description: 'End date YYYY-MM-DD' },
        salesOfficeName: { type: 'string', description: 'Sales office name or partial name to filter by' },
        sortOrder:       { type: 'string', enum: ['desc', 'asc'], description: "Sort direction before applying the result cap. Use 'desc' (default) when the user asks for the most recent/last order. Use 'asc' when the user asks for the first/earliest/oldest order. This ensures the relevant end of a high-volume day is always within the returned slice." },
      },
      required: ['startDate', 'endDate', 'salesOfficeName'],
    },
  },
  {
    name: 'search_line_items',
    description: `Search ALL line items across every order for a keyword and return every matching name variant with individual counts and revenue, scoped to the requested park. ALWAYS use this tool when the user asks about a specific food or product by name (e.g. "cheeseburger", "fries", "funnel cake", "admission"). Item names in RocketRez often have suffixes like "(BB Employee)", "(GI Employee)", "- Token", combo names, or location-specific prefixes — this tool strips those automatically so "cheeseburger" matches "Cheeseburger", "Cheeseburger (BB Employee)", "Double Cheeseburger", "Bacon Cheeseburger", etc. It returns the total count and revenue across ALL matching variants, plus a breakdown by exact name so you can see every variant. Never guess from the top-30 summary list — always use this tool for item-level questions.`,
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
        keyword:         { type: 'string', description: 'The item name or keyword to search for (case-insensitive, partial match). Use the core word, e.g. "cheeseburger" not "how many cheeseburgers".' },
        park:            { type: 'string', enum: ['BB', 'GI', 'both'], description: "Which park to scope the search to: 'BB' (Blue Bayou), 'GI' (Gulf Islands), or 'both' (combined). Only use 'both' if the user explicitly asked for combined numbers across both parks." },
        salesOfficeName: { type: 'string', description: 'Optional. Restrict the search to a specific sales office / POS location (e.g. "BB Gift Shop", "GI Food & Beverage", "BB Crew Kitchen"). Use this whenever the user mentions a specific location like "in the gift shop", "at food & beverage", "from the kitchen", etc. Matched as a case-insensitive substring.' },
      },
      required: ['startDate', 'endDate', 'keyword', 'park'],
    },
  },
  {
    name: 'get_order_by_id',
    description: 'Look up a single order by its RocketRez order ID. Returns the complete order detail: items (with tax breakdown and serial numbers like wristband/locker IDs), payments, discount/gratuity/fee totals, status, which sales office and salesperson processed it, the customer\'s name/email/phone/billing address, any checkout questions answered, and — for bookable items — the exact attraction/tour name and scheduled date/time. Use when the user asks about a specific order number or needs the full picture of one order.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'The numeric RocketRez order ID' },
      },
      required: ['orderId'],
    },
    cache_control: { type: 'ephemeral' },
  },
];

async function executeTool(name, input) {
  switch (name) {
    case 'get_order_summary':    return toolGetOrderSummary(input.startDate, input.endDate, input.park);
    case 'get_crew_orders':      return toolGetCrewOrders(input.startDate, input.endDate, input.park);
    case 'get_orders_by_office': return toolGetOrdersByOffice(input.startDate, input.endDate, input.salesOfficeName, input.sortOrder || 'desc');
    case 'search_line_items':    return toolSearchLineItems(input.startDate, input.endDate, input.keyword, input.park, input.salesOfficeName || null);
    case 'get_order_by_id':      return toolGetOrderById(input.orderId);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Chat endpoint ──────────────────────────────────────────────────────────
router.post('/chat', requireBot, async (req, res) => {
  const { messages = [], message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const TZ        = 'America/Chicago';
  const today     = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ });

  const userName     = req.user.name     || 'there';
  const userPosition = req.user.position || req.user.role || '';

  // Two-block system: large static block is cached by Anthropic (5-min TTL);
  // short dynamic block with today's date and user name is never cached since
  // it changes per-user/per-day and would bust the cache on every request.
  const SYSTEM = [
    { type: 'text', text: STATIC_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Today is ${today}. Yesterday was ${yesterday}. You are speaking with ${userName}${userPosition ? ` (${userPosition})` : ''}. Use their name naturally in conversation — greet them by name at the start, and refer to them by name occasionally when it feels natural (not every message). Keep a friendly, professional tone suited to a theme park management context.` },
  ];

  // Cap history at the last 10 turns to avoid compounding input-token costs
  // as conversations grow. The system prompt + tool results are already large;
  // a 30-turn history of data-heavy answers would multiply that rapidly.
  const trimmedHistory = messages.slice(-10);
  const history = [
    ...trimmedHistory.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message.trim() },
  ];

  try {
    let currentMessages = [...history];
    let reply = null;

    // Bound the tool loop so a pathological query can't burn tokens forever.
    const MAX_TOOL_ITERATIONS = 12;
    let iterations = 0;

    while (!reply) {
      if (iterations++ >= MAX_TOOL_ITERATIONS) {
        reply = 'That question required more data lookups than I can do in one answer. Try narrowing the date range or asking about one park/office at a time.';
        break;
      }

      const response = await anthropic.messages.create({
        model:         'claude-sonnet-5',
        max_tokens:    8000,
        output_config: { effort: 'medium' },
        system:        SYSTEM,
        tools:         TOOLS,
        messages:      currentMessages,
        // Third cache breakpoint (tools + system are the other two): caches the
        // conversation prefix, so each tool-loop iteration and follow-up turn
        // reads prior tool results from cache instead of re-processing them.
        cache_control: { type: 'ephemeral' },
      });

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        // max_tokens = truncated answer; return the partial text rather than erroring
        const textBlock = response.content.find(b => b.type === 'text');
        reply = textBlock?.text || 'I could not generate a response. Please try again.';

      } else if (response.stop_reason === 'tool_use') {
        currentMessages.push({ role: 'assistant', content: response.content });

        const toolResults = await Promise.all(
          response.content
            .filter(b => b.type === 'tool_use')
            .map(async b => {
              try {
                const result = await executeTool(b.name, b.input);
                return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(result) };
              } catch (err) {
                return { type: 'tool_result', tool_use_id: b.id, content: `Error: ${err.message}`, is_error: true };
              }
            })
        );

        currentMessages.push({ role: 'user', content: toolResults });
      } else {
        reply = 'An unexpected error occurred. Please try again.';
      }
    }

    res.json({ reply });
  } catch (err) {
    console.error('BayouBot chat error:', err.message);
    res.status(500).json({ error: 'BayouBot failed to respond. Please try again.' });
  }
});

export default router;
