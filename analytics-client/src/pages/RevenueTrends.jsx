import { useEffect, useState } from 'react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import { PARK_COLOR, CATEGORICAL } from '../lib/palette.js';
import KpiTile from '../components/KpiTile.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

const GRANULARITIES = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

// Fixed identity colors — palette slots, never reassigned by filters.
const CATEGORIES = [
  { key: 'admissions', label: 'Admissions',      color: CATEGORICAL[0] },
  { key: 'fnb',        label: 'Food & Beverage', color: CATEGORICAL[1] },
  { key: 'passes',     label: 'Season Passes',   color: CATEGORICAL[2] },
  { key: 'retail',     label: 'Retail',          color: CATEGORICAL[4] },
  { key: 'cabanas',    label: 'Cabanas',         color: CATEGORICAL[3] },
  { key: 'parking',    label: 'Parking',         color: CATEGORICAL[5] },
  { key: 'other',      label: 'Other',           color: '#9ca3af' },
];
const CHANNELS = [
  { key: 'online',   label: 'Online',    color: CATEGORICAL[0] },
  { key: 'inPerson', label: 'In person', color: CATEGORICAL[1] },
];

// The comparison window: yesterday for a single-day view, the preceding
// same-length window for a range.
function previousRange(startDate, endDate) {
  const s = new Date(`${startDate}T12:00:00Z`);
  const e = new Date(`${endDate}T12:00:00Z`);
  const days = Math.round((e - s) / 86_400_000) + 1;
  const fmt = d => d.toISOString().slice(0, 10);
  return {
    startDate: fmt(new Date(s.getTime() - days * 86_400_000)),
    endDate:   fmt(new Date(e.getTime() - days * 86_400_000)),
    days,
  };
}

function delta(cur, prev) {
  if (!prev) return null;
  return (cur - prev) / prev;
}

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

// Trailing moving average over the revenue series (window = 7 buckets),
// only meaningful on daily granularity with enough points.
function withMovingAverage(rows, window = 7) {
  return rows.map((r, i) => {
    const slice = rows.slice(Math.max(0, i - window + 1), i + 1);
    return { ...r, ma: slice.reduce((s, x) => s + x.revenue, 0) / slice.length };
  });
}

