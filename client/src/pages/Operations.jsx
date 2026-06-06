import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api.js';

const SUB_PAGES = [
  { id: 'sunshine', label: 'Sunshine Days', icon: SunIcon },
];

export default function Operations() {
  const [activePage, setActivePage] = useState('sunshine');
  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Left sub-nav */}
      <aside className="w-52 shrink-0 panel flex flex-col py-3 overflow-y-auto">
        <p className="label-xs px-4 mb-3">Operations</p>
        <div className="flex flex-col gap-1 px-2">
          {SUB_PAGES.map(p => {
            const Icon = p.icon;
            const active = activePage === p.id;
            return (
              <button key={p.id} onClick={() => setActivePage(p.id)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 rounded-lg transition-colors
                  ${active
                    ? 'bg-amber-500/10 border border-amber-500/20 text-ink'
                    : 'hover:bg-shell/60 text-fog-hi border border-transparent'}`}>
                <span className={`shrink-0 w-4 h-4 ${active ? 'text-amber-400' : 'text-fog'}`}><Icon /></span>
                <span className="text-xs font-semibold">{p.label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main content — h-full so children can anchor to it */}
      <div className="flex-1 min-w-0 h-full min-h-0">
        {activePage === 'sunshine' && <SunshineDays />}
      </div>
    </div>
  );
}

// ── Sunshine Days ─────────────────────────────────────────────────────────────

function SunshineDays() {
  const [entries,  setEntries]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null);   // null | 'add' | entry (edit)
  const [deleting, setDeleting] = useState(null);
  const [toast,    setToast]    = useState(null);
  const [form,     setForm]     = useState(blankForm());
  const [saving,   setSaving]   = useState(false);
  const [formErr,  setFormErr]  = useState('');

  useEffect(() => { load(); }, []);

  function blankForm() {
    return { date: format(new Date(), 'yyyy-MM-dd'), startTime: '', endTime: '', notes: '' };
  }

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/operations/sunshine');
      setEntries(data.entries);
    } catch { /* empty */ } finally { setLoading(false); }
  }

  function openAdd() { setForm(blankForm()); setFormErr(''); setModal('add'); }
  function openEdit(entry) {
    setForm({
      date:      entry.date,
      startTime: entry.startTime?.slice(0, 5) ?? '',
      endTime:   entry.endTime?.slice(0, 5) ?? '',
      notes:     entry.notes ?? '',
    });
    setFormErr('');
    setModal(entry);
  }

  const patch = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  async function save() {
    if (!form.date || !form.startTime) { setFormErr('Date and start time are required.'); return; }
    if (form.endTime && form.endTime <= form.startTime) { setFormErr('End time must be after start time.'); return; }
    setSaving(true); setFormErr('');
    try {
      if (modal === 'add') {
        const { data } = await api.post('/operations/sunshine', form);
        setEntries(p => [data.entry, ...p]);
        showToast('Closure logged.');
      } else {
        const { data } = await api.patch(`/operations/sunshine/${modal.id}`, form);
        setEntries(p => p.map(e => e.id === modal.id ? data.entry : e));
        showToast('Entry updated.');
      }
      setModal(null);
    } catch (e) {
      setFormErr(e.response?.data?.error ?? 'Failed to save. Try again.');
    } finally { setSaving(false); }
  }

  async function confirmDelete(entry) {
    if (!window.confirm(`Delete the closure logged on ${fmtDate(entry.date)}?`)) return;
    setDeleting(entry.id);
    try {
      await api.delete(`/operations/sunshine/${entry.id}`);
      setEntries(p => p.filter(e => e.id !== entry.id));
      showToast('Entry deleted.');
    } catch { showToast('Delete failed.', 'error'); }
    finally { setDeleting(null); }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // Derived stats
  const thisMonthKey = format(new Date(), 'yyyy-MM');
  const thisMonth    = entries.filter(e => e.date?.slice(0, 7) === thisMonthKey).length;
  const longest      = entries.reduce((max, e) => Math.max(max, e.durationMinutes ?? 0), 0);

  // Live duration preview in modal
  const previewMins = (() => {
    if (!form.startTime || !form.endTime || form.endTime <= form.startTime) return null;
    const [sh, sm] = form.startTime.split(':').map(Number);
    const [eh, em] = form.endTime.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  })();

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-semibold shadow-xl border
          ${toast.type === 'error'
            ? 'bg-red-950/90 text-red-300 border-red-700/50'
            : 'bg-deep text-cyan border-cyan/30'}`}>
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div className="panel px-5 py-4 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
              <span className="w-4 h-4 text-amber-400"><SunIcon /></span>
            </div>
            <div>
              <h2 className="font-heading font-black text-ink text-lg leading-tight">Sunshine Days</h2>
              <p className="text-xs text-fog mt-0.5">Log park closures that lasted 90 consecutive minutes or more</p>
            </div>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 text-sm font-semibold transition-colors shrink-0">
            <span className="text-base leading-none font-bold">+</span> Log Closure
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-rim/30">
          <div>
            <p className="label-xs text-fog">Total Logged</p>
            <p className="text-xl font-heading font-black text-ink mt-0.5">{entries.length}</p>
          </div>
          <div>
            <p className="label-xs text-fog">This Month</p>
            <p className="text-xl font-heading font-black text-ink mt-0.5">{thisMonth}</p>
          </div>
          <div>
            <p className="label-xs text-fog">Longest Closure</p>
            <p className="text-xl font-heading font-black text-amber-400 mt-0.5">{durText(longest)}</p>
          </div>
        </div>
      </div>

      {/* Log table */}
      <div className="panel flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-fog py-20">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <span className="w-6 h-6 text-amber-400/50"><SunIcon /></span>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-fog-hi">No closures logged yet</p>
              <p className="text-xs text-fog mt-1">Log your first sunshine day closure to get started.</p>
            </div>
            <button onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 text-sm font-semibold transition-colors mt-1">
              + Log First Closure
            </button>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-rim/40 bg-deep/60 sticky top-0 z-10">
                <Th>Date</Th>
                <Th>Day</Th>
                <Th>Closed</Th>
                <Th>Reopened</Th>
                <Th>Duration</Th>
                <Th>Notes</Th>
                <Th>Logged By</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rim/10">
              {entries.map(e => {
                const d = parseISO(e.date);
                const mins = e.durationMinutes;
                return (
                  <tr key={e.id} className="hover:bg-shell/20 transition-colors group">
                    <Td bold>{format(d, 'MMM d, yyyy')}</Td>
                    <Td muted>{format(d, 'EEEE')}</Td>
                    <Td>{fmt12(e.startTime)}</Td>
                    <Td>
                      {e.endTime
                        ? fmt12(e.endTime)
                        : <span className="italic text-amber-400/80 text-10">Ongoing</span>}
                    </Td>
                    <Td>
                      {mins ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-10 font-bold border
                          ${mins >= 180
                            ? 'bg-red-500/10 text-red-400 border-red-500/20'
                            : mins >= 120
                            ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                          {durText(mins)}
                        </span>
                      ) : (
                        <span className="text-fog">—</span>
                      )}
                    </Td>
                    <Td muted className="max-w-xs">
                      <span className="block truncate">{e.notes || '—'}</span>
                    </Td>
                    <Td muted>{e.loggedByName || '—'}</Td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(e)}
                          className="text-fog hover:text-cyan transition-colors" title="Edit">
                          <EditIcon />
                        </button>
                        <button onClick={() => confirmDelete(e)} disabled={deleting === e.id}
                          className="text-fog hover:text-red-400 transition-colors disabled:opacity-30" title="Delete">
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Log / Edit modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !saving && setModal(null)} />
          <div className="relative panel-raised w-full max-w-md shadow-2xl">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-rim/40">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                  <span className="w-4 h-4 text-amber-400"><SunIcon /></span>
                </div>
                <h2 className="font-heading font-bold text-ink text-base">
                  {modal === 'add' ? 'Log Park Closure' : 'Edit Closure'}
                </h2>
              </div>
              <button onClick={() => !saving && setModal(null)}
                className="text-fog hover:text-ink transition-colors text-2xl leading-none">×</button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 space-y-4">
              <div>
                <p className="label-xs mb-1.5">Date <span className="text-red-400">*</span></p>
                <input type="date" value={form.date} onChange={patch('date')} className="field" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="label-xs mb-1.5">Closed at <span className="text-red-400">*</span></p>
                  <input type="time" value={form.startTime} onChange={patch('startTime')} className="field" />
                </div>
                <div>
                  <p className="label-xs mb-1.5">Reopened at</p>
                  <input type="time" value={form.endTime} onChange={patch('endTime')} className="field" />
                  <p className="text-10 text-fog mt-1">Leave blank if still closed</p>
                </div>
              </div>

              {/* Live duration preview */}
              {previewMins !== null && (
                <div className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border text-sm font-semibold
                  ${previewMins >= 90
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                    : 'bg-shell border-rim/40 text-fog-hi'}`}>
                  <span className="w-4 h-4 shrink-0"><SunIcon /></span>
                  <span>
                    Duration: <strong>{durText(previewMins)}</strong>
                    {previewMins < 90 && <span className="text-fog font-normal ml-2 text-xs">· Under 90-min threshold</span>}
                    {previewMins >= 90 && <span className="text-amber-400/70 font-normal ml-2 text-xs">· Policy triggered</span>}
                  </span>
                </div>
              )}

              <div>
                <p className="label-xs mb-1.5">Notes</p>
                <textarea value={form.notes} onChange={patch('notes')} rows={3}
                  placeholder="Weather conditions, reason for closure…"
                  className="field resize-none" />
              </div>

              {formErr && (
                <p className="text-red-400 text-xs font-semibold flex items-center gap-1.5">
                  <span>⚠</span>{formErr}
                </p>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-rim/40">
              <button onClick={() => setModal(null)} disabled={saving}
                className="btn-ghost border border-rim/60 px-4 py-2 disabled:opacity-40 text-sm">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all disabled:opacity-40 flex items-center gap-2">
                {saving && <span className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />}
                {saving ? 'Saving…' : modal === 'add' ? 'Log Closure' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function durText(m) {
  if (!m) return '—';
  const h = Math.floor(m / 60), mins = m % 60;
  return h > 0 ? `${h}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
}

function fmt12(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDate(dateStr) {
  try { return format(parseISO(dateStr), 'MMM d, yyyy'); } catch { return dateStr; }
}

function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-left text-10 font-bold tracking-widest uppercase text-fog whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, bold, muted, className = '' }) {
  return (
    <td className={`px-4 py-3 ${bold ? 'text-ink font-semibold' : muted ? 'text-fog' : 'text-fog-hi'} ${className}`}>
      {children}
    </td>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2"  x2="12" y2="4"  />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"  />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2"  y1="12" x2="4"  y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36" />
      <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"  />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}
