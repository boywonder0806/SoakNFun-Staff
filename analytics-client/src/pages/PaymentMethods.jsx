import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money } from '../lib/format.js';
import { colorForIndex } from '../lib/palette.js';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

export default function PaymentMethods() {
  const { params } = useFilters();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/analytics/payment-methods', { params })
      .then(r => setRows(r.data.rows))
      .finally(() => setLoading(false));
  }, [params.startDate, params.endDate, params.park]);

  const sorted = [...rows].filter(r => r.method).sort((a, b) => b.amount - a.amount).reverse();

  return (
    <div className="relative space-y-6">
      <LoadingOverlay show={loading && rows.length > 0} />
      <div className="card p-5">
        <p className="text-sm font-semibold text-gray-700 mb-4">Payment Method Breakdown</p>
        {rows.length === 0 && loading ? (
          <LoadingBlock h="h-96" />
        ) : sorted.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">No payments in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(320, sorted.length * 36)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tickFormatter={money} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="method" width={160} tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip formatter={money} />} cursor={{ fill: '#f3f4f6' }} />
              <Bar dataKey="amount" name="Amount" radius={[0, 4, 4, 0]} maxBarSize={24}>
                {sorted.map((_, i) => <Cell key={i} fill={colorForIndex(i)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
