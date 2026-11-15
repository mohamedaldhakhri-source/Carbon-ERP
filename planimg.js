/* planimg.js — floor plans that come as pictures (key plans in presentations, scans, exported images).
   No AI: the picture is read by its colours and shapes. Grey filled bands are walls, yellow lines are glass,
   gaps between wall ends are doorways, rooms crossed by an X are double-height voids, rows of evenly spaced
   short lines are stairs. Several plans of one building are stacked as storeys and lined up on their walls.
   Output has the same shape as analyzeSet() in plan2d.js, so the viewer builds it the same way. */
import { floodBorder, dist, rects, comps, stampSeg } from './plan2d.js?v=53';

const lum = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3;

// quick look on a few thousand pixels: mostly white paper with grey and black lines, not a photo or a render
export function looksLikePlan(img) {
  const { width: w, height: h, data: d } = img; if (w < 300 || h < 300) return false;
  let white = 0, ink = 0, color = 0, n = 0;
  for (let y = 2; y < h; y += Math.max(1, (h / 90) | 0)) for (let x = 2; x < w; x += Math.max(1, (w / 90) | 0)) {
    const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); n++;
    if (mn > 225) white++; else if (mx - mn < 30) ink++; else color++;
  }
  return white / n > 0.55 && color / n < 0.12 && ink / n > 0.03;
}

export function classify(img) {
  const { width: w, height: h, data: d } = img, N = w * h;
  const grey = new Uint8Array(N), glass = new Uint8Array(N), ink = new Uint8Array(N), faint = new Uint8Array(N), light = new Uint8Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = (r + g + b) / 3;
    if (mx - mn <= 34 && v < 182) grey[p] = 1;
    if (r > 165 && g > 105 && b < 125 && r - b > 75) glass[p] = 1;
    if (v < 150) ink[p] = 1;
    if (v < 215) faint[p] = 1;
    if (v < 235) light[p] = 1;
  }
  // walls: grey shapes at least 3 pixels thick (opening with a small cross removes lines, text and hatching)
  const er = new Uint8Array(N), wall = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; if (grey[p] && grey[p - 1] && grey[p + 1] && grey[p - w] && grey[p + w]) er[p] = 1; }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; if (er[p] || er[p - 1] || er[p + 1] || er[p - w] || er[p + w]) wall[p] = 1; }
  // small compact blobs are furniture symbols (chairs), arrows or text, not walls; columns are bigger
  comps(w, h, wall).forEach(c => { const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1; if (c.cells.length < 30 || (Math.max(bw, bh) < 18 && c.cells.length < 220)) c.cells.forEach(p => { wall[p] = 0; }); });
  // glass: yellow lines, closed over one-pixel breaks
  const gl = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; if (glass[p] || (glass[p - 1] && glass[p + 1]) || (glass[p - w] && glass[p + w])) gl[p] = 1; }
  comps(w, h, gl).forEach(c => { if (c.cells.length < 12 || Math.max(c.x1 - c.x0, c.y1 - c.y0) < 8) c.cells.forEach(p => { gl[p] = 0; }); });
  return { w, h, wall, glass: gl, ink, faint, light };
}

// typical wall thickness in pixels (ridge of the distance to the wall edge)
function wallThickness(P) {
  const { w, h, wall } = P, inv = new Uint8Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = wall[i] ? 0 : 1;
  const D = dist(w, h, inv), hist = {};
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x, v = D[p]; if (!v) continue;
    if (v >= D[p - 1] && v >= D[p + 1] && v >= D[p - w] && v >= D[p + w] && ((v > D[p - 1] && v > D[p + 1]) || (v > D[p - w] && v > D[p + w]))) { const t = Math.round(v * 2 - 1); if (t >= 2 && t <= 30) hist[t] = (hist[t] || 0) + 1; } }
  const ks = Object.keys(hist).map(Number); if (!ks.length) return 6;
  // weighted median, so a few thick columns do not pull it up
  const tot = ks.reduce((s, k) => s + hist[k], 0); let acc = 0; for (const k of ks.sort((a, b) => a - b)) { acc += hist[k]; if (acc >= tot / 2) return k; }
  return 6;
}

// shift that puts plan B on plan A (walls on walls), searched on a coarse grid then refined
function align(A, B) {
  const f = 4, down = P => { const W = Math.ceil(P.w / f), H = Math.ceil(P.h / f), m = new Uint8Array(W * H); for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if (P.wall[y * P.w + x]) m[((y / f) | 0) * W + ((x / f) | 0)] = 1; return { W, H, m }; };
  const a = down(A), b = down(B), R = Math.round(Math.max(a.W, a.H) * 0.3);
  const score = (dx, dy, pa, pb) => { let s = 0; for (let y = 0; y < pb.H; y++) { const ya = y + dy; if (ya < 0 || ya >= pa.H) continue; for (let x = 0; x < pb.W; x++) { if (!pb.m[y * pb.W + x]) continue; const xa = x + dx; if (xa >= 0 && xa < pa.W && pa.m[ya * pa.W + xa]) s++; } } return s; };
  let best = { s: -1, dx: 0, dy: 0 };
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const s = score(dx, dy, a, b); if (s > best.s) best = { s, dx, dy }; }
  const full = { W: A.w, H: A.h, m: A.wall }, fb = { W: B.w, H: B.h, m: B.wall }; let fine = { s: -1, dx: best.dx * f, dy: best.dy * f };
  for (let dy = best.dy * f - f; dy <= best.dy * f + f; dy++) for (let dx = best.dx * f - f; dx <= best.dx * f + f; dx++) { const s = score(dx, dy, full, fb); if (s > fine.s) fine = { s, dx, dy }; }
  return [fine.dx, fine.dy]; // B pixel + shift = A pixel
}

