// Builds the per cap dashboard dataset (window.__DATA__) for a single-park Gulf Islands season.
// orders: [{ id, d (business date), h (Central hour), s (status), o (office), p (park), w (web) }]
// lines:  [{ id, n, t, q, st (pre-tax subtotal), e (event), ed (event date) }]
// D25 / D26: the published 2025 and 2026 dashboard datasets, used for product, retail-group and unit maps.
import { norm, pkey, isAdmission, abOf, OVERRIDE, RGROUP_OVERRIDE, isPassCoupon, RULES, ACATS, acat, rgroupRule, CABRX, unitName, unitTypeRule } from './rules.mjs';

export function buildSeason({ orders, lines, seasonStart, seasonEnd, openDay, D25, D26, passCoupons = false }) {
  const B = D25.buckets, BL = D25.bucketLabels;

  // ---- Product → bucket: hand overrides, exact product-list match (2025 wins over 2026), last segment, rules
  // Names are matched with spacing collapsed. The 2025 list sometimes has one name under two buckets
  // (rung at different registers); the bucket carrying most of that product's revenue wins, 2025 before 2026.
  const vote = list => { const m = new Map(); for (const p of list) { const ks = [norm(p.n) + '|' + p.t, '~' + norm(p.n).split(' · ').pop().toLowerCase() + '|' + p.t];
    const rev = Object.values(p.m).reduce((a, v) => a + Math.abs(v[1]), 0) + 1e-6; for (const k of ks) { const e = m.get(k) || {}; e[p.b] = (e[p.b] || 0) + rev; m.set(k, e); } }
    return new Map([...m].map(([k, e]) => [k, Object.entries(e).sort((a, c) => c[1] - a[1])[0][0]])); };
  const v25 = vote(D25.products), v26 = vote(D26.products);
  const exact = { get: k => v25.get(k) || v26.get(k), has: k => v25.has(k) || v26.has(k) };
  const byLast = { get: k => v25.get('~' + k) || v26.get('~' + k), has: k => v25.has('~' + k) || v26.has('~' + k) };
  const overrideOf = new Map(Object.entries(OVERRIDE).flatMap(([bk, ns]) => ns.map(n => [n, bk])));
  const unclassified = new Map();
  const note = (k, t, b, l) => { const u = unclassified.get(k + '|' + t) || { k, t, b, rev: 0, q: 0 }; u.rev += l.st; u.q += l.q; unclassified.set(k + '|' + t, u); return b; };
  function bucketOf(l) {
    const k = pkey(l), t = l.t;
    if (overrideOf.has(k)) return overrideOf.get(k);
    if (exact.has(k + '|' + t)) return exact.get(k + '|' + t);
    const last = k.split(' · ').pop().toLowerCase() + '|' + t; if (byLast.has(last)) return byLast.get(last);
    if (t === 'Membership' || isAdmission(l)) return 'ticket';
    for (const [rx, b] of RULES) if (rx.test(k)) return note(k, t, b, l);
    return note(k, t, 'otherInPark', l);
  }

  // ---- Scope: Active orders dated from the first sale; single park, so back-office (no park) orders count as GI
  const O = new Map(orders.filter(o => o.s === 'Active' && o.d >= seasonStart).map(o => [o.id, o]));
  const L = lines.filter(l => O.has(l.id));
  const withLines = new Set(L.map(l => l.id));
  const month = d => d.slice(0, 7);
  const r2 = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v[0], +v[1].toFixed(2)]]));

  // ---- Days: revenue on the transaction date, attendance on the visit date
  const days = new Map();
  const day = d => { if (!days.has(d)) days.set(d, { d, p: 'GI', att: 0, ci: 0, orders: 0, web: 0, r: B.map(() => 0), ab: { ga: 0, sp: 0, grp: 0, comp: 0, emp: 0 } }); return days.get(d); };
  for (const o of O.values()) if (withLines.has(o.id)) { const x = day(o.d); x.orders++; if (o.w) x.web++; }
  for (const l of L) {
    const o = O.get(l.id); l.b = bucketOf(l);
    day(o.d).r[B.indexOf(l.b)] += l.st;
    // Season pass scans (2024) carry no event, so no visit date: they are rung up at the gate on the day of the visit.
    const vd = l.ed || (isAdmission(l) ? o.d : null);
    if (isAdmission(l) && vd && vd >= openDay && vd <= seasonEnd) { const x = day(vd); x.att += l.q; x.ab[passCoupons && isPassCoupon(l) ? 'sp' : abOf(norm(l.n))] += l.q; }
  }
  const dayList = [...days.values()].sort((a, b) => a.d.localeCompare(b.d)).map(x => ({ ...x, r: x.r.map(v => +v.toFixed(2)) }));
  for (const x of dayList) if (!x.att) delete x.ab;

  // ---- Products and sales offices (monthly)
  const prods = new Map(), offs = new Map();
  for (const l of L) {
    const o = O.get(l.id), m = month(o.d), k = pkey(l);
    const p = prods.get(k + '|' + l.t) || { n: k, p: 'GI', t: l.t, b: l.b, m: {} }; const pm = p.m[m] || [0, 0]; pm[0] += l.q; pm[1] += l.st; p.m[m] = pm; prods.set(k + '|' + l.t, p);
    const on = (o.o || '').trim() || '(no office)';
    const of = offs.get(on) || { o: on, p: 'GI', m: {} }; const om = of.m[m] || { r: B.map(() => 0), q: 0, orders: 0, _o: new Set() };
    om.r[B.indexOf(l.b)] += l.st; om.q += l.q; om._o.add(l.id); of.m[m] = om; offs.set(on, of);
  }
  const products = [...prods.values()].map(p => ({ ...p, m: r2(p.m) })).filter(p => Object.values(p.m).some(v => v[0] || v[1]));
  const offices = [...offs.values()].map(o => ({ ...o, m: Object.fromEntries(Object.entries(o.m).map(([k, v]) => [k, { r: v.r.map(x => +x.toFixed(2)), q: v.q, orders: v._o.size }])) }));

  // ---- Alcohol
  const alc = new Map();
  for (const l of L) { if (l.b !== 'alcohol') continue; const o = O.get(l.id);
    const a = alc.get(o.d) || { d: o.d, p: 'GI', q: 0, ord: new Set(), c: {}, cs: [0, 0], h: {} };
    a.q += l.q; a.ord.add(l.id); const c = acat(pkey(l)); a.c[c] = a.c[c] || [0, 0]; a.c[c][0] += l.q; a.c[c][1] += l.st;
    a.h[o.h] = a.h[o.h] || [0, 0]; a.h[o.h][0] += l.q; a.h[o.h][1] += l.st; alc.set(o.d, a); }
  const alcDays = [...alc.values()].sort((a, b) => a.d.localeCompare(b.d)).map(a => ({ ...a, ord: a.ord.size, c: r2(a.c), h: r2(a.h) }));

  // ---- Gift shops ($0 lines are left out of item counts; hour of day is in-park registers only)
  const rgroup = n => RGROUP_OVERRIDE[n] || D25.ret.cat[n] || D26.ret?.cat?.[n] || rgroupRule(n);
  const retCat = {}, ret = new Map(), retOff = new Map();
  for (const l of L) { if (l.b !== 'retail') continue; const o = O.get(l.id), n = pkey(l), g = rgroup(n); retCat[n] = g;
    const x = ret.get(o.d) || { d: o.d, p: 'GI', q: 0, ord: new Set(), wob: new Set(), wr: 0, c: {}, h: {} };
    if (l.st !== 0) { x.q += l.q; x.c[g] = x.c[g] || [0, 0]; x.c[g][0] += l.q; x.c[g][1] += l.st; }
    x.ord.add(l.id); // every order with retail, web included (the page subtracts wob for in-person attach)
    if (o.w) { x.wob.add(l.id); x.wr += l.st; } else if (l.st !== 0) { x.h[o.h] = x.h[o.h] || [0, 0]; x.h[o.h][0] += l.q; x.h[o.h][1] += l.st; }
    ret.set(o.d, x);
    const on = (o.o || '').trim(), m = month(o.d); const of = retOff.get(on) || { o: on, p: 'GI', m: {} }; const v = of.m[m] || [0, 0, new Set()];
    if (l.st !== 0) v[0] += l.q; v[1] += l.st; v[2].add(l.id); of.m[m] = v; retOff.set(on, of); }
  const retDays = [...ret.values()].sort((a, b) => a.d.localeCompare(b.d)).map(x => ({ ...x, ord: x.ord.size, wob: x.wob.size, wr: +x.wr.toFixed(2), c: r2(x.c), h: r2(x.h) }));
  const retOffices = [...retOff.values()].map(o => ({ ...o, m: Object.fromEntries(Object.entries(o.m).map(([k, v]) => [k, [v[0], +v[1].toFixed(2), v[2].size]])) }));

  // ---- Cabanas & rentals: in service from opening day; entries made after season close are left out
  const known = new Map(D25.cab.units.map(u => [u.u, u.type]));
  const units = [], uidx = new Map(), cabLines = [];
  for (const l of L) {
    if (l.t !== 'Rate' || !CABRX.test(norm(l.n) + ' ' + norm(l.e)) || isAdmission(l) || !l.ed) continue;
    const o = O.get(l.id); if (l.ed < openDay || l.ed > seasonEnd || o.d > seasonEnd) continue;
    const n = unitName(l);
    if (!uidx.has(n)) { uidx.set(n, units.length); units.push({ u: n, park: 'GI', type: known.get(n) || unitTypeRule(n), first: l.ed, from: openDay }); }
    const u = units[uidx.get(n)]; if (l.ed < u.first) u.first = l.ed;
    for (let k = 0; k < Math.max(1, l.q); k++) cabLines.push({ i: uidx.get(n), v: l.ed, s: o.d, w: o.w ? 1 : 0, r: +(l.st / Math.max(1, l.q)).toFixed(2) });
  }
  const order = units.map((u, i) => [u, i]).sort((a, b) => a[0].u.localeCompare(b[0].u)); const remap = new Map(order.map(([, i], j) => [i, j]));
  const cab = { units: order.map(([u]) => u), lines: cabLines.map(x => ({ ...x, i: remap.get(x.i) })).sort((a, b) => a.v.localeCompare(b.v) || a.i - b.i), bbLaunch: null, openDay: { GI: openDay } };

  const months = [...new Set(dayList.filter(d => d.d >= seasonStart && d.d <= seasonEnd).map(d => month(d.d)))].sort();
  const preSeasonEnd = new Date(Date.parse(openDay + 'T12:00:00Z') - 86400000 * (+openDay.slice(8, 10))).toISOString().slice(0, 10);
  const data = { meta: { seasonStart, seasonEnd, openDay, preSeasonEnd, months, hasCheckins: false },
    buckets: B, bucketLabels: BL, days: dayList, products, offices, alc: { cats: ACATS, days: alcDays }, ret: { cats: D25.ret.cats, cat: retCat, days: retDays, offices: retOffices }, cab };
  return { data, unclassified: [...unclassified.values()].sort((a, b) => Math.abs(b.rev) - Math.abs(a.rev)) };
}
