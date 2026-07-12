import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../lib/api.js';
import { hubUrl } from '../lib/hub.js';
import { sanitizeCode39 } from '../lib/code39.js';
import { defaultTemplate, newElement, PLACEHOLDERS, DPI } from '../lib/template.js';
import TicketCanvas from '../components/TicketCanvas.jsx';
import OrderImport from '../components/OrderImport.jsx';
import { TicketIcon } from './Login.jsx';

const BATCH_KEY    = 'tickets_batch_v1';
// v3: monochrome thermal + square-cut stock defaults — older saved layouts
// are intentionally left behind on the old keys.
const TEMPLATE_KEY = 'tickets_template_v3';
// Which saved (server) template the working copy came from
const TPL_META_KEY = 'tickets_tplmeta_v1';

// What the designer shows when the batch is empty
const SAMPLE_TICKET = {
  title:   'General Admission',
  note:    'Valid one day only',
  guest:   'Sample Guest',
  date:    '',
  price:   '$44.99',
  order:   '418012',
  barcode: 'SAMPLE-0001',
};

export default function TicketStudio() {
  const { user, logout } = useAuth();
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
  const [snap, setSnap] = useState(true);
  const [bulkText, setBulkText] = useState('');
  const [toast, setToast]       = useState(null);
  // Saved-template library (shared, server-side)
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [tplMeta, setTplMeta] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TPL_META_KEY)); }
    catch { return null; }
  });
  const [tplBusy, setTplBusy] = useState(false);
  const measureApi = useRef(null);

  useEffect(() => {
    api.get('/tickets/templates')
      .then(r => setSavedTemplates(r.data.templates))
      .catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem(TPL_META_KEY, JSON.stringify(tplMeta));
  }, [tplMeta]);

  useEffect(() => { localStorage.setItem(BATCH_KEY, JSON.stringify(batch)); }, [batch]);
  useEffect(() => {
    // Logo images ride along as data URLs — tolerate a blown quota rather than crash
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(template)); } catch { /* ignore */ }
  }, [template]);

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

  // The designer previews the first real ticket, or a sample when empty
  const previewData = batch.length > 0
    ? { ...batch[0], index: 1 }
    : { ...SAMPLE_TICKET, index: 1 };

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

  // Snap the selected element's rotated bounding box to the ticket's left
  // edge, horizontal center, or right edge. Rotation happens around the
  // element's center, so we position by center point.
  function alignSelected(where) {
    if (!selected) return;
    const size = measureApi.current?.(selected.id);
    if (!size) return;
    const rad = ((selected.rotation || 0) * Math.PI) / 180;
    const visualW = Math.abs(size.w * Math.cos(rad)) + Math.abs(size.h * Math.sin(rad));
    const cx = where === 'left'   ? visualW / 2
             : where === 'right'  ? template.width - visualW / 2
             :                      template.width / 2;
    patchSelected({ x: Math.round(cx - size.w / 2) });
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

  // Rotate the whole design 90° clockwise: swap canvas dimensions and remap
  // every element around its center. Text sizes come from the live DOM since
  // text elements are auto-width.
  function rotateDesign() {
    setSelectedId(null);
    setTemplate(t => {
      const elements = t.elements.map(el => {
        const size = el.w != null
          ? { w: el.w, h: el.h }
          : (measureApi.current?.(el.id) || { w: 0, h: 0 });
        const cx = el.x + size.w / 2;
        const cy = el.y + size.h / 2;
        const ncx = t.height - cy;
        const ncy = cx;
        return {
          ...el,
          x: Math.round(ncx - size.w / 2),
          y: Math.round(ncy - size.h / 2),
          rotation: ((el.rotation || 0) + 90) % 360,
        };
      });
      return { ...t, width: t.height, height: t.width, elements };
    });
    setToast('Design rotated 90° clockwise');
  }

  function resetTemplate() {
    setTemplate(defaultTemplate());
    setTplMeta(null);
    setSelectedId(null);
    setToast('Design reset to the default layout');
  }

  /* ── Saved template library ───────────────────────────────────────────── */

  async function selectTemplate(id) {
    if (!id) { setTplMeta(null); return; }
    setTplBusy(true);
    try {
      const { data } = await api.get(`/tickets/templates/${id}`);
      setTemplate(data.template.template);
      setTplMeta({ id: data.template.id, name: data.template.name });
      setSelectedId(null);
      setToast(`Loaded “${data.template.name}”`);
    } catch (err) {
      setToast(err.response?.data?.error || 'Failed to load template');
    } finally {
      setTplBusy(false);
    }
  }

  async function saveTemplate() {
    if (!tplMeta) return saveTemplateAs();
    setTplBusy(true);
    try {
      await api.put(`/tickets/templates/${tplMeta.id}`, { name: tplMeta.name, template });
      setSavedTemplates(l => l.map(t => (t.id === tplMeta.id ? { ...t, updatedAt: new Date().toISOString() } : t)));
      setToast(`Saved “${tplMeta.name}”`);
    } catch (err) {
      setToast(err.response?.data?.error || 'Failed to save template');
    } finally {
      setTplBusy(false);
    }
  }

  async function saveTemplateAs() {
    const name = (window.prompt('Template name:', tplMeta?.name ? `${tplMeta.name} copy` : 'BB Admission') || '').trim();
    if (!name) return;
    setTplBusy(true);
    try {
      const { data } = await api.post('/tickets/templates', { name, template });
      setSavedTemplates(l => [...l, data.template].sort((a, b) => a.name.localeCompare(b.name)));
      setTplMeta({ id: data.template.id, name: data.template.name });
      setToast(`Saved “${name}”`);
    } catch (err) {
      setToast(err.response?.data?.error || 'Failed to save template');
    } finally {
      setTplBusy(false);
    }
  }

  async function deleteTemplate() {
    if (!tplMeta) return;
    if (!window.confirm(`Delete the template “${tplMeta.name}” for everyone?`)) return;
    setTplBusy(true);
    try {
      await api.delete(`/tickets/templates/${tplMeta.id}`);
      setSavedTemplates(l => l.filter(t => t.id !== tplMeta.id));
      setToast(`Deleted “${tplMeta.name}”`);
      setTplMeta(null);
    } catch (err) {
      setToast(err.response?.data?.error || 'Failed to delete template');
    } finally {
      setTplBusy(false);
    }
  }

  /* ── Batch ────────────────────────────────────────────────────────────── */

  function importOrderTickets(tickets, orderId) {
    setBatch(b => [...b, ...tickets.map(t => ({ ...t, id: crypto.randomUUID() }))]);
    setToast(`Imported ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} from order #${orderId}`);
  }

  function importBulk() {
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
        title: title || 'Admission',
        note:  '',
        guest: guest || '',
        date:  date  || '',
        price: price || '',
        order: '',
        barcode,
      });
      added++;
    }
    setBatch(b => [...b, ...items]);
    setBulkText('');
    setToast(`Added ${added} ticket${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} line${skipped === 1 ? '' : 's'} skipped` : ''}`);
  }

  // Print through a dedicated document that contains nothing but the tickets:
  // the page IS the ticket (@page in its own head), no app CSS to fight.
  function printBatch() {
    setSelectedId(null);
    const tickets = renderToStaticMarkup(
      <>
        {batch.map((t, i) => (
          <TicketCanvas key={t.id} template={template} data={{ ...t, index: i + 1 }} className="print-ticket" />
        ))}
      </>
    );
    const win = window.open('', '_blank');
    if (!win) {
      setToast('Pop-up blocked — allow pop-ups for this site to print');
      return;
    }
    win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>Tickets (${batch.length})</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
@page { size: ${(template.width / DPI).toFixed(3)}in ${(template.height / DPI).toFixed(3)}in; margin: 0; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Inter', system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
/* The handful of utility classes TicketCanvas emits, defined by hand —
   deliberately no border/shadow so only the design reaches the stock */
.relative { position: relative; }
.absolute { position: absolute; }
.overflow-hidden { overflow: hidden; }
.bg-white { background: #fff; }
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.text-center { text-align: center; }
.text-black { color: #000; }
.print-ticket { page-break-after: always; break-inside: avoid; }
.print-ticket:last-child { page-break-after: auto; }
</style></head><body>${tickets}</body></html>`);
    win.document.close();
    win.onafterprint = () => win.close();
    // Wait for Inter to load so printed text matches the designer's metrics
    setTimeout(() => {
      const go = () => { win.focus(); win.print(); };
      if (win.document.fonts?.ready) win.document.fonts.ready.then(go);
      else go();
    }, 150);
  }

  /* ── UI ───────────────────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-slate-100">

      {/* BOCA printing: the page itself is the ticket — size follows the template.
          @page must be top-level: Chrome ignores it inside @media print. */}
      <style>{`@page { size: ${(template.width / DPI).toFixed(3)}in ${(template.height / DPI).toFixed(3)}in; margin: 0; }`}</style>

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
            <h2 className="text-sm font-bold text-gray-900 mb-1">Quick Add</h2>
            <p className="text-xs text-gray-400 mb-3">One ticket per line — for barcodes that aren't in RocketRez</p>
            <textarea
              className="field font-mono !text-xs h-28 resize-y"
              placeholder={'BARCODE, Guest, Title, Date, Price\nGA-0001, John Smith\nGA-0002'}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              Only the barcode is required. Code 39: letters, numbers, space and <span className="font-mono">- . $ / + %</span>
            </p>
            <button onClick={importBulk} disabled={!bulkText.trim()} className="btn-primary w-full mt-3">
              Add to Batch
            </button>
          </section>
        </div>

        {/* ── Right: designer + batch ────────────────────────────────────── */}
        <div className="space-y-6 min-w-0">

          {/* Designer */}
          <section className="no-print bg-white border border-gray-200 rounded-2xl shadow-sm p-6 animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">
                  Ticket Designer
                  <span className="ml-2 font-medium text-gray-400 text-xs">
                    {(template.width / DPI).toFixed(2)}in × {(template.height / DPI).toFixed(2)}in
                  </span>
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Drag to move · top handle rotates · corner handle resizes · arrows nudge · Delete removes</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => addElement('text')}    className="btn-ghost !px-3 !py-1.5 text-xs">+ Text</button>
                <button onClick={() => addElement('barcode')} className="btn-ghost !px-3 !py-1.5 text-xs">+ Barcode</button>
                <button onClick={() => addElement('line')}    className="btn-ghost !px-3 !py-1.5 text-xs">+ Line</button>
                <button onClick={() => addElement('box')}     className="btn-ghost !px-3 !py-1.5 text-xs">+ Box</button>
                <button onClick={() => addElement('image')}   className="btn-ghost !px-3 !py-1.5 text-xs">+ Image</button>
                <span className="w-px h-5 bg-gray-200 mx-1" />
                <label className="text-[11px] text-gray-400 flex items-center gap-1">
                  W (in) <input type="number" step="0.05" min="1" max="11" className="field !w-[70px] !px-2 !py-1 !text-xs"
                    value={+(template.width / DPI).toFixed(2)}
                    onChange={e => setTemplate(t => ({ ...t, width: Math.round(clampFloat(e.target.value, 1, 11) * DPI) }))} />
                </label>
                <label className="text-[11px] text-gray-400 flex items-center gap-1">
                  H (in) <input type="number" step="0.05" min="0.5" max="8" className="field !w-[70px] !px-2 !py-1 !text-xs"
                    value={+(template.height / DPI).toFixed(2)}
                    onChange={e => setTemplate(t => ({ ...t, height: Math.round(clampFloat(e.target.value, 0.5, 8) * DPI) }))} />
                </label>
                <label className="text-[11px] text-gray-500 flex items-center gap-1 cursor-pointer select-none px-1">
                  <input type="checkbox" className="accent-tix" checked={snap} onChange={e => setSnap(e.target.checked)} />
                  Snap
                </label>
                <button onClick={rotateDesign} className="btn-ghost !px-3 !py-1.5 text-xs" title="Rotate the whole design 90° clockwise (swaps ticket orientation)">⟳ Rotate</button>
                <button onClick={resetTemplate} className="btn-ghost !px-3 !py-1.5 text-xs text-gray-400">Reset</button>
              </div>
            </div>

            {/* Saved template library */}
            <div className="flex flex-wrap items-center gap-1.5 mb-4 pb-4 border-b border-gray-100">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mr-1">Template</span>
              <select
                className="field !w-auto !py-1.5 !text-xs !pr-8"
                value={tplMeta?.id ?? ''}
                disabled={tplBusy}
                onChange={e => selectTemplate(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">Unsaved design</option>
                {savedTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button onClick={saveTemplate} disabled={tplBusy} className="btn-primary !px-3 !py-1.5 text-xs">
                {tplMeta ? 'Save' : 'Save As…'}
              </button>
              {tplMeta && (
                <>
                  <button onClick={saveTemplateAs} disabled={tplBusy} className="btn-ghost !px-3 !py-1.5 text-xs">Save As…</button>
                  <button onClick={deleteTemplate} disabled={tplBusy} className="btn-ghost !px-3 !py-1.5 text-xs !text-red-500 hover:!border-red-200">Delete</button>
                </>
              )}
              <span className="text-[11px] text-gray-400 ml-1">
                {tplMeta ? 'Shared with the whole ticket team' : 'Save to share this design across machines'}
              </span>
            </div>

            <div className="overflow-x-auto pb-2">
              <TicketCanvas
                template={template}
                data={previewData}
                editable
                snap={snap}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={setTemplate}
                measureRef={measureApi}
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
                onAlign={alignSelected}
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
                <button onClick={printBatch} disabled={batch.length === 0} className="btn-primary !py-1.5 text-xs">
                  <PrinterIcon /> Print Batch ({batch.length})
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

function clampFloat(v, min, max) {
  const n = parseFloat(v);
  return Math.min(Math.max(isNaN(n) ? min : n, min), max);
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

// Downscale uploads so a phone photo of the logo doesn't blow the saved template
function loadImageFile(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / img.width);
      const c = document.createElement('canvas');
      c.width  = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/png'), c.width / c.height);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function ElementProperties({ el, onPatch, onDelete, onDuplicate, onLayer, onAlign }) {
  const TYPE_LABEL = { text: 'Text', barcode: 'Barcode', line: 'Line', box: 'Box', image: 'Image' };
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-bold text-gray-900">{TYPE_LABEL[el.type]} Element</p>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-0.5">Align</span>
          <button onClick={() => onAlign('left')}   className="btn-ghost !px-2.5 !py-1 text-[11px]" title="Align to left edge">⇤ Left</button>
          <button onClick={() => onAlign('center')} className="btn-ghost !px-2.5 !py-1 text-[11px]" title="Center horizontally on the ticket">↔ Center</button>
          <button onClick={() => onAlign('right')}  className="btn-ghost !px-2.5 !py-1 text-[11px]" title="Align to right edge">⇥ Right</button>
          <span className="w-px h-4 bg-gray-200 mx-1" />
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

      {el.type === 'image' && (
        <div className="mb-3">
          <label className="label">Artwork {el.src ? '— uploaded' : ''}</label>
          <input
            type="file"
            accept="image/*"
            className="block text-xs text-gray-500 file:mr-3 file:btn-ghost file:!py-1 file:!px-3 file:text-xs file:border file:border-gray-200 file:rounded-lg file:bg-white file:cursor-pointer"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) loadImageFile(f, (src, ratio) => onPatch({ src, h: Math.max(12, Math.round(el.w / ratio)) }));
            }}
          />
          <p className="text-[10px] text-gray-400 mt-1">PNG with transparency works best — height follows the artwork's proportions on upload.</p>
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
            <Check label="Bold" checked={el.bold} onChange={bold => onPatch({ bold })} />
            <Check label="Mono" checked={el.mono} onChange={mono => onPatch({ mono })} />
            <label className="text-[11px] text-gray-400 flex items-center gap-1.5">
              Lines
              <select
                className="field !w-auto !px-2 !py-1 !text-xs"
                value={el.align || 'left'}
                onChange={e => onPatch({ align: e.target.value })}
                title="How multi-line text lines up within the element"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
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
            <Check label="Dashed" checked={el.dashed} onChange={dashed => onPatch({ dashed })} />
            <Check label="Guide (won't print)" checked={el.guide} onChange={guide => onPatch({ guide })} />
          </>
        )}

        {el.type === 'image' && (
          <>
            <Num label="W" value={el.w} min={12} max={1100} onChange={w => onPatch({ w })} />
            <Num label="H" value={el.h} min={12} max={800} onChange={h => onPatch({ h })} />
          </>
        )}

        {el.type === 'box' && (
          <>
            <Num label="W" value={el.w} min={8} max={1100} onChange={w => onPatch({ w })} />
            <Num label="H" value={el.h} min={8} max={800} onChange={h => onPatch({ h })} />
            <Num label="Border" value={el.border} min={0} max={12} w={56} onChange={border => onPatch({ border })} />
            <Check label="Dashed" checked={el.dashed} onChange={dashed => onPatch({ dashed })} />
            <Check label="Filled" checked={!!el.fill} onChange={f => onPatch({ fill: f ? '#000000' : '' })} />
            <Check label="Guide (won't print)" checked={el.guide} onChange={guide => onPatch({ guide })} />
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
