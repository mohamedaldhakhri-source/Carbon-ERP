/* layout.js — a building described as data (what the AI returns when it reads a plan picture or designs a project)
   turned into the storeys the 3D viewer builds: walls cut by doors and windows, floor-to-ceiling glass, slabs,
   furniture pieces, room finishes, and outdoor works (pool, deck, lawn). Metres; x to the right, y down the plan.
   No three.js here, so it can be tested on its own. */

const FACING = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);

// the AI's furniture kinds -> pieces of the 3D library
const PIECE = { sofa: 'sofa', armchair: 'armchair', chair: 'chair', office_chair: 'ochair', dining_table: 'otable', coffee_table: 'coffee', side_table: 'rtable', round_table: 'rtable',
  desk: 'desk', bed: 'bed', wardrobe: 'wardrobe', kitchen_counter: 'kitchen', island: 'island', bar_stool: 'stool', tv_unit: 'tv', toilet: 'toilet', basin: 'basin',
  shower: 'shower', bathtub: 'bathtub', sunbed: 'sunbed', plant: 'pot', cabinet: 'cabinet', majlis_seating: 'sofa', rug: null };

export function layoutToSet(L, opt) {
  opt = opt || {};
  const st0 = (L.storeys || [])[0]; if (!st0) return null;
  // overall extent from everything drawn
  let X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9;
  const ext = (a, b, c, d) => { X0 = Math.min(X0, a, c); X1 = Math.max(X1, a, c); Y0 = Math.min(Y0, b, d); Y1 = Math.max(Y1, b, d); };
  (L.storeys || []).forEach(s => { (s.walls || []).forEach(w => ext(w.x0, w.y0, w.x1, w.y1)); (s.rooms || []).forEach(r => ext(r.x0, r.y0, r.x1, r.y1)); });
  (L.outdoor || []).forEach(o => ext(o.x0, o.y0, o.x1, o.y1));
  if (!(X1 > X0)) return null;
  const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2, X = x => num(x) - cx, Z = y => num(y) - cy;
  const H = opt.height || num(st0.height) || 3.4;
  const res = { layout: true, k: 1, region: { X0: X0 - cx - 6, X1: X1 - cx + 6, Y0: Y0 - cy - 6, Y1: Y1 - cy + 6 }, center: [0, 0], levels: {}, storeys: [], finishes: [], outdoor: [], sheets: [],
    width: +(X1 - X0).toFixed(1), depth: +(Y1 - Y0).toFixed(1), height: H, title: L.title || '' };
  const NAMES = ['الدور الأرضي', 'الدور الأول', 'الدور الثاني', 'الدور الثالث'];
  (L.storeys || []).forEach((s, i) => {
    const b = i * H, t = b + H, walls = [], glass = [], opens = [], slab = [], furniture = [];
    // walls as centre lines with a thickness; only straight runs along x or y are built
    const segs = (s.walls || []).map(w => { const t2 = Math.max(0.1, Math.min(0.6, num(w.t) || 0.2)), hz = Math.abs(w.y1 - w.y0) <= Math.abs(w.x1 - w.x0);
      return hz ? { hz, c: (w.y0 + w.y1) / 2, a: Math.min(w.x0, w.x1), e: Math.max(w.x0, w.x1), t: t2, cuts: [] } : { hz, c: (w.x0 + w.x1) / 2, a: Math.min(w.y0, w.y1), e: Math.max(w.y0, w.y1), t: t2, cuts: [] }; })
      .filter(g => g.e - g.a > 0.05);
    // each door / window sits on the nearest wall along it
    (s.openings || []).forEach(o => {
      const hz = Math.abs(o.y1 - o.y0) <= Math.abs(o.x1 - o.x0), c = hz ? (o.y0 + o.y1) / 2 : (o.x0 + o.x1) / 2, a = hz ? Math.min(o.x0, o.x1) : Math.min(o.y0, o.y1), e = hz ? Math.max(o.x0, o.x1) : Math.max(o.y0, o.y1);
      if (e - a < 0.3) return;
      let best = null, bd = 1e9; segs.forEach(g => { if (g.hz !== hz) return; const d = Math.abs(g.c - c); if (d < 0.6 && a < g.e && e > g.a && d < bd) { bd = d; best = g; } });
      if (!best) return;
      const a2 = Math.max(a, best.a), e2 = Math.min(e, best.e); if (e2 - a2 < 0.3) return;
      best.cuts.push([a2, e2]);
      const r = best.hz ? { x0: X(a2), x1: X(e2), z0: Z(best.c - best.t / 2), z1: Z(best.c + best.t / 2) } : { x0: X(best.c - best.t / 2), x1: X(best.c + best.t / 2), z0: Z(a2), z1: Z(e2) };
      const type = o.type || 'door', len = e2 - a2;
      if (type === 'glass' || type === 'sliding') { // floor-to-ceiling glass in a thin frame
        const m = best.hz ? { ...r, z0: Z(best.c) - 0.03, z1: Z(best.c) + 0.03 } : { ...r, x0: X(best.c) - 0.03, x1: X(best.c) + 0.03 }; glass.push(m);
        if (t - b > 3.0) opens.push({ type: 'open', horiz: best.hz, len, th: best.t, ...r, lintelAt: b + 3.0 });
      } else if (type === 'window') opens.push({ type: 'window', horiz: best.hz, len, th: best.t, ...r });
      else { // a door: leaf standing open at one jamb
        const o2 = { type: 'door', horiz: best.hz, len, th: best.t, ...r };
        if (type === 'door' && len <= 1.3) { const hx = best.hz ? X(a2) : X(best.c), hz2 = best.hz ? Z(best.c) : Z(a2); o2.leaf = best.hz ? { a: [hx, hz2], b: [hx, hz2 + len] } : { a: [hx, hz2], b: [hx + len, hz2] }; }
        opens.push(o2);
      }
    });
    segs.forEach(g => { // the wall pieces between the openings
      const cuts = g.cuts.sort((p, q) => p[0] - q[0]); let at = g.a; const put = (a, e) => { if (e - a < 0.02) return; walls.push(g.hz ? { x0: X(a), x1: X(e), z0: Z(g.c - g.t / 2), z1: Z(g.c + g.t / 2) } : { x0: X(g.c - g.t / 2), x1: X(g.c + g.t / 2), z0: Z(a), z1: Z(e) }); };
      // walls overlap a half thickness at the corners so they close
      const a0 = g.a - g.t / 2, e0 = g.e + g.t / 2; at = a0; cuts.forEach(([a, e]) => { put(at, a); at = Math.max(at, e); }); put(at, e0);
    });
    // floors: every room, and the space inside the walls
    (s.rooms || []).forEach(r => { const q = { x0: X(Math.min(r.x0, r.x1)), x1: X(Math.max(r.x0, r.x1)), z0: Z(Math.min(r.y0, r.y1)), z1: Z(Math.max(r.y0, r.y1)) }; if (q.x1 - q.x0 < 0.3 || q.z1 - q.z0 < 0.3) return;
      slab.push(q); const f = r.floor || {};
      res.finishes.push({ lvl: i, ...q, name: r.name_ar || '', look: { room_ar: r.name_ar || '', floor: { material: f.material || 'tile', color: f.color || '#e6e1d8' }, walls: { color: r.wall_color || '#f1ede6', material: 'paint', accent_color: '', accent_share: 0 }, ceiling: { type: 'gypsum', color: '#f6f5f2' }, furniture: {} } }); });
    walls.forEach(w => slab.push({ ...w }));
    // furniture: centre, size across x and y, and the way its front faces
    (s.furniture || []).forEach(f => { const t2 = PIECE[f.type]; if (!t2) return; const r = FACING[f.facing] != null ? FACING[f.facing] : 0, across = f.facing === 'e' || f.facing === 'w';
      const sx = Math.max(0.3, across ? num(f.d) : num(f.w)), sz = Math.max(0.3, across ? num(f.w) : num(f.d));
      furniture.push({ t: t2, layout: true, x: X(f.x), z: Z(f.y), sx, sz, r, c: f.color || null, d: Math.max(num(f.w), num(f.d)) }); });
    res.storeys.push({ kind: i ? 'f' + i : 'g', name: s.name_ar || NAMES[i] || 'دور ' + (i + 1), title: '', page: null, img: null, off: [0, 0], base: b, top: t,
      walls, glass, opens, slab, parapets: [], parapetH: 1, stairs: [], furniture, voids: 0 });
  });
  const top = res.storeys[res.storeys.length - 1];
  res.roof = { base: top.top, slab: top.slab.map(r => ({ ...r })), parapets: [], parapetH: 1 };
  (L.outdoor || []).forEach(o => { const q = { type: o.type, x0: X(Math.min(o.x0, o.x1)), x1: X(Math.max(o.x0, o.x1)), z0: Z(Math.min(o.y0, o.y1)), z1: Z(Math.max(o.y0, o.y1)) }; if (q.x1 - q.x0 > 0.3 && q.z1 - q.z0 > 0.3) res.outdoor.push(q); });
  res.sheets = [{ i: 0, kind: 'g', title: L.title || 'مخطط' }];
  return res;
}

// the JSON schema the AI answers with (the edge function sends it as the output format)
export const LAYOUT_NOTE = 'metres, x to the right, y down the drawing';
