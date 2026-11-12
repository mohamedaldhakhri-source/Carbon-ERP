(function () {
'use strict';
const sb = supabase.createClient(window.CARBON_CONFIG.supabaseUrl, window.CARBON_CONFIG.supabaseKey);

const DEPTS = { arch: 'معماري', interior: 'تصميم داخلي', fitout: 'فيت أوت', joinery: 'منجرة', contracting: 'مقاولات', supervision: 'إشراف' };
const ROLES = { owner: 'صاحب الشركة', gm: 'المدير العام', head: 'رئيس قسم', site: 'مهندس موقع', procurement: 'المشتريات', finance: 'المالية', pending: 'بانتظار التفعيل' };
const STAGES = [
  { k: 'dept', l: 'موافقة رئيس القسم', role: 'head' },
  { k: 'procurement', l: 'عروض الأسعار', role: 'procurement' },
  { k: 'finance', l: 'تدقيق الميزانية', role: 'finance' },
  { k: 'gm', l: 'اعتماد المدير العام', role: 'gm' },
  { k: 'po', l: 'إصدار أمر الشراء', role: 'procurement' },
  { k: 'done', l: 'أُرسل PO للمورّد' }
];
const TERMS = { advance: 'دفعة مقدّمة', credit30: 'آجل 30 يوم' };
const today = new Date(); today.setHours(0, 0, 0, 0);
const ICONS = {
  dash: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
  proj: '<path d="M3 21V8l9-5 9 5v13h-6v-7H9v7z"/>',
  req: '<path d="M7 4h10l3 3v13H4V4h3m2 6h6m-6 4h6m-6 4h4" fill="none" stroke="currentColor" stroke-width="2"/>',
  cash: '<path d="M2 6h20v12H2zm10 3a3 3 0 100 6 3 3 0 000-6z"/>',
  inbox: '<path d="M3 13l3-9h12l3 9v7H3zm2 0h5a2 2 0 004 0h5" fill="none" stroke="currentColor" stroke-width="2"/>',
  users: '<path d="M9 11a4 4 0 100-8 4 4 0 000 8zm-7 10v-1a6 6 0 0112 0v1zm14-10a3 3 0 100-6m2 16v-1a5 5 0 00-3-4.6" fill="none" stroke="currentColor" stroke-width="2"/>'
};
const ico = k => '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + ICONS[k] + '</svg>';

/* ---------- state ---------- */
let session = null, me = null;
let S = { projects: [], requests: [], petty: [], variations: [], profiles: [] };
let ui = { filter: 'all', tab: 'boq', reqFilter: 'mine', authMode: 'login', authErr: '' };

/* ---------- helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Math.round(+n || 0).toLocaleString('en-US');
const D = s => new Date(String(s).slice(0, 10) + 'T00:00:00');
const fd = s => { if (!s) return '—'; const d = D(s); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
const ftime = s => { if (!s) return ''; const d = new Date(s); return fd(d.toISOString()) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const daysBetween = (a, b) => Math.round((b - a) / 864e5);
const P = id => S.projects.find(p => p.id === id);
const R = id => S.requests.find(r => r.id === id);
const nameOf = id => { const p = S.profiles.find(x => x.id === id); return p ? p.full_name : '—'; };
const selQuote = r => (r.quotes || []).find(q => q.sel);
const reqAmt = r => { const q = selQuote(r); return q ? +q.amt : 0; };
const isAdmin = () => me && (me.role === 'owner' || me.role === 'gm');
const itemByCode = (p, c) => p.boq.find(b => b.c === c);

function contract(p) { return p.boq.reduce((a, b) => a + b.t, 0); }
function varsApproved(p) { return S.variations.filter(v => v.pid === p.id && v.client === 'approved').reduce((a, v) => a + v.amt, 0); }
function budget(p) { return contract(p) + varsApproved(p) || 1; }
function itemSpent(p, code) {
  const b = itemByCode(p, code); let s = b ? b.sp : 0;
  S.requests.forEach(r => { if (r.pid === p.id && r.boq === code && r.stage === 'done') s += reqAmt(r); });
  S.petty.forEach(c => { if (c.pid === p.id && c.boq === code && c.status === 'approved') s += c.amt; });
  return s;
}
function spent(p) {
  let s = p.boq.reduce((a, b) => a + b.sp, 0);
  S.requests.forEach(r => { if (r.pid === p.id && r.stage === 'done') s += reqAmt(r); });
  S.petty.forEach(c => { if (c.pid === p.id && c.status === 'approved') s += c.amt; });
  return s;
}
function committed(p, code, exceptId) {
  return S.requests.filter(r => r.pid === p.id && ['finance', 'gm', 'po'].includes(r.stage) && r.id !== exceptId && (code === undefined || r.boq === code)).reduce((a, r) => a + reqAmt(r), 0);
}
function progress(p) { const t = contract(p); return t ? p.boq.reduce((a, b) => a + b.t * b.p, 0) / t : 0; }
function secProgress(p, s) { const it = p.boq.filter(b => b.s === s); const t = it.reduce((a, b) => a + b.t, 0); return t ? it.reduce((a, b) => a + b.t * b.p, 0) / t : 0; }
function timePct(p) { const a = D(p.start), b = D(p.end); return Math.max(0, Math.min(100, (today - a) / (b - a) * 100)); }
function daysLeft(p) { return daysBetween(today, D(p.end)); }
function health(p) {
  const pr = progress(p), dl = daysLeft(p), tp = timePct(p);
  if (p.status === 'closed') return { k: 'closed', l: 'مغلق', c: 'p-idle' };
  if (p.status === 'stopped') return { k: 'stopped', l: 'متوقف', c: 'p-idle', why: p.stopReason };
  if (dl < 0 && pr < 100) return { k: 'late', l: 'متأخر عن التسليم', c: 'p-bad', why: 'تجاوز موعد التسليم ب' + (-dl) + ' يوم والإنجاز ' + Math.round(pr) + '%' };
  if (tp - pr >= 15 || (dl <= 21 && pr < 85)) return { k: 'risk', l: 'يحتاج اهتمام', c: 'p-warn', why: 'باقي ' + dl + ' يوم والإنجاز ' + Math.round(pr) + '% فقط من العمل' };
  if (pr >= 85) return { k: 'near', l: 'قارب على الانتهاء', c: 'p-acc' };
  return { k: 'ok', l: 'ضمن الخطة', c: 'p-ok' };
}
function stageInfo(r) {
  if (r.stage === 'rejected') return { l: 'مرفوض', c: 'p-bad' };
  if (r.stage === 'done') return { l: 'أُرسل PO', c: 'p-ok' };
  const s = STAGES.find(x => x.k === r.stage); return { l: 'بانتظار: ' + s.l, c: r.stage === 'dept' ? 'p-idle' : 'p-warn' };
}
function canActOn(r) {
  const s = STAGES.find(x => x.k === r.stage); if (!s || !s.role || !me) return false;
  if (s.role !== me.role) return false;
  if (s.role === 'head' && me.dept && me.dept !== r.dept) return false;
  return true;
}
function myQueue() {
  const reqs = S.requests.filter(canActOn);
  const pc = me && me.role === 'gm' ? S.petty.filter(c => c.status === 'pending') : [];
  return { reqs, pc, n: reqs.length + pc.length };
}
function bar(pct, cls, marker) { return '<div class="bar"><i class="' + (cls || '') + '" style="width:' + Math.min(100, Math.max(0, pct)).toFixed(1) + '%"></i>' + (marker != null ? '<b style="inset-inline-start:calc(' + Math.min(100, marker).toFixed(1) + '% - 1px)" title="الوقت المنقضي"></b>' : '') + '</div>'; }
function boqOptions(p, sel, allowNone) {
  let h = allowNone ? '<option value="">خارج BOQ / غير محدد</option>' : '';
  p.sections.forEach(([s, n]) => { const it = p.boq.filter(b => b.s === s); if (!it.length) return; h += '<optgroup label="' + esc(s + ' - ' + n) + '">'; it.forEach(b => { h += '<option value="' + esc(b.id) + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(b.c + ' ' + b.d) + '</option>'; }); h += '</optgroup>'; });
  return h;
}
function projOptions(sel) { return S.projects.filter(p => p.status !== 'closed').map(p => '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.short) + '</option>').join(''); }
function toast(m, bad) { const t = document.createElement('div'); t.className = 'toast'; if (bad) t.style.background = 'var(--bad)'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }
function errMsg(e) { const m = (e && (e.message || e.error_description)) || String(e); return m.replace(/^.*?ERROR:\s*/, ''); }
async function run(promise, okMsg) {
  const { data, error } = await promise;
  if (error) { toast(errMsg(error), true); throw error; }
  if (okMsg) toast(okMsg);
  return data;
}
async function upload(file, folder) {
  if (!file) return null;
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = folder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  await run(sb.storage.from('attachments').upload(path, file));
  return path;
}
async function openFile(path) {
  const { data, error } = await sb.storage.from('attachments').createSignedUrl(path, 300);
  if (error) return toast(errMsg(error), true);
  window.open(data.signedUrl, '_blank', 'noopener');
}
const fileLink = (path, label) => path ? '<button class="linkbtn small" data-act="file" data-v="' + esc(path) + '">📎 ' + esc(label || 'عرض المرفق') + '</button>' : '';

