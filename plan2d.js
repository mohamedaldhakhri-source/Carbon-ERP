/* plan2d.js — reads a set of AutoCAD-plotted plan sheets that have no layers (typical municipality drawings)
   and turns them into storeys: walls, doors, windows, parapets and floor slabs, in metres.
   Walls are found by the heaviest pen, openings as gaps between wall ends, slabs by closing the wall outline.
   No three.js here, so it can be tested on its own. */

/* ---------- reading one page ---------- */
export async function readSheet(pdfjs, page) {
  const O = pdfjs.OPS, ol = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0], lw = 1, filled0 = null, sub = [], cur = null; const st = [], paths = [];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const T = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const fillOps = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]), paintOps = new Set([O.stroke, O.closeStroke, ...fillOps]);
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === O.save) st.push([ctm, lw]); else if (f === O.restore) { const s = st.pop(); if (s) [ctm, lw] = s; }
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.setLineWidth) lw = a[0];
    else if (f === O.setGState) { (a[0] || []).forEach(kv => { if (kv[0] === 'LW') lw = kv[1]; }); }
    else if (f === O.constructPath) {
      const ops = a[0], c = a[1]; let k = 0;
      for (const op of ops) {
        if (op === O.moveTo) { cur = [T(c[k], c[k + 1])]; sub.push(cur); k += 2; }
        else if (op === O.lineTo) { if (!cur) { cur = []; sub.push(cur); } cur.push(T(c[k], c[k + 1])); k += 2; }
        else if (op === O.curveTo || op === O.curveTo2 || op === O.curveTo3) {
          const p0 = cur && cur.length ? cur[cur.length - 1] : T(c[k], c[k + 1]); let p1, p2, p3;
          if (op === O.curveTo) { p1 = T(c[k], c[k + 1]); p2 = T(c[k + 2], c[k + 3]); p3 = T(c[k + 4], c[k + 5]); k += 6; }
          else if (op === O.curveTo2) { p1 = p0; p2 = T(c[k], c[k + 1]); p3 = T(c[k + 2], c[k + 3]); k += 4; }
          else { p1 = T(c[k], c[k + 1]); p2 = T(c[k + 2], c[k + 3]); p3 = p2; k += 4; }
          if (!cur) { cur = [p0]; sub.push(cur); } cur.curve = true;
          for (let s = 1; s <= 6; s++) { const t = s / 6, u = 1 - t; cur.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
        }
        else if (op === O.closePath) { if (cur && cur.length) { cur.closed = true; cur = null; } }
        else if (op === O.rectangle) { const x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3]; const r = [T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h)]; r.closed = true; sub.push(r); cur = null; k += 4; }
      }
    } else if (paintOps.has(f)) {
      const filled = fillOps.has(f), w = Math.round(lw * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) * 100) / 100;
      sub.forEach(s => { if (s.length > 1) paths.push({ p: s, closed: !!s.closed, curve: !!s.curve, filled, w }); });
      sub = []; cur = null;
    } else if (f === O.endPath) { sub = []; cur = null; }
  }
  let text = [];
  try { text = (await page.getTextContent()).items.filter(t => t.str && t.str.trim()).map(t => ({ s: t.str, x: t.transform[4], y: t.transform[5], h: Math.hypot(t.transform[2], t.transform[3]) || 1, w: t.width || 0 })); } catch (e) { }
  return { paths, text, view: page.view };
}

