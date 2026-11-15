/* scenes.js — finds the interior-design views in a presentation PDF.
   A typical page holds one large render and a small key plan with a red frame around the area the render shows.
   For each page this returns where each picture sits on the page and the red frames, all in page units
   (PDF points, y up). No three.js here, so it can be tested on its own. */

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const bboxOf = (m, x0, y0, x1, y1) => { const P = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return { x0: Math.min(...P.map(p => p[0])), x1: Math.max(...P.map(p => p[0])), y0: Math.min(...P.map(p => p[1])), y1: Math.max(...P.map(p => p[1])) }; };
const reddish = c => c && c[0] > 140 && c[1] < 90 && c[2] < 90 && c[0] - Math.max(c[1], c[2]) > 90;

// O: pdfjs.OPS, ol: the page's operator list
export function pageLayout(O, ol) {
  let ctm = [1, 0, 0, 1, 0, 0], stroke = null, path = null; const st = [], imgs = [], marks = [];
  const strokeOps = new Set([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  for (let j = 0; j < ol.fnArray.length; j++) {
    const f = ol.fnArray[j], a = ol.argsArray[j];
    if (f === O.save) st.push([ctm, stroke]);
    else if (f === O.restore) { const s = st.pop(); if (s) [ctm, stroke] = s; }
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.paintFormXObjectBegin) { st.push([ctm, stroke]); if (a && a[0]) ctm = mul(ctm, a[0]); }
    else if (f === O.paintFormXObjectEnd) { const s = st.pop(); if (s) [ctm, stroke] = s; }
    else if (f === O.setStrokeRGBColor) stroke = a && [a[0], a[1], a[2]];
    else if (f === O.constructPath) { const mm = a[2]; path = mm && isFinite(mm[0]) ? bboxOf(ctm, mm[0], mm[2], mm[1], mm[3]) : null; }
    else if (strokeOps.has(f)) { if (path && reddish(stroke) && path.x1 - path.x0 > 4 && path.y1 - path.y0 > 4) marks.push(path); path = null; }
    else if (f === O.endPath || f === O.fill || f === O.eoFill) path = null;
    else if (f === O.paintImageXObject || f === O.paintInlineImageXObject) imgs.push({ j, box: bboxOf(ctm, 0, 0, 1, 1) });
  }
  return { imgs, marks };
}

// a red frame drawn over a picture -> the part of that picture it marks, as fractions (0..1, rows from the top)
export function markOn(mark, box) {
  const w = box.x1 - box.x0, h = box.y1 - box.y0; if (w <= 0 || h <= 0) return null;
  const cx = (mark.x0 + mark.x1) / 2, cy = (mark.y0 + mark.y1) / 2;
  if (cx < box.x0 || cx > box.x1 || cy < box.y0 || cy > box.y1) return null;
  const c = v => Math.max(0, Math.min(1, v));
  return { u0: c((mark.x0 - box.x0) / w), u1: c((mark.x1 - box.x0) / w), v0: c((box.y1 - mark.y1) / h), v1: c((box.y1 - mark.y0) / h) };
}

// the title of a slide: the text nearest the top of the page
export function pageTitle(items, view) {
  const top = view[3], H = top - view[1];
  const near = items.filter(t => t.str && t.str.trim() && t.transform && top - t.transform[5] < H * 0.12).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  if (!near.length) return '';
  const y = near[0].transform[5];
  return near.filter(t => Math.abs(t.transform[5] - y) < 4).map(t => t.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