/* ---------- data ---------- */
async function loadAll() {
  const q = t => sb.from(t).select('*');
  const res = await Promise.all([q('projects').order('created_at'), q('boq_sections').order('sort'), q('boq_items').order('sort'), q('tasks').order('sort'),
    q('material_requests').order('created_at'), q('request_items'), q('quotes').order('created_at'), q('request_history').order('created_at'),
    q('petty_cash').order('created_at'), q('variations').order('created_at'), q('profiles').order('created_at')]);
  const bad = res.find(r => r.error); if (bad) throw bad.error;
  const [pr, secs, items, tasks, reqs, ritems, quotes, hist, petty, vars, profs] = res.map(r => r.data);
  S.profiles = profs;
  const codeOf = {}; items.forEach(b => { codeOf[b.id] = b.code; });
  S.projects = pr.map(p => ({
    id: p.id, name: p.name, short: p.short_name, client: p.client, type: p.type, depts: p.depts || [], start: p.start_date, end: p.end_date,
    status: p.status, stopReason: p.stop_reason, vat: +p.vat,
    sections: secs.filter(s => s.project_id === p.id).map(s => [s.code, s.name]),
    boq: items.filter(b => b.project_id === p.id).map(b => ({ id: b.id, c: b.code, s: b.section_code, d: b.description, q: +b.qty, u: b.unit, r: +b.rate, t: +b.total, p: b.progress, sp: +b.prior_spent })),
    tasks: tasks.filter(t => t.project_id === p.id).map(t => ({ n: t.name, s: t.start_date, e: t.end_date, ph: t.is_phase }))
  }));
  S.requests = reqs.map(r => ({
    id: r.id, no: r.no, pid: r.project_id, boqId: r.boq_item_id, boq: r.boq_item_id ? codeOf[r.boq_item_id] : null, dept: r.dept, byId: r.requested_by, by: nameOf(r.requested_by),
    date: r.created_at, need: r.need_by, note: r.note, stage: r.stage, po: r.po_no ? { no: r.po_no, date: r.po_date } : null,
    items: ritems.filter(i => i.request_id === r.id).map(i => ({ d: i.description, q: +i.qty, u: i.unit })),
    quotes: quotes.filter(x => x.request_id === r.id).map(x => ({ id: x.id, sup: x.supplier, amt: +x.amount, terms: x.terms, days: x.delivery_days, sel: x.selected })),
    hist: hist.filter(h => h.request_id === r.id).map(h => ({ t: h.created_at, by: h.actor_name, role: h.role, a: h.action, note: h.note }))
  }));
  S.petty = petty.map(c => ({ id: c.id, no: c.no, pid: c.project_id, boq: c.boq_item_id ? codeOf[c.boq_item_id] : null, amt: +c.amount, d: c.description, by: nameOf(c.requested_by), date: c.created_at, status: c.status, file: c.receipt_path, note: c.decision_note }));
  S.variations = vars.map(v => ({ id: v.id, no: v.no, pid: v.project_id, title: v.title, d: v.description, amt: +v.amount, file: v.approval_path, client: v.client_status, date: v.created_at, byId: v.created_by, by: nameOf(v.created_by) }));
}
async function refresh() { try { await loadAll(); render(); } catch (e) { toast(errMsg(e), true); } }

/* ---------- auth ---------- */
function vAuth() {
  const signup = ui.authMode === 'signup';
  return '<div class="auth"><div class="box"><div class="brand"><div class="mark">C</div><div><b>كربون</b><span>إدارة المشاريع</span></div></div>' +
    '<h1>' + (signup ? 'حساب جديد' : 'تسجيل الدخول') + '</h1>' + (ui.authErr ? '<div class="err">' + esc(ui.authErr) + '</div>' : '') +
    '<form class="f" data-form="' + (signup ? 'signup' : 'login') + '">' +
    (signup ? '<label class="fld"><span>الاسم الكامل</span><input id="a-name" required autocomplete="name"></label>' : '') +
    '<label class="fld"><span>البريد الإلكتروني</span><input id="a-email" type="email" required autocomplete="email" dir="ltr"></label>' +
    '<label class="fld"><span>كلمة المرور</span><input id="a-pass" type="password" required minlength="6" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" dir="ltr"></label>' +
    '<button class="btn pri" type="submit">' + (signup ? 'إنشاء الحساب' : 'دخول') + '</button></form>' +
    '<span class="small muted">' + (signup ? 'عندك حساب؟ ' : 'موظف جديد؟ ') + '<button class="linkbtn" data-act="authMode">' + (signup ? 'سجّل دخول' : 'أنشئ حساب') + '</button></span>' +
    (signup ? '<span class="hint">بعد إنشاء الحساب، يفعّله صاحب الشركة أو المدير العام ويحدد دورك.</span>' : '') + '</div></div>';
}
function vPending() {
  return '<div class="auth"><div class="box"><div class="brand"><div class="mark">C</div><div><b>كربون</b><span>إدارة المشاريع</span></div></div><h1>حسابك بانتظار التفعيل</h1><p class="muted">أهلاً ' + esc(me.full_name) + '. يحتاج صاحب الشركة أو المدير العام يفعّل حسابك ويحدد دورك وقسمك. بعدها حدّث الصفحة.</p><div class="actions"><button class="btn pri" data-act="reloadPage">تحديث</button><button class="btn" data-act="logout">خروج</button></div></div></div>';
}

