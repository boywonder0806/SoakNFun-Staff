import { Router } from 'express';
import { requireTickets } from '../middleware/auth.js';
import { getRRToken } from '../services/crewOrders.js';

const router = Router();

// GET /api/tickets/order/:id — a RocketRez order normalized for ticket
// generation: one item group per line-item rate, each carrying its serials
// (which become the Code 39 barcode values).
router.get('/order/:id(\\d+)', requireTickets, async (req, res) => {
  try {
    const token = await getRRToken();
    const base  = (process.env.ROCKETREZ_BASE_URL || '').replace(/\/$/, '');
    const r = await fetch(`${base}/v1/orders/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) {
      return res.status(404).json({ error: `Order #${req.params.id} not found in RocketRez` });
    }
    if (!r.ok) {
      return res.status(502).json({ error: `RocketRez responded with status ${r.status}` });
    }
    const { data: order } = await r.json();

    const guest = [order.primaryContact?.firstName, order.primaryContact?.lastName]
      .filter(Boolean).join(' ').trim() || order.contactGroupName?.trim() || '';

    const items = [];
    for (const li of order.lineItems || []) {
      for (const rt of li.rateTypes || []) {
        const serials = rt.serials || [];
        if (!serials.length) continue;
        items.push({
          lineItemId: li.id,
          name:       (li.name || '').trim(),
          rateType:   (rt.rateType || '').trim(),
          quantity:   rt.quantity || serials.length,
          price:      rt.price ?? null,
          eventName:  li.event?.name || null,
          eventDate:  li.event?.schedule?.date || null,
          serials,
        });
      }
    }

    res.json({
      order: {
        id:          order.id,
        status:      order.status,
        createdDate: order.createdDate,
        salesOffice: order.salesOfficeName || null,
        guest,
        email:       order.primaryContact?.email || null,
        total:       order.total ?? null,
        items,
      },
    });
  } catch (err) {
    console.error('Ticket order lookup error:', err.message);
    res.status(500).json({ error: 'Failed to fetch the order from RocketRez' });
  }
});

export default router;