// a flight of stairs: thin lines evenly spaced (one tread every 25-35 cm), repeated across the width of the flight.
// Read row by row as a "comb" of crossings, so lines that cross the treads (a cut line, a handrail) do not break it.
function findTreads(P, ox, oy, mpp) {
  const { w, h, faint: ink, wall } = P, out = [], sp0 = 0.22 / mpp, sp1 = 0.4 / mpp, minW = 0.6 / mpp, maxW = 2.4 / mpp;
  for (const along of ['x', 'y']) { // the direction you walk along
    const A = along === 'x' ? h : w, B = along === 'x' ? w : h, at = (a, b) => along === 'x' ? a * w + b : b * w + a;
    const combs = [];
    for (let a = 0; a < A; a++) {
      const cs = []; let b = 0;
      while (b < B) { if (!ink[at(a, b)] || wall[at(a, b)]) { b++; continue; } let e = b; while (e < B && ink[at(a, e)]) e++; if (e - b <= 3) cs.push((b + e - 1) / 2); else cs.push(-1); b = e; }
      // the longest run of evenly spaced thin crossings
      let best = null;
      for (let i = 0; i < cs.length; i++) { if (cs[i] < 0) continue; let j = i, gap = null; const xs = [cs[i]];
        while (j + 1 < cs.length && cs[j + 1] >= 0) { const d = cs[j + 1] - cs[j]; if (d < sp0 || d > sp1 || (gap != null && Math.abs(d - gap) > 1.6)) break; if (gap == null) gap = d; xs.push(cs[j + 1]); j++; }
        if (xs.length >= 6 && (!best || xs.length > best.xs.length)) best = { xs, gap }; i = j; }
      if (best) combs.push({ a, ...best });
    }
    // the same comb on neighbouring rows makes one flight
    const flights = [];
    combs.forEach(cb => { const f = flights.find(q => cb.a - q.a1 <= 4 && Math.abs(q.xs[0] - cb.xs[0]) <= 3 && Math.abs(q.gap - cb.gap) <= 1.5);
      if (f) { f.a1 = cb.a; f.rows++; if (cb.xs.length > f.xs.length) f.xs = cb.xs; } else flights.push({ a0: cb.a, a1: cb.a, rows: 1, xs: cb.xs, gap: cb.gap }); });
    flights.forEach(f => { const W = f.a1 - f.a0 + 1; if (W < minW || W > maxW || f.rows < W * 0.6) return; const mid = (f.a0 + f.a1) / 2;
      out.push({ steps: f.xs.map(v => along === 'x' ? { x: v + ox, y: mid + oy } : { x: mid + ox, y: v + oy }), width: W, gap: f.gap }); });
  }
  return out;
}

