// Code 39 (3-of-9) barcode encoder — no dependencies.
//
// Each symbol is 9 elements (5 bars + 4 spaces, alternating, starting with a
// bar); exactly 3 of the 9 are wide. 'n' = narrow, 'w' = wide. Symbols are
// separated by a narrow inter-character gap, and the value is wrapped in the
// '*' start/stop symbol.
const CODE39 = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw',
  'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn',
  'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn', 'K': 'wnnnnnnww', 'L': 'nnwnnnnww',
  'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn',
  'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
  'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw',
  'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

export const CODE39_CHARS = Object.keys(CODE39).filter(c => c !== '*');

/** Uppercase and strip anything Code 39 can't encode. */
export function sanitizeCode39(value) {
  return value
    .toUpperCase()
    .split('')
    .filter(c => c !== '*' && CODE39[c] !== undefined)
    .join('');
}

export function isValidCode39(value) {
  return value.length > 0 && value.split('').every(c => c !== '*' && CODE39[c] !== undefined);
}

/**
 * Encode a value into bar geometry.
 * Returns { bars: [{x, width}], totalWidth } in narrow-module units.
 */
export function encodeCode39(value, { wideRatio = 2.5 } = {}) {
  const text = `*${sanitizeCode39(value)}*`;
  const bars = [];
  let x = 0;
  for (let i = 0; i < text.length; i++) {
    const pattern = CODE39[text[i]];
    for (let j = 0; j < 9; j++) {
      const width = pattern[j] === 'w' ? wideRatio : 1;
      if (j % 2 === 0) bars.push({ x, width }); // even indexes are bars
      x += width;
    }
    if (i < text.length - 1) x += 1; // inter-character gap
  }
  return { bars, totalWidth: x };
}

/**
 * React-free SVG string for a Code 39 barcode (used for downloads);
 * the <Code39 /> component below renders the same geometry inline.
 */
export function code39Svg(value, { height = 60, moduleWidth = 2, wideRatio = 2.5 } = {}) {
  const { bars, totalWidth } = encodeCode39(value, { wideRatio });
  const w = Math.ceil(totalWidth * moduleWidth);
  const rects = bars
    .map(b => `<rect x="${(b.x * moduleWidth).toFixed(2)}" y="0" width="${(b.width * moduleWidth).toFixed(2)}" height="${height}" fill="#000"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}">${rects}</svg>`;
}
