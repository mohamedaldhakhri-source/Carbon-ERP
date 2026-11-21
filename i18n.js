// Arabic / English. The app is written in Arabic; in English mode every Arabic phrase that appears on the page
// (text, placeholders, tooltips) is swapped for its English from en.js as it is added, and the page turns left-to-right.
// What people typed themselves (project names, descriptions) has no entry and stays as written.
(function () {
  let lang = 'ar';
  try { lang = localStorage.getItem('lang') === 'en' ? 'en' : 'ar'; } catch (e) { }
  window.LANG = lang;
  window.setLang = l => { try { localStorage.setItem('lang', l); } catch (e) { } location.reload(); };
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
  if (lang !== 'en') { window.tr = s => s; return; }

  const AR = /[؀-ۿ]/;
  const RUN = /[؀-ۿ](?:[؀-ۿً-ٟ\s،؛؟ـ]*[؀-ۿ])?/g;
  const D = () => window.EN || {};
  const cache = new Map();
  // small words that say nothing about whether a phrase is the app's own text
  const STOP = new Set(['في', 'من', 'على', 'مع', 'و', 'إلى', 'الى', 'عن', 'أو', 'ما', 'لا', 'هذا', 'هذي', 'بعد', 'قبل', 'كل']);
  const norm = s => s.replace(/\s+/g, ' ').trim();
  // phrases whose word order changes, or that span numbers and symbols
  const RULES = [
    [/ر\.ع/g, 'OMR'],
    [/تجاوز موعد التسليم ب ?(\d+) يوم( والإنجاز)?/g, (m, n, g) => 'Passed the handover date by ' + n + (n == 1 ? ' day' : ' days') + (g ? ' and progress' : '')],
    [/الطلب يتجاوز قيمة البند ب /g, 'The request exceeds the item value by '],
    [/من (\d+) (يوم|ساعة|دقيقة)/g, (m, n, u) => n + ' ' + ({ يوم: 'day', ساعة: 'hour', دقيقة: 'minute' })[u] + (n == 1 ? '' : 's') + ' ago'],
    [/من دقيقة/g, 'a minute ago'],
    [/باقي (\d+) يوم/g, '$1 days left'],
    [/متأخر (\d+) يوم/g, '$1 days late'],
    [/(\d+) يوم/g, (m, n) => n + (n == 1 ? ' day' : ' days')],
    [/(\d+) ي(?![\u0600-\u06FF])/g, '$1d'],
    [/(\d+)% من القيمة/g, '$1% of the value']
  ];
  // a phrase not in the dictionary as a whole: translate the longest known word runs inside it,
  // but only when most of it is known (otherwise it is someone's own text and stays as it is)
  function piece(run) {
    const d = D(), k = norm(run);
    if (d[k] != null) return d[k];
    const w = k.split(' '); let out = [], known = 0, i = 0;
    const content = w.filter(x => !STOP.has(x)).length || 1;
    while (i < w.length) {
      let j = w.length, hit = null;
      for (; j > i; j--) { const p = w.slice(i, j).join(' '); if (d[p] != null) { hit = d[p]; break; } }
      if (hit != null) { out.push(hit); known += w.slice(i, j).filter(x => !STOP.has(x)).length; i = j; }
      else {
        // و + word ("and"), بـ / لـ prefixes on a known word
        const x = w[i]; let t = null;
        if (x.length > 2 && x[0] === 'و' && d[x.slice(1)] != null) t = 'and ' + d[x.slice(1)];
        if (t) { out.push(t); if (!STOP.has(x)) known++; } else out.push(x);
        i++;
      }
    }
    return known >= content * 0.75 ? out.join(' ') : run;
  }
  function tr(s) {
    if (!s || !AR.test(s)) return s;
    let r = cache.get(s); if (r != null) return r;
    // a whole text that is in the dictionary (also when it mixes in Latin words like BOQ or VO) wins over word runs
    const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0], whole = D()[norm(s)];
    if (whole != null) { r = lead + whole + tail; cache.set(s, r); return r; }
    // or each part between separators ("… · …", "… - …") that is in the dictionary as a whole
    r = s.split(/(\s[·\-–|]\s)/).map(x => { const w = /[؀-ۿ]/.test(x) && /[A-Za-z0-9]/.test(x) ? D()[norm(x)] : null; return w != null ? x.match(/^\s*/)[0] + w + x.match(/\s*$/)[0] : x; }).join('');
    RULES.forEach(([a, b]) => { r = r.replace(a, b); });
    r = r.replace(RUN, m => piece(m)).replace(/،/g, ',').replace(/؟/g, '?').replace(/؛/g, ';')
      .replace(/\b1 (items|requests|tasks|days)\b/g, (m, u) => '1 ' + u.slice(0, -1)).replace(/\b(\d+) Running projects/g, (m, n) => n + ' running project' + (n == 1 ? '' : 's')).replace(/(\d+) (Request|Task|Item)\b/g, (m, n, u) => n + ' ' + u.toLowerCase() + (n == 1 ? '' : 's'));
    if (cache.size > 20000) cache.clear();
    cache.set(s, r); return r;
  }
  window.tr = tr;

  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1 };
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function inSkip(n) { for (let e = n.parentElement; e; e = e.parentElement) { if (SKIP[e.tagName] || e.isContentEditable || (e.classList && e.classList.contains('notr'))) return true; } return false; }
  function doText(n) { const v = n.nodeValue; if (v && AR.test(v) && !inSkip(n)) { const t = tr(v); if (t !== v) n.nodeValue = t; } }
  function doEl(el) {
    if (SKIP[el.tagName] || (el.classList && el.classList.contains('notr'))) return;
    for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && AR.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && AR.test(el.value)) el.value = tr(el.value);
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doEl(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n; while ((n = it.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
  }
  const mo = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doEl(m.target);
    }
  });
  function start() {
    walk(document.documentElement);
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // the page title and dialogs from window.confirm / alert
  const _c = window.confirm, _a = window.alert;
  window.confirm = m => _c(tr(String(m))); window.alert = m => _a(tr(String(m)));
})();
