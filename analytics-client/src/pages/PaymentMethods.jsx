import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import { CATEGORICAL } from '../lib/palette.js';
import KpiTile from '../components/KpiTile.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

// Fixed identity colors — a tender group keeps its color everywhere on this
// page (share bar, stacked trend, tables), independent of rank or filters.
const GROUPS = [
  { key: 'card',   label: 'Card',           color: CATEGORICAL[0] },
  { key: 'cash',   label: 'Cash',           color: CATEGORICAL[2] },
  { key: 'wallet', label: 'Digital Wallet', color: CATEGORICAL[1] },
  { key: 'paypal', label: 'PayPal',         color: CATEGORICAL[5] },
  { key: 'other',  label: 'Other',          color: '#9ca3af' },
];
const BRAND_COLORS = [CATEGORICAL[0], CATEGORICAL[1], CATEGORICAL[2], CATEGORICAL[3]];

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
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 gap-px">
      {segments.filter(s => s.value > 0).map((s, i) => (
        <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

export default function PaymentMethods() {
  const { params } = useFilters();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/analytics/payment-methods', { params })
      .then(r => { if (!cancelled) setData(r.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.startDate, params.endDate, params.park]);

  if (!data) return loading ? <LoadingBlock h="h-96" /> : <div className="text-sm text-gray-400">Failed to load.</div>;

  const { kpis, groups, brands, methods, trend, granularity } = data;
  const byGroup = Object.fromEntries(groups.map(g => [g.group, g]));
  const electronic = ['card', 'wallet', 'paypal'].reduce((s, k) => s + (byGroup[k]?.amount || 0), 0);
  const electronicShare = kpis.total ? electronic / kpis.total : 0;
  const brandTotal = brands.reduce((s, b) => s + b.amount, 0) || 1;
  const maxAvg = Math.max(...groups.map(g => g.avgTransaction), 1);

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Total Collected" icon="💳" accent
          value={money(kpis.total)}
          sub={`${number(kpis.transactions)} transactions`}
        />
        <KpiTile
          label="Avg Transaction" icon="🧾" accent
          value={moneyPrecise(kpis.avgTransaction)}
          sub="per positive payment"
        />
        <KpiTile
          label="Electronic Share" icon="⚡"
          value={`${Math.round(electronicShare * 100)}%`}
          sub={`cards, wallets & PayPal · cash ${money(byGroup.cash?.amount || 0)}`}
        />
        <KpiTile
          label="Refunds" icon="↩️"
          value={money(kpis.refunded)}
          sub={`${number(kpis.refundCount)} refund payment${kpis.refundCount === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Tender Mix">
          <ShareBar segments={GROUPS.map(g => ({ value: byGroup[g.key]?.amount || 0, color: g.color }))} />
          <div className="mt-4 space-y-2.5">
            {GROUPS.map(g => {
              const row = byGroup[g.key] || { amount: 0, transactions: 0 };
              return (
                <div key={g.key} className="flex items-center gap-2.5 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                  <span className="text-gray-600">{g.label}</span>
                  <span className="text-[11px] text-gray-400">{number(row.transactions)} txns</span>
                  <span className="ml-auto text-xs text-gray-400 tabular-nums">
                    {kpis.total ? Math.round((row.amount / kpis.total) * 100) : 0}%
                  </span>
                  <span className="w-24 text-right font-semibold text-gray-900 tabular-nums">{money(row.amount)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
            Other covers payroll deductions, Nayax lockers, prepaid passes, checks and tokens —
            itemized in the table below.
          </p>
        </SectionCard>

        <SectionCard
          title={granularity === 'hour' ? 'Tender by Hour' : 'Tender by Day'}
          right={<span className="text-xs text-gray-400">collected</span>}
        >
          {trend.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No payments in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={granularity === 'hour' ? undefined : shortDate}
                       tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={64} />
                <Tooltip content={<ChartTooltip formatter={money} labelFormatter={granularity === 'hour' ? undefined : shortDate} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {GROUPS.map(g => (
                  <Bar key={g.key} dataKey={g.key} name={g.label} stackId="tender"
                       fill={g.color} maxBarSize={36} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="Card Brand Mix" right={<span className="text-xs text-gray-400">incl. wallet-carried cards</span>}>
          {brands.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No card payments in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, brands.length * 44)}>
              <BarChart data={brands} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tickFormatter={money} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="brand" width={130} tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip formatter={money} />} cursor={{ fill: '#f3f4f6' }} />
                <Bar dataKey="amount" name="Amount" radius={[0, 4, 4, 0]} maxBarSize={22}>
                  {brands.map((_, i) => <Cell key={i} fill={BRAND_COLORS[i % BRAND_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="mt-1 space-y-1 text-xs text-gray-500">
            {brands.map(b => (
              <div key={b.brand} className="flex justify-between">
                <span>{b.brand}</span>
                <span className="tabular-nums">{number(b.transactions)} txns · {Math.round((b.amount / brandTotal) * 100)}% of card volume</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Average Transaction by Tender">
          <div className="space-y-2.5">
            {GROUPS.filter(g => byGroup[g.key]?.transactions).map(g => {
              const row = byGroup[g.key];
              return (
                <div key={g.key} className="flex items-center gap-2.5 text-sm">
                  <span className="w-24 shrink-0 text-gray-600">{g.label}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded">
                    <div className="h-4 rounded" style={{ width: `${(row.avgTransaction / maxAvg) * 100}%`, background: g.color, minWidth: 4 }} />
                  </div>
                  <span className="w-20 text-right tabular-nums font-medium text-gray-900 shrink-0">{moneyPrecise(row.avgTransaction)}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Refunds by tender</p>
            <div className="space-y-1 text-xs text-gray-600">
              {groups.filter(g => g.refunded > 0).map(g => {
                const meta = GROUPS.find(x => x.key === g.group);
                return (
                  <div key={g.group} className="flex justify-between">
                    <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: meta?.color }} />{meta?.label || g.group}</span>
                    <span className="tabular-nums font-medium">{number(g.refundCount)} · {money(g.refunded)}</span>
                  </div>
                );
              })}
              {groups.every(g => !g.refunded) && <p className="text-gray-400">No refunds in this range.</p>}
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="All Payment Methods" right={<span className="text-xs text-gray-400">{methods.length} methods</span>}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wide">
                <th className="text-left font-semibold px-1 pb-2">Method</th>
                <th className="text-right font-semibold px-1 pb-2">Transactions</th>
                <th className="text-right font-semibold px-1 pb-2">Avg</th>
                <th className="text-right font-semibold px-1 pb-2">Refunded</th>
                <th className="text-right font-semibold px-1 pb-2">Net Amount</th>
              </tr>
            </thead>
            <tbody>
              {methods.map(m => (
                <tr key={m.method} className="border-t border-gray-50">
                  <td className="px-1 py-1.5 text-gray-700">{m.method}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-gray-600">{number(m.transactions)}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-gray-400">{moneyPrecise(m.avgTransaction)}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-gray-400">{m.refunded > 0 ? money(m.refunded) : '—'}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums font-medium text-gray-900">{money(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
