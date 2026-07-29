import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import { CATEGORICAL } from '../lib/palette.js';
import KpiTile from '../components/KpiTile.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

// Fixed identity colors — palette slots, never reassigned by filters.
const FOOD_CATEGORIES = [
  { key: 'food',    label: 'Food',                 color: CATEGORICAL[1] },
  { key: 'alcohol', label: 'Alcohol',              color: CATEGORICAL[0] },
  { key: 'drinks',  label: 'Non-Alcoholic Drinks', color: CATEGORICAL[2] },
];
const BOOKING_COLOR = CATEGORICAL[0];

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

// Label + proportional bar + value, for small per-entity comparisons where
// a full chart would be overkill.
function BarRow({ label, value, max, right }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span className="w-20 shrink-0 text-gray-600">{label}</span>
      <div className="flex-1 h-4 bg-gray-100 rounded">
        <div className="h-4 rounded" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: BOOKING_COLOR, minWidth: value > 0 ? 4 : 0 }} />
      </div>
      <span className="w-28 text-right tabular-nums text-gray-900 font-medium shrink-0">{right}</span>
    </div>
  );
}

export default function Cabanas() {
  const { params, park } = useFilters();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  const singleDay = params.startDate === params.endDate;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Park filter deliberately not sent — the cabana program is BB-only.
    api.get('/analytics/cabanas', { params: { startDate: params.startDate, endDate: params.endDate } })
      .then(r => { if (!cancelled) setData(r.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.startDate, params.endDate]);

  if (park !== 'BB') {
    return (
      <div className="card p-10 text-center">
        <p className="text-3xl mb-2">⛱️</p>
        <p className="text-sm font-semibold text-gray-700">Cabana analytics is temporarily only available for Blue Bayou.</p>
        <p className="mt-1 text-xs text-gray-400">Switch the park filter to Blue Bayou to see the cabana report.</p>
      </div>
    );
  }

  if (!data) return loading ? <LoadingBlock /> : <div className="text-sm text-gray-400">Failed to load.</div>;

  const { bookings: b, food: f } = data;
  const maxCabana = Math.max(...b.byCabana.map(c => c.quantity), 1);
  const leadTotal = b.leadTime.buckets.reduce((s, x) => s + x.count, 0) || 1;
  const chTotal = b.channels.online.quantity + b.channels.inPerson.quantity || 1;

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Cabana Revenue" icon="⛱️" accent
          value={money(b.revenue)}
          sub={`${number(b.booked)} booked · avg ${money(b.avgRate)}/day`}
        />
        <KpiTile
          label="Occupancy" icon="📅" accent
          value={b.occupancy == null ? '—' : `${Math.round(b.occupancy * 100)}%`}
          sub={`of 8 cabanas × ${number(b.operatingDays)} day${b.operatingDays === 1 ? '' : 's'}`}
        />
        <KpiTile
          label="Cabana Food & Bev" icon="🍔"
          value={money(f.revenue)}
          sub={`${number(f.orders)} orders · avg ${moneyPrecise(f.avgOrder)}`}
        />
        <KpiTile
          label="Food per Cabana" icon="🧺"
          value={money(f.perCabana)}
          sub="F&B spend per booked cabana"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Bookings by Cabana" right={<span className="text-xs text-gray-400">{number(b.booked)} total</span>}>
          <div className="space-y-2">
            {b.byCabana.map(c => (
              <BarRow key={c.cabana} label={`Cabana ${c.cabana}`} value={c.quantity} max={maxCabana}
                      right={`${number(c.quantity)} · ${money(c.revenue)}`} />
            ))}
          </div>
          {b.coveredArea.quantity > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-sm">
              <span className="text-gray-500">Covered Area (groups pavilion)</span>
              <span className="font-medium text-gray-900 tabular-nums">
                {number(b.coveredArea.quantity)} · {money(b.coveredArea.revenue)}
              </span>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Booking Behavior">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Booked in advance</p>
          <div className="space-y-1.5">
            {b.leadTime.buckets.map(bk => (
              <div key={bk.label} className="flex items-center gap-2.5 text-sm">
                <span className="w-20 shrink-0 text-gray-600">{bk.label}</span>
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full">
                  <div className="h-2.5 rounded-full" style={{ width: `${(bk.count / leadTotal) * 100}%`, background: CATEGORICAL[2], minWidth: bk.count > 0 ? 4 : 0 }} />
                </div>
                <span className="w-10 text-right text-xs tabular-nums text-gray-500 shrink-0">{number(bk.count)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">Average lead time: {b.leadTime.avgDays.toFixed(1)} days before the visit</p>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sales channel</p>
            <ShareBar segments={[
              { value: b.channels.online.quantity,   color: CATEGORICAL[0] },
              { value: b.channels.inPerson.quantity, color: CATEGORICAL[1] },
            ]} />
            <div className="mt-2 space-y-1 text-xs text-gray-600">
              <div className="flex justify-between">
                <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: CATEGORICAL[0] }} />Online</span>
                <span className="tabular-nums font-medium">{number(b.channels.online.quantity)} · {money(b.channels.online.revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: CATEGORICAL[1] }} />In person</span>
                <span className="tabular-nums font-medium">{number(b.channels.inPerson.quantity)} · {money(b.channels.inPerson.revenue)}</span>
              </div>
              <p className="text-gray-400 pt-0.5">{Math.round((b.channels.online.quantity / chTotal) * 100)}% booked online</p>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard
          title={singleDay ? 'Cabana Food Orders by Hour' : 'Cabanas Booked by Day'}
          right={<span className="text-xs text-gray-400">{singleDay ? 'orders' : 'cabanas'}</span>}
        >
          {(singleDay ? f.trend : b.trend).length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">Nothing in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={singleDay ? f.trend : b.trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={singleDay ? undefined : shortDate}
                       tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tickFormatter={number} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<ChartTooltip
                  formatter={(v, name) => name === 'Revenue' ? money(v) : number(v)}
                  labelFormatter={singleDay ? undefined : shortDate} />} />
                <Bar dataKey={singleDay ? 'orders' : 'booked'} name={singleDay ? 'Food orders' : 'Cabanas booked'}
                     fill={BOOKING_COLOR} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {!singleDay && b.byDow.length > 1 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {b.byDow.map(d => (
                <span key={d.dow} className="tabular-nums">
                  {d.dow} <span className="font-semibold text-gray-800">{Math.round(d.occupancy * 100)}%</span>
                </span>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Cabana Food & Beverage" right={<span className="text-xs text-gray-400">{number(f.orders)} orders</span>}>
          <ShareBar segments={FOOD_CATEGORIES.map(c => ({ value: f.categories[c.key]?.revenue || 0, color: c.color }))} />
          <div className="mt-3 space-y-1.5">
            {FOOD_CATEGORIES.map(c => (
              <div key={c.key} className="flex items-center gap-2.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="text-gray-600">{c.label}</span>
                <span className="ml-auto text-xs text-gray-400 tabular-nums">{number(f.categories[c.key]?.quantity || 0)} sold</span>
                <span className="w-20 text-right font-semibold text-gray-900 tabular-nums">{money(f.categories[c.key]?.revenue || 0)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Ordering channel</p>
            <div className="space-y-1 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Covered Area engine (guest self-service)</span>
                <span className="tabular-nums font-medium">{number(f.channels.engine.orders)} orders · {money(f.channels.engine.revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span>Manual (rung by crew)</span>
                <span className="tabular-nums font-medium">{number(f.channels.manual.orders)} orders · {money(f.channels.manual.revenue)}</span>
              </div>
            </div>
          </div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-1.5">Top items</p>
          <div className="space-y-1 text-xs text-gray-600">
            {f.topItems.map(p => (
              <div key={p.name} className="flex justify-between gap-3">
                <span className="truncate">{p.name.replace(' (CS-BB)', '')}</span>
                <span className="tabular-nums font-medium shrink-0">{number(p.quantity)} · {money(p.revenue)}</span>
              </div>
            ))}
            {f.topItems.length === 0 && <p className="text-gray-400">No cabana food orders in this range.</p>}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
