/**
 * Shared reports — self-contained HTML snapshots (built by Claude on request,
 * or anything else that wants to publish one) that can be viewed by anyone
 * holding the link, no staff login required. The token itself is the only
 * credential: it's a long random value, so the link is the access control.
 */
import crypto from 'crypto';
import pool from '../db/index.js';

export const schemaReady = pool.query(`CREATE TABLE IF NOT EXISTS shared_reports (
  token          TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  html           TEXT NOT NULL,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,
  revoked        BOOLEAN NOT NULL DEFAULT FALSE,
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ
)`)
  .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_shared_reports_created ON shared_reports (created_at DESC)'))
  .then(() => pool.query('ALTER TABLE shared_reports ADD COLUMN IF NOT EXISTS pin_hash TEXT'))
  .catch(e => console.error('shared_reports migration:', e.message));

// Optional PIN gate. Only a salted scrypt hash is stored; the public route
// checks it server-side so the report HTML never leaves the server unlocked.
export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`;
}

export function verifyPin(pin, stored) {
  if (!stored || !pin) return false;
  const [saltHex, hashHex] = stored.split(':');
  const actual = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export async function setSharedReportPin(token, pin) {
  const { rowCount } = await pool.query(
    `UPDATE shared_reports SET pin_hash = $2 WHERE token = $1`, [token, pin ? hashPin(pin) : null]
  );
  return rowCount > 0;
}

function generateToken() {
  // 24 random bytes as unpadded base64url — short-ish (32 chars), URL-safe,
  // and unguessable enough to be the sole gate on a public link.
  return crypto.randomBytes(24).toString('base64url');
}

export async function createSharedReport({ title, html, createdBy, expiresInDays }) {
  const token = generateToken();
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
  await pool.query(
    `INSERT INTO shared_reports (token, title, html, created_by, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [token, title, html, createdBy || null, expiresAt]
  );
  return { token, expiresAt };
}

export async function listSharedReports() {
  const { rows } = await pool.query(
    `SELECT token, title, created_by, created_at, expires_at, revoked, view_count, last_viewed_at,
            length(html) AS size_bytes, (pin_hash IS NOT NULL) AS has_pin
     FROM shared_reports ORDER BY created_at DESC`
  );
  return rows;
}

export async function getSharedReport(token) {
  const { rows } = await pool.query(`SELECT * FROM shared_reports WHERE token = $1`, [token]);
  return rows[0] || null;
}

export async function recordView(token) {
  await pool.query(
    `UPDATE shared_reports SET view_count = view_count + 1, last_viewed_at = NOW() WHERE token = $1`,
    [token]
  );
}

export async function updateSharedReport(token, { title, html }) {
  const { rowCount } = await pool.query(
    `UPDATE shared_reports SET title = COALESCE($2, title), html = COALESCE($3, html) WHERE token = $1`,
    [token, title || null, html || null]
  );
  return rowCount > 0;
}

export async function setRevoked(token, revoked) {
  const { rowCount } = await pool.query(
    `UPDATE shared_reports SET revoked = $2 WHERE token = $1`, [token, revoked]
  );
  return rowCount > 0;
}

export async function deleteSharedReport(token) {
  const { rowCount } = await pool.query(`DELETE FROM shared_reports WHERE token = $1`, [token]);
  return rowCount > 0;
}

// ── Per-person access ─────────────────────────────────────────────────────────
// Each recipient gets their own PIN so views can be attributed. PINs are stored
// encrypted (not hashed) so an admin can re-show or resend one; the key is
// derived from the server secret and the row is useless without it.

export const recipientsReady = schemaReady
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS shared_report_recipients (
    id              SERIAL PRIMARY KEY,
    token           TEXT NOT NULL REFERENCES shared_reports(token) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    name            TEXT,
    pin_enc         TEXT NOT NULL,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    last_emailed_at TIMESTAMPTZ,
    view_count      INTEGER NOT NULL DEFAULT 0,
    first_viewed_at TIMESTAMPTZ,
    last_viewed_at  TIMESTAMPTZ,
    UNIQUE (token, email)
  )`))
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS shared_report_views (
    id           SERIAL PRIMARY KEY,
    token        TEXT NOT NULL,
    recipient_id INTEGER,
    ip           TEXT,
    user_agent   TEXT,
    viewed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`))
  .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_shared_report_views_token ON shared_report_views (token, viewed_at DESC)'))
  .then(() => pool.query('ALTER TABLE shared_report_views ADD COLUMN IF NOT EXISTS recipient_email TEXT'))
  .catch(e => console.error('shared_report_recipients migration:', e.message));

const pinKey = () => crypto.createHash('sha256').update('shared-report-pin:' + process.env.JWT_SECRET).digest();

