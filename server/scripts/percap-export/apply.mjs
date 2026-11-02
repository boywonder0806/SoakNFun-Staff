/**
 * Adds the full-report CSV / PDF export buttons to the season per cap shared
 * report. The report HTML (and its data) lives only in the database — this
 * reads it, splices in export-module.js plus the header buttons, backs the
 * original up, and writes it back. Idempotent: refuses if already applied.
 *
 *   node server/scripts/percap-export/apply.mjs <report-token>
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../src/db/index.js';

const token = process.argv[2];
if (!token) { console.error('usage: apply.mjs <report-token>'); process.exit(1); }
const dir = path.dirname(fileURLToPath(import.meta.url));
const mod = fs.readFileSync(path.join(dir, 'export-module.js'), 'utf8');

const { rows } = await pool.query('SELECT html FROM shared_reports WHERE token = $1', [token]);
if (!rows[0]) { console.error('no shared report with that token'); process.exit(1); }
let h = rows[0].html;
if (h.includes('exportReportPDF')) { console.log('already applied — nothing to do'); await pool.end(); process.exit(0); }

// split/join, never String.replace: the report is full of "$1,234" amounts.
const once = (a, b) => { const parts = h.split(a); if (parts.length !== 2) throw new Error(`expected one match for: ${a.slice(0, 60)} (found ${parts.length - 1})`); h = parts.join(b); };
const ICON_DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
once('  .totop:hover{', `  .hero-row{ display:flex; gap:18px 28px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
  .hero-row > div:first-child{ flex:1 1 520px; min-width:0; }
  .export-actions{ display:flex; gap:8px; flex:none; padding-top:2px; }
  .btn-x{ display:inline-flex; align-items:center; gap:7px; font-size:12.5px; padding:8px 13px; }
  .btn-x svg{ width:14px; height:14px; flex:none; }
  .btn-x.primary{ background:var(--accent); color:var(--page); border-color:var(--accent); }
  .btn-x.primary:hover{ color:var(--page); opacity:.88; }
  .btn-x:disabled{ opacity:.55; cursor:progress; }
  @media print{ .export-actions{ display:none !important; } }
  .totop:hover{`);
once('<header class="hero">\n', '<header class="hero"><div class="hero-row"><div>\n');
once('</p>\n  </header>', `</p>\n  </div>\n    <div class="export-actions"><button class="btn btn-x" id="exp-csv" type="button">${ICON_DL}<span>Export CSV</span></button><button class="btn btn-x primary" id="exp-pdf" type="button">${ICON_DOC}<span>Export PDF</span></button></div>\n  </div></header>`);
const INIT = '  readHash(); initControls(); renderFooter(); renderUpdates(); renderAll(); initNav();';
once(INIT, mod + '\n' + INIT + ' initReportExport();');

const backup = `/root/shared-report-${token.slice(0, 6)}.pre-export-${Date.now()}.html`;
fs.writeFileSync(backup, rows[0].html);
await pool.query('UPDATE shared_reports SET html = $2 WHERE token = $1', [token, h]);
console.log(`export buttons added (${rows[0].html.length} -> ${h.length} bytes); original backed up to ${backup}`);
await pool.end();
