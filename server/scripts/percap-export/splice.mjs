// Pure HTML transform shared by apply.mjs (server) and local testing: removes any
// previous export injection, then inserts the current one between markers so it
// can be re-applied whenever export-module.js changes.
// split/join only, never String.replace — the report is full of "$1,234" amounts.

const INIT = '  readHash(); initControls(); renderFooter(); renderUpdates(); renderAll(); initNav();';
const M = { css: ['  /* report-export:css */\n', '  /* /report-export:css */\n'], ui: ['<!-- report-export:ui -->', '<!-- /report-export:ui -->'], js: ['  /* report-export:js */\n', '  /* /report-export:js */\n'] };

const ICON = {
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7 9l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  sheets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/></svg>',
  xlsx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 12l6 6M15 12l-6 6"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
};

const CSS = `  .hero-row{ display:flex; gap:18px 28px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
  .hero-row > div:first-child{ flex:1 1 520px; min-width:0; }
  .export-menu{ position:relative; flex:none; padding-top:2px; }
  .btn-x{ display:inline-flex; align-items:center; gap:7px; font-size:12.5px; padding:8px 12px 8px 13px; background:var(--accent); color:var(--page); border-color:var(--accent); }
  .btn-x:hover{ color:var(--page); opacity:.88; } .btn-x:disabled{ opacity:.6; cursor:progress; }
  .btn-x svg{ width:14px; height:14px; flex:none; } .btn-x .chev{ width:13px; height:13px; opacity:.8; }
  .export-pop{ position:absolute; right:0; top:calc(100% + 6px); z-index:40; min-width:236px; background:var(--surface); border:1px solid var(--border); border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,.22); padding:5px; }
  .export-pop[hidden]{ display:none; }
  .export-pop button{ display:flex; align-items:center; gap:10px; width:100%; appearance:none; border:0; background:transparent; color:var(--ink); font:inherit; font-size:13px; font-weight:600; text-align:left; padding:9px 10px; border-radius:7px; cursor:pointer; }
  .export-pop button:hover{ background:var(--surface-2); }
  .export-pop svg{ width:16px; height:16px; flex:none; color:var(--ink-2); }
  .export-pop hr{ border:0; border-top:1px solid var(--border); margin:4px 2px; }
  .x-notice{ position:fixed; left:50%; bottom:24px; transform:translate(-50%,16px); z-index:60; display:flex; align-items:center; gap:14px; max-width:calc(100vw - 32px); background:var(--ink); color:var(--page); font-size:13px; font-weight:600; padding:11px 12px 11px 16px; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.3); opacity:0; pointer-events:none; transition:opacity .15s, transform .15s; }
  .x-notice.show{ opacity:1; transform:translate(-50%,0); pointer-events:auto; }
  .x-notice a{ color:var(--page); background:color-mix(in srgb,var(--page) 16%,transparent); padding:6px 10px; border-radius:7px; text-decoration:none; white-space:nowrap; }
  .x-notice button{ appearance:none; border:0; background:transparent; color:inherit; opacity:.7; font-size:18px; line-height:1; cursor:pointer; padding:0 4px; }
  @media print{ .export-menu, .x-notice{ display:none !important; } }
`;
const UI = `<div class="export-menu"><button class="btn btn-x" id="exp-btn" type="button" aria-haspopup="menu" aria-expanded="false">${ICON.export}<span>Export</span>${ICON.chevron}</button>`
  + `<div class="export-pop" id="exp-pop" role="menu" hidden>`
  + `<button type="button" role="menuitem" data-x="sheets">${ICON.sheets}Open in Google Sheets</button>`
  + `<button type="button" role="menuitem" data-x="xlsx">${ICON.xlsx}Download Excel (.xlsx)</button>`
  + `<button type="button" role="menuitem" data-x="pdf">${ICON.pdf}Download PDF</button>`
  + `</div></div>`;

function cut(h, start, end, keepEnd = false) {
  const a = h.indexOf(start); if (a < 0) return h;
  const b = h.indexOf(end, a); if (b < 0) throw new Error('unterminated block: ' + start.trim());
  return h.slice(0, a) + h.slice(keepEnd ? b : b + end.length);
}
function swapBlock(h, start, end, repl) {
  const a = h.indexOf(start); if (a < 0) return h;
  const b = h.indexOf(end, a); if (b < 0) throw new Error('unterminated block: ' + start.trim());
  return h.slice(0, a) + repl + h.slice(b + end.length);
}
const HERO_OPEN = '<header class="hero"><div class="hero-row"><div>\n', HERO_TAIL = '</p>\n  </div>\n    ';

export function stripExport(h) {
  h = cut(h, M.css[0], M.css[1]);
  h = cut(h, '  .hero-row{', '  .totop:hover{', true);               // first, unmarked version (live 2026-11-02)
  h = swapBlock(h, HERO_TAIL + M.ui[0], M.ui[1] + '\n  </div></header>', '</p>\n  </header>');
  h = swapBlock(h, HERO_TAIL + '<div class="export-actions">', '</div>\n  </div></header>', '</p>\n  </header>');
  h = h.split(HERO_OPEN).join('<header class="hero">\n');
  h = cut(h, M.js[0], M.js[1]);
  h = cut(h, '  // ---------- Full-report export', INIT, true);
  return h.split(INIT + ' initReportExport();').join(INIT);
}

export function applyExport(html, mod, clientId = '') {
  let h = stripExport(html);
  const once = (a, b) => { const p = h.split(a); if (p.length !== 2) throw new Error(`expected one match for: ${a.slice(0, 60)} (found ${p.length - 1})`); h = p.join(b); };
  once('  .totop:hover{', M.css[0] + CSS + M.css[1] + '  .totop:hover{');
  once('<header class="hero">\n', HERO_OPEN);
  once('</p>\n  </header>', `${HERO_TAIL}${M.ui[0]}${UI}${M.ui[1]}\n  </div></header>`);
  once(INIT, M.js[0] + mod.split('%%GSHEETS_CLIENT_ID%%').join(clientId) + M.js[1] + INIT + ' initReportExport();');
  return h;
}
