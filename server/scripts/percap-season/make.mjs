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
import { applyNoAlcohol } from './noalcohol.mjs';

const TEMPLATE = '34MfFwzKgPTujjuNiIRzNCBKEw8ZQQvI';   // 2025 Gulf Islands dashboard
const PRODUCTS_2026 = 'f3flni7C7lGtkbnOBmxRvlxcomEj9en9';

const fmt = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortList = ds => ds.map(d => fmt(d).replace(/, \d{4}$/, '')).join(', ').replace(/, ([^,]*)$/, ' and $1');
// Methodology sentence for a season whose check-ins came from a Head Count export (see --checkins)
const ciNote = x => `Checked in = gate check-ins from RocketRez's Head Count report (exported ${fmt(x.ci.exported)})${x.ci.noEvent ? ' plus season pass scans, which are recorded at the gate' : ''}. `
  + (x.ci.rate < 0.85 ? `Gate scanning was not used consistently: ${Math.round(100 * x.ci.rate)}% of the attendance above was scanned${x.ci.low.length ? `, and under 25% on ${x.ci.low.length} day${x.ci.low.length > 1 ? 's' : ''} (${shortList(x.ci.low)})` : ''}, so the checked-in basis understates attendance and overstates spend per guest; tickets booked is the better basis for comparing seasons. ` : '')
  + (x.ci.zero.length ? `${shortList(x.ci.zero)} had tickets booked but no check-ins and ${x.ci.zero.length > 1 ? 'are' : 'is'} treated as closed.` : 'Every day with tickets booked had check-ins, so no day is treated as a closure.');
