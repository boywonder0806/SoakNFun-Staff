import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import { CATEGORICAL } from '../lib/palette.js';
import KpiTile, { DeltaChip } from '../components/KpiTile.jsx';
import WeatherCard from '../components/WeatherCard.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { Spinner } from '../components/LoadingOverlay.jsx';

// Survives route changes so returning to Overview paints the last report
// instantly (with the overlay on top while it refreshes) instead of a
// blank first-load screen every visit.
let lastReport = null; // { key, payload }

// Fixed identity colors for attendance buckets — labels carry the identity,
// color is reinforcement (palette slots, never reassigned by filters).
const BUCKETS = [
  { key: 'paid',        label: 'Paid Admission',     color: CATEGORICAL[0] },
  { key: 'passholders', label: 'Season Passholders', color: CATEGORICAL[2] },
  { key: 'groups',      label: 'Group Bookings',     color: CATEGORICAL[5] },
  { key: 'employees',   label: 'Employee Passes',    color: CATEGORICAL[3] },
  { key: 'comps',       label: 'Comps & Promos',     color: CATEGORICAL[4] },
  { key: 'other',       label: 'Other',              color: '#9ca3af' },
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

// White cards with visibly pulsing bars — the old flat gray blocks
// disappeared into the gray page background and read as a blank screen.
function Skeleton({ h = 'h-24', bars = 2 }) {
  return (
    <div className={`card ${h} p-5 space-y-3 overflow-hidden`}>
      <div className="h-3 w-24 bg-gray-200 rounded animate-pulse" />
      {bars > 1 && <div className="h-7 w-36 bg-gray-200 rounded animate-pulse" />}
      {bars > 2 && <div className="h-3 w-full max-w-md bg-gray-100 rounded animate-pulse" />}
    </div>
  );
}

function SectionCard({ title, right, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

function ShareBar({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 gap-px">
      {segments.filter(s => s.value > 0).map((s, i) => (
        <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

export default function Overview() {
  const { params } = useFilters();
  const filterKey = `${params.startDate}:${params.endDate}:${params.park || 'ALL'}`;
  // Seed from the cached report even if filters changed — dimmed stale
  // numbers under the overlay beat a blank screen, and it's the same
  // behavior as switching filters while on the page.
  // { daily, overview, prevDaily, prevOverview, trend, granularity }
  const [data, setData]       = useState(() => lastReport?.payload || null);
  const [loading, setLoading] = useState(true);

  const singleDay = params.startDate === params.endDate;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const prev = previousRange(params.startDate, params.endDate);
    const prevParams = { ...params, startDate: prev.startDate, endDate: prev.endDate };
    const granularity = singleDay ? 'hour' : 'day';

    Promise.all([
      api.get('/analytics/daily',    { params }),
      api.get('/analytics/overview', { params }),
      api.get('/analytics/daily',    { params: prevParams }),
      api.get('/analytics/overview', { params: prevParams }),
      api.get('/analytics/revenue-trend', { params: { ...params, granularity } }),
    ])
      .then(([d, o, pd, po, t]) => {
        if (cancelled) return;
        const payload = { daily: d.data, overview: o.data, prevDaily: pd.data, prevOverview: po.data,
                          trend: t.data.rows, granularity, prevDays: prev.days };
        lastReport = { key: filterKey, payload };
        setData(payload);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.startDate, params.endDate, params.park]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex justify-center py-3">
          <div className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-full px-4 py-2 shadow-sm text-sm text-gray-600">
            <Spinner />
            Reviewing the data…
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton /><Skeleton /><Skeleton /><Skeleton />
        </div>
        <Skeleton h="h-72" bars={3} />
        <div className="grid lg:grid-cols-2 gap-4">
          <Skeleton h="h-48" bars={3} />
          <Skeleton h="h-48" bars={3} />
        </div>
      </div>
    );
  }
  if (!data) return <div className="text-sm text-gray-400">Failed to load.</div>;

  const { daily, overview, prevDaily, prevOverview, trend, granularity } = data;
  const att = daily.attendance;
  const compareLabel = singleDay ? 'vs yesterday' : `vs previous ${data.prevDays} days`;
  const ch = daily.admissions.channels;
  const chTotal = ch.online.quantity + ch.gate.quantity || 1;

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />
      <WeatherCard />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Attendance" icon="🎟️" accent
          value={number(att.total)}
          delta={delta(att.total, prevDaily.attendance.total)}
          sub={att.byPark?.length > 1
            ? att.byPark.map(p => `${p.park} ${number(p.quantity)}`).join(' · ')
            : compareLabel}
        />
        <KpiTile
          label="Per Cap (In-Park)" icon="💰" accent
          value={moneyPrecise(daily.inPark.perCap)}
          delta={delta(daily.inPark.perCap, prevDaily.inPark.perCap)}
          sub="in-park spend per guest"
        />
        <KpiTile
          label="Total Revenue" icon="📈"
          value={money(overview.revenue)}
          delta={delta(overview.revenue, prevOverview.revenue)}
          sub={compareLabel}
        />
        <KpiTile
          label="Admissions Revenue" icon="🏷️"
          value={money(daily.admissions.revenue)}
          delta={delta(daily.admissions.revenue, prevDaily.admissions.revenue)}
          sub={`GA ticket value · ${compareLabel}`}
        />
      </div>

      <SectionCard
        title={granularity === 'hour' ? 'Revenue by Hour' : 'Revenue Trend'}
        right={<span className="text-xs text-gray-400">{number(overview.orderCount)} orders</span>}
      >
        {trend.length === 0 ? (
          <p className="text-sm text-gray-400 py-10 text-center">No orders yet in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CATEGORICAL[0]} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={CATEGORICAL[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={granularity === 'hour' ? undefined : shortDate}
                     tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
              <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={64} />
              <Tooltip content={<ChartTooltip formatter={money} labelFormatter={granularity === 'hour' ? undefined : shortDate} />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={CATEGORICAL[0]} strokeWidth={2} fill="url(#revFill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard
          title="Attendance & Ticketing"
          right={<DeltaChip delta={delta(att.total, prevDaily.attendance.total)} />}
        >
          <ShareBar segments={BUCKETS.map(b => ({ value: att[b.key], color: b.color }))} />
          <div className="mt-4 space-y-2.5">
            {BUCKETS.filter(b => att[b.key] > 0 || b.key === 'paid' || b.key === 'passholders').map(b => (
              <div key={b.key} className="flex items-center gap-2.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                <span className="text-gray-600">{b.label}</span>
                <span className="ml-auto font-semibold text-gray-900 tabular-nums">{number(att[b.key])}</span>
                <span className="w-12 text-right text-xs text-gray-400 tabular-nums">
                  {att.total ? Math.round((att[b.key] / att.total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
            Counted by visit date from booked tickets, matching the RocketRez attendance report.
            Guests booked for today who haven't scanned in yet are included.
          </p>

          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sales Channel (GA)</p>
              <ShareBar segments={[
                { value: ch.online.quantity, color: CATEGORICAL[0] },
                { value: ch.gate.quantity,   color: CATEGORICAL[1] },
              ]} />
              <div className="mt-2 space-y-1 text-xs text-gray-600">
                <div className="flex justify-between">
                  <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: CATEGORICAL[0] }} />Online</span>
                  <span className="tabular-nums font-medium">{number(ch.online.quantity)} · {money(ch.online.revenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: CATEGORICAL[1] }} />Walk-up</span>
                  <span className="tabular-nums font-medium">{number(ch.gate.quantity)} · {money(ch.gate.revenue)}</span>
                </div>
                <p className="text-gray-400 pt-0.5">{Math.round((ch.online.quantity / chTotal) * 100)}% bought in advance</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">GA by Rate Type</p>
              <div className="space-y-1 text-xs text-gray-600">
                {daily.admissions.byRateType.map(r => (
                  <div key={r.rateType} className="flex justify-between">
                    <span>{r.rateType}</span>
                    <span className="tabular-nums font-medium">{number(r.quantity)} · {money(r.revenue)}</span>
                  </div>
                ))}
                {daily.admissions.byRateType.length === 0 && <p className="text-gray-400">No GA sales yet.</p>}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                {Math.round(att.passholderShare * 100)}% of attendance are passholders
              </p>
            </div>
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title="In-Park Revenue"
            right={<span className="text-xs text-gray-400">per cap {moneyPrecise(daily.inPark.perCap)}</span>}
          >
            <ShareBar segments={[
              { value: daily.inPark.fnb,     color: CATEGORICAL[0] },
              { value: daily.inPark.rentals, color: CATEGORICAL[2] },
              { value: daily.inPark.merch,   color: CATEGORICAL[4] },
            ]} />
            <div className="mt-4 space-y-2.5 text-sm">
              {[
                { label: 'Food & Beverage', value: daily.inPark.fnb,     prev: prevDaily.inPark.fnb,     color: CATEGORICAL[0] },
                { label: 'Rentals (lockers & cabanas)', value: daily.inPark.rentals, prev: prevDaily.inPark.rentals, color: CATEGORICAL[2] },
                { label: 'Merchandise', value: daily.inPark.merch,        prev: prevDaily.inPark.merch,   color: CATEGORICAL[4] },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                  <span className="text-gray-600">{r.label}</span>
                  <span className="ml-auto font-semibold text-gray-900 tabular-nums">{money(r.value)}</span>
                  <span className="w-14 text-right text-xs text-gray-400 tabular-nums">
                    {att.total ? moneyPrecise(r.value / att.total) : '—'}/guest
                  </span>
                  <DeltaChip delta={delta(r.value, r.prev)} />
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-sm">
              <span className="text-gray-500">Total in-park</span>
              <span className="font-bold text-gray-900 tabular-nums">{money(daily.inPark.total)}</span>
            </div>
          </SectionCard>

          <SectionCard
            title="Season Pass Sales"
            right={<DeltaChip delta={delta(daily.passSales.revenue, prevDaily.passSales.revenue)} />}
          >
            <div className="flex items-baseline gap-3">
              <p className="text-2xl font-bold text-gray-900 tabular-nums">{number(daily.passSales.quantity)}</p>
              <p className="text-sm text-gray-500">passes sold · {money(daily.passSales.revenue)}</p>
            </div>
            <div className="mt-3 space-y-1 text-xs text-gray-600">
              {daily.passSales.byProduct.slice(0, 5).map(p => (
                <div key={p.name} className="flex justify-between">
                  <span className="truncate pr-3">{p.name}</span>
                  <span className="tabular-nums font-medium shrink-0">{number(p.quantity)} · {money(p.revenue)}</span>
                </div>
              ))}
              {daily.passSales.byProduct.length === 0 && <p className="text-gray-400">No pass sales in this range.</p>}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
