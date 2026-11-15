/* plan2d-worker.js — reads walls, floors and furniture from a drawing away from the page, so the screen never freezes while it works. */
import { analyzeSet, recognizeFurniture } from './plan2d.js?v=53';
import { analyzeImages } from './planimg.js?v=53';
const FN = { analyzeSet, recognizeFurniture, analyzeImages };
self.onmessage = e => {
  const { id, fn, args } = e.data;
  try { self.postMessage({ id, ok: true, r: FN[fn](...args) }); } catch (err) { self.postMessage({ id, ok: false, err: String(err && err.message || err) }); }
};