const SEASONS = {
  2025: { start: '2024-11-27', end: '2025-09-01', open: '2025-05-17' },
  2024: {
    start: '2023-11-23', end: '2024-09-02', open: '2024-05-18', pulled: '2026-11-02', passScansFrom: '2024-07-05', passCoupons: true,
    weatherDays: ['2024-06-01', '2024-06-16', '2024-07-21'], partialDays: ['2024-07-26'],
    footer: (D, x) => `<b>Basis of preparation.</b> The 2024 season ran at Gulf Islands only. Figures come from RocketRez orders pulled into our analytics database on ${fmt(x.pulled)} and cover every paid (Active) order dated ${fmt(x.start)} through ${fmt(x.end)}. Attendance is every admission ticket booked for the visit date (day ticket, group, comp, etc.) plus passholder entries at the gate. ${x.ci ? ciNote(x) : 'Gate check-in scans are not available for 2024, so the checked-in basis is unavailable and every day with tickets booked counts as an operating day.'} Revenue is pre-tax and recognized on the transaction date, the same as the 2025 and 2026 dashboards.
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

// ---- Gate check-ins from a RocketRez Head Count export (--checkins <csv>). The export only sees tickets booked
// against the Waterpark Admission event, so its booked count must equal this build's event-dated admissions;
// admissions with no event (2024 season pass scans, rung up at the gate) are gate entries and count as checked in.
const ciFile = flags.includes('--checkins') ? flags[flags.indexOf('--checkins') + 1] : null;
if (ciFile) {
  const csvRows = txt => { const out = []; let row = [], f = '', q = false;
    for (let k = 0; k < txt.length; k++) { const ch = txt[k];
      if (q) { if (ch === '"' && txt[k + 1] === '"') { f += '"'; k++; } else if (ch === '"') q = false; else f += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[k + 1] === '\n') k++; row.push(f); out.push(row); row = []; f = ''; } else f += ch; }
    if (f || row.length) { row.push(f); out.push(row); } return out; };
  const num = s => +String(s).replace(/,/g, ''), hc = new Map();
  for (const r of csvRows(fs.readFileSync(ciFile, 'utf8'))) {
    const k = r.findIndex(c => /^\d+\/\d+\/\d{4} \d/.test(c)); if (k < 0) continue;   // date cell; +2 = total passengers, +8 = total checked in
    const [mo, da, yr] = r[k].split(' ')[0].split('/'), d = `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
    if (d < cfg.open || d > cfg.end) continue;
    const e = hc.get(d) || { b: 0, ci: 0 }; e.b += num(r[k + 2]); e.ci += num(r[k + 8]); hc.set(d, e);
  }
  const OA = new Map(orders.map(o => [o.id, o])), noEvent = new Map();
  for (const l of lines) { const o = OA.get(l.id); if (!o || o.s !== 'Active' || o.d < cfg.start || l.ed || !isAdmission(l) || o.d < cfg.open || o.d > cfg.end) continue; noEvent.set(o.d, (noEvent.get(o.d) || 0) + l.q); }
  const mism = [];
  for (const x of data.days) { if (!x.att && !hc.has(x.d)) continue; const h = hc.get(x.d) || { b: 0, ci: 0 }, ne = noEvent.get(x.d) || 0;
    if (h.b !== x.att - ne) mism.push(`${x.d} export ${h.b} vs build ${x.att - ne}`); x.ci = h.ci + ne; }
  for (const d of hc.keys()) if (!data.days.some(x => x.d === d)) mism.push(`${d} in export only`);
  if (mism.length) console.log(`\nHead Count booked ≠ event-dated admissions on ${mism.length} day(s):\n  ` + mism.join('\n  '));
  data.meta.hasCheckins = true;
  const op = data.days.filter(x => x.att > 0), ci = sum0(op, x => x.ci), att = sum0(op, x => x.att);
  const low = op.filter(x => x.ci / x.att < 0.25).map(x => x.d);
  cfg.ci = { ci, att, rate: ci / att, low, noEvent: sum0([...noEvent.values()], v => v), zero: op.filter(x => !x.ci).map(x => x.d), exported: fs.statSync(ciFile).mtime.toISOString().slice(0, 10) };
  console.log(`check-ins: ${ci} of ${att} (${(100 * ci / att).toFixed(1)}%), ${cfg.ci.noEvent} from no-event gate scans, ${low.length} day(s) under 25%, ${cfg.ci.zero.length} day(s) with none`);
}
function sum0(xs, f) { return xs.reduce((a, x) => a + f(x), 0); }

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
data.meta.footer = cfg.footer(data, cfg);
data.meta.updates = cfg.ci ? [...cfg.updates, { date: cfg.ci.exported, text: `<b>Check-ins loaded.</b> Gate check-in counts from the RocketRez Head Count report are now in, so the "Divide by: Checked in" option is on: ${cfg.ci.ci.toLocaleString('en-US')} guests checked in (${(100 * cfg.ci.rate).toFixed(1)}% of tickets booked)${cfg.ci.rate < 0.85 ? '. Gate scanning was patchy this season, so tickets booked remains the default basis; see the basis of preparation' : ''}.` }] : cfg.updates;
let h = template;
const swap = (a, b) => { const p = h.split(a); if (p.length !== 2) throw new Error(`expected one match: ${a.slice(0, 70)} (found ${p.length - 1})`); h = p.join(b); };
const i = h.indexOf('window.__DATA__'), j = h.indexOf('\n', i);
h = h.slice(0, i) + 'window.__DATA__ = ' + JSON.stringify(data).replace(/</g, '\\u003c') + ';' + h.slice(j);
swap('<title>2025 Season Per Cap Dashboard</title>', `<title>${season} Season Per Cap Dashboard</title>`);
swap('<p class="eyebrow">Season Per Cap · Gulf Islands · 2025</p>', `<p class="eyebrow">Season Per Cap · Gulf Islands · ${season}</p>`);
swap('<h1>2025 Season Per Cap Dashboard</h1>', `<h1>${season} Season Per Cap Dashboard</h1>`);
swap('across the 2025 Gulf Islands season', `across the ${season} Gulf Islands season`);
swap('), almost all of it season-pass sales.', '), mostly season-pass and advance ticket sales.');
// The template shows the "Divide by" control; a season without gate check-ins hides it
if (!data.meta.hasCheckins) swap('<div class="ctl"><label>Divide by</label>', '<div class="ctl" style="display:none"><label>Divide by</label>');
if (cfg.notice) { const a = h.indexOf('<div class="beta"'), b = h.indexOf('</div></div>', a) + '</div></div>'.length; h = h.slice(0, b) + '\n  ' + cfg.notice(cfg) + h.slice(b); }
if (!data.alc.days.length) {   // no alcohol sold: drop the section and its render call
  const a = h.indexOf('<section id="sec-alcohol">'), b = h.indexOf('</section>', a) + '</section>'.length;
  if (a < 0) throw new Error('alcohol section not found'); h = h.slice(0, a) + h.slice(b).replace(/^\s*\n/, '');
  swap(' renderAlcohol();', '');
  swap("    $('#ametric').value = state.ametric;", "    if ($('#ametric')) { $('#ametric').value = state.ametric;");
  swap("    $('#agran').value = state.agran; $('#agran').onchange = e => { state.agran = e.target.value; renderAlcTrend(); writeHash(); };",
       "    $('#agran').value = state.agran; $('#agran').onchange = e => { state.agran = e.target.value; renderAlcTrend(); writeHash(); }; }");
  h = applyNoAlcohol(h);   // alcohol per caps would only repeat food & bev
}
h = applyExport(h, fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../percap-export/export-module.js'), 'utf8'));
fs.writeFileSync(outFile, h);
console.log(`\nwrote ${outFile} (${h.length} chars)`);
