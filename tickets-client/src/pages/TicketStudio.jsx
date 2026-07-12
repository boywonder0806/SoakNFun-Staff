import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { hubUrl } from '../lib/hub.js';
import { encodeCode39, sanitizeCode39 } from '../lib/code39.js';
import { TicketIcon } from './Login.jsx';

const BATCH_KEY = 'tickets_batch_v1';

const EMPTY_FORM = {
  title:   'General Admission',
  note:    '',
  guest:   '',
  date:    '',
  price:   '',
  barcode: '',
  qty:     1,
};

export default function TicketStudio() {
  const { user, logout } = useAuth();
  const [form, setForm]   = useState(EMPTY_FORM);
  const [batch, setBatch] = useState(() => {
    try { return JSON.parse(localStorage.getItem(BATCH_KEY)) || []; }
    catch { return []; }
  });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [toast, setToast]       = useState(null);

  useEffect(() => {
    localStorage.setItem(BATCH_KEY, JSON.stringify(batch));
  }, [batch]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const cleanBarcode = useMemo(() => sanitizeCode39(form.barcode), [form.barcode]);
  const barcodeDirty = form.barcode.toUpperCase() !== cleanBarcode && form.barcode.length > 0;

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function ticketFromForm() {
    return {
      title: form.title.trim() || 'Admission',
      note:  form.note.trim(),
      guest: form.guest.trim(),
      date:  form.date,
      price: form.price.trim(),
      barcode: cleanBarcode,
    };
  }

  function addToBatch() {
    if (!cleanBarcode) return;
    const base = ticketFromForm();
    const qty = Math.min(Math.max(parseInt(form.qty) || 1, 1), 100);
    const items = Array.from({ length: qty }, () => ({ ...base, id: crypto.randomUUID() }));
    setBatch(b => [...b, ...items]);
    setToast(`Added ${qty} ticket${qty > 1 ? 's' : ''} to the batch`);
  }

  function importBulk() {
    // One ticket per line: BARCODE [, Guest, Title, Date, Price]
    // Missing fields fall back to what's in the form.
    const defaults = ticketFromForm();
    let added = 0, skipped = 0;
    const items = [];
    for (const rawLine of bulkText.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const [rawCode, guest, title, date, price] = line.split(',').map(s => (s || '').trim());
      const barcode = sanitizeCode39(rawCode);
      if (!barcode) { skipped++; continue; }
      items.push({
        id: crypto.randomUUID(),
        title: title || defaults.title,
        note:  defaults.note,
        guest: guest || '',
        date:  date  || defaults.date,
        price: price || defaults.price,
        barcode,
      });
      added++;
    }
    setBatch(b => [...b, ...items]);
    setBulkText('');
    setBulkOpen(false);
    setToast(`Imported ${added} ticket${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} line${skipped === 1 ? '' : 's'} skipped` : ''}`);
  }

  function printBatch() {
    // Printing an empty batch with a valid ticket in the form: print that ticket.
    if (batch.length === 0 && cleanBarcode) {
      setBatch([{ ...ticketFromForm(), id: crypto.randomUUID() }]);
      setTimeout(() => window.print(), 50);
      return;
    }
    window.print();
  }

  const previewTicket = cleanBarcode ? { ...ticketFromForm(), id: 'preview' } : null;

  return (
    <div className="min-h-screen bg-slate-100">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="no-print sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #e11d48, #f43f5e)' }}>
              <TicketIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold leading-none">Ticket Manager</p>
              <p className="text-[11px] text-gray-400 leading-none mt-1">Blue Bayou Waterpark</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={hubUrl()} className="btn-ghost !py-1.5 text-xs">All Tools</a>
            <span className="hidden sm:block text-xs text-gray-400 px-1">{user?.name}</span>
            <button onClick={logout} className="text-xs font-semibold text-gray-400 hover:text-red-500 px-2 py-1.5 transition-colors">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[380px_1fr] gap-8 items-start">

        {/* ── Ticket form ───────────────────────────────────────────────── */}
        <section className="no-print bg-white border border-gray-200 rounded-2xl shadow-sm p-6 animate-fade-up">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Ticket Details</h2>

          <div className="space-y-4">
            <div>
              <label className="label">Ticket Title</label>
              <input className="field" value={form.title} placeholder="General Admission"
                onChange={e => set('title', e.target.value)} />
            </div>

            <div>
              <label className="label">Barcode Data <span className="text-tix">*</span></label>
              <input className="field font-mono" value={form.barcode} placeholder="e.g. GA-2026-0001"
                onChange={e => set('barcode', e.target.value.toUpperCase())} />
              <p className="text-[11px] mt-1.5 leading-relaxed text-gray-400">
                {barcodeDirty
                  ? <>Unsupported characters removed — will encode as <span className="font-mono font-semibold text-gray-600">{cleanBarcode || '(empty)'}</span></>
                  : <>Code 39: letters, numbers, space and <span className="font-mono">- . $ / + %</span></>}
                {cleanBarcode.length > 20 && <span className="block text-amber-600 font-medium mt-0.5">Long values print thinner bars — keep under ~20 characters for reliable scans.</span>}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Guest Name</label>
                <input className="field" value={form.guest} placeholder="Optional"
                  onChange={e => set('guest', e.target.value)} />
              </div>
              <div>
                <label className="label">Valid Date</label>
                <input type="date" className="field" value={form.date}
                  onChange={e => set('date', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Price</label>
                <input className="field" value={form.price} placeholder="$39.99"
                  onChange={e => set('price', e.target.value)} />
              </div>
              <div>
                <label className="label">Quantity</label>
                <input type="number" min="1" max="100" className="field" value={form.qty}
                  onChange={e => set('qty', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Fine Print</label>
              <input className="field" value={form.note} placeholder="e.g. Valid one day only · Non-transferable"
                onChange={e => set('note', e.target.value)} />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={addToBatch} disabled={!cleanBarcode} className="btn-primary flex-1">
                Add to Batch
              </button>
              <button onClick={() => setBulkOpen(o => !o)} className="btn-ghost">Bulk</button>
            </div>

            {bulkOpen && (
              <div className="border-t border-gray-100 pt-4 animate-fade-up">
                <label className="label">Bulk Import — one ticket per line</label>
                <textarea
                  className="field font-mono !text-xs h-32 resize-y"
                  placeholder={'BARCODE, Guest, Title, Date, Price\nGA-0001, John Smith\nGA-0002\nVIP-0003, Jane Doe, VIP Pass, 2026-07-20, $59'}
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                />
                <p className="text-[11px] text-gray-400 mt-1.5">Only the barcode is required — other fields fall back to the form above.</p>
                <button onClick={importBulk} disabled={!bulkText.trim()} className="btn-primary w-full mt-3">
                  Import Lines
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Preview + batch ───────────────────────────────────────────── */}
        <section className="space-y-6">

          <div className="no-print flex items-center justify-between animate-fade-up">
            <div>
              <h2 className="text-sm font-bold text-gray-900">
                Batch <span className="text-gray-400 font-medium">· {batch.length} ticket{batch.length === 1 ? '' : 's'}</span>
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Everything below prints exactly as shown</p>
            </div>
            <div className="flex gap-2">
              {batch.length > 0 && (
                <button onClick={() => setBatch([])} className="btn-ghost text-xs !py-1.5">Clear All</button>
              )}
              <button onClick={printBatch} disabled={batch.length === 0 && !cleanBarcode} className="btn-primary !py-1.5 text-xs">
                <PrinterIcon /> Print {batch.length > 0 ? `Batch (${batch.length})` : 'Ticket'}
              </button>
            </div>
          </div>

          {/* Live preview of the form */}
          {previewTicket && (
            <div className="no-print animate-fade-up">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Live Preview</p>
              <Ticket ticket={previewTicket} />
            </div>
          )}

          {/* The printable sheet */}
          <div className="print-sheet space-y-4">
            {batch.length === 0 ? (
              <div className="no-print border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center text-sm text-gray-400">
                {previewTicket
                  ? 'Add the ticket to the batch to build a print sheet, or print it directly.'
                  : 'Enter barcode data to start building tickets.'}
              </div>
            ) : (
              batch.map((t, i) => (
                <div key={t.id} className="relative group">
                  <Ticket ticket={t} index={i + 1} />
                  <button
                    onClick={() => setBatch(b => b.filter(x => x.id !== t.id))}
                    className="no-print absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white border border-gray-200 shadow text-gray-400 hover:text-red-500 hover:border-red-200 text-sm opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove ticket"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {toast && (
        <div className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-gray-900 shadow-xl animate-fade-up">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── Ticket rendering ─────────────────────────────────────────────────────── */

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function Ticket({ ticket, index }) {
  const fields = [
    ticket.guest && { label: 'Guest', value: ticket.guest },
    ticket.date  && { label: 'Valid', value: formatDate(ticket.date) },
    ticket.price && { label: 'Price', value: ticket.price },
  ].filter(Boolean);

  return (
    <div className="print-ticket max-w-[640px] bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex">

      {/* Main section */}
      <div className="flex-1 p-5 min-w-0">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-extrabold tracking-[0.2em] uppercase text-tix">
            Blue Bayou Waterpark
          </p>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest">Gulf Islands</p>
        </div>

        <p className="text-xl font-extrabold text-gray-900 leading-tight truncate">{ticket.title}</p>
        {ticket.note && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{ticket.note}</p>}

        {fields.length > 0 && (
          <div className="flex gap-6 mt-3">
            {fields.map(f => (
              <div key={f.label} className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">{f.label}</p>
                <p className="text-sm font-semibold text-gray-800 truncate">{f.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Barcode value={ticket.barcode} />
          <p className="font-mono text-[11px] tracking-[0.3em] text-gray-700 text-center mt-1">
            {ticket.barcode}
          </p>
        </div>
      </div>

      {/* Stub */}
      <div className="w-[92px] shrink-0 border-l-2 border-dashed border-gray-300 bg-slate-50 flex flex-col items-center justify-between py-4 px-2">
        <p className="text-[9px] font-extrabold tracking-[0.25em] uppercase text-gray-400"
          style={{ writingMode: 'vertical-rl' }}>
          Admit One
        </p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #e11d48, #f43f5e)' }}>
          <TicketIcon className="w-4 h-4 text-white" />
        </div>
        <p className="font-mono text-[9px] text-gray-500 break-all text-center leading-tight">
          {ticket.barcode.length > 14 ? `${ticket.barcode.slice(0, 12)}…` : ticket.barcode}
          {index ? <span className="block mt-1 text-gray-300">#{index}</span> : null}
        </p>
      </div>
    </div>
  );
}

function Barcode({ value, height = 64 }) {
  const { bars, totalWidth } = useMemo(() => encodeCode39(value), [value]);
  return (
    // Stretching horizontally keeps the wide/narrow ratios intact, which is
    // all a 1-D scanner reads.
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={`Code 39 barcode: ${value}`}
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.width} height={height} fill="#000" shapeRendering="crispEdges" />
      ))}
    </svg>
  );
}

function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