/* ---------- what each sheet is ---------- */
const KINDS = [
  ['elev', /ELEVATION|SECTION|واجهة|قطاع/i, 0],
  ['site', /SITE\s*PLAN|LOCATION\s*PLAN|KEY\s*PLAN|مخطط الموقع|الموقع العام/i, 0],
  ['roof', /^(?!.*(PENT|HEAD)).*ROOF\s*(TOP\s*)?PLAN|مخطط السطح|^السطح/i, 99],
  ['ph', /PENT\s*-?\s*HOUSE|HEAD\s*-?\s*ROOM|ROOF\s*FLOOR|STAIR\s*ROOM|الملحق|البنتهاوس|غرفة الدرج/i, 50],
  ['f3', /THIRD\s*FLOOR|3RD\s*FLOOR|الطابق الثالث|الدور الثالث/i, 3],
  ['f2', /SECOND\s*FLOOR|2ND\s*FLOOR|الطابق الثاني|الدور الثاني/i, 2],
  ['f1', /FIRST\s*FLOOR|1ST\s*FLOOR|الطابق الأول|الدور الأول|الطابق الاول|الدور الاول/i, 1],
  ['g', /GROUND\s*FLOOR|الطابق الأرضي|الدور الأرضي|الطابق الارضي|الدور الارضي/i, 0],
  ['b', /BASEMENT|القبو|السرداب/i, -1]
];
export const KIND_AR = { b: 'القبو', g: 'الدور الأرضي', f1: 'الدور الأول', f2: 'الدور الثاني', f3: 'الدور الثالث', ph: 'الملحق العلوي', roof: 'السطح' };
const KIND_EN = { b: 'BASEMENT', g: 'GROUND FLOOR', f1: 'FIRST FLOOR', f2: 'SECOND FLOOR', f3: 'THIRD FLOOR', ph: '(PENT\\s*-?\\s*HOUSE|HEAD\\s*-?\\s*ROOM|STAIR)' };
// text items joined into lines (titles are often split into several items)
function lines(text) {
  const t = text.slice().sort((a, b) => b.y - a.y || a.x - b.x), out = [];
  t.forEach(it => {
    const L = out.find(l => Math.abs(l.y - it.y) < Math.max(l.h, it.h) * 0.5 && it.x >= l.x1 - it.h && it.x - l.x1 < it.h * 2.5 && Math.abs(l.h - it.h) < l.h * 0.3);
    if (L) { L.s += ' ' + it.s; L.x1 = it.x + (it.w || it.s.length * it.h * 0.6); }
    else out.push({ s: it.s, y: it.y, h: it.h, x: it.x, x1: it.x + (it.w || it.s.length * it.h * 0.6) });
  });
  return out.map(l => ({ ...l, s: l.s.replace(/\s+/g, ' ').trim() }));
}
export function sheetKind(sh) {
  let best = null;
  lines(sh.text).forEach(l => {
    if (!/PLAN|ELEVATION|SECTION|مخطط|واجهة|قطاع|مسقط/i.test(l.s) || l.s.length > 60) return;
    const k = KINDS.find(K => K[1].test(l.s)); if (!k) return;
    if (!best || l.h > best.h * 1.05) best = { kind: k[0], order: k[2], h: l.h, title: l.s };
  });
  return best || { kind: '?', order: 0, h: 0, title: '' };
}
// "GROUND FLOOR LVL." ... "+0.80.LVL." pairs from sections / elevations
export function readLevels(sheets) {
  const all = {};
  sheets.forEach(sh => {
    const labs = [], vals = [];
    sh.text.forEach(t => {
      const s = t.s.replace(/\s+/g, ' ').trim(), m = /^([+\-±])\s*(\d{1,3}[.,]\d{1,3})/.exec(s);
      if (m) vals.push({ ...t, v: (m[1] === '-' ? -1 : 1) * parseFloat(m[2].replace(',', '.')) });
      else if (/(LVL|LEVEL|منسوب)/i.test(s) && /[A-Za-z؀-ۿ]{3}/.test(s)) labs.push({ ...t, s: s.toUpperCase() });
    });
    const pairs = [];
    labs.forEach((l, i) => vals.forEach((v, j) => { const dy = Math.abs(l.y - v.y); if (dy > Math.max(l.h, v.h) * 2) return; pairs.push({ i, j, c: Math.abs(l.x - v.x) + 10 * dy }); }));
    pairs.sort((a, b) => a.c - b.c); const ui = new Set(), uj = new Set();
    pairs.forEach(p => { if (ui.has(p.i) || uj.has(p.j)) return; ui.add(p.i); uj.add(p.j); (all[labs[p.i].s] = all[labs[p.i].s] || []).push(vals[p.j].v); });
  });
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1], out = {};
  Object.keys(all).forEach(k => { out[k] = med(all[k]); });
  return out;
}
const findLvl = (lv, re, not) => { const k = Object.keys(lv).find(k => re.test(k) && !(not && not.test(k))); return k == null ? null : lv[k]; };

