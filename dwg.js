/* dwg.js — opens AutoCAD DWG drawings: the open-source LibreDWG reader (WebAssembly, loaded only when a DWG is opened)
   turns the DWG into DXF text, and the existing DXF reader takes it from there. */
let mod = null;
export async function dwgToDxf(buf) {
  if (!mod) mod = await (await import('./vendor/libredwg/libredwg-web.js?v=53')).default();
  const M = mod, src = 'in.dwg', out = 'out.dxf';
  M.FS.writeFile(src, new Uint8Array(buf));
  try {
    const err = M.dwg_write_dxf(src, out);
    if (!M.FS.analyzePath(out).exists) throw new Error('DWG ' + err);
    const bytes = M.FS.readFile(out); if (bytes.length < 200) throw new Error('DWG ' + err);
    return new TextDecoder().decode(bytes);
  } finally { for (const f of [src, out]) { try { M.FS.unlink(f); } catch (e) { } } }
}
