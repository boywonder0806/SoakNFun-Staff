import { useState, useEffect } from 'react';
import api from '../lib/api.js';

const todayStr = new Date().toDateString();

const TEMPLATES_KEY = 'bayou_call_templates';

const DEFAULT_TEMPLATES = [
  { id: 1,  label: 'General Park Question', reason: 'General park question'           },
  { id: 2,  label: 'Ticket Pricing',        reason: 'Ticket pricing inquiry'           },
  { id: 3,  label: 'Operating Hours',       reason: 'Operating hours inquiry'          },
  { id: 4,  label: 'Group / Event Rates',   reason: 'Group rates or event inquiry'     },
  { id: 5,  label: 'Birthday Party',        reason: 'Birthday party booking inquiry'   },
  { id: 6,  label: 'Season Passes',         reason: 'Season pass inquiry'              },
  { id: 7,  label: 'Accessibility',         reason: 'Accessibility or ADA inquiry'     },
  { id: 8,  label: 'Lost Item',             reason: 'Lost item report'                 },
  { id: 9,  label: 'Food & Dining',         reason: 'Food and dining inquiry'          },
  { id: 10, label: 'Employment',            reason: 'Employment inquiry'               },
  { id: 11, label: 'Complaint',             reason: 'Guest complaint'                  },
  { id: 12, label: 'Directions / Parking',  reason: 'Directions or parking inquiry'    },
];

function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_TEMPLATES;
}

function saveTemplates(tpls) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(tpls));
}

let _nextId = Date.now();

function getStatusMeta(call) {
  if (call.needsCallback) {
    if (call.callbackStatus === 'completed')       return { label: 'Completed',       color: 'bg-green-100 text-green-700' };
    if (call.callbackStatus === 'unable_to_reach') return { label: 'Unable to Reach', color: 'bg-red-100 text-red-600'    };
    return { label: 'Callback', color: 'bg-amber-100 text-amber-700' };
  }
  if (call.resolved) return { label: 'Resolved', color: 'bg-gray-100 text-gray-500' };
  return null;
}

function isPendingCallback(call) {
  return call.needsCallback && (!call.callbackStatus || call.callbackStatus === 'pending');
}

