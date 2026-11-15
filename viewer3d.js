// 3D viewer for project drawings: IFC (Revit / Archicad), GLB / glTF (SketchUp, Blender…) and AutoCAD DXF plans.
// Orbit around the building or walk inside it (mouse + keyboard on a computer, joystick + drag on a phone).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from './vendor/three-mesh-bvh/index.module.js';

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

/* ---------- viewer ---------- */
export class Viewer {
  constructor(opts) {
    this.opts = opts || {};
    this.el = document.createElement('div'); this.el.className = 'v3';
    this.el.innerHTML = '<div class="v3-stage"><div class="v3-msg">جاري تجهيز العارض…</div><div class="v3-joy" hidden><i></i></div><div class="v3-hint" hidden></div><div class="v3-info" hidden></div></div><aside class="v3-side"></aside>';
    this.stage = this.el.querySelector('.v3-stage'); this.side = this.el.querySelector('.v3-side');
    this.msgEl = this.el.querySelector('.v3-msg'); this.infoEl = this.el.querySelector('.v3-info'); this.hintEl = this.el.querySelector('.v3-hint');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.stage.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#e9edf1');
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 5000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(30, 60, 20); this.scene.add(sun);
    this.model = new THREE.Group(); this.scene.add(this.model);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement); this.orbit.enableDamping = true;
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
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  dispose() {
    this.alive = false; window.removeEventListener('resize', this._onResize); document.removeEventListener('keydown', this._kd); document.removeEventListener('keyup', this._ku);
    document.removeEventListener('pointerlockchange', this._plc); document.removeEventListener('mousemove', this._mm);
    this.model.traverse(o => { if (o.geometry) { o.geometry.disposeBoundsTree && o.geometry.boundsTree && o.geometry.disposeBoundsTree(); o.geometry.dispose(); } if (o.material) [].concat(o.material).forEach(m => m.dispose()); });
    this.renderer.dispose(); this.el.remove();
  }
  _bind() {
    this._onResize = () => this.resize(); window.addEventListener('resize', this._onResize);
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.stage);
    this._kd = e => { if (this.mode !== 'walk' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return; this.keys[e.code] = true; if (/Arrow|Space/.test(e.code)) e.preventDefault(); };
    this._ku = e => { this.keys[e.code] = false; };
    document.addEventListener('keydown', this._kd); document.addEventListener('keyup', this._ku);
    const cv = this.renderer.domElement;
    this._plc = () => { this.locked = document.pointerLockElement === cv; this._hint(); };
    this._mm = e => { if (this.locked) this._look(e.movementX, e.movementY, 0.0022); };
    document.addEventListener('pointerlockchange', this._plc); document.addEventListener('mousemove', this._mm);
    let down = null;
    cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now() }; if (this.mode === 'walk' && e.pointerType === 'touch') cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (this.mode === 'walk' && e.pointerType !== 'mouse' && down && down.id === e.pointerId) { this._look(e.clientX - down.x, e.clientY - down.y, 0.005); down.x = e.clientX; down.y = e.clientY; down.moved = true; } });
    cv.addEventListener('pointerup', e => {
      if (!down) return; const moved = down.moved || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5; const d0 = down; down = null;
      if (this.mode === 'walk' && e.pointerType === 'mouse' && !this.locked) { cv.requestPointerLock && cv.requestPointerLock(); return; }
      if (!moved && Date.now() - d0.t < 400) this._pick(e);
    });
    // phone joystick
    const joy = this.el.querySelector('.v3-joy'), knob = joy.querySelector('i'); let jid = null, jc = null;
    joy.addEventListener('pointerdown', e => { jid = e.pointerId; const r = joy.getBoundingClientRect(); jc = { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 }; joy.setPointerCapture(e.pointerId); e.preventDefault(); });
    joy.addEventListener('pointermove', e => { if (e.pointerId !== jid) return; let dx = e.clientX - jc.x, dy = e.clientY - jc.y; const d = Math.hypot(dx, dy); if (d > jc.R) { dx *= jc.R / d; dy *= jc.R / d; } knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; this.move = { x: dx / jc.R, y: -dy / jc.R }; });
    const end = () => { jid = null; knob.style.transform = ''; this.move = { x: 0, y: 0 }; };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  }
  _look(dx, dy, k) { this.yaw -= dx * k; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * k)); }
  _hint() {
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
    if (m === 'walk') {
      this.orbit.enabled = false;
      // Start just outside the front of the building, at eye height on the lowest floor, facing it.
      const st = this._startPoint();
      this.camera.position.copy(st.pos); this.yaw = st.yaw; this.pitch = 0; this.vy = 0;
    } else {
      this.orbit.enabled = true;
      if (m === 'top') { this.camera.position.set(c.x, this.box.max.y + R * 1.2, c.z + 0.001); this.orbit.target.copy(c); }
      else { this.camera.position.set(c.x + R * 0.9, c.y + R * 0.7, c.z + R * 1.1); this.orbit.target.copy(c); }
      this.orbit.update();
    }
    this._hint(); this._sideMode();
  }
  // A spot inside the building on the lowest floor, away from walls; otherwise just outside the front.
  _startPoint() {
    const b = this.box, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()), cols = this._colliders();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => new THREE.Vector3(x, 0, z)), cand = [];
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) cand.push([c.x + s.x * i / 14, c.z + s.z * j / 14]);
    cand.sort((p, q) => Math.hypot(p[0] - c.x, p[1] - c.z) - Math.hypot(q[0] - c.x, q[1] - c.z));
    for (const [x, z] of cand) {
      const g = this._groundAt(new THREE.Vector3(x, b.min.y + 1.2, z)); if (g == null || g > b.min.y + 1.2) continue;
      const pos = new THREE.Vector3(x, g + 1.6, z); let ok = true, far = 0, best = 0;
      for (const [k, d] of dirs.entries()) {
        this.ray.set(new THREE.Vector3(x, g + 1.0, z), d); this.ray.far = 40;
        const h = this.ray.intersectObjects(cols, false)[0];
        if (!h) { ok = false; break; } if (h.distance < 0.7) { ok = false; break; } if (h.distance > far) { far = h.distance; best = k; }
      }
      if (ok) return { pos, yaw: [-Math.PI / 2, Math.PI / 2, Math.PI, 0][best] };
    }
    return { pos: new THREE.Vector3(c.x, b.min.y + 1.6, b.max.z + 2.5), yaw: 0 };
  }
  _colliders() { return this.meshes.filter(m => m.visible && !m.userData.noCollide); }
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
    } else this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }
  /* ----- loading ----- */
  async load(buf, ext) {
    this.ext = ext;
    try {
      if (ext === 'ifc') await this._loadIfc(buf);
      else if (ext === 'glb' || ext === 'gltf') await this._loadGltf(buf);
      else if (ext === 'dxf') this._loadDxf(new TextDecoder().decode(buf));
      else throw new Error('نوع الملف غير مدعوم');
    } catch (e) { console.error(e); this.msg('ما قدرت أفتح الملف: ' + (e.message || e)); return false; }
    this._finish(); return true;
  }
  _finish() {
    this.meshes = []; this.model.traverse(o => { if (o.isMesh) { this.meshes.push(o); o.geometry.computeBoundsTree(); } });
    this.box = new THREE.Box3().setFromObject(this.model);
    if (this.box.isEmpty()) { this.msg('الملف ما فيه عناصر ثلاثية الأبعاد.'); return; }
    const s = this.box.getSize(new THREE.Vector3()), R = Math.max(s.x, s.y, s.z);
    this.camera.near = Math.max(0.02, R / 5000); this.camera.far = R * 20; this.camera.updateProjectionMatrix();
    // ground plane
    const c = this.box.getCenter(new THREE.Vector3());
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(R * 3, 48), new THREE.MeshLambertMaterial({ color: '#cfd6cc' }));
    gnd.rotation.x = -Math.PI / 2; gnd.position.set(c.x, this.box.min.y - 0.01, c.z); gnd.userData.ground = true; this.scene.add(gnd); this.meshes.push(gnd); gnd.geometry.computeBoundsTree();
    this.msg(''); this.setMode('orbit'); this._side();
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
  rebuildDxf() {
    this.scene.children.filter(o => o.userData.ground).forEach(o => this.scene.remove(o));
    this._buildDxf(); this._finish();
  }
  /* ----- filters ----- */
  applyVis() {
    const sel = this.storeySel, selE = sel === 'all' ? null : (this.storeys.find(s => String(s.id) === String(sel)) || {}).elev;
    this.model.traverse(o => {
      if (!o.isMesh) return; const u = o.userData;
      let on = true;
      if (u.cat && this.catOn[u.cat] === false) on = false;
      if (u.part && this.catOn[u.part] === false) on = false;
      if (on && selE != null && u.ifc) { const s = this.ifc.storeys[u.st]; on = !!s && s.elev <= selE + 0.01; }
      if (o.userData.ifc != null || u.cat || u.part) o.visible = on;
    });
    // GLB parts are groups: toggle the group itself
    (this.parts || []).forEach(p => { p.o.visible = this.catOn[p.k] !== false; });
  }
  /* ----- picking ----- */
  _pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera); this.ray.far = Infinity;
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
      html = '<b>' + esc(names.pop() || ({ walls: 'جدار', windows: 'شباك', doors: 'باب', floor: 'أرضية' }[h.object.userData.cat] || 'عنصر')) + '</b>' + (names.length ? '<span>' + esc(names.slice(-3).join(' › ')) + '</span>' : '');
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
    if (this.ext === 'ifc') {
      if (this.storeys.length > 1) h += '<label class="v3-f"><span>الطوابق</span><select data-st="1"><option value="all">كل المبنى</option>' + this.storeys.map(x => '<option value="' + x.id + '"' + (String(x.id) === String(this.storeySel) ? ' selected' : '') + '>لين ' + esc(x.name) + '</option>').join('') + '</select></label>';
      h += '<div class="v3-cats"><b>الأنظمة في النموذج</b>' + Object.keys(CATS).filter(c => this.counts[c]).map(c => '<label><input type="checkbox" data-cat="' + c + '"' + (this.catOn[c] !== false ? ' checked' : '') + '><i style="background:' + CATS[c].c + '"></i>' + CATS[c].l + ' <small>' + this.counts[c] + '</small></label>').join('') + '</div>';
    } else if (this.parts && this.parts.length > 1 && this.parts.length <= 40) {
      h += '<div class="v3-cats"><b>أجزاء النموذج</b>' + this.parts.map(p => '<label><input type="checkbox" data-cat="' + p.k + '"' + (this.catOn[p.k] !== false ? ' checked' : '') + '>' + esc(p.l) + '</label>').join('') + '</div>';
    } else if (this.ext === 'dxf') {
      const RL = { wall: 'جدران', window: 'شبابيك', door: 'أبواب', skip: 'تجاهل' };
      h += '<div class="v3-cats"><b>طريقة رفع المخطط</b><label class="v3-f"><span>ارتفاع الجدران (م)</span><input type="number" step="0.1" min="2" max="12" value="' + this.dxfH + '" data-dh="1"></label>' +
        '<label class="v3-f"><span>وحدة الرسم في الملف</span><select data-du="1">' + [[4, 'ملم (mm)'], [5, 'سم (cm)'], [6, 'متر (m)'], [1, 'إنش'], [2, 'قدم']].map(([k, l]) => '<option value="' + k + '"' + (+this.dxfUnits === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
        '<b style="margin-top:6px">الطبقات (Layers)</b><span class="v3-note">حدد وش تمثل كل طبقة. الجدران ترتفع للسقف، والشبابيك يصير لها جلسة وزجاج، والأبواب تطلع درفة مفتوحة.</span>' +
        Object.keys(this.dxfCount).sort((a, b) => this.dxfCount[b].n - this.dxfCount[a].n).map(l => '<label class="v3-l"><span title="' + esc(l) + '">' + esc(l) + ' <small>' + this.dxfCount[l].n + '</small></span><select data-layer="' + esc(l) + '">' + Object.entries(RL).map(([k, t]) => '<option value="' + k + '"' + (this.dxfRoles[l] === k ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>').join('') + '</div>';
    }
    h += '<div class="v3-help"><b>طريقة الاستخدام</b><span>لفّ: اسحب بالماوس أو بإصبع، وكبّر بالعجلة أو بإصبعين.</span><span>مشي: على الكمبيوتر W A S D أو الأسهم، والماوس للالتفات، وQ / E للنزول والطلوع بين الطوابق. على الجوال حرّك الدائرة واسحب للالتفات.</span><span>اضغط على أي عنصر عشان تشوف بياناته.</span></div>';
    this.side.innerHTML = h; this._sideMode();
    this.side.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.m) this.setMode(b.dataset.m);
      if (b.dataset.fs) { const fs = document.fullscreenElement; if (fs) document.exitFullscreen(); else if (this.el.requestFullscreen) this.el.requestFullscreen(); setTimeout(() => this.resize(), 200); }
    };
    this.side.onchange = e => {
      const t = e.target;
      if (t.dataset.cat) { this.catOn[t.dataset.cat] = t.checked; this.applyVis(); }
      else if (t.dataset.st) { this.storeySel = t.value; this.applyVis(); }
      else if (t.dataset.layer != null) { this.dxfRoles[t.dataset.layer] = t.value; this.rebuildDxf(); }
      else if (t.dataset.dh) { this.dxfH = Math.max(2, Math.min(12, +t.value || 3)); this.rebuildDxf(); }
      else if (t.dataset.du) { this.dxfUnits = +t.value; this.rebuildDxf(); }
    };
  }
}
