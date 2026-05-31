import { Router } from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Idempotent table creation for messaging
pool.query(`CREATE TABLE IF NOT EXISTS conversations (
  id         SERIAL PRIMARY KEY,
  name       TEXT,
  type       TEXT NOT NULL DEFAULT 'direct',
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.error('conversations table:', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  employee_id     INT NOT NULL REFERENCES employees(id)     ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, employee_id)
)`).catch(e => console.error('conversation_members table:', e.message));

pool.query(`CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INT  NOT NULL REFERENCES conversations(id)  ON DELETE CASCADE,
  sender_id       INT  NOT NULL REFERENCES employees(id)      ON DELETE CASCADE,
  text            TEXT NOT NULL,
  sent_at         TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.error('messages table:', e.message));

// GET /api/messages/employees?q= — search employees to message
router.get('/employees', requireAuth, async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, avatar, department, position
       FROM employees
       WHERE is_active = TRUE AND id <> $1
         AND (name ILIKE $2 OR department ILIKE $2 OR position ILIKE $2)
       ORDER BY name LIMIT 20`,
      [req.user.id, q]
    );
    res.json({ employees: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search employees' });
  }
});

// POST /api/messages/direct — find or create a DM conversation
router.post('/direct', requireAuth, async (req, res) => {
  const userId   = req.user.id;
  const { targetId } = req.body;
  if (!targetId || targetId === userId) return res.status(400).json({ error: 'Invalid target' });

  try {
    // Find an existing direct conversation between the two users
    const { rows: existing } = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.employee_id = $1
       JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.employee_id = $2
       WHERE c.type = 'direct'
       LIMIT 1`,
      [userId, targetId]
    );
    if (existing[0]) return res.json({ conversationId: existing[0].id });

    // Create a new one inside a transaction so members are always added
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [convo] } = await client.query(
        `INSERT INTO conversations (name, type) VALUES (NULL, 'direct') RETURNING id`
      );
      await client.query(
        `INSERT INTO conversation_members (conversation_id, employee_id) VALUES ($1,$2),($1,$3)`,
        [convo.id, userId, targetId]
      );
      await client.query('COMMIT');
      res.json({ conversationId: convo.id });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Direct message error:', err.message);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /api/messages/conversations
router.get('/conversations', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.type,
              m.text AS "lastMessage", m.sent_at AS "lastMessageTime",
              json_agg(json_build_object('id', e.id, 'name', e.name, 'avatar', e.avatar)
                ORDER BY e.name) AS "memberDetails"
       FROM conversations c
       JOIN conversation_members cm  ON cm.conversation_id  = c.id
       JOIN conversation_members cm2 ON cm2.conversation_id = c.id
       JOIN employees e ON e.id = cm2.employee_id
       LEFT JOIN LATERAL (
         SELECT text, sent_at FROM messages
         WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1
       ) m ON true
       WHERE cm.employee_id = $1
       GROUP BY c.id, c.name, c.type, m.text, m.sent_at
       ORDER BY m.sent_at DESC NULLS LAST`,
      [userId]
    );
    res.json({ conversations: rows });
  } catch (err) {
    console.error('Conversations error:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// GET /api/messages/conversations/:id
router.get('/conversations/:id', requireAuth, async (req, res) => {
  const convoId = parseInt(req.params.id);
  const userId  = req.user.id;
  try {
    const { rows: [convo] } = await pool.query(
      `SELECT c.id, c.name, c.type FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE c.id = $1 AND cm.employee_id = $2`,
      [convoId, userId]
    );
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    const { rows: messages } = await pool.query(
      `SELECT m.id, m.sender_id AS "senderId", m.text, m.sent_at AS time,
              e.name AS "senderName", e.avatar AS "senderAvatar"
       FROM messages m JOIN employees e ON e.id = m.sender_id
       WHERE m.conversation_id = $1 ORDER BY m.sent_at ASC`,
      [convoId]
    );
    res.json({ conversation: convo, messages });
  } catch (err) {
    console.error('Messages error:', err.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages/conversations/:id
router.post('/conversations/:id', requireAuth, async (req, res) => {
  const convoId = parseInt(req.params.id);
  const userId  = req.user.id;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Message text required' });

  try {
    const { rows: [member] } = await pool.query(
      `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND employee_id = $2`,
      [convoId, userId]
    );
    if (!member) return res.status(404).json({ error: 'Conversation not found' });

    const { rows: [msg] } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, text)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id AS "senderId", text, sent_at AS time`,
      [convoId, userId, text.trim()]
    );
    msg.senderName   = req.user.name;
    msg.senderAvatar = req.user.avatar;
    res.status(201).json({ message: msg });
  } catch (err) {
    console.error('Send message error:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
