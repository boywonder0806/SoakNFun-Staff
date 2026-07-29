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
const CATEGORIES = [
  { key: 'alcoholic', label: 'Alcoholic',        color: CATEGORICAL[0] },
  { key: 'frozen',    label: 'Frozen',           color: CATEGORICAL[2] },
  { key: 'bottled',   label: 'Bottled & Water',  color: CATEGORICAL[3] },
  { key: 'other',     label: 'Other',            color: '#9ca3af' },
];

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
  const { params, park } = useFilters();
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

  if (park !== 'BB') {
    return (
      <div className="card p-10 text-center">
        <p className="text-3xl mb-2">🥤</p>
        <p className="text-sm font-semibold text-gray-700">Drink analytics is temporarily only available for Blue Bayou.</p>
        <p className="mt-1 text-xs text-gray-400">Switch the park filter to Blue Bayou to see the drink report.</p>
      </div>
    );
  }

  if (!data) return loading ? <LoadingBlock /> : <div className="text-sm text-gray-400">Failed to load.</div>;

  const { categories, totals, byProduct, trend, granularity, attendance } = data;
  const per100 = attendance ? (totals.quantity / attendance) * 100 : 0;
  const avgPrice = totals.quantity ? totals.revenue / totals.quantity : 0;

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Drink Revenue" icon="🍹" accent
          value={money(totals.revenue)}
          sub="purchased drinks only"
        />
        <KpiTile
          label="Drinks Sold" icon="🥤" accent
          value={number(totals.quantity)}
          sub={`avg ${moneyPrecise(avgPrice)} per drink`}
        />
        <KpiTile
          label="Drinks per 100 Guests" icon="🎯"
          value={per100.toFixed(1)}
          sub={`${number(attendance)} guests in range`}
        />
        <KpiTile
          label="Alcohol Share" icon="🍺"
          value={`${totals.revenue ? Math.round(((categories.alcoholic?.revenue || 0) / totals.revenue) * 100) : 0}%`}
          sub={`${money(categories.alcoholic?.revenue || 0)} of drink revenue`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Revenue by Category">
          <ShareBar segments={CATEGORIES.map(c => ({ value: categories[c.key]?.revenue || 0, color: c.color }))} />
          <div className="mt-4 space-y-2.5">
            {CATEGORIES.map(c => {
              const cat = categories[c.key] || { quantity: 0, revenue: 0 };
              return (
                <div key={c.key} className="flex items-center gap-2.5 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-gray-600">{c.label}</span>
                  <span className="ml-auto text-xs text-gray-400 tabular-nums">{number(cat.quantity)} sold</span>
                  <span className="w-20 text-right font-semibold text-gray-900 tabular-nums">{money(cat.revenue)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
            Purchased guest drinks only — crew drinks, register comps, souvenir cups, and floats
            are excluded, and free soda stations aren't rung up anywhere so they can't be counted.
            Daiquiris count as alcoholic, not frozen.
          </p>
        </SectionCard>

        <SectionCard
          title={granularity === 'hour' ? 'Drinks Sold by Hour' : 'Drinks Sold by Day'}
          right={<span className="text-xs text-gray-400">drinks</span>}
        >
          {trend.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No drink sales in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={granularity === 'hour' ? undefined : shortDate}
                       tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tickFormatter={number} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={48} />
                <Tooltip content={<ChartTooltip
                  formatter={(v, name) => name === 'Revenue' ? money(v) : number(v)}
                  labelFormatter={granularity === 'hour' ? undefined : shortDate} />} />
                <Bar dataKey="quantity" name="Drinks sold" fill={CATEGORICAL[0]} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Products" right={<span className="text-xs text-gray-400">{byProduct.length} drink products</span>}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wide">
                <th className="text-left font-semibold px-1 pb-2">Product</th>
                <th className="text-left font-semibold px-1 pb-2">Category</th>
                <th className="text-right font-semibold px-1 pb-2">Sold</th>
                <th className="text-right font-semibold px-1 pb-2">Avg Price</th>
                <th className="text-right font-semibold px-1 pb-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map(p => {
                const cat = CATEGORIES.find(c => c.key === p.category);
                return (
                  <tr key={p.name} className="border-t border-gray-50">
                    <td className="px-1 py-1.5 text-gray-700">{p.name}</td>
                    <td className="px-1 py-1.5">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: cat?.color }} />
                      <span className="text-xs text-gray-500">{cat?.label}</span>
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-gray-600">{number(p.quantity)}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-gray-400">
                      {p.quantity ? moneyPrecise(p.revenue / p.quantity) : '—'}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums font-medium text-gray-900">{money(p.revenue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
