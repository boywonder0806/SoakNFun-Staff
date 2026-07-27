import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import { CATEGORICAL } from '../lib/palette.js';
import KpiTile from '../components/KpiTile.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';

export default function Overview() {
  const { params } = useFilters();
  const [overview, setOverview] = useState(null);
  const [trend, setTrend]       = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/analytics/overview', { params }),
      api.get('/analytics/revenue-trend', { params: { ...params, granularity: 'day' } }),
    ])
      .then(([o, t]) => { setOverview(o.data); setTrend(t.data.rows); })
      .finally(() => setLoading(false));
  }, [params.startDate, params.endDate, params.park]);

  if (loading && !overview) {
    return <div className="text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Revenue" value={money(overview?.revenue)} />
        <KpiTile label="Orders" value={number(overview?.orderCount)} />
        <KpiTile label="Avg Order Value" value={moneyPrecise(overview?.avgOrderValue)} />
        <KpiTile
          label="Web vs In-Person"
          value={`${number(overview?.webOrderCount)} / ${number(overview?.inPersonOrderCount)}`}
          sub="web / in-person orders"
        />
      </div>

      <div className="card p-5">
        <p className="text-sm font-semibold text-gray-700 mb-4">Revenue Trend</p>
        {trend.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">No orders in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CATEGORICAL[0]} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={CATEGORICAL[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
              <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={64} />
              <Tooltip content={<ChartTooltip formatter={money} labelFormatter={shortDate} />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={CATEGORICAL[0]} strokeWidth={2} fill="url(#revFill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