// big X marks (two thin lines corner to corner of a rectangle): double-height voids, shafts, openings above.
// Axis-parallel runs are taken out first so only slanted strokes remain; they are joined 8-connected,
// kept when long, thin and straight, joined along one line, then paired "\" with "/" over the same box.
export function findXs(P, mpp) {
  const { w, h, light: m } = P, N = w * h, keep = new Uint8Array(N), RUN = 7;
  for (let p = 0; p < N; p++) keep[p] = m[p];
  for (let y = 0; y < h; y++) { let x = 0; while (x < w) { if (!m[y * w + x]) { x++; continue; } let e = x; while (e < w && m[y * w + e]) e++; if (e - x >= RUN) for (let t = x; t < e; t++) keep[y * w + t] = 0; x = e; } }
  for (let x = 0; x < w; x++) { let y = 0; while (y < h) { if (!m[y * w + x]) { y++; continue; } let e = y; while (e < h && m[e * w + x]) e++; if (e - y >= RUN) for (let t = y; t < e; t++) keep[t * w + x] = 0; y = e; } }
  // Hough votes over slanted angles only; X lines are often dashed, so a line is a peak of votes, not a connected stroke
  const TH = [], D = Math.ceil(Math.hypot(w, h)), R = 2 * D + 1;
  for (let deg = 14; deg <= 76; deg += 0.5) TH.push(deg, 180 - deg);
  const cs = TH.map(d => Math.cos(d * Math.PI / 180)), sn = TH.map(d => Math.sin(d * Math.PI / 180)), acc = new Uint16Array(TH.length * R);
  for (let p = 0; p < N; p++) if (keep[p]) { const x = p % w, y = (p / w) | 0; for (let k = 0; k < TH.length; k++) acc[k * R + Math.round(x * cs[k] + y * sn[k]) + D]++; }
  const minL = 1.5 / mpp, gapMax = 0.7 / mpp, peaks = [];
  for (let k = 0; k < TH.length; k++) for (let r = 1; r < R - 1; r++) { const v = acc[k * R + r]; if (v < minL * 0.3) continue;
    let mx = true; for (let dk = -4; dk <= 4 && mx; dk += 2) { const kk = k + dk; if (kk < 0 || kk >= TH.length) continue; for (let dr = -3; dr <= 3; dr++) { const u = acc[kk * R + r + dr]; if (u > v || (u === v && (dk < 0 || (dk === 0 && dr < 0)))) { mx = false; break; } } }
    if (mx) peaks.push({ k, rho: r - D, v }); }
  peaks.sort((p, q) => q.v - p.v);
  const lines = [], hit = (x, y) => { const xi = Math.round(x), yi = Math.round(y); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = xi + dx, yy = yi + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && keep[yy * w + xx]) return true; } return false; };
  peaks.slice(0, 800).forEach(pk => {
    const c0 = cs[pk.k], s0 = sn[pk.k], px = pk.rho * c0, py = pk.rho * s0, ux = -s0, uy = c0; // point on the line and its direction
    let run = null; const T = D;
    for (let t = -T; t <= T + 1; t++) { const x = px + ux * t, y = py + uy * t, inside = x >= 0 && y >= 0 && x < w && y < h, on = inside && hit(x, y);
      if (on) { if (!run) run = { t0: t, t1: t, n: 0 }; else if (t - run.t1 > gapMax) { done(run); run = { t0: t, t1: t, n: 0 }; } run.t1 = t; run.n++; }
      if (t > T && run) done(run); }
    function done(r) { const L = r.t1 - r.t0; if (L < minL || r.n < L * 0.3) return;
      const l = { ux, uy, a: Math.atan2(uy, ux), ax: px + ux * r.t0, ay: py + uy * r.t0, bx: px + ux * r.t1, by: py + uy * r.t1, L, cov: r.n / (L + 1) };
      if (!lines.some(o => Math.abs(o.ax - l.ax) + Math.abs(o.ay - l.ay) + Math.abs(o.bx - l.bx) + Math.abs(o.by - l.by) < 16)) lines.push(l); }
  });
  const box = l => ({ x0: Math.min(l.ax, l.bx), x1: Math.max(l.ax, l.bx), y0: Math.min(l.ay, l.by), y1: Math.max(l.ay, l.by) });
  const down = lines.filter(l => l.L >= 1.5 / mpp && l.ux * l.uy > 0), up = lines.filter(l => l.L >= 1.5 / mpp && l.ux * l.uy < 0), out = [];
  const add = U => { if (!out.some(o => Math.max(Math.abs(o.x0 - U.x0), Math.abs(o.y0 - U.y0), Math.abs(o.x1 - U.x1), Math.abs(o.y1 - U.y1)) < 0.5 / mpp)) out.push(U); };
  down.forEach(d => { const A = box(d);
    up.forEach(u => { const B = box(u), ix = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), iy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0); if (ix <= 0 || iy <= 0) return;
      const U = { x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1), y0: Math.min(A.y0, B.y0), y1: Math.max(A.y1, B.y1) };
      if (ix * iy < 0.6 * (U.x1 - U.x0) * (U.y1 - U.y0) || Math.min(U.x1 - U.x0, U.y1 - U.y0) * mpp < 1.8) return;
      add(U); }); });
  // one long line corner to corner of a room also marks a void (some drawings show only half the X):
  // both ends must sit in a corner, with a straight horizontal and a vertical line (or wall) next to it
  // one long line corner to corner of a room also marks a void (some drawings show only half the X). It must be a clean,
  // unbroken line, and the room's four sides must be drawn (walls, glass or lines) along most of their length.
  const RO = Math.round(0.5 / mpp);
  const axisAt = (x, y, horiz, out) => { // a straight run along the side, from just inside to half a metre outside
    for (let o = -4; o <= RO; o++) for (let e = -2; e <= 2; e++) { const xx = Math.round(x + (horiz ? e : o * out)), yy = Math.round(y + (horiz ? o * out : e)); if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue; const j = yy * w + xx;
      if (m[j] && !keep[j] && (horiz ? m[j - 1] && m[j + 1] : m[j - w] && m[j + w])) return true; } return false; };
  const side = (x0, y0, x1, y1, horiz, out) => { let n = 0, k = 0; for (let t = 0.1; t <= 0.9; t += 0.04) { n++; if (axisAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, horiz, out)) k++; } return k / n; };
  const inside = (U, o) => { const ix = Math.min(U.x1, o.x1) - Math.max(U.x0, o.x0), iy = Math.min(U.y1, o.y1) - Math.max(U.y0, o.y0); return ix > 0 && iy > 0 && ix * iy > 0.6 * (U.x1 - U.x0) * (U.y1 - U.y0); };
  lines.slice().sort((p, q) => q.L - p.L).forEach(l => { const B = box(l); if (l.cov < 0.88 || l.L < 2.5 / mpp || Math.min(B.x1 - B.x0, B.y1 - B.y0) * mpp < 1.8) return;
    if (out.some(o => inside(B, o))) return;
    const sd = [side(B.x0, B.y0, B.x1, B.y0, true, -1), side(B.x0, B.y1, B.x1, B.y1, true, 1), side(B.x0, B.y0, B.x0, B.y1, false, -1), side(B.x1, B.y0, B.x1, B.y1, false, 1)];
    if (Math.min(...sd) >= 0.5 && sd.reduce((a, b) => a + b) >= 3.4) add(B); });
  return out;
}

