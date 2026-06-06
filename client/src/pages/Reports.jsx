import { useState } from 'react';
import { format, startOfWeek, parseISO } from 'date-fns';
import api from '../lib/api.js';

const REPORT_TYPES = [
  {
    id: 'schedule',
    label: 'Weekly Schedule',
    description: 'Published shifts for a selected week, organized by day and department.',
    icon: CalIcon,
    params: 'week',
  },
  {
    id: 'roster',
    label: 'Staff Roster',
    description: 'All active employees with contact info, department, and position.',
    icon: StaffIcon,
    params: 'none',
  },
  {
    id: 'hours',
    label: 'Hours Summary',
    description: 'Total scheduled hours per employee over a date range.',
    icon: ClockIcon,
    params: 'range',
  },
  {
    id: 'coverage',
    label: 'Department Coverage',
    description: 'Staff count per department per day — spot gaps at a glance.',
    icon: GridIcon,
    params: 'week',
  },
  {
    id: 'timeoff',
    label: 'Time-Off Requests',
    description: 'All time-off requests in a period with status and notes.',
    icon: LeafIcon,
    params: 'range-status',
  },
];

const DEPT_COLOR = {
  'Aquatics':        'text-sky-400',
  'Food & Beverage': 'text-orange-400',
  'Guest Services':  'text-violet-400',
  'Management':      'text-yellow-400',
  'Cleaning Crew':   'text-emerald-400',
};

const STATUS_COLOR = {
  approved: 'text-green-400',
  denied:   'text-red-400',
  pending:  'text-amber-400',
};

