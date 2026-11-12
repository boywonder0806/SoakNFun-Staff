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
import { norm, isAdmission, isPassCoupon } from './rules.mjs';
import { applyExport } from '../percap-export/splice.mjs';

const TEMPLATE = '34MfFwzKgPTujjuNiIRzNCBKEw8ZQQvI';   // 2025 Gulf Islands dashboard
const PRODUCTS_2026 = 'f3flni7C7lGtkbnOBmxRvlxcomEj9en9';

const fmt = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const SEASONS = {
  2025: { start: '2024-11-27', end: '2025-09-01', open: '2025-05-17' },
  2024: {
    start: '2023-11-23', end: '2024-09-02', open: '2024-05-18', pulled: '2026-11-02', passScansFrom: '2024-07-05', passCoupons: true,
    weatherDays: ['2024-06-01', '2024-06-16', '2024-07-21'], partialDays: ['2024-07-26'],
    footer: (D, x) => `<b>Basis of preparation.</b> The 2024 season ran at Gulf Islands only. Figures come from RocketRez orders pulled into our analytics database on ${fmt(x.pulled)} and cover every paid (Active) order dated ${fmt(x.start)} through ${fmt(x.end)}. Attendance is every admission ticket booked for the visit date (day ticket, group, comp, etc.) plus passholder entries at the gate. Gate check-in scans are not available for 2024, so the checked-in basis is unavailable and every day with tickets booked counts as an operating day. Revenue is pre-tax and recognized on the transaction date, the same as the 2025 and 2026 dashboards.
    <br><br><b>Tickets &amp; passes</b> = day tickets, season pass sales (new, upgrade and premium), prepaid admission passes and gate admissions of every kind. In-park is everything else, including snacks and candy sold at the gift shop, which count as food; meal and snack vouchers count as food. Gulf Islands was the only park operating in 2024, so every sale is credited to it, including sales rung up through the Admin back-office desk. Products are assigned to categories by the same rules as the 2025 dashboard: exact matches to the 2025 and 2026 product lists first, then a hand-reviewed list for products first sold in 2024, then product-name rules. SOAR – Autism Family Day guests are not counted as attendance, as in 2025; its ticket revenue is included.
    <br><br><b>Alcohol</b>: no alcohol was sold at Gulf Islands in 2024, so the alcohol section is omitted and alcohol per caps are $0. <b>Gift shop</b> = the Retail category. <b>Cabanas &amp; rentals</b> = rate-type bookings for cabanas, clamshells, fish camps, sundecks and the pier/boat house venues, one unit per day; every unit counts as available from opening day (${fmt(x.open)}). Occupancy, RevPAC and ADR are defined exactly as on the 2025 and 2026 dashboards. Product and sales-office figures are monthly, so a custom date range rounds out to the months it touches in those sections.
    <br><br>${x.notes}`,
    notice: x => `<div class="beta" role="note"><span class="tag">Data note</span><div><b>Season pass visits are incomplete on a few days.</b> Passholders were recorded as $0 gate admissions from ${fmt(x.n.couponFrom).replace(/, \d{4}$/, '')} and as season pass scans from ${fmt(x.passScansFrom).replace(/, \d{4}$/, '')}, but few or none are recorded ${x.n.gaps}, so per caps on those days run high. Weather days and a booking under review are noted at the bottom of the page.</div></div>`,
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
const { rows: lines } = await pool.query(`SELECT l.order_id::text id, l.name n, l.type t, l.quantity q, l.price::float pr, l.coupon_amount::float cp, l.subtotal::float st, l.event_name e, l.event_date::text ed
  FROM analytics_order_line_items l JOIN analytics_orders a ON a.order_id = l.order_id WHERE a.business_date BETWEEN $1 AND $2`, [from, to]);
await pool.end();

const { data, unclassified } = buildSeason({ orders, lines, seasonStart: cfg.start, seasonEnd: cfg.end, openDay: cfg.open, D25, D26, passCoupons: !!cfg.passCoupons });

// ---- Facts for the season's data notes, computed from the data (nothing hardcoded in this public repo)
if (cfg.passCoupons) {
  const OA = new Map(orders.map(o => [o.id, o])), inSeason = d => d >= cfg.open && d <= cfg.end;
  const adm = lines.filter(l => isAdmission(l) && OA.get(l.id));
  const act = adm.filter(l => OA.get(l.id).s === 'Active'), vdate = l => l.ed || OA.get(l.id).d;
  const passByDay = new Map(); let coupons = 0;
  for (const l of act) { const d = vdate(l); if (!inSeason(d)) continue; const pass = isPassCoupon(l) || /^season pass scan/i.test(norm(l.n)); if (pass) passByDay.set(d, (passByDay.get(d) || 0) + l.q); if (isPassCoupon(l)) coupons += l.q; }
  const opDays = data.days.filter(d => d.att > 0).map(d => d.d);
  const buyout = data.days.filter(d => d.ab && d.ab.grp >= 1000 && d.ab.grp / d.att > 0.95).map(d => d.d);
  const skip = d => cfg.weatherDays.includes(d) || buyout.includes(d), pd = d => passByDay.get(d) || 0;
  // Coupon entries "begin" on the first day of three consecutive operating days with 100+ entries
  const couponFrom = opDays.find((d, i) => d < cfg.passScansFrom && [0, 1, 2].every(k => opDays[i + k] && pd(opDays[i + k]) >= 100));
  const later = opDays.filter(d => d >= couponFrom && !skip(d)).map(pd).sort((a, b) => a - b), median = later[Math.floor(later.length / 2)];
  const thin = opDays.filter(d => !skip(d) && (d < couponFrom || pd(d) < median / 4));
  const runs = []; for (const d of thin) { const last = runs[runs.length - 1]; if (last && opDays.indexOf(d) === opDays.indexOf(last[1]) + 1) last[1] = d; else runs.push([d, d]); }
  const short = d => fmt(d).replace(/, \d{4}$/, '');
  const gaps = runs.map(([a, b]) => a === b ? short(a) : `${short(a)} – ${short(b)}`).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const cancelPct = d => { let a = 0, c = 0; for (const l of adm) { if (vdate(l) !== d) continue; const s = OA.get(l.id).s; if (s === 'Active') a += l.q; else if (s === 'Cancelled') c += l.q; } return Math.round(100 * c / ((a + c) || 1)); };
  const zeroGroup = new Map(); for (const l of act) { if (!/^group\b/i.test(norm(l.n)) || l.st !== 0 || !inSeason(vdate(l))) continue; const e = zeroGroup.get(l.id) || { q: 0, days: new Set() }; e.q += l.q; e.days.add(vdate(l)); zeroGroup.set(l.id, e); }
  const camp = [...zeroGroup.values()].sort((a, b) => b.q - a.q)[0];
  const grpTotal = data.days.reduce((a, d) => a + (d.ab ? d.ab.grp : 0), 0);
  const late = act.filter(l => OA.get(l.id).d > cfg.end && inSeason(vdate(l))); const lateQ = late.reduce((a, l) => a + l.q, 0);
  const list = ds => ds.map(short).join(', ').replace(/, ([^,]*)$/, ' and $1');
  cfg.n = { couponFrom, gaps };
  cfg.notes = `<b>Data notes.</b> <b>Season pass visits:</b> before scans began on ${short(cfg.passScansFrom)}, passholders were admitted on a $0 General Admission ticket with a 100% coupon; those ${coupons.toLocaleString('en-US')} entries are counted as season pass visits. Few or no passholder entries are recorded ${gaps}, so attendance on those days is understated. `
    + `<b>Weather:</b> ${list(cfg.weatherDays)} look like weather closures (${cfg.weatherDays.map(cancelPct).join('%, ')}% of tickets for those dates were cancelled while the food and gift registers sold for a few hours)${cfg.partialDays.length ? ` and ${list(cfg.partialDays)} a partial close (${cfg.partialDays.map(cancelPct).join('%, ')}% cancelled)` : ''}; they are counted as normal operating days, so their per caps are inflated. `
    + (buyout.length ? `<b>Private event:</b> ${list(buyout)} was a private group buyout, so its attendance is almost entirely group. ` : '')
    + (camp ? `<b>Under review:</b> one $0 back-office booking reserves group admission on ${camp.days.size} dates (${camp.q.toLocaleString('en-US')} guests, ${Math.round(100 * camp.q / grpTotal)}% of group attendance), likely a standing camp reservation; it is counted as attendance pending review. ` : '')
    + (lateQ ? `<b>Late entries:</b> ${lateQ.toLocaleString('en-US')} admissions for season dates were entered after ${short(cfg.end)}; the guests count in attendance but their sales fall after the season window.` : '');
  console.log('\ndata notes:', cfg.notes.replace(/<[^>]+>/g, ''));
}

// ---- Summary (and, for 2025, a section-by-section diff against the published dashboard)
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0), inS = d => d.d >= cfg.start && d.d <= cfg.end;
const totals = D => ({
  revenue: sum(D.days.filter(inS), d => d.r.reduce((a, b) => a + b, 0)), ...Object.fromEntries(D.buckets.map((b, i) => ['  ' + b, sum(D.days.filter(inS), d => d.r[i])])),
  attendance: sum(D.days, d => d.att), ...Object.fromEntries(['ga', 'sp', 'grp', 'comp', 'emp'].map(k => ['  mix ' + k, sum(D.days, d => d.ab ? d.ab[k] : 0)])),
  'operating days': D.days.filter(d => d.att > 0).length, products: D.products.length, 'products revenue': sum(D.products, p => sum(Object.values(p.m), v => v[1])),
  'alcohol drinks': sum(D.alc.days, d => d.q), 'retail items': sum(D.ret.days, d => d.q), 'retail orders': sum(D.ret.days, d => d.ord), 'retail web revenue': sum(D.ret.days, d => d.wr),
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
swap("(${fmtShort(D.meta.seasonStart)} – ${fmtShort(D.meta.preSeasonEnd)}), almost all of it season-pass sales.",
     "(${fmtShort(D.meta.seasonStart)} – ${fmtShort(new Date(dt(D.meta.openDay).getTime() - 864e5).toISOString().slice(0, 10))}), mostly season-pass and advance ticket sales.");
if (cfg.notice) { const a = h.indexOf('<div class="beta"'), b = h.indexOf('</div></div>', a) + '</div></div>'.length; h = h.slice(0, b) + '\n  ' + cfg.notice(cfg) + h.slice(b); }
if (!data.alc.days.length) {   // no alcohol sold: drop the section and its render call
  const a = h.indexOf('<section id="sec-alcohol">'), b = h.indexOf('</section>', a) + '</section>'.length;
  if (a < 0) throw new Error('alcohol section not found'); h = h.slice(0, a) + h.slice(b).replace(/^\s*\n/, '');
  swap(' renderAlcohol();', '');
  swap("    $('#ametric').value = state.ametric;", "    if ($('#ametric')) { $('#ametric').value = state.ametric;");
  swap("    $('#agran').value = state.agran; $('#agran').onchange = e => { state.agran = e.target.value; renderAlcTrend(); writeHash(); };",
       "    $('#agran').value = state.agran; $('#agran').onchange = e => { state.agran = e.target.value; renderAlcTrend(); writeHash(); }; }");
}
h = applyExport(h, fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../percap-export/export-module.js'), 'utf8'));
fs.writeFileSync(outFile, h);
console.log(`\nwrote ${outFile} (${h.length} chars)`);
