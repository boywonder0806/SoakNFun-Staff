// Ticket template model — a fixed-size canvas of absolutely positioned
// elements (text / barcode / line / box), each draggable and rotatable in the
// designer. Text and barcode values may contain {placeholders} that are
// filled per ticket at render/print time.

export const PLACEHOLDERS = ['title', 'guest', 'date', 'price', 'note', 'barcode', 'order', 'index'];

function formatDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Substitute {placeholders} in a template string with ticket data. */
export function fillText(text, data) {
  return (text || '').replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in (data || {}))) return '';
    const v = data[key];
    if (key === 'date') return formatDate(v);
    return v === null || v === undefined ? '' : String(v);
  });
}

/**
 * A text element that binds placeholders should disappear from the printed
 * ticket when every one of its placeholders is empty (e.g. "Guest: {guest}"
 * with no guest set), instead of printing a dangling label.
 */
export function allPlaceholdersEmpty(text, data) {
  const keys = [...(text || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => PLACEHOLDERS.includes(k));
  if (!keys.length) return false;
  return keys.every(k => !String(data?.[k] ?? '').trim());
}

const uid = () => crypto.randomUUID();

export function newElement(type) {
  const base = { id: uid(), type, x: 40, y: 40, rotation: 0 };
  switch (type) {
    case 'text':
      return { ...base, text: 'New text', fontSize: 12, bold: false, mono: false, tracking: 0 };
    case 'barcode':
      return { ...base, value: '{barcode}', w: 240, h: 64, showText: true };
    case 'line':
      return { ...base, w: 150, h: 2, dashed: false, guide: false };
    case 'box':
      return { ...base, w: 120, h: 70, border: 1, dashed: false, radius: 0, guide: false };
    case 'image':
      return { ...base, w: 140, h: 70, src: '' };
    default:
      return base;
  }
}

// 96 CSS px = 1 inch when printed at 100% scale. The stock ticket is
// 5.5in × 2in (528 × 192 px) with the perforation 1in from the right end
// (x = 432), leaving a 1-inch stub.
export const DPI = 96;

// Modeled on the park's thermal ticket stock: 5.5in × 2in square-cut,
// monochrome (thermal — everything prints black), logo at one end,
// order/courtesy/title/fine-print body, and the barcode zone past the
// perforation — which sits 1in from the barcode end (x = 432). The stock is
// pre-perforated, so the perf is a non-printing guide. Held portrait
// (logo up) it reads like the printed GIWP ticket.
export function defaultTemplate() {
  return {
    width: 5.5 * DPI,   // 528
    height: 2 * DPI,    // 192
    elements: [
      // ── Logo end — replace with an Image element of the real logo art ──
      { id: uid(), type: 'text', x: 12,  y: 12,  rotation: 0, text: 'GULF ISLANDS',  fontSize: 9,  bold: true,  mono: false, tracking: 2 },
      { id: uid(), type: 'text', x: 12,  y: 24,  rotation: 0, text: 'Waterpark',     fontSize: 16, bold: true,  mono: false, tracking: 0 },
      // ── Body ──
      { id: uid(), type: 'text', x: 300, y: 14,  rotation: 0, text: 'Order #: {order}',    fontSize: 8,  bold: false, mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: 12,  y: 56,  rotation: 0, text: 'Courtesy of {guest}', fontSize: 9,  bold: false, mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: 12,  y: 72,  rotation: 0, text: '{title}',             fontSize: 15, bold: true,  mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: 12,  y: 98,  rotation: 0, text: '{note}',              fontSize: 8,  bold: false, mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: 12,  y: 116, rotation: 0,
        text: 'www.gulfislandswaterpark.com\nPlease complete a waiver before arriving.\nValid for one-time use only.\nNo cash value. Non-refundable. Not valid for resale or upgrades.',
        fontSize: 7, bold: false, mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: 12,  y: 176, rotation: 0, text: '#{index}', fontSize: 7, bold: false, mono: true, tracking: 0 },
      // ── Perforation guide at 1in before the end (x = 432) — shown in the
      //     designer, never printed: the stock is already perforated there ──
      { id: uid(), type: 'line', x: 336, y: 95, rotation: 90, w: 192, h: 2, dashed: true, guide: true },
      // ── Barcode zone past the perf — rotated so the bars run across the
      //     2in width like the sample, serial printed alongside ──
      { id: uid(), type: 'barcode', x: 394, y: 58, rotation: 90, value: '{barcode}', w: 176, h: 76, showText: true },
    ],
  };
}
