import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api.js';
import { money, moneyPrecise, number, shortDate } from '../lib/format.js';
import LoadingOverlay, { LoadingBlock } from '../components/LoadingOverlay.jsx';

function centralToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

const PARKS = [
  { value: 'BB', label: 'Blue Bayou' },
  { value: 'GI', label: 'Gulf Islands' },
  { value: 'ALL', label: 'Both Parks' },
];

function SectionCard({ title, right, children }) {
  return (
    <div className="card p-5 print:shadow-none print:border-0 print:p-0">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap print:hidden">
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

function FillLine({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <div className="border-b border-gray-300 h-6 text-sm text-gray-700 flex items-end pb-0.5">{value}</div>
    </div>
  );
}

function CashierCard({ c, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden print:break-inside-avoid print:mb-6 print:border-gray-400">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left print:hidden"
      >
        <span className={`text-gray-400 text-xs transition-transform inline-block ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="font-semibold text-gray-800 text-sm">{c.cashier}</span>
        <span className="text-xs text-gray-400">{number(c.orderCount)} order{c.orderCount === 1 ? '' : 's'}</span>
        <span className="ml-auto text-sm font-bold text-az-dark tabular-nums">{money(c.cashTotal)} cash</span>
        <span className="text-xs text-gray-400 tabular-nums">{money(c.total)} total</span>
      </button>

      {/* Print-only static header — the button above is interactive-only */}
      <div className="hidden print:flex items-center justify-between px-1 py-2 border-b-2 border-gray-800 mb-2">
        <span className="font-bold text-gray-900">{c.cashier}</span>
        <span className="text-sm font-semibold">{money(c.total)} total, all tenders</span>
      </div>

      <div className={`${open ? 'block' : 'hidden'} print:block px-4 py-3 print:px-1 space-y-4`}>
        <div className="space-y-1.5">
          {c.methods.map(m => (
            <div key={m.method} className={`flex items-center gap-2.5 text-sm ${m.method.startsWith('⚠️') ? 'text-amber-700' : ''}`}>
              <span className={m.method.startsWith('⚠️') ? 'font-medium' : 'text-gray-600'}>{m.method}</span>
              <span className="text-[11px] text-gray-400">{m.payments.length} txn</span>
              <span className={`ml-auto tabular-nums font-medium ${m.method.startsWith('⚠️') ? 'text-amber-700' : 'text-gray-900'}`}>{money(m.total)}</span>
            </div>
          ))}
        </div>

        {c.methods.map(m => (
          <div key={m.method}>
            <p className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${m.method.startsWith('⚠️') ? 'text-amber-600' : 'text-gray-500'}`}>
              {m.method}
              {m.method.startsWith('⚠️') && <span className="normal-case font-normal text-amber-600/80 ml-1">— order total shown, not counted toward Cash Out Total below</span>}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th className="text-left font-semibold pb-1">Time</th>
                  <th className="text-left font-semibold pb-1">Order #</th>
                  <th className="text-left font-semibold pb-1">Sales Office</th>
                  <th className="text-right font-semibold pb-1">Amount</th>
                </tr>
              </thead>
              <tbody>
                {m.payments.map((p, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-1 text-gray-500 whitespace-nowrap">{p.time}</td>
                    <td className="py-1 tabular-nums font-medium text-gray-800">#{p.orderId}</td>
                    <td className="py-1 text-gray-500">{p.office}</td>
                    <td className={`py-1 text-right tabular-nums font-medium ${p.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                      {p.amount < 0 ? '−' : ''}{moneyPrecise(Math.abs(p.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="pt-3 border-t border-gray-200 print:border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-700">Cash Out Total</span>
            <span className="text-lg font-bold text-gray-900 tabular-nums">{money(c.cashTotal)}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <FillLine label="Hand Counted Total" />
            <FillLine label="Over / Short Amount" />
            <div className="col-span-2"><FillLine label="Explanation / Notes" /></div>
            <FillLine label="Employee Name" value={c.cashier} />
            <FillLine label="Employee Signature" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CashOutReport() {
  // Report parameters live locally — this is a generate-on-demand report,
  // not a live dashboard view, so it doesn't share the global date filter.
  const [startDate, setStartDate] = useState(centralToday());
  const [endDate, setEndDate]     = useState(centralToday());
  const [park, setPark]           = useState('BB');
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [sortBy, setSortBy]       = useState('cash'); // cash | name

  function generate() {
    setLoading(true);
    const params = { startDate, endDate };
    if (park !== 'ALL') params.park = park;
    api.get('/analytics/reports/cash-out', { params })
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }

  // Generate once on first load with the default (today, Blue Bayou) params.
  useEffect(() => { generate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dateGroups = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.dateGroups
      .map(d => ({
        date: d.date,
        cashiers: d.cashiers
          .filter(c => !q || c.cashier.toLowerCase().includes(q))
          .sort((a, b) => sortBy === 'name' ? a.cashier.localeCompare(b.cashier) : b.cashTotal - a.cashTotal || b.total - a.total),
      }))
      .filter(d => d.cashiers.length > 0);
  }, [data, search, sortBy]);

  const showDateHeadings = dateGroups.length > 1;
  const parkLabel = PARKS.find(p => p.value === park)?.label;
  const rangeLabel = startDate === endDate ? shortDate(startDate) : `${shortDate(startDate)} – ${shortDate(endDate)}`;

  return (
    <div className="relative space-y-4">
      <LoadingOverlay show={loading} />

      <div className="print:hidden">
        <p className="text-lg font-bold text-gray-900">Cash Out Report</p>
        <p className="mt-1 text-xs text-gray-500">
          Grouped by cashier / web engine, matching the RocketRez Cash Out Report. Cash totals net out
          any same-day cash refunds. Terminal and GL Code aren't available from synced order data.
        </p>
      </div>

      <div className="card p-4 flex items-end gap-3 flex-wrap print:hidden">
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Start date</p>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                 className="px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-700" />
        </div>
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">End date</p>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                 className="px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-700" />
        </div>
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Park</p>
          <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1">
            {PARKS.map(p => (
              <button key={p.value} onClick={() => setPark(p.value)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  park === p.value ? 'bg-az text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={loading}
          className="px-4 py-2 text-xs font-semibold text-white bg-az hover:bg-az-dark rounded-lg disabled:opacity-50">
          {loading ? 'Generating…' : 'Generate Report'}
        </button>
        {data && (
          <button onClick={() => window.print()}
            className="ml-auto px-3 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">
            🖨️ Print
          </button>
        )}
      </div>

      <div className="hidden print:block">
        <p className="text-lg font-bold text-gray-900">Cash Out Report</p>
        <p className="text-xs text-gray-500">{rangeLabel} · {parkLabel}</p>
      </div>

      {data?.unaccounted?.orderCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 leading-relaxed">
          ⚠️ <strong>{data.unaccounted.orderCount} order{data.unaccounted.orderCount === 1 ? '' : 's'} totaling {money(data.unaccounted.total)}</strong> {data.unaccounted.orderCount === 1 ? 'has' : 'have'} no
          payment method recorded in RocketRez — the order exists and has a balance due, but no tender is on file. Flagged as "⚠️ No Payment
          Recorded" under the cashier below; not counted toward any cash total since it's unclear anything was actually collected.
        </div>
      )}

      {!data ? (
        <LoadingBlock h="h-72" />
      ) : (
        <SectionCard
          title="Cash Out by Cashier"
          right={
            <div className="flex items-center gap-2">
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search cashier…"
                className="px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-700 w-44"
              />
              <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1">
                {[{ v: 'cash', l: 'By Cash' }, { v: 'name', l: 'A–Z' }].map(s => (
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
          {dateGroups.length === 0 ? (
            <p className="text-sm text-gray-400 py-12 text-center">
              {search ? 'No cashiers match your search.' : 'No payments in this range.'}
            </p>
          ) : (
            <div className="space-y-6">
              {dateGroups.map(d => (
                <div key={d.date}>
                  {showDateHeadings && (
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{shortDate(d.date)}</p>
                  )}
                  <div className="space-y-2">
                    {d.cashiers.map(c => (
                      <CashierCard key={c.cashier} c={c} defaultOpen={dateGroups.length === 1 && d.cashiers.length === 1} />
                    ))}
                  </div>
                </div>
              ))}
              <div className="pt-3 border-t border-gray-200 flex items-center justify-between print:border-gray-800 print:pt-4">
                <span className="text-sm font-bold text-gray-800">Total Payments</span>
                <span className="text-lg font-bold text-gray-900 tabular-nums">{money(data.kpis.totalAll)}</span>
              </div>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
