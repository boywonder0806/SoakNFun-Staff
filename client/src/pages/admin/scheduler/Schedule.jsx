import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, startOfWeek, addWeeks, subWeeks, parseISO } from 'date-fns';
import api from '../../../lib/api.js';
import { fmt12 } from '../../../lib/time.js';
import { Avatar } from '../../../components/Layout/Sidebar.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';

const SCHEDULABLE_DEPTS = ['Aquatics', 'Food & Beverage', 'Guest Services', 'Cleaning Crew'];
const LOCS      = ['Wave Pool', 'Slide Area', 'Lazy River', 'Main Pool', 'Park-Wide',
                   'Snack Shack', 'Main Concessions', 'Main Entrance', 'Cabana Rentals'];
const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const BLANK     = { employeeId: '', date: '', start: '09:00', end: '17:00', department: '', position: '', location: '', notes: '' };

const SHIFT_COLOR = {
  'Aquatics':        { bg: '#0369a1', text: '#e0f2fe' },
  'Food & Beverage': { bg: '#c2410c', text: '#ffedd5' },
  'Guest Services':  { bg: '#6d28d9', text: '#ede9fe' },
  'Management':      { bg: '#92400e', text: '#fef3c7' },
  'Cleaning Crew':   { bg: '#065f46', text: '#d1fae5' },
};
const DEFAULT_COLOR = { bg: '#0e7490', text: '#cffafe' };

function calcHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

