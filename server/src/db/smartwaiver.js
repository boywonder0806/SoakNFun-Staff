import pg from 'pg';
import mainPool from './index.js';

/**
 * Connection used by the Smartwaiver mirror.
 *
 * By default the mirror lives in the app's own database, in its own
 * `smartwaiver` schema, sharing the main pool. Set SMARTWAIVER_DATABASE_URL
 * to keep it in a separate database instead (a dedicated pool is used then).
 */
function stripSslMode(url) {
  return url?.replace(/[?&]sslmode=[^&]*/g, '');
}

let separatePool = null;

export function getSmartwaiverPool() {
  const url = stripSslMode(process.env.SMARTWAIVER_DATABASE_URL);
  if (!url) return Promise.resolve(mainPool);
  if (!separatePool) {
    const local = url.includes('localhost') || url.includes('127.0.0.1');
    separatePool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 4 });
    separatePool.on('error', e => console.error('smartwaiver pool error:', e.message));
  }
  return Promise.resolve(separatePool);
}

export async function swQuery(text, params) {
  const pool = await getSmartwaiverPool();
  return pool.query(text, params);
}
