  // ---------- Full-report export (Excel, CSV, PDF) ----------
  // Both exports follow the current park / basis / range, so they match what is on screen.
  // The PDF is built natively with jsPDF + autoTable (lazy-loaded on first use); charts are
  // rasterised from their SVGs with the light palette forced so print colours are consistent.
  const XLIBS = ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'];
  const REPORT_TITLE = (document.title || 'Season Per Cap Dashboard').trim();
  const HAS_MKT = !!(D.meta.marketing && document.getElementById('sec-marketing'));
  const IS_BETA = !!document.querySelector('.beta');
  const ORG = 'Blue Bayou & Gulf Islands Waterparks';
  const BASISNAME = { booked:'Tickets booked', ci:'Checked in at the gate' };
  const txt = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const fileStem = () => `${REPORT_TITLE.replace(/\s*dashboard\s*/i, ' ').replace(/[—–]/g, ' ').trim().replace(/[^A-Za-z0-9]+/g, '-')}-${PARKNAME[state.park].replace(/\s+/g, '-')}-${state.from}_${state.to}`.replace(/-Gulf-Islands-Gulf-Islands/, '-Gulf-Islands');
  const generatedAt = () => new Date().toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
  function download(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function htmlToText(html){ const d = document.createElement('div'); d.innerHTML = html; d.querySelectorAll('br').forEach(b => b.replaceWith('\n')); d.querySelectorAll('p, li, div').forEach(p => p.append('\n')); return d.textContent.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean); }

  // Blocks of a section in reading order. Chart-data tables (inside "Data behind the chart")
  // and drill-down / thin-day panels are interactive extras, so the PDF leaves them out.
  function sectionBlocks(sec, forPdf){
    const out = [];
    sec.querySelectorAll('.kpi-grid, table, svg.chart, .alc-h h3, #mkt-mix, p.note').forEach(el => {
      if (el.closest('#drill, #thin, #alc-thin, #ret-thin')) return;
      if (el.closest('#mkt-mix') && el.id !== 'mkt-mix') return;
      const det = el.closest('details');
      const chartData = det && /data behind/i.test(txt(det.querySelector('summary')));
      if (forPdf && chartData) return;
      if (el.matches('h3')) out.push({ kind:'h3', text: txt(el) });
      else if (el.matches('.kpi-grid')) out.push({ kind:'kpis', el });
      else if (el.matches('table')) { if (el.querySelector('tbody tr, tr td')) out.push({ kind:'table', el, chartData }); }
      else if (el.matches('svg')) { if (el.childElementCount) out.push({ kind:'chart', el }); }
      else if (el.id === 'mkt-mix') out.push({ kind:'mktmix', el });
      else if (el.matches('p.note')) { const t = forPdf ? printable(txt(el)) : txt(el); if (t) out.push({ kind:'note', text: t }); }
    });
    return out;
  }
  // On-screen instructions (click, hover, toggles, "see the explorer") mean nothing in a static export.
  const INTERACTIVE = /\b(click|clicking|hover|tap|toggles?|scroll|drill|expand|button|export|explorer|filtered to|use the)\b|→|->/i;
  function printable(s){
    s = String(s || '').replace(/ · showing top (\d+) \(export for all\)/, (m, n) => ` · top ${n} by revenue shown; the CSV export lists every product`);
    const keep = s.includes('the CSV export lists every product');
    return keep ? s : s.split(/(?<=[.!?])\s+/).filter(x => x && !INTERACTIVE.test(x)).join(' ');
  }
  const kpiRows = grid => [...grid.querySelectorAll('.kpi')].map(k => ({ label: txt(k.querySelector('.label')).replace(/\s*·\s*hover for breakdown/i, ''), value: txt(k.querySelector('.value')), sub: txt(k.querySelector('.sub')) }));
  function tableRows(t){
    const rows = el => [...el.querySelectorAll('tr')].map(tr => [...tr.children].map(c => txt(c)));
    if (t.id === 'tbl-products' && t.dataset.full) return { head: [['Product','Park','Category','Type','Qty','Revenue']], body: JSON.parse(t.dataset.full).map(r => r.map(String)) };
    const thead = t.querySelector('thead');
    if (thead) return { head: rows(thead), body: [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => txt(c))) };
    const all = rows(t); return { head: all.slice(0, 1), body: all.slice(1) };
  }
  function paramRows(){
    const rr = rowsFor(state.park, state.from, state.to); const days = new Set(rr.filter(operating).map(d => d.d)).size, closed = rr.filter(isClosed).length;
    return [['Park', PARKNAME[state.park]], ['Attendance basis', BASISNAME[state.basis]], ['Date range', `${fmtDate(state.from)} – ${fmtDate(state.to)}`], ['Coverage', `${days} operating day${days === 1 ? '' : 's'}${closed ? ` · ${closed} closed` : ''}`]];
  }

  // ----- Spreadsheet workbook (one model, written out as Excel or as a Google Sheet) -----
  // Cells carry real values — numbers, currency, percentages, dates — not the display strings.
  const EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
  const FMT = { usd0:'"$"#,##0', usd2:'"$"#,##0.00', pct0:'0%', pct1:'0.0%', int:'#,##0', dec1:'0.0', dec2:'0.00', date:'mmm d, yyyy' };
  const XC = { ink:'0B0B0B', ink2:'52514E', muted:'898781', head:'F2F1EC', rule:'C3C2B7', brand:'0A8A66' };
  const S = (v, o) => ({ v: v == null ? '' : String(v), t:'s', ...o });
  const N = (v, fmt, o) => ({ v, t:'n', fmt, ...o });
  function parseVal(s){
    s = String(s ?? '').replace(/ /g, ' ').trim(); let m;
    if (s === '' || s === '—' || s === '–') return S('');
    if ((m = s.match(/^(-)?\$(-)?([\d,]+)(\.\d+)?$/))) return N(Number(m[3].replace(/,/g, '') + (m[4] || '')) * (m[1] || m[2] ? -1 : 1), m[4] ? 'usd2' : 'usd0');
    if ((m = s.match(/^(-?[\d,]*\.?\d+)%$/))) return N(Number(m[1].replace(/,/g, '')) / 100, m[1].includes('.') ? 'pct1' : 'pct0');
    if (/^-?\d{1,3}(,\d{3})+$|^-?\d+$/.test(s)) return N(Number(s.replace(/,/g, '')), 'int');
    if ((m = s.match(/^-?\d+\.(\d+)$/))) return N(Number(s), m[1].length === 1 ? 'dec1' : 'dec2');
    return S(s);
  }
  const tabName = s => s.replace(/[\[\]:*?\/\\]/g, '').replace(/&/g, 'and').slice(0, 31);

  function domTableRows(t){
    if (t.id === 'tbl-products' && t.dataset.full) {
      const list = JSON.parse(t.dataset.full); const total = list.reduce((a, r) => a + r[5], 0);
      return [['Product', 'Park', 'Category', 'Type', 'Qty', 'Revenue', 'Avg price', 'Share'].map((h, j) => S(h, { head:true, right: j > 3 })),
        ...list.map(r => [S(r[0]), S(r[1]), S(r[2]), S(r[3]), N(r[4], 'int'), N(r[5], 'usd2'), r[4] ? N(r[5] / r[4], 'usd2') : S(''), total ? N(r[5] / total, 'pct1') : S('')])];
    }
    const thead = t.querySelector('thead');
    const heads = thead ? [...thead.querySelectorAll('tr')] : [t.querySelector('tr')].filter(Boolean);
    const body = [...t.querySelectorAll(thead ? 'tbody tr' : 'tr')].slice(thead ? 0 : 1);
    const span = (r, c, mk) => { r.push(mk()); for (let k = 1; k < (+c.getAttribute('colspan') || 1); k++) r.push(S('')); };
    return [
      ...heads.map(tr => { const r = []; [...tr.children].forEach(c => span(r, c, () => S(txt(c), { head:true, right: c.classList.contains('num') }))); return r; }),
      ...body.map(tr => { const r = [], muted = tr.classList.contains('muted'), brk = tr.classList.contains('group-break');
        [...tr.children].forEach((c, j) => span(r, c, () => { const x = j === 0 ? S(txt(c)) : parseVal(txt(c)); if (c.querySelector('b, strong')) x.b = true; if (muted) x.muted = true; if (brk) x.top = true; return x; })); return r; }),
    ];
  }
  const kpiBlock = grid => [['Metric', 'Value', 'Detail'].map((h, j) => S(h, { head:true, right: j === 1 })), ...kpiRows(grid).map(k => [S(k.label, { b:true }), parseVal(k.value), S(k.sub, { muted:true })])];

  function buildWorkbook(){
    const gen = generatedAt(), sheets = [];
    const sheet = (name, o = {}) => { const sh = { name: tabName(name), rows: [], freeze: 0, grid: false, ...o }; sheets.push(sh); return sh; };
    const add = (sh, ...rows) => rows.forEach(r => sh.rows.push(r));
    const summary = sheet('Summary');
    // Sections
    for (const [id, label] of SECTIONS) {
      const sec = document.getElementById(id); if (!sec) continue;
      const sh = sheet(label); sh.label = label;
      add(sh, [S(txt(sec.querySelector('h2')) || label, { title:true, free:true })]);
      const lede = printable(txt(sec.querySelector('.lede'))); if (lede) add(sh, [S(lede, { sub:true, free:true })]);
      for (const b of sectionBlocks(sec, false)) {
        if (b.kind === 'h3') add(sh, [], [S(b.text, { h3:true, free:true })]);
        else if (b.kind === 'kpis') add(sh, [], ...kpiBlock(b.el));
        else if (b.kind === 'table') { if (b.chartData) add(sh, [], [S('Chart data', { h3:true, free:true })]); else if (sh.rows.length && sh.rows[sh.rows.length - 1].some(c => c && !c.h3)) add(sh, []); add(sh, ...domTableRows(b.el)); }
        else if (b.kind === 'mktmix') { const MK = D.meta.marketing; add(sh, [], ['Component', 'Blue Bayou', 'Gulf Islands', 'Combined'].map((h, j) => S(h, { head:true, right: j > 0 })), ...MK.components.map(x => [S(x.label), N(x.BB, 'usd0'), N(x.GI, 'usd0'), N(x.BB + x.GI, 'usd0')])); }
        else if (b.kind === 'note') { const t = printable(b.text); if (t) add(sh, [S(t, { muted:true, i:true, free:true })]); }
      }
    }
    // Daily detail — one row per park-day, raw values, header on row 1 for pivots and filters.
    const daily = sheet('Daily Detail', { freeze: 1, grid: true });
    add(daily, ['Date', 'Weekday', 'Park', 'Status', 'Tickets booked', 'Checked in', 'Orders', 'Web orders', ...B.map(b => BL[b] || b), 'Total revenue', 'In-park revenue', 'Blended per cap', 'In-park per cap'].map((h, j) => S(h, { head:true, right: j > 3 })));
    for (const d of rowsFor(state.park, state.from, state.to).slice().sort((a, b) => a.d.localeCompare(b.d) || a.p.localeCompare(b.p))) {
      const s = sum([d]), status = isClosed(d) ? 'Closed' : d.att > 0 ? 'Operating' : 'No attendance';
      const n = status === 'Operating' ? denom({ att:d.att, ci:d.ci }) : 0;
      add(daily, [{ v:d.d, t:'d', fmt:'date' }, S(WEEKDAYS[dt(d.d).getUTCDay()]), S(PARKNAME[d.p]), S(status), N(d.att, 'int'), N(d.ci, 'int'), N(d.orders, 'int'), N(d.web, 'int'), ...d.r.map(v => N(v, 'usd2')), N(s.total, 'usd2'), N(s.inPark, 'usd2'), n ? N(s.total / n, 'usd2') : S(''), n ? N(s.inPark / n, 'usd2') : S('')]);
    }
    const meth = sheet('Methodology', { wide: true });
    add(meth, [S('Methodology & definitions', { title:true, free:true })], []);
    htmlToText(D.meta.footer).forEach(p => add(meth, [S(p, { wrap:true })], []));
    // Summary (built last so it can list every tab)
    add(summary, [S(REPORT_TITLE, { title:true, free:true })], [S(`${ORG} · Internal · Confidential`, { sub:true, free:true })], [],
      [S('Report parameters', { h3:true, free:true })], ...paramRows().map(([k, v]) => [S(k, { b:true }), S(v)]),
      [S('Generated', { b:true }), S(gen)], [S('Source', { b:true }), S(location.href.split('#')[0])],
      ...(IS_BETA ? [[S('Status', { b:true }), S('Beta — figures are preliminary and may change as definitions are validated.')]] : []), [],
      [S('Headline figures', { h3:true, free:true })], ...kpiBlock($('#kpis')), [],
      [S('Contents', { h3:true, free:true })], ...sheets.slice(1).map(sh => [S(sh.label || sh.name, { link: sh.name })]));
    // Column widths from the table cells (titles, ledes and notes overflow and are ignored).
    for (const sh of sheets) {
      const w = []; for (const r of sh.rows) r.forEach((c, j) => { if (!c || c.free || c.wrap || c.link) return; const len = c.t === 'n' ? 12 : c.t === 'd' ? 13 : c.v.length; w[j] = Math.max(w[j] || 0, len); });
      sh.widths = sh.wide ? [900] : [...Array(Math.max(w.length, 1)).keys()].map(j => Math.round(Math.min(Math.max((w[j] || 8) * 7 + 22, j === 0 ? 170 : 72), j === 0 ? 420 : 260)));
    }
    return sheets;
  }

  function loadScript(src){ return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`) && (src !== EXCELJS || window.ExcelJS)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }

  async function exportReportXLSX(){
    await loadScript(EXCELJS);
    const book = buildWorkbook(), wb = new window.ExcelJS.Workbook();
    wb.creator = ORG; wb.created = new Date(); wb.title = REPORT_TITLE;
    for (const sh of book) {
      const ws = wb.addWorksheet(sh.name, { views: [{ state: sh.freeze ? 'frozen' : 'normal', ySplit: sh.freeze || 0, showGridLines: sh.grid }] });
      sh.widths.forEach((px, j) => { ws.getColumn(j + 1).width = Math.round(px / 7); });
      sh.rows.forEach((r, i) => r.forEach((c, j) => {
        if (!c) return; const cell = ws.getCell(i + 1, j + 1);
        if (c.link) cell.value = { text: c.v, hyperlink: `#'${c.link}'!A1` };
        else if (c.t === 'd') cell.value = new Date(c.v + 'T00:00:00Z');
        else cell.value = c.t === 'n' ? c.v : c.v || null;
        if (FMT[c.fmt]) cell.numFmt = FMT[c.fmt];
        const font = { name: 'Arial', size: c.title ? 16 : c.h3 ? 12 : c.head ? 9 : 10 };
        if (c.title || c.h3 || c.head || c.b) font.bold = true; if (c.i) font.italic = true;
        font.color = { argb: 'FF' + (c.link ? XC.brand : c.head ? XC.ink2 : c.muted || c.sub ? XC.muted : XC.ink) }; if (c.link) font.underline = true;
        cell.font = font;
        if (c.head) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + XC.head } }; cell.border = { bottom: { style: 'thin', color: { argb: 'FF' + XC.rule } } }; }
        if (c.top) cell.border = { ...(cell.border || {}), top: { style: 'medium', color: { argb: 'FF' + XC.rule } } };
        if (c.right) cell.alignment = { horizontal: 'right' }; if (c.wrap) cell.alignment = { wrapText: true, vertical: 'top' };
      }));
    }
    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileStem() + '.xlsx');
  }

  // ----- CSV: the workbook flattened into one file — data only, consistent value formats -----
  // Money "$1,234.56", percentages "12.5%", dates ISO: Excel and Google Sheets read all three as
  // numbers/dates on open. Prose (section intros, notes, KPI detail text) is left to the PDF.
  const csvVal = c => !c ? '' : c.t === 'd' ? c.v : c.t !== 'n' ? c.v
    : c.fmt === 'usd0' || c.fmt === 'usd2' ? (c.v < 0 ? '-' : '') + '$' + Math.abs(c.v).toLocaleString('en-US', c.fmt === 'usd2' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })
    : c.fmt === 'pct0' || c.fmt === 'pct1' ? (c.v * 100).toFixed(1) + '%'
    : c.fmt === 'dec1' ? c.v.toFixed(1) : c.fmt === 'dec2' ? c.v.toFixed(2) : String(c.v);
  function exportReportCSV(){
    let parent = '';
    const out = [], blank = () => { if (out.length && out[out.length - 1].length) out.push([]); };
    for (const sh of buildWorkbook()) {
      if (sh.name === 'Methodology') continue;
      blank(); if (out.length) out.push([]);
      if (!(sh.rows[0] && sh.rows[0][0] && sh.rows[0][0].title)) out.push([sh.name.toUpperCase()], []);
      for (const r of sh.rows) {
        const c0 = r.find(Boolean);
        if (!c0) { blank(); continue; }
        if (c0.title) { out.push([sh.name === 'Summary' ? c0.v : c0.v.toUpperCase()]); continue; }
        if (c0.link) continue;
        if (c0.sub || (c0.free && !c0.h3)) { if (sh.name === 'Summary' && c0.sub) out.push([c0.v]); continue; }
        if (c0.h3) { if (c0.v === 'Contents') break; blank(); out.push([c0.v]); continue; }
        // KPI blocks: Metric, Value (the detail column is prose)
        const kpi = r.length === 3 && r[2] && ((r[0].head && r[2].v === 'Detail') || (r[0].b && r[2].muted && !r[0].head));
        const cells = r.map(csvVal); if (kpi) cells.length = 2;
        // Sub-rows like "per checked-in guest" only make sense under their parent row; name it.
        if (r[0] && !r[0].head) { if (r[0].muted && /^[a-z]/.test(r[0].v) && parent) cells[0] = `${parent} — ${r[0].v}`; else if (!r[0].muted) parent = r[0].v; }
        while (cells.length && cells[cells.length - 1] === '') cells.pop();
        out.push(cells);
      }
    }
    const enc = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    download(new Blob(['\ufeff' + out.map(r => r.map(enc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), fileStem() + '.csv');
  }

  // ----- Export menu -----
  function xNotice(msg, url, sticky){
    let el = document.getElementById('x-notice'); if (!el) { el = document.createElement('div'); el.id = 'x-notice'; el.className = 'x-notice'; document.body.appendChild(el); }
    el.innerHTML = `<span></span>${url ? '<a target="_blank" rel="noopener">New Google Sheet</a>' : ''}<button type="button" aria-label="Dismiss">×</button>`;
    el.querySelector('span').textContent = msg; if (url) el.querySelector('a').href = url;
    el.querySelector('button').onclick = () => el.classList.remove('show'); el.classList.add('show');
    clearTimeout(el._t); if (!url && !sticky) el._t = setTimeout(() => el.classList.remove('show'), 7000);
  }
  function initReportExport(){
    const btn = $('#exp-btn'), pop = $('#exp-pop'); if (!btn || !pop) return;
    const label = btn.querySelector('span'), close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
    document.addEventListener('click', e => { if (!pop.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const run = async (busyLabel, fn) => { close(); btn.disabled = true; label.textContent = busyLabel; try { await fn(); } catch (e) { console.error(e); xNotice(e.message || 'Export failed.'); } finally { btn.disabled = false; label.textContent = 'Export'; } };
    pop.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
      const x = b.dataset.x;
      if (x === 'pdf') return run('Building PDF…', exportReportPDF);
      if (x === 'xlsx') return run('Building Excel…', exportReportXLSX);
      if (x === 'csv') return run('Building CSV…', async () => exportReportCSV());
    });
  }

  // ----- PDF -----
  let libsP = null;
  function loadLibs(){
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    return libsP = libsP || XLIBS.reduce((p, src) => p.then(() => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); })), Promise.resolve()).catch(e => { libsP = null; throw e; });
  }
  // Standard PDF fonts are WinAnsi only; map the few symbols the dashboard uses, drop anything else.
  const WIN = new Set('–—‘’“”•…€™‹›„‚†‡‰ŠŒŽšœžŸƒˆ˜');
  const pdfSafe = s => String(s ?? '').replace(/→/g, '->').replace(/←/g, '<-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/−/g, '-').replace(/ /g, ' ').replace(/[^\x00-\xff]/g, c => WIN.has(c) ? c : '').replace(/ {2,}/g, ' ').trim();
  const rgb = css => { const m = String(css).match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a] = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return (a === 0) ? null : [r, g, b]; };

  async function svgToPng(svg, pxWidth){
    const vb = svg.viewBox.baseVal; let x0 = vb.x, y0 = vb.y, x1 = vb.x + vb.width, y1 = vb.y + vb.height;
    try { const bb = svg.getBBox(); x0 = Math.min(x0, bb.x - 4); y0 = Math.min(y0, bb.y - 4); x1 = Math.max(x1, bb.x + bb.width + 4); y1 = Math.max(y1, bb.y + bb.height + 4); } catch(e){}
    const w = x1 - x0, h = y1 - y0;
    const clone = svg.cloneNode(true); const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
    const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'display', 'visibility'];
    src.forEach((el, i) => { const cs = getComputedStyle(el), d = dst[i]; d.removeAttribute('class'); for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v) d.style.setProperty(p, v); } if (el.tagName === 'text' || el.tagName === 'tspan') d.style.fontFamily = 'Helvetica, Arial, sans-serif'; });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`); clone.setAttribute('width', w); clone.setAttribute('height', h); clone.removeAttribute('class'); clone.removeAttribute('style');
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    await img.decode();
    const k = pxWidth / w, c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/png'), w, h };
  }

  async function exportReportPDF(){
    await loadLibs();
    const root = document.documentElement, prevTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light'); getComputedStyle(root).color; // force the light palette for colours we read back
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'letter', compress:true });
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 42, CW = W - 2 * M, TOP = 64, BOT = H - 46;
      const INK = [11, 11, 11], INK2 = [82, 81, 78], MUTED = [137, 135, 129], RULE = [225, 224, 217], FILL = [247, 247, 244], BRAND = [10, 138, 102], AMBER = [201, 133, 0];
      const PC = { BB:[42, 120, 214], GI:[27, 175, 122] };
      const gen = generatedAt(); const sectionPages = []; let y = TOP;
      const font = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
      const wrap = (s, w) => doc.splitTextToSize(pdfSafe(s), w);
      const newPage = () => { doc.addPage(); y = TOP; };
      const need = h => { if (y + h > BOT) newPage(); };
      const para = (s, size, color, w = CW, lh = 1.4, style = 'normal') => { font(size, style, color); const lines = wrap(s, w); for (const ln of lines) { need(size * lh); doc.text(ln, M, y + size * 0.8); y += size * lh; } };

      // KPI tile row(s)
      function kpiTiles(list, perRow){
        const n = Math.min(perRow, list.length) || 1, gap = 8, tw = (CW - gap * (n - 1)) / n;
        for (let i = 0; i < list.length; i += n) {
          const row = list.slice(i, i + n);
          const subs = row.map(k => { font(7.5); return wrap(k.sub, tw - 18).slice(0, 4); });
          const th = 46 + Math.max(...subs.map(s => s.length)) * 9.5;
          need(th + gap);
          row.forEach((k, j) => {
            const x = M + j * (tw + gap);
            doc.setFillColor(...FILL); doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.rect(x, y, tw, th, 'FD');
            doc.setFillColor(...BRAND); doc.rect(x, y, 2.2, th, 'F');
            font(6.8, 'bold', MUTED); doc.text(wrap(k.label.toUpperCase(), tw - 18)[0], x + 10, y + 14);
            font(15, 'bold', INK); doc.text(pdfSafe(k.value), x + 10, y + 33);
            font(7.5, 'normal', INK2); subs[j].forEach((ln, q) => doc.text(ln, x + 10, y + 45 + q * 9.5));
          });
          y += th + gap;
        }
        y += 4;
      }
      // Legend swatches (from the HTML legend above a chart)
      function legend(el){
        if (!el) return; const items = [...el.querySelectorAll('.item')]; if (!items.length) return;
        let x = M; need(14); font(7.5, 'normal', INK2);
        for (const it of items) { const label = pdfSafe(txt(it)); const sw = it.querySelector('.sw'); const w = doc.getTextWidth(label) + 20; if (x + w > M + CW) { x = M; y += 12; need(14); } const c = sw && rgb(getComputedStyle(sw).backgroundColor); if (c) { doc.setFillColor(...c); doc.rect(x, y + 1, 7, 7, 'F'); } doc.text(label, x + 11, y + 7.5); x += w; }
        y += 16;
      }
      const chartW = svg => svg.viewBox.baseVal.width < 700 ? CW * 0.6 : CW;
      const chartH = svg => Math.min(BOT - TOP - 10, chartW(svg) * svg.viewBox.baseVal.height / svg.viewBox.baseVal.width * 1.04);
      async function chart(svg){
        need(chartH(svg) + 24);
        const prev = svg.previousElementSibling; legend(prev && prev.classList.contains('legend') ? prev : null);
        const maxW = chartW(svg);
        const png = await svgToPng(svg, 2000 * (maxW / CW)); let w = maxW, h = w * png.h / png.w;
        if (h > BOT - TOP - 10) { h = BOT - TOP - 10; w = h * png.w / png.h; }
        need(h + 8); doc.addImage(png.data, 'PNG', M, y, w, h, undefined, 'FAST'); y += h + 10;
      }
      function mktMix(el){
        legend(el.querySelector('.legend'));
        for (const r of el.querySelectorAll('.mkt-row')) {
          need(52); font(9, 'bold', INK); doc.text(pdfSafe(txt(r.querySelector('.mkt-head b'))), M, y + 8);
          font(9, 'normal', MUTED); doc.text(pdfSafe(txt(r.querySelector('.mkt-total'))), M + CW, y + 8, { align:'right' }); y += 13;
          const segs = [...r.querySelectorAll('.mkt-seg')]; const tot = segs.reduce((a, s) => a + (parseFloat(s.style.flexGrow || s.style.flex) || 0), 0); let x = M;
          for (const s of segs) { const v = parseFloat(s.style.flexGrow || s.style.flex) || 0; const w = tot ? CW * v / tot : 0; const c = rgb(getComputedStyle(s).backgroundColor) || MUTED; doc.setFillColor(...c); doc.rect(x, y, w, 14, 'F'); const lab = txt(s); if (lab && w > 26) { font(7, 'bold', [255, 255, 255]); doc.text(lab, x + w / 2, y + 9.6, { align:'center' }); } x += w; }
          y += 20; font(7.3, 'normal', INK2); for (const ln of wrap([...r.querySelectorAll('.mkt-parts span')].map(txt).join('   ·   '), CW)) { need(10); doc.text(ln, M, y + 6); y += 10; }
          y += 6;
        }
      }
      function table(t){
        const thead = t.querySelector('thead'); const headRows = thead ? [...thead.querySelectorAll('tr')] : [t.querySelector('tr')].filter(Boolean);
        const bodyRows = [...t.querySelectorAll(thead ? 'tbody tr' : 'tr')].slice(thead ? 0 : 1);
        const cell = (c, isHead) => {
          const o = { content: pdfSafe(txt(c)), styles: {} }; const span = +c.getAttribute('colspan'); if (span > 1) o.colSpan = span;
          if (c.classList.contains('num')) o.styles.halign = 'right';
          if (isHead) { const col = rgb(getComputedStyle(c).color); if (c.matches('.bb, .gi')) o.styles.textColor = col; }
          else { if (c.querySelector('b, strong')) o.styles.fontStyle = 'bold'; const pill = c.querySelector('.pill'); if (pill && pill.textContent.trim() === txt(c)) { const pc = rgb(getComputedStyle(pill).backgroundColor); if (pc) { o.styles.textColor = pc; o.styles.fontStyle = 'bold'; } } }
          return o;
        };
        const breaks = new Set(), muted = new Set();
        const body = bodyRows.map((tr, i) => { if (tr.classList.contains('group-break')) breaks.add(i); if (tr.classList.contains('muted')) muted.add(i); return [...tr.children].map(c => cell(c, false)); });
        need(40);
        doc.autoTable({
          startY: y, head: headRows.map(tr => [...tr.children].map(c => cell(c, true))), body,
          margin: { left: M, right: M, top: TOP, bottom: H - BOT }, theme: 'plain', showHead: 'everyPage', rowPageBreak: 'avoid',
          styles: { font: 'helvetica', fontSize: 7.6, textColor: INK, cellPadding: { top: 3.6, bottom: 3.6, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle' },
          headStyles: { fillColor: [242, 241, 236], textColor: MUTED, fontStyle: 'bold', fontSize: 6.8 },
          alternateRowStyles: { fillColor: [251, 251, 249] },
          didParseCell: d => { if (d.section === 'body' && muted.has(d.row.index)) d.cell.styles.textColor = MUTED; if (d.section === 'head') d.cell.text = d.cell.text.map(s => s.toUpperCase()); },
          didDrawCell: d => { doc.setDrawColor(...RULE); doc.setLineWidth(0.5); const yb = d.cell.y + d.cell.height; doc.line(d.cell.x, yb, d.cell.x + d.cell.width, yb);
            if (d.section === 'body' && breaks.has(d.row.index)) { doc.setDrawColor(195, 194, 183); doc.setLineWidth(1.1); doc.line(d.cell.x, d.cell.y, d.cell.x + d.cell.width, d.cell.y); } },
        });
        y = doc.lastAutoTable.finalY + 12;
      }

      // ---- Cover ----
      doc.setFillColor(...INK); doc.rect(0, 0, W, 196, 'F');
      doc.setFillColor(...BRAND); doc.rect(0, 196, W, 3, 'F');
      font(8, 'bold', [120, 214, 178]); doc.text(pdfSafe(ORG.toUpperCase() + '  ·  ANALYTICS'), M, 58);
      font(28, 'bold', [255, 255, 255]); doc.text(REPORT_TITLE, M, 98);
      font(11, 'normal', [195, 194, 183]); doc.text(pdfSafe(`Season per cap report  ·  ${PARKNAME[state.park]}  ·  ${fmtDate(state.from)} – ${fmtDate(state.to)}`), M, 122);
      font(7.5, 'bold', [255, 255, 255]); const conf = 'INTERNAL  ·  CONFIDENTIAL'; const cw = doc.getTextWidth(conf) + 16;
      doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.7); doc.rect(W - M - cw, 46, cw, 17, 'S'); doc.text(conf, W - M - cw / 2, 57.5, { align:'center' });
      font(8, 'normal', [160, 159, 152]); doc.text(pdfSafe(`Generated ${gen}`), M, 170);
      // parameters strip
      y = 222; const pr = paramRows(), pw = CW / pr.length;
      pr.forEach(([k, v], i) => { const x = M + i * pw; font(6.8, 'bold', MUTED); doc.text(k.toUpperCase(), x, y); font(9.5, 'bold', INK); wrap(v, pw - 14).slice(0, 2).forEach((ln, q) => doc.text(ln, x, y + 14 + q * 12)); });
      y += 44; doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.line(M, y, M + CW, y); y += 16;
      font(11, 'bold', INK); doc.text('Headline figures', M, y + 8); y += 18;
      kpiTiles(kpiRows($('#kpis')), 3);
      if (IS_BETA) {
      // beta notice
      const betaLines = (() => { font(8); return wrap('This dashboard is in beta. The numbers are still being validated and the definitions behind them may be refined, so figures can change between versions. Treat everything here as preliminary rather than final.', CW - 70); })();
      const bh = 14 + betaLines.length * 10.5; need(bh);
      doc.setFillColor(253, 246, 232); doc.setDrawColor(...AMBER); doc.setLineWidth(0.6); doc.rect(M, y, CW, bh, 'FD'); doc.setFillColor(...AMBER); doc.rect(M, y, 3, bh, 'F');
      font(7, 'bold', AMBER); doc.text('BETA', M + 14, y + 13); font(8, 'normal', INK2); betaLines.forEach((ln, q) => doc.text(ln, M + 56, y + 13 + q * 10.5)); y += bh + 10;
      }

      // ---- Sections ----
      let n = 0;
      for (const [id, label] of SECTIONS) {
        const sec = document.getElementById(id); if (!sec) continue;
        const blocks = sectionBlocks(sec, true); if (!blocks.length) continue;
        newPage(); n++; sectionPages.push({ label, title: txt(sec.querySelector('h2')) || label, page: doc.getNumberOfPages() });
        font(7.5, 'bold', BRAND); doc.text(`SECTION ${String(n).padStart(2, '0')}`, M, y + 6); y += 12;
        font(18, 'bold', INK); doc.text(pdfSafe(txt(sec.querySelector('h2')) || label), M, y + 15); y += 24;
        const lede = printable(txt(sec.querySelector('.lede'))); if (lede) { para(lede, 8.6, INK2, CW * 0.82); y += 8; }
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (b.kind === 'h3') { const nx = blocks[i + 1]; need(nx && nx.kind === 'chart' ? chartH(nx.el) + 46 : nx && nx.kind === 'table' ? 70 : 26); y += 4; font(10.5, 'bold', INK); doc.text(pdfSafe(b.text), M, y + 9); y += 16; }
          else if (b.kind === 'kpis') kpiTiles(kpiRows(b.el), 6);
          else if (b.kind === 'chart') await chart(b.el);
          else if (b.kind === 'mktmix') mktMix(b.el);
          else if (b.kind === 'table') table(b.el);
          else if (b.kind === 'note') { para(b.text, 7.6, MUTED); y += 6; }
        }
      }

      // ---- Methodology & revision history ----
      newPage(); sectionPages.push({ label: 'Methodology & definitions', page: doc.getNumberOfPages() });
      font(7.5, 'bold', BRAND); doc.text('APPENDIX', M, y + 6); y += 12;
      font(18, 'bold', INK); doc.text('Methodology & definitions', M, y + 15); y += 26;
      for (const p of htmlToText(D.meta.footer)) { para(p, 8.2, INK2, CW * 0.86); y += 5; }

      // ---- Contents (inserted as page 2, so every later page shifts by one) ----
      doc.insertPage(2); doc.setPage(2);
      const DESC = {
        'Summary': 'Report scope and the six headline figures',
        'Per Cap by Park': 'Revenue and every per cap by park, on both attendance bases',
        'Marketing': 'All-in marketing cost, what it is made of, and marketing per cap',
        'Trend': 'Per cap through the season for each park',
        'Revenue Mix': 'Monthly revenue by category, from tickets to lockers',
        'Alcohol': 'Alcohol revenue, per cap, drink types, hour of day and weekday',
        'Gift Shops': 'Retail revenue, product groups, registers and top sellers',
        'Cabanas & Rentals': 'Occupancy, RevPAC and rates by park, unit type and unit',
        'Products': 'Leading products by revenue with category and average price',
        'Sales Offices': 'Revenue by register and sales channel',
        'Day of Week': 'Attendance and per caps by weekday, weekdays versus weekends',
        'Methodology & definitions': 'Definitions, data sources and basis of preparation',
      };
      const PTOP = 58, PBOT = H - 44, LW = 236, RX = M + LW + 34, RW = W - M - RX;
      // Left panel: what this report covers
      doc.setFillColor(...FILL); doc.rect(M, PTOP, LW, PBOT - PTOP, 'F'); doc.setFillColor(...BRAND); doc.rect(M, PTOP, 3, PBOT - PTOP, 'F');
      let ly = PTOP + 34; const LX = M + 22, LIW = LW - 40;
      font(7.5, 'bold', BRAND); doc.text('CONTENTS', LX, ly); ly += 26;
      font(24, 'bold', INK); doc.text('In this report', LX, ly); ly += 34;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.line(LX, ly, LX + LIW, ly); ly += 20;
      for (const [k, v] of paramRows()) {
        font(6.8, 'bold', MUTED); doc.text(k.toUpperCase(), LX, ly); ly += 13;
        font(10, 'bold', INK); for (const ln of wrap(v, LIW)) { doc.text(ln, LX, ly); ly += 13; } ly += 9;
      }
      font(6.8, 'bold', MUTED); doc.text('GENERATED', LX, ly); ly += 13; font(10, 'bold', INK); doc.text(pdfSafe(gen), LX, ly);
      font(7.6, 'normal', INK2);
      const fine = wrap(`Figures reflect the filters above.${HAS_MKT ? ' Marketing cost is a full-season figure and is not date-filtered.' : ''} Product and sales office figures are monthly, so a custom range rounds out to the months it touches.`, LIW);
      let fy = PBOT - 22 - fine.length * 10.5; doc.setDrawColor(...RULE); doc.line(LX, fy - 14, LX + LIW, fy - 14);
      for (const ln of fine) { doc.text(ln, LX, fy); fy += 10.5; }
      // Right: the entries
      const entries = [{ label: 'Summary', title: 'Summary & headline figures', page: 1 }, ...sectionPages.map(s => ({ ...s, title: s.title || s.label, page: s.page + 1 }))];
      const rowH = Math.min(40, (PBOT - PTOP - 20) / entries.length);
      let ry = PTOP + 10;
      entries.forEach((e, i) => {
        const appendix = i === entries.length - 1, num = i === 0 ? '—' : appendix ? 'A' : String(i).padStart(2, '0');
        const mid = ry + rowH / 2;
        font(15, 'bold', i === 0 ? MUTED : BRAND); doc.text(num, RX, mid + 2);
        font(11.5, 'bold', INK); doc.text(pdfSafe(e.title), RX + 40, mid - 2);
        font(8, 'normal', MUTED); doc.text(pdfSafe(DESC[e.label] || ''), RX + 40, mid + 10);
        font(12, 'bold', INK); doc.text(String(e.page), RX + RW, mid + 2, { align: 'right' });
        font(6.5, 'bold', MUTED); doc.text('PAGE', RX + RW - doc.getTextWidth(String(e.page)) * 1.85 - 6, mid + 1.5, { align: 'right' });
        if (i < entries.length - 1) { doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(RX, ry + rowH, RX + RW, ry + rowH); }
        doc.link(RX, ry, RW, rowH, { pageNumber: e.page });
        ry += rowH;
      });

      // ---- Running header & footer on every page ----
      const total = doc.getNumberOfPages(); const scope = pdfSafe(`${PARKNAME[state.park]}  ·  ${BASISNAME[state.basis]}  ·  ${fmtDate(state.from)} – ${fmtDate(state.to)}`);
      for (let p = 1; p <= total; p++) {
        doc.setPage(p);
        if (p > 1) { font(7.5, 'bold', INK); doc.text(REPORT_TITLE, M, 34); font(7.5, 'normal', MUTED); doc.text(scope, W - M, 34, { align:'right' }); doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.line(M, 42, W - M, 42); }
        doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.line(M, H - 32, W - M, H - 32);
        font(7, 'normal', MUTED); doc.text(pdfSafe(`Internal · Confidential — ${ORG}. Do not distribute.`), M, H - 20);
        doc.text(pdfSafe(`Generated ${gen}`), W / 2, H - 20, { align:'center' });
        font(7, 'bold', INK2); doc.text(`Page ${p} of ${total}`, W - M, H - 20, { align:'right' });
      }
      doc.setProperties({ title: REPORT_TITLE, subject: `Season per cap report — ${PARKNAME[state.park]}, ${state.from} to ${state.to}`, author: ORG, creator: 'Blue Bayou Analytics' });
      doc.save(fileStem() + '.pdf');
    } finally {
      if (prevTheme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prevTheme);
    }
  }
