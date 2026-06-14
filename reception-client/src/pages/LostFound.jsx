import { useState, useEffect } from 'react';
import api from '../lib/api.js';
import { Modal, Spinner } from './CallLog.jsx';

const ITEM_TYPES = [
  { value: 'Phone',            label: 'Phone',            icon: '📱' },
  { value: 'Wallet',           label: 'Wallet',           icon: '👛' },
  { value: 'ID / License',     label: 'ID / License',     icon: '🪪' },
  { value: 'Credit/Debit Card',label: 'Credit/Debit Card',icon: '💳' },
  { value: 'Electronics',      label: 'Electronics',      icon: '💻' },
  { value: 'Keys',             label: 'Keys',             icon: '🔑' },
  { value: 'Other',            label: 'Other',            icon: '📦' },
];

const STATUSES = [
  { value: 'unclaimed', label: 'Unclaimed', color: 'bg-amber-100 text-amber-700' },
  { value: 'claimed',   label: 'Claimed',   color: 'bg-green-100 text-green-700' },
  { value: 'donated',   label: 'Donated',   color: 'bg-blue-100 text-blue-700'   },
  { value: 'discarded', label: 'Discarded', color: 'bg-gray-100 text-gray-500'   },
];

function statusStyle(s) { return STATUSES.find(o => o.value === s)?.color ?? 'bg-gray-100 text-gray-500'; }
function statusLabel(s) { return STATUSES.find(o => o.value === s)?.label ?? s; }
function typeIcon(t) { return ITEM_TYPES.find(o => o.value === t)?.icon ?? '📦'; }

