/* furniture3d.js — a small library of furniture and landscape pieces, built from simple shapes (no downloads),
   in the materials of the restaurant concept: light oak, walnut, tan leather, beige fabric, plaster, travertine, brass, greenery.
   Each piece is built at the origin, facing +z, sitting on y = 0, sizes in metres. */
import * as THREE from 'three';

export const COLORS = [
  ['#c79a63', 'خشب فاتح (بلوط)'], ['#6b4529', 'خشب جوز'], ['#b0622f', 'جلد عسلي'], ['#e4dccd', 'قماش بيج'], ['#8fa889', 'أخضر زيتي'],
  ['#e9e1d4', 'جبس / بلاستر'], ['#d8c4a5', 'ترافرتين'], ['#f1efea', 'رخام أبيض'], ['#2b2b2b', 'معدن أسود'], ['#b8913f', 'نحاسي']
];
const cache = {};
const mat = (c, o) => { const k = c + JSON.stringify(o || {}); return cache[k] || (cache[k] = new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7 }, o || {}))); };
const M = {
  oak: () => mat('#c79a63', { roughness: 0.6 }), walnut: () => mat('#6b4529', { roughness: 0.55 }), leather: () => mat('#b0622f', { roughness: 0.45 }),
  fabric: () => mat('#e4dccd', { roughness: 0.95 }), plaster: () => mat('#e9e1d4', { roughness: 0.9 }), trav: () => mat('#d8c4a5', { roughness: 0.75 }),
  marble: () => mat('#f1efea', { roughness: 0.25 }), black: () => mat('#2b2b2b', { roughness: 0.4, metalness: 0.6 }), brass: () => mat('#b8913f', { roughness: 0.3, metalness: 0.8 }),
  soil: () => mat('#4a3626', { roughness: 1 }), terra: () => mat('#b96f4a', { roughness: 0.85 }), bark: () => mat('#5d4430', { roughness: 0.95 }), rope: () => mat('#b99a6b', { roughness: 1 }),
  leaf: i => mat(['#4f7a3a', '#3f6b35', '#5d8a43', '#6b8f4e'][i % 4], { roughness: 0.85, flatShading: true }),
  glow: () => mat('#fff4dc', { emissive: '#ffe2b0', emissiveIntensity: 1.2, roughness: 0.3 }), pebble: () => mat('#cfc8bb', { roughness: 0.8, flatShading: true })
};
// a, b: primary and secondary material (the primary one can be recoloured)
const box = (g, w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
const cyl = (g, r1, r2, h, x, y, z, m, seg) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 20), m); o.position.set(x, y, z); g.add(o); return o; };
const blob = (g, r, x, y, z, m, sy) => { const o = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m); o.position.set(x, y, z); o.scale.set(1, sy || 0.85, 1); o.rotation.set(x * 3, z * 5, 0); g.add(o); return o; };
const prim = (c, fallback) => c ? mat(c, { roughness: 0.7 }) : fallback;

function chair(g, a) { // dining chair: oak frame, fabric seat
  const f = prim(a, M.oak()); [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]].forEach(([x, z]) => cyl(g, 0.018, 0.015, 0.44, x, 0.22, z, f, 8));
  box(g, 0.46, 0.06, 0.45, 0, 0.47, 0, M.fabric()); box(g, 0.44, 0.04, 0.04, 0, 0.62, -0.21, f); box(g, 0.44, 0.22, 0.04, 0, 0.78, -0.22, f);
  cyl(g, 0.016, 0.016, 0.42, -0.2, 0.68, -0.21, f, 8); cyl(g, 0.016, 0.016, 0.42, 0.2, 0.68, -0.21, f, 8);
}
function table(g, a, r, h) { // round pedestal table, marble top
  cyl(g, r, r, 0.035, 0, h - 0.018, 0, prim(a, M.marble()), 40); cyl(g, 0.04, 0.05, h - 0.06, 0, (h - 0.06) / 2 + 0.03, 0, M.black(), 12); cyl(g, 0.26, 0.28, 0.03, 0, 0.015, 0, M.black(), 24);
}
function leafy(g, w, d, y, n, seed) { for (let i = 0; i < n; i++) { const t = (i * 0.618 + (seed || 0)) % 1, u = (i * 0.382 + 0.2) % 1; blob(g, 0.16 + ((i * 7) % 5) * 0.03, (t - 0.5) * w, y + 0.12 + ((i * 3) % 4) * 0.06, (u - 0.5) * d, M.leaf(i)); } }
function arcSeat(g, a, R, ang, back) { // curved bench made of short segments
  const n = Math.max(6, Math.round(R * ang * 4)), seat = prim(a, M.leather());
  for (let i = 0; i < n; i++) {
    const t0 = -ang / 2 + ang * i / n, t1 = t0 + ang / n, tm = (t0 + t1) / 2, L = 2 * R * Math.sin((t1 - t0) / 2) + 0.01;
    const s = box(g, L, 0.45, 0.55, Math.sin(tm) * R, 0.225, Math.cos(tm) * R, seat); s.rotation.y = tm;
    if (back) { const b = box(g, L * (R + 0.33) / R, back, 0.14, Math.sin(tm) * (R + 0.33), back / 2, Math.cos(tm) * (R + 0.33), M.walnut()); b.rotation.y = tm; }
  }
}

