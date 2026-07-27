// Shared tooltip styling for all Recharts charts — rounded surface, muted
// text tokens (never the series color for text), one line per series.
export default function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      {label != null && <p className="font-semibold text-gray-700 mb-1">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-gray-600">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill }} />
          <span>{p.name}:</span>
          <span className="font-semibold text-gray-900 tabular-nums">
            {formatter ? formatter(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}
