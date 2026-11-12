// Page edits for a season with no alcohol sales (2024): the alcohol per cap measures would only
// repeat food & bev, so they come off the headline tiles, park table, trend menu and drill-down.
// Each pair is [template text, replacement]; the replacement never contains the template text,
// so applying them twice is a no-op.
export const NO_ALCOHOL_SWAPS = [
  ["      pcTile('Food & bev per cap', 'fb', 'food + non-alcoholic') +\n      pcTile('Food, bev & alcohol', 'fba', 'adds alcohol');",
   "      pcTile('Food & bev per cap', 'fb', 'food + drinks') +\n      pcTile('Retail per cap', 'retail', 'gift shop');"],
  ["      row('Food, bev & alcohol revenue', c => money(S[c].fba)) + bold('Food, bev & alcohol per cap', pc('fba')) + alt('fba') +\n      row('Alcohol revenue', c => money(S[c].alcohol)) + bold('Alcohol per cap', pc('alc')) + alt('alc') + row('Retail revenue'",
   "      row('Retail revenue'"],
  ['<option value="fba">Food, bev &amp; alcohol per cap</option><option value="alc">Alcohol per cap</option>', ''],
  ['<div><div class="l">F&B + alcohol</div><div class="v">${p ? money2(p.fba) : \'—\'}</div><div class="s">${p && bp ? delta(p.fba, bp.fba) : \'\'}</div></div>',
   '<div><div class="l">Retail per cap</div><div class="v">${p ? money2(p.retail) : \'—\'}</div><div class="s">${p && bp ? delta(p.retail, bp.retail) : \'\'}</div></div>'],
];

// Returns the edited html; throws if a swap's template text is neither present once nor already applied.
export function applyNoAlcohol(h) {
  for (const [a, b] of NO_ALCOHOL_SWAPS) {
    const n = h.split(a).length - 1;
    if (n === 1) h = h.split(a).join(b);
    else if (n > 1 || (b && !h.includes(b))) throw new Error(`no-alcohol edit: expected one match of ${a.slice(0, 70)} (found ${n})`);
  }
  // a saved link pointing at a removed trend metric falls back to blended
  const g = "    $('#metric').value = state.metric;", fix = "    if (state.metric === 'fba' || state.metric === 'alc') state.metric = 'blended';\n" + g;
  if (!h.includes(fix)) { if (h.split(g).length !== 2) throw new Error('no-alcohol edit: metric control not found once'); h = h.split(g).join(fix); }
  return h;
}
