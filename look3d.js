/* look3d.js — makes the 3D viewer look closer to real: daylight sky, reflections from the surroundings, soft contact shadows
   in corners (ambient occlusion) and material textures (wood grain, marble veins, fabric, plaster, stone) drawn in code, no downloads.
   Materials say what they are with material.userData.look = 'wood' | 'walnut' | 'marble' | 'fabric' | 'leather' | 'plaster' | 'stone' | 'metal' | 'glass' | 'floor'. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- textures drawn on a canvas ---------- */
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function noise2(w, h, cells) { // smooth value noise, 0..1
  const g = []; for (let i = 0; i <= cells; i++) { g.push([]); for (let j = 0; j <= cells; j++) g[i].push(rnd()); }
  for (let i = 0; i <= cells; i++) { g[i][cells] = g[i][0]; } for (let j = 0; j <= cells; j++) g[cells][j] = g[0][j]; // tiles seamlessly
  return (x, y) => { const fx = x / w * cells, fy = y / h * cells, i = Math.floor(fx) % cells, j = Math.floor(fy) % cells, u = fx - Math.floor(fx), v = fy - Math.floor(fy), s = t => t * t * (3 - 2 * t);
    const a = g[i][j], b = g[i + 1][j], c = g[i][j + 1], d = g[i + 1][j + 1]; return a + (b - a) * s(u) + (c - a) * s(v) + (a - b - c + d) * s(u) * s(v); };
}
function canvasTex(size, draw, repeat) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size);
  draw(img.data, size); ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (repeat) t.repeat.set(repeat, repeat); return t;
}
const TEX = {};
const make = {
  // light value around 1 keeps the material's own colour; the texture only adds the grain
  wood: () => { const n = noise2(512, 512, 4), m = noise2(512, 512, 64); return canvasTex(512, (d, S) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ring = Math.sin((y / S * 22 + n(x, y) * 2.5) * Math.PI) * 0.5 + 0.5, v = 0.84 + ring * 0.08 + m(x * 0.05, y) * 0.08, i = (y * S + x) * 4; d[i] = v * 255; d[i + 1] = v * 247; d[i + 2] = v * 235; d[i + 3] = 255; } }); },
  marble: () => { const n = noise2(512, 512, 5), m = noise2(512, 512, 17); return canvasTex(512, (d, S) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const t = Math.abs(Math.sin((x + y) / S * 7 + n(x, y) * 6 + m(x, y) * 2)), vein = Math.pow(1 - t, 18), v = 0.97 - vein * 0.35 - m(x, y) * 0.04, i = (y * S + x) * 4; d[i] = v * 255; d[i + 1] = v * 254; d[i + 2] = v * 252; d[i + 3] = 255; } }); },
  fabric: () => canvasTex(256, (d, S) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = 0.86 + ((x % 4 < 2) !== (y % 4 < 2) ? 0.06 : 0) + rnd() * 0.08, i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v * 255; d[i + 3] = 255; } }),
  leather: () => { const n = noise2(256, 256, 48); return canvasTex(256, (d, S) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = 0.84 + n(x, y) * 0.14 + rnd() * 0.03, i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v * 255; d[i + 3] = 255; } }); },
  plaster: () => { const n = noise2(512, 512, 24), m = noise2(512, 512, 90); return canvasTex(512, (d, S) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = 0.93 + n(x, y) * 0.04 + m(x, y) * 0.03, i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v * 255; d[i + 3] = 255; } }); },
  stone: () => { const n = noise2(512, 512, 10), m = noise2(512, 512, 70); return canvasTex(512, (d, S) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const band = Math.sin((y / S * 12 + n(x, y) * 3) * Math.PI) * 0.5 + 0.5, pore = m(x, y) < 0.18 ? 0.82 : 1, v = (0.86 + band * 0.08 + rnd() * 0.04) * pore, i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v * 255; d[i + 3] = 255; } }); }
};
const tex = k => TEX[k] || (TEX[k] = make[k]());
// how many metres one copy of the texture covers
const LOOK = {
  wood: { t: 'wood', s: 0.9, rough: 0.55, env: 0.6 }, walnut: { t: 'wood', s: 0.9, rough: 0.5, env: 0.6 }, marble: { t: 'marble', s: 1.2, rough: 0.18, env: 1.1 },
  fabric: { t: 'fabric', s: 0.25, rough: 0.95, env: 0.3 }, leather: { t: 'leather', s: 0.5, rough: 0.45, env: 0.6 }, plaster: { t: 'plaster', s: 2.5, rough: 0.92, env: 0.35 },
  stone: { t: 'stone', s: 1.2, rough: 0.7, env: 0.5 }, paving: { t: 'stone', s: 4, rough: 0.95, env: 0.3 }, metal: { env: 1.2 }, glass: { env: 0.7 }, floor: { env: 0.45 }
};

