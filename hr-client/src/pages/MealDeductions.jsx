import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import api from '../lib/api.js';

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtCurrency(val) {
  return '$' + parseFloat(val || 0).toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function dateStr(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function rangeLabel(startDate, endDate) {
  const s = new Date(startDate + 'T12:00:00');
  const e = new Date(endDate + 'T12:00:00');
  if (startDate === endDate) {
    return s.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  const sameYear = s.getFullYear() === e.getFullYear();
  const sStr = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const eStr = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${sStr} – ${eStr}`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const METHOD_LABEL = {
  payroll_deduction: 'Payroll',
  stripe:            'Card',
  cash:              'Cash',
  token:             'Token',
  comp:              'Comp',
  other:             'Other',
};

const METHOD_COLORS = {
  payroll_deduction: 'bg-teal-100 text-teal-700',
  stripe:            'bg-blue-100 text-blue-700',
  cash:              'bg-gray-100 text-gray-600',
  token:             'bg-amber-100 text-amber-700',
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

const PRESETS = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week',      label: 'Last 7 Days' },
  { id: 'biweek',    label: 'Last 14 Days' },
];

function presetRange(id) {
  const now = new Date();
  const today = dateStr(now);
  switch (id) {
    case 'yesterday': {
      const y = dateStr(new Date(now.getTime() - 86_400_000));
      return { startDate: y, endDate: y };
    }
    case 'week':   return { startDate: dateStr(new Date(now.getTime() - 6  * 86_400_000)), endDate: today };
    case 'biweek': return { startDate: dateStr(new Date(now.getTime() - 13 * 86_400_000)), endDate: today };
    case 'today':
    default:       return { startDate: today, endDate: today };
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MealDeductions() {
  const [startDate, setStartDate] = useState(() => presetRange('today').startDate);
  const [endDate,   setEndDate]   = useState(() => presetRange('today').endDate);
  const [preset,    setPreset]    = useState('today');

  const [data,    setData]    = useState(null); // { meta, breakdown, fetchedAt, startDate, endDate }
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const [activeView, setActiveView] = useState('employees');
  const [expanded,   setExpanded]   = useState({});
  const [footageTarget, setFootageTarget] = useState(null);
  const [showPDFModal,  setShowPDFModal]  = useState(false);

  // AI analysis (on demand)
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiError,    setAiError]    = useState(null);
  const [aiExpanded, setAiExpanded] = useState(true);

  // Search / filter / sort
  const [search,       setSearch]       = useState('');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterPark,   setFilterPark]   = useState('all');
  const [payrollOnly,  setPayrollOnly]  = useState(false);
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const load = useCallback(async (s, e) => {
    setLoading(true);
    setError(null);
    setExpanded({});
    setAiAnalysis(null);
    setAiError(null);
    try {
      const res = await api.get(`/hr/meal-deductions/live?startDate=${s}&endDate=${e}`);
      setData(res.data);
    } catch (err) {
      setData(null);
      setError(err.response?.data?.error || err.message || 'Sync failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load today's data on mount
  useEffect(() => { load(startDate, endDate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(id) {
    const r = presetRange(id);
    setPreset(id);
    setStartDate(r.startDate);
    setEndDate(r.endDate);
    load(r.startDate, r.endDate);
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  const breakdown = data?.breakdown || null;
  const meta      = data?.meta || null;

  const rangeDays = (new Date(endDate) - new Date(startDate)) / 86_400_000 + 1;
  const periodLabel = rangeLabel(startDate, endDate);

  async function runAnalysis() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api.post('/hr/meal-deductions/live/analyze', { startDate: data.startDate, endDate: data.endDate });
      setAiAnalysis(res.data.aiAnalysis || { summary: 'No anomalies detected.', anomalies: [] });
      setAiExpanded(true);
    } catch (err) {
      setAiError(err.response?.data?.error || 'Analysis failed');
    } finally {
      setAiLoading(false);
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
      if (payrollOnly && parseFloat(b.payrollTotal) <= 0) return false;
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
  }, [breakdown, search, filterMethod, filterPark, payrollOnly, sortCol, sortDir]);

  const hasFilters = search || filterMethod !== 'all' || filterPark !== 'all' || payrollOnly;

  const highCount   = aiAnalysis?.anomalies?.filter(a => a.severity === 'high').length   || 0;
  const mediumCount = aiAnalysis?.anomalies?.filter(a => a.severity === 'medium').length || 0;

  function exportCSV() {
    if (!filteredBreakdown.length) return;
    const rows = [['Employee Name', 'Park', 'Orders', 'Total Spent', 'Payroll Deduction']];
    filteredBreakdown.forEach(b => {
      rows.push([
        b.employeeName,
        (b.parks || []).join('+'),
        b.transactionCount,
        parseFloat(b.totalAmount).toFixed(2),
        parseFloat(b.payrollTotal).toFixed(2),
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meal-deductions-${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const syncedAt = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50">

      {/* ── Top bar: date range + actions ─────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-3 shrink-0">
        {/* Presets */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                ${preset === p.id ? 'bg-white text-brand shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom range */}
        <div className="flex items-center gap-2">
          <input
            type="date" value={startDate} max={endDate}
            onChange={e => { setStartDate(e.target.value); setPreset('custom'); }}
            className="field text-xs py-1.5 px-2.5 w-[132px]"
          />
          <span className="text-gray-300 text-xs">→</span>
          <input
            type="date" value={endDate} min={startDate}
            onChange={e => { setEndDate(e.target.value); setPreset('custom'); }}
            className="field text-xs py-1.5 px-2.5 w-[132px]"
          />
          <button
            onClick={() => load(startDate, endDate)}
            disabled={loading}
            className="btn-primary text-xs px-3.5 py-2 gap-1.5"
          >
            <SyncIcon spinning={loading} />
            {loading ? 'Syncing…' : 'Sync'}
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {syncedAt && !loading && (
            <span className="flex items-center gap-1.5 text-[11px] text-gray-400 mr-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live · synced {syncedAt}
            </span>
          )}
          {breakdown?.length > 0 && (
            <>
              <button onClick={exportCSV} className="btn-ghost text-xs gap-1.5 py-2">
                <DownloadIcon /> CSV
              </button>
              <button
                onClick={() => setShowPDFModal(true)}
                className="btn-ghost text-xs gap-1.5 py-2 text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300 hover:bg-rose-50"
              >
                <PDFIcon /> PDF Report
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Sub-nav ───────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 flex items-center shrink-0">
        {[
          { id: 'employees', label: 'Employees', Icon: UsersIcon },
          { id: 'calendar',  label: 'Calendar',  Icon: CalendarIcon },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors mr-1
              ${activeView === id
                ? 'border-brand text-brand'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            <Icon /> {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400 font-medium py-3">{periodLabel}</span>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      {error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <AlertIcon className="text-red-400 mx-auto mb-3 w-6 h-6" />
            <p className="text-sm font-semibold text-red-700 mb-1">Sync failed</p>
            <p className="text-xs text-red-500 mb-4">{error}</p>
            <button onClick={() => load(startDate, endDate)} className="btn-primary text-xs px-4 py-2">
              Try Again
            </button>
          </div>
        </div>
      ) : loading && !data ? (
        <SyncLoadingCard />
      ) : activeView === 'calendar' ? (
        <CalendarView breakdown={breakdown} loading={loading} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

            {loading && <SyncLoadingCard inline />}

            {/* ── Stats ── */}
            {!loading && meta && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-fade-up">
                <StatCard label="Employees" value={breakdown.length} />
                <StatCard label="Orders" value={meta.totalOrders} />
                <StatCard label="Payroll Deductions" value={fmtCurrency(meta.payrollTotal)} accent="teal" />
                <StatCard label="Total Spent" value={fmtCurrency(meta.totalAmount)} />
              </div>
            )}

            {/* ── Per-park payroll pills ── */}
            {!loading && isMultiPark && meta?.parkPayroll && Object.keys(meta.parkPayroll).length > 1 && (
              <div className="flex flex-wrap gap-3">
                {Object.entries(meta.parkPayroll).sort().map(([code, total]) => (
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

            {/* ── AI Analysis ── */}
            {!loading && breakdown?.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                {!aiAnalysis ? (
                  <div className="flex items-center gap-3 px-5 py-4">
                    <SparkleIcon />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-gray-800">AI Analysis</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {rangeDays > 31
                          ? 'Available for ranges up to 31 days'
                          : 'Scan this period for anomalies — over-purchasing, price inconsistencies, comps, cross-park activity'}
                      </p>
                    </div>
                    {aiError && <p className="text-xs text-red-500">{aiError}</p>}
                    <button
                      onClick={runAnalysis}
                      disabled={aiLoading || rangeDays > 31}
                      className="btn-primary text-xs px-4 py-2 gap-1.5"
                    >
                      {aiLoading ? <><Spinner /> Analyzing…</> : 'Run Analysis'}
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setAiExpanded(p => !p)}
                      className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                    >
                      <SparkleIcon />
                      <span className="text-sm font-bold text-gray-800 flex-1">AI Analysis</span>
                      {highCount > 0 && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-semibold">{highCount} high</span>
                      )}
                      {mediumCount > 0 && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-semibold">{mediumCount} medium</span>
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
                                    {anomaly.employee && <p className="text-xs font-bold mb-0.5">{anomaly.employee}</p>}
                                    <p className="text-xs leading-relaxed">{anomaly.description}</p>
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Search + Filters ── */}
            {!loading && breakdown?.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
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
                  <option value="stripe">Card</option>
                  <option value="cash">Cash</option>
                  <option value="token">Token</option>
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

                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={payrollOnly}
                    onChange={e => setPayrollOnly(e.target.checked)}
                    className="rounded border-gray-300 text-brand focus:ring-brand"
                  />
                  Payroll only
                </label>

                {hasFilters && (
                  <button
                    onClick={() => { setSearch(''); setFilterMethod('all'); setFilterPark('all'); setPayrollOnly(false); }}
                    className="text-sm px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {hasFilters && breakdown?.length > 0 && (
              <p className="text-xs text-gray-400 -mt-2">
                Showing {filteredBreakdown.length} of {breakdown.length} employees
              </p>
            )}

            {/* ── Employee table ── */}
            {!loading && breakdown && (
              breakdown.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
                  <p className="text-sm font-semibold text-gray-500 mb-1">No crew orders in this range</p>
                  <p className="text-xs text-gray-400">Try a different date range — crew meal orders will appear here as they happen</p>
                </div>
              ) : filteredBreakdown.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
                  <p className="text-sm text-gray-500">No employees match your filters.</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="grid px-5 py-2.5 border-b border-gray-100 bg-gray-50/70" style={{ gridTemplateColumns: '1fr 120px 64px 110px 130px 40px' }}>
                    <SortHeader col="name"    label="Employee" active={sortCol} dir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader col="park"    label="Park"     active={sortCol} dir={sortDir} onSort={handleSort} align="left" />
                    <SortHeader col="items"   label="Orders"   active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader col="total"   label="Total"    active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader col="payroll" label="Payroll"  active={sortCol} dir={sortDir} onSort={handleSort} align="right" accent />
                    <div />
                  </div>

                  <div className="divide-y divide-gray-100">
                    {filteredBreakdown.map(b => {
                      const hasNonPayroll = parseFloat(b.totalAmount) !== parseFloat(b.payrollTotal);
                      const isOpen = !!expanded[b.employeeName];
                      return (
                        <div key={b.employeeName}>
                          <button
                            onClick={() => setExpanded(p => ({ ...p, [b.employeeName]: !p[b.employeeName] }))}
                            className="w-full grid px-5 py-4 hover:bg-gray-50 transition-colors text-left items-center"
                            style={{ gridTemplateColumns: '1fr 120px 64px 110px 130px 40px' }}
                          >
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

                            <div>
                              {b.park ? (
                                <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${PARK_COLORS[b.park] || 'bg-gray-100 text-gray-600'}`}>
                                  {PARK_LABEL[b.park] || b.park}
                                </span>
                              ) : '—'}
                            </div>

                            <div className="text-sm text-gray-500 text-right">{b.transactionCount}</div>

                            <div className="text-sm text-right">
                              <span className={hasNonPayroll ? 'text-gray-400' : 'text-gray-700'}>
                                {fmtCurrency(b.totalAmount)}
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="text-sm font-bold text-teal-700">{fmtCurrency(b.payrollTotal)}</span>
                            </div>

                            <div className="flex justify-end">
                              <ChevronIcon expanded={isOpen} />
                            </div>
                          </button>

                          {/* Order detail */}
                          {isOpen && b.transactions?.length > 0 && (
                            <div className="border-t border-gray-100 bg-gray-50/60">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-200">
                                    <th className="px-5 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide w-36">Date</th>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide">Items</th>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide w-24">Order #</th>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide w-20">Park</th>
                                    <th className="px-3 py-2.5 text-left font-semibold text-gray-400 uppercase tracking-wide w-24">Method</th>
                                    <th className="px-5 py-2.5 text-right font-semibold text-gray-400 uppercase tracking-wide w-24">Amount</th>
                                    <th className="px-3 py-2.5 w-10" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {b.transactions.map((t, i) => (
                                    <tr key={i} className={`border-b border-gray-100 last:border-0 ${t.crossPark ? 'bg-red-50/60' : 'hover:bg-white/70'}`}>
                                      <td className="px-5 py-3 whitespace-nowrap">
                                        <p className="text-gray-600">{fmtDate(t.date)}{fmtTime(t.date) ? ` · ${fmtTime(t.date)}` : ''}</p>
                                        {t.cashier && <p className="text-[10px] text-gray-400 mt-0.5">by {t.cashier}</p>}
                                      </td>
                                      <td className="px-3 py-3 text-gray-700">
                                        {t.items?.length > 0
                                          ? t.items.map((item, ii) => (
                                              <span key={ii}>
                                                {item.name}
                                                {item.amount > 0 && <span className="text-gray-400"> ({fmtCurrency(item.amount)})</span>}
                                                {ii < t.items.length - 1 ? ', ' : ''}
                                              </span>
                                            ))
                                          : <span className="text-gray-400 italic">No items recorded</span>}
                                      </td>
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
                                      <td className={`px-5 py-3 text-right font-semibold ${t.paymentMethod === 'comp' ? 'text-purple-600' : 'text-gray-900'}`}>
                                        {t.paymentMethod === 'comp' ? 'Comp' : fmtCurrency(t.amount)}
                                      </td>
                                      <td className="px-3 py-3">
                                        <button
                                          onClick={() => setFootageTarget({ transaction: t, employeeName: b.employeeName, park: t.park || b.homePark })}
                                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-gray-600 hover:bg-gray-200 transition-colors"
                                          title="View camera footage"
                                        >
                                          <CameraIcon />
                                        </button>
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
                </div>
              )
            )}

          </div>
        </div>
      )}

      {showPDFModal && breakdown && meta && (
        <PDFExportModal
          breakdown={breakdown}
          meta={meta}
          period={{ label: periodLabel, transactionCount: meta.totalOrders }}
          onClose={() => setShowPDFModal(false)}
        />
      )}
      {footageTarget && (
        <FootageModal
          transaction={footageTarget.transaction}
          employeeName={footageTarget.employeeName}
          park={footageTarget.park}
          onClose={() => setFootageTarget(null)}
        />
      )}
    </div>
  );
}

