import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireHR } from '../middleware/auth.js';

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
  const today  = new Date().toLocaleDateString('en-CA');
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
  return all;
}

// ── Payment helpers ────────────────────────────────────────────────────────
function classifyPayments(paymentMethods) {
  let payroll = 0, cashCard = 0, token = 0, comp = 0;
  if (!paymentMethods?.length) return { payroll, cashCard, token, comp };
  for (const pm of paymentMethods) {
    const m   = (pm.paymentMethod || '').toLowerCase();
    const amt = pm.paymentAmount  || 0;
    if      (m.includes('payroll'))                                                                        payroll  += amt;
    else if (m.includes('token'))                                                                          token    += amt;
    else if (m.includes('stripe') || m.includes('card') || m.includes('cash') ||
             m.includes('mastercard') || m.includes('visa') || m.includes('amex'))                         cashCard += amt;
    else                                                                                                   comp     += amt;
  }
  return { payroll, cashCard, token, comp };
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

function paymentTypeLabel(paymentMethod) {
  const m = (paymentMethod || '').toLowerCase();
  if (m.includes('payroll'))                                                              return 'Payroll Deduction';
  if (m.includes('token'))                                                                return 'Token';
  if (m.includes('stripe') || m.includes('card') || m.includes('mastercard') ||
      m.includes('visa') || m.includes('amex'))                                           return 'Card';
  if (m.includes('cash'))                                                                 return 'Cash';
  return 'Comp / Other';
}

// ── Tool 1: Full order summary (all order types) ───────────────────────────
async function toolGetOrderSummary(startDate, endDate) {
  const orders = await fetchAllOrders(startDate, endDate);

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
      itemMap[name].revenue = +(itemMap[name].revenue + (li.subTotal || 0)).toFixed(2);
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
async function toolGetCrewOrders(startDate, endDate) {
  const orders = (await fetchAllOrders(startDate, endDate))
    .filter(o => o.contactGroupName?.trim());

  const byEmp = {};
  for (const order of orders) {
    const rawName = order.contactGroupName.trim();
    const isBB    = /^\(BB\)/i.test(rawName);
    const park    = isBB ? 'BB' : 'GI';
    const name    = rawName.replace(/^\(BB\)\s*/i, '').trim();
    if (!name) continue;

    const key = `${park}:${name}`;
    if (!byEmp[key]) {
      byEmp[key] = { name, park, orderCount: 0, payrollTotal: 0, cashCardTotal: 0, tokenTotal: 0, compTotal: 0, orders: [] };
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
          amount: li.subTotal || 0,
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

  return { startDate, endDate, totals, breakdown };
}

// ── Tool 3: Orders by sales office — individual order detail ───────────────
async function toolGetOrdersByOffice(startDate, endDate, salesOfficeName) {
  const allOrders = await fetchAllOrders(startDate, endDate);
  const filtered  = allOrders.filter(o =>
    (o.salesOfficeName || '').toLowerCase().includes(salesOfficeName.toLowerCase())
  );

  const LIMIT = limitForDateRange(startDate, endDate);
  const slice = filtered.slice(0, LIMIT);

  const mapped = slice.map(o => ({
    orderId:      o.id,
    date:         o.createdDate,
    status:       o.status,
    salesOffice:  o.salesOfficeName,
    contactGroup: o.contactGroupName || null,
    customer:     o.primaryContact ? {
      name:  `${o.primaryContact.firstName || ''} ${o.primaryContact.lastName || ''}`.trim(),
      email: o.primaryContact.email || null,
      phone: o.primaryContact.phone || null,
    } : null,
    total:        o.total,
    paymentTypes: (o.paymentMethods || []).map(pm => ({
      type:   paymentTypeLabel(pm.paymentMethod),
      raw:    pm.paymentMethod,
      amount: pm.paymentAmount,
    })),
    items: (o.lineItems || []).map(li => ({
      name:   (li.name || '').trim(),
      amount: li.subTotal || 0,
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
async function toolSearchLineItems(startDate, endDate, keyword) {
  const orders = await fetchAllOrders(startDate, endDate);
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

      if (!variantMap[raw]) variantMap[raw] = { count: 0, revenue: 0 };
      variantMap[raw].count++;
      variantMap[raw].revenue = +(variantMap[raw].revenue + (li.subTotal || 0)).toFixed(2);
      totalCount++;
      totalRevenue += (li.subTotal || 0);
    }
  }

  const variants = Object.entries(variantMap)
    .map(([name, v]) => ({ name, count: v.count, revenue: v.revenue }))
    .sort((a, b) => b.count - a.count);

  return {
    keyword,
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
      amount:     li.subTotal || 0,
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
Use this first when the user asks about revenue, sales, comparisons between departments, busiest times, popular items, or anything that requires a broad view of operations.`,
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'get_crew_orders',
    description: `Fetch crew meal orders with a per-employee breakdown. Returns each employee's name, park (BB = Blue Bayou, GI = Gulf Islands), order count, payroll deduction total, cash/card total, token total, and the individual orders with items and amounts. Use this when the user asks specifically about employee spending, payroll deductions, or crew meal details.`,
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'get_orders_by_office',
    description: `Fetch individual order details filtered to a specific sales office (e.g. "GI Food & Beverage", "BB Ticketing", "Online Sales"). Returns up to 150-500 individual orders depending on how wide the date range is (narrower ranges return more detail per call) with their line items, payment methods, totals, status, customer name/email/phone, and — for bookable line items (tours, rentals, rides) — the specific event name and scheduled date/start/end time, which pinpoints exactly which attraction/location an order was for, not just which office sold it. Use this when the user wants to see specific orders, identify which guest placed an order, or drill into a particular department or attraction after using get_order_summary to identify which office to look at. The salesOfficeName is matched as a case-insensitive substring so "food" will match "GI Food & Beverage".`,
    input_schema: {
      type: 'object',
      properties: {
        startDate:       { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:         { type: 'string', description: 'End date YYYY-MM-DD' },
        salesOfficeName: { type: 'string', description: 'Sales office name or partial name to filter by' },
      },
      required: ['startDate', 'endDate', 'salesOfficeName'],
    },
  },
  {
    name: 'search_line_items',
    description: `Search ALL line items across every order for a keyword and return every matching name variant with individual counts and revenue. ALWAYS use this tool when the user asks about a specific food or product by name (e.g. "cheeseburger", "fries", "funnel cake", "admission"). Item names in RocketRez often have suffixes like "(BB Employee)", "(GI Employee)", "- Token", combo names, or location-specific prefixes — this tool strips those automatically so "cheeseburger" matches "Cheeseburger", "Cheeseburger (BB Employee)", "Double Cheeseburger", "Bacon Cheeseburger", etc. It returns the total count and revenue across ALL matching variants, plus a breakdown by exact name so you can see every variant. Never guess from the top-30 summary list — always use this tool for item-level questions.`,
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD' },
        keyword:   { type: 'string', description: 'The item name or keyword to search for (case-insensitive, partial match). Use the core word, e.g. "cheeseburger" not "how many cheeseburgers".' },
      },
      required: ['startDate', 'endDate', 'keyword'],
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
  },
];

async function executeTool(name, input) {
  switch (name) {
    case 'get_order_summary':    return toolGetOrderSummary(input.startDate, input.endDate);
    case 'get_crew_orders':      return toolGetCrewOrders(input.startDate, input.endDate);
    case 'get_orders_by_office': return toolGetOrdersByOffice(input.startDate, input.endDate, input.salesOfficeName);
    case 'search_line_items':    return toolSearchLineItems(input.startDate, input.endDate, input.keyword);
    case 'get_order_by_id':      return toolGetOrderById(input.orderId);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Chat endpoint ──────────────────────────────────────────────────────────
router.post('/chat', requireHR, async (req, res) => {
  const { messages = [], message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const today     = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');

  const SYSTEM = `You are BayouBot, an AI assistant for Blue Bayou and Gulf Islands Waterpark management. You have real-time access to all order data from RocketRez — tickets, food & beverage, online sales, crew meals, merchandise, everything.

You have five tools:
1. get_order_summary — broad view of all orders: revenue by department, top items, hourly patterns, payment types. Start here for questions about overall performance or revenue.
2. get_crew_orders — employee-level breakdown of crew meal orders with payroll deductions.
3. get_orders_by_office — individual order details filtered to a specific sales office.
4. search_line_items — keyword search across EVERY line item in every order, finding all name variants automatically. ALWAYS use this when the user asks about a specific item by name (cheeseburger, fries, admission ticket, funnel cake, etc.). Item names in RocketRez have suffixes like "(BB Employee)", combo names, location prefixes — this tool handles all of that automatically and sums across all variants. Never try to answer item-count questions from the top-30 list in get_order_summary.
5. get_order_by_id — full detail on a single specific order by ID.

Today is ${today}. Yesterday was ${yesterday}.

Formatting:
- Dollar amounts: $X.XX
- Use markdown tables for multi-column comparisons
- Be direct and specific — management needs clear answers
- For item searches: always report the total count across all variants first, then show the variant breakdown so the user can see every name used
- When comparing departments or time periods, always show the numbers side by side`;

  const history = [
    ...messages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message.trim() },
  ];

  try {
    let currentMessages = [...history];
    let reply = null;

    while (!reply) {
      const response = await anthropic.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 4096,
        system:     SYSTEM,
        tools:      TOOLS,
        messages:   currentMessages,
      });

      if (response.stop_reason === 'end_turn') {
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
