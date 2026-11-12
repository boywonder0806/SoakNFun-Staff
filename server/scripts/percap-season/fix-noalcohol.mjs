/**
 * Applies the no-alcohol page edits (noalcohol.mjs) to a published season dashboard in place,
 * without a rebuild. Idempotent; backs up to /root/ and refuses to write if the report changed meanwhile.
 *
 *   node scripts/percap-season/fix-noalcohol.mjs <report-token>
 */
import 'dotenv/config';
import fs from 'fs';
import pool from '../../src/db/index.js';
import { applyNoAlcohol } from './noalcohol.mjs';

const token = process.argv[2];
if (!token) { console.error('usage: fix-noalcohol.mjs <report-token>'); process.exit(1); }
const { rows } = await pool.query('SELECT html FROM shared_reports WHERE token = $1', [token]);
if (!rows[0]) { console.error('no shared report with that token'); process.exit(1); }
const before = rows[0].html, after = applyNoAlcohol(before);
if (after === before) { console.log('already applied — nothing to do'); await pool.end(); process.exit(0); }
const backup = `/root/shared-report-${token.slice(0, 6)}.pre-noalc-${Date.now()}.html`;
fs.writeFileSync(backup, before);
const r = await pool.query('UPDATE shared_reports SET html = $2 WHERE token = $1 AND html = $3', [token, after, before]);
console.log(r.rowCount ? `no-alcohol edits applied (${before.length} -> ${after.length} chars); backup ${backup}` : 'report changed while running — nothing written');
await pool.end();
