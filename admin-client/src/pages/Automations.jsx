import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api.js';

const HEALTH_META = {
  healthy:  { dot: 'bg-emerald-500', label: 'Healthy',           text: 'text-emerald-600' },
  stale:    { dot: 'bg-amber-500',   label: 'Stale',             text: 'text-amber-600' },
  error:    { dot: 'bg-red-500',     label: 'Failing',           text: 'text-red-600' },
  unknown:  { dot: 'bg-gray-300',    label: 'No runs yet',       text: 'text-gray-400' },
  inactive: { dot: 'bg-gray-300',    label: 'Disabled',          text: 'text-gray-400' },
  manual:   { dot: 'bg-sky-400',     label: 'Manually tracked',  text: 'text-sky-600' },
};

const CATEGORY_META = {
  sync:         { label: 'Data Sync',    badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  integration:  { label: 'Integration',  badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  notification: { label: 'Notification', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  other:        { label: 'Other',        badge: 'bg-gray-50 text-gray-600 border-gray-200' },
};

function relTime(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function fmtDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDT(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  }) : '—';
}

export default function Automations() {
  const [automations, setAutomations] = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [runningKey, setRunningKey] = useState(null);
  const [toast, setToast]     = useState(null);

  function notify(msg, isError = false) {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3200);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/admin/automations');
      setAutomations(data.automations);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load automations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runNow(key) {
    setRunningKey(key);
    try {
      const { data } = await api.post(`/admin/automations/${key}/run`);
      notify(data.summary || 'Run complete');
      await load();
    } catch (err) {
      notify(err.response?.data?.error || 'Run failed', true);
    } finally {
      setRunningKey(null);
    }
  }

  async function toggleActive(a) {
    setAutomations(prev => prev.map(x => x.key === a.key ? { ...x, isActive: !x.isActive } : x));
    try {
      await api.patch(`/admin/automations/${a.key}`, { isActive: !a.isActive });
    } catch (err) {
      setAutomations(prev => prev.map(x => x.key === a.key ? { ...x, isActive: a.isActive } : x));
      notify(err.response?.data?.error || 'Failed to update', true);
    }
  }

  async function saveNotes(key, notes) {
    try {
      await api.patch(`/admin/automations/${key}`, { notes });
      setAutomations(prev => prev.map(x => x.key === key ? { ...x, notes } : x));
      notify('Notes saved');
    } catch (err) {
      notify(err.response?.data?.error || 'Failed to save notes', true);
    }
  }

  async function deleteAutomation(key) {
    try {
      await api.delete(`/admin/automations/${key}`);
      setAutomations(prev => prev.filter(x => x.key !== key));
      setOpenKey(null);
      notify('Removed');
    } catch (err) {
      notify(err.response?.data?.error || 'Failed to remove', true);
    }
  }

  const summary = automations?.reduce((s, a) => {
    const h = a.health;
    s[h] = (s[h] || 0) + 1;
    return s;
  }, {}) || {};

  return (
    <div className="max-w-5xl mx-auto px-8 py-6 space-y-5">

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-3 animate-fade-up">
        <div className="flex items-center gap-4 bg-white rounded-2xl border border-gray-200 px-5 py-3 flex-1 min-w-[280px] flex-wrap">
          {['healthy', 'stale', 'error', 'unknown', 'manual', 'inactive'].map(k => (
            (summary[k] || 0) > 0 && (
              <span key={k} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <span className={`w-2 h-2 rounded-full ${HEALTH_META[k].dot}`} />
                {summary[k]} {HEALTH_META[k].label}
              </span>
            )
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} disabled={loading} className="btn-ghost text-xs py-2.5">
            <RefreshIcon spinning={loading} /> Refresh
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-xs py-2.5 px-4">
            <PlusIcon /> Track Automation
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-sm text-red-600 text-center">{error}</div>
      )}

      {loading && !automations ? (
        <div className="flex items-center justify-center h-56 bg-white rounded-2xl border border-gray-200">
          <div className="w-6 h-6 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
        </div>
      ) : automations && automations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          No automations tracked yet.
        </div>
      ) : automations && (
        <div className="space-y-3">
          {automations.map(a => (
            <AutomationCard
              key={a.key}
              a={a}
              open={openKey === a.key}
              onToggleOpen={() => setOpenKey(openKey === a.key ? null : a.key)}
              onRunNow={() => runNow(a.key)}
              running={runningKey === a.key}
              onToggleActive={() => toggleActive(a)}
              onSaveNotes={notes => saveNotes(a.key, notes)}
              onDelete={() => deleteAutomation(a.key)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center pb-4">
        Managed automations are defined in code and re-register themselves on every deploy — notes and the active
        toggle are the only editable fields there. Manually tracked entries are pure documentation for anything
        running outside this app (a system cron job, an external script) and have no automatic health checks.
      </p>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-xl animate-fade-up
          ${toast.isError ? 'bg-red-600' : 'bg-gray-900'}`}>
          {toast.msg}
        </div>
      )}

      {showAdd && (
        <AddAutomationModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}

function AutomationCard({ a, open, onToggleOpen, onRunNow, running, onToggleActive, onSaveNotes, onDelete }) {
  const meta = HEALTH_META[a.health] || HEALTH_META.unknown;
  const cat = CATEGORY_META[a.category] || CATEGORY_META.other;
  const [notesDraft, setNotesDraft] = useState(a.notes || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const notesDirty = notesDraft !== (a.notes || '');

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${a.health === 'error' ? 'border-red-200' : 'border-gray-200'}`}>
      <button onClick={onToggleOpen} className="w-full text-left p-5 flex items-start gap-4 hover:bg-gray-50/60 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900">{a.name}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${cat.badge}`}>{cat.label}</span>
            {a.source === 'manual' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-sky-50 text-sky-700 border-sky-200">Manual</span>
            )}
          </div>
          {a.description && <p className="text-xs text-gray-400 mt-1 leading-relaxed">{a.description}</p>}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
            {a.scheduleDescription && <span>{a.scheduleDescription}</span>}
            {a.source === 'managed' && (
              <span>
                last run {relTime(a.lastStartedAt)}
                {a.lastSummary ? ` · ${a.lastSummary}` : ''}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.text}`}>
            <span className={`w-2 h-2 rounded-full ${meta.dot} ${a.health === 'healthy' ? 'animate-pulse' : ''}`} />
            {meta.label}
          </span>
          {a.source === 'managed' && a.recentRunCount > 0 && (
            <p className="text-[11px] text-gray-400 mt-1">{a.recentSuccessCount}/{a.recentRunCount} ok · {fmtDuration(a.avgDurationMs)} avg</p>
          )}
        </div>
      </button>

      {a.health === 'error' && a.lastError && (
        <p className="mx-5 mb-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">{a.lastError}</p>
      )}

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4 bg-gray-50/40">
          <div className="flex items-center gap-2 flex-wrap">
            {a.canRunNow && (
              <button onClick={onRunNow} disabled={running} className="btn-ghost text-xs py-2 px-3">
                {running ? 'Running…' : <><PlayIcon /> Run Now</>}
              </button>
            )}
            <button onClick={onToggleActive} className="btn-ghost text-xs py-2 px-3">
              {a.isActive ? 'Disable' : 'Enable'}
            </button>
            {a.source === 'manual' && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} className="text-xs font-medium px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                Remove
              </button>
            )}
            {confirmDelete && (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="text-gray-500">Remove this tracked automation?</span>
                <button onClick={onDelete} className="font-semibold text-red-600 hover:underline">Yes, remove</button>
                <button onClick={() => setConfirmDelete(false)} className="text-gray-400 hover:underline">Cancel</button>
              </span>
            )}
          </div>

          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Notes</label>
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder="Anything worth remembering about this automation…"
              rows={2}
              className="field text-xs resize-none"
            />
            {notesDirty && (
              <div className="flex gap-2 mt-1.5">
                <button onClick={() => onSaveNotes(notesDraft)} className="text-xs font-semibold text-admin hover:underline">Save notes</button>
                <button onClick={() => setNotesDraft(a.notes || '')} className="text-xs text-gray-400 hover:underline">Cancel</button>
              </div>
            )}
          </div>

          {a.source === 'managed' && <RunHistory automationKey={a.key} />}
        </div>
      )}
    </div>
  );
}

function RunHistory({ automationKey }) {
  const [runs, setRuns] = useState(null);

  useEffect(() => {
    setRuns(null);
    api.get(`/admin/automations/${automationKey}/runs?limit=20`)
      .then(r => setRuns(r.data.runs))
      .catch(() => setRuns([]));
  }, [automationKey]);

  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Recent Runs</label>
      {runs === null ? (
        <div className="h-10 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-admin/20 border-t-admin rounded-full animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <p className="text-xs text-gray-400">No runs recorded yet.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 max-h-64 overflow-y-auto">
          {runs.map(r => (
            <div key={r.id} className="px-3 py-2 flex items-start gap-2.5 text-xs">
              <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-gray-700 truncate">{r.error || r.summary || (r.status === 'success' ? 'Completed' : 'Failed')}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{fmtDT(r.startedAt)} · {fmtDuration(r.durationMs)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddAutomationModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', category: 'other', scheduleDescription: '', notes: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post('/admin/automations', form);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #7c2d12, #ea580c)' }}>
          <div>
            <h2 className="text-base font-bold text-white">Track an Automation</h2>
            <p className="text-xs text-white/70 mt-0.5">For anything running outside this app — a system cron job, an external script</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors">
            <CloseIcon />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}
          <div>
            <label className="label">Name</label>
            <input className="field" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Nightly database backup" />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="field" value={form.description} onChange={e => set('description', e.target.value)} placeholder="What does it do?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <select className="field" value={form.category} onChange={e => set('category', e.target.value)}>
                {Object.entries(CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Schedule</label>
              <input className="field" value={form.scheduleDescription} onChange={e => set('scheduleDescription', e.target.value)} placeholder="e.g. Daily at 3 AM" />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="field text-sm resize-none" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Where it lives, how to check on it, anything worth remembering…" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary w-full py-2.5">
            {saving ? 'Saving…' : 'Start Tracking'}
          </button>
        </form>
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
