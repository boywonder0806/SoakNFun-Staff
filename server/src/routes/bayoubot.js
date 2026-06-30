import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireHR } from '../middleware/auth.js';

const router   = Router();
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

async function fetchCrewOrders(startDate, endDate) {
  const token = await getRRToken();
  const base  = process.env.ROCKETREZ_BASE_URL;
  let page = 1;
  const crewOrders = [];

  while (true) {
    const url = `${base}/v1/orders?startDate=${startDate}&endDate=${endDate}&limit=250&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`RocketRez orders failed: ${res.status}`);
    const json  = await res.json();
    const batch = json.data || [];
    if (!batch.length) break;
    crewOrders.push(...batch.filter(o => o.contactGroupName?.trim()));
    if (batch.length < 250) break;
    page++;
  }
  return crewOrders;
}

function classifyPayments(paymentMethods) {
  let payroll = 0, cashCard = 0, token = 0, comp = 0;
  if (!paymentMethods?.length) return { payroll, cashCard, token, comp };
  for (const pm of paymentMethods) {
    const m   = (pm.paymentMethod || '').toLowerCase();
    const amt = pm.paymentAmount  || 0;
    if (m.includes('payroll'))                                                                          payroll  += amt;
    else if (m.includes('token'))                                                                       token    += amt;
    else if (m.includes('stripe') || m.includes('card') || m.includes('cash') ||
             m.includes('mastercard') || m.includes('visa') || m.includes('amex'))                      cashCard += amt;
    else                                                                                                comp     += amt;
  }
  return { payroll, cashCard, token, comp };
}

// ── Tool implementation ────────────────────────────────────────────────────
async function toolGetCrewOrders(startDate, endDate) {
  const orders = await fetchCrewOrders(startDate, endDate);

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
      orderId: order.id,
      date:    order.createdDate,
      items:   (order.lineItems || [])
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

// ── Tool definitions for Claude ────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_crew_orders',
    description: 'Fetch crew meal and food orders from RocketRez for a date range. Returns a breakdown by employee with payroll deductions, cash/card, token, and comp totals plus individual order details. Blue Bayou crew have park="BB", Gulf Islands crew have park="GI". Employees are sorted by payroll total descending.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format (inclusive)' },
        endDate:   { type: 'string', description: 'End date in YYYY-MM-DD format (inclusive)' },
      },
      required: ['startDate', 'endDate'],
    },
  },
];

// ── Chat endpoint ──────────────────────────────────────────────────────────
router.post('/chat', requireHR, async (req, res) => {
  const { messages = [], message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

  const SYSTEM = `You are BayouBot, an AI assistant for Blue Bayou and Gulf Islands Waterpark management. You have real-time access to crew meal order data from RocketRez, the park's ordering and ticketing system.

You can answer questions about:
- Crew meal orders and payroll deductions for any date range
- Per-employee spending broken down by park (BB = Blue Bayou, GI = Gulf Islands)
- Payment types: payroll deductions, cash/card, token, comp
- Order counts, totals, rankings, and trends

When a question involves order data, use the get_crew_orders tool to fetch it. Today's date is ${today}.

Formatting rules:
- Dollar amounts: $X.XX
- Use markdown tables when showing multi-row employee data
- Be concise and direct — management needs quick answers
- If asked about "today", use ${today}; "yesterday" is the day before`;

  const history = [
    ...messages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message.trim() },
  ];

  try {
    let currentMessages = [...history];
    let reply = null;

    // Agentic loop — keep going until Claude stops calling tools
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
                const result = await toolGetCrewOrders(b.input.startDate, b.input.endDate);
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