// furniture drawn on the plan: tables and desks are closed outlines (their inside is an enclosed white patch),
// round tables enclose a round patch, and chairs are small separate symbols left over once the tables are taken out.
// Returned in picture pixels: { t: 'table'|'desk'|'rtable'|'cabinet'|'sofa'|'ltable'|'chair'|'armchair', x, y, sx, sy, d, f:[fx,fy] }
function comps8(w, h, m, keep) {
  const lab = new Int32Array(w * h).fill(-1), out = [], q = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s] >= 0) continue; const c = { cells: [], x0: 1e9, y0: 1e9, x1: -1, y1: -1 }; lab[s] = out.length; q.length = 0; q.push(s);
    while (q.length) { const i = q.pop(), x = i % w, y = (i / w) | 0; c.cells.push(i); if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (m[j] && lab[j] < 0) { lab[j] = out.length; q.push(j); } } }
    if (!keep || keep(c)) out.push(c);
  }
  return out;
}
export function findFurniture(P, mpp, skip) {
  const { w, h, faint, wall, glass } = P, N = w * h, px = v => v / mpp, out = [];
  // the drawing's thin lines, without walls, glass and the long grid / dimension lines that cross the whole plan
  const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = faint[i] && !wall[i] && !glass[i] && !(skip && skip[i]) ? 1 : 0;
  const LONG = px(4.5);
  for (let y = 0; y < h; y++) { let x = 0; while (x < w) { if (!m[y * w + x]) { x++; continue; } let e = x; while (e < w && m[y * w + e]) e++; if (e - x >= LONG) for (let t = x; t < e; t++) m[y * w + t] = 2; x = e; } }
  for (let x = 0; x < w; x++) { let y = 0; while (y < h) { if (!m[y * w + x]) { y++; continue; } let e = y; while (e < h && m[e * w + x]) e++; if (e - y >= LONG) for (let t = y; t < e; t++) m[t * w + x] = 2; y = e; } }
  for (let i = 0; i < N; i++) if (m[i] === 2) m[i] = 0;
  // enclosed white patches (walls and glass count as edges too, so a room is a patch as well and is told apart below)
  const free = new Uint8Array(N); for (let i = 0; i < N; i++) free[i] = m[i] || wall[i] || glass[i] ? 0 : 1;
  const holes = comps(w, h, free).filter(c => { const bw = (c.x1 - c.x0 + 1) * mpp, bh = (c.y1 - c.y0 + 1) * mpp; return c.x0 > 0 && c.y0 > 0 && c.x1 < w - 1 && c.y1 < h - 1 && Math.min(bw, bh) >= 0.4 && Math.max(bw, bh) <= 4.2 && bw * bh <= 8; });
  const sideWall = (x0, y0, x1, y1) => { // how many of the four sides run along a wall or glass
    const at = (x, y) => { for (let d = -3; d <= 3; d++) for (let e = -3; e <= 3; e++) { const xx = x + d, yy = y + e; if (xx >= 0 && yy >= 0 && xx < w && yy < h && (wall[yy * w + xx] || glass[yy * w + xx])) return 1; } return 0; };
    const side = (ax, ay, bx, by) => { let k = 0, n = 0; for (let t = 0.1; t <= 0.9; t += 0.1) { n++; k += at(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t)); } return k / n > 0.6 ? 1 : 0; };
    return side(x0 - 2, y0 - 2, x1 + 2, y0 - 2) + side(x0 - 2, y1 + 2, x1 + 2, y1 + 2) + side(x0 - 2, y0 - 2, x0 - 2, y1 + 2) + side(x1 + 2, y0 - 2, x1 + 2, y1 + 2);
  };
  // the ink around each patch: the outline it belongs to (a desk cluster has several patches inside one outline)
  const inkLab = new Int32Array(N).fill(-1), inkC = comps8(w, h, m); inkC.forEach((c, k) => c.cells.forEach(i => { inkLab[i] = k; }));
  const groups = new Map(), rounds = [];
  holes.forEach(c => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, fill = c.cells.length / (bw * bh), wm = bw * mpp, hm = bh * mpp;
    if (sideWall(c.x0, c.y0, c.x1, c.y1) >= 2) return; // a small room or a cupboard space, not furniture
    const ell = c.cells.length / (Math.PI / 4 * bw * bh);
    if (Math.abs(bw - bh) <= Math.max(bw, bh) * 0.15 && ell > 0.9 && ell < 1.08 && fill < 0.86 && wm >= 0.5 && wm <= 1.8) { rounds.push({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, d: (bw + bh) / 2 * mpp + 0.05 }); return; }
    if (fill < 0.62 || Math.min(wm, hm) < 0.5 || Math.min(wm, hm) > 1.6) return; // wider than 1.6 m is a zone or a room, not a table top
    // a zone drawn with thin lines that has chairs or other pieces standing inside it is not a table top
    if (inkC.some(q => q.x0 > c.x0 + 1 && q.y0 > c.y0 + 1 && q.x1 < c.x1 - 1 && q.y1 < c.y1 - 1 && Math.max(q.x1 - q.x0, q.y1 - q.y0) * mpp >= 0.4 && Math.min(q.x1 - q.x0, q.y1 - q.y0) * mpp >= 0.3)) return;
    // which outline holds this patch: the ink just left of it
    let k = -1; for (let x = c.x0 - 1; x >= Math.max(0, c.x0 - 4) && k < 0; x--) k = inkLab[((c.y0 + c.y1) >> 1) * w + x];
    if (k < 0) for (let y = c.y0 - 1; y >= Math.max(0, c.y0 - 4) && k < 0; y--) k = inkLab[y * w + ((c.x0 + c.x1) >> 1)];
    const key = k < 0 ? 'h' + c.x0 + '_' + c.y0 : k, g = groups.get(key) || groups.set(key, { x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0, big: 0 }).get(key);
    g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1); g.n++; g.big++; g.area = (g.area || 0) + bw * bh; (g.parts = g.parts || []).push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
  });
  // patches inside one outline make one piece when together they fill it (a desk cluster); otherwise each is its own piece (an L of cabinets)
  const rectsF = [...groups.values()].filter(g => g.big).flatMap(g => g.area >= 0.6 * (g.x1 - g.x0 + 1) * (g.y1 - g.y0 + 1) ? [g] : g.parts.map(q => ({ ...q, n: 1 }))).map(g => ({ x0: g.x0 - 1, y0: g.y0 - 1, x1: g.x1 + 1, y1: g.y1 + 1, n: g.n })).filter(r => { const a = (r.x1 - r.x0) * mpp, b = (r.y1 - r.y0) * mpp; return Math.min(a, b) >= 0.45 && Math.max(a, b) <= 6; });
  // chairs: what is left of the drawing once tables are taken out, in small separate pieces
  const rest = m.slice(), blank = (x0, y0, x1, y1) => { for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) rest[y * w + x] = 0; };
  rectsF.forEach(r => blank(r.x0 - 2, r.y0 - 2, r.x1 + 2, r.y1 + 2)); rounds.forEach(r => { const R = r.d / mpp / 2 + 2; blank(Math.round(r.x - R), Math.round(r.y - R), Math.round(r.x + R), Math.round(r.y + R)); });
  const chairs = [];
  comps8(w, h, rest, c => { const bw = (c.x1 - c.x0 + 1) * mpp, bh = (c.y1 - c.y0 + 1) * mpp, d = c.cells.length / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)), L = Math.max(bw, bh), S = Math.min(bw, bh);
    // two chairs side by side drawn touching: split in two
    if (L >= 0.8 && L <= 1.4 && S >= 0.35 && S <= 0.7 && L / S >= 1.7 && L / S <= 2.8 && d >= 0.1 && d <= 0.97) { const hx = bw >= bh, mid = hx ? (c.x0 + c.x1) / 2 : (c.y0 + c.y1) / 2;
      [0, 1].forEach(k => { const cs = c.cells.filter(i => ((hx ? i % w : (i / w) | 0) < mid) === !k); if (!cs.length) return; const q = { cells: cs, x0: 1e9, y0: 1e9, x1: -1, y1: -1 }; cs.forEach(i => { const x = i % w, y = (i / w) | 0; q.x0 = Math.min(q.x0, x); q.x1 = Math.max(q.x1, x); q.y0 = Math.min(q.y0, y); q.y1 = Math.max(q.y1, y); }); chairs.push(q); }); return false; }
    const ok = Math.max(bw, bh) >= 0.38 && Math.max(bw, bh) <= 0.95 && Math.min(bw, bh) >= 0.3 && Math.max(bw, bh) / Math.min(bw, bh) <= 1.7 && d >= 0.1 && d <= 0.97; if (ok) chairs.push(c); return false; });
  const near = (x, y, r) => { const dx = Math.max(r.x0 - x, 0, x - r.x1), dy = Math.max(r.y0 - y, 0, y - r.y1); return Math.hypot(dx, dy) * mpp; };
  const used = new Set();
  chairs.forEach(c => {
    const x = (c.x0 + c.x1) / 2, y = (c.y0 + c.y1) / 2, size = Math.max(c.x1 - c.x0 + 1, c.y1 - c.y0 + 1) * mpp;
    let f = null, best = 1.0;
    rectsF.forEach((r, k) => { const d = near(x, y, r); if (d < best) { best = d; used.add(k); const cx = Math.max(r.x0, Math.min(r.x1, x)), cy = Math.max(r.y0, Math.min(r.y1, y)); f = Math.abs(cx - x) > Math.abs(cy - y) ? [Math.sign(cx - x), 0] : [0, Math.sign(cy - y)]; } });
    rounds.forEach(r => { const d = Math.hypot(r.x - x, r.y - y) * mpp - r.d / 2; if (d < best) { best = d; const L = Math.hypot(r.x - x, r.y - y) || 1; f = [(r.x - x) / L, (r.y - y) / L]; } });
    if (!f) { // a chair on its own: it must look like one (a closed seat or a solid seat, at least 45 cm), not a letter or a mark
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, solid = c.cells.length / (bw * bh) > 0.75, own = new Uint8Array(bw * bh); c.cells.forEach(i => { own[(((i / w) | 0) - c.y0) * bw + (i % w - c.x0)] = 1; });
      const out2 = floodBorder(bw, bh, j => !own[j]); let inside = 0; for (let j = 0; j < bw * bh; j++) if (!own[j] && !out2[j]) inside++;
      if (size < 0.45 || !(solid || inside * mpp * mpp >= 0.03)) return;
      // facing away from the heavier side (the backrest)
      let sx = 0, sy = 0; c.cells.forEach(i => { sx += i % w - x; sy += ((i / w) | 0) - y; }); sx /= c.cells.length; sy /= c.cells.length;
      f = Math.abs(sx) > Math.abs(sy) ? [-Math.sign(sx) || 1, 0] : [0, -Math.sign(sy) || 1]; }
    out.push({ t: size > 0.82 ? 'armchair' : 'chair', x, y, f });
  });
  rectsF.forEach((r, k) => {
    const sx = (r.x1 - r.x0) * mpp, sy = (r.y1 - r.y0) * mpp, x = (r.x0 + r.x1) / 2, y = (r.y0 + r.y1) / 2, L = Math.max(sx, sy), W = Math.min(sx, sy);
    if (used.has(k)) { out.push({ t: r.n >= 3 ? 'desk' : 'table', x, y, sx, sy }); return; }
    const against = sideWall(r.x0, r.y0, r.x1, r.y1) >= 1;
    if (against && W <= 0.8) out.push({ t: 'cabinet', x, y, sx, sy });
    else if (L >= 1.4 && L <= 2.8 && W >= 0.6 && W <= 1.1) out.push({ t: 'sofa', x, y, sx, sy });
    else if (L <= 1.6) out.push({ t: 'ltable', x, y, sx, sy });
    else out.push({ t: 'table', x, y, sx, sy });
  });
  rounds.forEach(r => out.push({ t: 'rtable', x: r.x, y: r.y, d: r.d }));
  return out;
}

