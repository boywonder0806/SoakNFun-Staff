import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import { CATEGORICAL } from '../lib/palette.js';
import KpiTile from '../components/KpiTile.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

const REFUND_COLOR = CATEGORICAL[7]; // fixed red slot — refunds are money going out

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

function StatusChip({ status, isFull }) {
  const label = status === 'Active' ? (isFull ? 'Full refund' : 'Partial refund') : status;
  const cls = status === 'Active'
    ? (isFull ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')
    : 'bg-gray-100 text-gray-500';
  return <span className={`px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${cls}`}>{label}</span>;
}

export default function Refunds() {
  const { params } = useFilters();
  const [data, setData]       = useState(null);
  const [prevKpis, setPrev]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy]   = useState('date'); // date | amount
  const [search, setSearch]   = useState('');

  const singleDay = params.startDate === params.endDate;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const prev = previousRange(params.startDate, params.endDate);
    Promise.all([
      api.get('/analytics/refunds', { params }),
      api.get('/analytics/refunds', { params: { ...params, startDate: prev.startDate, endDate: prev.endDate } }),
    ])
      .then(([cur, prv]) => {
        if (cancelled) return;
        setData({ ...cur.data, prevDays: prev.days });
        setPrev(prv.data.kpis);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.startDate, params.endDate, params.park]);

  const detail = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const rows = q
      ? data.detail.filter(r =>
          r.orderId.includes(q) ||
          (r.customer || '').toLowerCase().includes(q) ||
          (r.salesperson || '').toLowerCase().includes(q))
      : data.detail;
    return [...rows].sort((a, b) => sortBy === 'amount'
      ? b.refunded - a.refunded
      : b.date.localeCompare(a.date) || b.refunded - a.refunded);
  }, [data, sortBy, search]);

  if (!data) return loading ? <LoadingBlock h="h-96" /> : <div className="text-sm text-gray-400">Failed to load.</div>;

  const { kpis, trend, granularity, byPerson, byOffice, byMethod } = data;
  const compareLabel = singleDay ? 'vs yesterday' : `vs previous ${data.prevDays} days`;
  const refundRate = kpis.grossCollected ? kpis.refunded / kpis.grossCollected : 0;
  const orderRate = kpis.totalOrders ? kpis.refundOrders / kpis.totalOrders : 0;
  const maxPerson = Math.max(...byPerson.map(p => p.refunded), 1);
  const methodTotal = byMethod.reduce((s, m) => s + m.refunded, 0) || 1;

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Total Refunded" icon="↩️" accent
          value={money(kpis.refunded)}
          delta={delta(kpis.refunded, prevKpis?.refunded)} deltaInvert
          sub={compareLabel}
        />
        <KpiTile
          label="Refunded Orders" icon="🧾" accent
          value={number(kpis.refundOrders)}
          sub={`${(orderRate * 100).toFixed(2)}% of ${number(kpis.totalOrders)} orders`}
        />
        <KpiTile
          label="Avg Refund" icon="⚖️"
          value={moneyPrecise(kpis.avgRefund)}
          sub={`${number(kpis.fullRefunds)} full · ${number(kpis.refundOrders - kpis.fullRefunds)} partial`}
        />
        <KpiTile
          label="Refund Rate" icon="📉"
          value={`${(refundRate * 100).toFixed(2)}%`}
          sub={`of ${money(kpis.grossCollected)} collected · ${number(kpis.voids)} voids, ${number(kpis.cancellations)} cancelled`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard
          title={granularity === 'hour' ? 'Refunds by Hour' : 'Refunds by Day'}
          right={<span className="text-xs text-gray-400">amount refunded</span>}
        >
          {trend.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No refunds in this range. 🎉</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={granularity === 'hour' ? undefined : shortDate}
                       tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={64} />
                <Tooltip content={<ChartTooltip
                  formatter={(v, name) => name === 'Orders' ? number(v) : money(v)}
                  labelFormatter={granularity === 'hour' ? undefined : shortDate} />} />
                <Bar dataKey="refunded" name="Refunded" fill={REFUND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Refunds by Team Member" right={<span className="text-xs text-gray-400">salesperson on the order</span>}>
          <div className="space-y-2">
            {byPerson.map(p => (
              <div key={p.person} className="flex items-center gap-2.5 text-sm">
                <span className="w-44 shrink-0 text-gray-600 truncate">{p.person}</span>
                <div className="flex-1 h-4 bg-gray-100 rounded">
                  <div className="h-4 rounded" style={{ width: `${(p.refunded / maxPerson) * 100}%`, background: REFUND_COLOR, minWidth: 4 }} />
                </div>
                <span className="w-8 text-right text-xs text-gray-400 tabular-nums shrink-0">{number(p.orders)}</span>
                <span className="w-20 text-right tabular-nums font-medium text-gray-900 shrink-0">{money(p.refunded)}</span>
              </div>
            ))}
            {byPerson.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No refunds in this range.</p>}
          </div>
          <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
            Web-engine names (Public Sales, Web Engine) are online self-service orders that were
            later refunded — RocketRez doesn't record which user processed those.
          </p>
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Refunds by Sales Office">
          <div className="space-y-1.5 text-sm">
            {byOffice.map(o => (
              <div key={o.office} className="flex items-center gap-2.5">
                <span className="text-gray-600">{o.office}</span>
                <span className="text-[11px] text-gray-400">{number(o.orders)} order{o.orders === 1 ? '' : 's'}</span>
                <span className="ml-auto tabular-nums font-medium text-gray-900">{money(o.refunded)}</span>
              </div>
            ))}
            {byOffice.length === 0 && <p className="text-gray-400 py-6 text-center">No refunds in this range.</p>}
          </div>
        </SectionCard>

        <SectionCard title="Refunds by Tender">
          <div className="space-y-1.5 text-sm">
            {byMethod.map(m => (
              <div key={m.method} className="flex items-center gap-2.5">
                <span className="text-gray-600">{m.method}</span>
                <span className="text-[11px] text-gray-400">{number(m.payments)} payment{m.payments === 1 ? '' : 's'}</span>
                <span className="ml-auto text-xs text-gray-400 tabular-nums">{Math.round((m.refunded / methodTotal) * 100)}%</span>
                <span className="w-20 text-right tabular-nums font-medium text-gray-900">{money(m.refunded)}</span>
              </div>
            ))}
            {byMethod.length === 0 && <p className="text-gray-400 py-6 text-center">No refunds in this range.</p>}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Refund Detail"
        right={
          <div className="flex items-center gap-2">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search order #, customer, crew…"
              className="px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-700 w-52"
            />
            <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1">
              {[{ v: 'date', l: 'Latest' }, { v: 'amount', l: 'Largest' }].map(s => (
                <button key={s.v} onClick={() => setSortBy(s.v)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    sortBy === s.v ? 'bg-az text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  {s.l}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wide">
                <th className="text-left font-semibold px-1 pb-2">Order #</th>
                <th className="text-left font-semibold px-1 pb-2">Date</th>
                <th className="text-left font-semibold px-1 pb-2">Type</th>
                <th className="text-left font-semibold px-1 pb-2">Customer</th>
                <th className="text-left font-semibold px-1 pb-2">Salesperson</th>
                <th className="text-left font-semibold px-1 pb-2">Tender</th>
                <th className="text-right font-semibold px-1 pb-2">Charged</th>
                <th className="text-right font-semibold px-1 pb-2">Refunded</th>
              </tr>
            </thead>
            <tbody>
              {detail.map(r => (
                <tr key={r.orderId} className="border-t border-gray-50">
                  <td className="px-1 py-1.5 tabular-nums font-medium text-gray-900">#{r.orderId}</td>
                  <td className="px-1 py-1.5 text-gray-500 whitespace-nowrap">{shortDate(r.date)}</td>
                  <td className="px-1 py-1.5"><StatusChip status={r.status} isFull={r.isFull} /></td>
                  <td className="px-1 py-1.5 text-gray-600 truncate max-w-40">{r.customer || '—'}</td>
                  <td className="px-1 py-1.5 text-gray-600 truncate max-w-44">{r.salesperson || '—'}</td>
                  <td className="px-1 py-1.5 text-gray-400 text-xs whitespace-nowrap">{r.methods}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-gray-400">{moneyPrecise(r.charged)}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums font-semibold text-red-600">−{moneyPrecise(r.refunded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.length === 0 && (
            <p className="text-sm text-gray-400 py-8 text-center">
              {search ? 'No refunds match your search.' : 'No refunds in this range. 🎉'}
            </p>
          )}
        </div>
        {data.detail.length >= 200 && (
          <p className="mt-2 text-[11px] text-gray-400">Showing the most recent 200 refunded orders — narrow the date range to see everything.</p>
        )}
      </SectionCard>
    </div>
  );
}
