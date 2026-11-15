// 3D viewer for project drawings: IFC (Revit / Archicad), GLB / glTF (SketchUp, Blender…) and AutoCAD DXF plans.
// Orbit around the building or walk inside it (mouse + keyboard on a computer, joystick + drag on a phone).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from './vendor/three-mesh-bvh/index.module.js';
import { readSheet, analyzeSet, recognizeFurniture } from './plan2d.js?v=50';
import { LIB, COLORS, buildItem } from './furniture3d.js?v=50';
import { Look, dressModel } from './look3d.js?v=51';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- element categories ---------- */
export const CATS = {
  arch: { l: 'معماري (جدران، أبواب، شبابيك، أرضيات)', c: '#d9d6cf' },
  str: { l: 'إنشائي (أعمدة، جسور، قواعد)', c: '#9aa3ab' },
  hvac: { l: 'تكييف وتهوية', c: '#2f7fc1' },
  elec: { l: 'كهرباء وإنارة', c: '#e0a400' },
  plumb: { l: 'صحي ومواسير', c: '#2e9d6a' },
  fire: { l: 'إطفاء وإنذار حريق', c: '#c8102e' },
  mep: { l: 'أنظمة أخرى (MEP)', c: '#7e57c2' },
  furn: { l: 'أثاث', c: '#a0785a' },
  other: { l: 'عناصر أخرى', c: '#b8b8b8' }
};
const TYPE_RULES = [
  ['fire', /^IFC(FIRESUPPRESSION|ALARM|SPRINKLER)/],
  ['hvac', /^IFC(DUCT|AIRTERMINAL|FAN|DAMPER|UNITARYEQUIPMENT|CHILLER|COIL|AIRTOAIR|BOILER|COOLINGTOWER|HUMIDIFIER|EVAPORAT|CONDENSER|COMPRESSOR|HEATEXCHANGER|SPACEHEATER|FILTER|AIRTERMINALBOX)/],
  ['elec', /^IFC(CABLE|LIGHTFIXTURE|LAMP|OUTLET|SWITCHINGDEVICE|ELECTRIC|JUNCTIONBOX|PROTECTIVEDEVICE|TRANSFORMER|MOTOR|COMMUNICATIONSAPPLIANCE|AUDIOVISUAL|SOLARDEVICE)/],
  ['plumb', /^IFC(PIPE|SANITARYTERMINAL|VALVE|PUMP|TANK|WASTETERMINAL|STACKTERMINAL|INTERCEPTOR|FLOWMETER)/],
  ['str', /^IFC(BEAM|COLUMN|FOOTING|PILE|REINFORC|TENDON|MEMBER)/],
  ['furn', /^IFC(FURNISHING|FURNITURE|SYSTEMFURNITURE)/],
  ['arch', /^IFC(WALL|DOOR|WINDOW|SLAB|ROOF|STAIR|RAMP|RAILING|COVERING|CURTAINWALL|PLATE|CHIMNEY|SHADINGDEVICE|BUILDINGELEMENTPART)/],
  ['fire', /^IFC(SENSOR|ACTUATOR|CONTROLLER)/],
  ['mep', /^IFC(FLOW|ENERGYCONVERSION|DISTRIBUTION)/]
];
const SYSTEM_RULES = [
  ['fire', /fire|sprink|حريق|إطفاء|اطفاء/i],
  ['hvac', /hvac|supply air|return air|exhaust|fresh air|duct|chilled|تكييف|تهوية/i],
  ['plumb', /domestic|water|drain|sanitary|waste|vent|plumb|sewer|storm|صرف|مياه|صحي/i],
  ['elec', /elec|power|light|lighting|low current|كهرب|إنارة|انارة/i]
];
const AR_TYPE = {
  IFCWALL: 'جدار', IFCWALLSTANDARDCASE: 'جدار', IFCDOOR: 'باب', IFCWINDOW: 'شباك', IFCSLAB: 'بلاطة / أرضية', IFCROOF: 'سقف', IFCSTAIR: 'درج', IFCSTAIRFLIGHT: 'درج', IFCRAILING: 'درابزين',
  IFCCOVERING: 'تكسية / تشطيب', IFCCURTAINWALL: 'واجهة زجاجية', IFCBEAM: 'جسر (بيم)', IFCCOLUMN: 'عمود', IFCFOOTING: 'قاعدة', IFCPILE: 'خازوق', IFCMEMBER: 'عنصر إنشائي',
  IFCDUCTSEGMENT: 'دكت تكييف', IFCDUCTFITTING: 'وصلة دكت', IFCAIRTERMINAL: 'فتحة تكييف (جريل)', IFCUNITARYEQUIPMENT: 'وحدة تكييف', IFCFAN: 'مروحة',
  IFCPIPESEGMENT: 'ماسورة', IFCPIPEFITTING: 'وصلة مواسير', IFCSANITARYTERMINAL: 'أدوات صحية', IFCVALVE: 'محبس', IFCPUMP: 'مضخة', IFCTANK: 'خزان',
  IFCLIGHTFIXTURE: 'إنارة', IFCOUTLET: 'مقبس (فيش)', IFCSWITCHINGDEVICE: 'مفتاح', IFCCABLECARRIERSEGMENT: 'مسار كيابل', IFCELECTRICDISTRIBUTIONBOARD: 'لوحة كهرباء',
  IFCFIRESUPPRESSIONTERMINAL: 'رشاش إطفاء', IFCALARM: 'إنذار', IFCSENSOR: 'حساس', IFCFURNISHINGELEMENT: 'أثاث', IFCFURNITURE: 'أثاث', IFCBUILDINGELEMENTPROXY: 'عنصر',
  IFCFLOWSEGMENT: 'مسار (MEP)', IFCFLOWTERMINAL: 'طرف (MEP)', IFCFLOWFITTING: 'وصلة (MEP)', IFCFLOWCONTROLLER: 'متحكم (MEP)'
};
const catOfType = t => { for (const [c, re] of TYPE_RULES) if (re.test(t)) return c; return 'other'; };

/* ---------- DXF ---------- */
// A small DXF reader: lines, polylines, arcs and circles, with block inserts expanded. Returns segments in drawing units.
export function parseDxf(text) {
  const raw = text.split(/\r\n|\r|\n/), pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([parseInt(raw[i], 10), raw[i + 1].trim()]);
  let units = 0, i = 0;
  const blocks = {}, top = [];
  const readEntity = () => { // pairs[i] is [0, TYPE]
    const e = { type: pairs[i][1], layer: '0', v: [] }; i++;
    while (i < pairs.length && pairs[i][0] !== 0) {
      const [c, v] = pairs[i];
      if (c === 8) e.layer = v;
      else if (c === 10) e.v.push([+v, 0]);
      else if (c === 20 && e.v.length) e.v[e.v.length - 1][1] = +v;
      else if (c === 11) e.x2 = +v; else if (c === 21) e.y2 = +v;
      else if (c === 40) e.r = +v; else if (c === 50) e.a1 = +v; else if (c === 51) e.a2 = +v;
      else if (c === 70) e.flag = +v; else if (c === 2) e.name = v;
      else if (c === 41) e.sx = +v; else if (c === 42) e.sy = +v;
      i++;
    }
    return e;
  };
  const readList = (until, out) => {
    while (i < pairs.length) {
      if (pairs[i][0] !== 0) { i++; continue; }
      const t = pairs[i][1];
      if (until.includes(t)) return;
      if (t === 'POLYLINE') {
        const pl = readEntity(); pl.type = 'LWPOLYLINE'; pl.v = [];
        while (i < pairs.length && pairs[i][1] === 'VERTEX') { const vx = readEntity(); if (vx.v[0]) pl.v.push(vx.v[0]); }
        if (i < pairs.length && pairs[i][1] === 'SEQEND') readEntity();
        out.push(pl);
      } else out.push(readEntity());
    }
  };
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 9 && v === '$INSUNITS') { units = parseInt(pairs[i + 1][1], 10) || 0; i += 2; continue; }
    if (c === 0 && v === 'SECTION' && pairs[i + 1] && pairs[i + 1][1] === 'BLOCKS') {
      i += 2;
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
        if (pairs[i][0] === 0 && pairs[i][1] === 'BLOCK') {
          const b = readEntity(), list = []; readList(['ENDBLK'], list);
          blocks[b.name] = { base: b.v[0] || [0, 0], list };
          if (i < pairs.length) readEntity(); // ENDBLK
        } else i++;
      }
      continue;
    }
    if (c === 0 && v === 'SECTION' && pairs[i + 1] && pairs[i + 1][1] === 'ENTITIES') { i += 2; readList(['ENDSEC'], top); continue; }
    i++;
  }
  const segs = [];
  const emit = (list, m, layerOver, depth) => {
    const P = p => [m[0] * p[0] + m[1] * p[1] + m[2], m[3] * p[0] + m[4] * p[1] + m[5]];
    const sc = Math.sqrt(Math.abs(m[0] * m[4] - m[1] * m[3])) || 1;
    for (const e of list) {
      const layer = e.layer === '0' && layerOver ? layerOver : e.layer;
      if (e.type === 'LINE' && e.v[0]) { const a = P(e.v[0]), b = P([e.x2, e.y2]); segs.push({ layer, a, b }); }
      else if (e.type === 'LWPOLYLINE' && e.v.length > 1) {
        const pts = e.v.map(P); for (let k = 0; k + 1 < pts.length; k++) segs.push({ layer, a: pts[k], b: pts[k + 1] });
        if (e.flag & 1) segs.push({ layer, a: pts[pts.length - 1], b: pts[0] });
      } else if ((e.type === 'ARC' || e.type === 'CIRCLE') && e.v[0] && e.r) {
        const c0 = e.v[0], a1 = (e.type === 'CIRCLE' ? 0 : e.a1) * Math.PI / 180; let a2 = (e.type === 'CIRCLE' ? 360 : e.a2) * Math.PI / 180; if (a2 <= a1) a2 += Math.PI * 2;
        const n = Math.max(4, Math.ceil((a2 - a1) / (Math.PI / 12))); let prev = null;
        for (let k = 0; k <= n; k++) { const a = a1 + (a2 - a1) * k / n, p = P([c0[0] + e.r * Math.cos(a), c0[1] + e.r * Math.sin(a)]); if (prev) segs.push({ layer, a: prev, b: p, arc: true, r: e.r * sc }); prev = p; }
      } else if (e.type === 'INSERT' && blocks[e.name] && depth < 5 && e.v[0]) {
        const b = blocks[e.name], sx = e.sx || 1, sy = e.sy || 1, r = (e.a1 || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), t = e.v[0];
        // local = R*S*(p - base) + t
        const l = [cs * sx, -sn * sy, t[0] - (cs * sx * b.base[0] - sn * sy * b.base[1]), sn * sx, cs * sy, t[1] - (sn * sx * b.base[0] + cs * sy * b.base[1])];
        const mm = [m[0] * l[0] + m[1] * l[3], m[0] * l[1] + m[1] * l[4], m[0] * l[2] + m[1] * l[5] + m[2], m[3] * l[0] + m[4] * l[3], m[3] * l[1] + m[4] * l[4], m[3] * l[2] + m[4] * l[5] + m[5]];
        emit(b.list, mm, layer === '0' ? layerOver : layer, depth + 1);
      }
    }
  };
  emit(top, [1, 0, 0, 0, 1, 0], null, 0);
  return { units, segs };
}
const UNIT_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };
export function guessRoles(segs) {
  const count = {}; segs.forEach(s => { const c = count[s.layer] = count[s.layer] || { n: 0, arcs: 0 }; c.n++; if (s.arc) c.arcs++; });
  const roles = {};
  Object.keys(count).forEach(l => {
    roles[l] = /door|باب|ابواب|أبواب/i.test(l) ? 'door' : /win|glaz|شباك|نافذ|نوافذ/i.test(l) ? 'window' : /wall|جدار|حائط|حوائط|mur|block|طابوق/i.test(l) ? 'wall' : /col|عمود|اعمدة|أعمدة/i.test(l) ? 'wall' : 'skip';
    if (/dim|text|txt|hatch|furn|grid|axis|anno|title|frame|border|نص|أبعاد|ابعاد|أثاث|اثاث/i.test(l)) roles[l] = 'skip';
  });
  if (!Object.values(roles).includes('wall')) {
    const best = Object.keys(count).filter(l => roles[l] === 'skip').sort((a, b) => (count[b].n - count[b].arcs) - (count[a].n - count[a].arcs))[0];
    if (best) roles[best] = 'wall';
  }
  return { roles, count };
}
function guessUnits(units, segs) {
  if (UNIT_M[units]) return units;
  let mx = 0; segs.forEach(s => { mx = Math.max(mx, Math.abs(s.a[0] - s.b[0]), Math.abs(s.a[1] - s.b[1])); });
  let w = 0; const xs = segs.flatMap(s => [s.a[0], s.b[0]]); if (xs.length) w = Math.max(...xs) - Math.min(...xs);
  return w > 500 ? 4 : w > 60 ? 5 : 6;
}

