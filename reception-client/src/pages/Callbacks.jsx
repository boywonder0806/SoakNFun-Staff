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
  const [showModal, setShowModal]  = useState(false);
  const [filter, setFilter]        = useState('pending');
  const [search, setSearch]        = useState('');

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

  async function updateStatus(cb, status) {
    try {
      const { data } = await api.patch(`/reception/callbacks/${cb.id}`, { status });
      setCallbacks(prev => {
        const next = prev.map(c => c.id === cb.id ? { ...c, ...data.callback } : c);
        updatePendingCount(next);
        return next;
      });
    } catch {}
  }

  function handleCreated(cb) {
    setCallbacks(prev => {
      const next = [cb, ...prev];
      updatePendingCount(next);
      return next;
    });
    setShowModal(false);
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

  const pending   = visible.filter(c => c.status === 'pending');
  const resolved  = visible.filter(c => c.status !== 'pending');

  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Callback Requests</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {callbacks.filter(c => c.status === 'pending').length} pending
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <PlusIcon /> Log Callback
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 gap-0.5">
          {[['pending','Pending'],['completed','Completed'],['unable_to_reach','Unable to Reach'],['all','All']].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors
                ${filter === v ? 'bg-brand text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search caller, reason, staff…"
          className="field flex-1 max-w-xs"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="card p-12 flex items-center justify-center">
          <Spinner className="w-6 h-6 text-brand" />
        </div>
      ) : visible.length === 0 ? (
        <div className="card p-12 text-center text-gray-400 text-sm">No callbacks found.</div>
      ) : (
        <div className="space-y-6">
          {/* Pending */}
          {(filter === 'pending' || filter === 'all') && pending.length > 0 && (
            <section>
              {filter === 'all' && <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Pending</h3>}
              <div className="space-y-3">
                {pending.map(cb => <CallbackCard key={cb.id} cb={cb} onStatusChange={updateStatus} />)}
              </div>
            </section>
          )}

          {/* Resolved */}
          {(filter !== 'pending') && resolved.length > 0 && (
            <section>
              {filter === 'all' && pending.length > 0 && (
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Resolved</h3>
              )}
              <div className="space-y-3">
                {resolved.map(cb => <CallbackCard key={cb.id} cb={cb} onStatusChange={updateStatus} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {showModal && <LogCallbackModal staff={staff} onClose={() => setShowModal(false)} onCreated={handleCreated} />}
    </div>
  );
}

function CallbackCard({ cb, onStatusChange }) {
  const meta     = STATUS_META[cb.status] ?? STATUS_META.pending;
  const isPending = cb.status === 'pending';

  return (
    <div className={`card p-4 ${isPending ? 'border-amber-200 bg-amber-50/30' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900">{cb.callerName}</p>
            <span className={`badge ${meta.color}`}>{meta.label}</span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{cb.callerPhone}</p>
          {cb.reason && <p className="text-sm text-gray-700 mt-1.5">"{cb.reason}"</p>}
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {cb.requestedStaffName && (
              <span className="text-xs text-gray-500">For: <span className="font-medium text-gray-700">{cb.requestedStaffName}</span></span>
            )}
            <span className="text-xs text-gray-400">Logged by {cb.loggedByName || 'unknown'} · {fmtTime(cb.createdAt)}</span>
          </div>
        </div>

        {isPending && (
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => onStatusChange(cb, 'completed')}
              className="px-3 py-1.5 text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 rounded-lg transition-colors">
              Completed
            </button>
            <button
              onClick={() => onStatusChange(cb, 'unable_to_reach')}
              className="px-3 py-1.5 text-xs font-semibold bg-red-100 text-red-600 hover:bg-red-200 rounded-lg transition-colors">
              Unable to Reach
            </button>
          </div>
        )}
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
