/* furniture3d.js — a small library of furniture and landscape pieces, built from simple shapes (no downloads),
   in the materials of the restaurant concept: light oak, walnut, tan leather, beige fabric, plaster, travertine, brass, greenery.
   Each piece is built at the origin, facing +z, sitting on y = 0, sizes in metres. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const COLORS = [
  ['#c79a63', 'خشب فاتح (بلوط)'], ['#6b4529', 'خشب جوز'], ['#b0622f', 'جلد عسلي'], ['#e4dccd', 'قماش بيج'], ['#8fa889', 'أخضر زيتي'],
  ['#e9e1d4', 'جبس / بلاستر'], ['#d8c4a5', 'ترافرتين'], ['#f1efea', 'رخام أبيض'], ['#2b2b2b', 'معدن أسود'], ['#b8913f', 'نحاسي']
];
const cache = {};
const mat = (c, o) => { const k = c + JSON.stringify(o || {}); return cache[k] || (cache[k] = new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7 }, o || {}))); };
const tag = (m, look) => { m.userData.look = look; return m; }; // what it is made of, for the textures in look3d.js
const M = {
  oak: () => tag(mat('#c79a63', { roughness: 0.6 }), 'wood'), walnut: () => tag(mat('#6b4529', { roughness: 0.55 }), 'walnut'), leather: () => tag(mat('#b0622f', { roughness: 0.45 }), 'leather'),
  fabric: () => tag(mat('#e4dccd', { roughness: 0.95 }), 'fabric'), plaster: () => tag(mat('#e9e1d4', { roughness: 0.9 }), 'plaster'), trav: () => tag(mat('#d8c4a5', { roughness: 0.75 }), 'stone'),
  marble: () => tag(mat('#f1efea', { roughness: 0.25 }), 'marble'), black: () => tag(mat('#2b2b2b', { roughness: 0.35, metalness: 0.7 }), 'metal'), brass: () => tag(mat('#b8913f', { roughness: 0.3, metalness: 0.8 }), 'metal'),
  soil: () => mat('#4a3626', { roughness: 1 }), terra: () => mat('#b96f4a', { roughness: 0.85 }), bark: () => mat('#5d4430', { roughness: 0.95 }), rope: () => mat('#b99a6b', { roughness: 1 }),
  leaf: i => mat(['#4f7a3a', '#3f6b35', '#5d8a43', '#6b8f4e'][i % 4], { roughness: 0.85, flatShading: true }),
  glow: () => mat('#fff4dc', { emissive: '#ffe2b0', emissiveIntensity: 1.2, roughness: 0.3 }), pebble: () => mat('#cfc8bb', { roughness: 0.8, flatShading: true })
};
// a, b: primary and secondary material (the primary one can be recoloured)
const box = (g, w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
const cyl = (g, r1, r2, h, x, y, z, m, seg) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 20), m); o.position.set(x, y, z); g.add(o); return o; };
const blob = (g, r, x, y, z, m, sy) => { const o = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m); o.position.set(x, y, z); o.scale.set(1, sy || 0.85, 1); o.rotation.set(x * 3, z * 5, 0); g.add(o); return o; };
const prim = (c, fallback) => c ? tag(mat(c, { roughness: 0.7 }), fallback.userData.look) : fallback;


// softer, more real shapes: rounded boxes, bent tubes, curved shells
const rbox = (g, w, h, d, x, y, z, m, r) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r || 0.02, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), m); o.position.set(x, y, z); g.add(o); return o; };
const tube = (g, pts, r, m, closed) => { const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), !!closed, 'catmullrom', 0.1); const o = new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(8, pts.length * 6), r, 8, !!closed), m); g.add(o); return o; };
// a curved panel (part of a cylinder wall) centred on x = 0, bending around a point in front of it
const shell = (g, w, h, R, t, x, y, z, m, tilt) => { const a = w / R, sh = new THREE.Shape(); const n = 16;
  for (let i = 0; i <= n; i++) { const q = -a / 2 + a * i / n; sh[i ? 'lineTo' : 'moveTo'](Math.sin(q) * R, Math.cos(q) * R); }
  for (let i = n; i >= 0; i--) { const q = -a / 2 + a * i / n; sh.lineTo(Math.sin(q) * (R + t), Math.cos(q) * (R + t)); }
  const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: true, bevelThickness: Math.min(0.012, t / 2), bevelSize: Math.min(0.012, t / 2), bevelSegments: 2, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, 0, R); const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); if (tilt) o.rotation.x = -tilt; g.add(o); return o; }; // a positive tilt leans it back
const light = c => { const k = new THREE.Color(c || '#888'); return 0.299 * k.r + 0.587 * k.g + 0.114 * k.b > 0.6; };
const P = { // the office materials seen in design renders
  white: () => tag(mat('#f2f2f0', { roughness: 0.35 }), 'plastic'), chrome: () => tag(mat('#d8dadc', { roughness: 0.18, metalness: 1 }), 'metal'), dark: () => tag(mat('#2a2b2d', { roughness: 0.5, metalness: 0.4 }), 'metal'),
  mesh: c => tag(mat(c || '#d9d8d4', { roughness: 0.9, side: THREE.DoubleSide }), 'mesh'), fab: c => tag(mat(c || '#cfcac2', { roughness: 0.95 }), 'fabric'), screen: () => mat('#16181b', { roughness: 0.25, metalness: 0.3 }), caster: () => mat('#1d1d1d', { roughness: 0.6 })
};
function base5(g, frame, y) { // five-star base on casters
  for (let i = 0; i < 5; i++) { const t = i * Math.PI * 2 / 5, ex = Math.sin(t) * 0.31, ez = Math.cos(t) * 0.31;
    tube(g, [[0, y, 0], [ex * 0.55, y - 0.015, ez * 0.55], [ex, y - 0.035, ez]], 0.016, frame);
    const c = cyl(g, 0.026, 0.026, 0.035, ex, 0.026, ez, P.caster(), 12); c.rotation.z = Math.PI / 2; c.rotation.y = t; cyl(g, 0.008, 0.008, 0.04, ex, 0.06, ez, frame, 6); }
  cyl(g, 0.045, 0.05, 0.05, 0, y, 0, frame, 16);
}
function taskChair(g, a) { // ergonomic office chair: mesh back with headrest, padded seat, arms, five-star base
  const c = a || '#d9d8d4', frame = light(c) ? P.white() : P.dark();
  base5(g, frame, 0.085); cyl(g, 0.022, 0.022, 0.32, 0, 0.26, 0, P.chrome(), 12); rbox(g, 0.3, 0.05, 0.3, 0, 0.43, 0.01, frame, 0.015);
  rbox(g, 0.5, 0.075, 0.48, 0, 0.485, 0.03, P.fab(c), 0.035);
  tube(g, [[0, 0.45, -0.12], [0, 0.48, -0.25], [0, 0.6, -0.29]], 0.02, frame); // spine
  shell(g, 0.48, 0.5, 0.6, 0.012, 0, 0.58, -0.28, P.mesh(c), 0.12); // mesh back
  const top = 1.08, bot = 0.58;
  [-1, 1].forEach(sd => tube(g, [[sd * 0.245, bot, -0.27], [sd * 0.25, (bot + top) / 2, -0.31], [sd * 0.235, top, -0.36]], 0.014, frame));
  shell(g, 0.3, 0.13, 0.5, 0.03, 0, 1.13, -0.38, P.fab(c), 0.18); // headrest
  tube(g, [[0, top - 0.02, -0.355], [0, 1.12, -0.38]], 0.012, frame);
  [-1, 1].forEach(sd => { tube(g, [[sd * 0.2, 0.47, -0.05], [sd * 0.25, 0.56, -0.04], [sd * 0.26, 0.66, 0]], 0.016, frame); rbox(g, 0.07, 0.03, 0.26, sd * 0.26, 0.675, 0.02, P.fab('#3a3b3d'), 0.012); });
}
function meetChair(g, a, casters) { // shell chair: moulded seat and back, slim legs (or casters for training rooms)
  const c = a || '#f2f2f0', sh = tag(mat(c, { roughness: 0.4 }), light(c) ? 'plastic' : 'fabric'), leg = light(c) ? P.chrome() : P.dark();
  rbox(g, 0.47, 0.045, 0.45, 0, 0.455, 0.02, sh, 0.02); shell(g, 0.46, 0.36, 0.42, 0.018, 0, 0.5, -0.19, sh, 0.16);
  if (casters) { [[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.21], [0.21, 0.21]].forEach(([x, z]) => { tube(g, [[x * 0.7, 0.44, z * 0.7], [x, 0.22, z], [x * 1.05, 0.04, z * 1.05]], 0.011, leg); const k = cyl(g, 0.022, 0.022, 0.03, x * 1.05, 0.024, z * 1.05, P.caster(), 10); k.rotation.z = Math.PI / 2; }); }
  else [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.21], [0.2, 0.21]].forEach(([x, z]) => tube(g, [[x * 0.8, 0.44, z * 0.8], [x, 0.22, z], [x * 1.08, 0.0, z * 1.08]], 0.01, leg));
}
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
  armchair: { l: 'كرسي لاونج', i: '💺', build: (g, a) => { // tub lounge chair: curved shell, deep cushion, slim legs, a pillow
    const f = prim(a, tag(mat('#e8e2d6', { roughness: 0.98 }), 'fabric'));
    shell(g, 1.6, 0.42, 0.3, 0.1, 0, 0.24, -0.27, f); // the tub wraps round a seat centred near z = 0
    const cu = cyl(g, 0.31, 0.31, 0.14, 0, 0.33, 0.04, f, 32); cu.scale.z = 1.05; cyl(g, 0.4, 0.4, 0.1, 0, 0.21, 0.03, f, 32);
    [[-0.26, -0.22], [0.26, -0.22], [-0.26, 0.28], [0.26, 0.28]].forEach(([x, z]) => cyl(g, 0.014, 0.01, 0.2, x, 0.1, z, P.dark(), 8));
    const pl = rbox(g, 0.36, 0.26, 0.11, 0, 0.5, -0.12, tag(mat('#b8643a', { roughness: 0.95 }), 'fabric'), 0.05); pl.rotation.x = -0.25; } },
  sofa: { l: 'كنبة 3 مقاعد', i: '🛋', build: (g, a) => { // modern sofa: plinth, soft seat and back cushions, arms, slim legs
    const f = prim(a, M.fabric());
    rbox(g, 2.2, 0.16, 0.9, 0, 0.2, 0, f, 0.04); [-0.7, 0, 0.7].forEach(x => { rbox(g, 0.69, 0.14, 0.66, x, 0.34, 0.08, f, 0.05); rbox(g, 0.69, 0.4, 0.2, x, 0.56, -0.3, f, 0.07); });
    rbox(g, 2.2, 0.36, 0.14, 0, 0.42, -0.39, f, 0.04); [-1, 1].forEach(s => rbox(g, 0.14, 0.42, 0.9, s * 1.08, 0.38, 0, f, 0.05));
    [[-1.0, -0.38], [1.0, -0.38], [-1.0, 0.38], [1.0, 0.38]].forEach(([x, z]) => cyl(g, 0.018, 0.014, 0.12, x, 0.06, z, P.dark(), 8)); } },
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
  otable: { hide: true, build: (g, a, it) => { // meeting table (wood) or training table (white, T legs on casters)
    const L = Math.max(0.8, it.sx || 1.6), W = Math.max(0.5, it.sz || 0.8), top = prim(a, M.oak()), white = light(a || '#c79a63');
    if (it.oval) { const t = cyl(g, 0.5, 0.5, 0.04, 0, 0.73, 0, top, 48); t.scale.set(L, 1, W); } else rbox(g, L, 0.035, W, 0, 0.732, 0, top, 0.012);
    if (white && L < 2.2) { [-1, 1].forEach(s => { const x = s * (L / 2 - 0.1); rbox(g, 0.05, 0.68, 0.05, x, 0.375, 0, P.white(), 0.01); rbox(g, 0.05, 0.035, W * 0.85, x, 0.055, 0, P.white(), 0.012); rbox(g, 0.05, 0.035, W * 0.7, x, 0.7, 0, P.white(), 0.012);
      [-1, 1].forEach(z => { const k = cyl(g, 0.025, 0.025, 0.03, x, 0.025, z * W * 0.4, P.caster(), 10); k.rotation.z = Math.PI / 2; }); }); }
    else [-1, 1].forEach(s => { const x = s * L * 0.32; rbox(g, 0.06, 0.7, Math.min(0.7, W * 0.6), x, 0.36, 0, P.dark(), 0.01); rbox(g, 0.08, 0.025, W * 0.7, x, 0.0125, 0, P.dark(), 0.01); });
  } },
  // office pieces read from plan pictures (sizes come from the drawing)
  ochair: { hide: true, build: (g, a) => taskChair(g, a) },
  mchair: { hide: true, build: (g, a, it) => meetChair(g, a, it && it.casters) },
  desk: { hide: true, build: (g, a, it) => { // workstation: thin white top, loop legs, a fabric divider on a double desk, a screen per seat
    const L = Math.max(0.6, it.sx || 1.4), W = Math.max(0.5, it.sz || 0.7), top = prim(a, tag(mat('#f3f2ef', { roughness: 0.35 }), 'plastic')), leg = light(a || '#f3f2ef') ? P.white() : P.dark(), dbl = W > 1.1;
    rbox(g, L, 0.025, W, 0, 0.737, 0, top, 0.008);
    [-1, 1].forEach(sx => { const x = sx * (L / 2 - 0.06); rbox(g, 0.05, 0.7, 0.05, x, 0.37, -(W / 2 - 0.08), leg, 0.01); rbox(g, 0.05, 0.7, 0.05, x, 0.37, W / 2 - 0.08, leg, 0.01); rbox(g, 0.05, 0.04, W - 0.12, x, 0.02, 0, leg, 0.01); rbox(g, 0.04, 0.04, W - 0.16, x, 0.7, 0, leg, 0.01); });
    rbox(g, L - 0.2, 0.08, 0.03, 0, 0.66, 0, leg, 0.01); // cable tray
    const seats = Math.max(1, Math.round(L / 1.4)), sideOf = dbl ? [-1, 1] : [1];
    if (dbl) rbox(g, L - 0.06, 0.4, 0.03, 0, 0.95, 0, P.fab(it.screen || '#cfd3d4'), 0.012);
    sideOf.forEach(sd => { for (let k = 0; k < seats; k++) { const x = -L / 2 + L * (k + 0.5) / seats;
      const zz = dbl ? sd * 0.2 : -(W / 2 - 0.2), face = dbl ? sd : 1;
      rbox(g, 0.6, 0.36, 0.02, x, 1.0, zz, P.screen(), 0.01); rbox(g, 0.56, 0.32, 0.005, x, 1.0, zz + face * 0.011, mat('#2e3440', { roughness: 0.15, emissive: '#1b2330', emissiveIntensity: 0.6 }), 0.004);
      cyl(g, 0.015, 0.015, 0.16, x, 0.83, zz - face * 0.03, P.chrome(), 8); rbox(g, 0.2, 0.01, 0.15, x, 0.755, zz - face * 0.03, P.chrome(), 0.004);
      rbox(g, 0.42, 0.012, 0.13, x, 0.756, zz + face * 0.28, mat('#e9e9e7', { roughness: 0.5 }), 0.004); } });
  } },
  cabinet: { hide: true, build: (g, a, it) => { const L = Math.max(0.3, it.sx || 1), W = Math.max(0.3, it.sz || 0.6); box(g, L, 0.86, W, 0, 0.45, 0, prim(a, M.oak())); box(g, L + 0.02, 0.03, W + 0.02, 0, 0.895, 0, M.marble()); } },
  ltable: { hide: true, build: (g, a, it) => { const L = Math.max(0.4, it.sx || 1), W = Math.max(0.4, it.sz || 0.6); box(g, L, 0.05, W, 0, 0.42, 0, prim(a, M.walnut())); box(g, L * 0.8, 0.4, W * 0.7, 0, 0.2, 0, M.walnut()); } },
  // home pieces for plans read or designed by Claude (sizes from the plan: sx across the front, sz front to back)
  bed: { hide: true, build: (g, a, it) => { const W = Math.max(0.9, it.sx || 1.8), L = Math.max(1.8, it.sz || 2.0), w = M.walnut(), white = tag(mat('#f4f2ee', { roughness: 0.95 }), 'fabric');
    box(g, W, 0.28, L, 0, 0.16, 0, w); box(g, W - 0.06, 0.22, L - 0.12, 0, 0.41, 0.03, white); box(g, W - 0.04, 0.06, L * 0.62, 0, 0.53, L * 0.17, prim(a, tag(mat('#c9b79c', { roughness: 0.95 }), 'fabric')));
    box(g, W + 0.1, 1.0, 0.08, 0, 0.5, -L / 2 + 0.04, prim(a, M.fabric())); const n = W > 1.3 ? 2 : 1; for (let i = 0; i < n; i++) box(g, W / n - 0.18, 0.12, 0.38, (i - (n - 1) / 2) * W / n, 0.58, -L / 2 + 0.32, white); } },
  wardrobe: { hide: true, build: (g, a, it) => { const W = Math.max(0.5, it.sx || 1.8), D = Math.max(0.4, Math.min(0.7, it.sz || 0.6)), b = prim(a, tag(mat('#ece6dc', { roughness: 0.6 }), 'wood')); box(g, W, 2.3, D, 0, 1.15, 0, b);
    const n = Math.max(2, Math.round(W / 0.5)); for (let i = 1; i < n; i++) box(g, 0.01, 2.2, 0.01, -W / 2 + W * i / n, 1.15, D / 2 + 0.005, M.black()); } },
  kitchen: { hide: true, build: (g, a, it) => { const W = Math.max(0.6, it.sx || 2.4), D = Math.max(0.5, Math.min(0.75, it.sz || 0.6)), b = prim(a, tag(mat('#f1efeb', { roughness: 0.5 }), 'wood'));
    box(g, W, 0.86, D, 0, 0.45, 0, b); box(g, W + 0.02, 0.04, D + 0.02, 0, 0.9, 0.01, M.marble()); box(g, W, 0.7, 0.35, 0, 1.85, -D / 2 + 0.175, b); } },
  island: { hide: true, build: (g, a, it) => { const W = Math.max(0.8, it.sx || 2.2), D = Math.max(0.6, it.sz || 1.0); box(g, W - 0.1, 0.86, D - 0.2, 0, 0.45, -0.05, prim(a, tag(mat('#f1efeb', { roughness: 0.5 }), 'wood'))); box(g, W, 0.05, D, 0, 0.905, 0, M.marble()); } },
  tv: { hide: true, build: (g, a, it) => { const W = Math.max(0.8, it.sx || 1.8); box(g, W, 0.45, 0.42, 0, 0.225, 0, prim(a, M.walnut())); box(g, Math.min(2, W * 0.75), 0.62, 0.05, 0, 1.15, -0.15, M.black()); } },
  toilet: { hide: true, build: (g) => { const w = tag(mat('#f7f7f5', { roughness: 0.2 }), 'marble'); box(g, 0.38, 0.4, 0.18, 0, 0.6, -0.26, w); const c = cyl(g, 0.19, 0.16, 0.4, 0, 0.2, 0.02, w, 20); c.scale.z = 1.3; } },
  basin: { hide: true, build: (g, a, it) => { const W = Math.max(0.5, it.sx || 0.9), D = Math.max(0.4, Math.min(0.6, it.sz || 0.5)); box(g, W, 0.55, D, 0, 0.55, 0, prim(a, M.walnut())); box(g, W + 0.02, 0.04, D + 0.02, 0, 0.84, 0, M.marble());
    cyl(g, 0.18, 0.14, 0.1, 0, 0.91, 0.02, tag(mat('#ffffff', { roughness: 0.15 }), 'marble'), 24); box(g, Math.min(W, 1.0), 0.75, 0.02, 0, 1.4, -D / 2 + 0.01, tag(mat('#cfe0e8', { roughness: 0.05, metalness: 0.9 }), 'metal')); } },
  shower: { hide: true, build: (g, a, it) => { const W = Math.max(0.8, it.sx || 1.0), D = Math.max(0.8, it.sz || 1.0), gl = mat('#bfe3ef', { transparent: true, opacity: 0.25, roughness: 0.05 });
    box(g, W, 0.05, D, 0, 0.025, 0, tag(mat('#e9e6e0', { roughness: 0.4 }), 'stone')); const p = box(g, W, 2.0, 0.01, 0, 1.05, D / 2, gl); p.userData.noCollide = true; cyl(g, 0.12, 0.12, 0.02, W / 2 - 0.25, 2.1, -D / 2 + 0.25, M.black(), 16); } },
  bathtub: { hide: true, build: (g, a, it) => { const W = Math.max(1.4, it.sx || 1.7), D = Math.max(0.6, it.sz || 0.75), w = tag(mat('#fbfbf9', { roughness: 0.15 }), 'marble'); box(g, W, 0.55, D, 0, 0.275, 0, w); box(g, W - 0.16, 0.02, D - 0.16, 0, 0.56, 0, mat('#d9e9ef', { roughness: 0.1 })); } },
  sunbed: { hide: true, build: (g, a) => { const f = prim(a, tag(mat('#f2efe8', { roughness: 0.9 }), 'fabric')); box(g, 0.7, 0.12, 1.4, 0, 0.3, 0.25, f); const b = box(g, 0.7, 0.1, 0.65, 0, 0.55, -0.6, f); b.rotation.x = -0.6; box(g, 0.74, 0.22, 1.9, 0, 0.12, -0.05, M.walnut()); } },
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