export default function LostFound({ onUnclaimedCount }) {
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [selected, setSelected]     = useState(null);
  const [filter, setFilter]         = useState('all');
  const [search, setSearch]         = useState('');

  useEffect(() => { fetchItems(); }, []);

  async function fetchItems() {
    setLoading(true);
    try {
      const { data } = await api.get('/reception/lost-found');
      setItems(data.items);
      onUnclaimedCount?.(data.items.filter(i => i.status === 'unclaimed').length);
    } catch {}
    setLoading(false);
  }

  function handleCreated(item) {
    setItems(prev => {
      const next = [item, ...prev];
      onUnclaimedCount?.(next.filter(i => i.status === 'unclaimed').length);
      return next;
    });
    setShowModal(false);
  }

  function handleUpdated(item) {
    setItems(prev => {
      const next = prev.map(i => i.id === item.id ? { ...i, ...item } : i);
      onUnclaimedCount?.(next.filter(i => i.status === 'unclaimed').length);
      return next;
    });
    setSelected(null);
  }

  const visible = items.filter(i => {
    if (filter !== 'all' && i.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (i.itemType || '').toLowerCase().includes(q)
          || (i.itemDescription || '').toLowerCase().includes(q)
          || (i.locationFound || '').toLowerCase().includes(q)
          || (i.ownerName || '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Lost & Found</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              High-value items only · {items.filter(i => i.status === 'unclaimed').length} unclaimed
            </p>
          </div>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <PlusIcon /> Log Item
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex bg-white border border-gray-200 rounded-lg p-0.5 gap-0.5">
            {[['all','All'], ...STATUSES.map(s => [s.value, s.label])].map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors
                  ${filter === v ? 'bg-brand text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                {l}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search type, location, owner…"
            className="field max-w-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="card p-12 flex items-center justify-center">
            <Spinner className="w-6 h-6 text-brand" />
          </div>
        ) : visible.length === 0 ? (
          <div className="card p-12 text-center text-gray-400 text-sm">No items found.</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {visible.map(item => (
              <div key={item.id}
                onClick={() => setSelected(item)}
                className="card p-4 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-2xl leading-none shrink-0">{typeIcon(item.itemType)}</span>
                    <p className="font-semibold text-gray-900 text-sm leading-snug">{item.itemType || 'Unknown'}</p>
                  </div>
                  <span className={`badge shrink-0 ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span>
                </div>
                {item.itemDescription && (
                  <p className="text-xs text-gray-600 mb-2 line-clamp-2">{item.itemDescription}</p>
                )}
                <div className="space-y-1 text-xs text-gray-500">
                  {item.locationFound && <p>📍 {item.locationFound}</p>}
                  {item.foundDate     && <p>📅 Found {fmtDate(item.foundDate)}</p>}
                  {item.ownerName     && <p>👤 {item.ownerName}{item.ownerContact ? ` · ${item.ownerContact}` : ''}</p>}
                </div>
                <p className="text-xs text-gray-400 mt-3 pt-2 border-t border-gray-100">
                  {item.loggedByName || 'unknown'} · {fmtTime(item.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal  && <LogItemModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}
      {selected   && <ItemDetailModal item={selected} onClose={() => setSelected(null)} onUpdated={handleUpdated} />}
    </div>
  );
}

function LogItemModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    itemType: '', itemDescription: '', locationFound: '', foundDate: today(),
    ownerName: '', ownerContact: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.itemType) { setError('Please select an item type.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/reception/lost-found', form);
      onCreated(data.item);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log item.');
    } finally { setSaving(false); }
  }

  return (
    <Modal title="Log Found Item" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">

        <div>
          <label className="label">Item Type *</label>
          <div className="grid grid-cols-2 gap-2">
            {ITEM_TYPES.map(t => (
              <button key={t.value} type="button"
                onClick={() => setForm(p => ({ ...p, itemType: t.value }))}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors text-left
                  ${form.itemType === t.value
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}>
                <span className="text-lg">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Description / Details</label>
          <input className="field" placeholder="e.g. Black iPhone 14, cracked screen…" value={form.itemDescription} onChange={set('itemDescription')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Location Found</label>
            <input className="field" placeholder="e.g. Wave Pool area" value={form.locationFound} onChange={set('locationFound')} />
          </div>
          <div>
            <label className="label">Date Found</label>
            <input type="date" className="field" value={form.foundDate} onChange={set('foundDate')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Owner Name</label>
            <input className="field" placeholder="If known" value={form.ownerName} onChange={set('ownerName')} />
          </div>
          <div>
            <label className="label">Owner Contact</label>
            <input className="field" placeholder="Phone or email" value={form.ownerContact} onChange={set('ownerContact')} />
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="field resize-none" rows={2} placeholder="Condition, color, any other details…" value={form.notes} onChange={set('notes')} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? <><Spinner /> Saving…</> : 'Save Item'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ItemDetailModal({ item, onClose, onUpdated }) {
  const [status, setStatus]             = useState(item.status);
  const [itemType, setItemType]         = useState(item.itemType || '');
  const [ownerName, setOwnerName]       = useState(item.ownerName || '');
  const [ownerContact, setOwnerContact] = useState(item.ownerContact || '');
  const [notes, setNotes]               = useState(item.notes || '');
  const [saving, setSaving]             = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const { data } = await api.patch(`/reception/lost-found/${item.id}`, { status, itemType, ownerName, ownerContact, notes });
      onUpdated(data.item);
    } catch {}
    setSaving(false);
  }

  return (
    <Modal title="Item Details" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-3xl">{typeIcon(item.itemType)}</span>
          <div>
            <p className="font-semibold text-gray-900">{item.itemType || 'Unknown type'}</p>
            {item.itemDescription && <p className="text-sm text-gray-600">{item.itemDescription}</p>}
            <p className="text-xs text-gray-500 mt-0.5">
              Found {fmtDate(item.foundDate)}{item.locationFound ? ` at ${item.locationFound}` : ''}
              {' '}· Logged by {item.loggedByName || 'unknown'}
            </p>
          </div>
        </div>

        <div>
          <label className="label">Item Type</label>
          <div className="grid grid-cols-2 gap-2">
            {ITEM_TYPES.map(t => (
              <button key={t.value} type="button"
                onClick={() => setItemType(t.value)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors text-left
                  ${itemType === t.value
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}>
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Status</label>
          <div className="grid grid-cols-2 gap-2">
            {STATUSES.map(s => (
              <button key={s.value} type="button" onClick={() => setStatus(s.value)}
                className={`py-2 px-3 rounded-lg border text-sm font-semibold transition-colors
                  ${status === s.value ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Owner Name</label>
            <input className="field" value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="If claimed" />
          </div>
          <div>
            <label className="label">Owner Contact</label>
            <input className="field" value={ownerContact} onChange={e => setOwnerContact(e.target.value)} placeholder="Phone or email" />
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="field resize-none" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
            {saving ? <><Spinner /> Saving…</> : 'Update'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
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