function SectionCard({ title, right, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

const axisProps = {
  x: { tick: { fontSize: 11, fill: '#6b7280' }, axisLine: { stroke: '#e5e7eb' }, tickLine: false },
  y: { tick: { fontSize: 11, fill: '#6b7280' }, axisLine: false, tickLine: false, width: 64 },
};

export default function RevenueTrends() {
  const { params, park } = useFilters();
  const [granularity, setGranularity] = useState('day');
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);

  const singleDay = params.startDate === params.endDate;
  const gran = singleDay ? 'hour' : granularity;
  const comparing = park === 'ALL';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const prev = previousRange(params.startDate, params.endDate);
    const prevParams = { ...params, startDate: prev.startDate, endDate: prev.endDate };

    const trendReq = comparing
      ? Promise.all([
          api.get('/analytics/revenue-trend', { params: { ...params, granularity: gran, park: 'BB' } }),
          api.get('/analytics/revenue-trend', { params: { ...params, granularity: gran, park: 'GI' } }),
        ]).then(([bb, gi]) => ({ merged: mergeSeries(bb.data.rows, gi.data.rows), single: null }))
      : api.get('/analytics/revenue-trend', { params: { ...params, granularity: gran } })
          .then(r => ({ merged: null, single: r.data.rows }));

    Promise.all([
      trendReq,
      api.get('/analytics/overview', { params }),
      api.get('/analytics/overview', { params: prevParams }),
      api.get('/analytics/revenue-breakdown', { params: { ...params, granularity: gran } }),
    ])
      .then(([trend, cur, prv, breakdown]) => {
        if (cancelled) return;
        setData({ trend, overview: cur.data, prevOverview: prv.data, breakdown: breakdown.data, prevDays: prev.days });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.startDate, params.endDate, params.park, gran]);

  if (!data) return loading ? <LoadingBlock h="h-96" /> : <div className="text-sm text-gray-400">Failed to load.</div>;

  const { trend, overview, prevOverview, breakdown, prevDays } = data;
  const compareLabel = singleDay ? 'vs yesterday' : `vs previous ${prevDays} days`;

  const singleRows = trend.single ? (gran === 'day' && trend.single.length >= 10 ? withMovingAverage(trend.single) : trend.single) : null;
  const rows = trend.merged || singleRows || [];
  const hasMa = !!(singleRows && singleRows[0]?.ma != null);

  const bucketRevenue = r => trend.merged ? (r.BB || 0) + (r.GI || 0) : r.revenue;
  const best = rows.reduce((b, r) => (bucketRevenue(r) > (b ? bucketRevenue(b) : -1) ? r : b), null);
  const bucketNoun = gran === 'hour' ? 'hour' : gran === 'day' ? 'day' : gran;
  const avgPerBucket = rows.length ? rows.reduce((s, r) => s + bucketRevenue(r), 0) / rows.length : 0;
  const cumulative = rows.reduce((acc, r) => {
    acc.push({ bucket: r.bucket, cumulative: (acc.at(-1)?.cumulative || 0) + bucketRevenue(r) });
    return acc;
  }, []);
  const xTickFmt = gran === 'hour' ? undefined : shortDate;

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Total Revenue" icon="📈" accent
          value={money(overview.revenue)}
          delta={delta(overview.revenue, prevOverview.revenue)}
          sub={compareLabel}
        />
        <KpiTile
          label={`Avg per ${bucketNoun}`} icon="📊" accent
          value={money(avgPerBucket)}
          sub={`across ${number(rows.length)} ${bucketNoun}${rows.length === 1 ? '' : 's'}`}
        />
        <KpiTile
          label={`Best ${bucketNoun}`} icon="🏆"
          value={best ? money(bucketRevenue(best)) : '—'}
          sub={best ? (gran === 'hour' ? best.bucket : shortDate(best.bucket)) : 'no data'}
        />
        <KpiTile
          label="Avg Order Value" icon="🧾"
          value={moneyPrecise(overview.avgOrderValue)}
          delta={delta(overview.avgOrderValue, prevOverview.avgOrderValue)}
          sub={`${number(overview.orderCount)} orders`}
        />
      </div>

      <SectionCard
        title={comparing ? 'Revenue — Blue Bayou vs Gulf Islands' : 'Revenue'}
        right={!singleDay && (
          <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1">
            {GRANULARITIES.map(g => (
              <button key={g.value} onClick={() => setGranularity(g.value)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  granularity === g.value ? 'bg-az text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {g.label}
              </button>
            ))}
          </div>
        )}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">No orders in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={xTickFmt} {...axisProps.x} />
              <YAxis tickFormatter={money} {...axisProps.y} />
              <Tooltip content={<ChartTooltip formatter={money} labelFormatter={xTickFmt} />} />
              {(comparing || hasMa) && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {comparing ? (
                <>
                  <Line type="monotone" dataKey="BB" name="Blue Bayou" stroke={PARK_COLOR.BB} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="GI" name="Gulf Islands" stroke={PARK_COLOR.GI} strokeWidth={2} dot={false} connectNulls />
                </>
              ) : (
                <>
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke={CATEGORICAL[0]} strokeWidth={2} dot={false} />
                  {hasMa && <Line type="monotone" dataKey="ma" name="7-day average" stroke="#9ca3af" strokeWidth={2} strokeDasharray="6 4" dot={false} />}
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Revenue by Category" right={<span className="text-xs text-gray-400">pre-tax line items</span>}>
          {breakdown.categories.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No orders in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={breakdown.categories} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={xTickFmt} {...axisProps.x} />
                <YAxis tickFormatter={money} {...axisProps.y} />
                <Tooltip content={<ChartTooltip formatter={money} labelFormatter={xTickFmt} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {CATEGORIES.map(c => (
                  <Bar key={c.key} dataKey={c.key} name={c.label} stackId="cat" fill={c.color} maxBarSize={36} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Online vs In-Person" right={<span className="text-xs text-gray-400">order totals</span>}>
          {breakdown.channels.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No orders in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={breakdown.channels} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={xTickFmt} {...axisProps.x} />
                <YAxis tickFormatter={money} {...axisProps.y} />
                <Tooltip content={<ChartTooltip formatter={money} labelFormatter={xTickFmt} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {CHANNELS.map(c => (
                  <Bar key={c.key} dataKey={c.key} name={c.label} stackId="ch" fill={c.color} maxBarSize={36} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Cumulative Revenue" right={<span className="text-xs text-gray-400">running total</span>}>
          {cumulative.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No orders in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cumulative} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CATEGORICAL[0]} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CATEGORICAL[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={xTickFmt} {...axisProps.x} />
                <YAxis tickFormatter={money} {...axisProps.y} />
                <Tooltip content={<ChartTooltip formatter={money} labelFormatter={xTickFmt} />} />
                <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke={CATEGORICAL[0]} strokeWidth={2} fill="url(#cumFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {!singleDay && (
          <SectionCard title="Average Revenue by Day of Week" right={<span className="text-xs text-gray-400">per operating day</span>}>
            {breakdown.dow.length === 0 ? (
              <p className="text-sm text-gray-400 py-10 text-center">No orders in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={breakdown.dow} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="dow" {...axisProps.x} />
                  <YAxis tickFormatter={money} {...axisProps.y} />
                  <Tooltip content={<ChartTooltip formatter={money} />} cursor={{ fill: '#f3f4f6' }} />
                  <Bar dataKey="avgRevenue" name="Avg revenue" fill={CATEGORICAL[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="mt-2 text-[11px] text-gray-400">
              {breakdown.dow.map(d => `${d.dow} ×${d.days}`).join(' · ')} operating days in range
            </p>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