// ── Sync loading card ─────────────────────────────────────────────────────────

function SyncLoadingCard({ inline }) {
  const body = (
    <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center animate-fade-up">
      <SyncIcon spinning className="w-6 h-6 text-brand mx-auto mb-3" />
      <p className="text-sm text-gray-500">Fetching crew orders from RocketRez…</p>
      <p className="text-xs text-gray-400 mt-1">Paginating through all records, this may take a few seconds</p>
    </div>
  );
  if (inline) return body;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6">{body}</div>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }) {
  const valueClass  = accent === 'teal' ? 'text-teal-700'   : 'text-gray-900';
  const borderClass = accent === 'teal' ? 'border-teal-200' : 'border-gray-200';
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
      {dir === 'asc' ? <path d="M5 15l7-7 7 7"/> : <path d="M19 9l-7 7-7-7"/>}
    </svg>
  );
}

// ── Calendar View ─────────────────────────────────────────────────────────────

function CalendarView({ breakdown, loading }) {
  const allTransactions = useMemo(() => {
    if (!breakdown) return [];
    return breakdown.flatMap(b =>
      b.transactions.map(t => ({ ...t, employeeName: b.employeeName }))
    );
  }, [breakdown]);

  const byDate = useMemo(() => {
    const map = {};
    for (const t of allTransactions) {
      if (!t.date) continue;
      const day = t.date.slice(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(t);
    }
    for (const day of Object.keys(map)) {
      map[day].sort((a, b) => new Date(a.date) - new Date(b.date));
    }
    return map;
  }, [allTransactions]);

  const defaultMonth = useMemo(() => {
    const keys = Object.keys(byDate).sort();
    if (!keys.length) return new Date();
    const [y, m] = keys[0].split('-').map(Number);
    return new Date(y, m - 1, 1);
  }, [byDate]);

  const [calMonth, setCalMonth] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);

  const base = calMonth || defaultMonth;
  const year = base.getFullYear();
  const month = base.getMonth();

  const calDays = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const days = Array(first).fill(null);
    for (let d = 1; d <= total; d++) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [year, month]);

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const dayKey = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayKey = new Date().toISOString().slice(0, 10);

  const selectedTxns = selectedDay ? (byDate[selectedDay] || []) : [];
  const hasTime = selectedTxns.some(t => fmtTime(t.date));

  const totalForDay = selectedTxns.reduce((s, t) => s + (t.paymentMethod !== 'comp' ? parseFloat(t.amount || 0) : 0), 0);
  const payrollForDay = selectedTxns.reduce((s, t) => s + parseFloat(t.payroll || 0), 0);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-brand/20 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  if (!breakdown) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        Sync a date range to view the calendar
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">

      {/* ── Left: Calendar ── */}
      <div className="w-96 shrink-0 flex flex-col border-r border-gray-200 bg-white overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <button
            onClick={() => { setCalMonth(new Date(year, month - 1, 1)); setSelectedDay(null); }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="text-sm font-bold text-gray-800">{monthLabel}</span>
          <button
            onClick={() => { setCalMonth(new Date(year, month + 1, 1)); setSelectedDay(null); }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        <div className="grid grid-cols-7 px-3 pt-3 pb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wide py-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-1 px-3 pb-4">
          {calDays.map((d, i) => {
            if (!d) return <div key={`e${i}`} />;
            const key = dayKey(d);
            const txns = byDate[key] || [];
            const count = txns.length;
            const isSelected = selectedDay === key;
            const isToday = key === todayKey;
            const parks = [...new Set(txns.map(t => t.park).filter(Boolean))];
            return (
              <button
                key={key}
                onClick={() => setSelectedDay(isSelected ? null : key)}
                className={`flex flex-col items-center py-1.5 px-1 rounded-xl transition-colors relative
                  ${isSelected ? 'bg-brand text-white' : count > 0 ? 'hover:bg-brand/5 text-gray-800' : 'text-gray-300 cursor-default'}`}
                disabled={count === 0}
              >
                <span className={`text-xs font-semibold ${isToday && !isSelected ? 'text-brand' : ''}`}>{d}</span>
                {count > 0 && (
                  <span className={`text-[9px] font-bold mt-0.5 ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                    {count}
                  </span>
                )}
                {count > 0 && !isSelected && (
                  <div className="flex gap-0.5 mt-0.5">
                    {parks.slice(0, 2).map(p => (
                      <span key={p} className={`w-1.5 h-1.5 rounded-full ${p === 'BB' ? 'bg-sky-400' : p === 'GI' ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-auto px-5 py-4 border-t border-gray-100 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Legend</p>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="w-2 h-2 rounded-full bg-sky-400" /> Blue Bayou
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Gulf Islands
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="text-[9px] font-bold text-gray-500">12</span> Order count
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Day detail ── */}
      <div className="flex-1 min-w-0 bg-gray-50 overflow-y-auto">
        {!selectedDay ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <CalendarIcon className="w-12 h-12 text-gray-200" />
            <p className="text-sm font-semibold text-gray-400">Select a day to view orders</p>
            <p className="text-xs text-gray-400">Days with orders are shown with a count and park color dots</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">{selectedTxns.length} order{selectedTxns.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex gap-3 text-right">
                <div>
                  <p className="text-xs text-gray-500">Payroll</p>
                  <p className="text-sm font-bold text-teal-700">{fmtCurrency(payrollForDay)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-sm font-bold text-gray-800">{fmtCurrency(totalForDay)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/70">
                    {hasTime && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Time</th>}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Employee</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Items</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Park</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Method</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTxns.map((t, i) => {
                    const time = fmtTime(t.date);
                    return (
                      <tr key={i} className={`border-b border-gray-100 last:border-0 ${t.crossPark ? 'bg-red-50/60' : 'hover:bg-gray-50/50'}`}>
                        {hasTime && (
                          <td className="px-4 py-3 text-xs text-gray-400 font-mono whitespace-nowrap">{time || '—'}</td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-[10px] font-bold text-brand shrink-0">
                              {t.employeeName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-gray-800 truncate">{t.employeeName}</span>
                            {t.crossPark && (
                              <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600 shrink-0" title={`Home: ${t.homePark}`}>⚠</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{t.description || '—'}</td>
                        <td className="px-4 py-3">
                          {t.park ? (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PARK_COLORS[t.park] || 'bg-gray-100 text-gray-600'}`}>
                              {t.park}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${METHOD_COLORS[t.paymentMethod] || METHOD_COLORS.other}`}>
                            {METHOD_LABEL[t.paymentMethod] || t.paymentMethod}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${t.paymentMethod === 'comp' ? 'text-purple-600' : 'text-gray-900'}`}>
                          {t.paymentMethod === 'comp' ? 'Comp' : fmtCurrency(t.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PDF Export Modal ──────────────────────────────────────────────────────────

const PDF_SORT_OPTIONS = [
  { value: 'name-asc',     label: 'Employee Name (A → Z)' },
  { value: 'name-desc',    label: 'Employee Name (Z → A)' },
  { value: 'park-asc',     label: 'Park (BB first)' },
  { value: 'park-desc',    label: 'Park (GI first)' },
  { value: 'payroll-desc', label: 'Payroll Deduction (High → Low)' },
  { value: 'payroll-asc',  label: 'Payroll Deduction (Low → High)' },
  { value: 'total-desc',   label: 'Total Spent (High → Low)' },
  { value: 'total-asc',    label: 'Total Spent (Low → High)' },
  { value: 'items-desc',   label: 'Orders (Most → Least)' },
  { value: 'items-asc',    label: 'Orders (Least → Most)' },
];

function sortBreakdown(breakdown, sortKey) {
  const [col, dir] = sortKey.split('-');
  const d = dir === 'asc' ? 1 : -1;
  return [...breakdown].sort((a, b) => {
    switch (col) {
      case 'name':    return d * a.employeeName.localeCompare(b.employeeName);
      case 'park':    return d * (a.park || 'ZZ').localeCompare(b.park || 'ZZ');
      case 'payroll': return d * (parseFloat(a.payrollTotal || 0) - parseFloat(b.payrollTotal || 0));
      case 'total':   return d * (parseFloat(a.totalAmount) - parseFloat(b.totalAmount));
      case 'items':   return d * (a.transactionCount - b.transactionCount);
      default:        return 0;
    }
  });
}

function PDFExportModal({ breakdown, meta, period, onClose }) {
  const backdropRef = useRef(null);
  const [sortKey,    setSortKey]    = useState('name-asc');
  const [groupPark,  setGroupPark]  = useState(false);
  const [payrollOnly, setPayrollOnly] = useState(false);
  const [simpleView, setSimpleView] = useState(false);
  const [generating, setGenerating] = useState(false);

  const availableParks = useMemo(() => {
    const s = new Set();
    breakdown.forEach(b => (b.parks || []).forEach(p => s.add(p)));
    return [...s].sort();
  }, [breakdown]);

  const isMultiPark = availableParks.length > 1;

  function generate() {
    setGenerating(true);
    try {
      let rows = payrollOnly
        ? breakdown.filter(b => parseFloat(b.payrollTotal || 0) > 0)
        : breakdown;

      rows = sortBreakdown(rows, groupPark && isMultiPark ? 'park-asc' : sortKey);

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const W = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      // Header bar
      doc.setFillColor(13, 148, 136);
      doc.rect(0, 0, W, 22, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('Blue Bayou Waterpark', 14, 10);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('Payroll Deduction Report', 14, 16);

      const generatedStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      doc.setFontSize(8);
      doc.text(`Generated ${generatedStr}`, W - 14, 16, { align: 'right' });

      // Period + meta
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(period.label, 14, 32);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      const metaParts = [
        `${rows.length} employee${rows.length !== 1 ? 's' : ''}`,
        `${period.transactionCount} orders`,
        'Live RocketRez data',
        ...(payrollOnly ? ['Payroll deductions only'] : []),
      ];
      doc.text(metaParts.join('  ·  '), 14, 38);

      // Summary stat boxes
      const totalPayroll = rows.reduce((s, b) => s + parseFloat(b.payrollTotal || 0), 0);
      const totalSpent   = rows.reduce((s, b) => s + parseFloat(b.totalAmount   || 0), 0);

      const boxes = [
        { label: 'Total Employees', value: String(rows.length) },
        { label: 'Payroll Deductions', value: '$' + totalPayroll.toFixed(2), accent: true },
        { label: 'Total Spent', value: '$' + totalSpent.toFixed(2) },
      ];

      const boxW = (W - 28 - (boxes.length - 1) * 4) / boxes.length;
      boxes.forEach((box, i) => {
        const x = 14 + i * (boxW + 4);
        doc.setFillColor(...(box.accent ? [240, 253, 250] : [248, 248, 248]));
        doc.setDrawColor(...(box.accent ? [153, 246, 228] : [229, 229, 229]));
        doc.roundedRect(x, 43, boxW, 16, 2, 2, 'FD');
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...(box.accent ? [15, 118, 110] : [30, 30, 30]));
        doc.text(box.value, x + boxW / 2, 52, { align: 'center' });
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(120, 120, 120);
        doc.text(box.label, x + boxW / 2, 57, { align: 'center' });
      });

      // Per-park payroll pills
      let yAfterSummary = 65;
      const parkEntries = Object.entries(meta.parkPayroll || {}).sort();
      if (parkEntries.length > 1) {
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 80, 80);
        doc.text('Park Breakdown:', 14, 63);
        let px = 14;
        parkEntries.forEach(([code, total]) => {
          const label = `${PARK_LABEL[code] || code}: $${parseFloat(total).toFixed(2)} payroll`;
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          const tw = doc.getTextWidth(label) + 6;
          const isBB = code === 'BB';
          doc.setFillColor(...(isBB ? [224, 242, 254] : [209, 250, 240]));
          doc.setDrawColor(...(isBB ? [186, 230, 253] : [110, 231, 197]));
          doc.roundedRect(px, 65, tw, 7, 1.5, 1.5, 'FD');
          doc.setTextColor(...(isBB ? [3, 105, 161] : [6, 95, 70]));
          doc.text(label, px + 3, 70);
          px += tw + 3;
        });
        yAfterSummary = 76;
      }

      // Table
      const PARK_NAME = { BB: 'Blue Bayou', GI: 'Gulf Islands', MULTI: 'Multi-Park' };

      function buildTableRows(data) {
        if (simpleView) {
          return data.map(b => [
            b.employeeName,
            PARK_NAME[b.park] || b.park || '—',
            '$' + parseFloat(b.payrollTotal || 0).toFixed(2),
          ]);
        }
        return data.map(b => [
          b.employeeName,
          PARK_NAME[b.park] || b.park || '—',
          b.crossParkCount > 0 ? '⚠ Yes' : 'No',
          String(b.transactionCount),
          '$' + parseFloat(b.totalAmount).toFixed(2),
          '$' + parseFloat(b.payrollTotal || 0).toFixed(2),
        ]);
      }

      const head = simpleView
        ? [['Employee', 'Park', 'Payroll Deduction']]
        : [['Employee', 'Park', 'Cross-Park', 'Orders', 'Total Spent', 'Payroll Deduction']];

      const colStyles = simpleView
        ? {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 45 },
            2: { cellWidth: 45, halign: 'right', fontStyle: 'bold', textColor: [15, 118, 110] },
          }
        : {
            0: { cellWidth: 52 },
            1: { cellWidth: 32 },
            2: { cellWidth: 22, halign: 'center' },
            3: { cellWidth: 14, halign: 'right' },
            4: { cellWidth: 28, halign: 'right' },
            5: { cellWidth: 32, halign: 'right', fontStyle: 'bold', textColor: [15, 118, 110] },
          };

      if (groupPark && isMultiPark) {
        const byPark = {};
        for (const b of rows) {
          const pk = b.park || 'Other';
          if (!byPark[pk]) byPark[pk] = [];
          byPark[pk].push(b);
        }

        let currentY = yAfterSummary;
        const parkKeys = Object.keys(byPark).sort();

        parkKeys.forEach((pk, pi) => {
          const groupRows = sortBreakdown(byPark[pk], sortKey);
          const groupPayroll = groupRows.reduce((s, b) => s + parseFloat(b.payrollTotal || 0), 0);

          autoTable(doc, {
            startY: currentY,
            head: [[{
              content: `${PARK_NAME[pk] || pk}  ·  ${groupRows.length} employee${groupRows.length !== 1 ? 's' : ''}  ·  $${groupPayroll.toFixed(2)} payroll`,
              colSpan: head[0].length,
              styles: {
                fillColor: pk === 'BB' ? [224, 242, 254] : [209, 250, 229],
                textColor: pk === 'BB' ? [3, 105, 161] : [6, 95, 70],
                fontStyle: 'bold',
                fontSize: 8,
              },
            }], ...head],
            body: buildTableRows(groupRows),
            columnStyles: colStyles,
            headStyles: { fillColor: [240, 240, 240], textColor: [80, 80, 80], fontSize: 7.5, fontStyle: 'bold' },
            bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
            alternateRowStyles: { fillColor: [250, 250, 250] },
            margin: { left: 14, right: 14 },
            didParseCell: (data) => {
              if (data.section === 'body') {
                const row = groupRows[data.row.index];
                if (row?.crossParkCount > 0) data.cell.styles.textColor = [185, 28, 28];
              }
            },
          });

          currentY = doc.lastAutoTable.finalY + (pi < parkKeys.length - 1 ? 6 : 0);
        });
      } else {
        autoTable(doc, {
          startY: yAfterSummary,
          head,
          body: buildTableRows(rows),
          columnStyles: colStyles,
          headStyles: { fillColor: [13, 148, 136], textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
          alternateRowStyles: { fillColor: [248, 252, 252] },
          margin: { left: 14, right: 14 },
          didParseCell: (data) => {
            if (data.section === 'body') {
              const row = rows[data.row.index];
              if (row?.crossParkCount > 0) data.cell.styles.textColor = [185, 28, 28];
            }
          },
        });
      }

      // Footer on every page
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(160, 160, 160);
        doc.text('Blue Bayou Waterpark — Confidential', 14, pageH - 8);
        doc.text(`Page ${i} of ${pageCount}`, W - 14, pageH - 8, { align: 'right' });
      }

      const filename = `payroll-deductions-${period.label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;
      doc.save(filename);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div ref={backdropRef} onClick={e => e.target === backdropRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-rose-600 px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Export PDF Report</h2>
            <p className="text-xs text-white/70 mt-0.5">{period.label}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors">
            <CloseIcon />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* View mode toggle */}
          <div>
            <label className="label">Report Style</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: false, title: 'Full View',   desc: 'All columns including orders, totals, cross-park flags' },
                { id: true,  title: 'Simple View', desc: 'Employee name, park, and payroll deduction only' },
              ].map(opt => (
                <button
                  key={String(opt.id)}
                  onClick={() => { setSimpleView(opt.id); if (opt.id) setPayrollOnly(true); }}
                  className={`text-left p-3 rounded-xl border-2 transition-colors
                    ${simpleView === opt.id
                      ? 'border-rose-500 bg-rose-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                >
                  <p className={`text-xs font-bold ${simpleView === opt.id ? 'text-rose-700' : 'text-gray-700'}`}>{opt.title}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Sort by */}
          <div>
            <label className="label">Sort Employees By</label>
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="field text-sm">
              {PDF_SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Group by park */}
          {isMultiPark && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={groupPark}
                onChange={e => setGroupPark(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand"
              />
              <div>
                <p className="text-sm font-medium text-gray-800">Group by park</p>
                <p className="text-xs text-gray-500 mt-0.5">Creates a separate section for each park with its own subtotal</p>
              </div>
            </label>
          )}

          {/* Payroll only */}
          <label className={`flex items-start gap-3 ${simpleView ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={payrollOnly}
              disabled={simpleView}
              onChange={e => setPayrollOnly(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand disabled:cursor-not-allowed"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">
                Payroll deductions only
                {simpleView && <span className="ml-2 text-xs font-normal text-rose-600">(required for Simple View)</span>}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Exclude employees with no payroll deduction</p>
            </div>
          </label>

          <button
            onClick={generate}
            disabled={generating}
            className="w-full py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {generating ? <><Spinner /> Generating…</> : <><PDFIcon /> Download PDF</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Footage Modal ─────────────────────────────────────────────────────────────

function FootageModal({ transaction, employeeName, park, onClose }) {
  const backdropRef = useRef(null);
  const { date, description } = transaction;

  const [cameras,       setCameras]       = useState([]);
  const [configuredCams, setConfiguredCams] = useState({});
  const [selectedCam,   setSelectedCam]   = useState('');
  const [loadingCams,   setLoadingCams]   = useState(true);
  const [camError,      setCamError]      = useState(null);
  const [windowMin,     setWindowMin]     = useState(5);
  const [loading,       setLoading]       = useState(false);
  const [videoUrl,      setVideoUrl]      = useState(null);
  const [videoReady,    setVideoReady]    = useState(false);
  const [footageError,  setFootageError]  = useState(null);

  const txMs   = date ? new Date(date).getTime() : null;
  const hasTime = !!fmtTime(date);

  useEffect(() => {
    api.get('/hr/protect/cameras')
      .then(r => {
        const cams = r.data.cameras || [];
        const configured = r.data.configuredCameras || {};
        setCameras(cams);
        setConfiguredCams(configured);
        const parkCams = configured[park] || [];
        if (parkCams.length === 1) setSelectedCam(parkCams[0]);
        else if (parkCams.length === 0 && cams.length === 1) setSelectedCam(cams[0].id);
      })
      .catch(err => setCamError(err.response?.data?.error || err.message || 'Cannot reach camera system'))
      .finally(() => setLoadingCams(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const parkCamIds     = configuredCams[park] || [];
  const displayCameras = parkCamIds.length > 0
    ? cameras.filter(c => parkCamIds.includes(c.id))
    : cameras;

  async function loadFootage() {
    if (!selectedCam || !txMs) return;
    setFootageError(null);
    setVideoUrl(null);
    setVideoReady(false);
    setLoading(true);
    try {
      const startMs = txMs - windowMin * 60 * 1000;
      const endMs   = txMs + windowMin * 60 * 1000;
      const r = await api.post('/hr/protect/footage-token', { cameraId: selectedCam, startMs, endMs });
      setVideoUrl(`/api/hr/protect/footage-stream?token=${r.data.token}`);
    } catch (err) {
      setFootageError(err.response?.data?.error || 'Failed to load footage');
    } finally {
      setLoading(false);
    }
  }

  const startTime = txMs ? new Date(txMs - windowMin * 60 * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  const endTime   = txMs ? new Date(txMs + windowMin * 60 * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <div ref={backdropRef} onClick={e => e.target === backdropRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className={`w-full ${videoUrl || loading ? 'max-w-2xl' : 'max-w-md'} bg-white rounded-2xl shadow-2xl overflow-hidden transition-all`}>
        {/* Header */}
        <div className="bg-gray-900 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white flex items-center gap-2">
              <CameraIcon /> Camera Footage
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {employeeName} · {fmtDate(date)}
              {hasTime && ` · ${fmtTime(date)}`}
              {description && ` · ${description}`}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
            <CloseIcon />
          </button>
        </div>

        {/* Loading state — covers both the token fetch and the video buffering,
            so the browser's native grey spinner never shows */}
        {(loading || (videoUrl && !videoReady)) && (
          <FootageLoader
            cameraName={displayCameras.find(c => c.id === selectedCam)?.name}
            startTime={startTime}
            endTime={endTime}
          />
        )}

        {/* Video player — mounted (hidden) while buffering so it can load,
            revealed once it's actually playable */}
        {videoUrl && (
          <div className={`bg-black ${videoReady ? '' : 'hidden'}`}>
            <video
              key={videoUrl}
              controls
              autoPlay
              className="w-full max-h-72"
              onCanPlay={() => setVideoReady(true)}
              onError={() => {
                setVideoUrl(null);
                setVideoReady(false);
                setFootageError('Could not play footage for this time range — try a different window or camera.');
              }}
            >
              <source src={videoUrl} type="video/mp4" />
            </video>
          </div>
        )}

        <div className="p-5 space-y-4">
          {!hasTime && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertIcon className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">No purchase time was recorded for this transaction — the time window below is centered on midnight.</p>
            </div>
          )}

          {/* Camera selector */}
          <div>
            <label className="label">Camera</label>
            {loadingCams ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                <Spinner /> Loading cameras…
              </div>
            ) : camError ? (
              <p className="text-xs text-red-500 bg-red-50 rounded-lg p-2">{camError}</p>
            ) : displayCameras.length === 0 ? (
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">No cameras found on the NVR.</p>
            ) : (
              <select value={selectedCam} onChange={e => setSelectedCam(e.target.value)} className="field text-sm">
                <option value="">Select a camera…</option>
                {displayCameras.map(c => (
                  <option key={c.id} value={c.id} disabled={c.state !== 'CONNECTED'}>
                    {c.name}{c.state !== 'CONNECTED' ? ' (offline)' : ''}
                  </option>
                ))}
              </select>
            )}
            {!loadingCams && !camError && parkCamIds.length === 0 && cameras.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">Tip: set <code>PROTECT_BB_CAMERA_IDS</code> / <code>PROTECT_GI_CAMERA_IDS</code> in .env to pre-filter by park.</p>
            )}
          </div>

          {/* Time window */}
          <div>
            <label className="label">Time Window Around Purchase</label>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 15, 30].map(m => (
                <button key={m} onClick={() => setWindowMin(m)}
                  className={`py-2 rounded-lg text-xs font-semibold border transition-colors
                    ${windowMin === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
                >
                  ±{m} min
                </button>
              ))}
            </div>
            {startTime && (
              <p className="text-xs text-gray-400 mt-1.5">{startTime} – {endTime}</p>
            )}
          </div>

          {footageError && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg p-2">{footageError}</p>
          )}

          <button
            onClick={loadFootage}
            disabled={!selectedCam || loading || !txMs}
            className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-40 hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <><Spinner /> Loading footage…</> : videoUrl ? 'Reload Footage' : 'Load Footage'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Footage loader (Blue Bayou water theme) ───────────────────────────────────

const FOOTAGE_PHRASES = [
  'Diving into the archives…',
  'Rewinding the bayou…',
  'Reeling in your footage…',
  'Surfacing any second…',
];

function FootageLoader({ cameraName, startTime, endTime }) {
  const [phrase, setPhrase] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhrase(p => (p + 1) % FOOTAGE_PHRASES.length), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative overflow-hidden"
      style={{ background: 'linear-gradient(165deg, #021f1e 0%, #073d38 45%, #0d5c55 100%)' }}>

      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.14) 0%, transparent 70%)' }} />

      <div className="relative flex flex-col items-center pt-10 pb-20 px-6">
        <div className="relative w-20 h-20 flex items-center justify-center mb-5 bb-bob">
          <span className="absolute inset-0 rounded-full border border-teal-400/50 bb-ripple" />
          <span className="absolute inset-0 rounded-full border border-teal-400/40 bb-ripple" style={{ animationDelay: '0.95s' }} />
          <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(13,148,136,0.25)', boxShadow: 'inset 0 0 0 1px rgba(45,212,191,0.4), 0 8px 24px rgba(0,0,0,0.35)' }}>
            <FilmIcon />
          </div>
        </div>

        <p key={phrase} className="text-sm font-semibold text-teal-50 animate-fade-up">
          {FOOTAGE_PHRASES[phrase]}
        </p>
        <p className="text-xs text-teal-200/50 mt-1.5">
          {cameraName || 'Camera'}{startTime ? ` · ${startTime} – ${endTime}` : ''}
        </p>

        <div className="relative w-52 h-1 rounded-full bg-white/10 overflow-hidden mt-5">
          <span className="absolute inset-y-0 w-1/3 rounded-full bb-shimmer"
            style={{ background: 'linear-gradient(90deg, transparent, #2dd4bf, transparent)' }} />
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-14 pointer-events-none">
        <Wave fill="rgba(20,184,166,0.12)" duration={13} height="100%" />
        <Wave fill="rgba(20,184,166,0.20)" duration={9}  height="80%" />
        <Wave fill="rgba(13,148,136,0.38)" duration={6}  height="62%" />
      </div>
    </div>
  );
}

// One tiling wave layer — the path repeats every 400 units across a 2400-unit
// viewBox, so translateX(-50%) (3 periods) loops seamlessly
function Wave({ fill, duration, height }) {
  return (
    <svg
      className="absolute bottom-0 left-0"
      style={{ width: '200%', height, animation: `bb-wave-slide ${duration}s linear infinite` }}
      viewBox="0 0 2400 80" preserveAspectRatio="none" fill={fill}
    >
      <path d="M0,40 c100,18 300,-18 400,0 c100,18 300,-18 400,0 c100,18 300,-18 400,0 c100,18 300,-18 400,0 c100,18 300,-18 400,0 c100,18 300,-18 400,0 L2400,80 L0,80 Z" />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 26, height: 26 }}>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function DownloadIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
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
function PDFIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
}
function UsersIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function CalendarIcon({ className = '' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${className}`}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
function SyncIcon({ spinning, className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className={`w-4 h-4 shrink-0 ${spinning ? 'animate-spin' : ''} ${className}`}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
