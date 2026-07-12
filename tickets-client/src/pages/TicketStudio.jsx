import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { hubUrl } from '../lib/hub.js';
import { sanitizeCode39 } from '../lib/code39.js';
import { defaultTemplate, newElement, PLACEHOLDERS } from '../lib/template.js';
import TicketCanvas from '../components/TicketCanvas.jsx';
import OrderImport from '../components/OrderImport.jsx';
import { TicketIcon } from './Login.jsx';

const BATCH_KEY    = 'tickets_batch_v1';
const TEMPLATE_KEY = 'tickets_template_v1';

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
  const [template, setTemplate] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TEMPLATE_KEY));
      if (saved?.elements?.length) return saved;
    } catch { /* fall through */ }
    return defaultTemplate();
  });
  const [selectedId, setSelectedId] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [toast, setToast]       = useState(null);

  useEffect(() => { localStorage.setItem(BATCH_KEY, JSON.stringify(batch)); }, [batch]);
  useEffect(() => { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(template)); }, [template]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const selected = template.elements.find(el => el.id === selectedId) || null;

  // Arrow keys nudge the selected element; Delete removes it.
  useEffect(() => {
    function onKey(e) {
      if (!selected) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const step = e.shiftKey ? 10 : 1;
      const nudge = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
      if (nudge) {
        e.preventDefault();
        patchSelected({ x: selected.x + nudge[0], y: selected.y + nudge[1] });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cleanBarcode = useMemo(() => sanitizeCode39(form.barcode), [form.barcode]);
  const barcodeDirty = form.barcode.toUpperCase() !== cleanBarcode && form.barcode.length > 0;

  function set(key, value) { setForm(f => ({ ...f, [key]: value })); }

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

  const previewData = { ...ticketFromForm(), index: batch.length + 1 };

  /* ── Template editing ─────────────────────────────────────────────────── */

  function patchSelected(patch) {
    if (!selectedId) return;
    setTemplate(t => ({
      ...t,
      elements: t.elements.map(el => (el.id === selectedId ? { ...el, ...patch } : el)),
    }));
  }

  function addElement(type) {
    const el = newElement(type);
    setTemplate(t => ({ ...t, elements: [...t.elements, el] }));
    setSelectedId(el.id);
  }

  function removeSelected() {
    if (!selectedId) return;
    setTemplate(t => ({ ...t, elements: t.elements.filter(el => el.id !== selectedId) }));
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy = { ...selected, id: crypto.randomUUID(), x: selected.x + 16, y: selected.y + 16 };
    setTemplate(t => ({ ...t, elements: [...t.elements, copy] }));
    setSelectedId(copy.id);
  }

  function moveLayer(dir) {
    if (!selectedId) return;
    setTemplate(t => {
      const i = t.elements.findIndex(el => el.id === selectedId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= t.elements.length) return t;
      const els = [...t.elements];
      [els[i], els[j]] = [els[j], els[i]];
      return { ...t, elements: els };
    });
  }

  function resetTemplate() {
    setTemplate(defaultTemplate());
    setSelectedId(null);
    setToast('Design reset to the default layout');
  }

  /* ── Batch ────────────────────────────────────────────────────────────── */

  function addToBatch() {
    if (!cleanBarcode) return;
    const base = ticketFromForm();
    const qty = Math.min(Math.max(parseInt(form.qty) || 1, 1), 100);
    const items = Array.from({ length: qty }, () => ({ ...base, id: crypto.randomUUID() }));
    setBatch(b => [...b, ...items]);
    setToast(`Added ${qty} ticket${qty > 1 ? 's' : ''} to the batch`);
  }

  function importOrderTickets(tickets, orderId) {
    setBatch(b => [...b, ...tickets.map(t => ({ ...t, id: crypto.randomUUID() }))]);
    setToast(`Imported ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} from order #${orderId}`);
  }

  function importBulk() {
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
    setSelectedId(null);
    if (batch.length === 0 && cleanBarcode) {
      setBatch([{ ...ticketFromForm(), id: crypto.randomUUID() }]);
      setTimeout(() => window.print(), 50);
      return;
    }
    setTimeout(() => window.print(), 50);
  }

  /* ── UI ───────────────────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-slate-100">

      <header className="no-print sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
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

      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[340px_1fr] gap-6 items-start">

        {/* ── Left: data sources ─────────────────────────────────────────── */}
        <div className="no-print space-y-6">
          <OrderImport onImport={importOrderTickets} />

          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 animate-fade-up">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Manual Ticket</h2>
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
                    placeholder={'BARCODE, Guest, Title, Date, Price\nGA-0001, John Smith\nGA-0002'}
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
        </div>

        {/* ── Right: designer + batch ────────────────────────────────────── */}
        <div className="space-y-6 min-w-0">

          {/* Designer */}
          <section className="no-print bg-white border border-gray-200 rounded-2xl shadow-sm p-6 animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Ticket Designer</h2>
                <p className="text-xs text-gray-400 mt-0.5">Drag to move · handle above the selection rotates · arrows nudge · Delete removes</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => addElement('text')}    className="btn-ghost !px-3 !py-1.5 text-xs">+ Text</button>
                <button onClick={() => addElement('barcode')} className="btn-ghost !px-3 !py-1.5 text-xs">+ Barcode</button>
                <button onClick={() => addElement('line')}    className="btn-ghost !px-3 !py-1.5 text-xs">+ Line</button>
                <button onClick={() => addElement('box')}     className="btn-ghost !px-3 !py-1.5 text-xs">+ Box</button>
                <span className="w-px h-5 bg-gray-200 mx-1" />
                <label className="text-[11px] text-gray-400 flex items-center gap-1">
                  W <input type="number" className="field !w-[70px] !px-2 !py-1 !text-xs" value={template.width}
                    onChange={e => setTemplate(t => ({ ...t, width: clampInt(e.target.value, 240, 1100) }))} />
                </label>
                <label className="text-[11px] text-gray-400 flex items-center gap-1">
                  H <input type="number" className="field !w-[70px] !px-2 !py-1 !text-xs" value={template.height}
                    onChange={e => setTemplate(t => ({ ...t, height: clampInt(e.target.value, 100, 800) }))} />
                </label>
                <button onClick={resetTemplate} className="btn-ghost !px-3 !py-1.5 text-xs text-gray-400">Reset</button>
              </div>
            </div>

            <div className="overflow-x-auto pb-2">
              <TicketCanvas
                template={template}
                data={previewData}
                editable
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={setTemplate}
                className="shadow-sm"
              />
            </div>

            {selected ? (
              <ElementProperties
                el={selected}
                onPatch={patchSelected}
                onDelete={removeSelected}
                onDuplicate={duplicateSelected}
                onLayer={moveLayer}
              />
            ) : (
              <p className="text-xs text-gray-400 mt-3">
                Click an element on the ticket to edit it. Text can bind ticket data with
                {' '}{PLACEHOLDERS.map(p => (
                  <code key={p} className="font-mono bg-slate-100 rounded px-1 py-0.5 mx-0.5 text-[10px]">{`{${p}}`}</code>
                ))}
              </p>
            )}
          </section>

          {/* Batch */}
          <section className="space-y-4">
            <div className="no-print flex items-center justify-between animate-fade-up">
              <div>
                <h2 className="text-sm font-bold text-gray-900">
                  Batch <span className="text-gray-400 font-medium">· {batch.length} ticket{batch.length === 1 ? '' : 's'}</span>
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Prints with the design above</p>
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

            <div className="print-sheet space-y-4">
              {batch.length === 0 ? (
                <div className="no-print border-2 border-dashed border-gray-200 rounded-2xl p-10 text-center text-sm text-gray-400">
                  Import an order or add tickets manually — they'll appear here ready to print.
                </div>
              ) : (
                batch.map((t, i) => (
                  <div key={t.id} className="relative group print-ticket" style={{ width: template.width }}>
                    <TicketCanvas template={template} data={{ ...t, index: i + 1 }} className="shadow-sm" />
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
        </div>
      </main>

      {toast && (
        <div className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-gray-900 shadow-xl animate-fade-up">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── Properties panel ─────────────────────────────────────────────────────── */

function clampInt(v, min, max) {
  const n = parseInt(v) || min;
  return Math.min(Math.max(n, min), max);
}

function Num({ label, value, onChange, min = -2000, max = 2000, w = 76 }) {
  return (
    <label className="text-[11px] text-gray-400 flex items-center gap-1.5">
      {label}
      <input type="number" className="field !px-2 !py-1 !text-xs" style={{ width: w }}
        value={value} min={min} max={max}
        onChange={e => onChange(clampInt(e.target.value, min, max))} />
    </label>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className="text-[11px] text-gray-500 flex items-center gap-1.5 cursor-pointer select-none">
      <input type="checkbox" className="accent-tix" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Color({ label, value, onChange }) {
  return (
    <label className="text-[11px] text-gray-400 flex items-center gap-1.5">
      {label}
      <input type="color" className="w-7 h-7 rounded border border-gray-200 cursor-pointer bg-white p-0.5"
        value={value || '#111827'} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function ElementProperties({ el, onPatch, onDelete, onDuplicate, onLayer }) {
  const TYPE_LABEL = { text: 'Text', barcode: 'Barcode', line: 'Line', box: 'Box' };
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-bold text-gray-900">{TYPE_LABEL[el.type]} Element</p>
        <div className="flex items-center gap-1.5">
          <button onClick={() => onLayer(-1)} className="btn-ghost !px-2.5 !py-1 text-[11px]" title="Send backward">▼ Back</button>
          <button onClick={() => onLayer(1)}  className="btn-ghost !px-2.5 !py-1 text-[11px]" title="Bring forward">▲ Front</button>
          <button onClick={onDuplicate} className="btn-ghost !px-2.5 !py-1 text-[11px]">Duplicate</button>
          <button onClick={onDelete} className="btn-ghost !px-2.5 !py-1 text-[11px] !text-red-500 hover:!border-red-200">Delete</button>
        </div>
      </div>

      {el.type === 'text' && (
        <div className="mb-3">
          <textarea
            className="field font-mono !text-xs h-16 resize-y"
            value={el.text}
            onChange={e => onPatch({ text: e.target.value })}
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Placeholders: {PLACEHOLDERS.map(p => (
              <button key={p} onClick={() => onPatch({ text: `${el.text}{${p}}` })}
                className="font-mono bg-slate-100 hover:bg-slate-200 rounded px-1 py-0.5 mx-0.5 text-[10px] transition-colors">
                {`{${p}}`}
              </button>
            ))}
          </p>
        </div>
      )}

      {el.type === 'barcode' && (
        <div className="mb-3">
          <label className="label">Barcode Value</label>
          <input className="field font-mono !text-xs" value={el.value}
            onChange={e => onPatch({ value: e.target.value })} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <Num label="X" value={el.x} onChange={x => onPatch({ x })} />
        <Num label="Y" value={el.y} onChange={y => onPatch({ y })} />
        <Num label="Rotate°" value={el.rotation || 0} min={0} max={359} onChange={rotation => onPatch({ rotation })} />

        {el.type === 'text' && (
          <>
            <Num label="Size" value={el.fontSize} min={6} max={96} w={60} onChange={fontSize => onPatch({ fontSize })} />
            <Num label="Spacing" value={el.tracking || 0} min={0} max={20} w={56} onChange={tracking => onPatch({ tracking })} />
            <Color label="Color" value={el.color} onChange={color => onPatch({ color })} />
            <Check label="Bold" checked={el.bold} onChange={bold => onPatch({ bold })} />
            <Check label="Mono" checked={el.mono} onChange={mono => onPatch({ mono })} />
          </>
        )}

        {el.type === 'barcode' && (
          <>
            <Num label="W" value={el.w} min={60} max={1000} onChange={w => onPatch({ w })} />
            <Num label="H" value={el.h} min={24} max={300} onChange={h => onPatch({ h })} />
            <Check label="Show value" checked={el.showText} onChange={showText => onPatch({ showText })} />
          </>
        )}

        {el.type === 'line' && (
          <>
            <Num label="Length" value={el.w} min={8} max={1100} onChange={w => onPatch({ w })} />
            <Num label="Thick" value={el.h} min={1} max={24} w={56} onChange={h => onPatch({ h })} />
            <Color label="Color" value={el.color} onChange={color => onPatch({ color })} />
            <Check label="Dashed" checked={el.dashed} onChange={dashed => onPatch({ dashed })} />
          </>
        )}

        {el.type === 'box' && (
          <>
            <Num label="W" value={el.w} min={8} max={1100} onChange={w => onPatch({ w })} />
            <Num label="H" value={el.h} min={8} max={800} onChange={h => onPatch({ h })} />
            <Num label="Border" value={el.border} min={0} max={12} w={56} onChange={border => onPatch({ border })} />
            <Num label="Radius" value={el.radius} min={0} max={100} w={56} onChange={radius => onPatch({ radius })} />
            <Color label="Color" value={el.color} onChange={color => onPatch({ color })} />
            <Check label="Dashed" checked={el.dashed} onChange={dashed => onPatch({ dashed })} />
            <Check label="Filled" checked={!!el.fill} onChange={f => onPatch({ fill: f ? '#f8fafc' : '' })} />
          </>
        )}
      </div>
    </div>
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
