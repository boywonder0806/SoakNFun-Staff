import { useState } from 'react';
import { format, startOfWeek, parseISO } from 'date-fns';
import api from '../lib/api.js';

const REPORT_TYPES = [
  { id: 'schedule', label: 'Weekly Schedule',      description: 'Published shifts for a selected week, organized by day and department.', icon: CalIcon,   params: 'week' },
  { id: 'roster',   label: 'Staff Roster',          description: 'All active employees with contact info, department, and position.',       icon: StaffIcon, params: 'none' },
  { id: 'hours',    label: 'Hours Summary',          description: 'Total scheduled hours per employee over a date range.',                  icon: ClockIcon, params: 'range' },
  { id: 'coverage', label: 'Department Coverage',   description: 'Staff count per department per day — spot gaps at a glance.',            icon: GridIcon,  params: 'week' },
  { id: 'timeoff',  label: 'Time-Off Requests',     description: 'All time-off requests in a period with status and notes.',               icon: LeafIcon,  params: 'range-status' },
];

const DEPT_COLOR = {
  'Aquatics': 'text-sky-400', 'Food & Beverage': 'text-orange-400',
  'Guest Services': 'text-violet-400', 'Management': 'text-yellow-400', 'Cleaning Crew': 'text-emerald-400',
};
const STATUS_COLOR = { approved: 'text-green-400', denied: 'text-red-400', pending: 'text-amber-400' };

