// Ticket template model — a fixed-size canvas of absolutely positioned
// elements (text / barcode / line / box), each draggable and rotatable in the
// designer. Text and barcode values may contain {placeholders} that are
// filled per ticket at render/print time.

export const PLACEHOLDERS = ['title', 'guest', 'date', 'price', 'note', 'barcode', 'index'];

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
      return { ...base, text: 'New text', fontSize: 14, bold: false, mono: false, color: '#111827', tracking: 0 };
    case 'barcode':
      return { ...base, value: '{barcode}', w: 300, h: 64, showText: true };
    case 'line':
      return { ...base, w: 200, h: 2, dashed: false, color: '#d1d5db' };
    case 'box':
      return { ...base, w: 160, h: 90, border: 1, dashed: false, radius: 8, color: '#d1d5db', fill: '' };
    default:
      return base;
  }
}

export function defaultTemplate() {
  return {
    width: 640,
    height: 250,
    bg: '#ffffff',
    elements: [
      { id: uid(), type: 'text', x: 20,  y: 16,  rotation: 0, text: 'BLUE BAYOU WATERPARK', fontSize: 10, bold: true,  mono: false, color: '#e11d48', tracking: 3 },
      { id: uid(), type: 'text', x: 402, y: 16,  rotation: 0, text: 'GULF ISLANDS',         fontSize: 10, bold: false, mono: false, color: '#9ca3af', tracking: 3 },
      { id: uid(), type: 'text', x: 20,  y: 36,  rotation: 0, text: '{title}',              fontSize: 24, bold: true,  mono: false, color: '#111827', tracking: 0 },
      { id: uid(), type: 'text', x: 20,  y: 70,  rotation: 0, text: '{note}',               fontSize: 11, bold: false, mono: false, color: '#6b7280', tracking: 0 },
      { id: uid(), type: 'text', x: 20,  y: 94,  rotation: 0, text: 'Guest: {guest}',       fontSize: 12, bold: false, mono: false, color: '#374151', tracking: 0 },
      { id: uid(), type: 'text', x: 210, y: 94,  rotation: 0, text: 'Valid: {date}',        fontSize: 12, bold: false, mono: false, color: '#374151', tracking: 0 },
      { id: uid(), type: 'text', x: 410, y: 94,  rotation: 0, text: '{price}',              fontSize: 12, bold: true,  mono: false, color: '#374151', tracking: 0 },
      { id: uid(), type: 'barcode', x: 20, y: 120, rotation: 0, value: '{barcode}', w: 480, h: 76, showText: true },
      // Stub: dashed divider (a horizontal line rotated 90° around its center), rotated caption, ticket counter
      { id: uid(), type: 'line', x: 413, y: 124, rotation: 90, w: 234, h: 2, dashed: true, color: '#d1d5db' },
      { id: uid(), type: 'text', x: 550, y: 96,  rotation: 90, text: 'ADMIT ONE', fontSize: 11, bold: true, mono: false, color: '#9ca3af', tracking: 5 },
      { id: uid(), type: 'text', x: 588, y: 110, rotation: 90, text: '{barcode}', fontSize: 8, bold: false, mono: true, color: '#6b7280', tracking: 1 },
      { id: uid(), type: 'text', x: 600, y: 226, rotation: 0, text: '#{index}',   fontSize: 9, bold: false, mono: true, color: '#d1d5db', tracking: 0 },
    ],
  };
}
