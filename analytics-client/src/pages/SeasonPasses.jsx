import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../lib/api.js';
import { useFilters } from '../context/FiltersContext.jsx';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import { CATEGORICAL, PARK_COLOR } from '../lib/palette.js';
import KpiTile from '../components/KpiTile.jsx';
import ChartTooltip from '../components/ChartTooltip.jsx';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

// Fixed identity colors — palette slots, never reassigned by filters.
// Pass families reuse the park identity colors where they map to a park.
const KIND_COLORS = { new: CATEGORICAL[0], upgrade: CATEGORICAL[1] };
const FAMILIES = [
  { key: 'Blue Bayou',       color: PARK_COLOR.BB },
  { key: 'Gulf Islands',     color: PARK_COLOR.GI },
  { key: 'Two-Park',         color: CATEGORICAL[2] },
  { key: 'Premium Two-Park', color: CATEGORICAL[3] },
  { key: 'Comp / Investor',  color: '#9ca3af' },
  { key: 'Other',            color: '#d1d5db' },
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

const axisProps = {
  x: { tick: { fontSize: 11, fill: '#6b7280' }, axisLine: { stroke: '#e5e7eb' }, tickLine: false },
  y: { tick: { fontSize: 11, fill: '#6b7280' }, axisLine: false, tickLine: false, width: 48 },
};

export default function SeasonPasses() {
  const { params } = useFilters();
  const [data, setData]     = useState(null);
  const [prev, setPrev]     = useState(null);
  const [loading, setLoading] = useState(true);

  const singleDay = params.startDate === params.endDate;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const pr = previousRange(params.startDate, params.endDate);
    Promise.all([
      api.get('/analytics/season-passes', { params }),
      api.get('/analytics/season-passes', { params: { ...params, startDate: pr.startDate, endDate: pr.endDate } }),
    ])
      .then(([cur, prv]) => {
        if (cancelled) return;
        setData({ ...cur.data, prevDays: pr.days });
        setPrev(prv.data);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.startDate, params.endDate, params.park]);

  if (!data) return loading ? <LoadingBlock h="h-96" /> : <div className="text-sm text-gray-400">Failed to load.</div>;

  const { kinds, families, upgradeCapture, gaGuests, replacementFees, byProduct, salesTrend, redemptions, redemptionTrend, granularity } = data;
  const compareLabel = singleDay ? 'vs yesterday' : `vs previous ${data.prevDays} days`;
  const passRevenue = kinds.new.revenue + kinds.upgrade.revenue;
  const prevPassRevenue = prev ? prev.kinds.new.revenue + prev.kinds.upgrade.revenue : null;
  const avgNewPrice = kinds.new.quantity ? kinds.new.revenue / kinds.new.quantity : 0;
  const avgUpgradePrice = kinds.upgrade.quantity ? kinds.upgrade.revenue / kinds.upgrade.quantity : 0;
  const xTickFmt = granularity === 'hour' ? undefined : shortDate;

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Pass Revenue" icon="🎫" accent
          value={money(passRevenue)}
          delta={delta(passRevenue, prevPassRevenue)}
          sub={compareLabel}
        />
        <KpiTile
          label="New Passes Sold" icon="🆕" accent
          value={number(kinds.new.quantity)}
          delta={delta(kinds.new.quantity, prev?.kinds.new.quantity)}
          sub={`avg ${moneyPrecise(avgNewPrice)} · ${number(kinds.comp.quantity)} comp/investor`}
        />
        <KpiTile
          label="Upgrades Sold" icon="⤴️"
          value={number(kinds.upgrade.quantity)}
          delta={delta(kinds.upgrade.quantity, prev?.kinds.upgrade.quantity)}
          sub={`${money(kinds.upgrade.revenue)} · avg ${moneyPrecise(avgUpgradePrice)}`}
        />
        <KpiTile
          label="Upgrade Capture" icon="🎯"
          value={upgradeCapture == null ? '—' : `${upgradeCapture.toFixed(1)}%`}
          sub={`of ${number(gaGuests)} GA guests upgraded to a pass`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard
          title={granularity === 'hour' ? 'New Pass Sales by Hour' : 'Pass Sales by Day'}
          right={<span className="text-xs text-gray-400">passes</span>}
        >
          {salesTrend.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No pass sales in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={salesTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={xTickFmt} {...axisProps.x} />
                <YAxis tickFormatter={number} {...axisProps.y} />
                <Tooltip content={<ChartTooltip formatter={number} labelFormatter={xTickFmt} />} />
                {granularity !== 'hour' && <Legend wrapperStyle={{ fontSize: 12 }} />}
                <Bar dataKey="newQty" name="New passes" stackId="p" fill={KIND_COLORS.new} maxBarSize={32} />
                {granularity !== 'hour' && (
                  <Bar dataKey="upgradeQty" name="Upgrades" stackId="p" fill={KIND_COLORS.upgrade} maxBarSize={32} />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
          {granularity === 'hour' ? (
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              Upgrades only happen in person at the park — there's no advance purchase — but RocketRez
              never records the moment one was rung in, only the order it was appended to (which may
              have been created earlier that same visit, or weeks earlier for an advance GA ticket).
              With no hour to trust, upgrades are left off this chart entirely.
              {kinds.upgrade.quantity > 0 && (
                <> {' '}Today's upgrade total: <span className="font-semibold text-gray-600">
                {number(kinds.upgrade.quantity)} ({money(kinds.upgrade.revenue)})</span> — included in
                the KPIs above.</>
              )}
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              Upgrades count on the guest's visit day — the (UP) membership is added to their original
              GA ticket order, so the order date can be weeks earlier for advance web purchases.
            </p>
          )}
        </SectionCard>

        <SectionCard title="Revenue by Pass Family">
          <ShareBar segments={FAMILIES.map(f => ({ value: families[f.key]?.revenue || 0, color: f.color }))} />
          <div className="mt-4 space-y-2.5">
            {FAMILIES.filter(f => families[f.key]).map(f => {
              const row = families[f.key];
              return (
                <div key={f.key} className="flex items-center gap-2.5 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: f.color }} />
                  <span className="text-gray-600">{f.key}</span>
                  <span className="ml-auto text-xs text-gray-400 tabular-nums">{number(row.quantity)} passes</span>
                  <span className="w-24 text-right font-semibold text-gray-900 tabular-nums">{money(row.revenue)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
            Includes upgrades within each family. Replacement cards: {number(replacementFees.quantity)} issued,
            {' '}{money(replacementFees.revenue)} in fees.
          </p>
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard
          title={granularity === 'hour' ? 'Passholder Visits by Hour' : 'Passholder Visits by Day'}
          right={<span className="text-xs text-gray-400">{number(redemptions.total)} visits in range</span>}
        >
          {redemptionTrend.length === 0 ? (
            <p className="text-sm text-gray-400 py-10 text-center">No passholder visits in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={redemptionTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={xTickFmt} {...axisProps.x} />
                <YAxis tickFormatter={number} {...axisProps.y} />
                <Tooltip content={<ChartTooltip formatter={number} labelFormatter={xTickFmt} />} />
                <Bar dataKey="visits" name="Visits" fill={CATEGORICAL[2]} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-[11px] text-gray-400">
            Counted by visit date from gate scans. {number(redemptions.bb)} at Blue Bayou ·
            {' '}{number(redemptions.gi)} at Gulf Islands · {number(redemptions.premium)} premium-pass visits.
          </p>
        </SectionCard>

        <SectionCard title="Products" right={<span className="text-xs text-gray-400">{byProduct.length} pass products</span>}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 uppercase tracking-wide">
                  <th className="text-left font-semibold px-1 pb-2">Product</th>
                  <th className="text-left font-semibold px-1 pb-2">Type</th>
                  <th className="text-right font-semibold px-1 pb-2">Sold</th>
                  <th className="text-right font-semibold px-1 pb-2">Avg</th>
                  <th className="text-right font-semibold px-1 pb-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.map(p => (
                  <tr key={`${p.name}-${p.kind}`} className="border-t border-gray-50">
                    <td className="px-1 py-1.5 text-gray-700">{p.name}</td>
                    <td className="px-1 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                        p.kind === 'upgrade' ? 'bg-orange-50 text-orange-600'
                        : p.kind === 'comp' ? 'bg-gray-100 text-gray-500'
                        : 'bg-blue-50 text-blue-600'
                      }`}>
                        {p.kind === 'upgrade' ? 'Upgrade' : p.kind === 'comp' ? 'Comp' : 'New'}
                      </span>
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-gray-600">{number(p.quantity)}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-gray-400">
                      {p.quantity && p.revenue ? moneyPrecise(p.revenue / p.quantity) : '—'}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums font-medium text-gray-900">{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byProduct.length === 0 && (
              <p className="text-sm text-gray-400 py-8 text-center">No pass sales in this range.</p>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