/* ---------- views ---------- */
function views() {
  const h = location.hash.slice(1) || 'dashboard';
  if (h === 'dashboard') return vDash();
  if (h === 'projects') return vProjects();
  if (h === 'new-project') return vNewProject();
  if (h.startsWith('p-')) return vProject(h.slice(2));
  if (h === 'requests') return vRequests();
  if (h.startsWith('r-')) return vRequest(h.slice(2));
  if (h === 'petty') return vPetty();
  if (h === 'inbox') return vInbox();
  if (h === 'users') return vUsers();
  return vDash();
}
const segFilter = () => '<div class="seg" role="group" aria-label="نوع المشروع">' + [['all', 'الكل'], ['gov', 'حكومي'], ['private', 'خاص']].map(([k, l]) => '<button data-act="filter" data-v="' + k + '" class="' + (ui.filter === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';

function vDash() {
  const all = S.projects.filter(p => ui.filter === 'all' || p.type === ui.filter);
  const active = all.filter(p => p.status === 'active');
  const val = active.reduce((a, p) => a + budget(p), 0), sp = active.reduce((a, p) => a + spent(p), 0);
  const hs = all.map(p => ({ p, h: health(p) }));
  const attn = hs.filter(x => x.h.k === 'late' || x.h.k === 'risk');
  const cnt = k => hs.filter(x => x.h.k === k).length;
  const pend = S.requests.filter(r => !['done', 'rejected'].includes(r.stage)).length + S.petty.filter(c => c.status === 'pending').length;
  let h = '<div class="head"><div class="t"><h1>لوحة متابعة المشاريع</h1><span class="muted">اليوم ' + fd(iso(today)) + '</span></div><div class="actions">' + segFilter() + (isAdmin() ? '<a class="btn pri" href="#new-project">+ مشروع جديد</a>' : '') + '</div></div>';
  if (!S.projects.length) return h + '<div class="card empty">لا توجد مشاريع بعد.' + (isAdmin() ? ' ابدأ بإضافة مشروع جديد ولصق جدول الكميات من Excel.' : '') + '</div>';
  h += '<div class="kpis">' +
    '<div class="kpi"><span class="l">قيمة المشاريع الجارية</span><span class="v">' + money(val) + ' <small>ر.ع</small></span><span class="s">' + active.length + ' مشاريع جارية، شاملة الأعمال الإضافية</span></div>' +
    '<div class="kpi"><span class="l">المصروف حتى الآن</span><span class="v">' + money(sp) + ' <small>ر.ع</small></span><span class="s">' + (val ? Math.round(sp / val * 100) : 0) + '% من قيمة المشاريع الجارية</span></div>' +
    '<div class="kpi' + (attn.length ? ' alert' : '') + '"><span class="l">مشاريع تحتاج تركيز</span><span class="v">' + attn.length + '</span><span class="s">متأخرة أو الوقت المتبقي لا يكفي</span></div>' +
    '<div class="kpi"><span class="l">طلبات بانتظار الاعتماد</span><span class="v">' + pend + '</span><span class="s">طلبات مواد وبيتي كاش</span></div></div>';
  h += '<div class="card"><div class="ch"><h2>حالة المشاريع</h2></div><div class="actions">' +
    [['ok', 'ضمن الخطة', 'p-ok'], ['near', 'قارب على الانتهاء', 'p-acc'], ['risk', 'يحتاج اهتمام', 'p-warn'], ['late', 'متأخر', 'p-bad'], ['stopped', 'متوقف', 'p-idle'], ['closed', 'مغلق', 'p-idle']].map(([k, l, c]) => '<span class="pill ' + c + '">' + l + ' <span class="num">' + cnt(k) + '</span></span>').join('') + '</div></div>';
  if (attn.length) h += '<div class="card"><div class="ch"><h2>تحتاج تركيزك الآن</h2></div><div class="attn">' + attn.map(({ p, h: hh }) => '<div class="ac' + (hh.k === 'risk' ? ' warn' : '') + '" data-go="p-' + p.id + '" tabindex="0" role="link"><div class="ch"><b>' + esc(p.short) + '</b><span class="pill ' + hh.c + '">' + hh.l + '</span></div><span class="why">' + esc(hh.why) + '</span><div class="barrow">' + bar(progress(p), hh.k === 'late' ? 'bad' : 'warn', timePct(p)) + '<span>' + Math.round(progress(p)) + '%</span></div></div>').join('') + '</div></div>';
  h += '<div class="card"><div class="ch"><h2>كل المشاريع</h2><span class="muted small">الخط الأسود على شريط الإنجاز = الوقت المنقضي من مدة المشروع</span></div>' + projTable(all) + '</div>';
  return h;
}
function projTable(list) {
  if (!list.length) return '<div class="empty">لا توجد مشاريع.</div>';
  return '<div class="tbl"><table><thead><tr><th>المشروع</th><th>النوع</th><th>الأقسام</th><th>الإنجاز</th><th>الصرف من القيمة</th><th class="n">المتبقي للتسليم</th><th>الحالة</th></tr></thead><tbody>' +
    list.map(p => {
      const hh = health(p), pr = progress(p), b = budget(p), s = spent(p), dl = daysLeft(p);
      return '<tr class="click" data-go="p-' + p.id + '"><td><b>' + esc(p.short) + '</b><div class="muted small">' + esc(p.client) + '</div></td>' +
        '<td><span class="tag ' + (p.type === 'gov' ? 'gov' : '') + '">' + (p.type === 'gov' ? 'حكومي' : 'خاص') + '</span></td>' +
        '<td style="max-width:200px">' + p.depts.map(d => '<span class="tag">' + DEPTS[d] + '</span>').join('') + '</td>' +
        '<td style="min-width:150px"><div class="barrow">' + bar(pr, hh.k === 'late' ? 'bad' : hh.k === 'risk' ? 'warn' : '', p.status === 'closed' ? null : timePct(p)) + '<span>' + Math.round(pr) + '%</span></div></td>' +
        '<td style="min-width:170px"><div class="barrow">' + bar(s / b * 100, s > b ? 'bad' : 'ok') + '<span>' + Math.round(s / b * 100) + '%</span></div><div class="muted small num">' + money(s) + ' / ' + money(b) + '</div></td>' +
        '<td class="n">' + (p.status === 'closed' ? '—' : dl < 0 ? '<span style="color:var(--bad)">متأخر ' + (-dl) + ' يوم</span>' : dl + ' يوم') + '</td>' +
        '<td><span class="pill ' + hh.c + '">' + hh.l + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';
}
function vProjects() {
  return '<div class="head"><div class="t"><h1>المشاريع</h1><span class="muted">' + S.projects.length + ' مشاريع</span></div><div class="actions">' + segFilter() + (isAdmin() ? '<a class="btn pri" href="#new-project">+ مشروع جديد</a>' : '') + '</div></div><div class="card">' + projTable(S.projects.filter(p => ui.filter === 'all' || p.type === ui.filter)) + '</div>';
}
function vProject(id) {
  const p = P(id); if (!p) return '<div class="empty">المشروع غير موجود</div>';
  const hh = health(p), pr = progress(p), c = contract(p), va = varsApproved(p), b = budget(p), s = spent(p), cm = committed(p), dl = daysLeft(p);
  const reqs = S.requests.filter(r => r.pid === id), pcs = S.petty.filter(x => x.pid === id), vos = S.variations.filter(v => v.pid === id);
  const canProg = ['site', 'head', 'gm', 'owner'].includes(me.role) && p.status === 'active';
  let h = '<div class="head"><div class="t"><span class="crumb"><a href="#projects">المشاريع</a> / ' + esc(p.short) + '</span><h1>' + esc(p.name) + '</h1><div class="actions"><span class="pill ' + hh.c + '">' + hh.l + '</span><span class="tag ' + (p.type === 'gov' ? 'gov' : '') + '">' + (p.type === 'gov' ? 'مشروع حكومي' : 'مشروع خاص') + '</span>' + p.depts.map(d => '<span class="tag">' + DEPTS[d] + '</span>').join('') + '</div><span class="muted small">' + esc(p.client) + '</span></div>' +
    '<div class="actions">' + (p.status !== 'closed' ? '<button class="btn pri" data-act="newReq" data-p="' + id + '">+ طلب مواد</button><button class="btn" data-act="newPetty" data-p="' + id + '">+ بيتي كاش</button><button class="btn" data-act="newVO" data-p="' + id + '">+ عمل إضافي</button>' : '') + (isAdmin() ? '<button class="btn" data-act="projStatus" data-p="' + id + '">حالة المشروع</button>' : '') + '</div></div>';
  if (hh.why) h += '<div class="flag ' + (hh.k === 'late' ? 'bad' : 'warn') + '">' + esc(hh.why) + '</div>';
  h += '<div class="kpis">' +
    '<div class="kpi"><span class="l">قيمة العقد (بدون الضريبة)</span><span class="v">' + money(c) + ' <small>ر.ع</small></span><span class="s">' + (va ? '+ ' + money(va) + ' أعمال إضافية معتمدة' : 'لا توجد أعمال إضافية معتمدة') + '</span></div>' +
    '<div class="kpi"><span class="l">المصروف</span><span class="v">' + money(s) + ' <small>ر.ع</small></span><span class="s">' + Math.round(s / b * 100) + '% من القيمة، وملتزم به ' + money(cm) + '</span></div>' +
    '<div class="kpi"><span class="l">نسبة الإنجاز</span><span class="v">' + Math.round(pr) + '%</span><span class="s">الوقت المنقضي ' + Math.round(timePct(p)) + '%</span></div>' +
    '<div class="kpi' + (dl < 0 && p.status === 'active' ? ' alert' : '') + '"><span class="l">موعد التسليم</span><span class="v">' + fd(p.end) + '</span><span class="s">' + (p.status === 'closed' ? 'المشروع مغلق' : dl < 0 ? 'متأخر ' + (-dl) + ' يوم' : 'باقي ' + dl + ' يوم') + ' · البداية ' + fd(p.start) + '</span></div></div>';
  const tabs = [['boq', 'بنود BOQ', p.boq.length], ['time', 'الجدول الزمني', p.tasks.length], ['req', 'طلبات المواد', reqs.length], ['pc', 'بيتي كاش', pcs.length], ['vo', 'الأعمال الإضافية', vos.length]];
  if (!p.tasks.length && ui.tab === 'time') ui.tab = 'boq';
  h += '<div class="card" style="padding-top:4px"><div class="tabs" role="tablist">' + tabs.filter(t => t[0] !== 'time' || t[2]).map(([k, l, n]) => '<button role="tab" data-act="tab" data-v="' + k + '" class="' + (ui.tab === k ? 'on' : '') + '">' + l + '<span class="c num">' + n + '</span></button>').join('') + '</div><div style="padding-top:14px">';
  if (ui.tab === 'boq') {
    if (!p.boq.length) h += '<div class="empty">لا توجد بنود BOQ لهذا المشروع.</div>';
    else {
      h += '<div class="ch" style="margin-bottom:8px"><span class="muted small">' + (canProg ? 'حدّث نسبة الإنجاز لكل بند مباشرة من الجدول.' : 'نسبة الإنجاز يحدّثها مهندس الموقع أو رئيس القسم.') + '</span></div><div class="tbl"><table><thead><tr><th>البند</th><th>الوصف</th><th class="n">الكمية</th><th class="n">سعر الوحدة</th><th class="n">القيمة</th><th class="n">المصروف</th><th>الإنجاز</th></tr></thead><tbody>';
      p.sections.forEach(([sc, sn]) => {
        const it = p.boq.filter(x => x.s === sc); if (!it.length) return; const st = it.reduce((a, x) => a + x.t, 0); const ss = it.reduce((a, x) => a + itemSpent(p, x.c), 0);
        h += '<tr class="sec"><td>' + esc(sc) + '</td><td>' + esc(sn) + '</td><td></td><td></td><td class="n">' + money(st) + '</td><td class="n">' + money(ss) + '</td><td><div class="barrow">' + bar(secProgress(p, sc)) + '<span>' + Math.round(secProgress(p, sc)) + '%</span></div></td></tr>';
        it.forEach(x => {
          const isp = itemSpent(p, x.c);
          h += '<tr><td class="num small">' + esc(x.c) + '</td><td>' + esc(x.d) + '</td><td class="n">' + x.q + ' ' + esc(x.u) + '</td><td class="n">' + money(x.r) + '</td><td class="n">' + money(x.t) + '</td><td class="n"' + (isp > x.t ? ' style="color:var(--bad)" title="تجاوز قيمة البند"' : '') + '>' + money(isp) + '</td><td style="min-width:150px"><div class="barrow">' + bar(x.p, x.p >= 100 ? 'ok' : '') + (canProg ? '<input class="prog-in num" type="number" min="0" max="100" value="' + x.p + '" data-prog="' + x.id + '" aria-label="نسبة إنجاز البند ' + esc(x.c) + '">' : '<span>' + x.p + '%</span>') + '</div></td></tr>';
        });
      });
      h += '<tr class="sec"><td></td><td>الإجمالي بدون الضريبة</td><td></td><td></td><td class="n">' + money(c) + '</td><td class="n">' + money(p.boq.reduce((a, x) => a + itemSpent(p, x.c), 0)) + '</td><td></td></tr>';
      h += '<tr><td></td><td class="muted">ضريبة القيمة المضافة ' + p.vat + '%</td><td></td><td></td><td class="n muted">' + money(c * p.vat / 100) + '</td><td></td><td></td></tr><tr><td></td><td><b>الإجمالي الكلي</b></td><td></td><td></td><td class="n"><b>' + money(c * (1 + p.vat / 100)) + '</b></td><td></td><td></td></tr></tbody></table></div>';
    }
  } else if (ui.tab === 'time') {
    const a = D(p.start), z = D(p.end); const span = z - a; const pos = d => ((D(d) - a) / span * 100);
    const nowPos = (today - a) / span * 100;
    const months = []; const m = new Date(a.getFullYear(), a.getMonth() + 1, 1); while (m <= z) { months.push([((m - a) / span * 100), m.toLocaleDateString('ar', { month: 'short' })]); m.setMonth(m.getMonth() + 1); }
    h += '<div class="tbl"><div class="gantt"><div class="gmon"><span></span><div>' + months.map(([x, l]) => '<span style="inset-inline-start:' + x.toFixed(1) + '%">' + l + '</span>').join('') + '</div></div>' +
      p.tasks.map(t => { const s0 = pos(t.s), e = Math.max(pos(t.e) + (100 / (span / 864e5)), s0 + .6); return '<div class="gr' + (t.ph ? ' ph' : '') + '"><span title="' + fd(t.s) + ' - ' + fd(t.e) + '">' + esc(t.n) + '</span><div class="gt"><i style="inset-inline-start:' + s0.toFixed(2) + '%;width:' + (e - s0).toFixed(2) + '%"></i>' + (nowPos <= 100 ? '<span class="now" style="inset-inline-start:' + nowPos.toFixed(1) + '%"></span>' : '') + '</div></div>'; }).join('') +
      '</div></div><p class="muted small">' + (nowPos > 100 ? 'تاريخ اليوم بعد نهاية الخطة الزمنية (' + fd(p.end) + '). حدّث موعد التسليم من "حالة المشروع" إذا تم الاتفاق على تمديد.' : 'الخط الأحمر يمثل تاريخ اليوم.') + '</p>';
  } else if (ui.tab === 'req') h += reqTable(reqs, false);
  else if (ui.tab === 'pc') h += pettyTable(pcs, false);
  else if (ui.tab === 'vo') {
    h += vos.length ? '<div class="tbl"><table><thead><tr><th>الرقم</th><th>العمل الإضافي</th><th class="n">القيمة</th><th>موافقة العميل</th><th>المرفق</th><th>التاريخ</th></tr></thead><tbody>' + vos.map(v => '<tr><td class="num small">' + esc(v.no) + '</td><td><b>' + esc(v.title) + '</b><div class="muted small">' + esc(v.d) + '</div></td><td class="n">' + money(v.amt) + '</td><td>' + (v.client === 'approved' ? '<span class="pill p-ok">معتمد من العميل</span>' : '<span class="pill p-warn">بانتظار العميل</span>') + '</td><td class="small">' + (v.file ? fileLink(v.file, 'موافقة العميل') : ((v.byId === me.id || isAdmin()) ? '<button class="btn sm" data-act="voApprove" data-v="' + v.id + '">رفع موافقة العميل</button>' : '—')) + '</td><td class="small">' + fd(v.date) + '</td></tr>').join('') + '</tbody></table></div><p class="muted small">الأعمال الإضافية المعتمدة من العميل تُضاف لقيمة المشروع وميزانيته تلقائياً.</p>' : '<div class="empty">لا توجد أعمال إضافية لهذا المشروع.</div>';
  }
  h += '</div></div>';
  return h;
}
function reqTable(list, showProj) {
  if (!list.length) return '<div class="empty">لا توجد طلبات.</div>';
  return '<div class="tbl"><table><thead><tr><th>رقم الطلب</th>' + (showProj ? '<th>المشروع</th>' : '') + '<th>المواد</th><th>البند</th><th class="n">المبلغ</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>' +
    list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(r => { const si = stageInfo(r), p = P(r.pid); return '<tr class="click" data-go="r-' + r.id + '"><td class="num small"><b>' + esc(r.no) + '</b></td>' + (showProj ? '<td>' + esc(p ? p.short : '') + '</td>' : '') + '<td>' + esc(r.items[0] ? r.items[0].d : '') + (r.items.length > 1 ? ' <span class="muted small">+' + (r.items.length - 1) + '</span>' : '') + '</td><td class="num small">' + (r.boq ? esc(r.boq) : '<span style="color:var(--warn)">خارج BOQ</span>') + '</td><td class="n">' + (reqAmt(r) ? money(reqAmt(r)) : '<span class="muted">—</span>') + '</td><td class="small">' + fd(r.date) + '</td><td><span class="pill ' + si.c + '">' + si.l + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
}
function pettyTable(list, showProj) {
  if (!list.length) return '<div class="empty">لا توجد طلبات بيتي كاش.</div>';
  const gm = me.role === 'gm';
  return '<div class="tbl"><table><thead><tr><th>الرقم</th>' + (showProj ? '<th>المشروع</th>' : '') + '<th>التفاصيل</th><th class="n">المبلغ</th><th>مقدم الطلب</th><th>الحالة</th></tr></thead><tbody>' +
    list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(c => '<tr><td class="num small"><b>' + esc(c.no) + '</b><div class="muted">' + fd(c.date) + '</div></td>' + (showProj ? '<td><a href="#p-' + c.pid + '">' + esc(P(c.pid) ? P(c.pid).short : '') + '</a></td>' : '') + '<td>' + esc(c.d) + '<div class="muted small">' + (c.boq ? 'بند ' + esc(c.boq) : 'مصروف عام للمشروع') + ' ' + fileLink(c.file, 'الفاتورة') + '</div>' + (c.note ? '<div class="small">ملاحظة المدير: ' + esc(c.note) + '</div>' : '') + '</td><td class="n">' + money(c.amt) + '</td><td class="small">' + esc(c.by) + '</td><td>' +
      (c.status === 'pending' ? (gm ? '<div class="actions"><button class="btn sm ok" data-act="pcOk" data-v="' + c.id + '">اعتماد</button><button class="btn sm bad" data-act="pcNo" data-v="' + c.id + '">رفض</button></div>' : '<span class="pill p-warn">بانتظار المدير العام</span>') : c.status === 'approved' ? '<span class="pill p-ok">معتمد</span>' : '<span class="pill p-bad">مرفوض</span>') + '</td></tr>').join('') + '</tbody></table></div>';
}
function vRequests() {
  const f = ui.reqFilter; const q = myQueue();
  let list = S.requests;
  if (f === 'mine') list = q.reqs; else if (f === 'open') list = list.filter(r => !['done', 'rejected'].includes(r.stage)); else if (f === 'done') list = list.filter(r => r.stage === 'done'); else if (f === 'me') list = list.filter(r => r.byId === me.id);
  return '<div class="head"><div class="t"><h1>طلبات المواد</h1><span class="muted">من الموقع حتى أمر الشراء</span></div><div class="actions"><button class="btn pri" data-act="newReq">+ طلب مواد جديد</button></div></div>' +
    '<div class="card"><div class="ch"><div class="seg">' + [['mine', 'بانتظار إجرائي (' + q.reqs.length + ')'], ['me', 'طلباتي'], ['open', 'قيد الإجراء'], ['done', 'صدر لها PO'], ['all', 'الكل']].map(([k, l]) => '<button data-act="reqFilter" data-v="' + k + '" class="' + (f === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div>' + reqTable(list, true) + '</div>' +
    '<div class="card"><h2>مسار الطلب</h2><div class="steps">' + STAGES.map((s, i) => '<div class="step"><span class="dot">' + (i + 1) + '</span>' + s.l + (s.role ? '<span class="muted small">' + ROLES[s.role] + '</span>' : '') + '</div>').join('') + '</div></div>';
}
function rejStage(r) { const last = r.hist[r.hist.length - 1] || {}; return ({ head: 'dept', procurement: 'procurement', finance: 'finance', gm: 'gm' })[last.role] || 'dept'; }
function vRequest(id) {
  const r = R(id); if (!r) return '<div class="empty">الطلب غير موجود</div>';
  const p = P(r.pid), si = stageInfo(r), idx = STAGES.findIndex(s => s.k === r.stage);
  const rejIdx = r.stage === 'rejected' ? STAGES.findIndex(s => s.k === rejStage(r)) : -1;
  const bi = r.boq ? itemByCode(p, r.boq) : null;
  let h = '<div class="head"><div class="t"><span class="crumb"><a href="#requests">طلبات المواد</a> / ' + esc(r.no) + '</span><h1>طلب مواد ' + esc(r.no) + '</h1><div class="actions"><span class="pill ' + si.c + '">' + si.l + '</span><a class="tag" href="#p-' + p.id + '">' + esc(p.short) + '</a><span class="tag">' + DEPTS[r.dept] + '</span></div></div></div>';
  h += '<div class="card"><div class="steps">' + STAGES.map((s, i) => { let c = ''; if (r.stage === 'rejected') { c = i < rejIdx ? 'done' : i === rejIdx ? 'rej' : ''; } else if (r.stage === 'done' || i < idx) c = 'done'; else if (i === idx) c = 'cur'; return '<div class="step ' + c + '"><span class="dot">' + (c === 'done' ? '✓' : c === 'rej' ? '✕' : i + 1) + '</span>' + s.l + '</div>'; }).join('') + '</div></div>';
  h += '<div class="grid2"><div style="display:flex;flex-direction:column;gap:18px;min-width:0">';
  h += actionPanel(r, p);
  h += '<div class="card"><h2>المواد المطلوبة</h2><div class="tbl"><table><thead><tr><th>#</th><th>الوصف</th><th class="n">الكمية</th><th>الوحدة</th></tr></thead><tbody>' + r.items.map((it, i) => '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(it.d) + '</td><td class="n">' + it.q + '</td><td>' + esc(it.u) + '</td></tr>').join('') + '</tbody></table></div>' + (r.note ? '<p class="muted small" style="margin:10px 0 0">ملاحظة: ' + esc(r.note) + '</p>' : '') + '</div>';
  if (r.quotes.length && !(r.stage === 'procurement' && canActOn(r))) h += '<div class="card"><h2>عروض الأسعار</h2>' + quotesTable(r, false) + '</div>';
  if (r.po) h += poDoc(r, p);
  h += '</div><div style="display:flex;flex-direction:column;gap:18px;min-width:0"><div class="card"><h2>تفاصيل الطلب</h2><dl class="dl"><dt>المشروع</dt><dd><a href="#p-' + p.id + '">' + esc(p.short) + '</a></dd><dt>بند BOQ</dt><dd>' + (bi ? esc(bi.c + ' ' + bi.d) : '<span style="color:var(--warn)">خارج BOQ</span>') + '</dd><dt>القسم</dt><dd>' + DEPTS[r.dept] + '</dd><dt>مقدم الطلب</dt><dd>' + esc(r.by) + '</dd><dt>تاريخ الطلب</dt><dd>' + fd(r.date) + '</dd><dt>مطلوب قبل</dt><dd>' + fd(r.need) + '</dd></dl></div>' +
    '<div class="card"><h2>سجل الإجراءات</h2><ul class="log">' + r.hist.map(x => '<li class="' + (/رفض/.test(x.a) ? 'r' : '') + '"><div><b>' + esc(x.a) + '</b><div class="muted small">' + esc(x.by) + ' · ' + ftime(x.t) + '</div>' + (x.note ? '<div class="small">' + esc(x.note) + '</div>' : '') + '</div></li>').join('') + '</ul></div></div></div>';
  return h;
}
function budgetCheck(r, p) {
  const amt = reqAmt(r); const b = r.boq ? itemByCode(p, r.boq) : null;
  const pb = budget(p), ps = spent(p), pc = committed(p, undefined, r.id); const premain = pb - ps - pc - amt;
  let h = '<div class="check">';
  if (b) {
    const is = itemSpent(p, b.c), ic = committed(p, b.c, r.id), rem = b.t - is - ic - amt;
    h += '<div class="flag ok">✓ الطلب ضمن بند BOQ رقم ' + esc(b.c) + ': ' + esc(b.d) + '</div>' +
      '<div class="row"><span>قيمة البند في BOQ</span><b class="num">' + money(b.t) + '</b></div>' +
      '<div class="row"><span>المصروف على البند</span><b class="num">' + money(is) + '</b></div>' +
      '<div class="row"><span>طلبات أخرى معتمدة قيد الشراء</span><b class="num">' + money(ic) + '</b></div>' +
      '<div class="row"><span>قيمة هذا الطلب</span><b class="num">' + money(amt) + '</b></div>' +
      '<div class="row"><span>المتبقي في البند بعد الطلب</span><b class="num" style="color:' + (rem < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + money(rem) + '</b></div>';
    if (rem < 0) h += '<div class="flag bad">الطلب يتجاوز قيمة البند ب ' + money(-rem) + ' ر.ع</div>';
  } else h += '<div class="flag warn">الطلب غير مرتبط ببند في BOQ. إذا كان عملاً خارج العقد، يُسجّل كعمل إضافي مع موافقة العميل.</div>';
  h += '<div class="row"><span>ميزانية المشروع / المتبقي بعد الطلب</span><b class="num">' + money(pb) + ' / <span style="color:' + (premain < 0 ? 'var(--bad)' : 'inherit') + '">' + money(premain) + '</span></b></div></div>';
  return h;
}
function quotesTable(r, edit) {
  if (!r.quotes.length) return '<div class="empty">لم تُسجّل عروض أسعار بعد.</div>';
  return '<div class="tbl"><table><thead><tr>' + (edit ? '<th>اختيار</th>' : '') + '<th>المورّد</th><th class="n">المبلغ</th><th>الدفع</th><th class="n">مدة التوريد</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' + r.quotes.map(q => '<tr' + (q.sel && !edit ? ' style="font-weight:600"' : '') + '>' + (edit ? '<td><input type="radio" name="qsel" data-act="qsel" data-v="' + q.id + '" data-r="' + r.id + '" ' + (q.sel ? 'checked' : '') + ' style="width:auto" aria-label="اختيار ' + esc(q.sup) + '"></td>' : '') + '<td>' + esc(q.sup) + (q.sel && !edit ? ' <span class="pill p-ok">المختار</span>' : '') + '</td><td class="n">' + money(q.amt) + '</td><td>' + TERMS[q.terms] + '</td><td class="n">' + q.days + ' يوم</td>' + (edit ? '<td><button class="x" data-act="qdel" data-v="' + q.id + '" data-r="' + r.id + '" aria-label="حذف">×</button></td>' : '') + '</tr>').join('') + '</tbody></table></div>';
}
function actionPanel(r, p) {
  const st = STAGES.find(s => s.k === r.stage);
  if (r.stage === 'done') return '<div class="flag ok">تم إصدار أمر الشراء ' + esc(r.po.no) + ' وإرساله للمورّد.</div>';
  if (r.stage === 'rejected') { const l = r.hist[r.hist.length - 1] || {}; return '<div class="flag bad">رُفض الطلب: ' + esc(l.note || l.a) + '</div>'; }
  if (!canActOn(r)) return '<div class="panel wait"><b>بانتظار ' + ROLES[st.role] + (st.role === 'head' ? ' ' + DEPTS[r.dept] : '') + '</b><span class="muted small">' + st.l + '</span>' + (['finance', 'gm'].includes(r.stage) ? budgetCheck(r, p) : '') + '</div>';
  const noteF = '<label class="fld"><span>ملاحظة (اختياري، وإلزامية عند الرفض)</span><textarea id="actnote" placeholder="سبب الرفض أو أي توجيه"></textarea></label>';
  const btns = (ok) => '<div class="actions"><button class="btn ok" data-act="approve" data-v="' + r.id + '">' + ok + '</button><button class="btn bad" data-act="reject" data-v="' + r.id + '">' + (r.stage === 'procurement' ? 'إلغاء الطلب' : 'رفض') + '</button></div>';
  if (r.stage === 'dept') return '<div class="panel"><h2>موافقة رئيس القسم</h2><span class="small">راجع المواد والكميات. بعد موافقتك يروح الطلب مباشرة للمشتريات.</span>' + noteF + btns('موافقة وإرسال للمشتريات') + '</div>';
  if (r.stage === 'procurement') return '<div class="panel"><h2>تسجيل عروض الأسعار</h2>' + quotesTable(r, true) +
    '<form class="f" data-form="quote" data-v="' + r.id + '"><div class="fr"><label class="fld"><span>المورّد</span><input id="q-sup" required placeholder="اسم المورّد"></label><label class="fld"><span>المبلغ (ر.ع)</span><input id="q-amt" type="number" min="0" step="0.001" required></label></div><div class="fr"><label class="fld"><span>طريقة الدفع</span><select id="q-terms"><option value="credit30">آجل 30 يوم (كردت)</option><option value="advance">دفعة مقدّمة</option></select></label><label class="fld"><span>مدة التوريد (يوم)</span><input id="q-days" type="number" min="0" value="3"></label></div><div><button class="btn" type="submit">+ إضافة العرض</button></div></form>' +
    noteF + '<div class="actions"><button class="btn ok" data-act="approve" data-v="' + r.id + '" ' + (selQuote(r) ? '' : 'disabled') + '>إرسال العرض المختار للمالية</button><button class="btn bad" data-act="reject" data-v="' + r.id + '">إلغاء الطلب</button></div></div>';
  if (r.stage === 'finance') return '<div class="panel"><h2>تدقيق الميزانية</h2>' + budgetCheck(r, p) + noteF + btns('ضمن الميزانية، إرسال للمدير العام') + '</div>';
  if (r.stage === 'gm') { const q = selQuote(r); return '<div class="panel"><h2>الاعتماد النهائي للشراء</h2><div class="check"><div class="row"><span>المورّد</span><b>' + esc(q.sup) + '</b></div><div class="row"><span>المبلغ</span><b class="num">' + money(q.amt) + ' ر.ع</b></div><div class="row"><span>الدفع</span><b>' + TERMS[q.terms] + '</b></div></div>' + budgetCheck(r, p) + noteF + btns('اعتماد الشراء') + '</div>'; }
  if (r.stage === 'po') { const q = selQuote(r); return '<div class="panel"><h2>إصدار أمر الشراء</h2><span class="small">المدير العام اعتمد الشراء. أصدر أمر الشراء للمورّد <b>' + esc(q.sup) + '</b> بمبلغ <b class="num">' + money(q.amt) + '</b> ر.ع (' + TERMS[q.terms] + ').</span><div class="actions"><button class="btn ok" data-act="approve" data-v="' + r.id + '">إصدار PO وإرساله للمورّد</button></div></div>'; }
  return '';
}
function poDoc(r, p) {
  const q = selQuote(r); if (!q) return '';
  const due = (() => { const d = D(r.po.date); if (q.terms === 'credit30') d.setDate(d.getDate() + 30); return iso(d); })();
  return '<div class="po"><div class="top"><div><h2>أمر شراء</h2><span class="num">' + esc(r.po.no) + '</span></div><div style="text-align:end"><b>كربون للهندسة</b><div class="muted small">التاريخ ' + fd(r.po.date) + '</div></div></div>' +
    '<dl class="dl"><dt>المورّد</dt><dd>' + esc(q.sup) + '</dd><dt>المشروع / موقع التوريد</dt><dd>' + esc(p.short) + '</dd><dt>مرجع الطلب</dt><dd>' + esc(r.no) + (r.boq ? ' · بند BOQ ' + esc(r.boq) : '') + '</dd><dt>شروط الدفع</dt><dd>' + TERMS[q.terms] + (q.terms === 'credit30' ? ' · تاريخ الاستحقاق ' + fd(due) : ' · يُدفع قبل التوريد') + '</dd><dt>مدة التوريد</dt><dd>' + q.days + ' يوم</dd></dl>' +
    '<div class="tbl"><table><thead><tr><th>الوصف</th><th class="n">الكمية</th><th>الوحدة</th></tr></thead><tbody>' + r.items.map(it => '<tr><td>' + esc(it.d) + '</td><td class="n">' + it.q + '</td><td>' + esc(it.u) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<div class="ch"><span class="muted small">معتمد من المدير العام</span><b class="num">الإجمالي ' + money(q.amt) + ' ر.ع</b></div><div><button class="btn sm" data-act="printPO">طباعة</button></div></div>';
}
function vPetty() {
  const pend = S.petty.filter(c => c.status === 'pending'), tot = S.petty.filter(c => c.status === 'approved').reduce((a, c) => a + c.amt, 0);
  return '<div class="head"><div class="t"><h1>بيتي كاش</h1><span class="muted">مصروفات سريعة تُعتمد من المدير العام وتُحسب على المشروع</span></div><div class="actions"><button class="btn pri" data-act="newPetty">+ طلب بيتي كاش</button></div></div>' +
    '<div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="kpi"><span class="l">بانتظار اعتماد المدير العام</span><span class="v">' + pend.length + '</span><span class="s num">' + money(pend.reduce((a, c) => a + c.amt, 0)) + ' ر.ع</span></div><div class="kpi"><span class="l">إجمالي المعتمد</span><span class="v">' + money(tot) + ' <small>ر.ع</small></span><span class="s">محسوب ضمن مصروفات المشاريع</span></div></div>' +
    '<div class="card">' + pettyTable(S.petty, true) + '</div>';
}
function vInbox() {
  const q = myQueue();
  let h = '<div class="head"><div class="t"><h1>بانتظار إجرائي</h1><span class="muted">' + ROLES[me.role] + (me.dept ? ' ' + DEPTS[me.dept] : '') + '</span></div></div>';
  if (!q.n) return h + '<div class="card empty">ما عندك شي ينتظر إجراءك الحين.</div>';
  if (q.reqs.length) h += '<div class="card"><h2>طلبات المواد</h2>' + reqTable(q.reqs, true) + '</div>';
  if (q.pc.length) h += '<div class="card"><h2>بيتي كاش</h2>' + pettyTable(q.pc, true) + '</div>';
  return h;
}
function vUsers() {
  if (!isAdmin()) return '<div class="empty">هذه الصفحة لصاحب الشركة والمدير العام.</div>';
  const pend = S.profiles.filter(u => u.role === 'pending').length;
  return '<div class="head"><div class="t"><h1>المستخدمين</h1><span class="muted">' + S.profiles.length + ' مستخدم' + (pend ? '، ' + pend + ' بانتظار التفعيل' : '') + '</span></div></div>' +
    '<div class="card"><p class="muted small" style="margin-top:0">كل موظف ينشئ حسابه من صفحة الدخول، وبعدها تحدد هنا دوره. رئيس القسم يعتمد طلبات قسمه فقط؛ اتركه بدون قسم إذا يعتمد كل الأقسام.</p><div class="tbl"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>القسم</th><th></th></tr></thead><tbody>' +
    S.profiles.map(u => '<tr><td><b>' + esc(u.full_name) + '</b>' + (u.role === 'pending' ? ' <span class="pill p-warn">جديد</span>' : '') + '</td><td class="small" dir="ltr" style="text-align:end">' + esc(u.email) + '</td><td><select id="ur-' + u.id + '" aria-label="الدور">' + Object.entries(ROLES).map(([k, l]) => '<option value="' + k + '"' + (u.role === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td><td><select id="ud-' + u.id + '" aria-label="القسم"><option value="">—</option>' + Object.entries(DEPTS).map(([k, l]) => '<option value="' + k + '"' + (u.dept === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></td><td><button class="btn sm" data-act="saveUser" data-v="' + u.id + '">حفظ</button></td></tr>').join('') + '</tbody></table></div></div>';
}
function vNewProject() {
  if (!isAdmin()) return '<div class="empty">إضافة المشاريع لصاحب الشركة والمدير العام.</div>';
  return '<div class="head"><div class="t"><span class="crumb"><a href="#projects">المشاريع</a> / مشروع جديد</span><h1>مشروع جديد</h1></div></div>' +
    '<div class="card"><form class="f" data-form="project">' +
    '<div class="fr"><label class="fld"><span>اسم المشروع الكامل</span><input id="np-name" required></label><label class="fld"><span>اسم مختصر (يظهر في القوائم)</span><input id="np-short" required></label></div>' +
    '<div class="fr"><label class="fld"><span>العميل</span><input id="np-client"></label><label class="fld"><span>نوع المشروع</span><select id="np-type"><option value="gov">حكومي</option><option value="private">خاص</option></select></label></div>' +
    '<div class="fr"><label class="fld"><span>تاريخ البداية</span><input id="np-start" type="date" required value="' + iso(today) + '"></label><label class="fld"><span>موعد التسليم المتفق عليه</span><input id="np-end" type="date" required></label></div>' +
    '<div class="fld"><span>الأقسام المشاركة</span><div class="chk">' + Object.entries(DEPTS).map(([k, l]) => '<label><input type="checkbox" name="np-dept" value="' + k + '">' + l + '</label>').join('') + '</div></div>' +
    '<label class="fld"><span>جدول الكميات BOQ (انسخه من Excel والصقه هنا)</span><textarea id="np-boq" class="paste" placeholder="2\tأعمال التصميم\n2.1\tالتصميم المعماري المبدئي\t1\tمقطوعية\t3000\t3000\n2.2\tالمخططات التفصيلية\t1\tمقطوعية\t300\t300"></textarea></label>' +
    '<span class="hint">الأعمدة بالترتيب: رقم البند، الوصف، الكمية، الوحدة، سعر الوحدة، الإجمالي. السطر اللي فيه رقم ووصف فقط يُعتبر عنوان قسم (مثل "3  الأعمال الإنشائية"). تقدر تضيف المشروع بدون BOQ وتضيفه لاحقاً.</span>' +
    '<div id="np-preview" class="hint"></div>' +
    '<label class="fld"><span>الجدول الزمني (اختياري): اسم المهمة، البداية، النهاية</span><textarea id="np-tasks" class="paste" style="min-height:90px" placeholder="مرحلة التصميم\t2026-04-23\t2026-07-15"></textarea></label>' +
    '<div class="actions"><button class="btn pri" type="submit">حفظ المشروع</button><a class="btn" href="#projects">إلغاء</a></div></form></div>';
}
function parseNum(s) { if (s == null) return NaN; s = String(s).replace(/[,\s]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); return s === '' ? NaN : +s; }
function parseBoq(text) {
  const sections = [], items = []; let cur = null;
  text.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const c = line.split('\t').map(x => x.trim());
    const code = c[0], desc = c[1] || '';
    const qty = parseNum(c[2]), rate = parseNum(c[4]), total = parseNum(c[5]);
    if (!code && !desc) return;
    if (isNaN(qty) && isNaN(total)) { if (code && desc) { cur = code.split('.')[0] === code ? code : code; sections.push([code, desc]); } return; }
    const sec = cur || code.split('.')[0];
    if (!sections.find(s => s[0] === sec)) sections.push([sec, 'قسم ' + sec]);
    items.push({ code, desc, qty: isNaN(qty) ? 1 : qty, unit: c[3] || '', rate: isNaN(rate) ? 0 : rate, total: isNaN(total) ? (isNaN(qty) ? 0 : qty) * (isNaN(rate) ? 0 : rate) : total, sec });
  });
  return { sections, items };
}
function parseDate(s) {
  s = (s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  return null;
}

/* ---------- modals ---------- */
function modal(title, body) { document.getElementById('layer').innerHTML = '<div class="ov" data-act="closeOv"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="mh"><h2>' + esc(title) + '</h2><button class="x" data-act="close" aria-label="إغلاق">×</button></div>' + body + '</div></div>'; const f = document.querySelector('.modal input,.modal select'); if (f) f.focus(); }
function closeModal() { document.getElementById('layer').innerHTML = ''; }
function curProject(pid) { pid = pid || (location.hash.startsWith('#p-') ? location.hash.slice(3) : null); return P(pid) || S.projects.find(p => p.status !== 'closed'); }
function deptOptions(p) { const ds = p.depts.length ? p.depts : Object.keys(DEPTS); const def = me.dept && ds.includes(me.dept) ? me.dept : ds[0]; return ds.map(d => '<option value="' + d + '"' + (d === def ? ' selected' : '') + '>' + DEPTS[d] + '</option>').join(''); }
function newReqForm(pid) {
  const p = curProject(pid); if (!p) return toast('لا توجد مشاريع جارية', true);
  modal('طلب مواد جديد', '<form class="f" data-form="req"><div class="fr"><label class="fld"><span>المشروع</span><select id="nr-p">' + projOptions(p.id) + '</select></label><label class="fld"><span>القسم</span><select id="nr-d">' + deptOptions(p) + '</select></label></div>' +
    '<label class="fld"><span>بند BOQ</span><select id="nr-b">' + boqOptions(p, '', true) + '</select></label>' +
    '<div class="fld"><span>المواد المطلوبة</span><div class="lines" id="nr-lines">' + lineRow() + '</div><div><button type="button" class="btn sm" data-act="addLine">+ مادة أخرى</button></div></div>' +
    '<div class="fr"><label class="fld"><span>مطلوب قبل</span><input id="nr-need" type="date" value="' + iso(new Date(today.getTime() + 5 * 864e5)) + '"></label><label class="fld"><span>ملاحظة</span><input id="nr-note" placeholder="مثال: للطابق الأرضي"></label></div>' +
    '<div class="actions"><button class="btn pri" type="submit">إرسال لرئيس القسم</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>');
}
function lineRow() { return '<div class="line"><input placeholder="وصف المادة" class="l-d" required aria-label="وصف المادة"><input type="number" min="0" step="any" placeholder="الكمية" class="l-q" required aria-label="الكمية"><input placeholder="الوحدة" class="l-u" value="عدد" aria-label="الوحدة"><button type="button" class="x" data-act="delLine" aria-label="حذف">×</button></div>'; }
function newPettyForm(pid) {
  const p = curProject(pid); if (!p) return toast('لا توجد مشاريع جارية', true);
  modal('طلب بيتي كاش', '<form class="f" data-form="petty"><div class="fr"><label class="fld"><span>المشروع</span><select id="pc-p">' + projOptions(p.id) + '</select></label><label class="fld"><span>المبلغ (ر.ع)</span><input id="pc-a" type="number" min="0.001" step="0.001" required></label></div>' +
    '<label class="fld"><span>التفاصيل</span><textarea id="pc-d" required placeholder="وش اشتريت أو وش تحتاج، ولماذا كان عاجلاً"></textarea></label>' +
    '<div class="fr"><label class="fld"><span>بند BOQ (اختياري)</span><select id="pc-b">' + boqOptions(p, '', true) + '</select></label><label class="fld"><span>صورة الفاتورة (اختياري)</span><input id="pc-f" type="file" accept="image/*,.pdf"></label></div>' +
    '<div class="actions"><button class="btn pri" type="submit">إرسال للمدير العام</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>');
}
function newVOForm(pid) {
  modal('إضافة عمل إضافي (Variation)', '<form class="f" data-form="vo" data-v="' + pid + '"><label class="fld"><span>عنوان العمل الإضافي</span><input id="vo-t" required placeholder="مثال: غرفة تخزين إضافية"></label><label class="fld"><span>الوصف ونطاق العمل</span><textarea id="vo-d" required></textarea></label>' +
    '<div class="fr"><label class="fld"><span>القيمة (ر.ع)</span><input id="vo-a" type="number" min="0" step="0.001" required></label><label class="fld"><span>موافقة العميل (PDF أو صورة)</span><input id="vo-f" type="file" accept="image/*,.pdf"></label></div>' +
    '<span class="muted small">إذا أرفقت موافقة العميل، يُعتمد العمل الإضافي ويُضاف لقيمة المشروع. بدونها يبقى "بانتظار العميل".</span>' +
    '<div class="actions"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>');
}
function projStatusForm(pid) {
  const p = P(pid);
  modal('حالة المشروع', '<form class="f" data-form="pstatus" data-v="' + pid + '"><label class="fld"><span>الحالة</span><select id="ps-s"><option value="active"' + (p.status === 'active' ? ' selected' : '') + '>جاري</option><option value="stopped"' + (p.status === 'stopped' ? ' selected' : '') + '>متوقف</option><option value="closed"' + (p.status === 'closed' ? ' selected' : '') + '>مغلق</option></select></label>' +
    '<label class="fld"><span>سبب التوقف (إن وجد)</span><input id="ps-r" value="' + esc(p.stopReason || '') + '"></label>' +
    '<label class="fld"><span>موعد التسليم</span><input id="ps-e" type="date" value="' + p.end + '"></label>' +
    '<div class="actions"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>');
}

/* ---------- actions ---------- */
const A = {
  filter: d => { ui.filter = d.v; render(); },
  tab: d => { ui.tab = d.v; render(); },
  reqFilter: d => { ui.reqFilter = d.v; render(); },
  authMode: () => { ui.authMode = ui.authMode === 'login' ? 'signup' : 'login'; ui.authErr = ''; render(); },
  logout: async () => { await sb.auth.signOut(); },
  reloadPage: () => location.reload(),
  newReq: d => newReqForm(d.p), newPetty: d => newPettyForm(d.p), newVO: d => newVOForm(d.p), projStatus: d => projStatusForm(d.p),
  close: closeModal, closeOv: (d, el, e) => { if (e.target === el) closeModal(); },
  file: d => openFile(d.v),
  printPO: () => window.print(),
  addLine: () => { document.getElementById('nr-lines').insertAdjacentHTML('beforeend', lineRow()); },
  delLine: (d, el) => { if (document.querySelectorAll('#nr-lines .line').length > 1) el.closest('.line').remove(); },
  qsel: async d => {
    await run(sb.from('quotes').update({ selected: false }).eq('request_id', d.r));
    await run(sb.from('quotes').update({ selected: true }).eq('id', d.v)); refresh();
  },
  qdel: async d => {
    const r = R(d.r); const wasSel = (r.quotes.find(q => q.id === d.v) || {}).sel;
    await run(sb.from('quotes').delete().eq('id', d.v));
    if (wasSel) { const rest = r.quotes.filter(q => q.id !== d.v).sort((a, b) => a.amt - b.amt); if (rest[0]) await run(sb.from('quotes').update({ selected: true }).eq('id', rest[0].id)); }
    refresh();
  },
  approve: async (d, el) => {
    el.disabled = true; const note = (document.getElementById('actnote') || {}).value || null;
    try { const nxt = await run(sb.rpc('advance_request', { p_req: d.v, p_note: note })); toast(nxt === 'done' ? 'صدر أمر الشراء' : 'تم. الطلب الحين عند: ' + ROLES[STAGES.find(s => s.k === nxt).role]); } catch (e) { el.disabled = false; return; }
    refresh();
  },
  reject: async (d, el) => {
    const note = (document.getElementById('actnote') || {}).value || '';
    if (!note.trim()) { toast('اكتب سبب الرفض في خانة الملاحظة', true); document.getElementById('actnote').focus(); return; }
    el.disabled = true; try { await run(sb.rpc('reject_request', { p_req: d.v, p_note: note }), 'تم رفض الطلب'); } catch (e) { el.disabled = false; return; } refresh();
  },
  pcOk: async d => { await run(sb.rpc('decide_petty', { p_id: d.v, p_approve: true }), 'اعتُمد وأُضيف لمصروفات المشروع'); refresh(); },
  pcNo: async d => { await run(sb.rpc('decide_petty', { p_id: d.v, p_approve: false }), 'تم الرفض'); refresh(); },
  voApprove: d => { const v = S.variations.find(x => x.id === d.v); modal('رفع موافقة العميل - ' + v.title, '<form class="f" data-form="voFile" data-v="' + v.id + '"><label class="fld"><span>ملف الموافقة</span><input id="vf" type="file" accept="image/*,.pdf" required></label><div class="actions"><button class="btn pri" type="submit">رفع واعتماد</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>'); },
  saveUser: async d => { await run(sb.rpc('set_user_role', { p_user: d.v, p_role: document.getElementById('ur-' + d.v).value, p_dept: document.getElementById('ud-' + d.v).value }), 'تم الحفظ'); refresh(); }
};
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  const a = e.target.closest('[data-act]');
  if (a && a.tagName !== 'SELECT') { const k = a.dataset.act; if (A[k]) { if (k !== 'closeOv' && k !== 'qsel') e.preventDefault(); Promise.resolve(A[k](a.dataset, a, e)).catch(() => {}); return; } }
  if (go && !e.target.closest('a,button,input')) location.hash = go.dataset.go;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); if (e.key === 'Enter') { const g = e.target.closest && e.target.closest('[data-go]'); if (g && g.tagName === 'DIV') location.hash = g.dataset.go; } });
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.prog) { try { await run(sb.rpc('set_progress', { p_item: t.dataset.prog, p_progress: Math.round(+t.value || 0) }), 'تم تحديث الإنجاز'); } catch (x) { } refresh(); return; }
  if (t.id === 'nr-p') { const p = P(t.value); document.getElementById('nr-b').innerHTML = boqOptions(p, '', true); document.getElementById('nr-d').innerHTML = deptOptions(p); }
  if (t.id === 'pc-p') document.getElementById('pc-b').innerHTML = boqOptions(P(t.value), '', true);
});
document.addEventListener('input', e => {
  if (e.target.id === 'np-boq') { const r = parseBoq(e.target.value); document.getElementById('np-preview').textContent = r.items.length ? 'تم التعرف على ' + r.sections.length + ' أقسام و ' + r.items.length + ' بند، بإجمالي ' + money(r.items.reduce((a, i) => a + i.total, 0)) + ' ر.ع' : ''; }
});
document.addEventListener('submit', async e => {
  const f = e.target; e.preventDefault(); const v = id => document.getElementById(id).value;
  const fileOf = id => { const el = document.getElementById(id); return el && el.files && el.files[0] ? el.files[0] : null; };
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try {
    const kind = f.dataset.form;
    if (kind === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email: v('a-email').trim(), password: v('a-pass') });
      if (error) { ui.authErr = error.message === 'Invalid login credentials' ? 'البريد أو كلمة المرور غير صحيحة' : error.message === 'Email not confirmed' ? 'أكّد بريدك من الرسالة اللي وصلتك أولاً' : error.message; render(); }
    } else if (kind === 'signup') {
      const { data, error } = await sb.auth.signUp({ email: v('a-email').trim(), password: v('a-pass'), options: { data: { full_name: v('a-name').trim() }, emailRedirectTo: location.origin + location.pathname } });
      if (error) { ui.authErr = error.message; render(); }
      else if (!data.session) { ui.authMode = 'login'; ui.authErr = ''; render(); toast('أرسلنا رسالة تأكيد لبريدك. أكّده ثم سجّل دخول.'); }
    } else if (kind === 'req') {
      const items = [...f.querySelectorAll('.line')].map(l => ({ description: l.querySelector('.l-d').value.trim(), qty: +l.querySelector('.l-q').value, unit: l.querySelector('.l-u').value.trim() || 'عدد' })).filter(i => i.description);
      const r = await run(sb.from('material_requests').insert({ project_id: v('nr-p'), boq_item_id: v('nr-b') || null, dept: v('nr-d'), need_by: v('nr-need') || null, note: v('nr-note') || null, requested_by: me.id }).select().single());
      await run(sb.from('request_items').insert(items.map(i => Object.assign({ request_id: r.id }, i))));
      closeModal(); await loadAll(); location.hash = 'r-' + r.id; render(); toast('أُرسل الطلب ' + r.no + ' لرئيس القسم');
    } else if (kind === 'quote') {
      const rid = f.dataset.v; const r = R(rid); const amt = +v('q-amt');
      const cheapest = !r.quotes.length || amt < Math.min.apply(null, r.quotes.map(q => q.amt));
      if (cheapest && r.quotes.length) await run(sb.from('quotes').update({ selected: false }).eq('request_id', rid));
      await run(sb.from('quotes').insert({ request_id: rid, supplier: v('q-sup'), amount: amt, terms: v('q-terms'), delivery_days: +v('q-days') || 0, selected: cheapest }), cheapest ? 'أُضيف العرض واختير لأنه الأرخص' : 'أُضيف العرض');
      refresh();
    } else if (kind === 'petty') {
      const path = await upload(fileOf('pc-f'), 'petty');
      const c = await run(sb.from('petty_cash').insert({ project_id: v('pc-p'), boq_item_id: v('pc-b') || null, amount: +v('pc-a'), description: v('pc-d'), receipt_path: path, requested_by: me.id }).select().single());
      closeModal(); toast('أُرسل ' + c.no + ' للمدير العام'); refresh();
    } else if (kind === 'vo') {
      const path = await upload(fileOf('vo-f'), 'variations');
      await run(sb.from('variations').insert({ project_id: f.dataset.v, title: v('vo-t'), description: v('vo-d'), amount: +v('vo-a'), approval_path: path, client_status: path ? 'approved' : 'pending', created_by: me.id }), path ? 'أُضيف العمل الإضافي ومعه موافقة العميل' : 'أُضيف العمل الإضافي بانتظار موافقة العميل');
      ui.tab = 'vo'; closeModal(); refresh();
    } else if (kind === 'voFile') {
      const path = await upload(fileOf('vf'), 'variations');
      await run(sb.from('variations').update({ approval_path: path, client_status: 'approved' }).eq('id', f.dataset.v), 'اعتُمد العمل الإضافي وأُضيف لقيمة المشروع');
      closeModal(); refresh();
    } else if (kind === 'pstatus') {
      await run(sb.from('projects').update({ status: v('ps-s'), stop_reason: v('ps-r') || null, end_date: v('ps-e') }).eq('id', f.dataset.v), 'تم الحفظ');
      closeModal(); refresh();
    } else if (kind === 'project') {
      const depts = [...f.querySelectorAll('[name=np-dept]:checked')].map(x => x.value);
      if (!depts.length) { toast('اختر قسم واحد على الأقل', true); return; }
      if (v('np-end') < v('np-start')) { toast('موعد التسليم قبل تاريخ البداية', true); return; }
      const boq = parseBoq(v('np-boq'));
      const tasks = v('np-tasks').split(/\r?\n/).map(l => l.split('\t')).filter(c => c[0] && c[0].trim()).map((c, i) => ({ name: c[0].trim(), start_date: parseDate(c[1]), end_date: parseDate(c[2]), sort: i })).filter(t => t.start_date && t.end_date);
      const p = await run(sb.from('projects').insert({ name: v('np-name'), short_name: v('np-short'), client: v('np-client'), type: v('np-type'), depts, start_date: v('np-start'), end_date: v('np-end') }).select().single());
      if (boq.sections.length) await run(sb.from('boq_sections').insert(boq.sections.map((s, i) => ({ project_id: p.id, code: s[0], name: s[1], sort: i }))));
      if (boq.items.length) await run(sb.from('boq_items').insert(boq.items.map((b, i) => ({ project_id: p.id, section_code: b.sec, code: b.code, description: b.desc, qty: b.qty, unit: b.unit, rate: b.rate, total: b.total, sort: i }))));
      if (tasks.length) await run(sb.from('tasks').insert(tasks.map(t => Object.assign({ project_id: p.id }, t))));
      await loadAll(); location.hash = 'p-' + p.id; toast('أُضيف المشروع' + (boq.items.length ? ' مع ' + boq.items.length + ' بند' : ''));
    }
  } catch (err) { /* toast already shown */ }
  finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ---------- shell ---------- */
function render() {
  const root = document.getElementById('root');
  if (!session) { root.innerHTML = vAuth(); return; }
  if (!me) { root.innerHTML = '<div class="loading">جاري التحميل...</div>'; return; }
  if (me.role === 'pending') { root.innerHTML = vPending(); return; }
  const q = myQueue(); const h = location.hash.slice(1) || 'dashboard';
  const sec = h.startsWith('p-') || h === 'new-project' ? 'projects' : h.startsWith('r-') ? 'requests' : h;
  const items = [['dashboard', 'لوحة المتابعة', 'dash', 'المتابعة'], ['projects', 'المشاريع', 'proj', 'المشاريع'], ['requests', 'طلبات المواد', 'req', 'الطلبات'], ['petty', 'بيتي كاش', 'cash', 'بيتي كاش'], ['inbox', 'بانتظار إجرائي', 'inbox', 'إجرائي']];
  if (isAdmin()) items.push(['users', 'المستخدمين', 'users', 'المستخدمين']);
  const pendUsers = isAdmin() ? S.profiles.filter(u => u.role === 'pending').length : 0;
  const badge = k => k === 'inbox' && q.n ? '<span class="badge">' + q.n + '</span>' : k === 'users' && pendUsers ? '<span class="badge">' + pendUsers + '</span>' : '';
  root.innerHTML = '<div class="app"><aside class="side"><div class="brand"><div class="mark">C</div><div><b>كربون</b><span>إدارة المشاريع</span></div></div><nav class="nav">' +
    items.map(([k, l, i]) => '<a href="#' + k + '" class="' + (sec === k ? 'on' : '') + '">' + ico(i) + l + badge(k) + '</a>').join('') +
    '</nav><div class="rolebox"><div class="me"><b>' + esc(me.full_name) + '</b><span class="muted">' + ROLES[me.role] + (me.dept ? ' · ' + DEPTS[me.dept] : '') + '</span></div><button type="button" data-act="logout">تسجيل خروج</button></div></aside>' +
    '<main><div class="wrap"><div class="mrole"><span class="small"><b>' + esc(me.full_name) + '</b> · ' + ROLES[me.role] + '</span><span style="flex:1"></span><button class="linkbtn small" data-act="logout">خروج</button></div>' + views() + '</div></main>' +
    '<nav class="bnav">' + items.filter(x => x[0] !== 'users').map(([k, l, i, s]) => '<a href="#' + k + '" class="' + (sec === k ? 'on' : '') + '">' + ico(i) + '<span>' + s + '</span>' + badge(k) + '</a>').join('') + '</nav></div>';
}

async function boot(sess) {
  session = sess; me = null; render();
  if (!session) return;
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) { toast(errMsg(error), true); return; }
  me = data;
  if (me.role !== 'pending') { try { await loadAll(); } catch (e) { toast(errMsg(e), true); } }
  render();
}
let lastUser = undefined;
sb.auth.onAuthStateChange((evt, sess) => {
  const uid = sess ? sess.user.id : null;
  if (uid === lastUser && evt !== 'SIGNED_IN') { session = sess; return; }
  if (uid === lastUser && me) { session = sess; return; }
  lastUser = uid; setTimeout(() => boot(sess), 0);
});
})();