export default function Schedule() {
  const { user } = useAuth();
  const depts = (!user || user.role === 'sysadmin')
    ? SCHEDULABLE_DEPTS
    : SCHEDULABLE_DEPTS.filter(d => user.departments?.includes(d));

  useEffect(() => {
    if (depts.length === 1) setDept(depts[0]);
  }, [depts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [weekStart, setWeekStart] = useState(() => {
    const saved = localStorage.getItem('bb_sched_weekStart');
    if (saved) return saved;
    return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  });
  const [draftData, setDraftData]       = useState(null);
  const [publishedCount, setPublishedCount] = useState(0);
  const [loading, setLoading]           = useState(true);
  const [deptFilter, setDept]           = useState('All');
  const [sortBy, setSortBy]             = useState('name');
  const [modal, setModal]               = useState(null);
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState('');
  const [publishing, setPublishing]     = useState(false);
  const [toast, setToast]               = useState(null);
  const [dragging, setDragging]         = useState(null);
  const [dropTarget, setDropTarget]     = useState(null);
  const [clipboard, setClipboard]       = useState(null);
  const [ctxMenu, setCtxMenu]           = useState(null);
  const [aiModal, setAiModal]           = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSummary, setAiSummary]       = useState(null);
  const [aiConfig, setAiConfig]         = useState({
    departments: SCHEDULABLE_DEPTS,
    dailyCoverage: { 'Aquatics': 2, 'Food & Beverage': 2, 'Guest Services': 2, 'Cleaning Crew': 1 },
    minHours: 16, maxHours: 40, shiftStart: '09:00', shiftEnd: '17:00',
  });

  useEffect(() => {
    setAiConfig(prev => {
      const filtered = prev.departments.filter(d => depts.includes(d));
      const next = filtered.length ? filtered : depts;
      return { ...prev, departments: next, dailyCoverage: Object.fromEntries(next.map(d => [d, prev.dailyCoverage[d] ?? 2])) };
    });
  }, [depts.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [planRes, currentRes] = await Promise.all([
        api.get(`/admin/scheduler/plan?weekStart=${weekStart}`),
        api.get(`/admin/scheduler?weekStart=${weekStart}`),
      ]);
      setDraftData(planRes.data);
      setPublishedCount(currentRes.data?.shifts?.length ?? 0);
    } catch { /* empty */ } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctxMenu]);

  // Persist selected week so returning after closing the tab lands on the right draft
  useEffect(() => {
    localStorage.setItem('bb_sched_weekStart', weekStart);
  }, [weekStart]);

  const nav = dir => setWeekStart(w =>
    format(dir === 'prev' ? subWeeks(parseISO(w), 1) : addWeeks(parseISO(w), 1), 'yyyy-MM-dd')
  );
  const goToday = () => setWeekStart(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  function openCreate(empId, date) {
    const emp = draftData.employees.find(e => e.id === empId);
    setModal({ mode: 'create', form: { ...BLANK, employeeId: String(empId), date, department: emp?.department ?? '', position: emp?.position ?? '' } });
    setErr('');
  }
  function openEdit(shift) {
    setModal({ mode: 'edit', shiftId: shift.id, form: { ...shift, employeeId: String(shift.employeeId) } });
    setErr('');
  }
  function closeModal() { setModal(null); setErr(''); }
  function patch(field) { return e => setModal(m => ({ ...m, form: { ...m.form, [field]: e.target.value } })); }

  async function handleSave() {
    if (!modal.form.employeeId || !modal.form.date) { setErr('Employee and date are required.'); return; }
    if (!modal.form.start || !modal.form.end)       { setErr('Start and end times are required.'); return; }
    setSaving(true);
    try {
      if (modal.mode === 'create') await api.post('/admin/scheduler/plan/shifts', modal.form);
      else await api.patch(`/admin/scheduler/plan/shifts/${modal.shiftId}`, modal.form);
      closeModal(); load();
    } catch (e) {
      setErr(e.response?.data?.error ?? 'Something went wrong.');
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!window.confirm('Remove this draft shift?')) return;
    setSaving(true);
    try { await api.delete(`/admin/scheduler/plan/shifts/${modal.shiftId}`); closeModal(); load(); }
    finally { setSaving(false); }
  }

  async function handlePublish() {
    const days = draftData?.days ?? [];
    if (!days.length || shifts.length === 0) { showToast('No draft shifts to publish.', 'warn'); return; }
    if (!window.confirm(`Publish ${shifts.length} draft shift${shifts.length !== 1 ? 's' : ''} to the live schedule?\n\nThis will make them visible to all staff.`)) return;
    setPublishing(true);
    try {
      const res = await api.post('/admin/scheduler/plan/publish', { from: days[0], to: days[6] });
      showToast(`${res.data.published} shift${res.data.published !== 1 ? 's' : ''} published.`);
      load();
    } catch {
      showToast('Publish failed. Please try again.', 'error');
    } finally { setPublishing(false); }
  }

  async function handleAutoSchedule() {
    setAiGenerating(true);
    try {
      const res = await api.post('/admin/scheduler/auto-schedule', { weekStart, ...aiConfig });
      setAiModal(false);
      setAiSummary({ generated: res.data.generated, text: res.data.summary });
      load();
    } catch (e) {
      showToast(e.response?.data?.error ?? 'Auto-schedule failed. Try again.', 'error');
    } finally { setAiGenerating(false); }
  }

  function handleDragStart(e, shift) { setDragging(shift); e.dataTransfer.effectAllowed = 'move'; }
  function handleDragEnd() { setDragging(null); setDropTarget(null); }

  async function handleDrop(e, empId, date) {
    e.preventDefault();
    if (!dragging) { setDropTarget(null); return; }
    setDropTarget(null);
    if (dragging.employeeId === empId && dragging.date === date) { setDragging(null); return; }
    try { await api.patch(`/admin/scheduler/plan/shifts/${dragging.id}`, { employeeId: empId, date }); load(); }
    finally { setDragging(null); }
  }

  function handleCtxShift(e, shift) { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, shift }); }
  function handleCtxCell(e, empId, date) { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, empId, date }); }
  function handleCut() { setClipboard({ shift: ctxMenu.shift, mode: 'cut' }); setCtxMenu(null); }
  function handleCopy() { setClipboard({ shift: ctxMenu.shift, mode: 'copy' }); setCtxMenu(null); }
  async function handleCtxDelete() {
    const { id } = ctxMenu.shift;
    setCtxMenu(null);
    if (!window.confirm('Remove this draft shift?')) return;
    await api.delete(`/admin/scheduler/plan/shifts/${id}`);
    if (clipboard?.shift?.id === id) setClipboard(null);
    load();
  }
  async function handlePaste(empId, date) {
    if (!clipboard) return;
    const { shift, mode } = clipboard;
    try {
      if (mode === 'cut') { await api.patch(`/admin/scheduler/plan/shifts/${shift.id}`, { employeeId: empId, date }); setClipboard(null); }
      else { const { id: _id, ...fields } = shift; await api.post('/admin/scheduler/plan/shifts', { ...fields, employeeId: String(empId), date }); }
    } finally { setCtxMenu(null); load(); }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const days     = draftData?.days ?? [];
  const shifts   = draftData?.shifts ?? [];

  // Determine schedule status for this week
  const isPublished = publishedCount > 0;
  const hasDraft    = shifts.length > 0;

  const weekHours = useCallback(empId =>
    shifts.filter(s => s.employeeId === empId).reduce((acc, s) => acc + calcHours(s.start, s.end), 0),
    [shifts]
  );
  const scheduledCount = useCallback(day =>
    new Set(shifts.filter(s => s.date === day).map(s => s.employeeId)).size,
    [shifts]
  );

  const employees = useMemo(() => {
    const raw = (draftData?.employees ?? []).filter(e =>
      deptFilter === 'All' || e.departments?.includes(deptFilter) || e.department === deptFilter
    );
    if (sortBy === 'hours') return [...raw].sort((a, b) => weekHours(b.id) - weekHours(a.id));
    if (sortBy === 'shift') return [...raw].sort((a, b) => {
      const af = shifts.filter(s => s.employeeId === a.id).sort((x, y) => x.start.localeCompare(y.start))[0];
      const bf = shifts.filter(s => s.employeeId === b.id).sort((x, y) => x.start.localeCompare(y.start))[0];
      if (!af) return 1; if (!bf) return -1;
      return af.start.localeCompare(bf.start);
    });
    return [...raw].sort((a, b) => a.name.localeCompare(b.name));
  }, [draftData?.employees, deptFilter, sortBy, shifts, weekHours]);

  return (
    <div className="flex" style={{ height: 'calc(100vh - 3rem)' }}>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold
          ${toast.type === 'error' ? 'bg-red-500/90 text-white' :
            toast.type === 'warn'  ? 'bg-amber-500/90 text-white' :
            'bg-cyan/90 text-deep'}`}
        >
          {toast.msg}
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <p className="label-xs">Schedule</p>
              {/* Status badge */}
              {isPublished ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-10 font-bold tracking-wider uppercase
                  bg-green-500/15 text-green-400 border border-green-500/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  Published
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-10 font-bold tracking-wider uppercase
                  bg-amber-500/15 text-amber-400 border border-amber-500/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  Draft
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => nav('prev')} className="text-fog hover:text-ink transition-colors text-lg font-bold">‹</button>
              <h2 className="font-heading font-bold text-cyan text-xl tracking-tight">
                {days.length
                  ? `${format(parseISO(days[0]), 'MMM d')} – ${format(parseISO(days[6]), 'MMM d, yyyy')}`
                  : '—'}
              </h2>
              <button onClick={() => nav('next')} className="text-fog hover:text-ink transition-colors text-lg font-bold">›</button>
              <button onClick={goToday} className="btn-ghost border border-rim/60 px-2.5 py-1 text-xs ml-1">Today</button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {clipboard && (
              <span className="text-xs text-fog border border-rim/40 rounded px-2 py-1 flex items-center gap-1.5">
                <span className={clipboard.mode === 'cut' ? 'text-amber-400' : 'text-cyan'}>
                  {clipboard.mode === 'cut' ? '✂' : '⎘'}
                </span>
                {clipboard.mode === 'cut' ? 'Cut' : 'Copied'} shift
                <button onClick={() => setClipboard(null)} className="text-fog/60 hover:text-fog ml-0.5 text-base leading-none">×</button>
              </span>
            )}
            <a href="/scheduler/positions"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-rim/50 text-fog hover:text-ink hover:bg-shell transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Positions
            </a>
            <a href="/scheduler/import"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-cyan/40 text-cyan bg-cyan/10 hover:bg-cyan/20 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              Import PDF
            </a>
            <select value={deptFilter} onChange={e => setDept(e.target.value)} className="field text-sm py-1.5 w-44">
              {depts.length > 1 && <option value="All">All Departments</option>}
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button
              onClick={() => setAiModal(true)}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all
                bg-violet-500/20 text-violet-300 border border-violet-500/40
                hover:bg-violet-500/30"
            >
              ✦ Auto-Schedule
            </button>
            <button
              onClick={handlePublish}
              disabled={publishing || !hasDraft}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed
                ${isPublished
                  ? 'bg-green-500/20 text-green-300 border border-green-500/40 hover:bg-green-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                }`}
            >
              {publishing ? 'Publishing…' : isPublished ? 'Re-publish' : `Publish${hasDraft ? ` (${shifts.length})` : ''}`}
            </button>
            {hasDraft && (
              <span className="flex items-center gap-1 text-10 text-fog" title="Draft shifts are saved to the server — safe to close this tab">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 text-green-400 shrink-0">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Auto-saved
              </span>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 min-h-0 overflow-auto panel rounded-xl">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-fog text-sm">Loading schedule…</div>
          ) : (
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 bg-deep border-b border-r border-rim/40 px-4 py-2 text-left w-44">
                    <div className="flex items-center justify-between">
                      <span className="label-xs">Employees</span>
                      <span className="label-xs text-fog">{employees.length}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-fog text-10">Sort:</span>
                      <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                        className="text-10 bg-transparent text-cyan border-0 outline-none cursor-pointer font-bold">
                        <option value="name">Name</option>
                        <option value="shift">Shift Start</option>
                        <option value="hours">Hours</option>
                      </select>
                    </div>
                  </th>
                  <th className="sticky top-0 z-10 bg-deep border-b border-r border-rim/40 px-3 py-2 text-center w-14">
                    <span className="label-xs">HRS</span>
                  </th>
                  {days.map((day, i) => {
                    const isToday = day === todayStr;
                    const count   = scheduledCount(day);
                    return (
                      <th key={day}
                        className={`sticky top-0 z-10 border-b border-r border-rim/40 px-3 py-2 text-center
                          ${isToday ? 'bg-cyan/10' : 'bg-deep'}`}
                      >
                        <p className={`label-xs ${isToday ? 'text-cyan' : 'text-fog'}`}>{DAY_LABELS[i]}</p>
                        <p className={`font-heading font-bold text-2xl leading-none mt-0.5 ${isToday ? 'text-cyan' : 'text-ink'}`}>
                          {format(parseISO(day), 'd')}
                        </p>
                        <p className="text-fog text-10 mt-0.5">{count > 0 ? `${count} planned` : ''}</p>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr><td colSpan={9} className="text-center text-fog text-sm py-16">No staff match this filter.</td></tr>
                ) : employees.map((emp, ri) => {
                  const hrs = weekHours(emp.id);
                  return (
                    <tr key={emp.id} className={ri % 2 === 0 ? '' : 'bg-shell/20'}>
                      <td className={`sticky left-0 z-10 border-b border-r border-rim/40 px-4 py-3
                        ${ri % 2 === 0 ? 'bg-deep' : 'bg-[#0f2540]'}`}>
                        <div className="flex items-center gap-2.5">
                          <Avatar initials={emp.avatar} dept={emp.department} />
                          <div className="min-w-0">
                            <p className="text-ink text-sm font-semibold truncate leading-tight">{emp.name}</p>
                            <p className="text-fog text-10 tracking-wide">{emp.id.toString().padStart(4, '0')}</p>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-r border-rim/40 text-center px-2 py-3">
                        <span className={`text-sm font-semibold tabular-nums ${hrs === 0 ? 'text-fog/40' : 'text-cyan'}`}>
                          {hrs > 0 ? hrs.toFixed(1) : '—'}
                        </span>
                      </td>
                      {days.map(day => {
                        const dayShifts = shifts.filter(s => s.employeeId === emp.id && s.date === day);
                        const isToday   = day === todayStr;
                        const isDropTgt = dropTarget?.empId === emp.id && dropTarget?.date === day;
                        return (
                          <td key={day}
                            onClick={() => { if (!dragging) openCreate(emp.id, day); }}
                            onContextMenu={e => handleCtxCell(e, emp.id, day)}
                            onDragOver={e => { e.preventDefault(); setDropTarget({ empId: emp.id, date: day }); }}
                            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null); }}
                            onDrop={e => handleDrop(e, emp.id, day)}
                            className={`border-b border-r border-rim/40 px-1.5 py-1.5 align-top cursor-pointer transition-colors group
                              ${isDropTgt ? 'bg-cyan/20 ring-1 ring-inset ring-cyan/40' :
                                isToday ? 'bg-cyan/[0.03] hover:bg-cyan/5' : 'hover:bg-cyan/5'}`}
                            style={{ height: 72 }}
                          >
                            <div className="flex flex-col gap-1 h-full">
                              {dayShifts.map(shift => (
                                <ShiftBlock key={shift.id} shift={shift}
                                  isPublished={isPublished}
                                  isCut={clipboard?.mode === 'cut' && clipboard?.shift?.id === shift.id}
                                  onClick={e => { e.stopPropagation(); openEdit(shift); }}
                                  onDragStart={e => handleDragStart(e, shift)}
                                  onDragEnd={handleDragEnd}
                                  onContextMenu={e => handleCtxShift(e, shift)}
                                />
                              ))}
                              {dayShifts.length === 0 && (
                                <span className="opacity-0 group-hover:opacity-40 transition-opacity text-cyan text-xs font-bold px-1 pt-1">+ add</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-[70] min-w-[152px] panel-raised shadow-2xl rounded-lg py-1 border border-rim/40 overflow-hidden"
          style={{
            left: ctxMenu.x + (ctxMenu.x > window.innerWidth  - 170 ? -152 : 0),
            top:  ctxMenu.y + (ctxMenu.y > window.innerHeight - 130 ? -120 : 0),
          }}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          {ctxMenu.shift ? (
            <>
              <CtxItem label="Cut"  onClick={handleCut}  />
              <CtxItem label="Copy" onClick={handleCopy} />
              <div className="h-px bg-rim/30 my-1" />
              <CtxItem label="Delete Shift" onClick={handleCtxDelete} danger />
            </>
          ) : (
            <>
              <CtxItem
                label={clipboard ? `Paste ${clipboard.mode === 'cut' ? '(Move)' : '(Copy)'}` : 'Paste'}
                disabled={!clipboard}
                onClick={() => handlePaste(ctxMenu.empId, ctxMenu.date)}
              />
              <div className="h-px bg-rim/30 my-1" />
              <CtxItem label="Add Shift" onClick={() => { openCreate(ctxMenu.empId, ctxMenu.date); setCtxMenu(null); }} />
            </>
          )}
        </div>
      )}

      {/* Auto-Schedule modal */}
      {aiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !aiGenerating && setAiModal(false)} />
          <div className="relative panel-raised w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-rim/40">
              <div>
                <h2 className="font-heading font-bold text-ink text-lg flex items-center gap-2">
                  <span className="text-violet-400">✦</span> Auto-Schedule
                </h2>
                <p className="text-fog text-xs mt-0.5">
                  AI will generate draft shifts for{' '}
                  <span className="text-cyan font-semibold">
                    {days.length ? `${format(parseISO(days[0]), 'MMM d')} – ${format(parseISO(days[6]), 'MMM d')}` : 'this week'}
                  </span>
                </p>
              </div>
              {!aiGenerating && (
                <button onClick={() => setAiModal(false)} className="text-fog hover:text-ink transition-colors text-2xl leading-none">×</button>
              )}
            </div>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <p className="label-xs mb-2">Departments to schedule</p>
                <div className="flex flex-wrap gap-2">
                  {depts.map(d => {
                    const on = aiConfig.departments.includes(d);
                    return (
                      <button key={d}
                        onClick={() => setAiConfig(c => ({ ...c, departments: on ? c.departments.filter(x => x !== d) : [...c.departments, d] }))}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors
                          ${on ? 'bg-violet-500/20 border-violet-500/50 text-violet-300' : 'border-rim/40 text-fog hover:border-rim'}`}
                      >{d}</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="label-xs mb-2">Staff needed per day (per department)</p>
                <div className="space-y-2">
                  {aiConfig.departments.map(d => (
                    <div key={d} className="flex items-center justify-between">
                      <span className="text-sm text-fog-hi">{d}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setAiConfig(c => ({ ...c, dailyCoverage: { ...c.dailyCoverage, [d]: Math.max(1, (c.dailyCoverage[d] ?? 2) - 1) } }))}
                          className="w-6 h-6 rounded bg-shell text-ink font-bold flex items-center justify-center hover:bg-shell/80">−</button>
                        <span className="w-6 text-center text-sm font-semibold text-ink">{aiConfig.dailyCoverage[d] ?? 2}</span>
                        <button onClick={() => setAiConfig(c => ({ ...c, dailyCoverage: { ...c.dailyCoverage, [d]: (c.dailyCoverage[d] ?? 2) + 1 } }))}
                          className="w-6 h-6 rounded bg-shell text-ink font-bold flex items-center justify-center hover:bg-shell/80">+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="label-xs mb-1.5">Min hours / employee</p>
                  <input type="number" min={8} max={40} value={aiConfig.minHours}
                    onChange={e => setAiConfig(c => ({ ...c, minHours: parseInt(e.target.value) }))} className="field" />
                </div>
                <div>
                  <p className="label-xs mb-1.5">Max hours / employee</p>
                  <input type="number" min={8} max={60} value={aiConfig.maxHours}
                    onChange={e => setAiConfig(c => ({ ...c, maxHours: parseInt(e.target.value) }))} className="field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="label-xs mb-1.5">Default shift start</p>
                  <input type="time" value={aiConfig.shiftStart}
                    onChange={e => setAiConfig(c => ({ ...c, shiftStart: e.target.value }))} className="field" />
                </div>
                <div>
                  <p className="label-xs mb-1.5">Default shift end</p>
                  <input type="time" value={aiConfig.shiftEnd}
                    onChange={e => setAiConfig(c => ({ ...c, shiftEnd: e.target.value }))} className="field" />
                </div>
              </div>
              {aiGenerating && (
                <div className="flex items-center gap-3 py-2">
                  <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-violet-300">Claude is building your schedule…</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-rim/40">
              <button onClick={() => setAiModal(false)} disabled={aiGenerating} className="btn-ghost border border-rim/60 disabled:opacity-40">Cancel</button>
              <button onClick={handleAutoSchedule} disabled={aiGenerating || aiConfig.departments.length === 0}
                className="px-5 py-2 rounded-lg text-sm font-semibold transition-all bg-violet-500/20 text-violet-300 border border-violet-500/40 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
                {aiGenerating ? 'Generating…' : '✦ Generate Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Summary modal */}
      {aiSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAiSummary(null)} />
          <div className="relative panel-raised w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-rim/40">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                  <SparkleIcon />
                </span>
                <div>
                  <h2 className="font-heading font-bold text-ink text-base leading-tight">Schedule Generated</h2>
                  <p className="text-10 text-fog mt-0.5">{aiSummary.generated} shift{aiSummary.generated !== 1 ? 's' : ''} added to the draft</p>
                </div>
              </div>
              <button onClick={() => setAiSummary(null)} className="text-fog hover:text-ink transition-colors text-2xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <p className="label-xs mb-2">AI Scheduling Notes</p>
                <div className="bg-shell/60 border border-rim/40 rounded-xl px-4 py-4">
                  <p className="text-sm text-fog-hi leading-relaxed">
                    {aiSummary.text || 'No additional notes from the AI.'}
                  </p>
                </div>
              </div>
              <p className="text-10 text-fog">Review the draft schedule above and publish when ready.</p>
            </div>
            <div className="px-6 py-4 border-t border-rim/40 flex justify-end">
              <button onClick={() => setAiSummary(null)} className="btn-primary px-6 py-2">
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shift modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative panel-raised w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-rim/40">
              <h2 className="font-heading font-bold text-ink text-lg">
                {modal.mode === 'create' ? 'Add Shift' : 'Edit Shift'}
              </h2>
              <button onClick={closeModal} className="text-fog hover:text-ink transition-colors text-2xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <p className="label-xs mb-1.5">Employee</p>
                <select value={modal.form.employeeId} onChange={patch('employeeId')} className="field">
                  <option value="">— Select —</option>
                  {(draftData?.employees ?? []).map(e => <option key={e.id} value={String(e.id)}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <p className="label-xs mb-1.5">Date</p>
                <input type="date" value={modal.form.date} onChange={patch('date')} className="field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="label-xs mb-1.5">Start</p><input type="time" value={modal.form.start} onChange={patch('start')} className="field" /></div>
                <div><p className="label-xs mb-1.5">End</p><input type="time" value={modal.form.end} onChange={patch('end')} className="field" /></div>
              </div>
              <div>
                <p className="label-xs mb-1.5">Department</p>
                <select value={modal.form.department} onChange={patch('department')} className="field">
                  <option value="">— Select —</option>
                  {depts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <p className="label-xs mb-1.5">Position</p>
                <input type="text" value={modal.form.position} onChange={patch('position')} placeholder="e.g. Lifeguard" className="field" />
              </div>
              <div>
                <p className="label-xs mb-1.5">Location</p>
                <select value={modal.form.location} onChange={patch('location')} className="field">
                  <option value="">— Select —</option>
                  {LOCS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <p className="label-xs mb-1.5">Notes <span className="text-fog normal-case font-normal">(optional)</span></p>
                <input type="text" value={modal.form.notes} onChange={patch('notes')} placeholder="Any extra info…" className="field" />
              </div>
              {err && <p className="text-red-400 text-sm">{err}</p>}
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-t border-rim/40">
              {modal.mode === 'edit' ? (
                <button onClick={handleDelete} disabled={saving} className="text-red-400 hover:text-red-300 text-sm transition-colors disabled:opacity-40">
                  Delete shift
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={closeModal} className="btn-ghost border border-rim/60">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving ? 'Saving…' : modal.mode === 'create' ? 'Add Shift' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShiftBlock({ shift, isPublished, onClick, onDragStart, onDragEnd, onContextMenu, isCut }) {
  const c = SHIFT_COLOR[shift.department] ?? DEFAULT_COLOR;
  return (
    <button draggable onClick={onClick} onDragStart={onDragStart} onDragEnd={onDragEnd} onContextMenu={onContextMenu}
      className="w-full text-left rounded px-2.5 py-1 transition-all hover:brightness-110 leading-tight cursor-grab active:cursor-grabbing"
      style={{
        backgroundColor: c.bg,
        color: c.text,
        border: isPublished ? 'none' : `1px dashed ${c.text}50`,
        opacity: isCut ? 0.35 : 1,
      }}
    >
      <p className="text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
        {fmt12(shift.start)} – {fmt12(shift.end)}
      </p>
      {shift.location && <p className="text-xs mt-0.5 opacity-75 truncate">{shift.location}</p>}
    </button>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-violet-400">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}

function CtxItem({ label, onClick, danger, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      className={`w-full text-left px-4 py-1.5 text-sm transition-colors
        ${disabled ? 'text-fog/40 cursor-not-allowed' :
          danger   ? 'text-red-400 hover:bg-red-500/10 cursor-pointer' :
                     'text-ink hover:bg-cyan/10 cursor-pointer'}`}
    >
      {label}
    </button>
  );
}
