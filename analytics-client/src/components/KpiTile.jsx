// Delta renders vs. the comparison period: green up / red down, with a
// neutral gray for ~flat. `invert` flips the good/bad coloring for metrics
// where down is good.
export function DeltaChip({ delta, invert = false }) {
  if (delta == null || !isFinite(delta)) return null;
  const pct = delta * 100;
  const flat = Math.abs(pct) < 0.5;
  const up = pct > 0;
  const good = flat ? null : (invert ? !up : up);
  const cls = flat
    ? 'bg-gray-100 text-gray-500'
    : good
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-red-50 text-red-600';
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${cls}`}>
      {flat ? '—' : up ? '▲' : '▼'} {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function KpiTile({ label, value, sub, delta, deltaLabel, icon, accent = false }) {
  return (
    <div className={`card px-5 py-4 ${accent ? 'ring-1 ring-az/30 bg-gradient-to-br from-white to-emerald-50/60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
        {icon && <span className="text-base leading-none opacity-70">{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
        <p className="text-3xl font-bold text-gray-900 tabular-nums leading-none">{value}</p>
        <DeltaChip delta={delta} />
      </div>
      {(sub || deltaLabel) && (
        <p className="mt-1.5 text-xs text-gray-400">{sub || deltaLabel}</p>
      )}
    </div>
  );
}
