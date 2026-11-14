/* Built-in BOQ engine: reads BOQ rows, assigns departments by keywords, and plans dates per item.
   No AI and no network: everything runs in the browser and gives the same result every time. */
(function (root) {
  'use strict';

  /* ---------- reading ---------- */
  const H = {
    code: /^(item|no\.?|s\.?\s*no|sr\.?|ref|wbs|code|بند|البند|رقم|رقم البند|م)\b|wbs|code no|item no|رقم البند/i,
    desc: /desc|description|item description|particular|scope|works?|الوصف|البيان|وصف|الأعمال|بيان الأعمال/i,
    qty: /^(qty|qnty|quantity|quant)|الكمية|كمية/i,
    unit: /^(unit|uom|u\.o\.m)$|^unit\b|الوحدة|وحدة/i,
    rate: /rate|unit\s*price|price\s*\/\s*unit|سعر الوحدة|الفئة|السعر الافرادي|سعر/i,
    total: /amount|total|total price|value|المبلغ|الإجمالي|الاجمالي|القيمة|المجموع/i
  };
  const SKIP = /carried|summary|sub\s*-?\s*total|grand\s*total|total\b.*(works?|section)|vat|ضريبة|المجموع|الإجمالي|الاجمالي|مرحّل|مرحل|ملخص/i;
  const num = v => {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    let s = String(v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.').replace(/[,\s٬]/g, '').replace(/(ر\.?ع|omr|ro|rial[s]?)/ig, '');
    if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
    return +s;
  };
  const str = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
  const isCode = s => /^[A-Za-z]{0,3}[-\s]?\d+([.\-/]\d+)*[A-Za-z]?\.?$/.test(s) && s.length <= 14;

  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const map = {};
      (rows[r] || []).forEach((c, i) => {
        const t = str(c); if (!t || t.length > 40) return;
        for (const k of ['qty', 'unit', 'rate', 'total', 'desc', 'code']) {
          if (map[k] == null && H[k].test(t)) {
            if (k === 'total' && map.rate == null && /unit/i.test(t)) continue;
            if (k === 'rate' && /total/i.test(t)) continue;
            map[k] = i; break;
          }
        }
      });
      if (map.desc != null && (map.qty != null || map.total != null)) {
        // A garbled "Unit Rate" heading (scans): the unnamed column just before the total is the rate.
        if (map.rate == null && map.total != null) {
          const used = Object.values(map), after = Math.max(map.qty == null ? -1 : map.qty, map.unit == null ? -1 : map.unit);
          for (let i = map.total - 1; i > after; i--) if (!used.includes(i)) { map.rate = i; break; }
        }
        return { row: r, map };
      }
    }
    return null;
  }
  function guessColumns(rows) {
    // No header row: description = column with the longest texts, numbers = the numeric columns in order.
    const stats = {};
    rows.slice(0, 300).forEach(row => (row || []).forEach((c, i) => {
      const s = stats[i] = stats[i] || { txt: 0, len: 0, num: 0, code: 0 };
      const t = str(c); if (!t) return;
      if (!isNaN(num(c))) s.num++; else { s.txt++; s.len += t.length; }
      if (isCode(t) && /[.]/.test(t)) s.code++;
    }));
    const cols = Object.keys(stats).map(Number);
    const desc = cols.sort((a, b) => stats[b].len - stats[a].len)[0];
    const code = cols.filter(i => i !== desc).sort((a, b) => stats[b].code - stats[a].code)[0];
    const nums = Object.keys(stats).map(Number).filter(i => i !== code && stats[i].num > stats[i].txt).sort((a, b) => a - b);
    const unitCol = Object.keys(stats).map(Number).filter(i => i !== desc && i !== code && !nums.includes(i) && stats[i].txt > 0).sort((a, b) => Math.abs(a - nums[0]) - Math.abs(b - nums[0]))[0];
    const m = { code, desc, unit: unitCol };
    if (nums.length >= 3) { m.qty = nums[0]; m.rate = nums[nums.length - 2]; m.total = nums[nums.length - 1]; }
    else if (nums.length === 2) { m.qty = nums[0]; m.total = nums[1]; }
    else if (nums.length === 1) m.total = nums[0];
    return { row: -1, map: m };
  }

  // rows: array of arrays (one per sheet row). Returns { sections:[[code,name]], items:[...], stated, warnings:[] }.
  function parseRows(rows, prev) {
    const out = prev || { sections: [], items: [], stated: 0, warnings: [] };
    rows = rows.filter(r => r && r.some(c => str(c)));
    if (!rows.length) return out;
    const hd = findHeader(rows) || guessColumns(rows);
    const m = hd.map; let curSec = null, curSub = '', last = null;
    const cell = (row, k) => m[k] == null ? '' : row[m[k]];
    for (let r = hd.row + 1; r < rows.length; r++) {
      const row = rows[r];
      let code = str(cell(row, 'code')), desc = str(cell(row, 'desc'));
      // Code and description sometimes share a cell: "3.4 Steel deck"
      if (!code && /^(\d+(\.\d+)*)\s+\S/.test(desc) && m.code == null) { code = desc.match(/^(\d+(\.\d+)*)/)[1]; desc = desc.slice(code.length).trim(); }
      code = code.replace(/\.$/, '');
      const qty = num(cell(row, 'qty')), rate = num(cell(row, 'rate')), total = num(cell(row, 'total'));
      const joined = row.map(str).join(' ');
      if (!code && SKIP.test(joined)) {
        // Totals printed in the file, used to check what was read: sub-total (before VAT), section totals carried to the summary, grand total.
        const nums = row.map(num).filter(x => !isNaN(x) && x > 0), v = !isNaN(total) ? total : nums[nums.length - 1];
        if (v) {
          if (/sub\s*-?\s*total|قبل الضريبة|المجموع الفرعي/i.test(joined)) out.statedSub = Math.max(out.statedSub || 0, v);
          else if (/grand\s*total|المجموع الكلي|الإجمالي الكلي/i.test(joined)) out.statedGrand = Math.max(out.statedGrand || 0, v);
          else if (/carried|مرحّل|مرحل/i.test(joined)) out.carried = (out.carried || 0) + v;
        }
        last = null; continue;
      }
      // A bare "Total" line with no item number is a total row, not an item.
      if (!code && /^\s*(total|المجموع|الإجمالي|الاجمالي|الإجمالى)(\s|:|$)/i.test(desc)) { if (!isNaN(total)) out.stated = Math.max(out.stated, total); last = null; continue; }
      if (SKIP.test(desc) && isNaN(qty)) { last = null; continue; }
      const priced = !isNaN(qty) || !isNaN(total) || !isNaN(rate);
      if (!priced) {
        if (code && desc) {
          if (!/[.]/.test(code)) { curSec = code; curSub = ''; if (!out.sections.find(s => s[0] === code)) out.sections.push([code, desc]); }
          else curSub = desc;
          last = null;
        } else if (!code && desc && last) last.desc = (last.desc + ' ' + desc).trim(); // wrapped description
        else if (!code && desc && !last && desc.length < 60) curSub = desc;
        continue;
      }
      if (!desc && !code) continue;
      const sec = (code && code.split(/[.\-/]/)[0]) || curSec || 'عام';
      if (!out.sections.find(s => s[0] === sec)) out.sections.push([sec, sec === curSec ? (out.sections.find(s => s[0] === curSec) || [])[1] || 'قسم ' + sec : 'قسم ' + sec]);
      const q = isNaN(qty) ? 1 : qty, rt = isNaN(rate) ? (isNaN(total) ? 0 : total / q) : rate;
      const tt = isNaN(total) ? q * rt : total;
      if (!isNaN(qty) && !isNaN(rate) && !isNaN(total) && Math.abs(qty * rate - total) > Math.max(1, total * 0.05)) out.warnings.push('البند ' + (code || desc.slice(0, 20)) + ': الكمية × السعر لا يساوي الإجمالي');
      last = { code: code || String(out.items.length + 1), desc, qty: q, unit: str(cell(row, 'unit')), rate: Math.round(rt * 1000) / 1000, total: tt, sec, sub: curSub, dept: null };
      out.items.push(last);
    }
    out.stated = out.statedSub || out.carried || out.statedGrand || out.stated || 0;
    return out;
  }
  function parseText(text) {
    return parseRows(text.split(/\r?\n/).map(l => l.split('\t')));
  }

  /* ---------- departments ---------- */
  const KW = {
    supervision: ['supervision', 'site visit', 'visits', 'consultan', 'project manag', 'testing', 'commissioning', 'inspection', 'handover', 'hand over', 'as-built', 'as built', 'warranty', 'o&m', 'operation and maintenance', 'preliminar', 'mobiliz', 'mobilis', 'site establishment', 'insurance', 'final cleaning',
      'إشراف', 'اشراف', 'زيارات', 'زيارة', 'تمهيدات', 'تجهيز الموقع', 'فحص', 'تشغيل', 'تسليم', 'ضمان', 'تأمين', 'إدارة المشروع', 'استشار'],
    arch: ['architectural', 'design', 'drawing', 'permit', 'approval', 'municipal', 'authorit', 'civil defen', 'concept', 'structural analysis', 'survey', 'boq prep',
      'تصميم', 'مخطط', 'مخططات', 'رخصة', 'ترخيص', 'بلدية', 'الدفاع المدني', 'اعتماد', 'رفع مساحي', 'جدول كميات'],
    interior: ['interior design', '3d', 'render', 'ff&e', 'mood board', 'finishes schedule', 'material board',
      'تصميم داخلي', 'التصميم الداخلي', 'ثلاثي الأبعاد', 'لوحة المواد'],
    joinery: ['joinery', 'carpentry', 'timber', 'wood', 'wooden', 'mdf', 'veneer', 'plywood', 'cabinet', 'wardrobe', 'counter', 'reception desk', 'vanity', 'kitchen', 'shelv', 'custom furniture', 'built-in', 'door frame', 'skirting',
      'خشب', 'خشبي', 'خشبية', 'نجارة', 'منجرة', 'خزائن', 'خزانة', 'كاونتر', 'مطبخ', 'رفوف', 'أثاث', 'اثاث', 'قشرة'],
    fitout: ['gypsum', 'ceiling', 'partition', 'paint', 'emulsion', 'floor finish', 'epoxy', 'vinyl', 'lvt', 'carpet', 'tile', 'tiling', 'porcelain', 'ceramic', 'marble', 'granite', 'wallpaper', 'cladding', 'glass', 'glazing', 'frameless', 'aluminium', 'aluminum', 'signage', 'curtain', 'blind', 'acoustic', 'raised floor', 'decorat', 'feature wall', 'light fitting', 'lighting', 'furniture install',
      'جبس', 'جبسي', 'سقف', 'أسقف', 'اسقف', 'قواطع', 'قاطع', 'دهان', 'طلاء', 'بلاط', 'سيراميك', 'بورسلان', 'رخام', 'جرانيت', 'أرضيات', 'ارضيات', 'إيبوكسي', 'ايبوكسي', 'فينيل', 'موكيت', 'ورق جدران', 'تكسية', 'زجاج', 'زجاجي', 'ألمنيوم', 'المنيوم', 'لوحات', 'ستائر', 'ديكور', 'إنارة', 'انارة'],
    contracting: ['excavat', 'backfill', 'concrete', 'reinforc', 'rebar', 'steel', 'beam', 'column', 'foundation', 'footing', 'slab', 'block', 'masonry', 'plaster', 'render coat', 'waterproof', 'insulation', 'deck', 'screed', 'asphalt', 'interlock', 'paving', 'fence', 'demolition', 'removal', 'dismantl', 'structural', 'precast', 'roof',
      'electrical', 'wiring', 'cable', 'db ', 'distribution board', 'socket', 'switch', 'hvac', 'air condition', 'duct', 'split unit', 'chiller', 'plumbing', 'drainage', 'sanitary', 'water supply', 'pipe', 'fire alarm', 'fire fighting', 'sprinkler', 'extinguisher', 'cctv', 'access control', 'data network', 'network', 'mep',
      'حفر', 'ردم', 'خرسانة', 'خرساني', 'حديد', 'تسليح', 'أساسات', 'اساسات', 'قواعد', 'بلوك', 'مباني', 'لياسة', 'محارة', 'عزل', 'هدم', 'إزالة', 'ازالة', 'سياج', 'رصف', 'إنشائي', 'انشائي', 'هيكل', 'سقف خرساني',
      'كهرباء', 'كهربائي', 'كابلات', 'أسلاك', 'تكييف', 'مكيفات', 'دكت', 'سباكة', 'صرف', 'صحي', 'تمديدات', 'مواسير', 'حريق', 'إطفاء', 'انذار', 'إنذار', 'كاميرات', 'مراقبة', 'شبكات', 'شبكة']
  };
  const ORDER = ['supervision', 'interior', 'arch', 'joinery', 'fitout', 'contracting'];
  function scoreText(t, w, sc) {
    t = ' ' + String(t || '').toLowerCase() + ' ';
    ORDER.forEach(d => KW[d].forEach(k => { if (t.indexOf(k) >= 0) sc[d] = (sc[d] || 0) + w * (k.length > 6 ? 1.3 : 1); }));
  }
  function deptOf(item, secName) {
    const sc = {};
    scoreText(item.desc, 3, sc); scoreText(item.sub, 1.5, sc); scoreText(secName, 1, sc);
    // A glass, aluminium or steel door is fit-out or contracting, not joinery.
    if (/door|باب|أبواب|ابواب/i.test(item.desc) && !/glass|زجاج|alumin|ألمن|المنيوم|steel|حديد|metal|fire.?rated|مقاوم للحريق/i.test(item.desc)) sc.joinery = (sc.joinery || 0) + 4;
    // "interior design" beats generic "design".
    if (/interior design|تصميم داخلي|التصميم الداخلي/i.test(item.desc + ' ' + secName)) sc.interior = (sc.interior || 0) + 5;
    let best = null, bv = 0;
    ORDER.forEach(d => { if ((sc[d] || 0) > bv) { bv = sc[d]; best = d; } });
    return best;
  }
  function classify(sections, items, onlyMissing) {
    const name = c => (sections.find(s => s[0] === c) || [])[1] || '';
    items.forEach(i => { if (!onlyMissing || !i.dept) i.dept = deptOf(i, name(i.sec)); });
    // Items with no keyword hit take the most common department of their section, else contracting.
    const bySec = {};
    items.forEach(i => { if (i.dept) { const m = bySec[i.sec] = bySec[i.sec] || {}; m[i.dept] = (m[i.dept] || 0) + (+i.total || 1); } });
    items.forEach(i => { if (!i.dept) { const m = bySec[i.sec]; i.dept = m ? Object.keys(m).sort((a, b) => m[b] - m[a])[0] : 'contracting'; } });
    return items;
  }

  /* ---------- scheduling ---------- */
  // Windows are shares of the working period (the last 5% is kept for snagging and handover).
  const WIN = { arch: [0, .25], interior: [.04, .3], contracting: [.2, .65], joinery: [.35, .92], fitout: [.45, .97], supervision: [0, 1] };
  const DAY = 864e5;
  const toD = s => new Date(String(s).slice(0, 10) + 'T00:00:00Z');
  const toS = d => d.toISOString().slice(0, 10);
  function schedule(items, start, end) {
    const a = toD(start), z = toD(end); const total = Math.max(1, Math.round((z - a) / DAY));
    const work = Math.max(1, Math.round(total * 0.95));
    const has = d => items.some(i => i.dept === d);
    const shift = !has('arch') && !has('interior') ? 0.18 : 0; // no design stage: site work starts sooner
    const win = d => { let [s, e] = WIN[d] || [0, 1]; if (shift && d !== 'supervision') { s = Math.max(0, s - shift); e = Math.min(1, e + (d === 'contracting' ? 0 : 0)); } return [s, e]; };
    const groups = {};
    items.forEach((it, idx) => { (groups[it.dept || 'contracting'] = groups[it.dept || 'contracting'] || []).push(idx); });
    Object.keys(groups).forEach(d => {
      const idxs = groups[d]; const [ws, we] = win(d);
      const W0 = ws * work, L = Math.max(1, (we - ws) * work);
      // Start/finish items and handover-type supervision items get their own short slots.
      const special = i => d === 'supervision' && /mobiliz|mobilis|preliminar|site establishment|تمهيدات|تجهيز/i.test(items[i].desc) ? 'start'
        : d === 'supervision' && /testing|commission|handover|hand over|as.?built|warranty|o&m|تسليم|تشغيل|فحص|ضمان/i.test(items[i].desc) ? 'end' : null;
      const normal = idxs.filter(i => !special(i));
      const w = normal.map(i => Math.sqrt(Math.max(1, +items[i].total || 0)));
      const sum = w.reduce((x, y) => x + y, 0) || 1;
      let c = 0;
      normal.forEach((i, k) => {
        const share = w[k] / sum;
        const s0 = W0 + 0.75 * L * c, dur = 0.25 * L + 0.75 * L * share;
        items[i].start = toS(new Date(a.getTime() + Math.round(s0) * DAY));
        items[i].end = toS(new Date(a.getTime() + Math.max(Math.round(s0), Math.round(s0 + dur) - 1) * DAY));
        c += share;
      });
      idxs.filter(i => special(i)).forEach(i => {
        if (special(i) === 'start') { items[i].start = toS(a); items[i].end = toS(new Date(a.getTime() + Math.max(0, Math.round(total * 0.05) - 1) * DAY)); }
        else { items[i].start = toS(new Date(a.getTime() + Math.round(total * 0.9) * DAY)); items[i].end = toS(z); }
      });
    });
    items.forEach(i => { if (i.end > toS(z)) i.end = toS(z); if (i.start > i.end) i.start = i.end; });
    return items;
  }

  root.BOQ = { parseRows, parseText, classify, schedule, deptOf };
  if (typeof module !== 'undefined') module.exports = root.BOQ;
})(typeof window !== 'undefined' ? window : globalThis);