// texture coordinates in metres, projected from the side each face looks at (so long walls are not stretched)
export function boxUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal; if (!p || !n) return;
  let uv = g.attributes.uv; if (!uv || uv.count !== p.count) { uv = new THREE.BufferAttribute(new Float32Array(p.count * 2), 2); g.setAttribute('uv', uv); }
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) uv.setXY(i, x / s, z / s); else if (ax >= az) uv.setXY(i, z / s, y / s); else uv.setXY(i, x / s, y / s);
  }
  uv.needsUpdate = true;
}

// textures and reflections on everything in the model that says what it is made of
export function dressModel(root, hq) {
  const done = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    [].concat(o.material).forEach(m => {
      if (!m || !m.isMeshStandardMaterial) return;
      const L = LOOK[m.userData.look];
      if (!done.has(m)) { done.add(m); m.envMapIntensity = L ? L.env : 0.5;
        if (L && L.t && hq) { m.map = tex(L.t); m.bumpMap = m.map; m.bumpScale = L.t === 'fabric' || L.t === 'leather' ? 1.2 : 0.6; if (L.rough != null) m.roughness = L.rough; }
        else if (L && L.t && !hq) { m.map = null; m.bumpMap = null; }
        m.needsUpdate = true; }
      if (L && L.t && hq && !o.isInstancedMesh && !o.geometry.userData.uvMetres) { boxUV(o.geometry, L.s); o.geometry.userData.uvMetres = true; }
    });
  });
}

/* ---------- light, sky, reflections, corner shadows ---------- */
export class Look {
  constructor(viewer) {
    this.v = viewer; const r = viewer.renderer;
    const pm = new THREE.PMREMGenerator(r); this.env = pm.fromScene(new RoomEnvironment(r), 0.04).texture; pm.dispose();
    viewer.scene.environment = this.env;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.82;
    const hemi = viewer.scene.children.find(o => o.isHemisphereLight); if (hemi) hemi.intensity = 0.55; viewer.sun.intensity = 3.0; // the surroundings now light the shadows, so less flat fill
    this.sky = new Sky(); this.sky.scale.setScalar(1e5); this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms; u.turbidity.value = 5; u.rayleigh.value = 1.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    viewer.scene.add(this.sky); this.hq = false;
    // how strong is the graphics card: phones, software rendering and older integrated chips get the lighter settings
    let gpu = ''; try { const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { }
    this.gpu = String(gpu || '');
    this.weak = matchMedia('(pointer:coarse)').matches || /SwiftShader|llvmpipe|softpipe|Mali|Adreno|PowerVR|Intel.*(HD|UHD) Graphics|Microsoft Basic/i.test(this.gpu) || (r.capabilities.maxTextureSize || 0) < 8192;
    this.noAO = this.weak; this.checks = 0;
  }
  // the sun in the sky follows the light that casts the shadows
  placeSun(dir) { this.sky.material.uniforms.sunPosition.value.copy(dir).normalize(); }
  setQuality(hq) {
    const v = this.v, r = v.renderer; this.hq = hq;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, hq ? 1.25 : 1.5));
    const ao = hq && !this.noAO;
    if (ao && !this.composer) {
      const s = r.getSize(new THREE.Vector2());
      this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples: 4 }));
      this.composer.addPass(new RenderPass(v.scene, v.camera));
      this.ao = new GTAOPass(v.scene, v.camera, s.x, s.y);
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.4, samples: 12 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
      this.ao.blendIntensity = 1.0;
      this.composer.addPass(this.ao); this.composer.addPass(new OutputPass());
    }
    if (!ao && this.composer) this.dropAO();
    this.resize(); dressModel(v.scene, hq); v.dirty = true;
  }
  resize() { if (!this.composer) return; const s = this.v.renderer.getSize(new THREE.Vector2()); this.composer.setPixelRatio(this.v.renderer.getPixelRatio()); this.composer.setSize(s.x, s.y); }
  // while the view moves: a plain fast frame; once it stops: the full frame with corner shadows
  render(moving) {
    if (!this.composer || moving) { this.v.renderer.render(this.v.scene, this.v.camera); return; }
    if (this.checks >= 3) { this.composer.render(); return; }
    // the first full frames are timed (reading one pixel waits for the card to finish): too slow means no corner shadows on this device
    const t = performance.now(); this.composer.render();
    try { const gl = this.v.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); } catch (e) { }
    const ms = performance.now() - t; this.checks++;
    if (ms > 90 && this.checks > 1) { this.noAO = true; this.dropAO(); this.v.dirty = true; if (this.onAuto) this.onAuto(); }
  }
  dropAO() { if (!this.composer) return; this.composer.dispose(); this.ao.dispose(); this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); this.composer = null; this.ao = null; }
  // a slow device: draw fewer pixels (down to 3/4 of the screen) rather than stutter
  slower() { const r = this.v.renderer, pr = r.getPixelRatio(); if (pr <= 0.76) return false; r.setPixelRatio(Math.max(0.75, pr - 0.25)); this.resize(); return true; }
  dispose() { this.dropAO(); this.env.dispose(); this.sky.material.dispose(); this.sky.geometry.dispose(); }
}