/* ---------- raster helpers ---------- */
function stampSeg(G, a, b, r, val) {
  const { nx, ny, m } = G, x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)), x1 = Math.min(nx - 1, Math.ceil(Math.max(a[0], b[0]) + r));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)), y1 = Math.min(ny - 1, Math.ceil(Math.max(a[1], b[1]) + r));
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9, r2 = r * r;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5 - a[0], py = y + 0.5 - a[1]; let t = (px * dx + py * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - t * dx, ey = py - t * dy; if (ex * ex + ey * ey <= r2) m[y * nx + x] = val;
  }
}
// cells reachable from the border through cells where pass(i) is true
function floodBorder(nx, ny, pass) {
  const seen = new Uint8Array(nx * ny), q = new Int32Array(nx * ny); let h = 0, t = 0;
  const push = i => { if (!seen[i] && pass(i)) { seen[i] = 1; q[t++] = i; } };
  for (let x = 0; x < nx; x++) { push(x); push((ny - 1) * nx + x); }
  for (let y = 0; y < ny; y++) { push(y * nx); push(y * nx + nx - 1); }
  while (h < t) { const i = q[h++], x = i % nx; if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1); if (i >= nx) push(i - nx); if (i < nx * (ny - 1)) push(i + nx); }
  return seen;
}
// chamfer distance (in cells) to the nearest cell where src is set
function dist(nx, ny, src) {
  const D = new Float32Array(nx * ny), INF = 1e9;
  for (let i = 0; i < D.length; i++) D[i] = src[i] ? 0 : INF;
  const a = 1, b = 1.4142;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const i = y * nx + x; let d = D[i]; if (!d) continue;
    if (x > 0) d = Math.min(d, D[i - 1] + a); if (y > 0) { d = Math.min(d, D[i - nx] + a); if (x > 0) d = Math.min(d, D[i - nx - 1] + b); if (x < nx - 1) d = Math.min(d, D[i - nx + 1] + b); } D[i] = d; }
  for (let y = ny - 1; y >= 0; y--) for (let x = nx - 1; x >= 0; x--) { const i = y * nx + x; let d = D[i]; if (!d) continue;
    if (x < nx - 1) d = Math.min(d, D[i + 1] + a); if (y < ny - 1) { d = Math.min(d, D[i + nx] + a); if (x < nx - 1) d = Math.min(d, D[i + nx + 1] + b); if (x > 0) d = Math.min(d, D[i + nx - 1] + b); } D[i] = d; }
  return D;
}
// mask -> rectangles (runs merged down the rows)
function rects(nx, ny, m) {
  const out = [], open = new Map();
  for (let y = 0; y <= ny; y++) {
    const runs = new Map();
    if (y < ny) for (let x = 0; x < nx;) { if (!m[y * nx + x]) { x++; continue; } let e = x; while (e < nx && m[y * nx + e]) e++; runs.set(x + ',' + e, [x, e]); x = e; }
    for (const [k, r] of open) if (!runs.has(k)) { out.push({ x0: r.x0, x1: r.x1, y0: r.y0, y1: y }); open.delete(k); }
    for (const [k, [x0, x1]] of runs) if (!open.has(k)) open.set(k, { x0, x1, y0: y });
  }
  return out;
}
// connected components of a mask: [{cells:[i...], x0,y0,x1,y1}]
function comps(nx, ny, m) {
  const lab = new Int32Array(nx * ny).fill(-1), out = [], q = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const c = { cells: [], x0: 1e9, y0: 1e9, x1: -1, y1: -1 }; lab[s] = out.length; q.length = 0; q.push(s);
    while (q.length) { const i = q.pop(), x = i % nx, y = (i / nx) | 0; c.cells.push(i); if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, y > 0 ? i - nx : -1, y < ny - 1 ? i + nx : -1]) if (j >= 0 && m[j] && lab[j] < 0) { lab[j] = out.length; q.push(j); } }
    out.push(c);
  }
  return out;
}

