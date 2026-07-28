import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, shortDate } from '../lib/format.js';
import { PARK_COLOR, CATEGORICAL } from '../lib/palette.js';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

const GRANULARITIES = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

// Merges two revenue-trend series (keyed by bucket) into one row-per-bucket
// dataset so a single chart can show BB vs GI as two lines.
function mergeSeries(bbRows, giRows) {
  const byBucket = new Map();
  for (const r of bbRows) byBucket.set(r.bucket, { bucket: r.bucket, BB: r.revenue });
  for (const r of giRows) {
    const row = byBucket.get(r.bucket) || { bucket: r.bucket };
    row.GI = r.revenue;
    byBucket.set(r.bucket, row);
  }
  return [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export default function RevenueTrends() {
  const { params, park } = useFilters();
  const [granularity, setGranularity] = useState('day');
  const [rows, setRows]               = useState([]);
  const [comparing, setComparing]     = useState(false);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    setLoading(true);
    const showComparison = park === 'ALL';
    setComparing(showComparison);

    const req = showComparison
      ? Promise.all([
          api.get('/analytics/revenue-trend', { params: { ...params, granularity, park: 'BB' } }),
          api.get('/analytics/revenue-trend', { params: { ...params, granularity, park: 'GI' } }),
        ]).then(([bb, gi]) => mergeSeries(bb.data.rows, gi.data.rows))
      : api.get('/analytics/revenue-trend', { params: { ...params, granularity } })
          .then(r => r.data.rows.map(row => ({ bucket: row.bucket, revenue: row.revenue })));

    req.then(setRows).finally(() => setLoading(false));
  }, [params.startDate, params.endDate, params.park, granularity]);

  return (
    <div className="relative space-y-6">
      <LoadingOverlay show={loading && rows.length > 0} />
      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 w-fit">
        {GRANULARITIES.map(g => (
          <button
            key={g.value}
            onClick={() => setGranularity(g.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              granularity === g.value ? 'bg-az text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="card p-5">
        <p className="text-sm font-semibold text-gray-700 mb-4">
          {comparing ? 'Revenue — Blue Bayou vs Gulf Islands' : 'Revenue'}
        </p>
        {rows.length === 0 && loading ? (
          <LoadingBlock />
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">No orders in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
              <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={64} />
              <Tooltip content={<ChartTooltip formatter={money} labelFormatter={shortDate} />} />
              {comparing && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {comparing ? (
                <>
                  <Line type="monotone" dataKey="BB" name="Blue Bayou" stroke={PARK_COLOR.BB} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="GI" name="Gulf Islands" stroke={PARK_COLOR.GI} strokeWidth={2} dot={false} connectNulls />
                </>
              ) : (
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke={CATEGORICAL[0]} strokeWidth={2} dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
