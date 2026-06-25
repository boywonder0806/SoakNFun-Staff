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
  const [footageTarget, setFootageTarget] = useState(null);

  // Report selector dropdown
  const [showReportMenu, setShowReportMenu] = useState(false);
  const reportMenuRef = useRef(null);

  // AI panel collapsed state
  const [aiExpanded, setAiExpanded] = useState(false);

  // Search & filter state
  const [search, setSearch]             = useState('');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterPark, setFilterPark]     = useState('all');

  // Sort state
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  useEffect(() => {
    api.get('/hr/meal-deductions')
      .then(r => setUploads(r.data.uploads))
      .catch(console.error);
  }, []);

  // Close report dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (reportMenuRef.current && !reportMenuRef.current.contains(e.target)) {
        setShowReportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function loadBreakdown(upload) {
    setSelected(upload);
    setBreakdown(null);
    setUploadMeta(null);
    setExpanded({});
    setSearch(''); setFilterMethod('all'); setFilterPark('all');
    setShowReportMenu(false);
    setLoading(true);
    try {
      const { data } = await api.get(`/hr/meal-deductions/${upload.id}`);
      setBreakdown(data.breakdown);
      setUploadMeta(data.upload);
      // Auto-expand AI panel if there are high-severity anomalies
      const hasHigh = data.upload?.aiAnalysis?.anomalies?.some(a => a.severity === 'high');
      setAiExpanded(!!hasHigh);
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

  const availableParks = useMemo(() => {
    if (!breakdown) return [];
    const parks = new Set();
    breakdown.forEach(b => (b.parks || []).forEach(p => parks.add(p)));
    return [...parks].sort();
  }, [breakdown]);

  const isMultiPark = availableParks.length > 1;

  const filteredBreakdown = useMemo(() => {
    if (!breakdown) return [];
    const filtered = breakdown.filter(b => {
      if (search && !b.employeeName.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterMethod !== 'all' && !b.transactions.some(t => t.paymentMethod === filterMethod)) return false;
      if (filterPark !== 'all' && !(b.parks || []).includes(filterPark)) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortCol) {
        case 'name':    return dir * a.employeeName.localeCompare(b.employeeName);
        case 'park':    return dir * (a.park || '').localeCompare(b.park || '');
        case 'items':   return dir * (a.transactionCount - b.transactionCount);
        case 'total':   return dir * (parseFloat(a.totalAmount) - parseFloat(b.totalAmount));
        case 'payroll': return dir * (parseFloat(a.payrollTotal || 0) - parseFloat(b.payrollTotal || 0));
        default:        return 0;
      }
    });
  }, [breakdown, search, filterMethod, filterPark, sortCol, sortDir]);

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

  const highCount   = aiAnalysis?.anomalies?.filter(a => a.severity === 'high').length   || 0;
  const mediumCount = aiAnalysis?.anomalies?.filter(a => a.severity === 'medium').length || 0;

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

  const hasFilters = search || filterMethod !== 'all' || filterPark !== 'all';

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-gray-900">Meal Deductions</h1>
          {selected && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {selected.filename} · {selected.rowCount} transactions
            </p>
          )}
        </div>

        {/* Report selector */}
        <div className="relative" ref={reportMenuRef}>
          <button
            onClick={() => setShowReportMenu(p => !p)}
            className={`flex items-center gap-2 text-xs font-semibold border rounded-lg px-3 py-2 transition-colors
              ${showReportMenu ? 'border-brand text-brand bg-brand/5' : 'border-gray-200 text-gray-700 bg-white hover:bg-gray-50'}`}
          >
            <DocumentIcon className="text-gray-400 shrink-0" />
            <span className="max-w-[180px] truncate">
              {selected ? (selected.periodLabel || 'Unnamed Period') : 'Select Report'}
            </span>
            {selected?.reportType === 'rocket_rez' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-semibold shrink-0">RR</span>
            )}
            <ChevronIcon expanded={showReportMenu} />
          </button>

          {showReportMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-30 overflow-hidden">
              <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  {uploads.length} Report{uploads.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => { setShowReportMenu(false); setShowUpload(true); }}
                  className="text-xs font-semibold text-brand hover:text-brand/80 flex items-center gap-1"
                >
                  <PlusIcon /> Upload
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {uploads.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">No reports uploaded yet</p>
                ) : uploads.map(u => (
                  <button
                    key={u.id}
                    onClick={() => loadBreakdown(u)}
                    className={`w-full text-left px-3 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors group
                      ${selected?.id === u.id ? 'bg-brand/5' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className={`text-xs font-semibold truncate ${selected?.id === u.id ? 'text-brand' : 'text-gray-800'}`}>
                            {u.periodLabel || 'Unnamed Period'}
                          </p>
                          {u.reportType === 'rocket_rez' && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-teal-100 text-teal-700 font-semibold shrink-0">RR</span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">{u.filename}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px] text-gray-400">{u.rowCount} items</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-[11px] font-semibold text-teal-700">{fmtCurrency(u.payrollTotal)} payroll</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-[11px] text-gray-400">{fmtDate(u.createdAt)}</span>
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(u.id); }}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all shrink-0 p-1"
                        title="Delete"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {breakdown && (
          <button onClick={exportCSV} className="btn-ghost text-xs gap-1.5 py-2">
            <DownloadIcon /> Export
          </button>
        )}

        <button onClick={() => setShowUpload(true)} className="btn-primary text-xs px-4 py-2 gap-1.5 shrink-0">
          <PlusIcon /> Upload Report
        </button>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      {!selected ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <TableIcon className="text-gray-200" />
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-500">No report selected</p>
            <p className="text-xs text-gray-400 mt-1">Upload a CSV report or select one from the dropdown above</p>
          </div>
          <button onClick={() => setShowUpload(true)} className="btn-primary text-xs px-4 py-2 gap-1.5 mt-1">
            <PlusIcon /> Upload Report
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

            {/* ── Stats ── */}
            {breakdown && uploadMeta && (
              <div className={`grid gap-4 ${isRocketRez ? 'grid-cols-4' : 'grid-cols-3'}`}>
                <StatCard label="Employees" value={breakdown.length} />
                <StatCard label="Transactions" value={selected.rowCount} />
                {isRocketRez ? (
                  <>
                    <StatCard
                      label="Payroll Deductions"
                      value={fmtCurrency(uploadMeta.payrollTotal)}
                      accent="teal"
                    />
                    <StatCard
                      label="Total Spent"
                      value={fmtCurrency(uploadMeta.totalAmount)}
                    />
                  </>
                ) : (
                  <StatCard
                    label="Total Deductions"
                    value={fmtCurrency(uploadMeta.totalAmount)}
                    accent="brand"
                  />
                )}
              </div>
            )}

            {/* ── Per-park payroll pills ── */}
            {isMultiPark && parkTotals && (
              <div className="flex flex-wrap gap-3">
                {Object.entries(parkTotals).sort().map(([code, total]) => (
                  <div key={code} className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 text-sm font-semibold ${
                    code === 'BB' ? 'bg-sky-50 border-sky-200 text-sky-700' :
                    code === 'GI' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                    'bg-gray-50 border-gray-200 text-gray-600'
                  }`}>
                    <span>{PARK_LABEL[code] || code}</span>
                    <span className="opacity-40">|</span>
                    <span>{fmtCurrency(total)}</span>
                    <span className="text-xs font-normal opacity-60">payroll</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── AI Analysis (collapsible) ── */}
            {aiAnalysis && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setAiExpanded(p => !p)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <SparkleIcon />
                  <span className="text-sm font-bold text-gray-800 flex-1">AI Analysis</span>
                  {highCount > 0 && (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-semibold">
                      {highCount} high
                    </span>
                  )}
                  {mediumCount > 0 && (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-semibold">
                      {mediumCount} medium
                    </span>
                  )}
                  {!highCount && !mediumCount && (
                    <span className="text-xs text-gray-400">
                      {aiAnalysis.anomalies?.length || 0} flag{aiAnalysis.anomalies?.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  <ChevronIcon expanded={aiExpanded} />
                </button>

                {aiExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-4 bg-gradient-to-b from-teal-50/30 to-white">
                    {aiAnalysis.summary && (
                      <p className="text-sm text-gray-600 leading-relaxed">{aiAnalysis.summary}</p>
                    )}
                    {aiAnalysis.payrollDeductionNote && (
                      <div className="flex items-start gap-3 p-3.5 bg-teal-50 rounded-xl">
                        <InfoIcon className="text-teal-600 mt-0.5 shrink-0" />
                        <p className="text-xs text-teal-800 leading-relaxed">{aiAnalysis.payrollDeductionNote}</p>
                      </div>
                    )}
                    {aiAnalysis.anomalies?.length > 0 && (
                      <div className="space-y-2">
                        {[...aiAnalysis.anomalies]
                          .sort((a, b) => ['high','medium','low'].indexOf(a.severity) - ['high','medium','low'].indexOf(b.severity))
                          .map((anomaly, i) => (
                            <div key={i} className={`flex items-start gap-3 p-3.5 rounded-xl border ${SEVERITY_COLORS[anomaly.severity] || SEVERITY_COLORS.low}`}>
                              <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${SEVERITY_DOT[anomaly.severity] || SEVERITY_DOT.low}`} />
                              <div className="min-w-0">
                                {anomaly.employee && (
                                  <p className="text-xs font-bold mb-0.5">{anomaly.employee}</p>
                                )}
                                <p className="text-xs leading-relaxed">{anomaly.description}</p>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Search + Filters ── */}
            {breakdown && (
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search employees…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <XSmallIcon />
                    </button>
                  )}
                </div>

                <select
                  value={filterMethod}
                  onChange={e => setFilterMethod(e.target.value)}
                  className="text-sm border border-gray-200 rounded-xl bg-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-gray-700"
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
                    className="text-sm border border-gray-200 rounded-xl bg-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-gray-700"
                  >
                    <option value="all">All Parks</option>
                    {availableParks.map(p => (
                      <option key={p} value={p}>{PARK_LABEL[p] || p}</option>
                    ))}
                  </select>
                )}

                {hasFilters && (
                  <button
                    onClick={() => { setSearch(''); setFilterMethod('all'); setFilterPark('all'); }}
                    className="text-sm px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {hasFilters && breakdown && (
              <p className="text-xs text-gray-400 -mt-2">
                Showing {filteredBreakdown.length} of {breakdown.length} employees
              </p>
            )}

            {/* ── Employee table ── */}
            {loading ? (
              <div className="flex items-center justify-center h-40 bg-white rounded-2xl border border-gray-200">
                <div className="w-6 h-6 border-2 border-brand/20 border-t-brand rounded-full animate-spin" />
              </div>
            ) : filteredBreakdown.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
                <p className="text-sm text-gray-500">
                  {breakdown?.length === 0 ? 'No deduction records found.' : 'No employees match your filters.'}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                {/* Table header — columns differ by report type */}
                {isRocketRez ? (
                  <div className="grid px-5 py-2.5 border-b border-gray-100 bg-gray-50/70" style={{ gridTemplateColumns: '1fr 120px 64px 110px 130px 40px' }}>
                    <SortHeader col="name"    label="Employee" active={sortCol} dir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader col="park"    label="Park"     active={sortCol} dir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader col="items"   label="Items"    active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader col="total"   label="Total"    active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader col="payroll" label="Payroll"  active={sortCol} dir={sortDir} onSort={handleSort} align="right" accent />
                    <div />
                  </div>
                ) : (
                  <div className="grid px-5 py-2.5 border-b border-gray-100 bg-gray-50/70" style={{ gridTemplateColumns: '1fr 80px 160px 40px' }}>
                    <SortHeader col="name"  label="Employee" active={sortCol} dir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader col="items" label="Items"    active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader col="total" label="Total"    active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                    <div />
                  </div>
                )}

                <div className="divide-y divide-gray-100">
                  {filteredBreakdown.map(b => {
                    const hasNonPayroll = isRocketRez && parseFloat(b.totalAmount) !== parseFloat(b.payrollTotal);
                    const isOpen = !!expanded[b.employeeName];
                    const gridStyle = isRocketRez
                      ? { gridTemplateColumns: '1fr 120px 64px 110px 130px 40px' }
                      : { gridTemplateColumns: '1fr 80px 160px 40px' };
                    return (
                      <div key={b.employeeName}>
                        {/* Employee row */}
                        <button
                          onClick={() => setExpanded(p => ({ ...p, [b.employeeName]: !p[b.employeeName] }))}
                          className="w-full grid px-5 py-4 hover:bg-gray-50 transition-colors text-left items-center"
                          style={gridStyle}
                        >
                          {/* Name + badges */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-xs font-bold text-brand shrink-0">
                              {b.employeeName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{b.employeeName}</p>
                              {b.crossParkCount > 0 && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 inline-block mt-0.5">
                                  ⚠ Cross-park
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Park (RR only) */}
                          {isRocketRez && (
                            <div>
                              {b.park ? (
                                <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${PARK_COLORS[b.park] || 'bg-gray-100 text-gray-600'}`}>
                                  {PARK_LABEL[b.park] || b.park}
                                </span>
                              ) : '—'}
                            </div>
                          )}

                          {/* Items */}
                          <div className="text-sm text-gray-500 text-right">
                            {b.transactionCount}
                          </div>

                          {/* Total spent (RR only) */}
                          {isRocketRez && (
                            <div className="text-sm text-right">
                              <span className={hasNonPayroll ? 'text-gray-400' : 'text-gray-700'}>
                                {fmtCurrency(b.totalAmount)}
                              </span>
                            </div>
                          )}

                          {/* Payroll / Total */}
                          <div className="text-right">
                            <span className={`text-sm font-bold ${isRocketRez ? 'text-teal-700' : 'text-gray-900'}`}>
                              {fmtCurrency(isRocketRez ? b.payrollTotal : b.totalAmount)}
                            </span>
                          </div>

                          {/* Expand arrow */}
                          <div className="flex justify-end">
                            <ChevronIcon expanded={isOpen} />
                          </div>
                        </button>

                        {/* Transaction detail */}
                        {isOpen && b.transactions?.length > 0 && (
                          <div className="border-t border-gray-100 bg-gray-50/60">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  <th className="px-5 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide w-28">Date</th>
                                  <th className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide">Item</th>
                                  {isRocketRez && <>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide w-28">Order #</th>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide w-24">Park</th>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide w-28">Method</th>
                                  </>}
                                  <th className="px-5 py-2.5 text-right font-semibold text-gray-400 uppercase tracking-wide w-24">Amount</th>
                                  {isRocketRez && <th className="px-3 py-2.5 w-10" />}
                                </tr>
                              </thead>
                              <tbody>
                                {b.transactions.map((t, i) => (
                                  <tr key={i} className={`border-b border-gray-100 last:border-0 ${t.crossPark ? 'bg-red-50/60' : 'hover:bg-white/70'}`}>
                                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{t.date ? fmtDate(t.date) : '—'}</td>
                                    <td className="px-3 py-3 text-gray-700 font-medium">{t.description || '—'}</td>
                                    {isRocketRez && <>
                                      <td className="px-3 py-3 text-gray-400 font-mono tracking-tight">{t.orderId || '—'}</td>
                                      <td className="px-3 py-3">
                                        <div className="flex items-center gap-1.5">
                                          {t.park ? (
                                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PARK_COLORS[t.park] || 'bg-gray-100 text-gray-600'}`}>
                                              {t.park}
                                            </span>
                                          ) : '—'}
                                          {t.crossPark && (
                                            <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600" title={`Home park: ${t.homePark}`}>⚠</span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-3 py-3">
                                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${METHOD_COLORS[t.paymentMethod] || METHOD_COLORS.other}`}>
                                          {METHOD_LABEL[t.paymentMethod] || t.paymentMethod}
                                        </span>
                                      </td>
                                    </>}
                                    <td className={`px-5 py-3 text-right font-semibold ${t.paymentMethod === 'comp' ? 'text-purple-600' : 'text-gray-900'}`}>
                                      {t.paymentMethod === 'comp' ? 'Comp' : fmtCurrency(t.amount)}
                                    </td>
                                    {isRocketRez && (
                                      <td className="px-3 py-3">
                                        <button
                                          onClick={() => setFootageTarget({ transaction: t, employeeName: b.employeeName })}
                                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-gray-600 hover:bg-gray-200 transition-colors"
                                          title="View camera footage"
                                        >
                                          <CameraIcon />
                                        </button>
                                      </td>
                                    )}
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
              </div>
            )}

          </div>
        </div>
      )}

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />
      )}
      {footageTarget && (
        <FootageModal
          transaction={footageTarget.transaction}
          employeeName={footageTarget.employeeName}
          onClose={() => setFootageTarget(null)}
        />
      )}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }) {
  const valueClass =
    accent === 'teal'  ? 'text-teal-700' :
    accent === 'brand' ? 'text-brand'    : 'text-gray-900';
  const borderClass =
    accent === 'teal'  ? 'border-teal-200' :
    accent === 'brand' ? 'border-brand/30' : 'border-gray-200';

  return (
    <div className={`bg-white rounded-2xl border ${borderClass} p-5`}>
      <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1.5 font-medium">{label}</p>
    </div>
  );
}

// ── Sort Header ───────────────────────────────────────────────────────────────

function SortHeader({ col, label, active, dir, onSort, align = 'left', accent = false }) {
  const isActive = active === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide select-none transition-colors
        ${align === 'right' ? 'justify-end' : ''}
        ${isActive
          ? accent ? 'text-teal-600' : 'text-gray-700'
          : accent ? 'text-teal-400 hover:text-teal-600' : 'text-gray-400 hover:text-gray-600'
        }`}
    >
      {align === 'right' && isActive && <SortArrow dir={dir} />}
      {label}
      {align !== 'right' && isActive && <SortArrow dir={dir} />}
      {!isActive && <SortArrow dir={null} />}
    </button>
  );
}

function SortArrow({ dir }) {
  if (!dir) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 opacity-30">
        <path d="M12 5v14M5 12l7-7 7 7"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
      {dir === 'asc'
        ? <path d="M5 15l7-7 7 7"/>
        : <path d="M19 9l-7 7-7-7"/>}
    </svg>
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

// ── Footage Modal ─────────────────────────────────────────────────────────────

function FootageModal({ transaction, employeeName, onClose }) {
  const backdropRef = useRef(null);
  const { date } = transaction;

  return (
    <div ref={backdropRef} onClick={e => e.target === backdropRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gray-900 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white flex items-center gap-2">
              <CameraIcon /> Camera Footage
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {employeeName} · {fmtDate(date)}
              {transaction.description && ` · ${transaction.description}`}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
            <CloseIcon />
          </button>
        </div>
        <div className="p-8 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
            <CameraIcon />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Camera Footage</p>
            <p className="text-xs font-semibold text-teal-600 mt-0.5">Coming Soon</p>
          </div>
          <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
            Direct footage playback from Unifi Protect will be available in an upcoming update.
          </p>
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
function DocumentIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-4 h-4 ${className}`}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
}
function TableIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-16 h-16 ${className}`}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>;
}
function DownloadIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}
function UploadIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-8 h-8 mx-auto ${className}`}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
}
function ChevronIcon({ expanded }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-gray-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6"/></svg>;
}
function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function AlertIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${className}`}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}
function SparkleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-teal-600 shrink-0"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>;
}
function InfoIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${className}`}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;
}
function SearchIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${className}`}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function XSmallIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block"/>;
}
function CameraIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
}