/* ---------- stairs from numbered treads ---------- */
// Treads numbered 1, 2, 3 … on the plan give each step's place and order; the tread lines around each number give its size.
function findStairs(text, thin, off, k) {
  const nums = text.filter(t => /^\d{1,2}$/.test(t.s.trim()) && t.h < 8).map(t => ({ n: +t.s.trim(), x: t.x - off[0] + (t.w || t.h * 0.55 * t.s.trim().length) / 2, y: t.y - off[1] + t.h * 0.35 }));
  const out = [], used = new Set(), maxJump = 2.8 / k;
  nums.filter(a => a.n === 1).forEach(a => {
    const ch = [a];
    for (;;) { const last = ch[ch.length - 1]; let best = null, bd = Infinity;
      nums.forEach(b => { if (b.n !== last.n + 1 || used.has(b)) return; const d = Math.hypot(b.x - last.x, b.y - last.y); if (d < bd && d < maxJump) { bd = d; best = b; } });
      if (!best) break; ch.push(best); }
    if (ch.length < 6) return; ch.forEach(x => used.add(x));
    const gaps = []; for (let i = 0; i + 1 < ch.length; i++) gaps.push(Math.hypot(ch[i + 1].x - ch[i].x, ch[i + 1].y - ch[i].y));
    const sp = gaps.slice().sort((p, q) => p - q)[gaps.length >> 1]; if (sp * k < 0.18 || sp * k > 0.45) return;
    const segs = []; thin.forEach(p => { if (p.curve) return; for (let i = 0; i + 1 < p.p.length; i++) { const A = p.p[i], B = p.p[i + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L * k >= 0.5 && L * k <= 2.4) segs.push([A, B, L]); } });
    const steps = ch.map((P, i) => {
      let d = null; if (i + 1 < ch.length && gaps[i] < sp * 1.5) d = [ch[i + 1].x - P.x, ch[i + 1].y - P.y]; else if (i > 0 && gaps[i - 1] < sp * 1.5) d = [P.x - ch[i - 1].x, P.y - ch[i - 1].y];
      if (!d) return null; const dl = Math.hypot(d[0], d[1]); d = [d[0] / dl, d[1] / dl]; const e = [-d[1], d[0]];
      let fr = null, bk = null;
      segs.forEach(([A, B, L]) => { const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; if (Math.abs(u[0] * d[0] + u[1] * d[1]) > 0.15) return;
        const o = ((A[0] + B[0]) / 2 - P.x) * d[0] + ((A[1] + B[1]) / 2 - P.y) * d[1]; if (Math.abs(o) > sp * 0.85) return;
        const la = (A[0] - P.x) * e[0] + (A[1] - P.y) * e[1], lb = (B[0] - P.x) * e[0] + (B[1] - P.y) * e[1], m = 0.1 / k; if (Math.min(la, lb) > m || Math.max(la, lb) < -m) return;
        const c = { o, l0: Math.min(la, lb), l1: Math.max(la, lb) }; if (o < 0 && (!fr || o > fr.o)) fr = c; if (o > 0 && (!bk || o < bk.o)) bk = c; });
      let l0 = -0.55 / k, l1 = 0.55 / k; const sides = [fr, bk].filter(Boolean);
      if (sides.length) { l0 = Math.max(...sides.map(x => x.l0)); l1 = Math.min(...sides.map(x => x.l1)); if ((l1 - l0) * k < 0.6 || (l1 - l0) * k > 2.2) { l0 = -0.55 / k; l1 = 0.55 / k; } }
      return { n: P.n, P, d, e, lc: (l0 + l1) / 2, width: l1 - l0 };
    });
    // one width and one side offset per flight (between turns), so the steps line up; the number sits mid-tread
    const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
    for (let i = 0; i < steps.length;) { let j = i; while (j + 1 < steps.length && gaps[j] < sp * 1.5) j++;
      const fl = steps.slice(i, j + 1).filter(Boolean);
      if (fl.length) { const lc = med(fl.map(q => q.lc)), w = med(fl.map(q => q.width)), d = fl[0].d;
        fl.forEach(q => { q.d = d; q.e = [-d[1], d[0]]; q.x = q.P.x + q.e[0] * lc; q.y = q.P.y + q.e[1] * lc; q.depth = sp; q.width = w; }); }
      i = j + 1; }
    // landings: where the numbering jumps (a turn), a platform at the lower step's height running on past it
    const lands = [];
    for (let i = 0; i + 1 < ch.length; i++) if (gaps[i] >= sp * 1.5 && steps[i]) {
      const a = steps[i], b = steps[i + 1] || a, w = a.width, ext = Math.min(1.4 / k, w);
      const ax = a.x + a.d[0] * (a.depth / 2 + ext / 2), ay = a.y + a.d[1] * (a.depth / 2 + ext / 2), bx = b.x + a.d[0] * (b.depth / 2 + ext / 2), by = b.y + a.d[1] * (b.depth / 2 + ext / 2);
      const e = [-a.d[1], a.d[0]], span = Math.abs((bx - ax) * e[0] + (by - ay) * e[1]) + (a.width + b.width) / 2;
      lands.push({ n: a.n, x: (ax + bx) / 2, y: (ay + by) / 2, d: a.d, depth: ext, width: span });
    }
    out.push({ steps: steps.filter(Boolean), lands, max: ch[ch.length - 1].n });
  });
  return out;
}

