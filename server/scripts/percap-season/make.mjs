/**
 * Builds a Gulf Islands season per cap dashboard from the analytics database and writes the
 * finished HTML to a file (it is not published — see publish.mjs). The 2025 dashboard is the
 * template; its data and the 2026 dashboard's supply the product classifications.
 *
 *   node scripts/percap-season/make.mjs <season> <out.html>
 *   node scripts/percap-season/make.mjs 2025 /root/check-2025.html --compare   # rebuild 2025 and diff it
 *
 * Report data never goes in the repo (it is public): only these scripts do.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../src/db/index.js';
import { buildSeason } from './build.mjs';
import { applyExport } from '../percap-export/splice.mjs';

const TEMPLATE = '34MfFwzKgPTujjuNiIRzNCBKEw8ZQQvI';   // 2025 Gulf Islands dashboard
const PRODUCTS_2026 = 'f3flni7C7lGtkbnOBmxRvlxcomEj9en9';

const fmt = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const SEASONS = {
  2025: { start: '2024-11-27', end: '2025-09-01', open: '2025-05-17' },
  2024: {
    start: '2023-11-23', end: '2024-09-02', open: '2024-05-18', pulled: '2026-11-02', passScansFrom: '2024-07-05',
    footer: (D, x) => `<b>Basis of preparation.</b> The 2024 season ran at Gulf Islands only. Figures come from RocketRez orders pulled into our analytics database on ${fmt(x.pulled)} and cover every paid (Active) order dated ${fmt(x.start)} through ${fmt(x.end)}. Attendance is every admission ticket booked for the visit date (day ticket, group, comp, etc.) plus season pass scans at the gate. <b>Season pass visits were only recorded from ${fmt(x.passScansFrom)}</b>: RocketRez holds no passholder entries for ${fmt(x.open).replace(/, \d{4}$/, '')} – ${fmt('2024-07-04')}, so attendance for that stretch is understated and per caps for any range that includes it run high. Gate check-in scans are not available for 2024, so the checked-in basis is unavailable and every day with tickets booked counts as an operating day. Revenue is pre-tax and recognized on the transaction date, the same as the 2025 and 2026 dashboards.
    <br><br><b>Tickets &amp; passes</b> = day tickets, season pass sales (new, upgrade and premium), prepaid admission passes and gate admissions of every kind. In-park is everything else, including snacks and candy sold at the gift shop, which count as food; meal and snack vouchers count as food. Gulf Islands was the only park operating in 2024, so every sale is credited to it, including sales rung up through the Admin back-office desk. Products are assigned to categories by the same rules as the 2025 dashboard: exact matches to the 2025 and 2026 product lists first, then a hand-reviewed list for products first sold in 2024, then product-name rules. SOAR – Autism Family Day guests are not counted as attendance, as in 2025; its ticket revenue is included.
    <br><br><b>Alcohol</b>: no alcohol was sold at Gulf Islands in 2024, so the alcohol section is omitted and alcohol per caps are $0. <b>Gift shop</b> = the Retail category. <b>Cabanas &amp; rentals</b> = rate-type bookings for cabanas, clamshells, fish camps, sundecks and the pier/boat house venues, one unit per day; every unit counts as available from opening day (${fmt(x.open)}). Occupancy, RevPAC and ADR are defined exactly as on the 2025 and 2026 dashboards. Product and sales-office figures are monthly, so a custom date range rounds out to the months it touches in those sections.`,
    notice: x => `<div class="beta" role="note"><span class="tag">Data note</span><div><b>Season pass visits before ${fmt(x.passScansFrom).replace(/, \d{4}$/, '')} are not in the data.</b> RocketRez only began recording passholder entries on ${fmt(x.passScansFrom)}, so attendance from opening day through Jul 4 is understated and per caps for that period, and for the full season, run high. From Jul 5 on, attendance is complete.</div></div>`,
    updates: [{ date: '2026-11-12', text: 'First publish of the 2024 season dashboard for Gulf Islands, built from the full 2024 order history pulled from RocketRez into the analytics database. Same definitions as the 2025 dashboard.' }],
  },
};

const [season, outFile, ...flags] = process.argv.slice(2);
const cfg = SEASONS[season];
if (!cfg || !outFile) { console.error(`usage: make.mjs <${Object.keys(SEASONS).join('|')}> <out.html> [--compare]`); process.exit(1); }

const readData = html => { const i = html.indexOf('window.__DATA__'); return JSON.parse(html.slice(i, html.indexOf('\n', i)).replace(/^window.__DATA__\s*=\s*/, '').replace(/;\s*$/, '')); };
const { rows: rep } = await pool.query('SELECT token, html FROM shared_reports WHERE token = ANY($1)', [[TEMPLATE, PRODUCTS_2026]]);
const template = rep.find(r => r.token === TEMPLATE).html;
const D25 = readData(template), D26 = readData(rep.find(r => r.token === PRODUCTS_2026).html);