/* imgs: [{width, height, data (RGBA), page}] in the order the storeys go up. opt: { mpp: metres per pixel, height: storey height in m } */
export function analyzeImages(imgs, opt) {
  opt = opt || {};
  const P = imgs.map(classify);
  // scale: walls in such plans are mostly 20 cm thick
  const th = wallThickness(P[0]), mpp = opt.mpp || Math.min(0.08, Math.max(0.01, 0.25 / th)); // walls here are about 25 cm
  // line every plan up with the first one
  const offs = P.map((p, i) => i ? align(P[0], p) : [0, 0]);
  let X0 = 0, Y0 = 0, X1 = P[0].w, Y1 = P[0].h;
  P.forEach((p, i) => { X0 = Math.min(X0, offs[i][0]); Y0 = Math.min(Y0, offs[i][1]); X1 = Math.max(X1, offs[i][0] + p.w); Y1 = Math.max(Y1, offs[i][1] + p.h); });
  const pad = Math.round(1.5 / mpp); X0 -= pad; Y0 -= pad; X1 += pad; Y1 += pad;
  const nx = X1 - X0, ny = Y1 - Y0, N = nx * ny, c = mpp;
  // the shared grid: one cell per pixel of the first plan; rows go down the picture, so world z = row (south)
  const cxp = (X0 + X1) / 2, cyp = (Y0 + Y1) / 2;
  const wx = gx => (gx + X0 - cxp) * c, wz = gy => (gy + Y0 - cyp) * c;
  const R = r => ({ x0: wx(r.x0), x1: wx(r.x1), z0: wz(r.y0), z1: wz(r.y1) });
  const put = (src, i) => { const m = new Uint8Array(N), p = P[i], [ox, oy] = offs[i]; for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (src[y * p.w + x]) m[(y + oy - Y0) * nx + (x + ox - X0)] = 1; return m; };
  const cell = r => Math.max(1, Math.round(r / c));
  const H = opt.height || 4.0;
  const storeys = P.map((p, i) => {
    const wall = put(p.wall, i), glass = put(p.glass, i);
    // doorways: gaps between two wall ends on one line, not glass
    const op = new Uint8Array(N), minL = cell(0.6), maxL = cell(1.9), ext = cell(0.25);
    const scan = horiz => { const A = horiz ? ny : nx, B = horiz ? nx : ny, at = (a, b) => horiz ? a * nx + b : b * nx + a;
      for (let a = 0; a < A; a++) { let b = 0; while (b < B) { if (wall[at(a, b)]) { b++; continue; } let e = b; while (e < B && !wall[at(a, e)]) e++; const L = e - b;
        if (b > 0 && e < B && L >= minL && L <= maxL) { let l = 0; while (b - 1 - l >= 0 && wall[at(a, b - 1 - l)] && l <= ext) l++; let r = 0; while (e + r < B && wall[at(a, e + r)] && r <= ext) r++;
          let g = 0; for (let t = b; t < e; t++) if (glass[at(a, t)]) g++;
          if (l > ext && r > ext && g < L * 0.3) for (let t = b; t < e; t++) op[at(a, t)] = 1; }
        b = e; } } };
    scan(true); scan(false);
    const opens = [];
    comps(nx, ny, op).forEach(cp => { const bw = (cp.x1 - cp.x0 + 1) * c, bh = (cp.y1 - cp.y0 + 1) * c, horiz = bw >= bh, len = Math.max(bw, bh), t = Math.min(bw, bh);
      if (t < 0.06 || t > 0.6 || len < 0.6) { cp.cells.forEach(j => { op[j] = 0; }); return; }
      opens.push({ type: 'open', horiz, len, th: t, ...R({ x0: cp.x0, x1: cp.x1 + 1, y0: cp.y0, y1: cp.y1 + 1 }) }); });
    // footprint: close walls + glass + doorways and keep the inside
    const src = new Uint8Array(N); for (let j = 0; j < N; j++) src[j] = wall[j] || glass[j] || op[j] ? 1 : 0;
    const close = r => { const D = dist(nx, ny, src), outside = floodBorder(nx, ny, j => D[j] > r), D2 = dist(nx, ny, outside), f = new Uint8Array(N); for (let j = 0; j < N; j++) f[j] = D2[j] > r ? 1 : 0; return f; };
    const foot = close(1.0 / c);
    // a room crossed corner to corner by two lines is open to the floor below
    const voids = new Uint8Array(N);
    // voids: rectangles crossed by a big X, inside the footprint and not wall
    const xs = findXs(p, mpp).map(b => ({ x0: Math.round(b.x0 + offs[i][0] - X0), x1: Math.round(b.x1 + offs[i][0] - X0), y0: Math.round(b.y0 + offs[i][1] - Y0), y1: Math.round(b.y1 + offs[i][1] - Y0) }));
    xs.forEach(b => { for (let y = Math.max(0, b.y0); y <= Math.min(ny - 1, b.y1); y++) for (let x = Math.max(0, b.x0); x <= Math.min(nx - 1, b.x1); x++) { const j = y * nx + x; if (foot[j] && !wall[j]) voids[j] = 1; } });
    if (opt.debug) xs.forEach(b => opt.debug.push({ i, X: [b.x0, b.y0, b.x1, b.y1], m: [+((b.x1 - b.x0) * c).toFixed(1), +((b.y1 - b.y0) * c).toFixed(1)] }));
    const nVoid = xs.length;
    const flights = findTreads(p, offs[i][0] - X0, offs[i][1] - Y0, mpp);
    // furniture (not on the stairs, not over voids)
    let furn = []; try { furn = findFurniture(p, mpp); } catch (e) { }
    const ox = offs[i][0] - X0, oy = offs[i][1] - Y0, onStair = (gx, gy) => flights.some(f => f.steps.some(q => Math.hypot(q.x - gx, q.y - gy) < f.width * 0.8));
    furn = furn.filter(it => { const gx = Math.round(it.x + ox), gy = Math.round(it.y + oy), j = gy * nx + gx; return gx >= 0 && gy >= 0 && gx < nx && gy < ny && foot[j] && !voids[j] && !onStair(gx, gy); })
      .map(it => ({ ...it, x: wx(it.x + ox), z: wz(it.y + oy), sx: it.sx, sz: it.sy, r: it.f ? Math.atan2(it.f[0], it.f[1]) : 0 }));
    return { wall, glass, op, foot, voids, nVoid, opens, flights, furn, off: offs[i] };
  });
  // storeys: ground at 0, each one H higher
  const res = { raster: true, scale: 0, k: c, mpp, wallTh: th, cell: c, nx, ny, region: { X0, Y0, X1, Y1 }, center: [cxp, cyp], levels: {}, storeys: [] };
  const holes = storeys.map(() => new Uint8Array(N)), stairsOf = storeys.map(() => []);
  storeys.forEach((s, i) => {
    if (i + 1 >= storeys.length) return;
    const up = storeys[i + 1], b = i * H, t = (i + 1) * H;
    // flights drawn on this plan, plus those drawn only on the plan above (often the lower part of a stair is drawn faintly)
    const mid = f => { const q = f.steps[f.steps.length >> 1]; return [q.x, q.y]; };
    const fl = s.flights.slice(); up.flights.forEach(f => { const m = mid(f); if (!fl.some(g => { const n = mid(g); return Math.hypot(n[0] - m[0], n[1] - m[1]) * c < 1.5; })) fl.push(f); });
    // open floor beyond an end (on the plan above for the top, on this plan for the foot)
    const free = (S, q, d, len) => { let k = 0; for (let t = 1; t <= len; t++) { const x = Math.round(q.x + d[0] * t), y = Math.round(q.y + d[1] * t); if (x < 0 || y < 0 || x >= nx || y >= ny) break; const j = y * nx + x; if (!S.foot[j] || S.wall[j] || S.glass[j] || S.voids[j]) break; k++; } return k; };
    fl.forEach(f => {
      const a0 = f.steps[0], a1 = f.steps[f.steps.length - 1], L0 = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1, u = [(a1.x - a0.x) / L0, (a1.y - a0.y) / L0], len = Math.round(1.5 / c);
      // climbing towards a1: open floor above past a1 and open floor here before a0; or the other way round
      const fwd = free(up, a1, u, len) + free(s, a0, [-u[0], -u[1]], len), back = free(up, a0, [-u[0], -u[1]], len) + free(s, a1, u, len);
      const st = fwd >= back ? f.steps : f.steps.slice().reverse(), n = st.length, rise = (t - b) / (n + 1);
      const d = [st[n - 1].x - st[0].x, st[n - 1].y - st[0].y], L = Math.hypot(d[0], d[1]) || 1, dir = [d[0] / L, d[1] / L];
      const steps = st.map((q, k) => ({ x: wx(q.x), z: wz(q.y), ang: Math.atan2(-dir[1], dir[0]), depth: f.gap * c, width: f.width * c, top: b + (k + 1) * rise }));
      // the top landing reaches the floor above
      const lq = st[n - 1], land = { x: wx(lq.x + dir[0] * f.gap * 1.5), z: wz(lq.y + dir[1] * f.gap * 1.5), ang: steps[0].ang, depth: f.gap * 2 * c, width: f.width * c, top: t };
      stairsOf[i].push({ steps, lands: [land] });
      // the hole in the floor above, over the flight (head room) but not over the landing
      stampSeg({ nx, ny, m: holes[i + 1] }, [st[0].x - dir[0] * f.gap, st[0].y - dir[1] * f.gap], [lq.x - dir[0] * f.gap * 0.5, lq.y - dir[1] * f.gap * 0.5], f.width / 2 + 2, 1);
      // nothing of this storey's walls may stand on the flight
      stampSeg({ nx, ny, m: s.wall }, [st[0].x, st[0].y], [lq.x + dir[0] * f.gap * 2, lq.y + dir[1] * f.gap * 2], f.width / 2, 0);
      stampSeg({ nx, ny, m: up.wall }, [lq.x, lq.y], [lq.x + dir[0] * f.gap * 3, lq.y + dir[1] * f.gap * 3], f.width / 2, 0);
    });
  });
  const NAMES = ['الدور الأرضي', 'الدور الأول', 'الدور الثاني', 'الدور الثالث', 'الدور الرابع'];
  storeys.forEach((s, i) => {
    const b = i * H, below = i ? storeys[i - 1].foot : null, slab = new Uint8Array(N);
    for (let j = 0; j < N; j++) slab[j] = (s.foot[j] || (below && below[j])) && !holes[i][j] && !(i && s.voids[j]) ? 1 : 0;
    // walls and glass of this storey; glass runs floor to ceiling here (offices, shopfronts, balustrades on voids)
    res.storeys.push({ kind: i ? 'f' + i : 'g', name: NAMES[i] || ('دور ' + (i + 1)), title: '', page: imgs[i].page, img: i, off: [s.off[0] - 0, s.off[1] - 0], base: b, top: b + H,
      furniture: s.furn, walls: rects(nx, ny, s.wall).map(R), glass: rects(nx, ny, s.glass).map(R), parapets: [], parapetH: 1, opens: s.opens, slab: rects(nx, ny, slab).map(R), stairs: stairsOf[i], voids: s.nVoid, flights: s.flights.map(f => ({ n: f.steps.length, w: +(f.width * c).toFixed(2), gap: +(f.gap * c).toFixed(2), at: [Math.round(f.steps[0].x), Math.round(f.steps[0].y)] })) });
  });
  const top = storeys[storeys.length - 1];
  const roofM = new Uint8Array(N); for (let j = 0; j < N; j++) roofM[j] = top.foot[j] || (storeys.length > 1 && storeys[storeys.length - 2].foot[j]) ? 1 : 0;
  res.roof = { base: storeys.length * H, slab: rects(nx, ny, roofM).map(R), parapets: [], parapetH: 1 };
  // building size, for the scale box in the side panel
  { const f = storeys[0].foot; let a = 1e9, b2 = -1, y0 = 1e9, y1 = -1; for (let j = 0; j < N; j++) if (f[j]) { const x = j % nx, y = (j / nx) | 0; if (x < a) a = x; if (x > b2) b2 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    res.width = b2 > a ? +((b2 - a + 1) * c).toFixed(1) : 0; res.depth = y1 > y0 ? +((y1 - y0 + 1) * c).toFixed(1) : 0; res.height = H; }
  res.sheets = imgs.map((im, i) => ({ i: im.page - 1, kind: i ? 'f' + i : 'g', title: 'صورة مخطط ' + (NAMES[i] || 'دور ' + (i + 1)) }));
  return res;
}