function currentMonday() {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export default function Reports() {
  const [activeType,    setActiveType]    = useState('schedule');
  const [weekStart,     setWeekStart]     = useState(currentMonday);
  const [from,          setFrom]          = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [to,            setTo]            = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusFilter,  setStatusFilter]  = useState('all');
  const [reportData,    setReportData]    = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');

  const type = REPORT_TYPES.find(r => r.id === activeType);

  async function runReport() {
    setLoading(true); setError(''); setReportData(null);
    try {
      let res;
      if (activeType === 'schedule') res = await api.get('/reports/schedule', { params: { weekStart } });
      if (activeType === 'roster')   res = await api.get('/reports/roster');
      if (activeType === 'hours')    res = await api.get('/reports/hours',    { params: { from, to } });
      if (activeType === 'coverage') res = await api.get('/reports/coverage', { params: { weekStart } });
      if (activeType === 'timeoff')  res = await api.get('/reports/timeoff',  { params: { from, to, status: statusFilter } });
      setReportData(res.data);
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to load report. Try again.');
    } finally { setLoading(false); }
  }

  function printReport() {
    const subtitle = buildSubtitle(activeType, weekStart, from, to, statusFilter);
    const html = buildPrintHTML(type.label, subtitle, activeType, reportData);
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
  }

  return (
    <div className="flex gap-4 h-full min-h-0">

      {/* Left: report type selector */}
      <aside className="w-56 shrink-0 panel flex flex-col gap-1 py-3 overflow-y-auto">
        <p className="label-xs px-4 mb-2">Report Type</p>
        {REPORT_TYPES.map(r => {
          const Icon = r.icon;
          const isActive = r.id === activeType;
          return (
            <button key={r.id}
              onClick={() => { setActiveType(r.id); setReportData(null); setError(''); }}
              className={`w-full text-left px-4 py-3 flex items-start gap-3 rounded-lg mx-1 transition-colors
                ${isActive ? 'bg-cyan/10 border border-cyan/20 text-ink' : 'hover:bg-shell/60 text-fog-hi border border-transparent'}`}>
              <span className={`mt-0.5 shrink-0 w-4 h-4 ${isActive ? 'text-cyan' : 'text-fog'}`}><Icon /></span>
              <span className="text-xs font-semibold leading-snug">{r.label}</span>
            </button>
          );
        })}
      </aside>

      {/* Right: config + output */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto">

        {/* Config bar */}
        <div className="panel px-5 py-4 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-heading font-black text-ink text-lg leading-tight">{type.label}</p>
            <p className="text-xs text-fog mt-0.5">{type.description}</p>
          </div>

          {type.params === 'week' && (
            <div>
              <p className="label-xs mb-1.5">Week starting</p>
              <input type="date" value={weekStart}
                onChange={e => { setWeekStart(e.target.value); setReportData(null); }}
                className="field text-sm" />
            </div>
          )}

          {(type.params === 'range' || type.params === 'range-status') && (
            <>
              <div>
                <p className="label-xs mb-1.5">From</p>
                <input type="date" value={from}
                  onChange={e => { setFrom(e.target.value); setReportData(null); }}
                  className="field text-sm" />
              </div>
              <div>
                <p className="label-xs mb-1.5">To</p>
                <input type="date" value={to}
                  onChange={e => { setTo(e.target.value); setReportData(null); }}
                  className="field text-sm" />
              </div>
            </>
          )}

          {type.params === 'range-status' && (
            <div>
              <p className="label-xs mb-1.5">Status</p>
              <select value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setReportData(null); }}
                className="field text-sm">
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="denied">Denied</option>
              </select>
            </div>
          )}

          <button onClick={runReport} disabled={loading}
            className="btn-primary px-5 py-2 shrink-0 disabled:opacity-50">
            {loading ? 'Running…' : 'Run Report'}
          </button>
          {reportData && (
            <button onClick={printReport}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-rim/60 bg-shell text-fog-hi hover:text-ink text-sm font-semibold transition-colors shrink-0">
              <PrintIcon />
              Print / PDF
            </button>
          )}
        </div>

        {error && <div className="panel px-5 py-4 text-red-400 text-sm">{error}</div>}

        {reportData && (
          <div className="panel flex-1 overflow-auto">
            {activeType === 'schedule' && <ScheduleReport data={reportData} />}
            {activeType === 'roster'   && <RosterReport   data={reportData} />}
            {activeType === 'hours'    && <HoursReport    data={reportData} />}
            {activeType === 'coverage' && <CoverageReport data={reportData} />}
            {activeType === 'timeoff'  && <TimeOffReport  data={reportData} />}
          </div>
        )}

        {!reportData && !error && !loading && (
          <div className="panel flex-1 flex flex-col items-center justify-center gap-3 text-fog">
            <span className="w-10 h-10 opacity-20"><CalIcon /></span>
            <p className="text-sm">Configure the report above and click <span className="text-fog-hi font-semibold">Run Report</span>.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Web-view report renderers ─────────────────────────────────────────────────

function ScheduleReport({ data }) {
  const { shifts, days } = data;
  return (
    <div className="divide-y divide-rim/20">
      {days.map(day => {
        const dayShifts = shifts.filter(s => s.date === day);
        return (
          <div key={day}>
            <div className="px-5 py-2 bg-shell/40 flex items-center justify-between">
              <p className="text-xs font-bold text-ink">{format(parseISO(day), 'EEEE, MMMM d')}</p>
              <p className="text-10 text-fog">{dayShifts.length} shift{dayShifts.length !== 1 ? 's' : ''}</p>
            </div>
            {dayShifts.length === 0
              ? <p className="px-5 py-3 text-xs text-fog italic">No shifts scheduled</p>
              : <table className="w-full text-xs">
                  <thead><tr className="bg-deep/60"><Th>Employee</Th><Th>Time</Th><Th>Department</Th><Th>Position</Th><Th>Location</Th><Th>Notes</Th></tr></thead>
                  <tbody>
                    {dayShifts.map((s, i) => (
                      <tr key={i} className="border-t border-rim/10 hover:bg-shell/30">
                        <Td><span className="font-semibold text-ink">{s.employeeName}</span></Td>
                        <Td>{fmt12(s.start)} – {fmt12(s.end)}</Td>
                        <Td><span className={DEPT_COLOR[s.department] ?? 'text-fog-hi'}>{s.department}</span></Td>
                        <Td>{s.position || '—'}</Td><Td>{s.location || '—'}</Td>
                        <Td className="text-fog">{s.notes || '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
        );
      })}
    </div>
  );
}

function RosterReport({ data }) {
  const { employees } = data;
  const byDept = groupBy(employees, e => e.department || 'Unassigned');
  return (
    <div>
      <div className="px-5 py-3 border-b border-rim/20">
        <p className="text-xs text-fog">{employees.length} active employees</p>
      </div>
      {Object.entries(byDept).map(([dept, emps]) => (
        <div key={dept}>
          <div className="px-5 py-2 bg-shell/40"><p className={`text-xs font-bold ${DEPT_COLOR[dept] ?? 'text-fog-hi'}`}>{dept}</p></div>
          <table className="w-full text-xs">
            <thead><tr className="bg-deep/60"><Th>Name</Th><Th>Position</Th><Th>Email</Th><Th>Phone</Th><Th>Departments</Th><Th>Hire Date</Th></tr></thead>
            <tbody>
              {emps.map(e => (
                <tr key={e.id} className="border-t border-rim/10 hover:bg-shell/30">
                  <Td><span className="font-semibold text-ink">{e.name}</span></Td>
                  <Td>{e.position || '—'}</Td>
                  <Td className="text-fog">{e.email}</Td>
                  <Td className="text-fog">{e.phone || '—'}</Td>
                  <Td className="text-fog">{(e.departments || [e.department]).join(', ')}</Td>
                  <Td className="text-fog">{e.hireDate ? format(parseISO(e.hireDate), 'MMM d, yyyy') : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function HoursReport({ data }) {
  const { employees, from, to } = data;
  const total = employees.reduce((s, e) => s + Number(e.totalHours), 0);
  const byDept = groupBy(employees, e => e.department || 'Unassigned');
  return (
    <div>
      <div className="px-5 py-3 border-b border-rim/20 flex items-center gap-6">
        <Stat label="Period" value={`${format(parseISO(from), 'MMM d')} – ${format(parseISO(to), 'MMM d, yyyy')}`} />
        <Stat label="Total hours" value={total.toFixed(1)} />
        <Stat label="Employees" value={employees.length} />
      </div>
      {Object.entries(byDept).map(([dept, emps]) => {
        const deptHours = emps.reduce((s, e) => s + Number(e.totalHours), 0);
        return (
          <div key={dept}>
            <div className="px-5 py-2 bg-shell/40 flex items-center justify-between">
              <p className={`text-xs font-bold ${DEPT_COLOR[dept] ?? 'text-fog-hi'}`}>{dept}</p>
              <p className="text-10 text-fog">{deptHours.toFixed(1)} hrs total</p>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="bg-deep/60"><Th>Employee</Th><Th align="right">Shifts</Th><Th align="right">Hours Scheduled</Th></tr></thead>
              <tbody>
                {emps.map(e => (
                  <tr key={e.id} className="border-t border-rim/10 hover:bg-shell/30">
                    <Td><span className="font-semibold text-ink">{e.name}</span></Td>
                    <Td align="right" className="text-fog">{e.shiftCount}</Td>
                    <Td align="right"><span className={Number(e.totalHours) === 0 ? 'text-fog' : 'text-ink font-semibold'}>{Number(e.totalHours).toFixed(1)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function CoverageReport({ data }) {
  const { coverage, days } = data;
  const DEPTS = ['Aquatics', 'Food & Beverage', 'Guest Services', 'Cleaning Crew'];
  const lookup = {};
  for (const row of coverage) { if (!lookup[row.date]) lookup[row.date] = {}; lookup[row.date][row.department] = row; }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-deep/60">
            <Th>Department</Th>
            {days.map(d => <Th key={d} align="center"><span className="block">{format(parseISO(d), 'EEE')}</span><span className="block text-fog font-normal">{format(parseISO(d), 'M/d')}</span></Th>)}
            <Th align="center">Week Total</Th>
          </tr>
        </thead>
        <tbody>
          {DEPTS.map(dept => {
            const weekTotal = days.reduce((s, d) => s + (lookup[d]?.[dept]?.staffCount ?? 0), 0);
            return (
              <tr key={dept} className="border-t border-rim/10 hover:bg-shell/30">
                <Td><span className={`font-semibold ${DEPT_COLOR[dept] ?? 'text-fog-hi'}`}>{dept}</span></Td>
                {days.map(d => <Td key={d} align="center">{lookup[d]?.[dept] ? <span className="font-semibold text-ink">{lookup[d][dept].staffCount}</span> : <span className="text-fog/40">—</span>}</Td>)}
                <Td align="center"><span className="font-bold text-ink">{weekTotal}</span></Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TimeOffReport({ data }) {
  const { requests, from, to } = data;
  const counts = { approved: 0, pending: 0, denied: 0 };
  for (const r of requests) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return (
    <div>
      <div className="px-5 py-3 border-b border-rim/20 flex items-center gap-6">
        <Stat label="Period" value={`${format(parseISO(from), 'MMM d')} – ${format(parseISO(to), 'MMM d, yyyy')}`} />
        <Stat label="Total" value={requests.length} />
        <Stat label="Approved" value={counts.approved} valueClass="text-green-400" />
        <Stat label="Pending"  value={counts.pending}  valueClass="text-amber-400" />
        <Stat label="Denied"   value={counts.denied}   valueClass="text-red-400" />
      </div>
      {requests.length === 0
        ? <p className="px-5 py-8 text-center text-xs text-fog italic">No requests match this filter.</p>
        : <table className="w-full text-xs">
            <thead><tr className="bg-deep/60"><Th>Employee</Th><Th>Department</Th><Th>From</Th><Th>To</Th><Th>Days</Th><Th>Reason</Th><Th>Status</Th><Th>Notes</Th></tr></thead>
            <tbody>
              {requests.map((r, i) => {
                const start = parseISO(r.startDate), end = parseISO(r.endDate);
                const days  = Math.round((end - start) / 86400000) + 1;
                return (
                  <tr key={i} className="border-t border-rim/10 hover:bg-shell/30">
                    <Td><span className="font-semibold text-ink">{r.employeeName}</span></Td>
                    <Td><span className={DEPT_COLOR[r.department] ?? 'text-fog-hi'}>{r.department}</span></Td>
                    <Td>{format(start, 'MMM d, yyyy')}</Td><Td>{format(end, 'MMM d, yyyy')}</Td>
                    <Td align="center">{days}</Td>
                    <Td className="text-fog">{r.reason || '—'}</Td>
                    <Td><span className={`font-semibold capitalize ${STATUS_COLOR[r.status] ?? 'text-fog'}`}>{r.status}</span></Td>
                    <Td className="text-fog">{r.reviewNotes || '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      }
    </div>
  );
}

// ── Print HTML builder ────────────────────────────────────────────────────────

function buildSubtitle(type, weekStart, from, to, statusFilter) {
  if (type === 'schedule' || type === 'coverage') return `Week of ${fmtDateLong(weekStart)}`;
  if (type === 'roster')  return 'All Active Employees';
  if (type === 'hours')   return `${fmtDateMed(from)} – ${fmtDateMed(to)}`;
  if (type === 'timeoff') {
    const s = statusFilter === 'all' ? 'All Statuses' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1);
    return `${fmtDateMed(from)} – ${fmtDateMed(to)} · ${s}`;
  }
  return '';
}

function buildPrintHTML(reportLabel, subtitle, reportType, data) {
  const now = new Date();
  const printDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                  + ' at ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const body = {
    schedule: () => printSchedule(data),
    roster:   () => printRoster(data),
    hours:    () => printHours(data),
    coverage: () => printCoverage(data),
    timeoff:  () => printTimeOff(data),
  }[reportType]?.() ?? '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Blue Bayou — ${esc(reportLabel)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page {
    size: letter landscape;
    margin: 0.65in 0.7in 0.8in 0.7in;
  }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #111;
    background: white;
    line-height: 1.4;
  }

  /* ── Header ── */
  .hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-bottom: 10px;
    margin-bottom: 16px;
    border-bottom: 2.5px solid #111;
  }
  .co-name { font-size: 19pt; font-weight: 900; letter-spacing: 0.03em; text-transform: uppercase; line-height: 1; }
  .co-sub  { font-size: 8pt; letter-spacing: 0.14em; text-transform: uppercase; color: #666; margin-top: 3px; }
  .hdr-right { text-align: right; }
  .rpt-title { font-size: 13pt; font-weight: 700; }
  .rpt-sub   { font-size: 9pt;  color: #555; margin-top: 3px; }
  .rpt-date  { font-size: 8pt;  color: #999; margin-top: 2px; }

  /* ── Summary bar ── */
  .summary {
    display: flex; gap: 24px;
    background: #f4f4f4; border: 1px solid #ddd;
    padding: 9px 12px; margin-bottom: 14px;
    page-break-inside: avoid;
  }
  .stat-lbl { font-size: 7pt; letter-spacing: 0.1em; text-transform: uppercase; color: #777; }
  .stat-val { font-size: 13pt; font-weight: 800; color: #111; }
  .stat-val.green { color: #14532d; }
  .stat-val.amber { color: #78350f; }
  .stat-val.red   { color: #7f1d1d; }

  /* ── Section headers ── */
  .sec-hdr {
    display: flex; justify-content: space-between; align-items: center;
    background: #e4e4e4; border-top: 1px solid #bbb; border-bottom: 1px solid #bbb;
    padding: 5px 10px; margin-top: 14px;
    font-weight: 700; font-size: 9.5pt;
    page-break-after: avoid;
  }
  .sec-hdr .sec-meta { font-weight: 400; font-size: 8.5pt; color: #555; }

  .day-hdr {
    display: flex; justify-content: space-between; align-items: center;
    background: #efefef; border-top: 2px solid #ccc; border-bottom: 1px solid #ccc;
    padding: 5px 10px; margin-top: 12px;
    font-weight: 700; font-size: 9.5pt;
    page-break-after: avoid;
  }
  .day-hdr .day-meta { font-weight: 400; font-size: 8.5pt; color: #666; }

  /* ── Tables ── */
  table {
    width: 100%; border-collapse: collapse;
    font-size: 9pt; margin-bottom: 4px;
    page-break-inside: auto;
  }
  thead { display: table-header-group; }
  th {
    background: #222; color: #fff;
    text-align: left; padding: 5px 10px;
    font-size: 7.5pt; font-weight: 700;
    letter-spacing: 0.07em; text-transform: uppercase;
    white-space: nowrap;
  }
  th.r { text-align: right; }
  th.c { text-align: center; }
  td { padding: 4.5px 10px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  td.r { text-align: right; }
  td.c { text-align: center; }
  tr:nth-child(even) td { background: #f9f9f9; }
  tr:last-child td { border-bottom: 2px solid #ccc; }
  .none  { color: #bbb; }
  .muted { color: #666; }

  /* ── Status badges ── */
  .s-approved { color: #14532d; font-weight: 600; }
  .s-pending  { color: #78350f; font-weight: 600; }
  .s-denied   { color: #7f1d1d; font-weight: 600; }

  /* ── Footer ── */
  .footer {
    position: fixed; bottom: 0.25in; left: 0; right: 0;
    text-align: center; font-size: 7.5pt; color: #bbb;
    letter-spacing: 0.06em; text-transform: uppercase;
    border-top: 1px solid #e0e0e0; padding-top: 5px;
  }

  /* ── Screen preview ── */
  @media screen {
    html { background: #d0d0d0; }
    body { max-width: 11in; margin: 0 auto; padding: 0.65in 0.7in; background: white; box-shadow: 0 4px 32px rgba(0,0,0,.22); min-height: 8.5in; }
    .print-btn {
      position: fixed; top: 14px; right: 14px; z-index: 999;
      background: #111; color: #fff; border: none;
      padding: 9px 22px; font-size: 11pt; font-weight: 700;
      border-radius: 5px; cursor: pointer; letter-spacing: 0.01em;
      box-shadow: 0 2px 10px rgba(0,0,0,.3);
    }
    .print-btn:hover { background: #333; }
  }
  @media print {
    .print-btn { display: none !important; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>

<div class="hdr">
  <div>
    <div class="co-name">Blue Bayou</div>
    <div class="co-sub">Waterpark &amp; Staff Management</div>
  </div>
  <div class="hdr-right">
    <div class="rpt-title">${esc(reportLabel)}</div>
    <div class="rpt-sub">${esc(subtitle)}</div>
    <div class="rpt-date">Printed ${esc(printDate)}</div>
  </div>
</div>

${body}

<div class="footer">Confidential &mdash; Management Use Only</div>
</body>
</html>`;
}

// ── Per-report HTML body generators ──────────────────────────────────────────

function printSchedule({ shifts, days }) {
  return days.map(day => {
    const dayShifts = shifts.filter(s => s.date === day);
    const label = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (dayShifts.length === 0) {
      return `<div class="day-hdr"><span>${esc(label)}</span><span class="day-meta">No shifts scheduled</span></div>`;
    }
    const rows = dayShifts.map(s => `<tr>
      <td><strong>${esc(s.employeeName)}</strong></td>
      <td>${esc(fmt12(s.start))} &ndash; ${esc(fmt12(s.end))}</td>
      <td>${esc(s.department)}</td>
      <td>${esc(s.position) || '<span class="none">&mdash;</span>'}</td>
      <td>${esc(s.location) || '<span class="none">&mdash;</span>'}</td>
      <td class="muted">${esc(s.notes) || '<span class="none">&mdash;</span>'}</td>
    </tr>`).join('');
    return `<div class="day-hdr">
      <span>${esc(label)}</span>
      <span class="day-meta">${dayShifts.length} shift${dayShifts.length !== 1 ? 's' : ''}</span>
    </div>
    <table>
      <thead><tr><th>Employee</th><th>Time</th><th>Department</th><th>Position</th><th>Location</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }).join('');
}

function printRoster({ employees }) {
  const byDept = groupBy(employees, e => e.department || 'Unassigned');
  const summary = `<div class="summary">
    <div><div class="stat-lbl">Active Employees</div><div class="stat-val">${employees.length}</div></div>
    <div><div class="stat-lbl">Departments</div><div class="stat-val">${Object.keys(byDept).length}</div></div>
  </div>`;
  const sections = Object.entries(byDept).map(([dept, emps]) => {
    const rows = emps.map(e => `<tr>
      <td><strong>${esc(e.name)}</strong></td>
      <td>${esc(e.position) || '<span class="none">&mdash;</span>'}</td>
      <td class="muted">${esc(e.email)}</td>
      <td class="muted">${esc(e.phone) || '<span class="none">&mdash;</span>'}</td>
      <td class="muted">${esc((e.departments || [e.department]).join(', '))}</td>
      <td class="muted">${e.hireDate ? fmtDateMed(e.hireDate) : '<span class="none">&mdash;</span>'}</td>
    </tr>`).join('');
    return `<div class="sec-hdr"><span>${esc(dept)}</span><span class="sec-meta">${emps.length} employee${emps.length !== 1 ? 's' : ''}</span></div>
    <table>
      <thead><tr><th>Name</th><th>Position</th><th>Email</th><th>Phone</th><th>Departments</th><th>Hire Date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }).join('');
  return summary + sections;
}

function printHours({ employees }) {
  const total  = employees.reduce((s, e) => s + Number(e.totalHours), 0);
  const byDept = groupBy(employees, e => e.department || 'Unassigned');
  const summary = `<div class="summary">
    <div><div class="stat-lbl">Total Hours</div><div class="stat-val">${total.toFixed(1)}</div></div>
    <div><div class="stat-lbl">Employees</div><div class="stat-val">${employees.length}</div></div>
  </div>`;
  const sections = Object.entries(byDept).map(([dept, emps]) => {
    const deptHours = emps.reduce((s, e) => s + Number(e.totalHours), 0);
    const rows = emps.map(e => `<tr>
      <td><strong>${esc(e.name)}</strong></td>
      <td class="r muted">${e.shiftCount}</td>
      <td class="r"><strong>${Number(e.totalHours).toFixed(1)}</strong></td>
    </tr>`).join('');
    return `<div class="sec-hdr"><span>${esc(dept)}</span><span class="sec-meta">${deptHours.toFixed(1)} hrs total</span></div>
    <table>
      <thead><tr><th>Employee</th><th class="r">Shifts</th><th class="r">Hours Scheduled</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }).join('');
  return summary + sections;
}

function printCoverage({ coverage, days }) {
  const DEPTS = ['Aquatics', 'Food & Beverage', 'Guest Services', 'Cleaning Crew'];
  const lookup = {};
  for (const row of coverage) { if (!lookup[row.date]) lookup[row.date] = {}; lookup[row.date][row.department] = row; }

  const dayHeaders = days.map(d => {
    const date = new Date(d + 'T00:00:00');
    return `<th class="c">${date.toLocaleDateString('en-US', { weekday: 'short' })}<br>
      <span style="font-weight:400;opacity:.65;font-size:7pt">${date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span>
    </th>`;
  }).join('');

  const rows = DEPTS.map(dept => {
    const weekTotal = days.reduce((s, d) => s + (lookup[d]?.[dept]?.staffCount ?? 0), 0);
    const cells = days.map(d => {
      const n = lookup[d]?.[dept]?.staffCount;
      return `<td class="c">${n != null ? `<strong>${n}</strong>` : '<span class="none">&mdash;</span>'}</td>`;
    }).join('');
    return `<tr><td><strong>${esc(dept)}</strong></td>${cells}<td class="c"><strong>${weekTotal}</strong></td></tr>`;
  }).join('');

  return `<table>
    <thead><tr><th>Department</th>${dayHeaders}<th class="c">Week Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function printTimeOff({ requests }) {
  const counts = { approved: 0, pending: 0, denied: 0 };
  for (const r of requests) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const summary = `<div class="summary">
    <div><div class="stat-lbl">Total Requests</div><div class="stat-val">${requests.length}</div></div>
    <div><div class="stat-lbl">Approved</div><div class="stat-val green">${counts.approved}</div></div>
    <div><div class="stat-lbl">Pending</div><div class="stat-val amber">${counts.pending}</div></div>
    <div><div class="stat-lbl">Denied</div><div class="stat-val red">${counts.denied}</div></div>
  </div>`;

  if (requests.length === 0) return summary + '<p style="color:#999;font-style:italic;padding:8px 0">No requests match this filter.</p>';

  const rows = requests.map(r => {
    const start = new Date(r.startDate + 'T00:00:00');
    const end   = new Date(r.endDate   + 'T00:00:00');
    const days  = Math.round((end - start) / 86400000) + 1;
    const cap   = r.status.charAt(0).toUpperCase() + r.status.slice(1);
    return `<tr>
      <td><strong>${esc(r.employeeName)}</strong></td>
      <td>${esc(r.department)}</td>
      <td>${fmtDateMed(r.startDate)}</td>
      <td>${fmtDateMed(r.endDate)}</td>
      <td class="c">${days}</td>
      <td class="muted">${esc(r.reason) || '<span class="none">&mdash;</span>'}</td>
      <td><span class="s-${r.status}">${cap}</span></td>
      <td class="muted">${esc(r.reviewNotes) || '<span class="none">&mdash;</span>'}</td>
    </tr>`;
  }).join('');

  return summary + `<table>
    <thead><tr><th>Employee</th><th>Department</th><th>From</th><th>To</th><th class="c">Days</th><th>Reason</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Shared utilities ──────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDateMed(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateLong(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) { const k = keyFn(item); if (!out[k]) out[k] = []; out[k].push(item); }
  return out;
}

function fmt12(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── Web-view primitives ───────────────────────────────────────────────────────

function Th({ children, align = 'left' }) {
  return <th className={`px-5 py-2 text-${align} text-10 font-bold tracking-widest uppercase text-fog whitespace-nowrap`}>{children}</th>;
}
function Td({ children, align = 'left', className = '' }) {
  return <td className={`px-5 py-2.5 text-${align} text-fog-hi ${className}`}>{children}</td>;
}
function Stat({ label, value, valueClass = 'text-ink' }) {
  return <div><p className="text-10 text-fog tracking-widest uppercase">{label}</p><p className={`text-sm font-bold ${valueClass}`}>{value}</p></div>;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CalIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }
function StaffIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function ClockIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>; }
function GridIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>; }
function LeafIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full"><path d="M17 8C8 10 5.9 16.17 3.82 19.34"/><path d="M3 21c1.67-2.5 5-8 14-11-1 5-4.5 10-14 11z"/></svg>; }
function PrintIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>; }
