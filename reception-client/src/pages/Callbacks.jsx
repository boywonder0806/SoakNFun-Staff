import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api.js';
import { Modal, Spinner } from './CallLog.jsx';

const STATUS_META = {
  pending:         { label: 'Pending',          color: 'bg-amber-100 text-amber-700' },
  completed:       { label: 'Completed',        color: 'bg-green-100 text-green-700' },
  unable_to_reach: { label: 'Unable to Reach',  color: 'bg-red-100 text-red-600'    },
};

export default function Callbacks({ onPendingCount }) {
  const [callbacks, setCallbacks] = useState([]);
  const [staff, setStaff]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter]       = useState('pending');
  const [search, setSearch]       = useState('');

  const updatePendingCount = useCallback((list) => {
    onPendingCount(list.filter(c => c.status === 'pending').length);
  }, [onPendingCount]);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [cbRes, staffRes] = await Promise.all([
        api.get('/reception/callbacks'),
        api.get('/reception/staff'),
      ]);
      setCallbacks(cbRes.data.callbacks);
      updatePendingCount(cbRes.data.callbacks);
      setStaff(staffRes.data.staff);
    } catch {}
    setLoading(false);
  }

  function applyUpdate(updated) {
    setCallbacks(prev => {
      const next = prev.map(c => c.id === updated.id ? updated : c);
      updatePendingCount(next);
      return next;
    });
    setSelected(updated);
  }

  async function updateStatus(id, status) {
    try {
      const { data } = await api.patch(`/reception/callbacks/${id}`, { status });
      applyUpdate(data.callback);
    } catch {}
  }

  async function saveEdit(id, payload) {
    try {
      const { data } = await api.patch(`/reception/callbacks/${id}`, payload);
      applyUpdate(data.callback);
      return true;
    } catch {
      return false;
    }
  }

  async function deleteCallback(id) {
    if (!window.confirm('Delete this callback request?')) return;
    try {
      await api.delete(`/reception/callbacks/${id}`);
      setCallbacks(prev => {
        const next = prev.filter(c => c.id !== id);
        updatePendingCount(next);
        return next;
      });
      setSelected(null);
    } catch {}
  }

  function handleCreated(cb) {
    setCallbacks(prev => {
      const next = [cb, ...prev];
      updatePendingCount(next);
      return next;
    });
    setShowModal(false);
    setSelected(cb);
  }

  const visible = callbacks.filter(c => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (c.callerName || '').toLowerCase().includes(q)
          || (c.callerPhone || '').includes(q)
          || (c.reason || '').toLowerCase().includes(q)
          || (c.requestedStaffName || '').toLowerCase().includes(q);
    }
    return true;
  });

  const pendingCount = callbacks.filter(c => c.status === 'pending').length;

  return (
    <div className="flex h-full overflow-hidden">

      {/* Left: List Panel */}
      <div className="w-[360px] shrink-0 bg-white border-r border-gray-200 flex flex-col">

        {/* Panel header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Callbacks</h2>
            <p className="text-xs text-gray-400 mt-0.5">{pendingCount} pending</p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <PlusIcon /> Log
          </button>
        </div>

        {/* Filters */}
        <div className="px-4 py-3 border-b border-gray-100 space-y-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {[['pending','Pending'],['completed','Done'],['unable_to_reach','UTR'],['all','All']].map(([v,l]) => (
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

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 flex justify-center">
              <Spinner className="w-5 h-5 text-brand" />
            </div>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">No callbacks found.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {visible.map(cb => (
                <CallbackRow
                  key={cb.id}
                  cb={cb}
                  isSelected={selected?.id === cb.id}
                  onClick={() => setSelected(cb)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Detail Panel */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {selected ? (
          <CallbackDetail
            key={selected.id}
            cb={selected}
            staff={staff}
            onStatusChange={(status) => updateStatus(selected.id, status)}
            onSave={(payload) => saveEdit(selected.id, payload)}
            onDelete={() => deleteCallback(selected.id)}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-400">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <p className="text-gray-500 font-medium">Select a callback to view details</p>
              <p className="text-sm text-gray-400 mt-1">or log a new one above</p>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <LogCallbackModal
          staff={staff}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

function CallbackRow({ cb, isSelected, onClick }) {
  const meta = STATUS_META[cb.status] ?? STATUS_META.pending;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-5 py-3.5 transition-colors
        ${isSelected
          ? 'bg-brand/5 border-l-[3px] border-brand'
          : 'hover:bg-gray-50 border-l-[3px] border-transparent'}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-semibold text-sm text-gray-900 truncate">{cb.callerName}</span>
        <span className={`badge shrink-0 ${meta.color}`}>{meta.label}</span>
      </div>
      <p className="text-xs text-gray-500 mb-1">{cb.callerPhone}</p>
      <div className="flex items-center gap-1 text-xs text-gray-400">
        {cb.reason && <span className="truncate max-w-[180px]">{cb.reason}</span>}
        <span className="ml-auto shrink-0">{fmtTime(cb.createdAt)}</span>
      </div>
    </button>
  );
}

function CallbackDetail({ cb, staff, onStatusChange, onSave, onDelete }) {
  const meta      = STATUS_META[cb.status] ?? STATUS_META.pending;
  const isPending = cb.status === 'pending';

  const [form, setForm] = useState({
    callerName:       cb.callerName  || '',
    callerPhone:      cb.callerPhone || '',
    reason:           cb.reason      || '',
    requestedStaffId: cb.requestedStaffId ? String(cb.requestedStaffId) : '',
    notes:            cb.notes       || '',
  });
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const ok = await onSave({
      ...form,
      requestedStaffId: form.requestedStaffId ? parseInt(form.requestedStaffId) : null,
    });
    setSaving(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  }

  async function handleStatusChange(status) {
    setStatusSaving(true);
    await onStatusChange(status);
    setStatusSaving(false);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">

      {/* Status header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-xl font-bold text-gray-900">{cb.callerName}</h3>
            <p className="text-gray-500 mt-0.5">{cb.callerPhone}</p>
          </div>
          <span className={`badge ${meta.color} px-3 py-1 text-sm`}>{meta.label}</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400 border-t border-gray-100 pt-3">
          <span>Logged by <span className="text-gray-600 font-medium">{cb.loggedByName || 'unknown'}</span> · {fmtTime(cb.createdAt)}</span>
          {!isPending && cb.completedByName && (
            <span>Resolved by <span className="text-gray-600 font-medium">{cb.completedByName}</span> · {fmtTime(cb.completedAt)}</span>
          )}
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Details</h4>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Caller Name</label>
              <input className="field" value={form.callerName} onChange={set('callerName')} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="field" value={form.callerPhone} onChange={set('callerPhone')} />
            </div>
          </div>
          <div>
            <label className="label">Reason / Message</label>
            <input className="field" placeholder="What are they calling about?" value={form.reason} onChange={set('reason')} />
          </div>
          <div>
            <label className="label">Requested Staff</label>
            <select className="field" value={form.requestedStaffId} onChange={set('requestedStaffId')}>
              <option value="">— Not specified —</option>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.position ? ` (${s.position})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="field resize-none" rows={3} placeholder="Best time to call, urgency, etc." value={form.notes} onChange={set('notes')} />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary min-w-[130px]">
              {saving ? <><Spinner /> Saving…</> : saved ? '✓ Saved' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Resolve actions */}
      {isPending && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Resolve</h4>
          <div className="flex gap-3">
            <button
              onClick={() => handleStatusChange('completed')}
              disabled={statusSaving}
              className="flex-1 py-3 text-sm font-semibold bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded-xl transition-colors disabled:opacity-50">
              ✓ Mark Completed
            </button>
            <button
              onClick={() => handleStatusChange('unable_to_reach')}
              disabled={statusSaving}
              className="flex-1 py-3 text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-xl transition-colors disabled:opacity-50">
              ✗ Unable to Reach
            </button>
          </div>
        </div>
      )}

      {/* Delete */}
      <div className="flex justify-end pb-4">
        <button
          onClick={onDelete}
          className="text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">
          Delete this request
        </button>
      </div>
    </div>
  );
}

function LogCallbackModal({ staff, onClose, onCreated }) {
  const [form, setForm] = useState({
    callerName: '', callerPhone: '', reason: '', requestedStaffId: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.callerName.trim())  { setError('Caller name is required.'); return; }
    if (!form.callerPhone.trim()) { setError('Caller phone is required.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/reception/callbacks', {
        ...form,
        requestedStaffId: form.requestedStaffId ? parseInt(form.requestedStaffId) : null,
      });
      onCreated(data.callback);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log callback.');
    } finally { setSaving(false); }
  }

  return (
    <Modal title="Log Callback Request" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Caller Name *</label>
            <input className="field" placeholder="John Smith" value={form.callerName} onChange={set('callerName')} />
          </div>
          <div>
            <label className="label">Caller Phone *</label>
            <input className="field" placeholder="(225) 555-0100" value={form.callerPhone} onChange={set('callerPhone')} />
          </div>
        </div>
        <div>
          <label className="label">Reason / Message</label>
          <input className="field" placeholder="What are they calling about?" value={form.reason} onChange={set('reason')} />
        </div>
        <div>
          <label className="label">Requested Staff Member</label>
          <select className="field" value={form.requestedStaffId} onChange={set('requestedStaffId')}>
            <option value="">— Not specified —</option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.position ? ` (${s.position})` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="field resize-none" rows={2} placeholder="Best time to call, urgency, etc." value={form.notes} onChange={set('notes')} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? <><Spinner /> Saving…</> : 'Save Request'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const td = new Date();
  const isToday = d.toDateString() === td.toDateString();
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
