import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, number } from '../lib/format.js';
import { CATEGORICAL } from '../lib/palette.js';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

const METRICS = [
  { value: 'revenue', label: 'Revenue', formatter: money },
  { value: 'quantity', label: 'Quantity', formatter: number },
];

export default function ProductMix() {
  const { params } = useFilters();
  const [rows, setRows]       = useState([]);
  const [metric, setMetric]   = useState('revenue');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/analytics/products', { params })
      .then(r => setRows(r.data.rows))
      .finally(() => setLoading(false));
  }, [params.startDate, params.endDate, params.park]);

  const active = METRICS.find(m => m.value === metric);
  const top15 = [...rows].sort((a, b) => b[metric] - a[metric]).slice(0, 15).reverse();

  return (
    <div className="relative space-y-6">
      <LoadingOverlay show={loading && rows.length > 0} />
      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 w-fit">
        {METRICS.map(m => (
          <button
            key={m.value}
            onClick={() => setMetric(m.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              metric === m.value ? 'bg-az text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            By {m.label}
          </button>
        ))}
      </div>

      <div className="card p-5">
        <p className="text-sm font-semibold text-gray-700 mb-4">Top Products — Top 15 by {active.label}</p>
        {rows.length === 0 && loading ? (
          <LoadingBlock h="h-96" />
        ) : top15.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">No line items in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(360, top15.length * 32)}>
            <BarChart data={top15} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tickFormatter={active.formatter} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={220} tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip formatter={active.formatter} />} cursor={{ fill: '#f3f4f6' }} />
              <Bar dataKey={metric} name={active.label} fill={CATEGORICAL[0]} radius={[0, 4, 4, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
