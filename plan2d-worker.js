/* plan2d-worker.js — reads walls, floors and furniture from a drawing away from the page, so the screen never freezes while it works. */
import { analyzeSet, recognizeFurniture } from './plan2d.js?v=53';
import { analyzeImages } from './planimg.js?v=55';
import { dwgToDxf } from './dwg.js?v=53';
const FN = { analyzeSet, recognizeFurniture, analyzeImages, dwgToDxf };
self.onmessage = e => {
  const { id, fn, args } = e.data;
  Promise.resolve().then(() => FN[fn](...args)).then(r => self.postMessage({ id, ok: true, r }), err => self.postMessage({ id, ok: false, err: String(err && err.message || err) }));
};