/* ---------- AutoCAD-plotted PDF (vector paths on CAD layers) ---------- */
export async function extractPdfPlan(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const oc = await doc.getOptionalContentConfig(); const gg = (oc && oc.getGroups && oc.getGroups()) || {}; const names = {}; Object.keys(gg).forEach(id => { names[id] = gg[id].name; });
  const ol = await page.getOperatorList(), O = pdfjs.OPS;
  let text = ''; try { text = (await page.getTextContent()).items.map(x => x.str).join(' '); } catch (e) { }
  let ctm = [1, 0, 0, 1, 0, 0], sub = [], cur = null; const st = [], mc = [], paths = [];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const T = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const layer = () => { for (let i = mc.length - 1; i >= 0; i--) if (mc[i]) return mc[i]; return '(بدون طبقة)'; };
  const fillOps = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]), paintOps = new Set([O.stroke, O.closeStroke, ...fillOps]);
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === O.save) st.push(ctm); else if (f === O.restore) ctm = st.pop() || ctm;
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.beginMarkedContentProps) mc.push(a[0] === 'OC' && a[1] && a[1].id ? (names[a[1].id] || null) : null);
    else if (f === O.beginMarkedContent) mc.push(null);
    else if (f === O.endMarkedContent) mc.pop();
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
      const filled = fillOps.has(f), L = layer();
      sub.forEach(s => { if (s.length > 1) paths.push({ layer: L, pts: s, closed: !!s.closed || f === O.closeStroke || f === O.closeFillStroke || f === O.closeEOFillStroke, filled, curve: !!s.curve }); });
      sub = []; cur = null;
    } else if (f === O.endPath) { sub = []; cur = null; }
  }
  return { doc, page, names, paths, text };
}
export const PDF_ROLES = { wall: 'جدران', column: 'أعمدة', low: 'جلسات وأحواض منخفضة', window: 'زجاج / شبابيك', door: 'أبواب', plant: 'أشجار ونباتات', furniture: 'أثاث مجسّم', plan: 'رسم على الأرضية', skip: 'إخفاء' };
export function guessPdfRoles(layers) {
  const r = {};
  layers.forEach(l => { const n = l.toLowerCase();
    r[l] = /curt|window|menuiserie - alu|glaz|vitr|fen[eê]tre|glass|زجاج|شباك/.test(n) ? 'window'
      : /door|porte|menuiserie - bois|باب/.test(n) ? 'door'
      : /column|colonne|poteau|struct_member|عمود/.test(n) ? 'column'
      : /verdure|arbre|tree|planter|شجر|نبات/.test(n) ? 'plant'
      : /poch/.test(n) && !/ma[cç]on/.test(n) || /bench|banc|planter box|jardini[eè]re|جلسة|حوض/.test(n) ? 'low'
      : /wall|wals|poch|gypsum|mur|cloison|ma[cç]on|جدار|حائط/.test(n) ? 'wall'
      : /am[ée]nagement(?!.*piscine)|ffe|furn|mobilier|أثاث|اثاث/.test(n) ? 'furniture'
      : /floor|sol|revetement|jardin|am[ée]nagement|storage|piscine|water|cach[ée]|ارضي|أرضي/.test(n) ? 'plan'
      : 'skip'; });
  return r;
}

