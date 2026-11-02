/**
 * Puts the current Export menu (Excel, CSV, PDF) into the season per
 * cap shared report. The report HTML (and its data) lives only in the database:
 * this reads it, swaps out any previous export injection for export-module.js,
 * backs the original up and writes it back. Safe to re-run after every change.
 *
 *   node server/scripts/percap-export/apply.mjs <report-token>
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../src/db/index.js';
import { applyExport } from './splice.mjs';

const token = process.argv[2];
if (!token) { console.error('usage: apply.mjs <report-token>'); process.exit(1); }
const mod = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-module.js'), 'utf8');

const { rows } = await pool.query('SELECT html FROM shared_reports WHERE token = $1', [token]);
if (!rows[0]) { console.error('no shared report with that token'); process.exit(1); }
const before = rows[0].html, after = applyExport(before, mod);
if (after === before) { console.log('already up to date — nothing to do'); await pool.end(); process.exit(0); }

const backup = `/root/shared-report-${token.slice(0, 6)}.pre-export-${Date.now()}.html`;
fs.writeFileSync(backup, before);
await pool.query('UPDATE shared_reports SET html = $2 WHERE token = $1', [token, after]);
console.log(`export menu applied (${before.length} -> ${after.length} chars); original backed up to ${backup}`);
await pool.end();
