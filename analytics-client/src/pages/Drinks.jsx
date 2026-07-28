import { useEffect, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import { CATEGORICAL } from '../lib/palette.js';
import KpiTile from '../components/KpiTile.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

// Fixed identity colors — palette slots, never reassigned by filters.
const CATEGORIES = [
  { key: 'alcoholic', label: 'Alcoholic',        color: CATEGORICAL[0] },
  { key: 'frozen',    label: 'Frozen',           color: CATEGORICAL[2] },
  { key: 'bottled',   label: 'Bottled & Water',  color: CATEGORICAL[3] },
  { key: 'fountain',  label: 'Souvenir Cups',    color: CATEGORICAL[4] },
  { key: 'other',     label: 'Other',            color: '#9ca3af' },
];
const PAID_COLOR = CATEGORICAL[0];
const FREE_COLOR = CATEGORICAL[1];

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

export default function Drinks() {
  const { params } = useFilters();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Park filter deliberately not sent — the drink program is BB-only.
    api.get('/analytics/drinks', { params: { startDate: params.startDate, endDate: params.endDate } })
      .then(r => { if (!cancelled) setData(r.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.startDate, params.endDate]);

  if (!data) return loading ? <LoadingBlock /> : <div className="text-sm text-gray-400">Failed to load.</div>;

  const { categories, channels, freeSubsidy, byProduct, trend, granularity, freeByCustomer, attendance } = data;
  const freeQty = channels.crew.quantity + channels.comp.quantity;
  const per100 = attendance ? (channels.paid.quantity / attendance) * 100 : 0;

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="px-2 py-0.5 rounded-full bg-az/10 text-az-dark font-semibold">Blue Bayou only</span>
        <span>Drink sales across all BB outlets — the park filter doesn't apply here.</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Drink Revenue" icon="🍹" accent
          value={money(channels.paid.revenue)}
          sub={`${number(channels.paid.quantity)} drinks sold`}
        />
        <KpiTile
          label="Drinks per 100 Guests" icon="🥤" accent
          value={per100.toFixed(1)}
          sub={`${number(attendance)} guests in range`}
        />
        <KpiTile
          label="Free & Crew Drinks" icon="🎁"
          value={number(freeQty)}
          sub={`${number(channels.crew.quantity)} crew · ${number(channels.comp.quantity)} comped`}
        />
        <KpiTile
          label="Giveaway Value" icon="🏷️"
          value={money(freeSubsidy)}
          sub={`retail value given away · crew paid ${money(channels.crew.revenue)}`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Revenue by Category">
          <ShareBar segments={CATEGORIES.map(c => ({ value: categories[c.key]?.revenue || 0, color: c.color }))} />
          <div className="mt-4 space-y-2.5">
            {CATEGORIES.map(c => {
              const cat = categories[c.key] || { quantity: 0, revenue: 0, freeQty: 0 };
              return (
                <div key={c.key} className="flex items-center gap-2.5 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-gray-600">{c.label}</span>
                  {cat.freeQty > 0 && (
                    <span className="text-[11px] text-gray-400">+{number(cat.freeQty)} free</span>
                  )}
                  <span className="ml-auto text-xs text-gray-400 tabular-nums">{number(cat.quantity)} sold</span>
                  <span className="w-20 text-right font-semibold text-gray-900 tabular-nums">{money(cat.revenue)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
            Souvenir cups are the refillable-cup program (cup sales — refills aren't rung up).
            Daiquiris count as alcoholic, not frozen.
          </p>
        </SectionCard>

        <SectionCard
          title={granularity === 'hour' ? 'Paid vs Free by Hour' : 'Paid vs Free by Day'}
          right={<span className="text-xs text-gray-400">drinks</span>}
        >
          {trend.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No drink sales in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={granularity === 'hour' ? undefined : shortDate}
                       tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tickFormatter={number} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={48} />
                <Tooltip content={<ChartTooltip
                  formatter={(v, name) => name === 'Paid revenue' ? money(v) : number(v)}
                  labelFormatter={granularity === 'hour' ? undefined : shortDate} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="paidQty" name="Paid drinks" fill={PAID_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="freeQty" name="Free & crew" fill={FREE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Products" right={<span className="text-xs text-gray-400">{byProduct.length} drink products</span>}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 uppercase tracking-wide">
                  <th className="text-left font-semibold px-1 pb-2">Product</th>
                  <th className="text-right font-semibold px-1 pb-2">Sold</th>
                  <th className="text-right font-semibold px-1 pb-2">Revenue</th>
                  <th className="text-right font-semibold px-1 pb-2">Free/Crew</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.map(p => {
                  const cat = CATEGORIES.find(c => c.key === p.category);
                  return (
                    <tr key={p.name} className="border-t border-gray-50">
                      <td className="px-1 py-1.5">
                        <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: cat?.color }} />
                        <span className="text-gray-700">{p.name}</span>
                      </td>
                      <td className="px-1 py-1.5 text-right tabular-nums text-gray-600">{number(p.paidQty)}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums font-medium text-gray-900">{money(p.paidRevenue)}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums text-gray-400">
                        {p.crewQty + p.compQty > 0 ? number(p.crewQty + p.compQty) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="Free & Crew Drinks by Person"
          right={<span className="text-xs text-gray-400">{money(freeSubsidy)} given away</span>}
        >
          {freeByCustomer.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No free or crew drinks in this range.</p>
          ) : (
            <div className="space-y-1.5">
              {freeByCustomer.map(c => (
                <div key={c.customer} className="flex items-center gap-2.5 text-sm">
                  <span className="text-gray-600 truncate">{c.customer}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{c.orders} order{c.orders === 1 ? '' : 's'}</span>
                  <span className="ml-auto font-semibold text-gray-900 tabular-nums shrink-0">{number(c.quantity)}</span>
                  <span className="w-20 text-right text-xs text-gray-400 tabular-nums shrink-0 whitespace-nowrap">
                    {c.collected > 0 ? `${moneyPrecise(c.collected)} paid` : 'free'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
            Crew drinks come through BB Crew Kitchen under the crew member's name; "Unattributed"
            means the register order had no customer attached.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