// A little past the season on both ends so late entries and pre-season sales are all in hand
const from = new Date(Date.parse(cfg.start) - 30 * 864e5).toISOString().slice(0, 10), to = new Date(Date.parse(cfg.end) + 60 * 864e5).toISOString().slice(0, 10);
const { rows: orders } = await pool.query(`SELECT order_id::text id, business_date::text d, to_char(created_date AT TIME ZONE 'America/Chicago','HH24')::int h, status s, sales_office_name o, park p, is_web_order w
  FROM analytics_orders WHERE business_date BETWEEN $1 AND $2`, [from, to]);
const { rows: lines } = await pool.query(`SELECT l.order_id::text id, l.name n, l.type t, l.quantity q, l.subtotal::float st, l.event_name e, l.event_date::text ed
  FROM analytics_order_line_items l JOIN analytics_orders a ON a.order_id = l.order_id WHERE a.business_date BETWEEN $1 AND $2`, [from, to]);
await pool.end();

const { data, unclassified } = buildSeason({ orders, lines, seasonStart: cfg.start, seasonEnd: cfg.end, openDay: cfg.open, D25, D26 });

// ---- Summary (and, for 2025, a section-by-section diff against the published dashboard)
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0), inS = d => d.d >= cfg.start && d.d <= cfg.end;
const totals = D => ({
  revenue: sum(D.days.filter(inS), d => d.r.reduce((a, b) => a + b, 0)), ...Object.fromEntries(D.buckets.map((b, i) => ['  ' + b, sum(D.days.filter(inS), d => d.r[i])])),
  attendance: sum(D.days, d => d.att), ...Object.fromEntries(['ga', 'sp', 'grp', 'comp', 'emp'].map(k => ['  mix ' + k, sum(D.days, d => d.ab ? d.ab[k] : 0)])),
  'operating days': D.days.filter(d => d.att > 0).length, products: D.products.length, 'products revenue': sum(D.products, p => sum(Object.values(p.m), v => v[1])),
  'alcohol drinks': sum(D.alc.days, d => d.q), 'retail items': sum(D.ret.days, d => d.q), 'retail web revenue': sum(D.ret.days, d => d.wr),
  'rental units': D.cab.units.length, 'rental unit-days': D.cab.lines.length, 'rental revenue': sum(D.cab.lines, x => x.r),
});
const mine = totals(data), ref = flags.includes('--compare') ? totals(D25) : null;
console.log(`season ${season}: ${cfg.start} → ${cfg.end}, opening day ${cfg.open}`);
for (const [k, v] of Object.entries(mine)) {
  const f = x => (Number.isInteger(x) ? x : x.toFixed(2)).toString().padStart(14);
  console.log(k.padEnd(22), f(v), ref ? f(ref[k]) + (Math.abs(ref[k] - v) < 0.02 ? '  ✓' : `  Δ ${(v - ref[k]).toFixed(2)}`) : '');
}
if (unclassified.length) { console.log(`\nauto-classified by name rules (${unclassified.length}):`); for (const u of unclassified) console.log(' ', u.rev.toFixed(2).padStart(10), u.b.padEnd(12), u.k); }
if (season === '2025') { console.log('\n(2025 is a validation rebuild; nothing written)'); process.exit(0); }

// ---- Dashboard HTML: the 2025 template with this season's data, titles, notes and the Export menu
data.meta.footer = cfg.footer(data, cfg); data.meta.updates = cfg.updates;
let h = template;
const swap = (a, b) => { const p = h.split(a); if (p.length !== 2) throw new Error(`expected one match: ${a.slice(0, 70)} (found ${p.length - 1})`); h = p.join(b); };
const i = h.indexOf('window.__DATA__'), j = h.indexOf('\n', i);
h = h.slice(0, i) + 'window.__DATA__ = ' + JSON.stringify(data).replace(/</g, '\\u003c') + ';' + h.slice(j);
swap('<title>2025 Season Per Cap Dashboard</title>', `<title>${season} Season Per Cap Dashboard</title>`);
swap('<p class="eyebrow">Season Per Cap · Gulf Islands · 2025</p>', `<p class="eyebrow">Season Per Cap · Gulf Islands · ${season}</p>`);
swap('<h1>2025 Season Per Cap Dashboard</h1>', `<h1>${season} Season Per Cap Dashboard</h1>`);
swap('across the 2025 Gulf Islands season', `across the ${season} Gulf Islands season`);
if (cfg.notice) { const a = h.indexOf('<div class="beta"'), b = h.indexOf('</div></div>', a) + '</div></div>'.length; h = h.slice(0, b) + '\n  ' + cfg.notice(cfg) + h.slice(b); }
if (!data.alc.days.length) {   // no alcohol sold: drop the section and its render call
  const a = h.indexOf('<section id="sec-alcohol">'), b = h.indexOf('</section>', a) + '</section>'.length;
  if (a < 0) throw new Error('alcohol section not found'); h = h.slice(0, a) + h.slice(b).replace(/^\s*\n/, '');
  swap(' renderAlcohol();', '');
}
h = applyExport(h, fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../percap-export/export-module.js'), 'utf8'));
fs.writeFileSync(outFile, h);
console.log(`\nwrote ${outFile} (${h.length} chars)`);
