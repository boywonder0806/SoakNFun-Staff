import { Router } from 'express';
import pool from '../db/index.js';
import { requireReception, requireReceptionManager, requireSysAdmin } from '../middleware/auth.js';
import { sendCallbackNotification } from '../services/email.js';
import { runCallbackDigestNow } from '../cron/callbackDigest.js';

const router = Router();

// Idempotent migrations
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_reception_access BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_reception_manager BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_handle_callbacks BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query(`CREATE TABLE IF NOT EXISTS reception_email_log (
  id           SERIAL PRIMARY KEY,
  type         VARCHAR(60) NOT NULL,
  to_email     TEXT NOT NULL,
  to_name      TEXT,
  subject      TEXT NOT NULL,
  html_body    TEXT,
  triggered_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('reception_email_log migration:', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS call_log (
  id             SERIAL PRIMARY KEY,
  logged_by      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  caller_name    VARCHAR(255),
  caller_phone   VARCHAR(50),
  call_direction VARCHAR(10) NOT NULL DEFAULT 'inbound',
  reason         TEXT,
  notes          TEXT,
  resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('call_log migration:', e.message));

// Callback columns added to call_log to unify call log + callbacks into one table
pool.query(`CREATE TABLE IF NOT EXISTS callback_digest_tokens (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  token       VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(e => console.error('callback_digest_tokens migration:', e.message));

pool.query('ALTER TABLE call_log ADD COLUMN IF NOT EXISTS needs_callback BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
pool.query('ALTER TABLE call_log ADD COLUMN IF NOT EXISTS requested_staff_id INTEGER REFERENCES employees(id) ON DELETE SET NULL').catch(() => {});
pool.query("ALTER TABLE call_log ADD COLUMN IF NOT EXISTS callback_status VARCHAR(20) DEFAULT NULL").catch(() => {});
pool.query('ALTER TABLE call_log ADD COLUMN IF NOT EXISTS callback_completed_at TIMESTAMPTZ').catch(() => {});
pool.query('ALTER TABLE call_log ADD COLUMN IF NOT EXISTS callback_completed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL').catch(() => {});

pool.query(`CREATE TABLE IF NOT EXISTS lost_found (
  id               SERIAL PRIMARY KEY,
  logged_by        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  item_type        VARCHAR(50),
  item_description TEXT NOT NULL,
  location_found   VARCHAR(255),
  found_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  owner_name       VARCHAR(255),
  owner_contact    VARCHAR(255),
  status           VARCHAR(20) NOT NULL DEFAULT 'unclaimed',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
)`).catch(e => console.error('lost_found migration:', e.message));
pool.query(`ALTER TABLE lost_found ADD COLUMN IF NOT EXISTS item_type VARCHAR(50)`).catch(() => {});

pool.query(`CREATE TABLE IF NOT EXISTS callback_requests (
  id                 SERIAL PRIMARY KEY,
  logged_by          INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  caller_name        VARCHAR(255) NOT NULL,
  caller_phone       VARCHAR(50) NOT NULL,
  reason             TEXT,
  requested_staff_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  completed_by       INTEGER REFERENCES employees(id) ON DELETE SET NULL
)`).catch(e => console.error('callback_requests migration:', e.message));

const DEFAULT_TEMPLATES = [
  { label: 'General Park Question', reason: 'General park question',          sort_order: 0  },
  { label: 'Ticket Pricing',        reason: 'Ticket pricing inquiry',         sort_order: 1  },
  { label: 'Operating Hours',       reason: 'Operating hours inquiry',        sort_order: 2  },
  { label: 'Group / Event Rates',   reason: 'Group rates or event inquiry',   sort_order: 3  },
  { label: 'Birthday Party',        reason: 'Birthday party booking inquiry', sort_order: 4  },
  { label: 'Season Passes',         reason: 'Season pass inquiry',            sort_order: 5  },
  { label: 'Accessibility',         reason: 'Accessibility or ADA inquiry',   sort_order: 6  },
  { label: 'Lost Item',             reason: 'Lost item report',               sort_order: 7  },
  { label: 'Food & Dining',         reason: 'Food and dining inquiry',        sort_order: 8  },
  { label: 'Employment',            reason: 'Employment inquiry',             sort_order: 9  },
  { label: 'Complaint',             reason: 'Guest complaint',                sort_order: 10 },
  { label: 'Directions / Parking',  reason: 'Directions or parking inquiry',  sort_order: 11 },
];

const DEFAULT_FAQS = [
  { question: 'Where is the park and how do I get there?', answer: 'GPS address: 18200 Perkins Road East, Baton Rouge, LA 70810. From I-10, take Exit 162A and head eastbound on Perkins Road — follow the signs to the park.', tags: ['location','directions','address','navigate','find','i10','highway','perkins','baton rouge','map'], sort_order: 0 },
  { question: 'What are the operating hours?', answer: 'Hours vary by date — the park runs 10am–6pm, 10am–5pm, or 2:30pm–6pm depending on the day. Always check bluebayouwaterpark.com or call (225) 753-3333 before visiting, as the schedule changes seasonally.', tags: ['hours','open','close','schedule','time','when','days','weekend','holiday','season'], sort_order: 1 },
  { question: 'What do season passes cost?', answer: 'Single Park Pass: $54.99 · 2-Park Pass (Blue Bayou + Gulf Islands): $64.99 · Premium 2-Park Pass: $74.99 (adds early Saturday entry, a bring-a-friend voucher, and 10% food discount). All passes include unlimited fountain drinks.', tags: ['season pass','annual pass','membership','price','cost','how much','2 park','gulf islands','premium','discount','drinks'], sort_order: 2 },
  { question: 'Do all guests need to pay admission even if not swimming?', answer: 'Yes. Every guest entering the park must pay admission, regardless of whether they plan to use the water attractions.', tags: ['admission','pay','ticket','entrance','spectator','watching','not swimming','supervising'], sort_order: 3 },
  { question: 'Can guests bring their own food or drinks?', answer: "No outside food, beverages, or coolers are allowed inside the park. On-site dining includes T. Joe's Po-Boys & Grill, Fuel Dock, pizza, Bayou Treats Stand (ice cream), and The Thirsty Cypress (beverages including alcohol). Fountain drinks are included with admission.", tags: ['food','drink','cooler','outside','bring','eat','dining','restaurant','lunch','snack','alcohol','beverage','menu'], sort_order: 4 },
  { question: 'What are the height requirements for rides?', answer: 'Attractions have height requirements of 36", 42", or 48" depending on the ride. Staff at each attraction can confirm the exact requirement. Children below the minimum for a specific ride cannot board for safety.', tags: ['height','requirement','restriction','ride','slide','tall','inch','children','kids','minimum','safety','36','42','48'], sort_order: 5 },
  { question: 'Can guests re-enter the park after leaving?', answer: 'Yes, re-entry is allowed on the same day with an unaltered wristband or stamp. Note: the park can reach maximum capacity on peak days (weekends and holidays) — guests who leave during a capacity hold may not be readmitted right away.', tags: ['re-entry','reentry','leave','come back','wristband','stamp','exit','capacity','full','return'], sort_order: 6 },
  { question: 'What swimwear is required?', answer: 'Appropriate swimwear is required and subject to park approval. Not permitted: visible undergarments, jeans, denim, thongs, long pants, belts, or cut-off shorts. Swim diapers are mandatory for children not yet potty-trained.', tags: ['swimwear','clothes','attire','dress code','diapers','shorts','jeans','outfit','what to wear'], sort_order: 7 },
  { question: 'Can guests bring their own life jackets or floats?', answer: 'Life jackets and tubes are provided free of charge. Guests may bring their own U.S. Coast Guard-approved life jackets. Not permitted inside the park: rafts, arm floaties, fun noodles, swim boards, or swim rings.', tags: ['life jacket','float','tube','raft','noodle','floaties','safety vest','coast guard','flotation','arm bands','swim ring'], sort_order: 8 },
  { question: 'Are pets or service animals allowed?', answer: 'No pets are allowed in the park. Only trained service animals are permitted — emotional support animals do not qualify. Service animals must remain leashed at all times and may not enter pools or water attractions.', tags: ['pet','dog','animal','service animal','emotional support','esa','leash','pool','allowed'], sort_order: 9 },
  { question: 'Is the park smoke-free?', answer: 'Yes. Blue Bayou Waterpark is a completely smoke-free facility. Smoking, vaping, and tobacco use are not permitted anywhere on park grounds.', tags: ['smoke','smoking','cigarette','vape','vaping','tobacco','e-cigarette','nicotine'], sort_order: 10 },
  { question: 'Are lockers and cabanas available?', answer: 'Yes. Lockers are available on a first-come basis using facial recognition (Snap-N-Lock) or PIN technology. Cabanas can be rented until sold out and include shaded seating; cabana guests can order food for delivery to their rental.', tags: ['locker','cabana','shade','storage','rent','valuables','belongings','secure','key','umbrella'], sort_order: 11 },
  { question: 'What forms of payment are accepted?', answer: 'Cash, Visa, MasterCard, and Discover are accepted. Checks are only accepted for group event deposits or with advance arrangements.', tags: ['payment','pay','cash','credit card','visa','mastercard','discover','check','method'], sort_order: 12 },
  { question: 'Is there a gift shop if guests need something they forgot?', answer: "Yes. The gift shop carries towels, sunscreen, flip flops, swim diapers, earplugs, hats, cover-ups, and T-shirts, plus souvenirs. It's located near the main entrance.", tags: ['gift shop','store','buy','sunscreen','towel','flip flops','diaper','forgot','purchase','souvenir','shop'], sort_order: 13 },
];

async function seedConfigTables() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS reception_templates (
      id         SERIAL PRIMARY KEY,
      label      VARCHAR(255) NOT NULL,
      reason     TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS reception_faqs (
      id         SERIAL PRIMARY KEY,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      tags       TEXT[] DEFAULT '{}',
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const { rows: [tc] } = await pool.query('SELECT COUNT(*) FROM reception_templates');
    if (parseInt(tc.count) === 0) {
      for (const t of DEFAULT_TEMPLATES) {
        await pool.query(
          `INSERT INTO reception_templates (label, reason, sort_order) VALUES ($1, $2, $3)`,
          [t.label, t.reason, t.sort_order]
        );
      }
    }
    const { rows: [fc] } = await pool.query('SELECT COUNT(*) FROM reception_faqs');
    if (parseInt(fc.count) === 0) {
      for (const f of DEFAULT_FAQS) {
        await pool.query(
          `INSERT INTO reception_faqs (question, answer, tags, sort_order) VALUES ($1, $2, $3, $4)`,
          [f.question, f.answer, f.tags, f.sort_order]
        );
      }
    }
  } catch (e) {
    console.error('Reception config seed error:', e.message);
  }
}
seedConfigTables();

// ── Access management (sysadmin only) ─────────────────────────────────────────
router.patch('/access/:id', requireSysAdmin, async (req, res) => {
  const { access } = req.body;
  const empId = parseInt(req.params.id);
  try {
    // For non-crew_member roles, granting access also grants reception manager
    const { rows: empRows } = await pool.query(
      `SELECT role FROM employees WHERE id = $1`, [empId]
    );
    const isAdmin = empRows[0] && empRows[0].role !== 'crew_member';
    const grantManager = access === true && isAdmin;

    const { rows } = await pool.query(
      `UPDATE employees
       SET has_reception_access = $1,
           is_reception_manager = CASE WHEN $2 THEN TRUE ELSE is_reception_manager END
       WHERE id = $3
       RETURNING id,
                 has_reception_access AS "hasReceptionAccess",
                 COALESCE(is_reception_manager, FALSE) AS "isReceptionManager"`,
      [access === true, grantManager, empId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reception access' });
  }
});

// ── Shared SELECT for call_log with all joined columns ────────────────────────
const CALLS_SELECT = `
  SELECT cl.id, cl.caller_name AS "callerName", cl.caller_phone AS "callerPhone",
         cl.call_direction AS "callDirection", cl.reason, cl.notes, cl.resolved,
         cl.created_at AS "createdAt",
         cl.needs_callback AS "needsCallback",
         cl.callback_status AS "callbackStatus",
         cl.callback_completed_at AS "callbackCompletedAt",
         e.name  AS "loggedByName",
         rs.id   AS "requestedStaffId", rs.name AS "requestedStaffName",
         ce.name AS "callbackCompletedByName"
  FROM call_log cl
  LEFT JOIN employees e  ON cl.logged_by             = e.id
  LEFT JOIN employees rs ON cl.requested_staff_id    = rs.id
  LEFT JOIN employees ce ON cl.callback_completed_by = ce.id`;

// ── Call Log ──────────────────────────────────────────────────────────────────
router.get('/calls', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(`${CALLS_SELECT} ORDER BY cl.created_at DESC LIMIT 300`);
    res.json({ calls: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch call log' });
  }
});

router.post('/calls', requireReception, async (req, res) => {
  const { callerName, callerPhone, callDirection = 'inbound', reason, notes, needsCallback, requestedStaffId } = req.body;
  const cbStaffId = needsCallback && requestedStaffId ? requestedStaffId : null;
  const cbStatus  = needsCallback ? 'pending' : null;
  try {
    const { rows: [inserted] } = await pool.query(
      `INSERT INTO call_log
         (logged_by, caller_name, caller_phone, call_direction, reason, notes,
          needs_callback, requested_staff_id, callback_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.user.id, callerName || null, callerPhone || null, callDirection,
       reason || null, notes || null, needsCallback || false, cbStaffId, cbStatus]
    );
    const { rows } = await pool.query(`${CALLS_SELECT} WHERE cl.id = $1`, [inserted.id]);
    res.status(201).json({ call: rows[0] });

    if (needsCallback && cbStaffId && rows[0]?.requestedStaffName) {
      const actorId = req.user.id;
      pool.query('SELECT email FROM employees WHERE id = $1', [cbStaffId])
        .then(({ rows: staff }) => {
          if (staff[0]?.email) {
            sendCallbackNotification({
              toEmail:     staff[0].email,
              toName:      rows[0].requestedStaffName,
              callerName:  rows[0].callerName,
              callerPhone: rows[0].callerPhone,
              reason:      rows[0].reason,
              notes:       rows[0].notes,
              loggedBy:    rows[0].loggedByName || req.user.name,
              triggeredBy: actorId,
            });
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to log call' });
  }
});

router.patch('/calls/:id', requireReception, async (req, res) => {
  const { resolved, notes, callerName, callerPhone, callDirection,
          reason, needsCallback, requestedStaffId, callbackStatus } = req.body;
  const fields = [];
  const vals   = [];

  if (callerName    !== undefined) { fields.push(`caller_name    = $${vals.length+1}`); vals.push(callerName    || null); }
  if (callerPhone   !== undefined) { fields.push(`caller_phone   = $${vals.length+1}`); vals.push(callerPhone   || null); }
  if (callDirection !== undefined) { fields.push(`call_direction = $${vals.length+1}`); vals.push(callDirection); }
  if (reason        !== undefined) { fields.push(`reason         = $${vals.length+1}`); vals.push(reason        || null); }
  if (notes         !== undefined) { fields.push(`notes          = $${vals.length+1}`); vals.push(notes         || null); }
  if (resolved      !== undefined) { fields.push(`resolved       = $${vals.length+1}`); vals.push(resolved); }

  if (needsCallback !== undefined) {
    fields.push(`needs_callback = $${vals.length+1}`); vals.push(needsCallback);
    if (!needsCallback) {
      fields.push(`callback_status       = $${vals.length+1}`); vals.push(null);
      fields.push(`requested_staff_id    = $${vals.length+1}`); vals.push(null);
      fields.push(`callback_completed_at = $${vals.length+1}`); vals.push(null);
      fields.push(`callback_completed_by = $${vals.length+1}`); vals.push(null);
    } else if (callbackStatus === undefined) {
      fields.push(`callback_status = COALESCE(callback_status, $${vals.length+1})`); vals.push('pending');
    }
  }
  if (requestedStaffId !== undefined && needsCallback !== false) {
    fields.push(`requested_staff_id = $${vals.length+1}`); vals.push(requestedStaffId || null);
  }
  if (callbackStatus !== undefined) {
    fields.push(`callback_status = $${vals.length+1}`); vals.push(callbackStatus);
    if (callbackStatus === 'completed' || callbackStatus === 'unable_to_reach') {
      fields.push(`callback_completed_at = NOW()`);
      fields.push(`callback_completed_by = $${vals.length+1}`); vals.push(req.user.id);
    }
  }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(parseInt(req.params.id));
  try {
    const { rowCount } = await pool.query(
      `UPDATE call_log SET ${fields.join(', ')} WHERE id = $${vals.length}`, vals
    );
    if (!rowCount) return res.status(404).json({ error: 'Call not found' });
    const { rows } = await pool.query(`${CALLS_SELECT} WHERE cl.id = $1`, [parseInt(req.params.id)]);
    res.json({ call: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update call' });
  }
});

router.delete('/calls/:id', requireReception, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM call_log WHERE id = $1', [parseInt(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Call not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete call' });
  }
});

// ── Lost & Found ──────────────────────────────────────────────────────────────
router.get('/lost-found', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT lf.id, lf.item_type AS "itemType", lf.item_description AS "itemDescription",
              lf.location_found AS "locationFound",
              lf.found_date::text AS "foundDate", lf.owner_name AS "ownerName",
              lf.owner_contact AS "ownerContact", lf.status, lf.notes,
              lf.created_at AS "createdAt", lf.resolved_at AS "resolvedAt",
              e.name AS "loggedByName"
       FROM lost_found lf
       LEFT JOIN employees e ON lf.logged_by = e.id
       ORDER BY lf.created_at DESC
       LIMIT 300`
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lost and found' });
  }
});

router.post('/lost-found', requireReception, async (req, res) => {
  const { itemType, itemDescription, locationFound, foundDate, ownerName, ownerContact, notes } = req.body;
  if (!itemType?.trim()) return res.status(400).json({ error: 'Item type is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO lost_found (logged_by, item_type, item_description, location_found, found_date, owner_name, owner_contact, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, item_type AS "itemType", item_description AS "itemDescription",
                 location_found AS "locationFound",
                 found_date::text AS "foundDate", owner_name AS "ownerName",
                 owner_contact AS "ownerContact", status, notes, created_at AS "createdAt"`,
      [req.user.id, itemType.trim(), itemDescription?.trim() || null, locationFound || null,
       foundDate || null, ownerName || null, ownerContact || null, notes || null]
    );
    res.status(201).json({ item: { ...rows[0], loggedByName: req.user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log item' });
  }
});

router.patch('/lost-found/:id', requireReception, async (req, res) => {
  const { status, itemType, ownerName, ownerContact, notes } = req.body;
  const fields = [];
  const vals   = [];
  if (itemType     !== undefined) { fields.push(`item_type     = $${vals.length + 1}`); vals.push(itemType); }
  if (status       !== undefined) { fields.push(`status        = $${vals.length + 1}`); vals.push(status); }
  if (ownerName    !== undefined) { fields.push(`owner_name    = $${vals.length + 1}`); vals.push(ownerName); }
  if (ownerContact !== undefined) { fields.push(`owner_contact = $${vals.length + 1}`); vals.push(ownerContact); }
  if (notes        !== undefined) { fields.push(`notes         = $${vals.length + 1}`); vals.push(notes); }
  if (status && status !== 'unclaimed') {
    fields.push(`resolved_at = NOW()`);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(parseInt(req.params.id));
  try {
    const { rows } = await pool.query(
      `UPDATE lost_found SET ${fields.join(', ')} WHERE id = $${vals.length}
       RETURNING id, item_type AS "itemType", item_description AS "itemDescription",
                 location_found AS "locationFound",
                 found_date::text AS "foundDate", owner_name AS "ownerName",
                 owner_contact AS "ownerContact", status, notes,
                 created_at AS "createdAt", resolved_at AS "resolvedAt"`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
    res.json({ item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

router.delete('/lost-found/:id', requireReception, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM lost_found WHERE id = $1`,
      [parseInt(req.params.id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ── Callback Requests ─────────────────────────────────────────────────────────
router.get('/callbacks', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cb.id, cb.caller_name AS "callerName", cb.caller_phone AS "callerPhone",
              cb.reason, cb.status, cb.notes,
              cb.created_at AS "createdAt", cb.completed_at AS "completedAt",
              e.name  AS "loggedByName",
              rs.id   AS "requestedStaffId", rs.name AS "requestedStaffName",
              ce.name AS "completedByName"
       FROM callback_requests cb
       LEFT JOIN employees e  ON cb.logged_by          = e.id
       LEFT JOIN employees rs ON cb.requested_staff_id  = rs.id
       LEFT JOIN employees ce ON cb.completed_by        = ce.id
       ORDER BY cb.status = 'pending' DESC, cb.created_at DESC
       LIMIT 300`
    );
    res.json({ callbacks: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch callbacks' });
  }
});

router.post('/callbacks', requireReception, async (req, res) => {
  const { callerName, callerPhone, reason, requestedStaffId, notes } = req.body;
  if (!callerName?.trim())  return res.status(400).json({ error: 'Caller name is required' });
  if (!callerPhone?.trim()) return res.status(400).json({ error: 'Caller phone is required' });
  try {
    const { rows: [inserted] } = await pool.query(
      `INSERT INTO callback_requests (logged_by, caller_name, caller_phone, reason, requested_staff_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, callerName.trim(), callerPhone.trim(),
       reason || null, requestedStaffId || null, notes || null]
    );
    const { rows } = await pool.query(
      `SELECT cb.id, cb.caller_name AS "callerName", cb.caller_phone AS "callerPhone",
              cb.reason, cb.status, cb.notes,
              cb.created_at AS "createdAt", cb.completed_at AS "completedAt",
              e.name  AS "loggedByName",
              rs.id   AS "requestedStaffId", rs.name AS "requestedStaffName",
              ce.name AS "completedByName"
       FROM callback_requests cb
       LEFT JOIN employees e  ON cb.logged_by          = e.id
       LEFT JOIN employees rs ON cb.requested_staff_id  = rs.id
       LEFT JOIN employees ce ON cb.completed_by        = ce.id
       WHERE cb.id = $1`,
      [inserted.id]
    );
    res.status(201).json({ callback: rows[0] });

    // Fire-and-forget email to requested staff
    if (requestedStaffId && rows[0]?.requestedStaffName) {
      const actorId = req.user.id;
      pool.query('SELECT email FROM employees WHERE id = $1', [requestedStaffId])
        .then(({ rows: staff }) => {
          if (staff[0]?.email) {
            sendCallbackNotification({
              toEmail:     staff[0].email,
              toName:      rows[0].requestedStaffName,
              callerName:  rows[0].callerName,
              callerPhone: rows[0].callerPhone,
              reason:      rows[0].reason,
              notes:       rows[0].notes,
              loggedBy:    rows[0].loggedByName || req.user.name,
              triggeredBy: actorId,
            });
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to log callback' });
  }
});

router.patch('/callbacks/:id', requireReception, async (req, res) => {
  const { status, notes, callerName, callerPhone, reason, requestedStaffId } = req.body;
  const fields = [];
  const vals   = [];
  if (callerName       !== undefined) { fields.push(`caller_name        = $${vals.length + 1}`); vals.push(callerName || null); }
  if (callerPhone      !== undefined) { fields.push(`caller_phone       = $${vals.length + 1}`); vals.push(callerPhone || null); }
  if (reason           !== undefined) { fields.push(`reason             = $${vals.length + 1}`); vals.push(reason || null); }
  if (requestedStaffId !== undefined) { fields.push(`requested_staff_id = $${vals.length + 1}`); vals.push(requestedStaffId || null); }
  if (status !== undefined) {
    fields.push(`status = $${vals.length + 1}`);
    vals.push(status);
    if (status === 'completed' || status === 'unable_to_reach') {
      fields.push(`completed_at = NOW()`);
      fields.push(`completed_by = $${vals.length + 1}`);
      vals.push(req.user.id);
    }
  }
  if (notes !== undefined) { fields.push(`notes = $${vals.length + 1}`); vals.push(notes || null); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(parseInt(req.params.id));
  try {
    const { rowCount } = await pool.query(
      `UPDATE callback_requests SET ${fields.join(', ')} WHERE id = $${vals.length}`,
      vals
    );
    if (!rowCount) return res.status(404).json({ error: 'Callback not found' });
    const { rows } = await pool.query(
      `SELECT cb.id, cb.caller_name AS "callerName", cb.caller_phone AS "callerPhone",
              cb.reason, cb.status, cb.notes,
              cb.created_at AS "createdAt", cb.completed_at AS "completedAt",
              e.name  AS "loggedByName",
              rs.id   AS "requestedStaffId", rs.name AS "requestedStaffName",
              ce.name AS "completedByName"
       FROM callback_requests cb
       LEFT JOIN employees e  ON cb.logged_by          = e.id
       LEFT JOIN employees rs ON cb.requested_staff_id  = rs.id
       LEFT JOIN employees ce ON cb.completed_by        = ce.id
       WHERE cb.id = $1`,
      [parseInt(req.params.id)]
    );
    res.json({ callback: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update callback' });
  }
});

router.delete('/callbacks/:id', requireReception, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM callback_requests WHERE id = $1', [parseInt(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Callback not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete callback' });
  }
});

// Staff list for callback "requested staff" dropdown — only flagged handlers, fallback to all
router.get('/staff', requireReception, async (_req, res) => {
  try {
    const { rows: flagged } = await pool.query(
      `SELECT id, name, position, department FROM employees WHERE is_active = TRUE AND can_handle_callbacks = TRUE ORDER BY name`
    );
    if (flagged.length > 0) {
      return res.json({ staff: flagged });
    }
    const { rows } = await pool.query(
      `SELECT id, name, position, department FROM employees WHERE is_active = TRUE ORDER BY name`
    );
    res.json({ staff: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

// ── Configurator (Reception Manager only) ────────────────────────────────────

router.get('/config/templates', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label, reason, sort_order AS "sortOrder" FROM reception_templates ORDER BY sort_order, id`
    );
    res.json({ templates: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

router.put('/config/templates', requireReceptionManager, async (req, res) => {
  const { templates } = req.body;
  if (!Array.isArray(templates)) return res.status(400).json({ error: 'templates must be an array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM reception_templates');
    for (let i = 0; i < templates.length; i++) {
      const t = templates[i];
      if (!t.label?.trim() && !t.reason?.trim()) continue;
      await client.query(
        `INSERT INTO reception_templates (label, reason, sort_order) VALUES ($1, $2, $3)`,
        [t.label?.trim() || '', t.reason?.trim() || '', i]
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT id, label, reason, sort_order AS "sortOrder" FROM reception_templates ORDER BY sort_order, id`
    );
    res.json({ templates: rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to save templates' });
  } finally {
    client.release();
  }
});

router.get('/config/faqs', requireReception, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, question, answer, tags, sort_order AS "sortOrder" FROM reception_faqs ORDER BY sort_order, id`
    );
    res.json({ faqs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

router.put('/config/faqs', requireReceptionManager, async (req, res) => {
  const { faqs } = req.body;
  if (!Array.isArray(faqs)) return res.status(400).json({ error: 'faqs must be an array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM reception_faqs');
    for (let i = 0; i < faqs.length; i++) {
      const f = faqs[i];
      if (!f.question?.trim() && !f.answer?.trim()) continue;
      await client.query(
        `INSERT INTO reception_faqs (question, answer, tags, sort_order) VALUES ($1, $2, $3, $4)`,
        [f.question?.trim() || '', f.answer?.trim() || '', f.tags || [], i]
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT id, question, answer, tags, sort_order AS "sortOrder" FROM reception_faqs ORDER BY sort_order, id`
    );
    res.json({ faqs: rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to save FAQs' });
  } finally {
    client.release();
  }
});

router.get('/config/staff', requireReceptionManager, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, position, department,
              COALESCE(can_handle_callbacks, FALSE) AS "canHandleCallbacks"
       FROM employees WHERE is_active = TRUE ORDER BY name`
    );
    res.json({ staff: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});

router.patch('/config/staff/:id/callback-handler', requireReceptionManager, async (req, res) => {
  const { canHandle } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE employees SET can_handle_callbacks = $1 WHERE id = $2 AND is_active = TRUE
       RETURNING id, COALESCE(can_handle_callbacks, FALSE) AS "canHandleCallbacks"`,
      [canHandle === true, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update callback handler status' });
  }
});

router.post('/config/reset-templates', requireReceptionManager, async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM reception_templates');
    for (let i = 0; i < DEFAULT_TEMPLATES.length; i++) {
      const t = DEFAULT_TEMPLATES[i];
      await client.query(
        `INSERT INTO reception_templates (label, reason, sort_order) VALUES ($1, $2, $3)`,
        [t.label, t.reason, i]
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT id, label, reason, sort_order AS "sortOrder" FROM reception_templates ORDER BY sort_order, id`
    );
    res.json({ templates: rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to reset templates' });
  } finally {
    client.release();
  }
});

router.post('/config/reset-faqs', requireReceptionManager, async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM reception_faqs');
    for (let i = 0; i < DEFAULT_FAQS.length; i++) {
      const f = DEFAULT_FAQS[i];
      await client.query(
        `INSERT INTO reception_faqs (question, answer, tags, sort_order) VALUES ($1, $2, $3, $4)`,
        [f.question, f.answer, f.tags, i]
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT id, question, answer, tags, sort_order AS "sortOrder" FROM reception_faqs ORDER BY sort_order, id`
    );
    res.json({ faqs: rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to reset FAQs' });
  } finally {
    client.release();
  }
});

router.post('/config/send-callback-digests', requireReceptionManager, async (req, res) => {
  try {
    const count = await runCallbackDigestNow(req.user.id);
    res.json({ ok: true, sent: count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send callback digests.' });
  }
});

router.get('/config/email-log', requireReceptionManager, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || 50), 100);
  const offset = parseInt(req.query.offset || 0);
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.type, l.to_email AS "toEmail", l.to_name AS "toName",
              l.subject, l.html_body AS "htmlBody", l.sent_at AS "sentAt",
              e.name AS "triggeredByName"
       FROM reception_email_log l
       LEFT JOIN employees e ON l.triggered_by = e.id
       ORDER BY l.sent_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM reception_email_log');
    res.json({ emails: rows, total: parseInt(count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch email log' });
  }
});

// ── Callback Digest (magic link, no auth required) ───────────────────────────

router.get('/callback-digest/:token', async (req, res) => {
  try {
    const { rows: tr } = await pool.query(
      `SELECT t.employee_id, t.expires_at, e.name
       FROM callback_digest_tokens t
       JOIN employees e ON t.employee_id = e.id
       WHERE t.token = $1`,
      [req.params.token]
    );
    if (!tr[0])                             return res.send(digestPage({ error: 'This link is invalid.' }));
    if (new Date(tr[0].expires_at) < new Date()) return res.send(digestPage({ error: 'This link has expired. You will receive a new one at the next scheduled time.' }));

    const { employee_id: empId, name } = tr[0];
    const updated = req.query.updated === '1';

    const { rows: callbacks } = await pool.query(
      `SELECT id, caller_name AS "callerName", caller_phone AS "callerPhone",
              reason, notes, created_at AS "createdAt"
       FROM call_log
       WHERE requested_staff_id = $1 AND needs_callback = TRUE AND callback_status = 'pending'
       ORDER BY created_at ASC`,
      [empId]
    );

    res.send(digestPage({ name, callbacks, token: req.params.token, updated }));
  } catch (err) {
    res.status(500).send(digestPage({ error: 'Something went wrong. Please try again.' }));
  }
});

router.post('/callback-digest/:token/:callId', async (req, res) => {
  const { status } = req.body;
  if (!['completed', 'unable_to_reach'].includes(status)) return res.status(400).end();
  try {
    const { rows: tr } = await pool.query(
      `SELECT employee_id, expires_at FROM callback_digest_tokens WHERE token = $1`,
      [req.params.token]
    );
    if (!tr[0] || new Date(tr[0].expires_at) < new Date())
      return res.redirect(`/api/reception/callback-digest/${req.params.token}`);

    await pool.query(
      `UPDATE call_log
       SET callback_status = $1, callback_completed_at = NOW(), callback_completed_by = $2
       WHERE id = $3 AND requested_staff_id = $2 AND needs_callback = TRUE AND callback_status = 'pending'`,
      [status, tr[0].employee_id, parseInt(req.params.callId)]
    );
    res.redirect(`/api/reception/callback-digest/${req.params.token}?updated=1`);
  } catch {
    res.redirect(`/api/reception/callback-digest/${req.params.token}?updated=1`);
  }
});

function digestPage({ name, callbacks = [], token, error, updated }) {
  const fmt = iso => new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });

  if (error) return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Callbacks — Blue Bayou</title>
    <style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}</style>
    </head><body><div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;max-width:480px;width:100%;text-align:center">
      <p style="font-size:32px;margin:0 0 12px">⚠️</p>
      <h2 style="margin:0 0 8px;color:#111827">Link Problem</h2>
      <p style="color:#6b7280;margin:0">${error}</p>
    </div></body></html>`;

  const cards = callbacks.map(c => `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:12px">
      <div style="margin-bottom:14px">
        <p style="margin:0;font-size:16px;font-weight:700;color:#111827">${c.callerName || 'Unknown caller'}</p>
        <p style="margin:3px 0 0;color:#0077B6;font-weight:600">${c.callerPhone || '—'}</p>
        ${c.reason ? `<p style="margin:6px 0 0;color:#374151;font-size:14px">${c.reason}</p>` : ''}
        ${c.notes  ? `<p style="margin:4px 0 0;color:#6b7280;font-size:13px;font-style:italic">${c.notes}</p>` : ''}
        <p style="margin:6px 0 0;color:#9ca3af;font-size:12px">Logged ${fmt(c.createdAt)}</p>
      </div>
      <div style="display:flex;gap:8px">
        <form method="POST" action="/api/reception/callback-digest/${token}/${c.id}" style="flex:1">
          <input type="hidden" name="status" value="completed">
          <button type="submit" style="width:100%;padding:10px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">✓ Completed</button>
        </form>
        <form method="POST" action="/api/reception/callback-digest/${token}/${c.id}" style="flex:1">
          <input type="hidden" name="status" value="unable_to_reach">
          <button type="submit" style="width:100%;padding:10px;background:#f59e0b;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Unable to Reach</button>
        </form>
      </div>
    </div>`).join('');

  const empty = `<div style="text-align:center;padding:40px 0">
    <p style="font-size:40px;margin:0 0 12px">✅</p>
    <p style="color:#374151;font-size:16px;font-weight:600;margin:0">All caught up!</p>
    <p style="color:#6b7280;margin:6px 0 0">No pending callbacks assigned to you.</p>
  </div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>My Callbacks — Blue Bayou</title>
    <style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;padding:24px 16px}
    .container{max-width:520px;margin:0 auto}</style>
    </head><body><div class="container">
      <div style="background:#0077B6;border-radius:12px 12px 0 0;padding:20px 24px;margin-bottom:0">
        <p style="color:#90e0ff;margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Blue Bayou Water Park</p>
        <h1 style="color:#fff;margin:4px 0 0;font-size:22px">My Callbacks</h1>
        ${name ? `<p style="color:#bae6fd;margin:4px 0 0;font-size:14px">${name}</p>` : ''}
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 24px 24px;margin-bottom:16px">
        ${callbacks.length > 0
          ? `<p style="margin:0 0 16px;color:#374151;font-size:14px"><strong>${callbacks.length}</strong> pending callback${callbacks.length === 1 ? '' : 's'} assigned to you</p>`
          : ''}
        ${updated ? `<div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:10px 14px;margin-bottom:16px;color:#065f46;font-size:14px">✓ Callback updated successfully.</div>` : ''}
        ${callbacks.length > 0 ? cards : empty}
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:12px;margin:0">Blue Bayou Water Park · Baton Rouge, LA</p>
    </div></body></html>`;
}

export default router;
