import { useState, useMemo } from 'react';
import api from '../lib/api.js';

function todayStr() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

export default function RocketRezSync() {
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate]     = useState(todayStr());
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [expanded, setExpanded]   = useState(new Set());
  const [payrollOnly, setPayrollOnly] = useState(false);
  const [parkFilter, setParkFilter]   = useState('ALL');

  async function handleSync() {
    setLoading(true);
    setError(null);
    setData(null);
    setExpanded(new Set());
    try {
      const res = await api.get(`/hr/rocketrez/sync?startDate=${startDate}&endDate=${endDate}`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Sync failed');
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.breakdown.filter(e => {
      if (payrollOnly && e.payrollTotal === 0) return false;
      if (parkFilter !== 'ALL' && e.park !== parkFilter) return false;
      return true;
    });
  }, [data, payrollOnly, parkFilter]);

  const filteredTotals = useMemo(() =>
    filtered.reduce((s, e) => ({
      payroll:   +(s.payroll   + e.payrollTotal).toFixed(2),
      cashCard:  +(s.cashCard  + e.cashCardTotal).toFixed(2),
      employees: s.employees + 1,
      orders:    s.orders + e.transactionCount,
    }), { payroll: 0, cashCard: 0, employees: 0, orders: 0 }),
  [filtered]);

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* Controls */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand/50"
              />
            </div>
            <button
              onClick={handleSync}
              disabled={loading}
              className="px-5 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-2"
            >
              <SyncIcon spinning={loading} />
              {loading ? 'Syncing…' : 'Sync Orders'}
            </button>
            {data && (
              <p className="text-xs text-gray-400 ml-auto self-end pb-0.5">
                {data.totalOrders} crew orders fetched
              </p>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
            <SyncIcon spinning className="w-6 h-6 text-brand mx-auto mb-3" />
            <p className="text-sm text-gray-500">Fetching orders from RocketRez…</p>
            <p className="text-xs text-gray-400 mt-1">Paginating through all records, this may take a few seconds</p>
          </div>
        )}

        {/* Results */}
        {data && !loading && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Employees" value={filteredTotals.employees} />
              <StatCard label="Orders" value={filteredTotals.orders} />
              <StatCard label="Payroll Deductions" value={`$${filteredTotals.payroll.toFixed(2)}`} highlight />
              <StatCard label="Cash / Card" value={`$${filteredTotals.cashCard.toFixed(2)}`} />
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filter:</span>
              {[
                { id: 'ALL', label: 'All Parks' },
                { id: 'BB',  label: 'Blue Bayou' },
                { id: 'GI',  label: 'Gulf Islands' },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setParkFilter(p.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    parkFilter === p.id
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-brand/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <label className="flex items-center gap-2 text-xs text-gray-600 ml-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={payrollOnly}
                  onChange={e => setPayrollOnly(e.target.checked)}
                  className="rounded"
                />
                Payroll deductions only
              </label>
            </div>

            {/* Employee table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="w-8 px-4 py-3" />
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Employee
                    </th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Park
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Orders
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Payroll
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Cash / Card
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Token
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                        No records match the current filters
                      </td>
                    </tr>
                  ) : (
                    filtered.flatMap(emp => {
                      const key = `${emp.park}:${emp.employeeName}`;
                      const isOpen = expanded.has(key);
                      return [
                        <tr
                          key={key}
                          onClick={() => toggleExpand(key)}
                          className="cursor-pointer hover:bg-gray-50 transition-colors"
                        >
                          <td className="pl-4 pr-2 py-3 text-gray-400">
                            <ChevronIcon open={isOpen} />
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900">{emp.employeeName}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                              emp.park === 'BB'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-teal-100 text-teal-700'
                            }`}>
                              {emp.park}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">{emp.transactionCount}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">
                            {emp.payrollTotal > 0
                              ? `$${emp.payrollTotal.toFixed(2)}`
                              : <span className="text-gray-300 font-normal">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {emp.cashCardTotal > 0
                              ? `$${emp.cashCardTotal.toFixed(2)}`
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-400">
                            {emp.tokenTotal > 0
                              ? `$${emp.tokenTotal.toFixed(2)}`
                              : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>,

                        isOpen && (
                          <tr key={key + '-detail'}>
                            <td colSpan={7} className="bg-gray-50/80 px-8 py-3 border-b border-gray-100">
                              <div className="space-y-2.5">
                                {emp.transactions.map((t, ti) => (
                                  <div key={ti} className="flex items-start gap-4 text-xs">
                                    <span className="text-gray-400 shrink-0 w-36 pt-0.5">
                                      {new Date(t.date).toLocaleString('en-US', {
                                        month: 'short', day: 'numeric',
                                        hour: 'numeric', minute: '2-digit', hour12: true,
                                        timeZone: 'America/Chicago',
                                      })}
                                    </span>
                                    <div className="flex-1 min-w-0 text-gray-700">
                                      {t.items.length > 0
                                        ? t.items.map((item, ii) => (
                                            <span key={ii}>
                                              {item.name}
                                              {item.amount > 0 && (
                                                <span className="text-gray-400 ml-1">(${item.amount.toFixed(2)})</span>
                                              )}
                                              {ii < t.items.length - 1 ? ', ' : ''}
                                            </span>
                                          ))
                                        : <span className="text-gray-400 italic">No items recorded</span>}
                                    </div>
                                    <div className="flex gap-3 shrink-0 font-medium text-xs">
                                      {t.payroll > 0 && (
                                        <span className="text-gray-900">Payroll ${t.payroll.toFixed(2)}</span>
                                      )}
                                      {t.cashCard > 0 && (
                                        <span className="text-gray-500">Card ${t.cashCard.toFixed(2)}</span>
                                      )}
                                      {t.token > 0 && (
                                        <span className="text-gray-400">Token ${t.token.toFixed(2)}</span>
                                      )}
                                      {t.comp > 0 && (
                                        <span className="text-gray-400">Comp ${t.comp.toFixed(2)}</span>
                                      )}
                                      {t.payroll === 0 && t.cashCard === 0 && t.token === 0 && t.comp === 0 && (
                                        <span className="text-gray-400">$0.00</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ),
                      ].filter(Boolean);
                    })
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                      <td colSpan={3} className="px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">
                        Totals
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                        {filteredTotals.orders}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                        ${filteredTotals.payroll.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                        ${filteredTotals.cashCard.toFixed(2)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}

        {/* Empty / initial state */}
        {!data && !loading && !error && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-brand/10 flex items-center justify-center mx-auto mb-4">
              <SyncIcon className="w-6 h-6 text-brand" />
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Ready to sync</p>
            <p className="text-xs text-gray-400">
              Select a date range and click Sync Orders to pull live data directly from RocketRez
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight }) {
  return (
    <div className={`rounded-xl border shadow-sm p-4 ${
      highlight ? 'bg-brand/5 border-brand/20' : 'bg-white border-gray-200'
    }`}>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-brand' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function SyncIcon({ spinning }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={`w-4 h-4 shrink-0 ${spinning ? 'animate-spin' : ''}`}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