/* ---------- the whole set ---------- */
// sheets: [{paths,text,view}] for every page. Returns null when there is no usable plan.
export function analyzeSet(sheets, opt) {
  opt = opt || {};
  const info = sheets.map((sh, i) => ({ i, ...sheetKind(sh) }));
  let plans = info.filter(x => ['b', 'g', 'f1', 'f2', 'f3', 'ph'].includes(x.kind));
  const roofI = info.find(x => x.kind === 'roof');
  // wall pen: the heaviest pen that draws plenty of lines on the plans
  const pensOf = sh => { const c = {}; sh.paths.forEach(p => { if (!p.filled && p.w >= 0.3) c[p.w] = (c[p.w] || 0) + 1; }); return c; };
  if (!plans.length) { // no titles: use the sheet with the most heavy lines
    let best = null; sheets.forEach((sh, i) => { const c = pensOf(sh), ws = Object.keys(c).map(Number).filter(w => c[w] >= 40); if (!ws.length) return; const w = Math.max(...ws); if (!best || c[w] > best.n) best = { i, n: c[w] }; });
    if (!best) return null; plans = [{ i: best.i, kind: 'g', order: 0, title: '' }];
  }
  // one sheet per storey (the first one wins)
  const seen = new Set(); plans = plans.filter(p => !seen.has(p.kind) && seen.add(p.kind)).sort((a, b) => a.order - b.order);
  const votes = {}; plans.forEach(p => { const c = pensOf(sheets[p.i]), ws = Object.keys(c).map(Number).filter(w => c[w] >= 40); if (ws.length) { const w = Math.max(...ws); votes[w] = (votes[w] || 0) + 1; } });
  const wallPen = +(Object.keys(votes).sort((a, b) => votes[b] - votes[a] || b - a)[0] || 0); if (!wallPen) return null;
  const base0 = sheets[plans[0].i];
  // sheets line up on the column grid (A, B, 1, 2 …)
  const gridOf = sh => { const m = {}; sh.text.forEach(t => { const s = t.s.trim(); if (/^([A-Z]{1,2}|[A-Z]?\d{1,2})$/.test(s) && t.h >= 7) (m[s] = m[s] || []).push(t); }); return m; };
  const g0 = gridOf(base0);
  const offsetOf = sh => { if (sh === base0) return [0, 0]; const g = gridOf(sh), dx = [], dy = []; Object.keys(g0).forEach(k => { if (g0[k].length === 1 && g[k] && g[k].length === 1) { dx.push(g[k][0].x - g0[k][0].x); dy.push(g[k][0].y - g0[k][0].y); } });
    if (dx.length < 3) return [0, 0]; const med = a => a.sort((p, q) => p - q)[a.length >> 1]; return [med(dx), med(dy)]; };
  // drawing scale
  const scl = {}; plans.forEach(p => { const m = /1\s*:\s*(\d{2,4})\b/.exec(sheets[p.i].text.map(t => t.s).join(' ')); if (m) scl[m[1]] = (scl[m[1]] || 0) + 1; });
  const scale = opt.scale || +(Object.keys(scl).sort((a, b) => scl[b] - scl[a])[0] || 100), k = 0.0254 / 72 * scale; // pt -> m
  // levels from sections and elevations
  const lv = readLevels(sheets);
  // gather heavy lines per storey sheet (page coords moved onto the base sheet)
  const all = plans.map(p => ({ ...p, sh: sheets[p.i], off: offsetOf(sheets[p.i]) }));
  if (roofI) all.push({ ...roofI, roof: true, sh: sheets[roofI.i], off: offsetOf(sheets[roofI.i]) });
  all.forEach(s => { const [ox, oy] = s.off, mv = p => p.map(([x, y]) => [x - ox, y - oy]);
    s.walls = s.roof ? [] : s.sh.paths.filter(p => !p.filled && p.w === wallPen).map(p => ({ ...p, p: mv(p.p) }));
    s.para = []; // parapets are taken from the edges of the roofs below (pens for them vary too much between offices)
    s.thin = s.sh.paths.filter(p => !p.filled && p.w < wallPen * 0.5).map(p => ({ ...p, p: mv(p.p) })); });
  // plan area: the heavy lines, plus a margin
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  all.forEach(s => s.walls.forEach(p => p.p.forEach(([x, y]) => { if (x < X0) X0 = x; if (x > X1) X1 = x; if (y < Y0) Y0 = y; if (y > Y1) Y1 = y; })));
  if (!isFinite(X0)) return null;
  const pad = 3 / k; X0 -= pad; Y0 -= pad; X1 += pad; Y1 += pad;
  const Wm = (X1 - X0) * k, Hm = (Y1 - Y0) * k;
  const c = Math.max(0.025, Math.sqrt(Wm * Hm / 3e6)), nx = Math.ceil(Wm / c), ny = Math.ceil(Hm / c), N = nx * ny;
  const toG = ([x, y]) => [(x - X0) * k / c, (y - Y0) * k / c];
  const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
  // world: x east, z south (page y up -> -z)
  const wx = gx => (X0 - cx) * k + gx * c, wz = gy => -((Y0 - cy) * k + gy * c);
  const R = r => ({ x0: wx(r.x0), x1: wx(r.x1), z0: wz(r.y1), z1: wz(r.y0) });
  const penR = Math.max(0.6, wallPen * k / c / 2);
  const cell = r => Math.max(1, Math.round(r / c));

  const storeys = [];
  all.forEach(s => {
    const G = { nx, ny, m: new Uint8Array(N) };
    s.walls.forEach(p => { const q = p.p.map(toG); for (let i = 0; i + 1 < q.length; i++) stampSeg(G, q[i], q[i + 1], penR, 1); if (p.closed && q.length > 2) stampSeg(G, q[q.length - 1], q[0], penR, 1); });
    // fill the inside of each wall outline: small enclosed regions that are thin
    const out = floodBorder(nx, ny, i => !G.m[i]), enc = new Uint8Array(N); for (let i = 0; i < N; i++) if (!G.m[i] && !out[i]) enc[i] = 1;
    comps(nx, ny, enc).forEach(cp => { const bw = (cp.x1 - cp.x0 + 1) * c, bh = (cp.y1 - cp.y0 + 1) * c, area = cp.cells.length * c * c; if (area / Math.max(bw, bh) <= 0.5) cp.cells.forEach(i => { G.m[i] = 1; }); });
    const wall = G.m;
    // openings: gaps between two wall ends on one line
    const op = new Uint8Array(N), dirOf = new Uint8Array(N), minL = cell(0.45), maxL = cell(4.2), ext = cell(0.3);
    const scan = (horiz) => {
      const A = horiz ? ny : nx, B = horiz ? nx : ny, at = (a, b) => horiz ? a * nx + b : b * nx + a;
      for (let a = 0; a < A; a++) {
        let b = 0;
        while (b < B) {
          if (wall[at(a, b)]) { b++; continue; }
          let e = b; while (e < B && !wall[at(a, e)]) e++;
          const L = e - b;
          if (b > 0 && e < B && L >= minL && L <= maxL) {
            let l = 0; while (b - 1 - l >= 0 && wall[at(a, b - 1 - l)] && l <= ext) l++;
            let r = 0; while (e + r < B && wall[at(a, e + r)] && r <= ext) r++;
            if (l > ext && r > ext) for (let t = b; t < e; t++) { op[at(a, t)] = 1; dirOf[at(a, t)] |= horiz ? 1 : 2; }
          }
          b = e;
        }
      }
    };
    scan(true); scan(false);
    const opens = [];
    comps(nx, ny, op).forEach(cp => {
      let h = 0, v = 0; cp.cells.forEach(i => { if (dirOf[i] & 1) h++; if (dirOf[i] & 2) v++; });
      const horiz = h >= v, len = (horiz ? cp.x1 - cp.x0 + 1 : cp.y1 - cp.y0 + 1) * c, th = (horiz ? cp.y1 - cp.y0 + 1 : cp.x1 - cp.x0 + 1) * c;
      if (th < 0.06 || th > 0.5 || len < 0.45) return;
      // page-space box of the opening (for matching thin lines)
      const px0 = X0 + cp.x0 * c / k, px1 = X0 + (cp.x1 + 1) * c / k, py0 = Y0 + cp.y0 * c / k, py1 = Y0 + (cp.y1 + 1) * c / k, Lp = len / k, padp = 0.06 / k;
      const inBox = ([x, y], m) => x >= px0 - m && x <= px1 + m && y >= py0 - m && y <= py1 + m;
      let glass = 0, arc = null, leaf = null;
      const mx = (px0 + px1) / 2, my = (py0 + py1) / 2;
      s.thin.forEach(p => {
        if (p.curve) { // door swing
          let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; p.p.forEach(([x, y]) => { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); });
          const sz = Math.max(bx1 - bx0, by1 - by0); if (sz < Lp * 0.5 || sz > Lp * 1.3) return;
          if (Math.hypot((bx0 + bx1) / 2 - mx, (by0 + by1) / 2 - my) < Lp * 1.1) arc = p; return;
        }
        for (let i = 0; i + 1 < p.p.length; i++) {
          const a = p.p[i], b = p.p[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-6) continue;
          const par = horiz ? Math.abs(dy) / l < 0.1 : Math.abs(dx) / l < 0.1;
          if (par && l >= Lp * 0.5 && inBox(a, padp) && inBox(b, padp)) glass++;
          // a door leaf: a straight line about as long as the opening, square to the wall, hinged at a jamb
          if (!par && l >= Lp * 0.55 && l <= Lp * 1.2 && (horiz ? Math.abs(dx) / l < 0.2 : Math.abs(dy) / l < 0.2)) {
            const jambs = horiz ? [[px0, py0], [px0, py1], [px1, py0], [px1, py1]] : [[px0, py0], [px1, py0], [px0, py1], [px1, py1]];
            for (const j of jambs) for (const [h0, h1] of [[a, b], [b, a]]) if (Math.hypot(h0[0] - j[0], h0[1] - j[1]) < 0.15 / k && (!leaf || l > leaf.l)) leaf = { a: h0, b: h1, l };
          }
        }
      });
      const type = arc || leaf ? 'door' : glass >= 2 ? 'window' : len <= 1.6 ? 'open' : null;
      if (!type) return;
      const o = { type, horiz, len, th, ...R({ x0: cp.x0, x1: cp.x1 + 1, y0: cp.y0, y1: cp.y1 + 1 }) };
      if (type === 'door' && leaf) { const A = toG(leaf.a), B = toG(leaf.b); o.leaf = { a: [wx(A[0]), wz(A[1])], b: [wx(B[0]), wz(B[1])] }; }
      opens.push(o); cp.cells.forEach(i => { op[i] = 2; });
    });
    for (let i = 0; i < N; i++) if (op[i] !== 2) op[i] = 0;
    // footprint: close the outline (walls + openings) and keep what is inside. A tight closing keeps corners square;
    // where it leaks (an opening it did not recognise) a wider one is used for that building.
    const close = (src, r) => { const D = dist(nx, ny, src), outside = floodBorder(nx, ny, i => D[i] > r), D2 = dist(nx, ny, outside), f = new Uint8Array(N); for (let i = 0; i < N; i++) f[i] = D2[i] > r ? 1 : 0; return f; };
    const src = new Uint8Array(N); for (let i = 0; i < N; i++) src[i] = wall[i] || op[i] ? 1 : 0;
    let foot = new Uint8Array(N);
    if (s.walls.length) {
      const tight = close(src, 0.6 / c), wide = close(src, 1.3 / c);
      comps(nx, ny, wide).forEach(cp => { let n = 0; cp.cells.forEach(i => { if (tight[i]) n++; }); const use = n >= cp.cells.length * 0.75 ? tight : wide; cp.cells.forEach(i => { if (use[i]) foot[i] = 1; }); });
    }
    storeys.push({ kind: s.kind, title: s.title, page: s.i, off: s.off, roof: !!s.roof, wall, op, foot, opens, stairs: s.roof ? [] : findStairs(s.sh.text, s.thin, s.off, k) });
  });
  // levels: storey bases and heights
  const fl = storeys.filter(s => !s.roof), base = [], NAME = s => KIND_EN[s.kind] || 'X';
  fl.forEach((s, i) => {
    let b = null;
    if (i === 0) b = findLvl(lv, new RegExp(NAME(s) + '.*(LVL|LEVEL)'), /ROOF|FINISH/);
    else b = findLvl(lv, new RegExp(NAME(fl[i - 1]) + '\\s*ROOF')) ?? findLvl(lv, new RegExp('^' + NAME(s) + '.*(LVL|LEVEL)'), /ROOF/);
    if (b == null || (i && (b - base[i - 1] < 2.4 || b - base[i - 1] > 7))) b = i ? base[i - 1] + (fl[i - 1].kind === 'ph' ? 3 : 3.6) : 0;
    base.push(b);
  });
  const top = fl.length ? fl[fl.length - 1] : null; let topLvl = null;
  if (top) { topLvl = findLvl(lv, new RegExp(NAME(top) + '\\s*ROOF')) ?? (top.kind === 'ph' ? findLvl(lv, /(HEAD\s*-?\s*ROOM|PENT\s*-?\s*HOUSE|STAIR).*ROOF/) : null);
    const b = base[base.length - 1]; if (topLvl == null || topLvl - b < 2.4 || topLvl - b > 7) topLvl = b + (top.kind === 'ph' ? 3 : 3.6); }
  const g0l = base[0] || 0;
  const par1 = findLvl(lv, /^PARAPET/), parT = findLvl(lv, /TOP\s*PARAPET/);
  const clampH = v => v == null || v < 0.5 || v > 2 ? 1.0 : v;
  const res = { scale, k, cell: c, nx, ny, region: { X0, Y0, X1, Y1 }, center: [cx, cy], levels: lv, wallPen, storeys: [] };
  // the edge of a roof that is open to the sky gets a parapet
  const ring = (roofM, coverM) => { const inv = new Uint8Array(N); for (let j = 0; j < N; j++) inv[j] = roofM[j] ? 0 : 1; const D = dist(nx, ny, inv), w = Math.max(1, Math.round(0.2 / c)), m = new Uint8Array(N);
    for (let j = 0; j < N; j++) m[j] = roofM[j] && D[j] <= w && !(coverM && coverM[j]) ? 1 : 0; return m; };
  const holes = fl.map(() => new Uint8Array(N)), stairsOf = fl.map(() => []);
  fl.forEach((s, i) => {
    if (i + 1 >= fl.length) return; // the top storey's stair only arrives
    const b = base[i] - g0l, t = base[i + 1] - g0l;
    s.stairs.forEach(st => {
      const rise = (t - b) / (st.max + 1), H = holes[i + 1];
      const W = (q, top) => { const w = { x: (q.x - cx) * k, z: -(q.y - cy) * k, ang: Math.atan2(q.d[1], q.d[0]), depth: q.depth * k, width: q.width * k, top };
        const g = toG([q.x, q.y]), dg = q.depth * k / c / 2 + 1, a = [g[0] - q.d[0] * dg, g[1] - q.d[1] * dg], e = [g[0] + q.d[0] * dg, g[1] + q.d[1] * dg];
        stampSeg({ nx, ny, m: H }, a, e, q.width * k / c / 2 + 2, 1); return w; };
      stairsOf[i].push({ steps: st.steps.map(q => W(q, b + q.n * rise)), lands: st.lands.map(q => W(q, b + q.n * rise)) });
    });
  });
  fl.forEach((s, i) => {
    const b = base[i] - g0l, t = (i + 1 < fl.length ? base[i + 1] : topLvl) - g0l, below = i ? fl[i - 1].foot : null;
    // floor slab = this storey's outline, plus the roof of the storey below
    const slab = new Uint8Array(N), hole = holes[i]; for (let j = 0; j < N; j++) slab[j] = (s.foot[j] || (below && below[j])) && !hole[j] ? 1 : 0;
    const para = below ? ring(below, s.foot) : new Uint8Array(N);
    res.storeys.push({ kind: s.kind, name: KIND_AR[s.kind] || s.title || ('دور ' + (i + 1)), title: s.title, page: s.page, off: s.off, base: b, top: t,
      walls: rects(nx, ny, s.wall).map(R), parapets: rects(nx, ny, para).map(R), parapetH: clampH(par1 != null ? par1 - base[i] : null), opens: s.opens, slab: rects(nx, ny, slab).map(R), stairs: stairsOf[i] });
  });
  if (top) { // roof slab with a parapet round it
    const t = topLvl - g0l, rf = storeys.find(s => s.roof);
    res.roof = { base: t, page: rf ? rf.page : null, off: rf ? rf.off : [0, 0], slab: rects(nx, ny, top.foot).map(R), parapets: rects(nx, ny, ring(top.foot, null)).map(R), parapetH: clampH(parT != null && topLvl != null ? parT - topLvl : null) };
  }
  res.sheets = info;
  return res;
}
