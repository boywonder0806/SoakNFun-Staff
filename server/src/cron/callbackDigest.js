import cron from 'node-cron';
import { randomUUID } from 'crypto';
import pool from '../db/index.js';
import { sendCallbackDigestEmail } from '../services/email.js';

async function getOrCreateToken(employeeId) {
  const { rows } = await pool.query(
    `SELECT token FROM callback_digest_tokens
     WHERE employee_id = $1 AND expires_at > NOW()
     ORDER BY expires_at DESC LIMIT 1`,
    [employeeId]
  );
  if (rows[0]) return rows[0].token;

  const token = randomUUID().replace(/-/g, '');
  await pool.query(
    `INSERT INTO callback_digest_tokens (employee_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '48 hours')`,
    [employeeId, token]
  );
  return token;
}

async function sendDigests() {
  try {
    const baseUrl = process.env.CLIENT_URL || 'http://localhost:3001';

    const { rows } = await pool.query(`
      SELECT
        cl.requested_staff_id  AS "employeeId",
        e.name,
        e.email,
        COUNT(*)               AS "pendingCount",
        JSON_AGG(JSON_BUILD_OBJECT(
          'id',          cl.id,
          'callerName',  cl.caller_name,
          'callerPhone', cl.caller_phone,
          'reason',      cl.reason,
          'createdAt',   cl.created_at
        ) ORDER BY cl.created_at ASC) AS callbacks
      FROM call_log cl
      JOIN employees e ON cl.requested_staff_id = e.id
      WHERE cl.needs_callback       = TRUE
        AND cl.callback_status      = 'pending'
        AND cl.requested_staff_id   IS NOT NULL
        AND e.is_active             = TRUE
        AND e.email                 IS NOT NULL
      GROUP BY cl.requested_staff_id, e.name, e.email
    `);

    for (const staff of rows) {
      const token     = await getOrCreateToken(staff.employeeId);
      const digestUrl = `${baseUrl}/api/reception/callback-digest/${token}`;
      await sendCallbackDigestEmail({
        toEmail:      staff.email,
        toName:       staff.name,
        pendingCount: parseInt(staff.pendingCount),
        callbacks:    staff.callbacks,
        digestUrl,
      });
    }

    console.log(`[Callback digest] Sent digests to ${rows.length} staff member(s)`);
  } catch (err) {
    console.error('[Callback digest] Error:', err.message);
  }
}

export function startCallbackDigestCron() {
  cron.schedule('0 11 * * *', sendDigests, { timezone: 'America/Chicago' });
  cron.schedule('0 18 * * *', sendDigests, { timezone: 'America/Chicago' });
  console.log('[Callback digest] Scheduled for 11:00 AM and 6:00 PM Central');
}

export { sendDigests as runCallbackDigestNow };