const tag = (m, look) => { m.userData.look = look; return m; };
/* ---------- viewer ---------- */
export class Viewer {
  constructor(opts) {
    this.opts = opts || {};
    this.el = document.createElement('div'); this.el.className = 'v3';
    this.el.innerHTML = '<div class="v3-stage"><div class="v3-msg">جاري تجهيز العارض…</div><div class="v3-joy" hidden><i></i></div><canvas class="v3-map" hidden title="مكانك على المخطط · اضغط على أي مكان في الخريطة عشان تنتقل له"></canvas><div class="v3-hint" hidden></div><div class="v3-info" hidden></div></div><aside class="v3-side"></aside>';
    this.stage = this.el.querySelector('.v3-stage'); this.side = this.el.querySelector('.v3-side');
    this.mapEl = this.el.querySelector('.v3-map');
    this.msgEl = this.el.querySelector('.v3-msg'); this.infoEl = this.el.querySelector('.v3-info'); this.hintEl = this.el.querySelector('.v3-hint');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.stage.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#dce8f2');
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 5000);
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x9a8f80, 1.5));
    const sun = this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(30, 60, 20); this.scene.add(sun);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.model = new THREE.Group(); this.scene.add(this.model);
    // daylight sky, reflections and (on computers) soft shadows in corners and under furniture
    this.look = new Look(this); let hq = !matchMedia('(pointer:coarse)').matches; try { const q = localStorage.getItem('v3-hq'); if (q) hq = q === '1'; } catch (e) { } this.hq = hq;
    // furniture and landscape pieces the user adds (saved with the document)
    this.items = (this.opts.items || []).filter(it => it && LIB[it.t]); this.itemGroup = new THREE.Group(); this.scene.add(this.itemGroup); this.itemMeshes = []; this.tool = null; this.toolColor = '';
    // a soft light that travels with the walker, so rooms under a roof are not left in the dark
    this.head = new THREE.PointLight(0xfff3e0, 0, 16, 1); this.camera.add(this.head); this.scene.add(this.camera);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement); this.orbit.enableDamping = true;
    this.orbit.zoomToCursor = true; this.orbit.screenSpacePanning = true; // zoom goes where the mouse points, not to the middle
    this.mode = 'orbit'; this.keys = {}; this.yaw = 0; this.pitch = 0; this.move = { x: 0, y: 0 };
    this.catOn = {}; this.storeys = []; this.storeySel = 'all'; this.meshes = [];
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.clock = new THREE.Clock(); this.alive = true;
    this._bind();
    this.resize();
    const loop = () => { if (!this.alive) return; requestAnimationFrame(loop); this._tick(); };
    loop();
  }
  msg(t) { this.msgEl.hidden = !t; this.msgEl.textContent = t || ''; }
  resize() {
    const r = this.stage.getBoundingClientRect(), w = Math.max(200, r.width), h = Math.max(200, r.height);
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); if (this.look) this.look.resize(); this.redraw = true;
  }
  dispose() {
    this.alive = false; window.removeEventListener('resize', this._onResize); document.removeEventListener('keydown', this._kd); document.removeEventListener('keyup', this._ku);
    document.removeEventListener('pointerlockchange', this._plc); document.removeEventListener('mousemove', this._mm);
    this.model.traverse(o => { if (o.geometry) { o.geometry.disposeBoundsTree && o.geometry.boundsTree && o.geometry.disposeBoundsTree(); o.geometry.dispose(); } if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
    document.removeEventListener('keydown', this._ki);
    this.look.dispose(); this.renderer.dispose(); this.el.remove();
  }
  _bind() {
    this._onResize = () => this.resize(); window.addEventListener('resize', this._onResize);
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.stage);
    this._kd = e => { if (this.mode !== 'walk' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return; this.keys[e.code] = true; if (/Arrow|Space/.test(e.code)) e.preventDefault(); };
    this._ku = e => { this.keys[e.code] = false; };
    document.addEventListener('keydown', this._kd); document.addEventListener('keyup', this._ku);
    this._ki = e => { if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName) || !this.el.isConnected) return;
      if (e.code === 'Escape' && (this.tool || this.moving)) { this.tool = null; this.moving = null; this._hint(); this._libMark(); }
      else if (this.sel && e.code === 'KeyR' && this.mode !== 'walk') { this._itemAct('rot', Math.PI / 12); }
      else if (this.sel && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); this._itemAct('del'); } };
    document.addEventListener('keydown', this._ki);
    const cv = this.renderer.domElement;
    ['pointerdown', 'pointerup', 'wheel', 'click'].forEach(ev => this.stage.addEventListener(ev, () => { this.redraw = true; }, { passive: true }));
    this._plc = () => { this.locked = document.pointerLockElement === cv; this._hint(); };
    this._mm = e => { if (this.locked) this._look(e.movementX, e.movementY, 0.0022); };
    document.addEventListener('pointerlockchange', this._plc); document.addEventListener('mousemove', this._mm);
    let down = null;
    cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now() }; if (this.mode === 'walk' && e.pointerType === 'touch') cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (this.mode === 'walk' && e.pointerType !== 'mouse' && down && down.id === e.pointerId) { this._look(e.clientX - down.x, e.clientY - down.y, 0.005); down.x = e.clientX; down.y = e.clientY; down.moved = true; } });
    cv.addEventListener('pointerup', e => {
      if (!down) return; const moved = down.moved || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5; const d0 = down; down = null;
      if (this.mode === 'walk' && e.pointerType === 'mouse' && !this.locked && !this.tool && !this.moving) { cv.requestPointerLock && cv.requestPointerLock(); return; }
      if (!moved && Date.now() - d0.t < 400) this._pick(e);
    });
    // double-click (or double-tap) a room: fly the view to it
    cv.addEventListener('dblclick', e => {
      if (this.mode === 'walk' || this.tool || this.moving) return;
      const r = cv.getBoundingClientRect(); this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera); this.ray.far = Infinity;
      const h = this.ray.intersectObjects(this.meshes.filter(m => m.visible && !m.userData.ground), false)[0]; if (!h) return;
      const from = { t: this.orbit.target.clone(), c: this.camera.position.clone() }, to = { t: h.point.clone(), c: h.point.clone().add(this.camera.position.clone().sub(h.point).multiplyScalar(0.45)) };
      const t0 = performance.now(), step = () => { const k = Math.min(1, (performance.now() - t0) / 450), s = k * k * (3 - 2 * k);
        this.orbit.target.lerpVectors(from.t, to.t, s); this.camera.position.lerpVectors(from.c, to.c, s); if (k < 1) requestAnimationFrame(step); };
      step();
    });
    // the small map: tap a spot to go there
    this.mapEl.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); const m = this.mapView; if (!m || this.mode !== 'walk') return;
      const r = this.mapEl.getBoundingClientRect(), p = this.camera.position, x = m.x0 + (e.clientX - r.left) / r.width * m.w, z = m.z0 + (e.clientY - r.top) / r.height * m.h, g0 = this._groundAt(p), floor = g0 != null ? g0 : p.y - 1.6;
      // land on open floor at this level, a step away if the spot itself is a wall, a seat or a planter
      for (let d = 0; d <= 2; d += 0.25) for (let i = 0; i < (d ? 12 : 1); i++) { const q = new THREE.Vector3(x + Math.cos(i * Math.PI / 6) * d, p.y, z + Math.sin(i * Math.PI / 6) * d), g = this._groundAt(q);
        if (g == null || (g < floor + 0.3 && g > floor - 1.2)) { p.x = q.x; p.z = q.z; if (g != null) p.y = g + 1.6; this.vy = 0; return; } } });
    // phone joystick
    const joy = this.el.querySelector('.v3-joy'), knob = joy.querySelector('i'); let jid = null, jc = null;
    joy.addEventListener('pointerdown', e => { jid = e.pointerId; const r = joy.getBoundingClientRect(); jc = { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 }; joy.setPointerCapture(e.pointerId); e.preventDefault(); });
    joy.addEventListener('pointermove', e => { if (e.pointerId !== jid) return; let dx = e.clientX - jc.x, dy = e.clientY - jc.y; const d = Math.hypot(dx, dy); if (d > jc.R) { dx *= jc.R / d; dy *= jc.R / d; } knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; this.move = { x: dx / jc.R, y: -dy / jc.R }; });
    const end = () => { jid = null; knob.style.transform = ''; this.move = { x: 0, y: 0 }; };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  }
  _look(dx, dy, k) { this.yaw -= dx * k; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * k)); }
  _hint() {
    if (this.tool || this.moving) { this.hintEl.hidden = false; this.hintEl.textContent = this.moving ? 'اضغط المكان الجديد للعنصر · Esc للإلغاء' : 'اضغط على الأرضية عشان تحط: ' + LIB[this.tool].l + ' · تقدر تحط أكثر من واحد · Esc للإنهاء'; return; }
    const touch = matchMedia('(pointer:coarse)').matches;
    if (this.mode !== 'walk') { this.hintEl.hidden = true; return; }
    this.hintEl.hidden = false;
    this.hintEl.textContent = touch ? 'حرّك الدائرة للمشي، واسحب بإصبعك على الشاشة عشان تلتفت.' : this.locked ? 'W A S D أو الأسهم للمشي · الماوس للالتفات · Shift للركض · Esc للخروج' : 'اضغط على المجسم عشان تبدأ المشي (الماوس للالتفات).';
  }
  /* ----- modes ----- */
  setMode(m) {
    if (!this.box) return;
    this.mode = m; const c = this.box.getCenter(new THREE.Vector3()), s = this.box.getSize(new THREE.Vector3()), R = Math.max(s.x, s.y, s.z);
    this.el.querySelector('.v3-joy').hidden = !(m === 'walk' && matchMedia('(pointer:coarse)').matches);
    if (document.pointerLockElement) document.exitPointerLock();
    this.head.intensity = m === 'walk' ? 2.2 : 0; this.mapEl.hidden = m !== 'walk';
    if (m === 'walk') {
      this.orbit.enabled = false;
      // Start just outside the front of the building, at eye height on the lowest floor, facing it.
      const st = this._startPoint(this.set && this.storeySel !== 'all' && this.storeys[+this.storeySel] ? this.storeys[+this.storeySel].elev : null);
      this.camera.position.copy(st.pos); this.yaw = st.yaw; this.pitch = 0; this.vy = 0;
      if (this.storeys && this.storeys.length) this.applyVis();
      this._mapMake();
    } else {
      this.orbit.enabled = true;
      if (m === 'top') { this.camera.position.set(c.x, this.box.max.y + R * 1.2, c.z + 0.001); this.orbit.target.copy(c); }
      else { this.camera.position.set(c.x + R * 0.9, c.y + R * 0.7, c.z + R * 1.1); this.orbit.target.copy(c); }
      this.orbit.update();
    }
    if (this.storeys && this.storeys.length) this.applyVis();
    this._hint(); this._sideMode();
  }
  // A spot inside the building on the lowest floor, away from walls; otherwise just outside the front.
  _startPoint(y0) {
    const b = this.box, base = y0 != null ? y0 : b.min.y, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()), cols = this._colliders();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => new THREE.Vector3(x, 0, z)), cand = [];
    for (let i = -9; i <= 9; i++) for (let j = -9; j <= 9; j++) cand.push([c.x + s.x * i / 20, c.z + s.z * j / 20]);
    cand.sort((p, q) => Math.hypot(p[0] - c.x, p[1] - c.z) - Math.hypot(q[0] - c.x, q[1] - c.z));
    // the roomiest indoor spot (walls all round and a ceiling above), looking down its longest view
    let pick = null; const up = new THREE.Vector3(0, 1, 0);
    for (const [x, z] of cand) {
      const g = this._groundAt(new THREE.Vector3(x, base + 1.2, z)); if (g == null || g > base + 1.2 || g < base - 0.3) continue;
      let ok = true, far = 0, best = 0, near = Infinity;
      for (const [k, d] of dirs.entries()) {
        this.ray.set(new THREE.Vector3(x, g + 1.0, z), d); this.ray.far = 40;
        const h = this.ray.intersectObjects(cols, false)[0];
        if (!h || h.distance < 0.7) { ok = false; break; } near = Math.min(near, h.distance); if (h.distance > far) { far = h.distance; best = k; }
      }
      if (!ok) continue;
      this.ray.set(new THREE.Vector3(x, g + 1.0, z), up); this.ray.far = 8; const roofed = this.ray.intersectObjects(cols, false).length > 0;
      const score = near + (roofed ? 3 : 0) - Math.hypot(x - c.x, z - c.z) * 0.02;
      if (!pick || score > pick.score) pick = { score, pos: new THREE.Vector3(x, g + 1.6, z), yaw: [-Math.PI / 2, Math.PI / 2, Math.PI, 0][best] };
    }
    if (pick) return pick;
    return { pos: new THREE.Vector3(c.x, b.min.y + 1.6, b.max.z + 2.5), yaw: 0 };
  }
  _colliders() { return this.meshes.filter(m => m.visible && !m.userData.noCollide).concat(this.itemMeshes.filter(m => !m.userData.noCollide && m.parent && m.parent.parent && m.parent.parent.visible !== false && m.parent.visible !== false)); }
  _groundAt(p) {
    this.ray.set(new THREE.Vector3(p.x, p.y + 0.4, p.z), new THREE.Vector3(0, -1, 0)); this.ray.far = 6;
    const h = this.ray.intersectObjects(this._colliders(), false)[0]; return h ? h.point.y : null;
  }
  _blocked(from, dir, dist) {
    for (const dy of [-0.9, -0.2]) { // knee and chest height
      this.ray.set(new THREE.Vector3(from.x, from.y + dy, from.z), dir); this.ray.far = dist + 0.3;
      if (this.ray.intersectObjects(this._colliders(), false).length) return true;
    }
    return false;
  }
  _tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.mode === 'walk' && this.box) {
      const k = this.keys, f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + this.move.y, r = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + this.move.x;
      const sp = (k.ShiftLeft || k.ShiftRight ? 4.2 : 1.9) * dt;
      const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), rt = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const mv = fw.multiplyScalar(f).add(rt.multiplyScalar(r)); const len = mv.length();
      const p = this.camera.position;
      if (len > 0.01) {
        mv.normalize();
        const dx = new THREE.Vector3(Math.sign(mv.x), 0, 0), dz = new THREE.Vector3(0, 0, Math.sign(mv.z));
        if (!this._blocked(p, mv, sp)) p.addScaledVector(mv, sp * Math.min(1, len));
        else { // slide along walls
          if (Math.abs(mv.x) > 0.1 && !this._blocked(p, dx, sp)) p.x += mv.x * sp;
          if (Math.abs(mv.z) > 0.1 && !this._blocked(p, dz, sp)) p.z += mv.z * sp;
        }
      }
      if (k.KeyE || k.PageUp) p.y += 2 * dt; if (k.KeyQ || k.PageDown) p.y -= 2 * dt;
      if (!(k.KeyE || k.KeyQ || k.PageUp || k.PageDown)) {
        const g = this._groundAt(p);
        if (g != null && g > p.y - 1.6 - 0.55) p.y += (g + 1.6 - p.y) * Math.min(1, dt * 12); // steps and stairs
        else if (g != null) { this.vy = (this.vy || 0) + 9.8 * dt; p.y = Math.max(g + 1.6, p.y - this.vy * dt); if (p.y === g + 1.6) this.vy = 0; }
      }
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      if (this.map && Math.abs(p.y - 0.4 - this.map.cut) > 1.2 && performance.now() - this.map.t > 800) this._mapMake(); // another floor: redraw its plan
      this._mapDraw();
    } else this.orbit.update();
    // draw only when something moves (or twice a second), so the realistic mode stays light when you just look
    const cm = this.camera.matrixWorld.elements, key = cm.join(',') + this.camera.projectionMatrix.elements[0], now = performance.now(), moving = key !== this._lastKey;
    if (this.dirty) this.renderer.shadowMap.needsUpdate = true; // the sun does not move: redo its shadows only when the model or what is shown changes
    if (moving || this.dirty || this.redraw) { this._lastKey = key; this.dirty = false; this.redraw = false; this._still = false; this._movedAt = now; this.look.render(true); this._pace(now); }
    else if (!this._still && now - this._movedAt > 180) { this._still = true; this.look.render(false); } // stopped: one full-quality frame
    else if (now - (this._movedAt || 0) > 3000 && now - (this._lastDraw || 0) > 3000) { this._lastDraw = now; this.look.render(false); }
  }
  // frame pacing while moving: if frames keep taking longer than ~40 ms, draw fewer pixels
  _pace(now) {
    const p = this._pf || (this._pf = { t: now, n: 0, sum: 0 }), dt = now - p.t; p.t = now;
    if (dt > 200) { p.n = 0; p.sum = 0; return; } p.n++; p.sum += dt;
    if (p.n >= 30) { if (p.sum / p.n > 40) this.look.slower(); p.n = 0; p.sum = 0; }
  }
  /* ----- small map while walking: the plan seen from above, cut a little below eye level, with you on it ----- */
  _mapMake() {
    const b = this.box; if (!b || b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()), hx = s.x / 2 * 1.04 + 0.5, hz = s.z / 2 * 1.04 + 0.5, cut = this.camera.position.y - 0.4;
    const S = Math.min(2048, Math.max(640, Math.ceil(Math.max(hx, hz) * 2 * 20))), W = hx >= hz ? S : Math.round(S * hx / hz), H = hx >= hz ? Math.round(S * hz / hx) : S;
    const cam = new THREE.OrthographicCamera(-hx, hx, hz, -hz, 0.1, s.y + 400); cam.up.set(0, 0, -1); cam.position.set(c.x, b.max.y + 100, c.z); cam.lookAt(c.x, b.min.y, c.z);
    const r = this.renderer, size = r.getSize(new THREE.Vector2()), bg = this.scene.background, head = this.head.intensity, hl = this.hl, sun = this.sun.intensity, vis = [];
    const hemi = this.scene.children.find(o => o.isHemisphereLight), hemiI = hemi ? hemi.intensity : 0;
    const dark = this._mapMat || (this._mapMat = new THREE.MeshBasicMaterial({ color: '#3b3b3b', side: THREE.DoubleSide, depthTest: false }));
    r.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cut)]; this.look.sky.visible = false; this.scene.background = new THREE.Color('#f4f1ea'); this.head.intensity = 0; this.sun.intensity = 0; if (hemi) hemi.intensity = hemiI + sun * 0.8; if (hl) hl.visible = false;
    try {
      this.scene.traverse(o => { if (o.isMesh || o.isLine || o.isLineSegments) { vis.push([o, o.visible]); if (o.userData.ground) o.visible = false; } });
      r.setSize(W, H, false); r.render(this.scene, cam);
      // second pass: the walls standing at this height, filled dark like on a printed plan
      const bx = new THREE.Box3();
      vis.forEach(([o, v]) => { o.visible = v && ['walls', 'doors', 'windows'].includes(o.userData.cat) && (bx.setFromObject(o), bx.min.y <= cut && bx.max.y > cut - 1.2); });
      this.scene.overrideMaterial = dark; this.scene.background = null; r.autoClear = false; r.render(this.scene, cam);
      const base = this.mapBase || (this.mapBase = document.createElement('canvas')); base.width = W; base.height = H; base.getContext('2d').drawImage(r.domElement, 0, 0, W, H);
    } finally {
      vis.forEach(([o, v]) => { o.visible = v; }); this.scene.overrideMaterial = null; r.autoClear = true; if (hemi) hemi.intensity = hemiI;
      r.clippingPlanes = []; this.look.sky.visible = true; this.scene.background = bg; this.head.intensity = head; this.sun.intensity = sun; if (hl) hl.visible = true; r.setSize(size.x, size.y, false);
    }
    const zoom = Math.max(hx, hz) * 2 > 40; // a big site: the map follows you, about 32 m across
    this.mapEl.width = zoom ? 480 : Math.min(W, 640); this.mapEl.height = zoom ? 360 : Math.round(this.mapEl.width * H / W);
    this.map = { x0: c.x - hx, z0: c.z - hz, w: hx * 2, h: hz * 2, cut, zoom, t: performance.now() };
  }
  _mapDraw() {
    const m = this.map, cv = this.mapEl, base = this.mapBase; if (!m || cv.hidden || !base) return;
    const ctx = cv.getContext('2d'), p = this.camera.position, a = Math.atan2(-Math.cos(this.yaw), -Math.sin(this.yaw));
    let vw = m.w, vh = m.h, vx = m.x0, vz = m.z0;
    if (m.zoom) { vw = 32; vh = 24; vx = Math.max(m.x0, Math.min(m.x0 + m.w - vw, p.x - vw / 2)); vz = Math.max(m.z0, Math.min(m.z0 + m.h - vh, p.z - vh / 2)); }
    this.mapView = { x0: vx, z0: vz, w: vw, h: vh };
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, (vx - m.x0) / m.w * base.width, (vz - m.z0) / m.h * base.height, vw / m.w * base.width, vh / m.h * base.height, 0, 0, cv.width, cv.height);
    const u = (p.x - vx) / vw * cv.width, v = (p.z - vz) / vh * cv.height, R = cv.width / 7;
    ctx.fillStyle = 'rgba(255,90,31,.28)'; ctx.beginPath(); ctx.moveTo(u, v); ctx.arc(u, v, R, a - 0.55, a + 0.55); ctx.closePath(); ctx.fill(); // what you are looking at
    ctx.save(); ctx.translate(u, v); ctx.rotate(a); ctx.scale(cv.width / 512, cv.width / 512); ctx.fillStyle = '#ff5a1f'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-12, 13); ctx.lineTo(-5, 0); ctx.lineTo(-12, -13); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
  }
  /* ----- loading ----- */
  async load(buf, ext) {
    this.ext = ext;
    try {
      if (ext === 'ifc') await this._loadIfc(buf);
      else if (ext === 'glb' || ext === 'gltf') await this._loadGltf(buf);
      else if (ext === 'dxf') this._loadDxf(new TextDecoder().decode(buf));
      else if (ext === 'pdf') await this._loadPdf(buf);
      else throw new Error('نوع الملف غير مدعوم');
    } catch (e) { console.error(e); this.msg('ما قدرت أفتح الملف: ' + (e.message || e)); return false; }
    this._finish(); return true;
  }
  _finish() {
    this.dirty = true;
    this.meshes = []; this.model.traverse(o => { if (o.isMesh && !o.isInstancedMesh) { this.meshes.push(o); o.geometry.computeBoundsTree(); } if (o.isMesh) { const tr = [].concat(o.material).some(m => m.transparent); o.castShadow = !tr; o.receiveShadow = true; } });
    this.box = new THREE.Box3().setFromObject(this.model);
    if (this.box.isEmpty()) { this.msg('الملف ما فيه عناصر ثلاثية الأبعاد.'); return; }
    const s = this.box.getSize(new THREE.Vector3()), R = Math.max(s.x, s.y, s.z);
    this.camera.near = Math.max(0.02, R / 5000); this.camera.far = R * 20; this.camera.updateProjectionMatrix();
    // ground plane
    const c = this.box.getCenter(new THREE.Vector3());
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(R * 3, 48), tag(new THREE.MeshStandardMaterial({ color: '#cbc6ba', roughness: 0.95 }), 'paving'));
    gnd.receiveShadow = true;
    const sn = this.sun; sn.position.set(c.x + R * 0.5, c.y + R * 1.1, c.z + R * 0.35); sn.target.position.copy(c); this.scene.add(sn.target);
    this.look.placeSun(sn.position.clone().sub(c));
    sn.castShadow = true; sn.shadow.mapSize.set(4096, 4096); const sc = sn.shadow.camera, e = R * 0.8; sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 0.5; sc.far = R * 4; sc.updateProjectionMatrix(); sn.shadow.bias = -0.0004; sn.shadow.normalBias = 0.02;
    gnd.rotation.x = -Math.PI / 2; gnd.position.set(c.x, this.box.min.y - 0.01, c.z); gnd.userData.ground = true; this.scene.add(gnd); this.meshes.push(gnd); gnd.geometry.computeBoundsTree();
    if (!this.look.ready) { this.look.ready = true; this.look.setQuality(this.hq); } else dressModel(this.scene, this.hq);
    this.msg(''); this._renderItems(); this.setMode('orbit'); this._side();
  }
  async _loadGltf(buf) {
    this.msg('جاري فتح النموذج…');
    const g = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
    const root = g.scene; root.updateMatrixWorld(true);
    this.parts = [];
    const tops = root.children.length === 1 && root.children[0].children.length > 1 ? root.children[0].children : root.children;
    tops.forEach((o, i) => { o.userData.part = 'p' + i; this.parts.push({ k: 'p' + i, l: o.name || 'جزء ' + (i + 1), o }); this.catOn['p' + i] = true; });
    root.traverse(o => { if (o.isMesh) { [].concat(o.material).forEach(m => { m.side = THREE.DoubleSide; }); } });
    this.model.add(root);
  }
  async _loadIfc(buf) {
    this.msg('جاري تحميل قارئ ملفات IFC…');
    const W = await import('./vendor/web-ifc/web-ifc-api.js');
    const api = new W.IfcAPI(); api.SetWasmPath(new URL('./vendor/web-ifc/', document.baseURI).href, true);
    await api.Init(undefined, true);
    this.msg('جاري قراءة النموذج… (الملفات الكبيرة تاخذ دقيقة)');
    await new Promise(r => setTimeout(r, 30));
    const mid = api.OpenModel(new Uint8Array(buf), { COORDINATE_TO_ORIGIN: true });
    const ids = (t) => { const v = api.GetLineIDsWithType(mid, t, true), a = []; for (let i = 0; i < v.size(); i++) a.push(v.get(i)); return a; };
    const line = id => { try { return api.GetLine(mid, id); } catch (e) { return null; } };
    const val = x => x && typeof x === 'object' && 'value' in x ? x.value : x;
    // storeys
    const storeyOf = {}, storeys = {};
    ids(W.IFCBUILDINGSTOREY).forEach(id => { const s = line(id); storeys[id] = { id, name: val(s && s.Name) || ('طابق ' + id), elev: +val(s && s.Elevation) || 0 }; });
    ids(W.IFCRELCONTAINEDINSPATIALSTRUCTURE).forEach(id => { const r = line(id); if (!r) return; const st = val(r.RelatingStructure); (r.RelatedElements || []).forEach(e => { storeyOf[val(e)] = st; }); });
    const aggr = ids(W.IFCRELAGGREGATES).map(line).filter(Boolean);
    for (let pass = 0; pass < 3; pass++) aggr.forEach(r => { const p = val(r.RelatingObject); const st = storeyOf[p]; if (st) (r.RelatedObjects || []).forEach(e => { if (!storeyOf[val(e)]) storeyOf[val(e)] = st; }); });
    // type objects (IFC2x3 MEP elements are generic "flow" elements; the type says what they are)
    const typeName = {};
    ids(W.IFCRELDEFINESBYTYPE).forEach(id => { const r = line(id); if (!r) return; const t = val(r.RelatingType); let tn = ''; try { tn = String(api.GetNameFromTypeCode(api.GetLineType(mid, t))).toUpperCase().replace(/TYPE$/, ''); } catch (e) { } (r.RelatedObjects || []).forEach(e => { typeName[val(e)] = tn; }); });
    // systems (fire, HVAC, plumbing…)
    const sysCat = {};
    ids(W.IFCRELASSIGNSTOGROUP).forEach(id => { const r = line(id); if (!r) return; const gid = val(r.RelatingGroup); let gt = ''; try { gt = String(api.GetNameFromTypeCode(api.GetLineType(mid, gid))).toUpperCase(); } catch (e) { } if (!/SYSTEM/.test(gt)) return;
      const g = line(gid), nm = [val(g && g.Name), val(g && g.ObjectType), val(g && g.LongName), val(g && g.PredefinedType)].filter(Boolean).join(' ');
      const hit = SYSTEM_RULES.find(x => x[1].test(nm)); if (hit) (r.RelatedObjects || []).forEach(e => { sysCat[val(e)] = hit[0]; }); });
    this.ifc = { api, mid, W, storeys, storeyOf, typeName, line, val, sysCat };
    const groups = new Map(), tcache = {}, counts = {};
    const elemCat = id => { if (sysCat[id]) return sysCat[id]; let tn = tcache[id]; if (!tn) { try { tn = tcache[id] = String(api.GetNameFromTypeCode(api.GetLineType(mid, id))).toUpperCase(); } catch (e) { tn = 'IFC'; } } let c = catOfType(tn); if ((c === 'mep' || c === 'other') && typeName[id]) { const c2 = catOfType(typeName[id]); if (c2 !== 'other') c = c2; } return c; };
    const mtx = new THREE.Matrix4();
    api.StreamAllMeshes(mid, mesh => {
      const id = mesh.expressID, cat = elemCat(id), st = storeyOf[id] || 0, tn = tcache[id] || '';
      counts[cat] = (counts[cat] || 0) + 1;
      const pgs = mesh.geometries;
      for (let i = 0; i < pgs.size(); i++) {
        const pg = pgs.get(i), geo = api.GetGeometry(mid, pg.geometryExpressID);
        const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize()), ix = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
        const n = v.length / 6, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), eid = new Float32Array(n).fill(id);
        for (let k = 0; k < n; k++) { pos[k * 3] = v[k * 6]; pos[k * 3 + 1] = v[k * 6 + 1]; pos[k * 3 + 2] = v[k * 6 + 2]; nor[k * 3] = v[k * 6 + 3]; nor[k * 3 + 1] = v[k * 6 + 4]; nor[k * 3 + 2] = v[k * 6 + 5]; }
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); bg.setAttribute('eid', new THREE.BufferAttribute(eid, 1));
        bg.setIndex(new THREE.BufferAttribute(new Uint32Array(ix), 1));
        bg.applyMatrix4(mtx.fromArray(pg.flatTransformation));
        geo.delete();
        const col = pg.color, op = col.w, noCollide = /^IFC(DOOR|SPACE|OPENING|FURNI|FURNISH|LIGHT|AIRTERMINAL|SANITARY|FIRESUPP|ALARM|SENSOR|OUTLET|SWITCH)/.test(tn) || cat === 'furn';
        const key = cat + '|' + st + '|' + col.x.toFixed(2) + col.y.toFixed(2) + col.z.toFixed(2) + op.toFixed(2) + '|' + noCollide;
        let g = groups.get(key); if (!g) { g = { cat, st, col, op, noCollide, list: [], n: 0 }; groups.set(key, g); }
        g.list.push(bg); g.n += ix.length;
      }
    });
    this.msg('جاري تجهيز المجسم…');
    for (const g of groups.values()) {
      // split very large groups so culling and picking stay fast
      for (let s = 0; s < g.list.length; s += 400) {
        const merged = mergeGeometries(g.list.slice(s, s + 400), false); if (!merged) continue;
        const color = new THREE.Color(g.col.x, g.col.y, g.col.z);
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, transparent: g.op < 0.99, opacity: g.op, depthWrite: g.op >= 0.99 });
        const m = new THREE.Mesh(merged, mat); m.userData = { cat: g.cat, st: g.st, noCollide: g.noCollide, ifc: true };
        this.model.add(m);
      }
      g.list.forEach(x => x.dispose());
    }
    this.counts = counts;
    Object.keys(counts).forEach(c => { this.catOn[c] = true; });
    this.storeys = Object.values(storeys).sort((a, b) => a.elev - b.elev);
  }
  _loadDxf(text) {
    this.msg('جاري قراءة مخطط AutoCAD…');
    const d = parseDxf(text); if (!d.segs.length) throw new Error('ما لقيت خطوط في الملف');
    this.dxf = d; const g = guessRoles(d.segs); this.dxfRoles = g.roles; this.dxfCount = g.count; this.dxfUnits = guessUnits(d.units, d.segs); this.dxfH = 3;
    this._buildDxf();
  }
  _buildDxf() {
    this.model.clear(); this.meshes = [];
    const u = UNIT_M[this.dxfUnits] || 1, H = this.dxfH, roles = this.dxfRoles;
    const segs = this.dxf.segs.filter(s => roles[s.layer] && roles[s.layer] !== 'skip').map(s => ({ ...s, role: roles[s.layer], a: [s.a[0] * u, s.a[1] * u], b: [s.b[0] * u, s.b[1] * u] }))
      .filter(s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 0.01);
    if (!segs.length) { this.msg('اختر طبقة الجدران من القائمة.'); return; }
    const xs = segs.flatMap(s => [s.a[0], s.b[0]]), ys = segs.flatMap(s => [s.a[1], s.b[1]]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const P = p => [p[0] - cx, -(p[1] - cy)]; // plan y -> -z
    const walls = [], wins = [], doors = [];
    // Pair parallel wall lines (the two faces of one wall) into solid walls.
    const W = segs.filter(s => s.role === 'wall' && !s.arc).map(s => { const a = P(s.a), b = P(s.b), dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); return { a, b, L, ux: dx / L, uz: dz / L, used: 0 }; });
    W.sort((p, q) => q.L - p.L);
    for (let i = 0; i < W.length; i++) {
      const s = W[i]; if (s.used) continue;
      let best = null;
      for (let j = 0; j < W.length; j++) {
        if (j === i || W[j].used) continue; const t = W[j];
        if (Math.abs(s.ux * t.uz - s.uz * t.ux) > 0.03) continue; // not parallel
        const nx = -s.uz, nz = s.ux, d = (t.a[0] - s.a[0]) * nx + (t.a[1] - s.a[1]) * nz, ad = Math.abs(d);
        if (ad < 0.05 || ad > 0.7) continue;
        const p1 = (t.a[0] - s.a[0]) * s.ux + (t.a[1] - s.a[1]) * s.uz, p2 = (t.b[0] - s.a[0]) * s.ux + (t.b[1] - s.a[1]) * s.uz;
        const lo = Math.max(0, Math.min(p1, p2)), hi = Math.min(s.L, Math.max(p1, p2));
        if (hi - lo < Math.min(s.L, t.L) * 0.6) continue;
        if (!best || ad < best.ad) best = { j, d, ad, lo, hi };
      }
      if (best) {
        const t = W[best.j]; s.used = t.used = 1;
        const nx = -s.uz, nz = s.ux, a = [s.a[0] + s.ux * best.lo + nx * best.d / 2, s.a[1] + s.uz * best.lo + nz * best.d / 2];
        walls.push({ a, L: best.hi - best.lo, ux: s.ux, uz: s.uz, t: best.ad, y0: 0, y1: H });
        // leftover ends of the longer line stay as thin walls
        if (best.lo > 0.05) walls.push({ a: s.a, L: best.lo, ux: s.ux, uz: s.uz, t: 0.1, off: 0, y0: 0, y1: H, thin: 1 });
        if (s.L - best.hi > 0.05) walls.push({ a: [s.a[0] + s.ux * best.hi, s.a[1] + s.uz * best.hi], L: s.L - best.hi, ux: s.ux, uz: s.uz, t: 0.1, y0: 0, y1: H, thin: 1 });
      }
    }
    W.forEach(s => { if (!s.used) walls.push({ a: s.a, L: s.L, ux: s.ux, uz: s.uz, t: 0.1, y0: 0, y1: H, thin: 1 }); });
    segs.filter(s => s.role === 'window' && !s.arc).forEach(s => { const a = P(s.a), b = P(s.b), L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      wins.push({ a, L, ux, uz, t: 0.06, y0: 0, y1: 0.9 }, { a, L, ux, uz, t: 0.06, y0: 2.1, y1: H }); if (L > 0.3) wins.push({ a, L, ux, uz, t: 0.02, y0: 0.9, y1: 2.1, glass: 1 }); });
    segs.filter(s => s.role === 'door' && !s.arc).forEach(s => { const a = P(s.a), b = P(s.b), L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5 || L > 1.6) return; doors.push({ a, L, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L, t: 0.04, y0: 0, y1: 2.1 }); });
    const build = (list, mat, cat, noCollide) => {
      if (!list.length) return;
      const gs = list.map(w => { const g = new THREE.BoxGeometry(w.L, w.y1 - w.y0, w.t); const ang = Math.atan2(-w.uz, w.ux);
        const m = new THREE.Matrix4().makeRotationY(ang).setPosition(w.a[0] + w.ux * w.L / 2, (w.y0 + w.y1) / 2, w.a[1] + w.uz * w.L / 2); g.applyMatrix4(m); return g; });
      const m = new THREE.Mesh(mergeGeometries(gs, false), mat); m.userData = { cat, noCollide }; this.model.add(m); gs.forEach(g => g.dispose());
    };
    build(walls.filter(w => !w.glass), new THREE.MeshStandardMaterial({ color: '#f1efe9', roughness: 0.9 }), 'walls');
    build(wins.filter(w => !w.glass), new THREE.MeshStandardMaterial({ color: '#e6e3dc', roughness: 0.9 }), 'windows');
    build(wins.filter(w => w.glass), new THREE.MeshStandardMaterial({ color: '#8fc3e8', transparent: true, opacity: 0.35, depthWrite: false }), 'windows', true);
    build(doors, new THREE.MeshStandardMaterial({ color: '#9b6a3c', roughness: 0.7 }), 'doors', true);
    // floor slab under the plan
    const bx = new THREE.Box3().setFromObject(this.model), sz = bx.getSize(new THREE.Vector3()), ctr = bx.getCenter(new THREE.Vector3());
    const fl = new THREE.Mesh(new THREE.BoxGeometry(sz.x + 0.4, 0.1, sz.z + 0.4), new THREE.MeshStandardMaterial({ color: '#cbbfa8', roughness: 0.95 }));
    fl.position.set(ctr.x, -0.05, ctr.z); fl.userData = { cat: 'floor' }; this.model.add(fl);
    this.counts = { walls: walls.length, windows: wins.length, doors: doors.length };
    ['walls', 'windows', 'doors', 'floor'].forEach(c => { if (this.catOn[c] == null) this.catOn[c] = true; });
  }
  _boxes(list, mat, cat, noCollide) {
    if (!list.length) return;
    for (let s = 0; s < list.length; s += 3000) {
      const gs = list.slice(s, s + 3000).map(w => { const g = new THREE.BoxGeometry(w.L, w.y1 - w.y0, w.t);
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(-w.uz, w.ux)).setPosition(w.a[0] + w.ux * w.L / 2, (w.y0 + w.y1) / 2, w.a[1] + w.uz * w.L / 2)); return g; });
      const m = new THREE.Mesh(mergeGeometries(gs, false), mat); m.userData = { cat, noCollide }; this.model.add(m); gs.forEach(g => g.dispose());
    }
  }
  async _loadPdf(buf) {
    this.msg('جاري قراءة المخطط…');
    const L = this.opts.pdfjs ? await this.opts.pdfjs() : window.pdfjsLib; if (!L) throw new Error('قارئ PDF غير متوفر');
    const ex = await extractPdfPlan(L, new Uint8Array(buf));
    const st = {}; ex.paths.forEach(p => { const s = st[p.layer] = st[p.layer] || { n: 0 }; s.n++; });
    if (Object.keys(st).length < 3) { // plotted without layers (most municipality sets): read the walls from the pens, sheet by sheet
      if (await this._loadSheets(L, ex.doc)) return;
      throw new Error('ما لقيت في هذا الـ PDF مخطط أدوار أقدر أقرأه (يمكن يكون صورة ممسوحة أو عرض تقديمي). ارفع المخطط المطبوع من AutoCAD، أو ملف DXF أو IFC.');
    }
    if (ex.paths.length < 300) throw new Error('هذا الـ PDF ما فيه رسم كافي يتحول 3D. ارفع المخطط المطبوع من AutoCAD، أو ملف DXF أو IFC.');
    this.pdf = ex; this.dxfCount = st; this.pdfRoles = guessPdfRoles(Object.keys(st));
    const m = /1\s*:\s*(\d{2,4})/.exec(ex.text || ''); this.pdfScale = m ? +m[1] : 100; this.dxfH = 3.5;
    await this._buildPdf();
  }
  async _buildPdf() {
    this.model.clear(); this.meshes = [];
    const roles = this.pdfRoles, k = 0.0254 / 72 * this.pdfScale, H = this.dxfH, P = this.pdf.paths;
    const use = r => P.filter(p => roles[p.layer] === r);
    const box = arr => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; arr.forEach(p => p.pts.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; })); return { x0, y0, x1, y1 }; };
    let bb = box(P.filter(p => roles[p.layer] === 'wall' || roles[p.layer] === 'column'));
    if (!isFinite(bb.x0)) bb = box(P.filter(p => roles[p.layer] !== 'skip'));
    if (!isFinite(bb.x0)) { this.msg('اختر طبقة الجدران من القائمة.'); return; }
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, W = q => [(q[0] - cx) * k, -(q[1] - cy) * k]; // -> world x, z
    const seg = (a, b, t, y0, y1) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return L < 0.02 ? null : { a, L, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L, t, y0, y1 }; };
    const solids = [], thin = [], glass = [], frames = [], doors = [], furn = [], thinLow = [];
    const addShape = (pts, h, out, maxT) => {
      const w = pts.map(W); let ar = 0, per = 0; for (let i = 0; i < w.length; i++) { const a = w[i], b = w[(i + 1) % w.length]; ar += a[0] * b[1] - b[0] * a[1]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      ar = Math.abs(ar) / 2; if (ar < 0.0004) return;
      if (maxT && ar / (per / 2) > maxT) return; // too fat for a wall: a table, a title block or a hatch area
      const sh = new THREE.Shape(w.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 1 }); g.rotateX(-Math.PI / 2); out.push(g);
    };
    ['wall', 'column'].forEach(r => use(r).forEach(p => {
      if (p.filled && p.closed && p.pts.length >= 3) addShape(p.pts, H, solids, r === 'column' ? 1.6 : 1.0);
      else for (let i = 0; i + 1 < p.pts.length; i++) { const s = seg(W(p.pts[i]), W(p.pts[i + 1]), r === 'column' ? 0.08 : 0.05, 0, H); if (s) thin.push(s); }
    }));
    use('window').forEach(p => { for (let i = 0; i + 1 < p.pts.length; i++) { const a = W(p.pts[i]), b = W(p.pts[i + 1]); const g = seg(a, b, 0.03, 0.02, H - 0.35), f = seg(a, b, 0.08, H - 0.35, H); if (g) glass.push(g); if (f) frames.push(f); } });
    use('door').forEach(p => { if (p.curve) return; for (let i = 0; i + 1 < p.pts.length; i++) { const s = seg(W(p.pts[i]), W(p.pts[i + 1]), 0.045, 0, 2.2); if (s && s.L >= 0.6 && s.L <= 1.6) doors.push(s); } });
    const low = []; use('low').forEach(p => { if (p.closed && p.pts.length >= 3) addShape(p.pts, 0.9, low, 3); else for (let i = 0; i + 1 < p.pts.length; i++) { const s = seg(W(p.pts[i]), W(p.pts[i + 1]), 0.12, 0, 0.9); if (s) thinLow.push(s); } });
    // trees and planters: one plant per outline, merged when close together
    const trees = [], cell = {};
    use('plant').forEach(p => { const b = box([p]), sz = Math.max(b.x1 - b.x0, b.y1 - b.y0) * k; if (sz < 0.35 || sz > 9) return;
      const c = W([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]), key = Math.round(c[0] / 0.8) + ',' + Math.round(c[1] / 0.8); if (cell[key]) { cell[key].r = Math.max(cell[key].r, sz / 2); return; }
      const t = { x: c[0], z: c[1], r: sz / 2 }; cell[key] = t; trees.push(t); });
    const MAT = {
      wall: tag(new THREE.MeshStandardMaterial({ color: '#f3efe7', roughness: 0.92 }), 'plaster'),
      glass: tag(new THREE.MeshPhysicalMaterial({ color: '#bfe0ef', transparent: true, opacity: 0.16, roughness: 0.03, metalness: 0, depthWrite: false }), 'glass'),
      frame: tag(new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.35, metalness: 0.7 }), 'metal'),
      door: tag(new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.65 }), 'wood'),
      wood: tag(new THREE.MeshStandardMaterial({ color: '#a8743f', roughness: 0.7 }), 'wood'),
      stone: tag(new THREE.MeshStandardMaterial({ color: '#cdb594', roughness: 0.85 }), 'stone')
    };
    if (solids.length) for (let s = 0; s < solids.length; s += 2000) { const m = new THREE.Mesh(mergeGeometries(solids.slice(s, s + 2000), false), MAT.wall); m.userData = { cat: 'walls' }; this.model.add(m); }
    solids.forEach(g => g.dispose());
    this._boxes(thin, MAT.wall, 'walls');
    this._boxes(glass, MAT.glass, 'windows', false);
    this._boxes(frames, MAT.frame, 'windows', true);
    this._boxes(doors, MAT.door, 'doors', true);
    if (low.length) { const m = new THREE.Mesh(mergeGeometries(low, false), MAT.stone); m.userData = { cat: 'low' }; this.model.add(m); low.forEach(g => g.dispose()); }
    this._boxes(thinLow, MAT.stone, 'low');
    // furniture read from the drawing itself: each table with its chairs, sofas, lounge chairs and plants, where and how they are drawn
    const fp = use('furniture').filter(p => p.pts.length >= 2).map(p => ({ pts: p.pts, closed: p.closed, curve: p.pts.length > 8 }));
    this.furnRead = null;
    if (fp.length) {
      this.msg('جاري قراءة الأثاث من المخطط…'); await new Promise(r => setTimeout(r, 0));
      let rec = []; try { rec = recognizeFurniture(fp, k); } catch (e) { console.warn(e); }
      const grp = new THREE.Group(), byMat = new Map();
      rec.forEach(it => { const f = it.face || [0, 1], g = buildItem({ ...it, x: (it.x - cx) * k, y: 0, z: -(it.y - cy) * k, r: Math.atan2(f[0], -f[1]) }); if (g) grp.add(g); });
      grp.updateMatrixWorld(true);
      grp.traverse(o => { if (!o.isMesh) return; const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld); (byMat.get(o.material) || byMat.set(o.material, []).get(o.material)).push(g); o.geometry.dispose(); });
      byMat.forEach((gs, mat) => { for (let i = 0; i < gs.length; i += 3000) { const m = new THREE.Mesh(mergeGeometries(gs.slice(i, i + 3000), false), mat); m.castShadow = true; m.receiveShadow = true; m.userData = { cat: 'furniture', noCollide: true }; this.model.add(m); } gs.forEach(g => g.dispose()); });
      this.furnRead = rec.reduce((a, it) => (a[it.t] = (a[it.t] || 0) + 1, a), {}); furn.length = rec.length;
    }
    if (trees.length) {
      const list = trees.slice(0, 800), n = list.length, d = new THREE.Object3D(), col = new THREE.Color();
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.1, 1, 6), new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.9 }), n);
      const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }), n * 2);
      list.forEach((t, i) => {
        const big = t.r > 0.9, h = big ? Math.min(6, 2 + t.r * 1.4) : 0.5 + t.r * 0.8, cr = big ? Math.min(3, t.r * 0.9) : t.r * 0.9;
        d.position.set(t.x, (h - cr * 0.8) / 2, t.z); d.scale.set(1, Math.max(0.1, h - cr * 0.8), 1); d.rotation.set(0, 0, 0); d.updateMatrix(); trunk.setMatrixAt(i, d.matrix);
        for (let j = 0; j < 2; j++) {
          const s = cr * (j ? 0.7 : 1); d.position.set(t.x + (j ? cr * 0.3 : 0), h - cr * (j ? 0.2 : 0.6), t.z + (j ? -cr * 0.25 : 0)); d.scale.set(s, s * (big ? 0.9 : 0.7), s); d.rotation.set(i, i * 1.7, 0); d.updateMatrix();
          leaf.setMatrixAt(i * 2 + j, d.matrix); leaf.setColorAt(i * 2 + j, col.setHSL(0.27 + ((i * 37 + j * 11) % 10) / 120, 0.45, 0.28 + ((i * 13) % 10) / 70));
        }
      });
      trunk.userData = { cat: 'plants', noCollide: true, inst: true }; leaf.userData = { cat: 'plants', noCollide: true, inst: true };
      this.model.add(trunk, leaf);
    }
    // the drawing itself (furniture, floor patterns, water, landscape) printed on the floor
    try { await this._pdfFloor(bb, cx, cy, k); } catch (e) { console.warn(e); }
    this.counts = { walls: solids.length + thin.length, windows: glass.length, doors: doors.length, plants: trees.length, furniture: furn.length, low: low.length + thinLow.length };
    ['walls', 'windows', 'doors', 'plants', 'furniture', 'floor', 'low'].forEach(c => { if (this.catOn[c] == null) this.catOn[c] = true; });
  }
  /* ----- plotted sheet sets without layers (municipality drawings) ----- */
  async _loadSheets(L, doc) {
    const n = Math.min(doc.numPages, 40), sheets = [];
    for (let i = 1; i <= n; i++) { this.msg('جاري قراءة صفحات المخطط… ' + i + ' من ' + n); await new Promise(r => setTimeout(r, 0)); sheets.push(await readSheet(L, await doc.getPage(i))); }
    this.msg('جاري تحليل الجدران والأبواب والشبابيك…'); await new Promise(r => setTimeout(r, 30));
    const set = analyzeSet(sheets); if (!set || !set.storeys.length) return false;
    this.sheetDoc = doc; this.sheets = sheets; this.set = set; this.pdfScale = set.scale; this.texCache = {};
    await this._buildSheets(); return true;
  }
  async rebuildSheets() {
    this.msg('جاري تحديث المجسم…'); await new Promise(r => setTimeout(r, 20));
    const set = analyzeSet(this.sheets, { scale: this.pdfScale }); if (!set) { this.msg('ما قدرت أبني المخطط بهذا المقياس.'); return; }
    this.set = set; this.texCache = {};
    this.scene.children.filter(o => o.userData.ground).forEach(o => this.scene.remove(o));
    await this._buildSheets(); this._finish();
  }
  async _sheetTex(pi, off) {
    if (pi == null) return null;
    if (this.texCache[pi]) return this.texCache[pi];
    const rg = this.set.region, page = await this.sheetDoc.getPage(pi + 1), view = page.view;
    const x0 = rg.X0 + off[0], y1 = rg.Y1 + off[1], w = rg.X1 - rg.X0, h = rg.Y1 - rg.Y0;
    const max = Math.min(this.renderer.capabilities.maxTextureSize || 4096, matchMedia('(pointer:coarse)').matches ? 2048 : 4096);
    const s = Math.min(max / w, max / h, 8), cw = Math.round(w * s), ch = Math.round(h * s);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const ctx = cv.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: s }), transform: [1, 0, 0, 1, -(x0 - view[0]) * s, -(view[3] - y1) * s] }).promise;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return (this.texCache[pi] = tex);
  }
  async _buildSheets() {
    this.model.clear(); this.meshes = [];
    const S = this.set, n = S.storeys.length, k = S.k, rg = S.region, [pcx, pcy] = S.center;
    const MAT = {
      wall: tag(new THREE.MeshStandardMaterial({ color: '#efe8dc', roughness: 0.92 }), 'plaster'),
      slab: tag(new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.95 }), 'plaster'),
      roof: tag(new THREE.MeshStandardMaterial({ color: '#d6d0c6', roughness: 0.95 }), 'plaster'),
      glass: tag(new THREE.MeshPhysicalMaterial({ color: '#9ec6da', transparent: true, opacity: 0.26, roughness: 0.03, metalness: 0.1, depthWrite: false }), 'glass'),
      frame: tag(new THREE.MeshStandardMaterial({ color: '#4b4f54', roughness: 0.35, metalness: 0.7 }), 'metal'),
      door: tag(new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.6 }), 'wood'),
      stair: tag(new THREE.MeshStandardMaterial({ color: '#e6dfd2', roughness: 0.5 }), 'stone')
    };
    const hemi = this.scene.children.find(o => o.isHemisphereLight); if (hemi) hemi.groundColor.set('#d9d2c6'); // light ceilings indoors
    const box = (list, x0, x1, y0, y1, z0, z1) => { if (x1 - x0 < 0.004 || y1 - y0 < 0.004 || z1 - z0 < 0.004) return; const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); list.push(g); };
    const add = (list, mat, ud) => { for (let s = 0; s < list.length; s += 3000) { const m = new THREE.Mesh(mergeGeometries(list.slice(s, s + 3000), false), mat); m.userData = { ...ud }; this.model.add(m); } list.forEach(g => g.dispose()); };
    // flat quads with the sheet mapped on them (world x,z -> page coordinates of the base sheet)
    const uv = (x, z) => [((pcx + x / k) - rg.X0) / (rg.X1 - rg.X0), ((pcy - z / k) - rg.Y0) / (rg.Y1 - rg.Y0)];
    const quads = (list, y) => { const pos = [], uvs = [], idx = []; list.forEach(r => { const b = pos.length / 3; [[r.x0, r.z0], [r.x0, r.z1], [r.x1, r.z1], [r.x1, r.z0]].forEach(([x, z]) => { pos.push(x, y, z); uvs.push(...uv(x, z)); }); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; };
    const counts = { walls: 0, windows: 0, doors: 0, floor: 0, roof: 0 };
    for (let i = 0; i < n; i++) {
      const s = S.storeys[i], b = s.base, t = s.top, ud = { lvl: i };
      this.msg('جاري بناء ' + s.name + '…'); await new Promise(r => setTimeout(r, 0));
      const W = [], GL = [], FR = [], DR = [], SL = [];
      s.walls.forEach(r => box(W, r.x0, r.x1, b, t, r.z0, r.z1));
      const lint = Math.min(b + 2.2, t - 0.05);
      s.opens.forEach(o => {
        if (t - lint > 0.02) box(W, o.x0, o.x1, lint, t, o.z0, o.z1); // lintel
        if (o.type === 'window') {
          counts.windows++; const y0 = b + 0.9, y1 = lint, f = 0.05;
          box(W, o.x0, o.x1, b, y0, o.z0, o.z1); // sill wall
          if (o.horiz) { const z = (o.z0 + o.z1) / 2, c = (o.x0 + o.x1) / 2;
            box(GL, o.x0, o.x1, y0, y1, z - 0.012, z + 0.012);
            [[o.x0, o.x1, y0, y0 + f], [o.x0, o.x1, y1 - f, y1], [o.x0, o.x0 + f, y0, y1], [o.x1 - f, o.x1, y0, y1]].concat(o.len > 1.3 ? [[c - 0.025, c + 0.025, y0, y1]] : []).forEach(([a, e, p, q]) => box(FR, a, e, p, q, z - 0.04, z + 0.04));
          } else { const x = (o.x0 + o.x1) / 2, c = (o.z0 + o.z1) / 2;
            box(GL, x - 0.012, x + 0.012, y0, y1, o.z0, o.z1);
            [[o.z0, o.z1, y0, y0 + f], [o.z0, o.z1, y1 - f, y1], [o.z0, o.z0 + f, y0, y1], [o.z1 - f, o.z1, y0, y1]].concat(o.len > 1.3 ? [[c - 0.025, c + 0.025, y0, y1]] : []).forEach(([a, e, p, q]) => box(FR, x - 0.04, x + 0.04, p, q, a, e));
          }
        } else if (o.type === 'door') {
          counts.doors++;
          if (o.leaf) { const [ax, az] = o.leaf.a, [bx, bz] = o.leaf.b, L = Math.hypot(bx - ax, bz - az), H = Math.max(1.8, Math.min(2.15, lint - b - 0.02));
            const g = new THREE.BoxGeometry(L, H, 0.045); g.rotateY(Math.atan2(-(bz - az), bx - ax)); g.translate((ax + bx) / 2, b + 0.01 + H / 2, (az + bz) / 2); DR.push(g); }
        }
      });
      s.parapets.forEach(r => box(W, r.x0, r.x1, b, b + s.parapetH, r.z0, r.z1));
      // stairs up to the next storey: each tread a stepped slab (not solid, so you can walk under the flight above)
      const STP = [];
      (s.stairs || []).forEach(st => st.steps.concat(st.lands).forEach(q => { const y0 = Math.max(b, q.top - 0.28), h = q.top - y0; if (h < 0.02) return;
        const g = new THREE.BoxGeometry(q.depth + 0.01, h, q.width); g.rotateY(q.ang); g.translate(q.x, y0 + h / 2, q.z); STP.push(g); }));
      counts.stairs = (counts.stairs || 0) + (s.stairs || []).length;
      add(STP, MAT.stair, { ...ud, cat: 'stairs' });
      counts.walls += s.walls.length + s.parapets.length;
      // floor slab, with this storey's sheet printed on it
      const sy0 = i ? b - 0.22 : 0, sy1 = i ? b : 0.15;
      s.slab.forEach(r => box(SL, r.x0, r.x1, sy0, sy1, r.z0, r.z1)); counts.floor += s.slab.length;
      add(W, MAT.wall, { ...ud, cat: 'walls' }); add(GL, MAT.glass, { ...ud, cat: 'windows' }); add(FR, MAT.frame, { ...ud, cat: 'windows', noCollide: true });
      add(DR, MAT.door, { ...ud, cat: 'doors', noCollide: true }); add(SL, MAT.slab, { ...ud, cat: 'floor' });
      const tex = await this._sheetTex(s.page, s.off).catch(e => { console.warn(e); return null; });
      if (tex && s.slab.length) { const m = new THREE.Mesh(quads(s.slab, sy1 + 0.003), new THREE.MeshStandardMaterial({ map: tex, color: '#efe7d8', roughness: 0.55 })); m.userData = { ...ud, cat: 'floor', noCollide: true }; this.model.add(m); }
      if (i === 0 && tex) { // the site around the building (parking, paving, landscape) from the ground floor sheet
        const g = quads([{ x0: (rg.X0 - pcx) * k, x1: (rg.X1 - pcx) * k, z0: -(rg.Y1 - pcy) * k, z1: -(rg.Y0 - pcy) * k }], 0.004);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, color: '#ddd8cc', roughness: 0.95 })); m.userData = { cat: 'floor', noCollide: true, site: true }; this.model.add(m);
      }
    }
    if (S.roof) { const R = S.roof, RF = [], P = [];
      R.slab.forEach(r => box(RF, r.x0, r.x1, R.base - 0.25, R.base, r.z0, r.z1)); R.parapets.forEach(r => box(P, r.x0, r.x1, R.base, R.base + R.parapetH, r.z0, r.z1));
      counts.roof = R.slab.length; add(RF, MAT.roof, { lvl: n, cat: 'roof' }); add(P, MAT.wall, { lvl: n, cat: 'roof' }); }
    this.counts = counts; this.storeys = S.storeys.map((s, i) => ({ id: i, name: s.name, elev: s.base }));
    if (!this.storeys[+this.storeySel]) this.storeySel = 'all';
    Object.keys(counts).forEach(c => { if (this.catOn[c] == null) this.catOn[c] = true; });
  }
  async _pdfFloor(bb, cx, cy, k) {
    const { page, doc, names } = this.pdf, view = page.view, pad = 6 / k;
    const r = { x0: Math.max(view[0], bb.x0 - pad), y0: Math.max(view[1], bb.y0 - pad), x1: Math.min(view[2], bb.x1 + pad), y1: Math.min(view[3], bb.y1 + pad) };
    const w = r.x1 - r.x0, h = r.y1 - r.y0, max = Math.min(8192, this.renderer.capabilities.maxTextureSize || 4096, 6144);
    const s = Math.min(max / w, max / h, 8), cw = Math.round(w * s), ch = Math.round(h * s);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const ctx = cv.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
    const cfg = await doc.getOptionalContentConfig(); const show = new Set(['plan', 'furniture', 'plant', 'door']);
    Object.keys(names).forEach(id => { try { cfg.setVisibility(id, show.has(this.pdfRoles[names[id]])); } catch (e) { } });
    const vp = page.getViewport({ scale: s });
    await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -(r.x0 - view[0]) * s, -(view[3] - r.y1) * s], optionalContentConfigPromise: Promise.resolve(cfg) }).promise;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(w * k, h * k), new THREE.MeshStandardMaterial({ map: tex, color: '#efe5d3', roughness: 0.95 }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(((r.x0 + r.x1) / 2 - cx) * k, 0.005, -((r.y0 + r.y1) / 2 - cy) * k); fl.userData = { cat: 'floor' };
    this.model.add(fl);
  }
  async rebuildPdf() {
    this.msg('جاري تحديث المجسم…'); await new Promise(r => setTimeout(r, 20));
    this.scene.children.filter(o => o.userData.ground).forEach(o => this.scene.remove(o));
    await this._buildPdf(); this._finish();
  }
  rebuildDxf() {
    this.scene.children.filter(o => o.userData.ground).forEach(o => this.scene.remove(o));
    this._buildDxf(); this._finish();
  }
  /* ----- filters ----- */
  applyVis() {
    this.dirty = true;
    const sel = this.mode === 'walk' ? 'all' : this.storeySel, selE = sel === 'all' ? null : (this.storeys.find(s => String(s.id) === String(sel)) || {}).elev;
    this.model.traverse(o => {
      if (!o.isMesh) return; const u = o.userData;
      let on = true;
      if (u.cat && this.catOn[u.cat] === false) on = false;
      if (u.part && this.catOn[u.part] === false) on = false;
      if (on && selE != null && u.lvl != null) { const s = this.storeys[u.lvl]; on = !!s && s.elev <= selE + 0.01; }
      if (on && selE != null && u.ifc) { const s = this.ifc.storeys[u.st]; on = !!s && s.elev <= selE + 0.01; }
      if (o.userData.ifc != null || u.cat || u.part) o.visible = on;
    });
    this.itemGroup.children.forEach(g => { g.visible = selE == null || g.userData.item.y < selE + 2; });
    // GLB parts are groups: toggle the group itself
    (this.parts || []).forEach(p => { p.o.visible = this.catOn[p.k] !== false; });
  }
  /* ----- added furniture ----- */
  _itemStat() { return this.items.length ? 'العناصر المضافة: ' + this.items.length + (this.saveNote ? ' · ' + this.saveNote : '') : 'ما في عناصر مضافة للحين.'; }
  _libMark() { this.side.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === this.tool)); }
  _renderItems() {
    this.itemGroup.children.slice().forEach(g => { this.itemGroup.remove(g); g.traverse(o => { if (o.geometry) { o.geometry.boundsTree && o.geometry.disposeBoundsTree(); o.geometry.dispose(); } }); });
    this.itemMeshes = [];
    this.items.forEach(it => { const g = buildItem(it); if (!g) return; this.itemGroup.add(g); g.traverse(o => { if (o.isMesh) { o.geometry.computeBoundsTree(); this.itemMeshes.push(o); } }); });
    if (this.storeys && this.storeys.length) this.applyVis();
    if (this.sel && !this.items.includes(this.sel)) this.sel = null;
    this._selBox();
  }
  _selBox() {
    if (this.hl) { this.scene.remove(this.hl); this.hl.geometry.dispose(); this.hl = null; }
    if (!this.sel) return; const g = this.itemGroup.children.find(x => x.userData.item === this.sel); if (!g) return;
    this.hl = new THREE.Box3Helper(new THREE.Box3().setFromObject(g), 0xff5a1f); this.scene.add(this.hl);
  }
  _place() {
    const targets = this.meshes.filter(m => m.visible && m.parent && m.parent.visible !== false).concat(this.itemMeshes.filter(m => m.parent && m.parent.visible !== false && (!this.moving || m.parent.userData.item !== this.moving)));
    const hits = this.ray.intersectObjects(targets, false), n = new THREE.Vector3();
    const h = hits.find(x => x.face && n.copy(x.face.normal).transformDirection(x.object.matrixWorld).y > 0.6);
    if (!h) { this.hintEl.hidden = false; this.hintEl.textContent = 'اضغط على أرضية أو سطح مستوي.'; return; }
    const p = h.point, cam = this.camera.position;
    if (this.moving) { Object.assign(this.moving, { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) }); this.sel = this.moving; this.moving = null; this._hint(); }
    else { const it = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: this.tool, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), r: +Math.atan2(cam.x - p.x, cam.z - p.z).toFixed(3) };
      if (this.toolColor) it.c = this.toolColor; this.items.push(it); this.sel = it; }
    this._changed(); this._select(this.sel);
  }
  _select(it) {
    this.sel = it; this._selBox(); if (!it) { this.infoEl.hidden = true; return; }
    const d = LIB[it.t];
    this.infoEl.innerHTML = '<b>' + d.i + ' ' + esc(d.l) + '</b><span>عنصر مضاف</span><div class="v3-ibtn"><button type="button" data-ia="rot">⟳ تدوير</button><button type="button" data-ia="move">✥ نقل</button><button type="button" data-ia="copy">📋 نسخ</button><button type="button" data-ia="del">🗑 حذف</button></div>' +
      '<div class="v3-sw">' + [['', 'حسب التصميم']].concat(COLORS).map(([c, l]) => '<button type="button" data-ic="' + c + '" title="' + l + '"' + ((it.c || '') === c ? ' class="on"' : '') + ' style="background:' + (c || 'linear-gradient(135deg,#c79a63 50%,#e4dccd 50%)') + '"></button>').join('') + '</div>' +
      '<button type="button" class="v3-x" aria-label="إغلاق">×</button>';
    this.infoEl.hidden = false;
    this.infoEl.onclick = e => { const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('v3-x')) { this.sel = null; this._selBox(); this.infoEl.hidden = true; return; }
      if (b.dataset.ia) this._itemAct(b.dataset.ia, Math.PI / 4); else if (b.dataset.ic != null) { if (b.dataset.ic) it.c = b.dataset.ic; else delete it.c; this._changed(); this._select(it); } };
  }
  _itemAct(a, ang) {
    const it = this.sel; if (!it) return;
    if (a === 'rot') { it.r = +(((it.r || 0) + ang) % (Math.PI * 2)).toFixed(3); this._changed(); this._selBox(); }
    else if (a === 'move') { this.moving = it; this.tool = null; this._libMark(); this._hint(); }
    else if (a === 'copy') { this.tool = it.t; this.toolColor = it.c || ''; this.moving = null; this._libMark(); this._hint(); const sel = this.side.querySelector('[data-tc]'); if (sel) sel.value = this.toolColor; }
    else if (a === 'del') { this.items = this.items.filter(x => x !== it); this.sel = null; this.infoEl.hidden = true; this._changed(); }
  }
  _changed() {
    this._renderItems(); const st = this.side.querySelector('[data-istat]');
    if (!this.opts.onItems) { if (st) st.textContent = this._itemStat(); return; }
    this.saveNote = 'جاري الحفظ…'; if (st) st.textContent = this._itemStat();
    clearTimeout(this._svT); this._svT = setTimeout(async () => {
      let ok = true; try { ok = (await this.opts.onItems(this.items.map(x => ({ ...x })))) !== false; } catch (e) { ok = false; }
      this.saveNote = ok ? '✓ محفوظ' : '⚠ ما انحفظ، جرّب مرة ثانية'; const s2 = this.side.querySelector('[data-istat]'); if (s2) s2.textContent = this._itemStat();
    }, 700);
  }
  /* ----- picking ----- */
  _pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect(), v = this.locked ? new THREE.Vector2(0, 0) : new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera); this.ray.far = Infinity;
    if (this.tool || this.moving) { this._place(); return; }
    { const ih = this.ray.intersectObjects(this.itemMeshes.filter(m => m.parent && m.parent.visible !== false && m.parent.parent && m.parent.parent.visible !== false), false)[0];
      const mh = this.ray.intersectObjects(this.meshes.filter(m => m.visible && !m.userData.ground), false)[0];
      if (ih && (!mh || ih.distance <= mh.distance + 0.01)) { let o = ih.object; while (o && !(o.userData && o.userData.item)) o = o.parent; if (o) { this._select(o.userData.item); return; } } }
    this.sel = null;
    const hits = this.ray.intersectObjects(this.meshes.filter(m => m.visible && !m.userData.ground && m.parent && m.parent.visible !== false), true);
    if (this.hl) { this.scene.remove(this.hl); this.hl.geometry.dispose(); this.hl = null; }
    const h = hits[0]; if (!h) { this.infoEl.hidden = true; return; }
    let html = '', box = null;
    if (h.object.userData.ifc && h.object.geometry.attributes.eid) {
      const id = h.object.geometry.attributes.eid.getX(h.face.a), I = this.ifc, L = I.line(id) || {}, val = I.val;
      let tn = ''; try { tn = String(I.api.GetNameFromTypeCode(I.api.GetLineType(I.mid, id))).toUpperCase(); } catch (er) { }
      const tt = I.typeName[id] || tn, st = I.storeys[I.storeyOf[id]];
      html = '<b>' + esc(AR_TYPE[tt] || AR_TYPE[tn] || tt.replace(/^IFC/, '')) + '</b><span>' + esc(CATS[h.object.userData.cat] ? CATS[h.object.userData.cat].l : '') + '</span>' +
        (val(L.Name) ? '<div>الاسم: ' + esc(val(L.Name)) + '</div>' : '') + (val(L.ObjectType) ? '<div>النوع: ' + esc(val(L.ObjectType)) + '</div>' : '') + (st ? '<div>الطابق: ' + esc(st.name) + '</div>' : '') + (val(L.Tag) ? '<div class="m">Tag ' + esc(val(L.Tag)) + '</div>' : '') + '<div class="m">IFC ' + esc(tn) + ' #' + id + '</div>';
      // highlight the element's box
      const pa = h.object.geometry.attributes.position, ea = h.object.geometry.attributes.eid; box = new THREE.Box3(); const t = new THREE.Vector3();
      for (let k = 0; k < ea.count; k++) if (ea.getX(k) === id) box.expandByPoint(t.fromBufferAttribute(pa, k));
    } else {
      const names = []; let o = h.object; while (o && o !== this.model) { if (o.name) names.unshift(o.name); o = o.parent; }
      html = '<b>' + esc(names.pop() || ({ walls: 'جدار', windows: 'زجاج / شباك', doors: 'باب', floor: 'أرضية', furniture: 'أثاث', low: 'جلسة / حوض', roof: 'سقف / سطح', stairs: 'درج' }[h.object.userData.cat] || 'عنصر')) + '</b>' + (names.length ? '<span>' + esc(names.slice(-3).join(' › ')) + '</span>' : '') + (h.object.userData.lvl != null && this.storeys[h.object.userData.lvl] ? '<div>' + esc(this.storeys[h.object.userData.lvl].name) + '</div>' : '');
      box = new THREE.Box3().setFromObject(h.object);
      if (h.object.userData.cat) box = null;
    }
    const pt = h.point; html += '<div class="m">ارتفاع النقطة ' + (pt.y - this.box.min.y).toFixed(2) + ' م</div>';
    this.infoEl.innerHTML = html + '<button type="button" class="v3-x" aria-label="إغلاق">×</button>'; this.infoEl.hidden = false;
    this.infoEl.querySelector('.v3-x').onclick = () => { this.infoEl.hidden = true; if (this.hl) { this.scene.remove(this.hl); this.hl = null; } };
    if (box && !box.isEmpty()) { this.hl = new THREE.Box3Helper(box, 0xff5a1f); this.scene.add(this.hl); }
  }
  /* ----- side panel ----- */
  _sideMode() { this.side.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === this.mode)); }
  _side() {
    const s = this.box.getSize(new THREE.Vector3());
    let h = '<div class="v3-modes"><button type="button" data-m="orbit">🔄 لفّ حول المبنى</button><button type="button" data-m="walk">🚶 مشي داخل المبنى</button><button type="button" data-m="top">⬇ من فوق</button><button type="button" data-fs="1">⛶ ملء الشاشة</button></div>';
    h += '<div class="v3-dim">المقاسات تقريباً: ' + s.x.toFixed(1) + ' × ' + s.z.toFixed(1) + ' م، والارتفاع ' + s.y.toFixed(1) + ' م</div>';
    if (this.opts.canEdit !== false) h += '<div class="v3-cats v3-lib"><b>🪑 إضافة أثاث وعناصر</b><span class="v3-note">اختار عنصر واضغط على الأرضية مكان ما تبيه. اضغط على أي عنصر مضاف عشان تدوّره أو تنقله أو تنسخه أو تحذفه. كل شي ينحفظ مع المستند.</span>' +
      '<div class="v3-libgrid">' + Object.entries(LIB).filter(([, d]) => !d.hide).map(([k, d]) => '<button type="button" data-tool="' + k + '"' + (this.tool === k ? ' class="on"' : '') + '><i>' + d.i + '</i>' + esc(d.l) + '</button>').join('') + '</div>' +
      '<label class="v3-f"><span>المادة / اللون</span><select data-tc="1"><option value="">حسب التصميم</option>' + COLORS.map(([c, l]) => '<option value="' + c + '"' + (this.toolColor === c ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<span class="v3-note" data-istat="1">' + this._itemStat() + '</span></div>';
    if (this.ext === 'ifc') {
      if (this.storeys.length > 1) h += '<label class="v3-f"><span>الطوابق</span><select data-st="1"><option value="all">كل المبنى</option>' + this.storeys.map(x => '<option value="' + x.id + '"' + (String(x.id) === String(this.storeySel) ? ' selected' : '') + '>لين ' + esc(x.name) + '</option>').join('') + '</select></label>';
      h += '<div class="v3-cats"><b>الأنظمة في النموذج</b>' + Object.keys(CATS).filter(c => this.counts[c]).map(c => '<label><input type="checkbox" data-cat="' + c + '"' + (this.catOn[c] !== false ? ' checked' : '') + '><i style="background:' + CATS[c].c + '"></i>' + CATS[c].l + ' <small>' + this.counts[c] + '</small></label>').join('') + '</div>';
    } else if (this.parts && this.parts.length > 1 && this.parts.length <= 40) {
      h += '<div class="v3-cats"><b>أجزاء النموذج</b>' + this.parts.map(p => '<label><input type="checkbox" data-cat="' + p.k + '"' + (this.catOn[p.k] !== false ? ' checked' : '') + '>' + esc(p.l) + '</label>').join('') + '</div>';
    } else if (this.set) {
      const S = this.set;
      if (this.storeys.length > 1) h += '<label class="v3-f"><span>الأدوار</span><select data-st="1"><option value="all">كل المبنى</option>' + this.storeys.map(x => '<option value="' + x.id + '"' + (String(x.id) === String(this.storeySel) ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label><span class="v3-note">في وضع المشي: اختار الدور وينقلك له.</span>';
      h += '<div class="v3-modes"><button type="button" data-all="1">👁 إظهار كل التفاصيل</button></div>';
      const CL = { walls: 'الجدران والدراوي', windows: 'الشبابيك', doors: 'الأبواب', stairs: 'الدرج', floor: 'الأرضيات (المخطط مطبوع عليها)', roof: 'السقف والسطح' };
      h += '<div class="v3-cats"><b>عناصر المبنى</b>' + Object.keys(CL).filter(c => this.counts[c]).map(c => '<label><input type="checkbox" data-cat="' + c + '"' + (this.catOn[c] !== false ? ' checked' : '') + '>' + CL[c] + ' <small>' + this.counts[c] + '</small></label>').join('') +
        '<label class="v3-f"><span>مقياس الرسم 1:</span><input type="number" min="1" max="2000" step="1" value="' + this.pdfScale + '" data-ps="1"></label>' +
        '<b style="margin-top:6px">الصفحات اللي انقرت</b><span class="v3-note">' + S.sheets.map(x => 'ص' + (x.i + 1) + ': ' + esc(x.title || '—')).join('<br>') + '</span>' +
        '<span class="v3-note">الجدران من القلم الأسمك في المخطط، والأبواب والشبابيك من الفتحات ورموزها، والمناسيب من القطاع' + (Object.keys(S.levels).length ? '' : ' (ما لقيتها، فاستخدمت 3.6 م للدور)') + '.</span></div>';
    } else if (this.ext === 'dxf' || this.ext === 'pdf') {
      const pdf = this.ext === 'pdf', RL = pdf ? PDF_ROLES : { wall: 'جدران', window: 'شبابيك', door: 'أبواب', skip: 'تجاهل' }, rolesNow = pdf ? this.pdfRoles : this.dxfRoles;
      h += '<div class="v3-cats"><b>طريقة رفع المخطط</b><label class="v3-f"><span>ارتفاع الجدران (م)</span><input type="number" step="0.1" min="2" max="12" value="' + this.dxfH + '" data-dh="1"></label>' +
        (pdf ? '<label class="v3-f"><span>مقياس الرسم 1:</span><input type="number" min="1" max="2000" step="1" value="' + this.pdfScale + '" data-ps="1"></label>' :
        '<label class="v3-f"><span>وحدة الرسم في الملف</span><select data-du="1">' + [[4, 'ملم (mm)'], [5, 'سم (cm)'], [6, 'متر (m)'], [1, 'إنش'], [2, 'قدم']].map(([k, l]) => '<option value="' + k + '"' + (+this.dxfUnits === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>') +
        (pdf ? '<div class="v3-modes" style="margin-top:6px"><button type="button" data-all="1">👁 إظهار كل التفاصيل</button><button type="button" data-auto="1">↺ الإعداد التلقائي</button></div>' : '') +
        (this.furnRead ? '<b style="margin-top:6px">🪑 الأثاث المقروء من المخطط</b><span class="v3-note">' + Object.entries({ rtable: 'طاولة دائرية', otable: 'طاولة طويلة / بيضاوية', chair: 'كرسي', armchair: 'كرسي لاونج', sofa: 'كنبة', pot: 'نبتة' }).filter(([t]) => this.furnRead[t]).map(([t, l]) => l + ': ' + this.furnRead[t]).join('، ') + '. كل قطعة في مكانها واتجاهها حسب الرسم.</span>' : '') +
        '<b style="margin-top:6px">الطبقات (Layers)</b><span class="v3-note">' + (pdf ? 'حدد وش تمثل كل طبقة: الجدران والأعمدة ترتفع، والزجاج يصير واجهات، والأشجار تطلع مجسمة، و"رسم على الأرضية" يطبع الأثاث والممرات والمياه على الأرض.' : 'حدد وش تمثل كل طبقة. الجدران ترتفع للسقف، والشبابيك يصير لها جلسة وزجاج، والأبواب تطلع درفة مفتوحة.') + '</span>' +
        Object.keys(this.dxfCount).sort((a, b) => this.dxfCount[b].n - this.dxfCount[a].n).map(l => '<label class="v3-l"><span title="' + esc(l) + '">' + esc(l) + ' <small>' + this.dxfCount[l].n + '</small></span><select data-layer="' + esc(l) + '">' + Object.entries(RL).map(([k, t]) => '<option value="' + k + '"' + (rolesNow[l] === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>').join('') + '</div>';
    }
    h += '<label class="v3-hq"><input type="checkbox" data-hq="1"' + (this.hq ? ' checked' : '') + '> ✨ جودة عالية (إضاءة وظلال وخامات واقعية، أبطأ على الأجهزة الضعيفة)</label>';
    h += '<div class="v3-help"><b>طريقة الاستخدام</b><span>لفّ: اسحب بالماوس أو بإصبع، وكبّر بالعجلة أو بإصبعين (التكبير يروح للمكان اللي عليه الماوس). دبل كلك على أي غرفة يقرّب لها، والزر اليمين أو Shift مع السحب يحرّك الصورة.</span><span>مشي: على الكمبيوتر W A S D أو الأسهم، والماوس للالتفات، وQ / E للنزول والطلوع بين الطوابق. على الجوال حرّك الدائرة واسحب للالتفات.</span><span>وقت المشي تطلع خريطة صغيرة في الزاوية تبين مكانك بالضبط والسهم اتجاه نظرك، واضغط على أي مكان فيها عشان تنتقل له.</span><span>اضغط على أي عنصر عشان تشوف بياناته.</span></div>';
    this.side.innerHTML = h; this._sideMode();
    this.side.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.m) this.setMode(b.dataset.m);
      if (b.dataset.tool) { this.tool = this.tool === b.dataset.tool ? null : b.dataset.tool; this.moving = null; if (document.pointerLockElement) document.exitPointerLock(); this._hint(); this._libMark(); }
      if (b.dataset.all) { // everything at once: every element on, every layer shown (hidden layers get printed on the floor)
        Object.keys(this.catOn).forEach(c => { this.catOn[c] = true; }); this.storeySel = 'all';
        if (this.ext === 'pdf' && !this.set) { Object.keys(this.pdfRoles).forEach(l => { if (this.pdfRoles[l] === 'skip') this.pdfRoles[l] = 'plan'; }); this.rebuildPdf(); }
        else { this.applyVis(); this._side(); }
      }
      if (b.dataset.auto && this.pdf) { this.pdfRoles = guessPdfRoles(Object.keys(this.dxfCount)); this.rebuildPdf(); }
      if (b.dataset.fs) { const fs = document.fullscreenElement; if (fs) document.exitFullscreen(); else if (this.el.requestFullscreen) this.el.requestFullscreen(); setTimeout(() => this.resize(), 200); }
    };
    this.side.onchange = e => {
      const t = e.target;
      if (t.dataset.hq) { this.hq = t.checked; try { localStorage.setItem('v3-hq', this.hq ? '1' : '0'); } catch (e) { } this.look.setQuality(this.hq); }
      else if (t.dataset.cat) { this.catOn[t.dataset.cat] = t.checked; this.applyVis(); }
      else if (t.dataset.tc != null) { this.toolColor = t.value; }
      else if (t.dataset.st) { this.storeySel = t.value; if (this.mode === 'walk') this.setMode('walk'); else this.applyVis(); }
      else if (t.dataset.layer != null) { if (this.ext === 'pdf') { this.pdfRoles[t.dataset.layer] = t.value; this.rebuildPdf(); } else { this.dxfRoles[t.dataset.layer] = t.value; this.rebuildDxf(); } }
      else if (t.dataset.dh) { this.dxfH = Math.max(2, Math.min(12, +t.value || 3)); if (this.ext === 'pdf') this.rebuildPdf(); else this.rebuildDxf(); }
      else if (t.dataset.ps) { this.pdfScale = Math.max(1, +t.value || 100); if (this.set) this.rebuildSheets(); else this.rebuildPdf(); }
      else if (t.dataset.du) { this.dxfUnits = +t.value; this.rebuildDxf(); }
    };
  }
}
