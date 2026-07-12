import { Router } from 'express';
import pool from '../db/index.js';
import { requireTickets } from '../middleware/auth.js';
import { getRRToken } from '../services/crewOrders.js';

const router = Router();

// Shared ticket design templates — every Ticket Manager user sees the same
// library, so a layout (including uploaded logo art) built on one machine is
// usable everywhere.
pool.query(`CREATE TABLE IF NOT EXISTS ticket_templates (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  template   JSONB NOT NULL,
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('ticket_templates migration:', e.message));

function validTemplate(t) {
  return t && typeof t === 'object'
    && Number.isFinite(t.width) && Number.isFinite(t.height)
    && Array.isArray(t.elements);
}

// GET /api/tickets/templates — names only (bodies can carry logo images)
router.get('/templates', requireTickets, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.updated_at AS "updatedAt", e.name AS "createdBy"
       FROM ticket_templates t LEFT JOIN employees e ON e.id = t.created_by
       ORDER BY LOWER(t.name)`
    );
    res.json({ templates: rows });
  } catch (err) {
    console.error('Template list error:', err.message);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

// GET /api/tickets/templates/:id — full template body
router.get('/templates/:id(\\d+)', requireTickets, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, template FROM ticket_templates WHERE id = $1',
      [parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load template' });
  }
});

// POST /api/tickets/templates — save a new template
router.post('/templates', requireTickets, async (req, res) => {
  const name = (req.body.name || '').trim();
  const { template } = req.body;
  if (!name || name.length > 80) return res.status(400).json({ error: 'A template name (max 80 characters) is required' });
  if (!validTemplate(template))  return res.status(400).json({ error: 'Invalid template payload' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO ticket_templates (name, template, created_by)
       VALUES ($1, $2, $3) RETURNING id, name, updated_at AS "updatedAt"`,
      [name, JSON.stringify(template), req.user.id]
    );
    res.status(201).json({ template: rows[0] });
  } catch (err) {
    console.error('Template create error:', err.message);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

// PUT /api/tickets/templates/:id — overwrite an existing template
router.put('/templates/:id(\\d+)', requireTickets, async (req, res) => {
  const name = (req.body.name || '').trim();
  const { template } = req.body;
  if (!validTemplate(template)) return res.status(400).json({ error: 'Invalid template payload' });
  try {
    const { rows } = await pool.query(
      `UPDATE ticket_templates
       SET template = $1, name = COALESCE(NULLIF($2, ''), name), updated_at = NOW()
       WHERE id = $3 RETURNING id, name, updated_at AS "updatedAt"`,
      [JSON.stringify(template), name, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) {
    console.error('Template update error:', err.message);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

// DELETE /api/tickets/templates/:id
router.delete('/templates/:id(\\d+)', requireTickets, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM ticket_templates WHERE id = $1', [parseInt(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

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
