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

// Modeled on the park's BOCA thermal stock, in the printer's native
// orientation: PORTRAIT 2in × 5.5in — the head prints across the 2in width
// and the 5.5in length runs in the feed direction. Logo end at the top
// (usually pre-printed on the stock), rotated body text, and the barcode
// zone at the bottom past the perforation, which sits 1in from that end
// (y = 432). The stock is pre-perforated, so the perf is a non-printing guide.
export function defaultTemplate() {
  return {
    width: 2 * DPI,     // 192
    height: 5.5 * DPI,  // 528
    elements: [
      // ── Logo end — often already pre-printed on the stock; delete these
      //     or replace with an Image element of the real art ──
      { id: uid(), type: 'text', x: 12, y: 16, rotation: 0, text: 'GULF ISLANDS', fontSize: 9,  bold: true, mono: false, tracking: 2 },
      { id: uid(), type: 'text', x: 12, y: 28, rotation: 0, text: 'Waterpark',    fontSize: 16, bold: true, mono: false, tracking: 0 },
      // ── Body: vertical columns reading bottom-to-top (rotation 270),
      //     right-to-left like the printed GIWP sample ──
      { id: uid(), type: 'text', x: 135, y: 255, rotation: 270, text: 'Order #: {order}',    fontSize: 8,  bold: false, mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: 97,  y: 255, rotation: 270, text: 'Courtesy of {guest}', fontSize: 9,  bold: false, mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: 43,  y: 251, rotation: 270, text: '{title}',             fontSize: 15, bold: true,  mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: 59,  y: 256, rotation: 270, text: '{note}',              fontSize: 8,  bold: false, mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: -29, y: 243, rotation: 270, align: 'center',
        text: 'www.gulfislandswaterpark.com\nPlease complete a waiver before arriving.\nValid for one-time use only.\nNo cash value. Non-refundable. Not valid for resale or upgrades.',
        fontSize: 7, bold: false, mono: false, tracking: 0 },
      { id: uid(), type: 'text', x: -1,  y: 256, rotation: 270, text: 'Valid: {date}', fontSize: 9, bold: false, mono: false, tracking: 0 },
      // ── Perforation guide 1in before the barcode end — designer-only ──
      { id: uid(), type: 'line', x: 0, y: 431, rotation: 0, w: 192, h: 2, dashed: true, guide: true },
      // ── Barcode zone past the perf: serial above horizontal bars ──
      { id: uid(), type: 'text', x: 12, y: 442, rotation: 0, text: '{barcode}', fontSize: 9, bold: false, mono: true, tracking: 2 },
      { id: uid(), type: 'barcode', x: 12, y: 458, rotation: 0, value: '{barcode}', w: 168, h: 56, showText: false },
      { id: uid(), type: 'text', x: 150, y: 508, rotation: 0, text: '#{index}', fontSize: 7, bold: false, mono: true, tracking: 0 },
    ],
  };
}