export default function CallLog({ onTodayCallsCount, onPendingCallbacksCount }) {
  const [calls, setCalls]       = useState([]);
  const [staff, setStaff]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew]   = useState(false);
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');

  function updateCounts(list) {
    onTodayCallsCount?.(list.filter(c => new Date(c.createdAt).toDateString() === todayStr).length);
    onPendingCallbacksCount?.(list.filter(isPendingCallback).length);
  }

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [callsRes, staffRes] = await Promise.all([
        api.get('/reception/calls'),
        api.get('/reception/staff'),
      ]);
      setCalls(callsRes.data.calls);
      setStaff(staffRes.data.staff);
      updateCounts(callsRes.data.calls);
    } catch {}
    setLoading(false);
  }

  function applyUpdate(updated) {
    setCalls(prev => {
      const next = prev.map(c => c.id === updated.id ? updated : c);
      updateCounts(next);
      return next;
    });
    setSelected(updated);
  }

  async function updateCallbackStatus(id, callbackStatus) {
    try {
      const { data } = await api.patch(`/reception/calls/${id}`, { callbackStatus });
      applyUpdate(data.call);
    } catch {}
  }

  async function toggleResolved(id, resolved) {
    try {
      const { data } = await api.patch(`/reception/calls/${id}`, { resolved });
      applyUpdate(data.call);
    } catch {}
  }

  async function saveEdit(id, payload) {
    try {
      const { data } = await api.patch(`/reception/calls/${id}`, payload);
      applyUpdate(data.call);
      return true;
    } catch { return false; }
  }

  async function deleteCall(id) {
    if (!window.confirm('Delete this call entry?')) return;
    try {
      await api.delete(`/reception/calls/${id}`);
      setCalls(prev => {
        const next = prev.filter(c => c.id !== id);
        updateCounts(next);
        return next;
      });
      setSelected(null);
    } catch {}
  }

  function handleCreated(call) {
    setCalls(prev => {
      const next = [call, ...prev];
      updateCounts(next);
      return next;
    });
    setShowNew(false);
    setSelected(call);
  }

  function openNew() {
    setShowNew(true);
    setSelected(null);
  }

  const visible = calls.filter(c => {
    if (filter === 'callbacks') {
      if (!isPendingCallback(c)) return false;
    }
    if (filter === 'resolved') {
      const done = (!c.needsCallback && c.resolved) ||
                   (c.needsCallback && c.callbackStatus && c.callbackStatus !== 'pending');
      if (!done) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (c.callerName || '').toLowerCase().includes(q)
          || (c.callerPhone || '').includes(q)
          || (c.reason || '').toLowerCase().includes(q)
          || (c.requestedStaffName || '').toLowerCase().includes(q);
    }
    return true;
  });

  const pendingCallbacks = calls.filter(isPendingCallback).length;

  return (
    <div className="flex h-full overflow-hidden">

      {/* Left: List Panel */}
      <div className="w-[360px] shrink-0 bg-white border-r border-gray-200 flex flex-col">

        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Calls</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {pendingCallbacks > 0
                ? `${pendingCallbacks} pending callback${pendingCallbacks !== 1 ? 's' : ''}`
                : 'No pending callbacks'}
            </p>
          </div>
          <button
            onClick={openNew}
            className={`btn-primary transition-opacity ${showNew ? 'opacity-50 pointer-events-none' : ''}`}>
            <PlusIcon /> Log Call
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 space-y-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {[['all','All'],['callbacks','Callbacks'],['resolved','Resolved']].map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors
                  ${filter === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {l}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search caller, reason, staff…"
            className="field text-xs"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 flex justify-center"><Spinner className="w-5 h-5 text-brand" /></div>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">No calls found.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {visible.map(call => (
                <CallRow
                  key={call.id}
                  call={call}
                  isSelected={!showNew && selected?.id === call.id}
                  onClick={() => { setSelected(call); setShowNew(false); }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Detail / New-call Panel */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {showNew ? (
          <NewCallPanel
            staff={staff}
            onSave={handleCreated}
            onCancel={() => setShowNew(false)}
          />
        ) : selected ? (
          <CallDetail
            key={selected.id}
            call={selected}
            staff={staff}
            onCallbackStatus={(status) => updateCallbackStatus(selected.id, status)}
            onResolvedToggle={() => toggleResolved(selected.id, !selected.resolved)}
            onSave={(payload) => saveEdit(selected.id, payload)}
            onDelete={() => deleteCall(selected.id)}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-400">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l1.62-1.62a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <p className="text-gray-500 font-medium">Select a call to view details</p>
              <p className="text-sm text-gray-400 mt-1">or log a new one above</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── New call inline form ───────────────────────────────────────────────────────
function NewCallPanel({ staff, onSave, onCancel }) {
  const [form, setForm] = useState({
    callerName: '', callerPhone: '', reason: '', notes: '',
    needsCallback: false, requestedStaffId: '',
  });
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [templates, setTemplates]   = useState(loadTemplates);
  const [showManager, setShowManager] = useState(false);

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })); }

  function applyTemplates(next) {
    setTemplates(next);
    saveTemplates(next);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.callerPhone.trim()) { setError('Phone number is required.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/reception/calls', {
        callerName:       form.callerName  || null,
        callerPhone:      form.callerPhone.trim(),
        callDirection:    'inbound',
        reason:           form.reason      || null,
        notes:            form.notes       || null,
        needsCallback:    form.needsCallback,
        requestedStaffId: form.needsCallback && form.requestedStaffId
          ? parseInt(form.requestedStaffId) : null,
      });
      onSave(data.call);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log call.');
    } finally { setSaving(false); }
  }

  return (
    <div className="relative max-w-2xl mx-auto p-6 space-y-5">

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-lg font-bold text-gray-900">New Inbound Call</h3>
        <p className="text-xs text-gray-400 mt-0.5">Phone number is required</p>
      </div>

      {/* Quick templates */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Quick Templates</p>
          <button
            type="button"
            onClick={() => setShowManager(true)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand transition-colors"
          >
            <GearIcon /> Edit
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {templates.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setForm(p => ({ ...p, reason: t.reason }))}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                ${form.reason === t.reason
                  ? 'bg-brand text-white border-brand'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-brand hover:text-brand'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Phone Number *</label>
              <input
                className="field"
                placeholder="(225) 555-0100"
                value={form.callerPhone}
                onChange={set('callerPhone')}
                autoFocus
              />
            </div>
            <div>
              <label className="label">Caller Name</label>
              <input
                className="field"
                placeholder="John Smith"
                value={form.callerName}
                onChange={set('callerName')}
              />
            </div>
          </div>

          <div>
            <label className="label">Reason / Subject</label>
            <input
              className="field"
              placeholder="What was the call about?"
              value={form.reason}
              onChange={set('reason')}
            />
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="field resize-none"
              rows={3}
              placeholder="Additional details…"
              value={form.notes}
              onChange={set('notes')}
            />
          </div>

          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 accent-brand"
                checked={form.needsCallback}
                onChange={e => setForm(p => ({ ...p, needsCallback: e.target.checked }))}
              />
              <span className="text-sm font-medium text-gray-900">Needs Callback</span>
            </label>
            {form.needsCallback && (
              <div>
                <label className="label">Requested Staff Member</label>
                <select className="field" value={form.requestedStaffId} onChange={set('requestedStaffId')}>
                  <option value="">— Not specified —</option>
                  {staff.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.position ? ` (${s.position})` : ''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onCancel} className="btn-ghost flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? <><Spinner /> Saving…</> : 'Save Call'}
            </button>
          </div>
        </form>
      </div>

      {/* Template manager drawer */}
      {showManager && (
        <TemplateManagerDrawer
          templates={templates}
          onChange={applyTemplates}
          onClose={() => setShowManager(false)}
        />
      )}
    </div>
  );
}

// ── Template manager side drawer ───────────────────────────────────────────────
function TemplateManagerDrawer({ templates, onChange, onClose }) {
  const [items, setItems] = useState(() => templates.map(t => ({ ...t })));

  function updateItem(id, field, value) {
    setItems(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  }

  function deleteItem(id) {
    setItems(prev => prev.filter(t => t.id !== id));
  }

  function addItem() {
    setItems(prev => [...prev, { id: ++_nextId, label: '', reason: '' }]);
  }

  function handleSave() {
    const clean = items.filter(t => t.label.trim() || t.reason.trim());
    onChange(clean);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[420px] h-full bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="text-base font-bold text-gray-900">Manage Templates</h3>
            <p className="text-xs text-gray-400 mt-0.5">Changes save when you click Done</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {items.map((t, i) => (
            <div key={t.id} className="bg-gray-50 rounded-xl border border-gray-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-medium w-4 shrink-0 text-center">{i + 1}</span>
                <input
                  className="field text-sm font-medium flex-1"
                  placeholder="Button label (e.g. Ticket Pricing)"
                  value={t.label}
                  onChange={e => updateItem(t.id, 'label', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => deleteItem(t.id)}
                  className="p-1.5 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                  title="Remove"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                </button>
              </div>
              <div className="pl-6">
                <input
                  className="field text-xs text-gray-500"
                  placeholder="Reason text pre-filled in form (e.g. Ticket pricing inquiry)"
                  value={t.reason}
                  onChange={e => updateItem(t.id, 'reason', e.target.value)}
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addItem}
            className="w-full py-3 text-sm text-brand border-2 border-dashed border-brand/30 rounded-xl hover:border-brand hover:bg-brand/5 transition-colors font-medium"
          >
            + Add Template
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="button" onClick={handleSave} className="btn-primary flex-1">Done</button>
        </div>
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Call list row ──────────────────────────────────────────────────────────────
function CallRow({ call, isSelected, onClick }) {
  const meta = getStatusMeta(call);
  const displayName = call.callerName || call.callerPhone;
  const showPhone   = !!call.callerName;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-5 py-3.5 transition-colors
        ${isSelected
          ? 'bg-brand/5 border-l-[3px] border-brand'
          : 'hover:bg-gray-50 border-l-[3px] border-transparent'}`}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-semibold text-sm text-gray-900 truncate">{displayName}</span>
        {meta && <span className={`badge shrink-0 ${meta.color}`}>{meta.label}</span>}
      </div>
      {showPhone && <p className="text-xs text-gray-500 mb-1">{call.callerPhone}</p>}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        {call.reason && <span className="truncate max-w-[210px]">{call.reason}</span>}
        <span className="ml-auto shrink-0">{fmtTime(call.createdAt)}</span>
      </div>
    </button>
  );
}

// ── Call detail / edit panel ───────────────────────────────────────────────────
function CallDetail({ call, staff, onCallbackStatus, onResolvedToggle, onSave, onDelete }) {
  const meta    = getStatusMeta(call);
  const pending = isPendingCallback(call);

  const [form, setForm] = useState({
    callerName:       call.callerName    || '',
    callerPhone:      call.callerPhone   || '',
    reason:           call.reason        || '',
    notes:            call.notes         || '',
    needsCallback:    call.needsCallback || false,
    requestedStaffId: call.requestedStaffId ? String(call.requestedStaffId) : '',
  });
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const ok = await onSave({
      callerName:       form.callerName    || null,
      callerPhone:      form.callerPhone   || null,
      reason:           form.reason        || null,
      notes:            form.notes         || null,
      needsCallback:    form.needsCallback,
      requestedStaffId: form.needsCallback && form.requestedStaffId
                          ? parseInt(form.requestedStaffId) : null,
    });
    setSaving(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  }

  async function handleCallbackStatus(status) {
    setStatusSaving(true);
    await onCallbackStatus(status);
    setStatusSaving(false);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-xl font-bold text-gray-900">
              {call.callerName || call.callerPhone || 'Unknown Caller'}
            </h3>
            {call.callerName && <p className="text-gray-500 mt-0.5">{call.callerPhone}</p>}
          </div>
          {meta && <span className={`badge ${meta.color} px-3 py-1 text-sm`}>{meta.label}</span>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400 border-t border-gray-100 pt-3">
          <span>Logged by <span className="text-gray-600 font-medium">{call.loggedByName || 'unknown'}</span> · {fmtTime(call.createdAt)}</span>
          {call.needsCallback && call.callbackCompletedByName && (
            <span>Resolved by <span className="text-gray-600 font-medium">{call.callbackCompletedByName}</span> · {fmtTime(call.callbackCompletedAt)}</span>
          )}
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Details</h4>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Phone Number</label>
              <input className="field" value={form.callerPhone} onChange={set('callerPhone')} />
            </div>
            <div>
              <label className="label">Caller Name</label>
              <input className="field" value={form.callerName} onChange={set('callerName')} />
            </div>
          </div>

          <div>
            <label className="label">Reason / Subject</label>
            <input className="field" placeholder="What was the call about?" value={form.reason} onChange={set('reason')} />
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="field resize-none" rows={3} value={form.notes} onChange={set('notes')} />
          </div>

          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 accent-brand"
                checked={form.needsCallback}
                onChange={e => setForm(p => ({ ...p, needsCallback: e.target.checked }))}
              />
              <span className="text-sm font-medium text-gray-900">Needs Callback</span>
            </label>
            {form.needsCallback && (
              <div>
                <label className="label">Requested Staff</label>
                <select className="field" value={form.requestedStaffId} onChange={set('requestedStaffId')}>
                  <option value="">— Not specified —</option>
                  {staff.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.position ? ` (${s.position})` : ''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary min-w-[130px]">
              {saving ? <><Spinner /> Saving…</> : saved ? '✓ Saved' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Pending callback resolve actions */}
      {pending && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Resolve Callback</h4>
          <div className="flex gap-3">
            <button
              onClick={() => handleCallbackStatus('completed')}
              disabled={statusSaving}
              className="flex-1 py-3 text-sm font-semibold bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded-xl transition-colors disabled:opacity-50">
              ✓ Call Completed
            </button>
            <button
              onClick={() => handleCallbackStatus('unable_to_reach')}
              disabled={statusSaving}
              className="flex-1 py-3 text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-xl transition-colors disabled:opacity-50">
              ✗ Unable to Reach
            </button>
          </div>
        </div>
      )}

      {/* Resolved toggle for non-callback calls */}
      {!call.needsCallback && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {call.resolved ? 'Marked as resolved.' : 'Mark this call resolved when done.'}
          </span>
          <button
            onClick={onResolvedToggle}
            className={`text-sm font-semibold px-4 py-2 rounded-lg border transition-colors ${
              call.resolved
                ? 'text-gray-500 border-gray-200 hover:bg-gray-50'
                : 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100'
            }`}>
            {call.resolved ? 'Reopen' : '✓ Mark Resolved'}
          </button>
        </div>
      )}

      {/* Delete */}
      <div className="flex justify-end pb-4">
        <button
          onClick={onDelete}
          className="text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">
          Delete this entry
        </button>
      </div>
    </div>
  );
}

// ── Shared exports (used by LostFound.jsx) ────────────────────────────────────
export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ className = 'w-4 h-4' }) {
  return <span className={`${className} border-2 border-current/20 border-t-current rounded-full animate-spin inline-block`} />;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const isToday = d.toDateString() === todayStr;
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