function currentMonday() {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  body { background: #fff !important; color: #111 !important; font-family: Georgia, serif; }
  .print-area { padding: 0 !important; }
  .print-card { background: #fff !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th { background: #f3f4f6 !important; color: #111 !important; border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; }
  td { border: 1px solid #e5e7eb; padding: 4px 8px; color: #111 !important; }
  tr:nth-child(even) td { background: #f9fafb !important; }
  .print-header { margin-bottom: 16px; }
  .print-title { font-size: 20px; font-weight: bold; margin-bottom: 4px; }
  .print-subtitle { font-size: 12px; color: #6b7280; }
  .dept-section-header { background: #e5e7eb !important; font-weight: bold; padding: 4px 8px; margin: 12px 0 0; font-size: 12px; }
}
`;

export default function Reports() {
  const [activeType, setActiveType]   = useState('schedule');
  const [weekStart, setWeekStart]     = useState(currentMonday);
  const [from, setFrom]               = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [to, setTo]                   = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusFilter, setStatusFilter] = useState('all');
  const [reportData, setReportData]   = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  const type = REPORT_TYPES.find(r => r.id === activeType);

  async function runReport() {
    setLoading(true);
    setError('');
    setReportData(null);
    try {
      let res;
      if (activeType === 'schedule')  res = await api.get('/reports/schedule', { params: { weekStart } });
      if (activeType === 'roster')    res = await api.get('/reports/roster');
      if (activeType === 'hours')     res = await api.get('/reports/hours', { params: { from, to } });
      if (activeType === 'coverage')  res = await api.get('/reports/coverage', { params: { weekStart } });
      if (activeType === 'timeoff')   res = await api.get('/reports/timeoff', { params: { from, to, status: statusFilter } });
      setReportData(res.data);
    } catch (e) {
      setError(e.response?.data?.error ?? 'Failed to load report. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function printReport() { window.print(); }

  const printLabel = buildPrintLabel(activeType, weekStart, from, to, statusFilter);

  return (
    <div className="flex gap-4 h-full min-h-0">
      <style>{PRINT_CSS}</style>

      {/* Left: report type selector */}
      <aside className="no-print w-56 shrink-0 panel flex flex-col gap-1 py-3 overflow-y-auto">
        <p className="label-xs px-4 mb-2">Report Type</p>
        {REPORT_TYPES.map(r => {
          const Icon = r.icon;
          const isActive = r.id === activeType;
          return (
            <button
              key={r.id}
              onClick={() => { setActiveType(r.id); setReportData(null); setError(''); }}
              className={`w-full text-left px-4 py-3 flex items-start gap-3 rounded-lg mx-1 transition-colors
                ${isActive
                  ? 'bg-cyan/10 border border-cyan/20 text-ink'
                  : 'hover:bg-shell/60 text-fog-hi border border-transparent'
                }`}
            >
              <span className={`mt-0.5 shrink-0 w-4 h-4 ${isActive ? 'text-cyan' : 'text-fog'}`}>
                <Icon />
              </span>
              <span className="text-xs font-semibold leading-snug">{r.label}</span>
            </button>
          );
        })}
      </aside>

      {/* Right: config + output */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto print-area">

        {/* Config bar */}
        <div className="no-print panel px-5 py-4 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-heading font-black text-ink text-lg leading-tight">{type.label}</p>
            <p className="text-xs text-fog mt-0.5">{type.description}</p>
          </div>

          {/* Week picker */}
          {(type.params === 'week') && (
            <div>
              <p className="label-xs mb-1.5">Week starting</p>
              <input type="date" value={weekStart}
                onChange={e => { setWeekStart(e.target.value); setReportData(null); }}
                className="field text-sm" />
            </div>
          )}

          {/* Date range picker */}
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

          {/* Status filter (time-off) */}
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
              Print
            </button>
          )}
        </div>

        {/* Output */}
        {error && (
          <div className="panel px-5 py-4 text-red-400 text-sm">{error}</div>
        )}

        {reportData && (
          <div className="panel print-card flex-1 overflow-auto">

            {/* Print header (only shows on print) */}
            <div className="print-header hidden print:block px-6 pt-4">
              <div className="print-title">Blue Bayou Waterpark — {type.label}</div>
              <div className="print-subtitle">{printLabel} · Printed {format(new Date(), 'MMMM d, yyyy h:mm a')}</div>
            </div>

            {activeType === 'schedule'  && <ScheduleReport data={reportData} />}
            {activeType === 'roster'    && <RosterReport   data={reportData} />}
            {activeType === 'hours'     && <HoursReport    data={reportData} />}
            {activeType === 'coverage'  && <CoverageReport data={reportData} />}
            {activeType === 'timeoff'   && <TimeOffReport  data={reportData} />}
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

// ── Report renderers ─────────────────────────────────────────────────────────

function ScheduleReport({ data }) {
  const { shifts, days } = data;
  const DAY_LABELS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

  return (
    <div className="divide-y divide-rim/20">
      {days.map(day => {
        const dayShifts = shifts.filter(s => s.date === day);
        const label = format(parseISO(day), 'EEEE, MMMM d');
        return (
          <div key={day}>
            <div className="px-5 py-2 bg-shell/40 flex items-center justify-between">
              <p className="text-xs font-bold text-ink">{label}</p>
              <p className="text-10 text-fog">{dayShifts.length} shift{dayShifts.length !== 1 ? 's' : ''}</p>
            </div>
            {dayShifts.length === 0 ? (
              <p className="px-5 py-3 text-xs text-fog italic">No shifts scheduled</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-deep/60">
                    <Th>Employee</Th><Th>Time</Th><Th>Department</Th><Th>Position</Th><Th>Location</Th><Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {dayShifts.map((s, i) => (
                    <tr key={i} className="border-t border-rim/10 hover:bg-shell/30">
                      <Td><span className="font-semibold text-ink">{s.employeeName}</span></Td>
                      <Td>{fmt12(s.start)} – {fmt12(s.end)}</Td>
                      <Td><span className={DEPT_COLOR[s.department] ?? 'text-fog-hi'}>{s.department}</span></Td>
                      <Td>{s.position || '—'}</Td>
                      <Td>{s.location || '—'}</Td>
                      <Td className="text-fog">{s.notes || '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RosterReport({ data }) {
  const { employees } = data;
  const byDept = {};
  for (const e of employees) {
    const d = e.department || 'Unassigned';
    if (!byDept[d]) byDept[d] = [];
    byDept[d].push(e);
  }
  return (
    <div>
      <div className="no-print px-5 py-3 border-b border-rim/20 flex items-center justify-between">
        <p className="text-xs text-fog">{employees.length} active employees</p>
      </div>
      {Object.entries(byDept).map(([dept, emps]) => (
        <div key={dept}>
          <div className="px-5 py-2 bg-shell/40">
            <p className={`text-xs font-bold ${DEPT_COLOR[dept] ?? 'text-fog-hi'}`}>{dept}</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-deep/60">
                <Th>Name</Th><Th>Position</Th><Th>Email</Th><Th>Phone</Th><Th>Departments</Th><Th>Hire Date</Th>
              </tr>
            </thead>
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
  const total = employees.reduce((sum, e) => sum + Number(e.totalHours), 0);
  const byDept = {};
  for (const e of employees) {
    const d = e.department || 'Unassigned';
    if (!byDept[d]) byDept[d] = [];
    byDept[d].push(e);
  }
  return (
    <div>
      <div className="no-print px-5 py-3 border-b border-rim/20 flex items-center gap-6">
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
              <thead>
                <tr className="bg-deep/60">
                  <Th>Employee</Th><Th align="right">Shifts</Th><Th align="right">Hours Scheduled</Th>
                </tr>
              </thead>
              <tbody>
                {emps.map(e => (
                  <tr key={e.id} className="border-t border-rim/10 hover:bg-shell/30">
                    <Td><span className="font-semibold text-ink">{e.name}</span></Td>
                    <Td align="right" className="text-fog">{e.shiftCount}</Td>
                    <Td align="right">
                      <span className={Number(e.totalHours) === 0 ? 'text-fog' : 'text-ink font-semibold'}>
                        {Number(e.totalHours).toFixed(1)}
                      </span>
                    </Td>
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
  const DEPARTMENTS = ['Aquatics', 'Food & Beverage', 'Guest Services', 'Cleaning Crew'];

  // Build a lookup: date → dept → { staffCount, shiftCount }
  const lookup = {};
  for (const row of coverage) {
    if (!lookup[row.date]) lookup[row.date] = {};
    lookup[row.date][row.department] = row;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-deep/60">
            <Th>Department</Th>
            {days.map(d => (
              <Th key={d} align="center">
                <span className="block">{format(parseISO(d), 'EEE')}</span>
                <span className="block text-fog font-normal">{format(parseISO(d), 'M/d')}</span>
              </Th>
            ))}
            <Th align="center">Week Total</Th>
          </tr>
        </thead>
        <tbody>
          {DEPARTMENTS.map(dept => {
            const weekTotal = days.reduce((sum, d) => sum + (lookup[d]?.[dept]?.staffCount ?? 0), 0);
            return (
              <tr key={dept} className="border-t border-rim/10 hover:bg-shell/30">
                <Td><span className={`font-semibold ${DEPT_COLOR[dept] ?? 'text-fog-hi'}`}>{dept}</span></Td>
                {days.map(d => {
                  const cell = lookup[d]?.[dept];
                  return (
                    <Td key={d} align="center">
                      {cell ? (
                        <span className="font-semibold text-ink">{cell.staffCount}</span>
                      ) : (
                        <span className="text-fog/40">—</span>
                      )}
                    </Td>
                  );
                })}
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
      <div className="no-print px-5 py-3 border-b border-rim/20 flex items-center gap-6">
        <Stat label="Period" value={`${format(parseISO(from), 'MMM d')} – ${format(parseISO(to), 'MMM d, yyyy')}`} />
        <Stat label="Total requests" value={requests.length} />
        <Stat label="Approved" value={counts.approved} valueClass="text-green-400" />
        <Stat label="Pending" value={counts.pending} valueClass="text-amber-400" />
        <Stat label="Denied" value={counts.denied} valueClass="text-red-400" />
      </div>
      {requests.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-fog italic">No requests match this filter.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-deep/60">
              <Th>Employee</Th><Th>Department</Th><Th>From</Th><Th>To</Th>
              <Th>Days</Th><Th>Reason</Th><Th>Status</Th><Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r, i) => {
              const start = parseISO(r.startDate);
              const end   = parseISO(r.endDate);
              const days  = Math.round((end - start) / 86400000) + 1;
              return (
                <tr key={i} className="border-t border-rim/10 hover:bg-shell/30">
                  <Td><span className="font-semibold text-ink">{r.employeeName}</span></Td>
                  <Td><span className={DEPT_COLOR[r.department] ?? 'text-fog-hi'}>{r.department}</span></Td>
                  <Td>{format(start, 'MMM d, yyyy')}</Td>
                  <Td>{format(end,   'MMM d, yyyy')}</Td>
                  <Td align="center">{days}</Td>
                  <Td className="text-fog">{r.reason || '—'}</Td>
                  <Td>
                    <span className={`font-semibold capitalize ${STATUS_COLOR[r.status] ?? 'text-fog'}`}>
                      {r.status}
                    </span>
                  </Td>
                  <Td className="text-fog">{r.reviewNotes || '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Shared primitives ────────────────────────────────────────────────────────

function Th({ children, align = 'left' }) {
  return (
    <th className={`px-5 py-2 text-${align} text-10 font-bold tracking-widest uppercase text-fog whitespace-nowrap`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', className = '' }) {
  return (
    <td className={`px-5 py-2.5 text-${align} text-fog-hi ${className}`}>
      {children}
    </td>
  );
}

function Stat({ label, value, valueClass = 'text-ink' }) {
  return (
    <div>
      <p className="text-10 text-fog tracking-widest uppercase">{label}</p>
      <p className={`text-sm font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

function fmt12(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function buildPrintLabel(type, weekStart, from, to, statusFilter) {
  if (type === 'schedule' || type === 'coverage') {
    return `Week of ${format(parseISO(weekStart), 'MMMM d, yyyy')}`;
  }
  if (type === 'timeoff') {
    return `${format(parseISO(from), 'MMM d')} – ${format(parseISO(to), 'MMM d, yyyy')} · ${statusFilter === 'all' ? 'All Statuses' : statusFilter}`;
  }
  if (type === 'hours') {
    return `${format(parseISO(from), 'MMM d')} – ${format(parseISO(to), 'MMM d, yyyy')}`;
  }
  return '';
}

// ── Icons ────────────────────────────────────────────────────────────────────

function CalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function StaffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function LeafIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <path d="M17 8C8 10 5.9 16.17 3.82 19.34" />
      <path d="M3 21c1.67-2.5 5-8 14-11-1 5-4.5 10-14 11z" />
    </svg>
  );
}
function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
