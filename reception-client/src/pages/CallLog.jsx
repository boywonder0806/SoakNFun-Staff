import { useState, useEffect } from 'react';
import api from '../lib/api.js';

const DIRECTION_OPTS = [
  { value: 'inbound',  label: 'Inbound',  color: 'bg-blue-100 text-blue-700'     },
  { value: 'outbound', label: 'Outbound', color: 'bg-violet-100 text-violet-700' },
];

function directionStyle(d) {
  return DIRECTION_OPTS.find(o => o.value === d)?.color ?? 'bg-gray-100 text-gray-600';
}

const todayStr = new Date().toDateString();

export default function CallLog({ onTodayCallsCount }) {
  const [calls, setCalls]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState('all');

  useEffect(() => { fetchCalls(); }, []);

  async function fetchCalls() {
    setLoading(true);
    try {
      const { data } = await api.get('/reception/calls');
      setCalls(data.calls);
      onTodayCallsCount?.(data.calls.filter(c => new Date(c.createdAt).toDateString() === todayStr).length);
    } catch {}
    setLoading(false);
  }

  async function toggleResolved(call) {
    try {
      const { data } = await api.patch(`/reception/calls/${call.id}`, { resolved: !call.resolved });
      setCalls(prev => prev.map(c => c.id === call.id ? { ...c, ...data.call } : c));
    } catch {}
  }

  async function deleteCall(id) {
    if (!confirm('Delete this call log entry?')) return;
    try {
      await api.delete(`/reception/calls/${id}`);
      setCalls(prev => {
        const next = prev.filter(c => c.id !== id);
        onTodayCallsCount?.(next.filter(c => new Date(c.createdAt).toDateString() === todayStr).length);
        return next;
      });
    } catch {}
  }

  function handleCreated(call) {
    setCalls(prev => {
      const next = [call, ...prev];
      onTodayCallsCount?.(next.filter(c => new Date(c.createdAt).toDateString() === todayStr).length);
      return next;
    });
    setShowModal(false);
  }

  const visible = calls.filter(c => {
    if (filter === 'unresolved' && c.resolved)  return false;
    if (filter === 'resolved'   && !c.resolved) return false;
    if (search) {
      const q = search.toLowerCase();
      return (c.callerName || '').toLowerCase().includes(q)
          || (c.callerPhone || '').includes(q)
          || (c.reason || '').toLowerCase().includes(q);
    }
    return true;
  });

  const unresolvedCount = calls.filter(c => !c.resolved).length;
  const todayCount      = calls.filter(c => new Date(c.createdAt).toDateString() === todayStr).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Call Log</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {unresolvedCount} unresolved · {todayCount} logged today
            </p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <PlusIcon /> Log Call
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 gap-0.5">
            {[['all','All'],['unresolved','Unresolved'],['resolved','Resolved']].map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors
                  ${filter === v ? 'bg-brand text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                {l}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search name, phone, or reason…"
            className="field max-w-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="card p-12 flex items-center justify-center">
            <Spinner className="w-6 h-6 text-brand" />
          </div>
        ) : visible.length === 0 ? (
          <div className="card p-12 text-center text-gray-400 text-sm">No calls found.</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Caller</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Direction</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-full">Reason / Notes</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Logged By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(call => (
                  <tr key={call.id} className={`hover:bg-gray-50 transition-colors ${call.resolved ? 'opacity-55' : ''}`}>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {fmtTime(call.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-medium text-gray-900">{call.callerName || <span className="text-gray-400">—</span>}</p>
                      <p className="text-xs text-gray-400">{call.callerPhone || ''}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`badge ${directionStyle(call.callDirection)}`}>
                        {call.callDirection}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <p>{call.reason || <span className="text-gray-400">—</span>}</p>
                      {call.notes && <p className="text-xs text-gray-400 mt-0.5">{call.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{call.loggedByName || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => toggleResolved(call)}
                        className={`badge cursor-pointer transition-colors ${call.resolved
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
                      >
                        {call.resolved ? 'Resolved' : 'Unresolved'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteCall(call.id)} className="text-gray-300 hover:text-red-400 transition-colors">
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && <LogCallModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}
    </div>
  );
}

function LogCallModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    callerName: '', callerPhone: '', callDirection: 'inbound', reason: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/reception/calls', form);
      onCreated(data.call);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log call.');
    } finally { setSaving(false); }
  }

  return (
    <Modal title="Log a Call" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Caller Name</label>
            <input className="field" placeholder="John Smith" value={form.callerName} onChange={set('callerName')} />
          </div>
          <div>
            <label className="label">Phone Number</label>
            <input className="field" placeholder="(225) 555-0100" value={form.callerPhone} onChange={set('callerPhone')} />
          </div>
        </div>

        <div>
          <label className="label">Direction</label>
          <div className="flex gap-2">
            {DIRECTION_OPTS.map(o => (
              <button key={o.value} type="button"
                onClick={() => setForm(f => ({ ...f, callDirection: o.value }))}
                className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold transition-colors
                  ${form.callDirection === o.value
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Reason / Subject</label>
          <input className="field" placeholder="e.g. Lost item inquiry, Park hours…" value={form.reason} onChange={set('reason')} />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="field resize-none" rows={3} placeholder="Additional details…" value={form.notes} onChange={set('notes')} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? <><Spinner /> Saving…</> : 'Save Entry'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────
export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XIcon />
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

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