export const LIB = {
  chair: { l: 'كرسي طعام', i: '🪑', build: (g, a) => chair(g, a) },
  set4: { l: 'طاولة مع 4 كراسي', i: '🍽', build: (g, a) => { table(g, null, 0.45, 0.75); [0, 1, 2, 3].forEach(k => { const c = new THREE.Group(); chair(c, a); const t = k * Math.PI / 2; c.position.set(Math.sin(t) * 0.68, 0, Math.cos(t) * 0.68); c.rotation.y = t + Math.PI; g.add(c); }); } },
  set2: { l: 'طاولة مع كرسيين', i: '☕', build: (g, a) => { table(g, null, 0.35, 0.75); [0, 1].forEach(k => { const c = new THREE.Group(); chair(c, a); const t = k * Math.PI; c.position.set(0, 0, (k ? -1 : 1) * 0.6); c.rotation.y = t + Math.PI; g.add(c); }); } },
  table90: { l: 'طاولة دائرية Ø90', i: '⚪', build: (g, a) => table(g, a, 0.45, 0.75) },
  table120: { l: 'طاولة دائرية Ø120', i: '⭕', build: (g, a) => table(g, a, 0.6, 0.75) },
  tablesq: { l: 'طاولة مربعة 80', i: '⬜', build: (g, a) => { box(g, 0.8, 0.04, 0.8, 0, 0.73, 0, prim(a, M.oak())); [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].forEach(([x, z]) => box(g, 0.05, 0.71, 0.05, x, 0.355, z, M.walnut())); } },
  booth: { l: 'جلسة دائرية (بود)', i: '🛋', build: (g, a) => { arcSeat(g, a, 1.05, Math.PI * 1.25, 1.05); table(g, null, 0.5, 0.75); leafy(g, 2.4, 0.5, 1.05, 9, 0.1); g.children.slice(-9).forEach(o => { o.position.z = o.position.z * 0.3 - 1.42; }); } },
  armchair: { l: 'كرسي لاونج', i: '💺', build: (g, a) => { const w = M.walnut(); box(g, 0.82, 0.12, 0.8, 0, 0.18, 0, w); box(g, 0.66, 0.16, 0.66, 0, 0.32, 0.04, prim(a, M.fabric())); box(g, 0.66, 0.42, 0.16, 0, 0.5, -0.3, prim(a, M.fabric())); box(g, 0.08, 0.36, 0.8, -0.37, 0.42, 0, w); box(g, 0.08, 0.36, 0.8, 0.37, 0.42, 0, w); } },
  sofa: { l: 'كنبة 3 مقاعد', i: '🛋', build: (g, a) => { const w = M.walnut(), f = prim(a, M.fabric()); box(g, 2.2, 0.12, 0.9, 0, 0.16, 0, w); [-0.7, 0, 0.7].forEach(x => box(g, 0.68, 0.16, 0.7, x, 0.3, 0.06, f)); box(g, 2.0, 0.42, 0.18, 0, 0.5, -0.34, f); box(g, 0.1, 0.34, 0.9, -1.05, 0.4, 0, w); box(g, 0.1, 0.34, 0.9, 1.05, 0.4, 0, w); } },
  coffee: { l: 'طاولة قهوة ترافرتين', i: '▭', build: (g, a) => { const t = prim(a, M.trav()); const top = cyl(g, 0.6, 0.6, 0.06, 0, 0.35, 0, t, 40); top.scale.z = 0.5; [[-0.38, 0], [0, 0], [0.38, 0]].forEach(([x, z]) => cyl(g, 0.1, 0.1, 0.32, x, 0.16, z, t, 20)); } },
  stool: { l: 'كرسي بار خشب', i: '🪵', build: (g, a) => { const f = prim(a, M.oak()); cyl(g, 0.2, 0.2, 0.05, 0, 0.75, 0, f, 24); [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]].forEach(([x, z]) => { const l = cyl(g, 0.016, 0.02, 0.74, x * 1.15, 0.37, z * 1.15, f, 8); l.rotation.set(z * 0.35, 0, -x * 0.35); }); box(g, 0.32, 0.02, 0.02, 0, 0.3, 0.16, f); } },
  counter: { l: 'كاونتر بار (جبس)', i: '🍸', build: (g, a) => { const p = prim(a, M.plaster()); box(g, 3.0, 1.05, 0.6, 0, 0.525, 0, p); cyl(g, 0.3, 0.3, 1.05, -1.5, 0.525, 0, p, 24); cyl(g, 0.3, 0.3, 1.05, 1.5, 0.525, 0, p, 24); box(g, 3.1, 0.05, 0.7, 0, 1.08, 0.04, M.marble()); cyl(g, 0.02, 0.02, 3.0, 0, 0.2, 0.38, M.brass(), 8).rotation.z = Math.PI / 2; } },
  podium: { l: 'منصة استقبال', i: '🛎', build: (g, a) => { cyl(g, 0.38, 0.38, 1.1, 0, 0.55, 0, prim(a, M.oak()), 32); cyl(g, 0.4, 0.4, 0.03, 0, 1.115, 0, M.walnut(), 32); } },
  tree: { l: 'شجرة كبيرة', i: '🌳', build: (g) => { cyl(g, 0.09, 0.15, 2.4, 0, 1.2, 0, M.bark(), 8); [[0, 3.0, 0, 1.1], [0.6, 2.6, 0.3, 0.8], [-0.5, 2.7, -0.4, 0.85], [0.1, 3.5, -0.2, 0.7]].forEach(([x, y, z, r], i) => blob(g, r, x, y, z, M.leaf(i))); } },
  olive: { l: 'شجرة زيتون', i: '🫒', build: (g) => { const t = cyl(g, 0.06, 0.12, 1.5, 0, 0.75, 0, M.bark(), 7); t.rotation.z = 0.12; [[0.2, 1.9, 0, 0.7], [-0.4, 1.7, 0.2, 0.55], [0.1, 2.3, -0.3, 0.5]].forEach(([x, y, z, r], i) => blob(g, r, x, y, z, mat('#7d8f6a', { roughness: 0.9, flatShading: true }), 0.7)); } },
  palm: { l: 'نخلة', i: '🌴', build: (g) => { cyl(g, 0.14, 0.2, 4.2, 0, 2.1, 0, M.bark(), 10); for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.2, 4), M.leaf(i)); const t = i / 9 * Math.PI * 2; f.position.set(Math.sin(t) * 0.9, 4.15, Math.cos(t) * 0.9); f.rotation.set(Math.cos(t) * 1.25, 0, -Math.sin(t) * 1.25); f.scale.z = 0.25; g.add(f); } } },
  planter: { l: 'حوض زرع', i: '🪴', build: (g, a) => { box(g, 1.2, 0.6, 0.45, 0, 0.3, 0, prim(a, M.plaster())); box(g, 1.12, 0.04, 0.37, 0, 0.6, 0, M.soil()); leafy(g, 1.05, 0.3, 0.6, 9, 0.3); } },
  pot: { l: 'نبتة في أصيص', i: '🌿', build: (g, a) => { cyl(g, 0.24, 0.17, 0.5, 0, 0.25, 0, prim(a, M.terra()), 20); leafy(g, 0.35, 0.35, 0.45, 6, 0.6); } },
  lowwall: { l: 'جلسة / حوض منخفض منحني', i: '〰', build: (g, a) => { arcSeat(g, a || '#d8c4a5', 1.8, Math.PI * 0.6, 0); leafy(g, 2.4, 0.3, 0.45, 8, 0.2); g.children.slice(-8).forEach(o => { o.position.z += 1.45; }); } },
  pendant: { l: 'إنارة كروية معلّقة', i: '💡', build: (g) => { cyl(g, 0.004, 0.004, 0.9, 0, 2.95, 0, M.black(), 4); const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), M.glow()); s.position.y = 2.35; s.userData.noCollide = true; g.add(s); } },
  lamp: { l: 'إنارة طاولة كروية', i: '🔆', build: (g) => { cyl(g, 0.012, 0.012, 0.4, 0, 0.2, 0, M.brass(), 8); const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), M.glow()); s.position.y = 0.5; g.add(s); } },
  ropes: { l: 'فاصل حبال معلّقة', i: '🧵', build: (g, a) => { const r = prim(a, M.rope()); for (let i = 0; i < 10; i++) cyl(g, 0.022, 0.022, 2.7, -0.9 + i * 0.2, 1.35, (i % 2) * 0.06, r, 6); box(g, 2.1, 0.06, 0.12, 0, 2.73, 0.03, M.walnut()); } },
  pebbles: { l: 'ممر حصى', i: '🪨', build: (g) => { box(g, 2.0, 0.03, 0.8, 0, 0.015, 0, mat('#e8e1d3', { roughness: 1 })); for (let i = 0; i < 40; i++) { const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + (i % 4) * 0.015, 0), M.pebble()); p.position.set(((i * 0.618) % 1 - 0.5) * 1.9, 0.04, ((i * 0.382) % 1 - 0.5) * 0.7); p.scale.y = 0.5; g.add(p); } } },
  // pieces read from a drawing, built to the size drawn (kept out of the library list)
  rtable: { hide: true, build: (g, a, it) => { const d = Math.max(0.4, Math.min(2.2, it.d || 0.9)); table(g, a, d / 2, d < 0.62 ? 0.5 : 0.75); } },
  otable: { hide: true, build: (g, a, it) => { const L = Math.max(0.8, it.sx || 1.6), W = Math.max(0.5, it.sz || 0.8), top = prim(a, M.oak());
    if (it.oval) { const t = cyl(g, 0.5, 0.5, 0.04, 0, 0.73, 0, top, 48); t.scale.set(L, 1, W); } else box(g, L, 0.04, W, 0, 0.73, 0, top);
    [-1, 1].forEach(s => { cyl(g, 0.05, 0.06, 0.69, s * L * 0.3, 0.355, 0, M.black(), 12); box(g, 0.08, 0.03, W * 0.6, s * L * 0.3, 0.015, 0, M.black()); }); } },
  parasol: { l: 'مظلة جلسة خارجية', i: '⛱', build: (g, a) => { cyl(g, 0.03, 0.03, 2.4, 0, 1.2, 0, M.walnut(), 8); const c = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.45, 8, 1, true), prim(a, M.fabric())); c.position.y = 2.5; c.material.side = THREE.DoubleSide; g.add(c); cyl(g, 0.3, 0.32, 0.08, 0, 0.04, 0, M.black(), 16); } }
};

export function buildItem(it) {
  const def = LIB[it.t]; if (!def) return null;
  const g = new THREE.Group(); def.build(g, it.c || null, it);
  if (it.t === 'sofa' && it.sx) g.children.forEach(o => { o.position.x *= it.sx; o.scale.x *= it.sx; });
  if (it.t === 'pot' && it.d) { const s = Math.max(0.6, Math.min(2.5, it.d / 0.5)); g.scale.set(s, s, s); }
  g.position.set(it.x, it.y, it.z); g.rotation.y = it.r || 0;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { item: it };
  return g;
}
