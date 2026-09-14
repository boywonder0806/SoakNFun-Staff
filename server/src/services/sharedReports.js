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
