/* Built-in reader for scanned BOQs (PDF pages or photos), with no AI and no cost.
   Each page is drawn on a canvas, the table's ruled lines give the rows and columns,
   and Tesseract (open-source OCR, Arabic + English) reads the words, which are dropped into their cells.
   The result is plain table rows that boq-engine.js reads like an Excel sheet. */
(function (root) {
  'use strict';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const TARGET_W = 2600; // page width in pixels for OCR: big enough for small table text
  const AR = /[؀-ۿ]/;

  // Workers by language. English-only reading is about twice as fast, so Arabic is added only when the file has Arabic.
  const pools = {};
  function loadTess() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = TESS; s.onload = () => ok(root.Tesseract); s.onerror = () => bad(new Error('ما قدرت أحمّل قارئ الصور. تأكد من الإنترنت')); document.head.appendChild(s); });
  }
  function workers(langs, n) {
    const key = langs.join('+'), list = pools[key] = pools[key] || [];
    while (list.length < n) list.push(loadTess().then(T => T.createWorker(langs, 1, { logger: () => {} })).then(async w => { await w.setParameters({ preserve_interword_spaces: '1' }); return w; }));
    return Promise.all(list.slice(0, n)).catch(e => { delete pools[key]; throw e; });
  }
  const cores = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

  // Ruled lines: rows of pixels that are mostly dark are horizontal lines, columns are vertical lines.
  function grid(ctx, W, Hh) {
    const px = ctx.getImageData(0, 0, W, Hh).data;
    const dark = new Uint8Array(W * Hh);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) dark[j] = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) < 150 ? 1 : 0;
    const merge = (idx, gap) => { const out = []; let a = null, b = null; idx.forEach(v => { if (a === null) { a = b = v; } else if (v - b <= gap) b = v; else { out.push((a + b) / 2); a = b = v; } }); if (a !== null) out.push((a + b) / 2); return out; };
    // Longest dark run per row is robust against text (text never makes long unbroken runs).
    const hIdx = [];
    for (let y = 0; y < Hh; y++) { let run = 0, best = 0; const o = y * W; for (let x = 0; x < W; x++) { if (dark[o + x]) { run++; if (run > best) best = run; } else run = 0; } if (best > W * 0.25) hIdx.push(y); }
    const hs = merge(hIdx, 4);
    if (hs.length < 3) return null;
    const top = Math.floor(hs[0]), bot = Math.ceil(hs[hs.length - 1]), span = bot - top;
    const vIdx = [];
    for (let x = 0; x < W; x++) { let n = 0; for (let y = top; y <= bot; y++) n += dark[y * W + x]; if (n > span * 0.45) vIdx.push(x); }
    const vs = merge(vIdx, 4);
    return { hs, vs: vs.length < 3 ? null : vs, dark, W };
  }

  // Table borders read as | [ ] characters; drop them.
  const clean = t => String(t || '').replace(/[|\[\]{}\u200e\u200f]/g, ' ').replace(/\s+/g, ' ').trim();
  // A cell needs a second look when OCR left it empty or with a scrap that is not a word or a number.
  const weak = t => !t || (!/^[\d.,\-]+$/.test(t) && !/[A-Za-z\u0600-\u06FF]{3,}|\d/.test(t));
  function cellText(words) {
    if (!words.length) return '';
    const h = words.reduce((a, w) => a + (w.y1 - w.y0), 0) / words.length || 10;
    const lines = [];
    words.slice().sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1)).forEach(w => {
      const cy = (w.y0 + w.y1) / 2, l = lines.find(L => Math.abs(L.cy - cy) < h * 0.6);
      if (l) l.ws.push(w); else lines.push({ cy, ws: [w] });
    });
    return clean(lines.map(L => { const rtl = L.ws.some(w => AR.test(w.text)); return L.ws.sort((a, b) => rtl ? b.x0 - a.x0 : a.x0 - b.x0).map(w => w.text).join(' '); }).join(' '));
  }

  // Words -> table rows. With ruled lines every word goes into its cell; without them, rows follow text lines.
  function rowsOf(words, g, prevCols) {
    const ok = words.filter(w => w.text && w.text.trim() && (w.confidence != null ? w.confidence : 100) > 20).map(w => ({ text: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 }));
    let vs = g && g.vs;
    if (g && !vs && prevCols) vs = prevCols;
    if (g && vs) {
      const rows = [], rects = [];
      // The item-number column is the one with the most words that look like 3.12.
      const colOf = w => { const cx = (w.x0 + w.x1) / 2; for (let c = 0; c + 1 < vs.length; c++) if (cx > vs[c] && cx < vs[c + 1]) return c; return -1; };
      const isNo = w => /^\d+(\.\d+)*\.?$/.test(clean(w.text));
      const tally = {}; ok.forEach(w => { if (isNo(w)) { const c = colOf(w); tally[c] = (tally[c] || 0) + 1; } });
      const codeCol = +Object.keys(tally).sort((x, y) => tally[y] - tally[x])[0];
      // Bands between ruled lines; a band holding several item numbers (lists without row lines) is split per item.
      const bands = [];
      for (let r = 0; r + 1 < g.hs.length; r++) {
        const a = g.hs[r], b = g.hs[r + 1]; if (b - a < 12) continue;
        const inBand = ok.filter(w => { const cy = (w.y0 + w.y1) / 2; return cy > a && cy < b; });
        const starts = inBand.filter(w => isNo(w) && colOf(w) === codeCol).map(w => w.y0).sort((x, y) => x - y);
        if (starts.length < 2) { bands.push([a, b]); continue; }
        const cuts = [a].concat(starts.slice(1).map(y => y - 4), [b]);
        for (let k = 0; k + 1 < cuts.length; k++) bands.push([cuts[k], cuts[k + 1]]);
      }
      for (const [a, b] of bands) {
        const inRow = ok.filter(w => { const cy = (w.y0 + w.y1) / 2; return cy > a && cy < b; });
        if (!inRow.length) continue;
        const cells = [], boxes = [];
        for (let c = 0; c + 1 < vs.length; c++) { const l = vs[c], rr = vs[c + 1]; cells.push(cellText(inRow.filter(w => { const cx = (w.x0 + w.x1) / 2; return cx > l && cx < rr; }))); boxes.push({ left: Math.round(l), top: Math.round(a), width: Math.round(rr - l), height: Math.round(b - a) }); }
        rows.push(cells); rects.push(boxes);
      }
      // Totals printed under the table (TOTAL, PRELIMS, SUB-TOTAL, VAT, GRAND TOTAL) sit outside the ruled grid:
      // one row per text line, label in the description column and the amount in the last column.
      const end = g.hs[g.hs.length - 1], below = ok.filter(w => (w.y0 + w.y1) / 2 > end + 4);
      if (below.length) {
        const h = below.reduce((s2, w) => s2 + (w.y1 - w.y0), 0) / below.length || 20, lines = [];
        below.sort((a, b) => a.y0 - b.y0).forEach(w => { const cy = (w.y0 + w.y1) / 2, l = lines.find(L => Math.abs(L.cy - cy) < h * 0.6); if (l) l.ws.push(w); else lines.push({ cy, ws: [w] }); });
        lines.forEach(L => {
          const ws = L.ws.sort((a, b) => a.x0 - b.x0), isN = w => /^[\d.,]+$/.test(clean(w.text)) && /\d/.test(w.text);
          const amt = ws.filter(isN).map(w => clean(w.text)).pop(), label = clean(ws.filter(w => !isN(w)).map(w => w.text).join(' '));
          if (!amt || !/[A-Za-z\u0600-\u06FF]{3,}/.test(label)) return;
          const cells = new Array(vs.length - 1).fill(''); cells[Math.min(cells.length - 2, (codeCol >= 0 ? codeCol : 0) + 1)] = label; cells[cells.length - 1] = amt;
          rows.push(cells); rects.push(null);
        });
      }
      return { rows, rects, cols: vs };
    }
    // No ruled table: one row per text line, cells split at wide gaps.
    const h = ok.reduce((s, w) => s + (w.y1 - w.y0), 0) / (ok.length || 1) || 20;
    const lines = [];
    ok.sort((a, b) => a.y0 - b.y0).forEach(w => { const cy = (w.y0 + w.y1) / 2, l = lines.find(L => Math.abs(L.cy - cy) < h * 0.6); if (l) l.ws.push(w); else lines.push({ cy, ws: [w] }); });
    const rows = lines.map(L => { const ws = L.ws.sort((a, b) => a.x0 - b.x0), cells = []; let cur = [], lastX = null; ws.forEach(w => { if (lastX !== null && w.x0 - lastX > h * 1.6) { cells.push(cur); cur = []; } cur.push(w); lastX = w.x1; }); if (cur.length) cells.push(cur); return cells.map(cellText); });
    return { rows, cols: null };
  }

  async function readCanvas(canvas, prevCols, w, psm) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const g = grid(ctx, canvas.width, canvas.height);
    // Whole page in automatic layout mode (PSM 3); single cells later in block mode (PSM 6). Set every time so
    // every page reads the same way whichever worker gets it.
    await w.setParameters({ tessedit_pageseg_mode: psm || '3' });
    const { data } = await w.recognize(canvas);
    let words = data.words || [];
    let out = rowsOf(words, g, prevCols), fixedN = 0;
    // Second look, cell by cell, at cells that have ink but came back empty or as scraps (lone numbers and
    // short lists are easy to miss on a full page). The new words replace the old ones in that cell, then rows are rebuilt.
    if (out.rects) {
      const ink = r => { const p = 8; let n = 0; for (let y = r.top + p; y < r.top + r.height - p; y += 2) for (let x = r.left + p; x < r.left + r.width - p; x += 2) n += g.dark[y * g.W + x]; return n; };
      const todo = [];
      out.rows.forEach((row, i) => out.rects[i] && row.forEach((t, c) => { if (weak(t) && ink(out.rects[i][c]) > 12) todo.push(out.rects[i][c]); }));
      if (todo.length) {
        await w.setParameters({ tessedit_pageseg_mode: '6' });
        const inside = (wd, r) => { const cx = (wd.bbox.x0 + wd.bbox.x1) / 2, cy = (wd.bbox.y0 + wd.bbox.y1) / 2; return cx > r.left && cx < r.left + r.width && cy > r.top && cy < r.top + r.height; };
        for (const r of todo) {
          const p = 4, rc = { left: r.left + p, top: r.top + p, width: r.width - 2 * p, height: r.height - 2 * p };
          try {
            const res = await w.recognize(canvas, { rectangle: rc });
            let ws = (res.data.words || []).filter(x => x.text && x.text.trim());
            if (ws.length && ws.every(x => x.bbox.x0 < rc.left - 2 || x.bbox.y0 < rc.top - 2)) ws = ws.map(x => Object.assign({}, x, { bbox: { x0: x.bbox.x0 + rc.left, x1: x.bbox.x1 + rc.left, y0: x.bbox.y0 + rc.top, y1: x.bbox.y1 + rc.top } }));
            if (weak(clean(ws.map(x => x.text).join(' ')))) continue;
            words = words.filter(x => !inside(x, r)).concat(ws); fixedN++;
          } catch (e) { }
        }
        if (fixedN) out = rowsOf(words, g, prevCols);
      }
    }
    out.fixed = fixedN;
    root.BOQOCR.last = { w: canvas.width, h: canvas.height, hs: g && g.hs.length, vs: g && g.vs && g.vs.map(Math.round), words: (data.words || []).length, sample: (data.text || '').slice(0, 300), rows: out.rows.length, fixed: out.fixed };
    out.arabic = (data.words || []).filter(x => x.confidence > 60 && AR.test(x.text)).length / Math.max(1, (data.words || []).filter(x => x.confidence > 60).length);
    return out;
  }

  // Repeated column-header rows on later pages are dropped so the engine sees one table.
  function dropRepeatHeaders(rows) {
    const HW = /^(wbs.*|item.*|no\.?|qty\.?|quantity|unit|unit rate|rate|total.*price.*|.*description.*|الكمية|الوحدة|الوصف|البيان|سعر الوحدة|الإجمالي|البند|رقم البند)$/i;
    const isH = r => r.filter(c => HW.test(String(c).trim())).length >= 2;
    let seen = false; return rows.filter(r => { if (!isH(r)) return true; if (seen) return false; seen = true; return true; });
  }

  // OCR often drops the dots in item numbers (5.2 -> 52, 4.2.1 -> 4.21). Rebuild them from the neighbouring numbers.
  function fixCodes(rows) {
    const counts = {}; rows.forEach(r => r.forEach((c, i) => { if (/^\d+(\.\d+)+$/.test(String(c).trim())) counts[i] = (counts[i] || 0) + 1; }));
    const col = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a])[0];
    if (col == null) return rows;
    // Stray marks next to item numbers ("B 6.1", "! 0") come from borders and bullets.
    const codes = rows.map(r => { let c = String(r[col] || '').trim().replace(/^(\d+)\s*[\s,:;]\s*(\d+)$/, '$1.$2').replace(/^(\d+(?:\.\d+)*)(?:\.\s+|\s+)(\d+)$/, '$1.$2'); const m = c.match(/\d+(?:\.\d+)*/); if (m && c.length - m[0].length <= 3 && !/[A-Za-z\u0600-\u06FF]{2,}/.test(c)) c = m[0]; return c.replace(/\.$/, ''); });
    const good = i => /^\d+(\.\d+)+$/.test(codes[i]);
    const digits = c => c.replace(/\./g, '');
    const parent = c => c.split('.').slice(0, -1).join('.');
    const prefixes = c => c.split('.').map((_, k, a) => a.slice(0, k + 1).join('.'));
    const fixed = codes.slice();
    codes.forEach((c, i) => {
      if (!c || !/^[\d.]+$/.test(c)) return;
      let p = null, n = null;
      for (let k = i - 1; k >= 0 && !p; k--) if (good(k)) p = codes[k];
      for (let k = i + 1; k < codes.length && !n; k++) if (good(k)) n = codes[k];
      const d = digits(c), sibs = [];
      [n, p].forEach(x => { if (!x) return; const par = parent(x); if (par && d.startsWith(digits(par)) && d.length > digits(par).length) sibs.push(par + '.' + d.slice(digits(par).length)); });
      const heads = n ? prefixes(n) : [];
      // Section headings first ("41" before 4.1.1 is 4.1; "20" before 2.1 is 2.0, i.e. section 2), then siblings, then earlier sections.
      // OCR loses dots but never adds them, so a fix must have more dots than what was read.
      const dots = x => (x.match(/\./g) || []).length, more = x => dots(x) > dots(c);
      const hit = heads.find(x => more(x) && digits(x) === d) || (dots(c) === 0 ? heads.find(x => x.indexOf('.') < 0 && digits(x) + '0' === d) : null) ||
        sibs.find(x => more(x) && digits(x) === d) || (p ? prefixes(p) : []).find(x => more(x) && digits(x) === d);
      if (hit && hit !== c) fixed[i] = hit;
    });
    // A priced row whose number came back without its dots (2.3 read as "3", 2.11 as "2 :") takes the next number
    // after the item above it, as long as that still comes before the next item number read cleanly.
    const priced = r => r.some((c, k) => k !== col && /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(String(c).trim()) && +String(c).replace(/,/g, '') > 0);
    const isC = x => /^\d+(\.\d+)+$/.test(x || '');
    const lt = (x, y) => { const a = x.split('.').map(Number), b = y.split('.').map(Number); for (let k = 0; k < Math.max(a.length, b.length); k++) { const d = (a[k] || 0) - (b[k] || 0); if (d) return d < 0; } return false; };
    for (let i = 0; i < fixed.length; i++) {
      if (isC(fixed[i]) || !fixed[i] || !priced(rows[i]) || /total|carried|summary|prelim|vat|المجموع|الإجمالي/i.test(rows[i].join(' ')) || (fixed[i] && !/^[\d\s.,:;]*$/.test(fixed[i]))) continue;
      let p = null, n = null;
      for (let k = i - 1; k >= 0 && !p; k--) if (isC(fixed[k])) p = fixed[k];
      for (let k = i + 1; k < fixed.length && !n; k++) if (isC(fixed[k])) n = fixed[k];
      if (!p) continue;
      const seg = p.split('.'), cand = seg.slice(0, -1).concat(+seg[seg.length - 1] + 1).join('.');
      if (!n || lt(cand, n)) fixed[i] = cand;
    }
    rows = rows.map((r, i) => { if (fixed[i] === String(r[col] || '')) return r; const o = r.slice(); o[col] = fixed[i]; return o; });
    // Commas read as dots: when the document writes thousands as 1,234, a lone 2.503 is really 2,503.
    const nums = []; rows.forEach(r => r.forEach((c, i) => { if (i !== col && /^[\d.,]+$/.test(String(c).trim())) nums.push(String(c).trim()); }));
    const comma = nums.filter(x => /^\d{1,3}(,\d{3})+$/.test(x)).length, dec = nums.filter(x => /\.\d{1,2}$|,\d{3}\.\d+$/.test(x)).length;
    if (comma >= 5 && dec <= comma * 0.1) rows = rows.map(r => r.map((c, i) => i !== col && /^\d{1,3}\.\d{3}$/.test(String(c).trim()) ? String(c).trim().replace('.', ',') : c));
    return rows;
  }


  // A priced row is "sound" when its last three numbers agree: qty x rate = total.
  const nums = r => r.map(c => { const t = String(c).replace(/,/g, '').trim(); return /^\d+(\.\d+)?$/.test(t) ? +t : NaN; });
  const isCode = c => /^\d+(\.\d+)+$/.test(String(c).trim());
  function sound(r) { const n = nums(r).filter(x => !isNaN(x)); if (n.length < 3) return false; const [q, rt, t] = n.slice(-3); return t > 0 && Math.abs(q * rt - t) <= Math.max(1, t * 0.05); }
  const pageScore = rows => { const coded = rows.filter(r => isCode(r[0]) && nums(r).some(x => !isNaN(x))); const good = coded.filter(sound).length; return { coded: coded.length, good }; };
  // Two reads of the same page: start from the better one, swap in sound rows for unsound ones and add sound rows it missed.
  const cmp = (x, y) => { const a = x.split('.').map(Number), b = y.split('.').map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
  function mergeReads(a, b) {
    a = fixCodes(a); b = fixCodes(b);
    const [base, other] = pageScore(a).good >= pageScore(b).good ? [a, b] : [b, a];
    const key = rows => { const seen = {}; return rows.map(r => { if (!isCode(r[0])) return null; const c = r[0].trim(); seen[c] = (seen[c] || 0) + 1; return c + '#' + seen[c]; }); };
    const kb = key(base), ko = key(other), out = base.slice(), outK = kb.slice();
    ko.forEach((k, i) => {
      if (!k) return;
      const j = outK.indexOf(k);
      if (j >= 0) { if (sound(other[i]) && !sound(out[j])) out[j] = other[i]; return; }
      // A missed item needs at least a quantity and a total (its rate may be misread; the total is what counts).
      const nn = nums(other[i]).filter(x => !isNaN(x)); if (nn.length < 2 || !(nn[nn.length - 1] > 0)) return;
      // Missing in the base: it goes in only where its number fits between its neighbours (7.1.2 between 7.1.1 and 7.2.1),
      // which keeps a misread number from bringing an item in twice.
      if (out.some(r => r[0] && r[0].replace(/\D/g, '') === k.split('#')[0].replace(/\D/g, ''))) return;
      const c = k.split('#')[0];
      let at = -1; for (let m = i - 1; m >= 0 && at < 0; m--) if (ko[m]) at = outK.indexOf(ko[m]);
      if (at < 0) { if (outK.findIndex(Boolean) < 0) return; at = outK.findIndex(Boolean) - 1; }
      const prevK = outK.slice(0, at + 1).filter(Boolean).pop(), nextK = outK.slice(at + 1).find(Boolean);
      if ((prevK && cmp(prevK.split('#')[0], c) >= 0) || (nextK && cmp(c, nextK.split('#')[0]) >= 0)) return;
      if (at < 0) { const f = outK.findIndex(Boolean); if (f < 0) return; out.splice(f, 0, other[i]); outK.splice(f, 0, k); return; }
      let pos = at + 1; while (pos < out.length && !outK[pos] && !/total|carried/i.test(out[pos].join(' '))) pos++;
      out.splice(pos, 0, other[i]); outK.splice(pos, 0, k);
    });
    return out;
  }
  // Each page is read in automatic layout mode first; a page with unsound or missing prices gets a second read in
  // block mode and the two are merged. Both modes are set explicitly so every computer reads the same way.
  async function readPage(canvas, prevCols, w) {
    const r1 = await readCanvas(canvas, prevCols, w, '3'), s1 = pageScore(r1.rows);
    if (s1.coded && s1.good === s1.coded) return r1;
    const r2 = await readCanvas(canvas, prevCols, w, '6');
    return Object.assign({}, r1, { rows: mergeReads(r1.rows, r2.rows) });
  }
  async function pageCanvas(pdfDoc, p) {
    const page = await pdfDoc.getPage(p); const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(6, TARGET_W / v1.width) });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }
  // Page 1 is read in Arabic + English to learn the file's language; the other pages run in parallel on several workers.
  async function readPdf(pdfDoc, progress) {
    const N = pdfDoc.numPages, out = new Array(N); let done = 0;
    const tick = () => progress && progress(done, N);
    tick();
    const [w0] = await workers(['eng', 'ara'], 1);
    const first = await readPage(await pageCanvas(pdfDoc, 1), null, w0); out[0] = first.rows; done++; tick();
    if (N > 1) {
      const langs = first.arabic > 0.15 ? ['eng', 'ara'] : ['eng'];
      const ws = await workers(langs, Math.min(cores(), N - 1));
      let next = 2;
      await Promise.all(ws.map(async w => {
        while (next <= N) { const p = next++; const r = await readPage(await pageCanvas(pdfDoc, p), first.cols, w); out[p - 1] = r.rows; done++; tick(); }
      }));
    }
    root.BOQOCR.pages = out;
    return fixCodes(dropRepeatHeaders([].concat(...out)));
  }

  async function readImage(file, progress) {
    progress && progress(1, 1);
    const img = await createImageBitmap(file); const s = Math.max(1, Math.min(3, TARGET_W / img.width));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const [w] = await workers(['eng', 'ara'], 1);
    return fixCodes(dropRepeatHeaders((await readPage(c, null, w)).rows));
  }

  root.BOQOCR = { readPdf, readImage, fixCodes };
})(window);
