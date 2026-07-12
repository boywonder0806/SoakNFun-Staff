import { useState } from 'react';
import api from '../lib/api.js';

/**
 * Pull a RocketRez order by number and turn its serials into tickets —
 * one ticket per serial, barcode = the serial RocketRez issued.
 */
export default function OrderImport({ onImport }) {
  const [orderNo, setOrderNo] = useState('');
  const [order, setOrder]     = useState(null);
  const [checked, setChecked] = useState({}); // lineItemId:rateType → bool
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const itemKey = it => `${it.lineItemId}:${it.rateType}`;

  async function lookup(e) {
    e.preventDefault();
    if (!orderNo.trim()) return;
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      const { data } = await api.get(`/tickets/order/${orderNo.trim()}`);
      setOrder(data.order);
      setChecked(Object.fromEntries(data.order.items.map(it => [itemKey(it), true])));
      if (!data.order.items.length) setError('This order has no serialized items to import.');
    } catch (err) {
      setError(err.response?.data?.error || 'Order lookup failed');
    } finally {
      setLoading(false);
    }
  }

  const selectedItems = order ? order.items.filter(it => checked[itemKey(it)]) : [];
  const ticketCount = selectedItems.reduce((n, it) => n + it.serials.length, 0);

  function importTickets() {
    const tickets = [];
    for (const it of selectedItems) {
      for (const serial of it.serials) {
        tickets.push({
          title: it.name || it.eventName || `Order ${order.id}`,
          note:  it.rateType && it.rateType !== 'Quantity' ? it.rateType : '',
          guest: order.guest || '',
          date:  it.eventDate || '',
          price: it.price != null ? `$${it.price.toFixed(2)}` : '',
          order: String(order.id),
          barcode: serial,
        });
      }
    }
    onImport(tickets, order.id);
    setOrder(null);
    setOrderNo('');
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 animate-fade-up">
      <h2 className="text-sm font-bold text-gray-900 mb-1">Import from RocketRez</h2>
      <p className="text-xs text-gray-400 mb-4">One ticket per serial — barcodes come straight from the order</p>

      <form onSubmit={lookup} className="flex gap-2">
        <input
          className="field font-mono flex-1"
          inputMode="numeric"
          placeholder="Order # e.g. 418012"
          value={orderNo}
          onChange={e => setOrderNo(e.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" disabled={loading || !orderNo.trim()} className="btn-primary shrink-0">
          {loading ? 'Fetching…' : 'Fetch'}
        </button>
      </form>

      {error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {order && order.items.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-gray-600 bg-slate-50 border border-gray-100 rounded-xl px-3.5 py-2.5">
            <span className="font-bold text-gray-900">Order #{order.id}</span>
            <span className={`ml-2 font-semibold ${order.status === 'Active' ? 'text-emerald-600' : 'text-amber-600'}`}>{order.status}</span>
            {order.guest && <span className="block mt-0.5">{order.guest}{order.email ? ` · ${order.email}` : ''}</span>}
          </div>

          <div className="space-y-2">
            {order.items.map(it => {
              const key = itemKey(it);
              return (
                <label key={key} className="flex items-start gap-2.5 p-2.5 border border-gray-100 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-tix"
                    checked={!!checked[key]}
                    onChange={e => setChecked(c => ({ ...c, [key]: e.target.checked }))}
                  />
                  <span className="min-w-0 text-xs">
                    <span className="block font-semibold text-gray-900 truncate">{it.name}</span>
                    <span className="block text-gray-400 mt-0.5">
                      {it.serials.length} serial{it.serials.length === 1 ? '' : 's'}
                      {it.rateType && it.rateType !== 'Quantity' ? ` · ${it.rateType}` : ''}
                      {it.price != null ? ` · $${it.price.toFixed(2)}` : ''}
                      {it.eventDate ? ` · ${it.eventDate}` : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <button onClick={importTickets} disabled={ticketCount === 0} className="btn-primary w-full">
            Add {ticketCount} Ticket{ticketCount === 1 ? '' : 's'} to Batch
          </button>
        </div>
      )}
    </div>
  );
}
