  // ---------- Full-report export (CSV + PDF) ----------
  // Both exports follow the current park / basis / range, so they match what is on screen.
  // The PDF is built natively with jsPDF + autoTable (lazy-loaded on first use); charts are
  // rasterised from their SVGs with the light palette forced so print colours are consistent.
  const XLIBS = ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'];
  const REPORT_TITLE = '2026 Season Per Cap Dashboard';
  const ORG = 'Blue Bayou & Gulf Islands Waterparks';
  const BASISNAME = { booked:'Tickets booked', ci:'Checked in at the gate' };
  const txt = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const fileStem = () => `2026-Season-Per-Cap-${PARKNAME[state.park].replace(/\s+/g, '-')}-${state.from}_${state.to}`;
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

  // ----- CSV: every section, its KPIs, tables and notes, plus a day-by-day detail table -----
  function exportReportCSV(){
    const rows = []; const blank = () => rows.push([]);
    rows.push([REPORT_TITLE]); rows.push([`${ORG} · Internal · Confidential`]);
    paramRows().forEach(r => rows.push(r));
    rows.push(['Generated', generatedAt()]); rows.push(['Source', location.href.split('#')[0]]);
    rows.push(['Status', 'Beta — figures are preliminary and may change as definitions are validated']);
    blank(); rows.push(['HEADLINE FIGURES']); rows.push(['Metric', 'Value', 'Detail']);
    kpiRows($('#kpis')).forEach(k => rows.push([k.label, k.value, k.sub]));
    for (const [id, label] of SECTIONS) {
      const sec = document.getElementById(id); if (!sec) continue;
      blank(); rows.push([label.toUpperCase()]); const lede = txt(sec.querySelector('.lede')); if (lede) rows.push([lede]);
      for (const b of sectionBlocks(sec, false)) {
        if (b.kind === 'h3') { blank(); rows.push([b.text]); }
        else if (b.kind === 'kpis') { rows.push(['Metric', 'Value', 'Detail']); kpiRows(b.el).forEach(k => rows.push([k.label, k.value, k.sub])); }
        else if (b.kind === 'table') { if (b.chartData) { blank(); rows.push(['Chart data']); } const t = tableRows(b.el); t.head.forEach(r => rows.push(r)); t.body.forEach(r => rows.push(r)); }
        else if (b.kind === 'mktmix') { const MK = D.meta.marketing; rows.push(['Component', 'Blue Bayou', 'Gulf Islands', 'Combined']); MK.components.forEach(x => rows.push([x.label, x.BB.toFixed(2), x.GI.toFixed(2), (x.BB + x.GI).toFixed(2)])); }
        else if (b.kind === 'note') rows.push(['Note: ' + b.text]);
      }
    }
    // Day-by-day detail straight from the embedded data (raw numbers, ready for a pivot table).
    blank(); rows.push(['DAILY DETAIL']); rows.push([`One row per park per day · per caps divide by ${BASISNAME[state.basis].toLowerCase()} · closed days keep their sales but carry no attendance`]);
    rows.push(['Date', 'Weekday', 'Park', 'Status', 'Tickets booked', 'Checked in', 'Orders', 'Web orders', ...B.map(b => `${BL[b] || b} revenue`), 'Total revenue', 'In-park revenue', 'Blended per cap', 'In-park per cap']);
    for (const d of rowsFor(state.park, state.from, state.to).slice().sort((a, b) => a.d.localeCompare(b.d) || a.p.localeCompare(b.p))) {
      const s = sum([d]); const status = isClosed(d) ? 'Closed' : d.att > 0 ? 'Operating' : 'No attendance';
      const n = status === 'Operating' ? denom({ att:d.att, ci:d.ci }) : 0;
      rows.push([d.d, WEEKDAYS[dt(d.d).getUTCDay()], PARKNAME[d.p], status, d.att, d.ci, d.orders, d.web, ...d.r.map(v => v.toFixed(2)), s.total.toFixed(2), s.inPark.toFixed(2), n ? (s.total / n).toFixed(2) : '', n ? (s.inPark / n).toFixed(2) : '']);
    }
    blank(); rows.push(['METHODOLOGY']); htmlToText(D.meta.footer).forEach(l => rows.push([l]));
    const csv = '﻿' + rows.map(r => r.map(v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
    download(new Blob([csv], { type:'text/csv;charset=utf-8' }), fileStem() + '.csv');
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
      // beta notice
      const betaLines = (() => { font(8); return wrap('This dashboard is in beta. The numbers are still being validated and the definitions behind them may be refined, so figures can change between versions. Treat everything here as preliminary rather than final.', CW - 70); })();
      const bh = 14 + betaLines.length * 10.5; need(bh);
      doc.setFillColor(253, 246, 232); doc.setDrawColor(...AMBER); doc.setLineWidth(0.6); doc.rect(M, y, CW, bh, 'FD'); doc.setFillColor(...AMBER); doc.rect(M, y, 3, bh, 'F');
      font(7, 'bold', AMBER); doc.text('BETA', M + 14, y + 13); font(8, 'normal', INK2); betaLines.forEach((ln, q) => doc.text(ln, M + 56, y + 13 + q * 10.5)); y += bh + 10;

      // ---- Sections ----
      let n = 0;
      for (const [id, label] of SECTIONS) {
        const sec = document.getElementById(id); if (!sec) continue;
        const blocks = sectionBlocks(sec, true); if (!blocks.length) continue;
        newPage(); n++; sectionPages.push({ label, page: doc.getNumberOfPages() });
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
      doc.insertPage(2); doc.setPage(2); y = TOP + 6;
      font(7.5, 'bold', BRAND); doc.text('CONTENTS', M, y); y += 12;
      font(18, 'bold', INK); doc.text('In this report', M, y + 15); y += 36;
      const entries = [{ label: 'Summary & headline figures', page: 1 }, ...sectionPages.map(s => ({ ...s, page: s.page + 1 }))];
      entries.forEach((e, i) => {
        const num = i === 0 ? '' : i === entries.length - 1 ? 'A' : String(i).padStart(2, '0');
        font(10, 'bold', BRAND); doc.text(num, M, y); font(10.5, 'normal', INK); doc.text(pdfSafe(e.label), M + 30, y);
        font(10.5, 'bold', INK); doc.text(String(e.page), M + CW * 0.62, y, { align:'right' });
        doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(M, y + 8, M + CW * 0.62, y + 8);
        doc.link(M, y - 11, CW * 0.62, 20, { pageNumber: e.page }); y += 24;
      });
      y += 10; font(8, 'normal', MUTED);
      for (const ln of wrap(`All figures reflect the filters applied when this report was generated: ${PARKNAME[state.park]}, divided by ${BASISNAME[state.basis].toLowerCase()}, ${fmtDate(state.from)} – ${fmtDate(state.to)}. Marketing cost is a full-season figure and is not date-filtered. Product and sales office figures are monthly, so a custom range rounds out to the months it touches.`, CW * 0.62)) { doc.text(ln, M, y); y += 11; }

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

  function initReportExport(){
    const csvBtn = $('#exp-csv'), pdfBtn = $('#exp-pdf'); if (!csvBtn || !pdfBtn) return;
    const busy = (btn, on, label) => { btn.disabled = on; btn.querySelector('span').textContent = label; };
    csvBtn.onclick = () => { try { exportReportCSV(); } catch (e) { console.error(e); alert('CSV export failed: ' + e.message); } };
    pdfBtn.onclick = async () => { busy(pdfBtn, true, 'Building PDF…'); try { await exportReportPDF(); } catch (e) { console.error(e); alert('PDF export failed: ' + e.message); } finally { busy(pdfBtn, false, 'Export PDF'); } };
  }
