import { useState, useEffect, useRef, useMemo } from 'react';
import api from '../lib/api.js';

function fmtCurrency(val) {
  return '$' + parseFloat(val || 0).toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const METHOD_LABEL = {
  payroll_deduction: 'Payroll',
  stripe:            'Credit Card',
  cash:              'Cash',
  credit:            'Credit Card',
  comp:              'Comp',
  other:             'Other',
};

const METHOD_COLORS = {
  payroll_deduction: 'bg-teal-100 text-teal-700',
  stripe:            'bg-blue-100 text-blue-700',
  cash:              'bg-gray-100 text-gray-600',
  credit:            'bg-blue-100 text-blue-700',
  comp:              'bg-purple-100 text-purple-700',
  other:             'bg-orange-100 text-orange-700',
};

const PARK_LABEL  = { BB: 'Blue Bayou', GI: 'Gulf Islands', MULTI: 'Multi-Park' };
const PARK_COLORS = {
  BB:    'bg-sky-100 text-sky-700',
  GI:    'bg-emerald-100 text-emerald-700',
  MULTI: 'bg-violet-100 text-violet-700',
};

const SEVERITY_COLORS = {
  high:   'bg-red-50 border-red-200 text-red-800',
  medium: 'bg-amber-50 border-amber-200 text-amber-800',
  low:    'bg-blue-50 border-blue-200 text-blue-700',
};

const SEVERITY_DOT = {
  high:   'bg-red-500',
  medium: 'bg-amber-500',
  low:    'bg-blue-400',
};

export default function MealDeductions() {
  const [uploads, setUploads]       = useState([]);
  const [selected, setSelected]     = useState(null);
  const [breakdown, setBreakdown]   = useState(null);
  const [uploadMeta, setUploadMeta] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [expanded, setExpanded]     = useState({});

  // Search & filter state
  const [search, setSearch]             = useState('');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterPark, setFilterPark]     = useState('all');

  useEffect(() => {
    api.get('/hr/meal-deductions')
      .then(r => setUploads(r.data.uploads))
      .catch(console.error);
  }, []);

  async function loadBreakdown(upload) {
    setSelected(upload);
    setBreakdown(null);
    setUploadMeta(null);
    setExpanded({});
    setSearch(''); setFilterMethod('all'); setFilterPark('all');
    setLoading(true);
    try {
      const { data } = await api.get(`/hr/meal-deductions/${upload.id}`);
      setBreakdown(data.breakdown);
      setUploadMeta(data.upload);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleUploaded(upload) {
    setUploads(prev => [upload, ...prev]);
    setShowUpload(false);
    loadBreakdown(upload);
  }

  async function handleDelete(uploadId) {
    if (!confirm('Delete this upload and all its deduction records?')) return;
    try {
      await api.delete(`/hr/meal-deductions/${uploadId}`);
      setUploads(prev => prev.filter(u => u.id !== uploadId));
      if (selected?.id === uploadId) { setSelected(null); setBreakdown(null); setUploadMeta(null); }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete upload.');
    }
  }

  // Derive available parks from breakdown
  const availableParks = useMemo(() => {
    if (!breakdown) return [];
    const parks = new Set();
    breakdown.forEach(b => (b.parks || []).forEach(p => parks.add(p)));
    return [...parks].sort();
  }, [breakdown]);

  const isMultiPark = availableParks.length > 1;

  // Filtered + searched employee list
  const filteredBreakdown = useMemo(() => {
    if (!breakdown) return [];
    return breakdown.filter(b => {
      if (search && !b.employeeName.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterMethod !== 'all' && !b.transactions.some(t => t.paymentMethod === filterMethod)) return false;
      if (filterPark !== 'all' && !(b.parks || []).includes(filterPark)) return false;
      return true;
    });
  }, [breakdown, search, filterMethod, filterPark]);

  // Per-park payroll totals for stats
  const parkTotals = useMemo(() => {
    if (!breakdown || !isMultiPark) return null;
    const totals = {};
    for (const b of breakdown) {
      for (const t of b.transactions) {
        if (t.paymentMethod !== 'payroll_deduction' || !t.park) continue;
        if (!totals[t.park]) totals[t.park] = 0;
        totals[t.park] += parseFloat(t.amount);
      }
    }
    return totals;
  }, [breakdown, isMultiPark]);

  const isRocketRez = uploadMeta?.reportType === 'rocket_rez';
  const aiAnalysis  = uploadMeta?.aiAnalysis;

  function exportCSV() {
    if (!filteredBreakdown.length || !selected) return;
    const headers = isRocketRez
      ? ['Employee Name', 'Park', 'Transactions', 'Total Spent', 'Payroll Deduction']
      : ['Employee Name', 'Transactions', 'Total Deductions'];
    const rows = [headers];
    filteredBreakdown.forEach(b => {
      if (isRocketRez) {
        rows.push([b.employeeName, (b.parks || []).join('+'), b.transactionCount,
          parseFloat(b.totalAmount).toFixed(2), parseFloat(b.payrollTotal).toFixed(2)]);
      } else {
        rows.push([b.employeeName, b.transactionCount, parseFloat(b.totalAmount).toFixed(2)]);
      }
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meal-deductions-${selected.periodLabel || selected.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex h-full min-h-0 gap-0">

      {/* Left panel */}
      <div className="w-80 shrink-0 border-r border-gray-200 flex flex-col bg-white">
        <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Deduction Reports</h2>
            <p className="text-xs text-gray-500 mt-0.5">{uploads.length} upload{uploads.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowUpload(true)} className="btn-primary text-xs px-3 py-1.5 gap-1.5">
            <PlusIcon /> Upload
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {uploads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 px-6 text-center">
              <DocumentIcon className="text-gray-300 mb-3" size="large" />
              <p className="text-sm font-medium text-gray-500">No reports yet</p>
              <p className="text-xs text-gray-400 mt-1">Upload a CSV meal report to get started.</p>
            </div>
          ) : (
            uploads.map(u => (
              <button
                key={u.id}
                onClick={() => loadBreakdown(u)}
                className={`w-full text-left px-4 py-3.5 border-b border-gray-100 hover:bg-gray-50 transition-colors group
                  ${selected?.id === u.id ? 'bg-brand/5 border-l-2 border-l-brand' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={`text-xs font-semibold truncate ${selected?.id === u.id ? 'text-brand' : 'text-gray-800'}`}>
                        {u.periodLabel || 'Unnamed Period'}
                      </p>
                      {u.reportType === 'rocket_rez' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-semibold shrink-0">RR</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{u.filename}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs text-gray-400">{u.rowCount} items</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs font-semibold text-teal-700">{fmtCurrency(u.payrollTotal)} payroll</span>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(u.id); }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all shrink-0 p-0.5"
                    title="Delete upload"
                  >
                    <TrashIcon />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">{fmtDate(u.createdAt)}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-gray-50">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <TableIcon className="text-gray-300" />
            <p className="text-sm text-gray-500">Select a report to view the employee breakdown</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900">
                    {selected.periodLabel || 'Deduction Breakdown'}
                  </h2>
                  {isRocketRez && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-semibold">Rocket Rez</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selected.filename} · {selected.rowCount} transactions
                </p>
              </div>
              {breakdown && (
                <button onClick={exportCSV} className="btn-ghost text-xs gap-1.5">
                  <DownloadIcon /> Export CSV
                </button>
              )}
            </div>

            {/* Summary stats */}
            {breakdown && uploadMeta && (
              <div className={`px-6 pt-4 grid gap-4 shrink-0 ${isRocketRez ? 'grid-cols-4' : 'grid-cols-3'}`}>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{breakdown.length}</p>
                  <p className="text-xs text-gray-500 mt-1">Employees</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{selected.rowCount}</p>
                  <p className="text-xs text-gray-500 mt-1">Transactions</p>
                </div>
                {isRocketRez ? (
                  <>
                    <div className="bg-white rounded-xl border border-teal-200 p-4 text-center">
                      <p className="text-2xl font-bold text-teal-700">{fmtCurrency(uploadMeta.payrollTotal)}</p>
                      <p className="text-xs text-gray-500 mt-1">Payroll Deductions</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                      <p className="text-2xl font-bold text-gray-700">{fmtCurrency(uploadMeta.totalAmount)}</p>
                      <p className="text-xs text-gray-500 mt-1">Total Spent</p>
                    </div>
                  </>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                    <p className="text-2xl font-bold text-brand">{fmtCurrency(uploadMeta.totalAmount)}</p>
                    <p className="text-xs text-gray-500 mt-1">Total Deductions</p>
                  </div>
                )}
              </div>
            )}

            {/* Per-park payroll breakdown */}
            {isMultiPark && parkTotals && (
              <div className="px-6 pt-3 shrink-0">
                <div className="flex gap-3">
                  {Object.entries(parkTotals).sort().map(([code, total]) => (
                    <div key={code} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${PARK_COLORS[code] || 'bg-gray-100 text-gray-600'}`}>
                      <span>{PARK_LABEL[code] || code}</span>
                      <span className="opacity-70">·</span>
                      <span>{fmtCurrency(total)} payroll</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Analysis panel */}
            {aiAnalysis && (
              <div className="mx-6 mt-4 shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-gradient-to-r from-teal-50 to-white border-b border-gray-100 flex items-center gap-2">
                  <SparkleIcon />
                  <span className="text-xs font-bold text-gray-700">AI Analysis</span>
                  {aiAnalysis.anomalies?.filter(a => a.severity === 'high').length > 0 && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                      {aiAnalysis.anomalies.filter(a => a.severity === 'high').length} high
                    </span>
                  )}
                  {aiAnalysis.anomalies?.filter(a => a.severity === 'medium').length > 0 && (
                    <span className={`${aiAnalysis.anomalies?.some(a => a.severity === 'high') ? '' : 'ml-auto'} text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold`}>
                      {aiAnalysis.anomalies.filter(a => a.severity === 'medium').length} medium
                    </span>
                  )}
                </div>
                <div className="px-4 py-3 space-y-3">
                  {aiAnalysis.summary && <p className="text-xs text-gray-600">{aiAnalysis.summary}</p>}
                  {aiAnalysis.payrollDeductionNote && (
                    <div className="flex items-start gap-2 p-2.5 bg-teal-50 rounded-lg">
                      <InfoIcon className="text-teal-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-teal-800">{aiAnalysis.payrollDeductionNote}</p>
                    </div>
                  )}
                  {aiAnalysis.anomalies?.length > 0 && (
                    <div className="space-y-1.5">
                      {[...aiAnalysis.anomalies]
                        .sort((a, b) => ['high','medium','low'].indexOf(a.severity) - ['high','medium','low'].indexOf(b.severity))
                        .map((anomaly, i) => (
                          <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${SEVERITY_COLORS[anomaly.severity] || SEVERITY_COLORS.low}`}>
                            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${SEVERITY_DOT[anomaly.severity] || SEVERITY_DOT.low}`} />
                            <div className="min-w-0">
                              {anomaly.employee && <p className="text-xs font-semibold truncate">{anomaly.employee}</p>}
                              <p className="text-xs">{anomaly.description}</p>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Search + filter bar */}
            {breakdown && (
              <div className="px-6 pt-4 pb-2 shrink-0">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search employees…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                    />
                    {search && (
                      <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <XSmallIcon />
                      </button>
                    )}
                  </div>

                  <select
                    value={filterMethod}
                    onChange={e => setFilterMethod(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                  >
                    <option value="all">All Methods</option>
                    <option value="payroll_deduction">Payroll</option>
                    <option value="stripe">Credit Card</option>
                    <option value="cash">Cash</option>
                    <option value="comp">Comp</option>
                  </select>

                  {isMultiPark && (
                    <select
                      value={filterPark}
                      onChange={e => setFilterPark(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                    >
                      <option value="all">All Parks</option>
                      {availableParks.map(p => (
                        <option key={p} value={p}>{PARK_LABEL[p] || p}</option>
                      ))}
                    </select>
                  )}

                  {(search || filterMethod !== 'all' || filterPark !== 'all') && (
                    <button
                      onClick={() => { setSearch(''); setFilterMethod('all'); setFilterPark('all'); }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {(search || filterMethod !== 'all' || filterPark !== 'all') && (
                  <p className="text-xs text-gray-400 mt-1.5">
                    Showing {filteredBreakdown.length} of {breakdown.length} employees
                  </p>
                )}
              </div>
            )}

            {/* Employee table */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                </div>
              ) : filteredBreakdown.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">
                  {breakdown?.length === 0 ? 'No deduction records found.' : 'No employees match your filters.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Column headers */}
                  <div className="grid grid-cols-12 gap-3 px-4 py-2">
                    <div className="col-span-5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Employee</div>
                    <div className="col-span-2 text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Items</div>
                    {isRocketRez ? (
                      <>
                        <div className="col-span-2 text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Total</div>
                        <div className="col-span-2 text-xs font-semibold text-teal-500 uppercase tracking-wide text-right">Payroll</div>
                      </>
                    ) : (
                      <div className="col-span-4 text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Total</div>
                    )}
                    <div className="col-span-1" />
                  </div>

                  {filteredBreakdown.map(b => {
                    const hasNonPayroll = isRocketRez && parseFloat(b.totalAmount) !== parseFloat(b.payrollTotal);
                    return (
                      <div key={b.employeeName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <button
                          onClick={() => setExpanded(p => ({ ...p, [b.employeeName]: !p[b.employeeName] }))}
                          className="w-full grid grid-cols-12 gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="col-span-5 flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center text-xs font-bold text-brand shrink-0">
                              {b.employeeName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{b.employeeName}</p>
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {b.park && (
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PARK_COLORS[b.park] || 'bg-gray-100 text-gray-600'}`}>
                                    {PARK_LABEL[b.park] || b.park}
                                  </span>
                                )}
                                {b.crossParkCount > 0 && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                    ⚠ Cross-park
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="col-span-2 flex items-center justify-end">
                            <span className="text-sm text-gray-600">{b.transactionCount}</span>
                          </div>
                          {isRocketRez ? (
                            <>
                              <div className="col-span-2 flex items-center justify-end">
                                <span className={`text-sm font-medium ${hasNonPayroll ? 'text-gray-400' : 'text-gray-900'}`}>
                                  {fmtCurrency(b.totalAmount)}
                                </span>
                              </div>
                              <div className="col-span-2 flex items-center justify-end">
                                <span className="text-sm font-bold text-teal-700">{fmtCurrency(b.payrollTotal)}</span>
                              </div>
                            </>
                          ) : (
                            <div className="col-span-4 flex items-center justify-end">
                              <span className="text-sm font-bold text-gray-900">{fmtCurrency(b.totalAmount)}</span>
                            </div>
                          )}
                          <div className="col-span-1 flex items-center justify-end">
                            <ChevronIcon expanded={!!expanded[b.employeeName]} />
                          </div>
                        </button>

                        {expanded[b.employeeName] && b.transactions?.length > 0 && (
                          <div className="border-t border-gray-100 bg-gray-50">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  <th className="px-4 py-2 text-left font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                                  <th className="px-4 py-2 text-left font-semibold text-gray-400 uppercase tracking-wide">Item</th>
                                  {isRocketRez && (
                                    <>
                                      <th className="px-4 py-2 text-left font-semibold text-gray-400 uppercase tracking-wide">Order #</th>
                                      <th className="px-4 py-2 text-left font-semibold text-gray-400 uppercase tracking-wide">Park</th>
                                      <th className="px-4 py-2 text-left font-semibold text-gray-400 uppercase tracking-wide">Method</th>
                                    </>
                                  )}
                                  <th className="px-4 py-2 text-right font-semibold text-gray-400 uppercase tracking-wide">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {b.transactions.map((t, i) => (
                                  <tr key={i} className={`border-b border-gray-100 last:border-0 ${t.crossPark ? 'bg-red-50' : ''}`}>
                                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{t.date ? fmtDate(t.date) : '—'}</td>
                                    <td className="px-4 py-2 text-gray-700">{t.description || '—'}</td>
                                    {isRocketRez && (
                                      <>
                                        <td className="px-4 py-2 text-gray-500 font-mono">{t.orderId || '—'}</td>
                                        <td className="px-4 py-2">
                                          <div className="flex items-center gap-1">
                                            {t.park ? (
                                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PARK_COLORS[t.park] || 'bg-gray-100 text-gray-600'}`}>
                                                {t.park}
                                              </span>
                                            ) : '—'}
                                            {t.crossPark && (
                                              <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-red-100 text-red-700" title={`Home park: ${t.homePark}`}>
                                                ⚠
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="px-4 py-2">
                                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${METHOD_COLORS[t.paymentMethod] || METHOD_COLORS.other}`}>
                                            {METHOD_LABEL[t.paymentMethod] || t.paymentMethod}
                                          </span>
                                        </td>
                                      </>
                                    )}
                                    <td className={`px-4 py-2 text-right font-medium ${t.paymentMethod === 'comp' ? 'text-purple-600' : 'text-gray-900'}`}>
                                      {t.paymentMethod === 'comp' ? 'Comp' : fmtCurrency(t.amount)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />
      )}
    </div>
  );
}

// ── Upload Modal ──────────────────────────────────────────────────────────────

function UploadModal({ onClose, onUploaded }) {
  const backdropRef  = useRef(null);
  const fileInputRef = useRef(null);
  const [file, setFile]               = useState(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [uploading, setUploading]     = useState(false);
  const [error, setError]             = useState('');
  const [needsMapping, setNeedsMapping] = useState(false);
  const [headers, setHeaders]           = useState([]);
  const [employeeCol, setEmployeeCol]   = useState('');
  const [amountCol, setAmountCol]       = useState('');
  const [dateCol, setDateCol]           = useState('');
  const [descCol, setDescCol]           = useState('');

  function handleBackdrop(e) { if (e.target === backdropRef.current) onClose(); }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.match(/\.(csv|tsv|txt)$/i)) { setError('Please select a CSV file.'); return; }
    setFile(f); setError(''); setNeedsMapping(false);
  }

  async function handleUpload(explicitMapping = null) {
    if (!file) { setError('Please select a CSV file.'); return; }
    setUploading(true); setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (periodLabel.trim()) formData.append('periodLabel', periodLabel.trim());
      if (explicitMapping) {
        if (explicitMapping.employeeCol) formData.append('employeeCol', explicitMapping.employeeCol);
        if (explicitMapping.amountCol)   formData.append('amountCol',   explicitMapping.amountCol);
        if (explicitMapping.dateCol)     formData.append('dateCol',     explicitMapping.dateCol);
        if (explicitMapping.descCol)     formData.append('descCol',     explicitMapping.descCol);
      }
      const { data } = await api.post('/hr/meal-deductions/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });
      if (data.needsMapping) {
        setHeaders(data.headers); setNeedsMapping(true);
        if (data.detected?.employeeCol) setEmployeeCol(data.detected.employeeCol);
        if (data.detected?.amountCol)   setAmountCol(data.detected.amountCol);
        if (data.detected?.dateCol)     setDateCol(data.detected.dateCol);
        if (data.detected?.descCol)     setDescCol(data.detected.descCol);
        return;
      }
      onUploaded(data.upload);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function handleConfirmMapping() {
    if (!employeeCol) { setError('Please select the Employee column.'); return; }
    if (!amountCol)   { setError('Please select the Amount column.'); return; }
    handleUpload({ employeeCol, amountCol, dateCol: dateCol || null, descCol: descCol || null });
  }

  return (
    <div ref={backdropRef} onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-brand px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Upload Meal Deduction Report</h2>
            <p className="text-xs text-white/70 mt-0.5">CSV format · Rocket Rez reports detected automatically</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors">
            <CloseIcon />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="label">Pay Period Label</label>
            <input type="text" className="field" placeholder="e.g. June 1–15, 2026"
              value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} />
          </div>

          <div>
            <label className="label">CSV File</label>
            <div onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl px-4 py-6 text-center cursor-pointer transition-colors
                ${file ? 'border-brand/50 bg-brand/5' : 'border-gray-300 hover:border-brand/40 hover:bg-gray-50'}`}
            >
              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFileChange} />
              {file ? (
                <div>
                  <DocumentIcon className="text-brand mx-auto mb-2" />
                  <p className="text-sm font-semibold text-brand">{file.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <UploadIcon className="text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Click to select a CSV file</p>
                  <p className="text-xs text-gray-400 mt-0.5">Rocket Rez reseller reports are detected automatically</p>
                </div>
              )}
            </div>
          </div>

          {needsMapping && (
            <div className="space-y-4 border border-amber-200 bg-amber-50 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <AlertIcon className="text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Column Mapping Required</p>
                  <p className="text-xs text-amber-700 mt-0.5">Couldn't auto-detect columns. Please map them below.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Employee Column *', val: employeeCol, set: setEmployeeCol, required: true },
                  { label: 'Amount Column *',   val: amountCol,   set: setAmountCol,   required: true },
                  { label: 'Date Column',        val: dateCol,     set: setDateCol,     required: false },
                  { label: 'Description Column', val: descCol,     set: setDescCol,     required: false },
                ].map(({ label, val, set, required }) => (
                  <div key={label}>
                    <label className="label text-amber-700">{label}</label>
                    <select className="field text-sm" value={val} onChange={e => set(e.target.value)}>
                      <option value="">{required ? '— select —' : '— none —'}</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {uploading && (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
              <Spinner /> Processing report and running AI analysis…
            </div>
          )}

          {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
            {needsMapping ? (
              <button onClick={handleConfirmMapping} disabled={uploading} className="btn-primary flex-1">
                {uploading ? <><Spinner /> Processing…</> : 'Import Report'}
              </button>
            ) : (
              <button onClick={() => handleUpload()} disabled={uploading || !file} className="btn-primary flex-1">
                {uploading ? <><Spinner /> Analyzing…</> : 'Upload & Analyze'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}
function TrashIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
}
function DocumentIcon({ className = '', size = 'normal' }) {
  const sz = size === 'large' ? 'w-10 h-10' : 'w-5 h-5';
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`${sz} ${className}`}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
}
function TableIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-12 h-12 ${className}`}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>;
}
function DownloadIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}
function UploadIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-8 h-8 mx-auto ${className}`}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
}
function ChevronIcon({ expanded }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6"/></svg>;
}
function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function AlertIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${className}`}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}
function SparkleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-teal-600"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>;
}
function InfoIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 ${className}`}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;
}
function SearchIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 ${className}`}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function XSmallIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>;
}
