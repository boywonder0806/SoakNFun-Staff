import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, number } from '../lib/format.js';
import { PARK_COLOR } from '../lib/palette.js';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

export default function SalesOffices() {
  const { params } = useFilters();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/analytics/offices', { params })
      .then(r => setRows(r.data.rows))
      .finally(() => setLoading(false));
  }, [params.startDate, params.endDate, params.park]);

  const sorted = [...rows].sort((a, b) => b.revenue - a.revenue).reverse();
  const parksPresent = [...new Set(sorted.map(r => r.park).filter(Boolean))];

  return (
    <div className="relative space-y-6">
      <LoadingOverlay show={loading && rows.length > 0} />
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-gray-700">Revenue by Sales Office</p>
          {parksPresent.length > 1 && (
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {parksPresent.map(p => (
                <span key={p} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: PARK_COLOR[p] || '#9ca3af' }} />
                  {p === 'BB' ? 'Blue Bayou' : 'Gulf Islands'}
                </span>
              ))}
            </div>
          )}
        </div>
        {rows.length === 0 && loading ? (
          <LoadingBlock h="h-96" />
        ) : sorted.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">No orders in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(360, sorted.length * 32)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tickFormatter={money} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="office" width={180} tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip
                content={<ChartTooltip
                  formatter={(v, name) => (name === 'Revenue' ? money(v) : number(v))}
                />}
                cursor={{ fill: '#f3f4f6' }}
              />
              <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]} maxBarSize={22}>
                {sorted.map((r, i) => <Cell key={i} fill={PARK_COLOR[r.park] || '#9ca3af'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