export function encryptPin(pin) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', pinKey(), iv);
  const enc = Buffer.concat([c.update(String(pin), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64url')).join('.');
}

export function decryptPin(stored) {
  try {
    const [iv, tag, enc] = stored.split('.').map(x => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', pinKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const randomPin = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

async function uniquePin(token) {
  const { rows } = await pool.query(`SELECT pin_enc FROM shared_report_recipients WHERE token = $1`, [token]);
  const taken = new Set(rows.map(r => decryptPin(r.pin_enc)));
  let pin;
  do pin = randomPin(); while (taken.has(pin));
  return pin;
}

const withPin = r => ({ ...r, pin: decryptPin(r.pin_enc), pin_enc: undefined });

export async function listRecipients(token) {
  const { rows } = await pool.query(
    `SELECT id, token, email, name, pin_enc, created_by, created_at, revoked, last_emailed_at, view_count, first_viewed_at, last_viewed_at
     FROM shared_report_recipients WHERE token = $1 ORDER BY created_at DESC`, [token]
  );
  return rows.map(withPin);
}

export async function getActiveRecipients(token) {
  const { rows } = await pool.query(
    `SELECT id, email, name, pin_enc FROM shared_report_recipients WHERE token = $1 AND NOT revoked`, [token]
  );
  return rows;
}

export async function getRecipient(token, id) {
  const { rows } = await pool.query(`SELECT * FROM shared_report_recipients WHERE token = $1 AND id = $2`, [token, id]);
  return rows[0] ? withPin(rows[0]) : null;
}

export async function addRecipient({ token, email, name, createdBy }) {
  const pin = await uniquePin(token);
  const { rows } = await pool.query(
    `INSERT INTO shared_report_recipients (token, email, name, pin_enc, created_by)
     VALUES ($1, lower($2), $3, $4, $5)
     ON CONFLICT (token, email) DO NOTHING
     RETURNING id, token, email, name, pin_enc, created_by, created_at, revoked, last_emailed_at, view_count, first_viewed_at, last_viewed_at`,
    [token, email.trim(), name?.trim() || null, encryptPin(pin), createdBy || null]
  );
  return rows[0] ? withPin(rows[0]) : null; // null = that email already has access
}

export async function regenerateRecipientPin(token, id) {
  const pin = await uniquePin(token);
  const { rows } = await pool.query(
    `UPDATE shared_report_recipients SET pin_enc = $3, revoked = FALSE WHERE token = $1 AND id = $2 RETURNING *`,
    [token, id, encryptPin(pin)]
  );
  return rows[0] ? withPin(rows[0]) : null;
}

export async function setRecipientRevoked(token, id, revoked) {
  const { rowCount } = await pool.query(`UPDATE shared_report_recipients SET revoked = $3 WHERE token = $1 AND id = $2`, [token, id, revoked]);
  return rowCount > 0;
}

export async function deleteRecipient(token, id) {
  const { rowCount } = await pool.query(`DELETE FROM shared_report_recipients WHERE token = $1 AND id = $2`, [token, id]);
  return rowCount > 0;
}

export async function markRecipientEmailed(id) {
  await pool.query(`UPDATE shared_report_recipients SET last_emailed_at = NOW() WHERE id = $1`, [id]);
}

// Constant-time match of an entered PIN against every active recipient's PIN.
export function matchRecipientPin(recipients, pin) {
  const entered = Buffer.from(String(pin));
  let found = null;
  for (const r of recipients) {
    const actual = Buffer.from(decryptPin(r.pin_enc) || '');
    if (actual.length === entered.length && crypto.timingSafeEqual(actual, entered)) found = r;
  }
  return found;
}

export async function recordViewDetail({ token, recipientId, recipientEmail, ip, userAgent }) {
  await pool.query(
    `INSERT INTO shared_report_views (token, recipient_id, recipient_email, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
    [token, recipientId || null, recipientEmail || null, ip || null, userAgent ? String(userAgent).slice(0, 300) : null]
  );
  if (recipientId) {
    await pool.query(
      `UPDATE shared_report_recipients SET view_count = view_count + 1, last_viewed_at = NOW(),
              first_viewed_at = COALESCE(first_viewed_at, NOW()) WHERE id = $1`, [recipientId]
    );
  }
}

export async function listViews(token, limit = 200) {
  const { rows } = await pool.query(
    `SELECT v.id, v.recipient_id, v.ip, v.user_agent, v.viewed_at, COALESCE(r.email, v.recipient_email) AS email, r.name, (v.recipient_id IS NOT NULL AND r.id IS NULL) AS removed
     FROM shared_report_views v LEFT JOIN shared_report_recipients r ON r.id = v.recipient_id
     WHERE v.token = $1 ORDER BY v.viewed_at DESC LIMIT $2`, [token, limit]
  );
  return rows;
}
