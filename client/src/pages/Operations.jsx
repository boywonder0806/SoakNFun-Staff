import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const SUB_PAGES = [
  { id: 'sunshine', label: 'Sunshine Days', icon: SunIcon },
];

export default function Operations() {
  const [activePage, setActivePage] = useState('sunshine');
  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Left sub-nav */}
      <aside className="w-52 shrink-0 panel flex flex-col gap-1 py-3">
        <p className="label-xs px-4 mb-2">Operations</p>
        {SUB_PAGES.map(p => {
          const Icon = p.icon;
          const active = activePage === p.id;
          return (
            <button key={p.id} onClick={() => setActivePage(p.id)}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 rounded-lg mx-1 transition-colors
                ${active ? 'bg-amber-500/10 border border-amber-500/20 text-ink' : 'hover:bg-shell/60 text-fog-hi border border-transparent'}`}>
              <span className={`shrink-0 w-4 h-4 ${active ? 'text-amber-400' : 'text-fog'}`}><Icon /></span>
              <span className="text-xs font-semibold">{p.label}</span>
            </button>
          );
        })}
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 min-h-0">
        {activePage === 'sunshine' && <SunshineDays />}
      </div>
    </div>
  );
}

// ── Sunshine Days ─────────────────────────────────────────────────────────────

function SunshineDays() {
  const { user } = useAuth();
  const [entries,  setEntries]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null);  // null | 'add' | entry object (edit)
  const [deleting, setDeleting] = useState(null);
  const [toast,    setToast]    = useState(null);

  const BLANK = { date: format(new Date(), 'yyyy-MM-dd'), startTime: '', endTime: '', notes: '' };
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/operations/sunshine');
      setEntries(data.entries);
    } catch { /* empty */ } finally { setLoading(false); }
  }

  function openAdd() {
    setForm(BLANK);
    setFormErr('');
    setModal('add');
  }

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

  function patch(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

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

  // Stats
  const now = new Date();
  const thisMonth = entries.filter(e => e.date?.slice(0, 7) === format(now, 'yyyy-MM'));
  const longest   = entries.reduce((max, e) => Math.max(max, e.durationMinutes ?? 0), 0);

  const durText = m => {
    if (!m) return '—';
    const h = Math.floor(m / 60), mins = m % 60;
    return h > 0 ? `${h}h ${mins > 0 ? mins + 'm' : ''}`.trim() : `${mins}m`;
  };

  const durColor = m => {
    if (!m) return 'text-fog';
    if (m >= 180) return 'text-red-400';
    if (m >= 120) return 'text-orange-400';
    return 'text-amber-400';
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-semibold shadow-lg
          ${toast.type === 'error' ? 'bg-red-900/80 text-red-200 border border-red-700/60' : 'bg-deep border border-cyan/30 text-cyan'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="panel px-5 py-4 flex items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 text-amber-400"><SunIcon /></span>
            <h2 className="font-heading font-black text-ink text-lg leading-tight">Sunshine Days</h2>
          </div>
          <p className="text-xs text-fog mt-0.5 ml-7.5">Log park closures of 90 minutes or more</p>
        </div>
        <button onClick={openAdd} className="btn-primary px-4 py-2 flex items-center gap-2 shrink-0">
          <span className="text-base leading-none">+</span> Log Closure
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 shrink-0">
        {[
          { label: 'Total Logged',  value: entries.length },
          { label: 'This Month',   value: thisMonth.length },
          { label: 'Longest Closure', value: durText(longest) },
        ].map(s => (
          <div key={s.label} className="panel px-5 py-4">
            <p className="label-xs">{s.label}</p>
            <p className="text-2xl font-heading font-black text-ink mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="panel flex-1 min-h-0 overflow-auto">
        {loading ? (
          <p className="px-5 py-8 text-center text-xs text-fog">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-fog py-16">
            <span className="w-10 h-10 opacity-20"><SunIcon /></span>
            <p className="text-sm">No closures logged yet.</p>
            <button onClick={openAdd} className="btn-primary px-4 py-2 text-xs">Log First Closure</button>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-deep border-b border-rim/40">
                <Th>Date</Th><Th>Day</Th><Th>Start</Th><Th>End</Th>
                <Th>Duration</Th><Th>Notes</Th><Th>Logged By</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const d = parseISO(e.date);
                return (
                  <tr key={e.id} className="border-t border-rim/10 hover:bg-shell/20 group">
                    <Td className="font-semibold text-ink">{format(d, 'MMM d, yyyy')}</Td>
                    <Td className="text-fog">{format(d, 'EEEE')}</Td>
                    <Td>{fmt12(e.startTime)}</Td>
                    <Td>{e.endTime ? fmt12(e.endTime) : <span className="text-amber-400 italic">Ongoing</span>}</Td>
                    <Td>
                      <span className={`font-bold ${durColor(e.durationMinutes)}`}>
                        {durText(e.durationMinutes)}
                      </span>
                    </Td>
                    <Td className="text-fog max-w-xs truncate">{e.notes || '—'}</Td>
                    <Td className="text-fog">{e.loggedByName || '—'}</Td>
                    <Td>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(e)} className="text-fog hover:text-cyan transition-colors" title="Edit">
                          <EditIcon />
                        </button>
                        <button onClick={() => confirmDelete(e)} disabled={deleting === e.id}
                          className="text-fog hover:text-red-400 transition-colors disabled:opacity-40" title="Delete">
                          <TrashIcon />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModal(null)} />
          <div className="relative panel-raised w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-rim/40">
              <div className="flex items-center gap-2.5">
                <span className="w-5 h-5 text-amber-400"><SunIcon /></span>
                <h2 className="font-heading font-bold text-ink text-base">
                  {modal === 'add' ? 'Log Closure' : 'Edit Closure'}
                </h2>
              </div>
              <button onClick={() => setModal(null)} className="text-fog hover:text-ink text-2xl leading-none">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <p className="label-xs mb-1.5">Date <span className="text-red-400">*</span></p>
                <input type="date" value={form.date} onChange={patch('date')} className="field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="label-xs mb-1.5">Closure Start <span className="text-red-400">*</span></p>
                  <input type="time" value={form.startTime} onChange={patch('startTime')} className="field" />
                </div>
                <div>
                  <p className="label-xs mb-1.5">Reopened At</p>
                  <input type="time" value={form.endTime} onChange={patch('endTime')} className="field" />
                  <p className="text-10 text-fog mt-1">Leave blank if still closed</p>
                </div>
              </div>

              {/* Duration preview */}
              {form.startTime && form.endTime && form.endTime > form.startTime && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20">
                  <span className="w-3.5 h-3.5 text-amber-400 shrink-0"><SunIcon /></span>
                  <p className="text-xs text-amber-300 font-semibold">
                    Duration: {(() => {
                      const [sh, sm] = form.startTime.split(':').map(Number);
                      const [eh, em] = form.endTime.split(':').map(Number);
                      const m = (eh * 60 + em) - (sh * 60 + sm);
                      const h = Math.floor(m / 60);
                      return h > 0 ? `${h}h ${m % 60 > 0 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`;
                    })()}
                  </p>
                </div>
              )}

              <div>
                <p className="label-xs mb-1.5">Notes</p>
                <textarea
                  value={form.notes}
                  onChange={patch('notes')}
                  rows={3}
                  placeholder="Reason for closure, weather conditions, etc."
                  className="field resize-none text-sm"
                />
              </div>

              {formErr && <p className="text-red-400 text-xs font-semibold">{formErr}</p>}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-rim/40">
              <button onClick={() => setModal(null)} disabled={saving} className="btn-ghost border border-rim/60 disabled:opacity-40">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all disabled:opacity-40">
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

function fmt12(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDate(dateStr) {
  try { return format(parseISO(dateStr), 'MMM d, yyyy'); } catch { return dateStr; }
}

function Th({ children }) {
  return <th className="px-4 py-2.5 text-left text-10 font-bold tracking-widest uppercase text-fog whitespace-nowrap">{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 text-fog-hi ${className}`}>{children}</td>;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-full h-full">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2"  x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22"  x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2"  y1="12" x2="4"  y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
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
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  );
}
