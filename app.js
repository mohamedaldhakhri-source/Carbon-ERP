(function () {
'use strict';
const sb = supabase.createClient(window.CARBON_CONFIG.supabaseUrl, window.CARBON_CONFIG.supabaseKey);

const DEPTS = { arch: 'معماري', interior: 'تصميم داخلي', fitout: 'فيت أوت', joinery: 'منجرة', contracting: 'مقاولات', supervision: 'إشراف' };
const OMAN = {
  'مسقط': ['مسقط', 'مطرح', 'بوشر', 'السيب', 'العامرات', 'قريات'],
  'ظفار': ['صلالة', 'طاقة', 'مرباط', 'رخيوت', 'ثمريت', 'ضلكوت', 'المزيونة', 'مقشن', 'شليم وجزر الحلانيات', 'سدح'],
  'مسندم': ['خصب', 'دبا', 'بخا', 'مدحاء'],
  'البريمي': ['البريمي', 'محضة', 'السنينة'],
  'الداخلية': ['نزوى', 'بهلا', 'منح', 'الحمراء', 'أدم', 'إزكي', 'سمائل', 'بدبد', 'الجبل الأخضر'],
  'شمال الباطنة': ['صحار', 'شناص', 'لوى', 'صحم', 'الخابورة', 'السويق'],
  'جنوب الباطنة': ['الرستاق', 'العوابي', 'نخل', 'وادي المعاول', 'بركاء', 'المصنعة'],
  'جنوب الشرقية': ['صور', 'الكامل والوافي', 'جعلان بني بو حسن', 'جعلان بني بو علي', 'مصيرة'],
  'شمال الشرقية': ['إبراء', 'المضيبي', 'بدية', 'القابل', 'وادي بني خالد', 'دماء والطائيين', 'سناو'],
  'الظاهرة': ['عبري', 'ينقل', 'ضنك'],
  'الوسطى': ['هيماء', 'محوت', 'الدقم', 'الجازر']
};
const ROLES = { admin: 'مدير النظام', owner: 'صاحب الشركة', gm: 'المدير العام', head: 'رئيس قسم', site: 'مهندس موقع', procurement: 'المشتريات', finance: 'المالية', pending: 'بانتظار التفعيل' };
const STAGES = [
  { k: 'dept', l: 'موافقة رئيس القسم', role: 'head' },
  { k: 'procurement', l: 'تحديد المواد والأسعار', role: 'procurement' },
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
const LOGO = '<div class="logo"><img src="assets/logo.png" alt="Carbon Engineering Design"></div><div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';
const ico = k => '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + ICONS[k] + '</svg>';

/* ---------- state ---------- */
let session = null, me = null;
let S = { projects: [], pending: [], requests: [], petty: [], variations: [], profiles: [], docs: [] };
let ui = { filter: 'all', tab: 'boq', reqFilter: 'mine', authMode: 'login', authErr: '' };

/* ---------- helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Math.round(+n || 0).toLocaleString('en-US');
const D = s => new Date(String(s).slice(0, 10) + 'T00:00:00');
const fd = s => { if (!s) return '—'; const d = D(s); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
const ftime = s => { if (!s) return ''; const d = new Date(s); return fd(d.toISOString()) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const daysBetween = (a, b) => Math.round((b - a) / 864e5);
const P = id => S.projects.find(p => p.id === id) || S.pending.find(p => p.id === id);
const canApprove = () => me && ['gm', 'owner', 'admin'].includes(me.role);
const canNewProject = () => isAdmin() || (me && me.role === 'head');
const DOCK = { contract: 'العقد', boq: 'جدول الكميات BOQ', drawing: 'مخططات', ministry: 'موافقة الوزارة / العميل', other: 'مستند آخر' };
const R = id => S.requests.find(r => r.id === id);
const nameOf = id => { const p = S.profiles.find(x => x.id === id); return p ? p.full_name : '—'; };
const selQuote = r => (r.quotes || []).find(q => q.sel);
const reqAmt = r => { const q = selQuote(r); return q ? +q.amt : 0; };
const isAdmin = () => me && ['admin', 'owner', 'gm'].includes(me.role);
const itemByCode = (p, c) => p.boq.find(b => b.c === c);
const canSched = () => me && (me.role === 'gm' || me.role === 'admin');
const canDates = p => me && ['site', 'head', 'gm', 'owner', 'admin'].includes(me.role) && p.status !== 'closed';
const myItem = b => me.role !== 'head' || !me.dept || b.dept === me.dept;
const planN = p => p.boq.filter(b => b.ps && b.pe).length || p.tasks.length;
const locText = p => [p.wil, p.gov].filter(Boolean).join('، ') + (p.loc ? (p.wil || p.gov ? ' - ' : '') + p.loc : '');
const pName = p => p ? (p.code ? p.code + ' · ' : '') + p.short : '';
const govOpts = sel => '<option value="">اختر المحافظة</option>' + Object.keys(OMAN).map(g => '<option' + (g === sel ? ' selected' : '') + '>' + g + '</option>').join('');
const wilOpts = (gov, sel) => '<option value="">اختر الولاية</option>' + (OMAN[gov] || []).map(w => '<option' + (w === sel ? ' selected' : '') + '>' + w + '</option>').join('');
const deptSel = (sel, attrs, allowNone) => '<select ' + attrs + '>' + (allowNone || !sel ? '<option value="">' + (allowNone || 'غير محدد') + '</option>' : '') + Object.entries(DEPTS).map(([k, l]) => '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
function nextCode() {
  const d = new Date(), per = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0'), pre = 'CEC-PRJ-' + per + '-';
  const n = S.projects.concat(S.pending).map(p => String(p.code || '')).filter(c => c.startsWith(pre)).map(c => parseInt(c.slice(pre.length), 10) || 0);
  return pre + String((n.length ? Math.max.apply(null, n) : 0) + 1).padStart(3, '0');
}

function contract(p) { return p.boq.reduce((a, b) => a + b.t, 0); }
function varsApproved(p) { return S.variations.filter(v => v.pid === p.id && v.gm === 'approved').reduce((a, v) => a + v.amt, 0); }
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
  if (me.role === 'admin') return true;
  if (s.role !== me.role) return false;
  if (s.role === 'head' && me.dept && me.dept !== r.dept) return false;
  return true;
}
function myQueue() {
  const reqs = S.requests.filter(canActOn);
  const pc = me && (me.role === 'gm' || me.role === 'admin') ? S.petty.filter(c => c.status === 'pending') : [];
  const sched = canSched() ? S.projects.filter(p => p.status !== 'closed' && planN(p) && p.sched.status !== 'approved') : [];
  const projs = canApprove() ? S.pending.filter(p => p.approval === 'pending') : [];
  const vos = canApprove() ? S.variations.filter(v => v.gm === 'pending') : [];
  return { reqs, pc, sched, projs, vos, n: reqs.length + pc.length + sched.length + projs.length + vos.length };
}
function bar(pct, cls, marker) { return '<div class="bar"><i class="' + (cls || '') + '" style="width:' + Math.min(100, Math.max(0, pct)).toFixed(1) + '%"></i>' + (marker != null ? '<b style="inset-inline-start:calc(' + Math.min(100, marker).toFixed(1) + '% - 1px)" title="الوقت المنقضي"></b>' : '') + '</div>'; }
function boqOptions(p, sel, allowNone) {
  let h = allowNone ? '<option value="">خارج BOQ / غير محدد</option>' : '';
  p.sections.forEach(([s, n]) => { const it = p.boq.filter(b => b.s === s); if (!it.length) return; h += '<optgroup label="' + esc(s + ' - ' + n) + '">'; it.forEach(b => { h += '<option value="' + esc(b.id) + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(b.c + ' ' + b.d) + '</option>'; }); h += '</optgroup>'; });
  return h;
}
function projOptions(sel) { return S.projects.filter(p => p.status !== 'closed').map(p => '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(pName(p)) + '</option>').join(''); }
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
    q('petty_cash').order('created_at'), q('variations').order('created_at'), q('profiles').order('created_at'), q('project_docs').order('created_at')]);
  const bad = res.find(r => r.error); if (bad) throw bad.error;
  const [pr, secs, items, tasks, reqs, ritems, quotes, hist, petty, vars, profs, docs] = res.map(r => r.data);
  S.docs = docs.map(d => ({ id: d.id, pid: d.project_id, kind: d.kind, title: d.title, path: d.path, byId: d.uploaded_by, date: d.created_at }));
  S.profiles = profs;
  const codeOf = {}; items.forEach(b => { codeOf[b.id] = b.code; });
  const allP = pr.map(p => ({
    approval: p.approval || 'approved', reqBy: p.requested_by, apBy: p.approval_by, apAt: p.approval_at, apNote: p.approval_note,
    id: p.id, code: p.code, name: p.name, short: p.short_name, client: p.client, type: p.type, depts: p.depts || [], start: p.start_date, end: p.end_date,
    status: p.status, stopReason: p.stop_reason, vat: +p.vat, gov: p.governorate, wil: p.wilayat, loc: p.location_note,
    sched: { status: p.schedule_status, by: p.schedule_approved_by, at: p.schedule_approved_at, note: p.schedule_note },
    sections: secs.filter(s => s.project_id === p.id).map(s => [s.code, s.name]),
    boq: items.filter(b => b.project_id === p.id).map(b => ({ id: b.id, c: b.code, s: b.section_code, d: b.description, q: +b.qty, u: b.unit, r: +b.rate, t: +b.total, p: b.progress, sp: +b.prior_spent, dept: b.dept, ps: b.start_date, pe: b.end_date })),
    tasks: tasks.filter(t => t.project_id === p.id).map(t => ({ id: t.id, n: t.name, s: t.start_date, e: t.end_date, ph: t.is_phase, dept: t.dept }))
  }));
  S.projects = allP.filter(p => p.approval === 'approved');
  S.pending = allP.filter(p => p.approval !== 'approved' && (canApprove() || p.reqBy === me.id));
  S.requests = reqs.map(r => ({
    id: r.id, no: r.no, pid: r.project_id, boqId: r.boq_item_id, boq: r.boq_item_id ? codeOf[r.boq_item_id] : null, dept: r.dept, byId: r.requested_by, by: nameOf(r.requested_by),
    date: r.created_at, need: r.need_by, note: r.note, stage: r.stage, po: r.po_no ? { no: r.po_no, date: r.po_date } : null,
    items: ritems.filter(i => i.request_id === r.id).map(i => ({ id: i.id, d: i.description, q: +i.qty, u: i.unit, pr: i.unit_price == null ? null : +i.unit_price })),
    quotes: quotes.filter(x => x.request_id === r.id).map(x => ({ id: x.id, sup: x.supplier, amt: +x.amount, terms: x.terms, days: x.delivery_days, sel: x.selected })),
    hist: hist.filter(h => h.request_id === r.id).map(h => ({ t: h.created_at, by: h.actor_name, role: h.role, a: h.action, note: h.note }))
  }));
  S.petty = petty.map(c => ({ id: c.id, no: c.no, pid: c.project_id, boq: c.boq_item_id ? codeOf[c.boq_item_id] : null, amt: +c.amount, d: c.description, by: nameOf(c.requested_by), date: c.created_at, status: c.status, file: c.receipt_path, note: c.decision_note }));
  S.variations = vars.map(v => ({ id: v.id, no: v.no, pid: v.project_id, title: v.title, d: v.description, amt: +v.amount, file: v.approval_path, client: v.client_status, gm: v.gm_status || 'pending', gmBy: v.gm_by, gmAt: v.gm_at, gmNote: v.gm_note, date: v.created_at, byId: v.created_by, by: nameOf(v.created_by) }));
}
async function refresh() { try { await loadAll(); render(); } catch (e) { toast(errMsg(e), true); } }

/* ---------- auth ---------- */
function vAuth() {
  return '<div class="auth"><div class="box">' + LOGO + '<div class="inner">' +
    '<h1>تسجيل الدخول</h1>' + (ui.authErr ? '<div class="err">' + esc(ui.authErr) + '</div>' : '') +
    '<form class="f" data-form="login">' +
    '<label class="fld"><span>البريد الإلكتروني</span><input id="a-email" type="email" required autocomplete="email" dir="ltr"></label>' +
    '<label class="fld"><span>كلمة المرور</span><input id="a-pass" type="password" required minlength="6" autocomplete="current-password" dir="ltr"></label>' +
    '<button class="btn pri" type="submit">دخول</button></form>' +
    '<span class="hint">ما عندك حساب أو نسيت كلمة المرور؟ تواصل مع مدير النظام.</span></div></div></div>';
}
function vPending() {
  return '<div class="auth"><div class="box">' + LOGO + '<div class="inner"><h1>حسابك بانتظار التفعيل</h1><p class="muted">أهلاً ' + esc(me.full_name) + '. يحتاج مدير النظام يفعّل حسابك ويحدد دورك وقسمك. بعدها حدّث الصفحة.</p><div class="actions"><button class="btn pri" data-act="reloadPage">تحديث</button><button class="btn" data-act="logout">خروج</button></div></div></div></div>';
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
  let h = '<div class="head"><div class="t"><h1>لوحة متابعة المشاريع</h1><span class="muted">اليوم ' + fd(iso(today)) + '</span></div><div class="actions">' + segFilter() + (canNewProject() ? '<a class="btn pri" href="#new-project">+ مشروع جديد</a>' : '') + '</div></div>';
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
      return '<tr class="click" data-go="p-' + p.id + '"><td><b>' + esc(p.short) + '</b><div class="muted small"><span class="num">' + esc(p.code || '') + '</span>' + (p.client ? ' · ' + esc(p.client) : '') + (p.wil || p.gov ? ' · ' + esc(p.wil || p.gov) : '') + '</div></td>' +
        '<td><span class="tag ' + (p.type === 'gov' ? 'gov' : '') + '">' + (p.type === 'gov' ? 'حكومي' : 'خاص') + '</span></td>' +
        '<td style="max-width:200px">' + p.depts.map(d => '<span class="tag">' + DEPTS[d] + '</span>').join('') + '</td>' +
        '<td style="min-width:150px"><div class="barrow">' + bar(pr, hh.k === 'late' ? 'bad' : hh.k === 'risk' ? 'warn' : '', p.status === 'closed' ? null : timePct(p)) + '<span>' + Math.round(pr) + '%</span></div></td>' +
        '<td style="min-width:170px"><div class="barrow">' + bar(s / b * 100, s > b ? 'bad' : 'ok') + '<span>' + Math.round(s / b * 100) + '%</span></div><div class="muted small num">' + money(s) + ' / ' + money(b) + '</div></td>' +
        '<td class="n">' + (p.status === 'closed' ? '—' : dl < 0 ? '<span style="color:var(--bad)">متأخر ' + (-dl) + ' يوم</span>' : dl + ' يوم') + '</td>' +
        '<td><span class="pill ' + hh.c + '">' + hh.l + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';
}
function vProjects() {
  return '<div class="head"><div class="t"><h1>المشاريع</h1><span class="muted">' + S.projects.length + ' مشاريع</span></div><div class="actions">' + segFilter() + (canNewProject() ? '<a class="btn pri" href="#new-project">+ مشروع جديد</a>' : '') + '</div></div>' + (S.pending.length ? '<div class="card"><h2>مشاريع بانتظار موافقة المدير العام</h2><div class="tbl"><table><tbody>' + S.pending.map(p => '<tr class="click" data-go="p-' + p.id + '"><td><b>' + esc(pName(p)) + '</b><div class="muted small">' + esc(p.name) + '</div></td><td class="small">طلبه ' + esc(nameOf(p.reqBy)) + '</td><td>' + (p.approval === 'rejected' ? '<span class="pill p-bad">مرفوض</span>' : '<span class="pill p-warn">بانتظار الموافقة</span>') + '</td></tr>').join('') + '</tbody></table></div></div>' : '') + '<div class="card">' + projTable(S.projects.filter(p => ui.filter === 'all' || p.type === ui.filter)) + '</div>';
}
function vProject(id) {
  const p = P(id); if (!p) return '<div class="empty">المشروع غير موجود</div>';
  const hh = health(p), pr = progress(p), c = contract(p), va = varsApproved(p), b = budget(p), s = spent(p), cm = committed(p), dl = daysLeft(p);
  const reqs = S.requests.filter(r => r.pid === id), pcs = S.petty.filter(x => x.pid === id), vos = S.variations.filter(v => v.pid === id);
  const canProg = ['site', 'head', 'gm', 'owner', 'admin'].includes(me.role) && p.status === 'active';
  let h = '<div class="head"><div class="t"><span class="crumb"><a href="#projects">المشاريع</a> / ' + esc(pName(p)) + '</span><h1>' + esc(p.name) + '</h1><div class="actions"><span class="pill ' + hh.c + '">' + hh.l + '</span><span class="tag ' + (p.type === 'gov' ? 'gov' : '') + '">' + (p.type === 'gov' ? 'مشروع حكومي' : 'مشروع خاص') + '</span>' + p.depts.map(d => '<span class="tag">' + DEPTS[d] + '</span>').join('') + '</div><span class="muted small">كود المشروع <b class="num">' + esc(p.code || '—') + '</b>' + (p.client ? ' · العميل ' + esc(p.client) : '') + (locText(p) ? ' · 📍 ' + esc(locText(p)) : '') + '</span></div>' +
    '<div class="actions">' + (p.approval === 'approved' && p.status !== 'closed' ? '<button class="btn pri" data-act="newReq" data-p="' + id + '">+ طلب مواد</button><button class="btn" data-act="newPetty" data-p="' + id + '">+ بيتي كاش</button><button class="btn" data-act="newVO" data-p="' + id + '">+ عمل إضافي</button>' : '') + (isAdmin() ? '<button class="btn" data-act="projStatus" data-p="' + id + '">بيانات وحالة المشروع</button>' : '') + '</div></div>';
  if (p.approval === 'pending') h += '<div class="flag warn ch"><span>هذا المشروع طلبه ' + esc(nameOf(p.reqBy)) + ' وبانتظار موافقة المدير العام. ما يظهر لباقي الموظفين ولا ينفع عليه طلبات لين يتعتمد.</span>' + (canApprove() ? '<span class="actions"><button class="btn ok" data-act="projOk" data-v="' + p.id + '">اعتماد المشروع</button><button class="btn bad" data-act="projNo" data-v="' + p.id + '">رفض</button></span>' : '') + '</div>';
  else if (p.approval === 'rejected') h += '<div class="flag bad">رفض المدير العام هذا المشروع' + (p.apNote ? ': ' + esc(p.apNote) : '') + '</div>';
  else if (hh.why) h += '<div class="flag ' + (hh.k === 'late' ? 'bad' : 'warn') + '">' + esc(hh.why) + '</div>';
  h += '<div class="kpis">' +
    '<div class="kpi"><span class="l">قيمة العقد (بدون الضريبة)</span><span class="v">' + money(c) + ' <small>ر.ع</small></span><span class="s">' + (va ? '+ ' + money(va) + ' أعمال إضافية معتمدة' : 'لا توجد أعمال إضافية معتمدة') + '</span></div>' +
    '<div class="kpi"><span class="l">المصروف</span><span class="v">' + money(s) + ' <small>ر.ع</small></span><span class="s">' + Math.round(s / b * 100) + '% من القيمة، وملتزم به ' + money(cm) + '</span></div>' +
    '<div class="kpi"><span class="l">نسبة الإنجاز</span><span class="v">' + Math.round(pr) + '%</span><span class="s">الوقت المنقضي ' + Math.round(timePct(p)) + '%</span></div>' +
    '<div class="kpi' + (dl < 0 && p.status === 'active' ? ' alert' : '') + '"><span class="l">موعد التسليم</span><span class="v">' + fd(p.end) + '</span><span class="s">' + (p.status === 'closed' ? 'المشروع مغلق' : dl < 0 ? 'متأخر ' + (-dl) + ' يوم' : 'باقي ' + dl + ' يوم') + ' · البداية ' + fd(p.start) + '</span></div></div>';
  const tabs = [['boq', 'بنود BOQ', p.boq.length], ['time', 'الجدول الزمني', planN(p)], ['req', 'طلبات المواد', reqs.length], ['pc', 'بيتي كاش', pcs.length], ['vo', 'الأعمال الإضافية', vos.length], ['docs', 'المستندات', S.docs.filter(x => x.pid === p.id).length]];
  const showTime = planN(p) || isAdmin() || canDates(p) || (ui.ted && ui.ted.pid === p.id);
  if (!showTime && ui.tab === 'time') ui.tab = 'boq';
  h += '<div class="card" style="padding-top:4px"><div class="tabs" role="tablist">' + tabs.filter(t => t[0] !== 'time' || showTime).map(([k, l, n]) => '<button role="tab" data-act="tab" data-v="' + k + '" class="' + (ui.tab === k ? 'on' : '') + '">' + l + '<span class="c num">' + n + '</span>' + (k === 'time' && planN(p) && p.sched.status !== 'approved' ? '<span class="dot-w" title="بانتظار اعتماد المدير العام"></span>' : '') + '</button>').join('') + '</div><div style="padding-top:14px">';
  if (ui.tab === 'boq') {
    if (!p.boq.length) h += '<div class="empty">لا توجد بنود BOQ لهذا المشروع.</div>';
    else {
      const bf = ui.bdept && ui.bdept !== 'all' ? ui.bdept : null; const noDept = p.boq.filter(x => !x.dept).length;
      const usedD = Object.keys(DEPTS).filter(k => p.boq.some(x => x.dept === k));
      h += '<div class="ch" style="margin-bottom:8px"><div class="seg">' + [['all', 'كل الأقسام']].concat(usedD.map(k => [k, DEPTS[k]])).concat(noDept ? [['none', 'بدون قسم (' + noDept + ')']] : []).map(([k, l]) => '<button data-act="bdeptFilter" data-v="' + k + '" class="' + ((ui.bdept || 'all') === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
        (isAdmin() && noDept ? '<button class="btn sm" data-act="boqClassify" data-v="' + p.id + '">وزّع ' + noDept + ' بند على الأقسام بالذكاء</button>' : '') + '</div>' +
        '<span class="muted small">' + (canProg ? 'حدّث نسبة الإنجاز لكل بند مباشرة من الجدول.' : 'نسبة الإنجاز يحدّثها مهندس الموقع أو رئيس القسم.') + (isAdmin() ? ' تقدر تغيّر القسم المسؤول عن أي بند.' : '') + '</span>' +
        '<div class="tbl"><table><thead><tr><th>البند</th><th>الوصف</th><th>القسم</th><th class="n">الكمية</th><th class="n">سعر الوحدة</th><th class="n">القيمة</th><th class="n">المصروف</th><th>الإنجاز</th></tr></thead><tbody>';
      const match = x => !bf || (bf === 'none' ? !x.dept : x.dept === bf);
      p.sections.forEach(([sc, sn]) => {
        const it = p.boq.filter(x => x.s === sc && match(x)); if (!it.length) return; const st = it.reduce((a, x) => a + x.t, 0); const ss = it.reduce((a, x) => a + itemSpent(p, x.c), 0);
        h += '<tr class="sec"><td>' + esc(sc) + '</td><td>' + esc(sn) + '</td><td></td><td></td><td></td><td class="n">' + money(st) + '</td><td class="n">' + money(ss) + '</td><td><div class="barrow">' + bar(secProgress(p, sc)) + '<span>' + Math.round(secProgress(p, sc)) + '%</span></div></td></tr>';
        it.forEach(x => {
          const isp = itemSpent(p, x.c);
          h += '<tr><td class="num small">' + esc(x.c) + '</td><td>' + esc(x.d) + '</td><td>' + (isAdmin() ? deptSel(x.dept, 'class="dsel" data-bdept="' + x.id + '" aria-label="قسم البند ' + esc(x.c) + '"') : (x.dept ? '<span class="tag">' + DEPTS[x.dept] + '</span>' : '<span class="muted">—</span>')) + '</td><td class="n">' + x.q + ' ' + esc(x.u) + '</td><td class="n">' + money(x.r) + '</td><td class="n">' + money(x.t) + '</td><td class="n"' + (isp > x.t ? ' style="color:var(--bad)" title="تجاوز قيمة البند"' : '') + '>' + money(isp) + '</td><td style="min-width:150px"><div class="barrow">' + bar(x.p, x.p >= 100 ? 'ok' : '') + (canProg ? '<input class="prog-in num" type="number" min="0" max="100" value="' + x.p + '" data-prog="' + x.id + '" aria-label="نسبة إنجاز البند ' + esc(x.c) + '">' : '<span>' + x.p + '%</span>') + '</div></td></tr>';
        });
      });
      if (bf) { const fl = p.boq.filter(match); h += '<tr class="sec"><td></td><td>إجمالي ' + (bf === 'none' ? 'البنود بدون قسم' : 'بنود ' + DEPTS[bf]) + '</td><td></td><td></td><td></td><td class="n">' + money(fl.reduce((a, x) => a + x.t, 0)) + '</td><td class="n">' + money(fl.reduce((a, x) => a + itemSpent(p, x.c), 0)) + '</td><td></td></tr></tbody></table></div>'; }
      else {
        h += '<tr class="sec"><td></td><td>الإجمالي بدون الضريبة</td><td></td><td></td><td></td><td class="n">' + money(c) + '</td><td class="n">' + money(p.boq.reduce((a, x) => a + itemSpent(p, x.c), 0)) + '</td><td></td></tr>';
        h += '<tr><td></td><td class="muted">ضريبة القيمة المضافة ' + p.vat + '%</td><td></td><td></td><td></td><td class="n muted">' + money(c * p.vat / 100) + '</td><td></td><td></td></tr><tr><td></td><td><b>الإجمالي الكلي</b></td><td></td><td></td><td></td><td class="n"><b>' + money(c * (1 + p.vat / 100)) + '</b></td><td></td><td></td></tr></tbody></table></div>';
      }
    }
  } else if (ui.tab === 'time') h += timeTab(p);
  else if (ui.tab === 'req') h += reqTable(reqs, false);
  else if (ui.tab === 'pc') h += pettyTable(pcs, false);
  else if (ui.tab === 'vo') h += (vos.length ? voTable(vos, false) : '<div class="empty">لا توجد أعمال إضافية لهذا المشروع.</div>') + '<p class="muted small">العمل الإضافي (خارج العقد) يحتاج مرفق موافقة الوزارة أو العميل، وبعدها يعتمده المدير العام ويُضاف لقيمة المشروع وميزانيته.</p>';
  else if (ui.tab === 'docs') h += docsTab(p);
  h += '</div></div>';
  return h;
}
function reqTable(list, showProj) {
  if (!list.length) return '<div class="empty">لا توجد طلبات.</div>';
  return '<div class="tbl"><table><thead><tr><th>رقم الطلب</th>' + (showProj ? '<th>المشروع</th>' : '') + '<th>المواد</th><th>البند</th><th class="n">المبلغ</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>' +
    list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(r => { const si = stageInfo(r), p = P(r.pid); return '<tr class="click" data-go="r-' + r.id + '"><td class="num small"><b>' + esc(r.no) + '</b></td>' + (showProj ? '<td>' + esc(pName(p)) + '</td>' : '') + '<td>' + esc(r.items[0] ? r.items[0].d : '') + (r.items.length > 1 ? ' <span class="muted small">+' + (r.items.length - 1) + '</span>' : '') + '</td><td class="num small">' + (r.boq ? esc(r.boq) : '<span style="color:var(--warn)">خارج BOQ</span>') + '</td><td class="n">' + (reqAmt(r) ? money(reqAmt(r)) : '<span class="muted">—</span>') + '</td><td class="small">' + fd(r.date) + '</td><td><span class="pill ' + si.c + '">' + si.l + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
}
function pettyTable(list, showProj) {
  if (!list.length) return '<div class="empty">لا توجد طلبات بيتي كاش.</div>';
  const gm = me.role === 'gm' || me.role === 'admin';
  return '<div class="tbl"><table><thead><tr><th>الرقم</th>' + (showProj ? '<th>المشروع</th>' : '') + '<th>التفاصيل</th><th class="n">المبلغ</th><th>مقدم الطلب</th><th>الحالة</th></tr></thead><tbody>' +
    list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(c => '<tr><td class="num small"><b>' + esc(c.no) + '</b><div class="muted">' + fd(c.date) + '</div></td>' + (showProj ? '<td><a href="#p-' + c.pid + '">' + esc(pName(P(c.pid))) + '</a></td>' : '') + '<td>' + esc(c.d) + '<div class="muted small">' + (c.boq ? 'بند ' + esc(c.boq) : 'مصروف عام للمشروع') + ' ' + fileLink(c.file, 'الفاتورة') + '</div>' + (c.note ? '<div class="small">ملاحظة المدير: ' + esc(c.note) + '</div>' : '') + '</td><td class="n">' + money(c.amt) + '</td><td class="small">' + esc(c.by) + '</td><td>' +
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
  let h = '<div class="head"><div class="t"><span class="crumb"><a href="#requests">طلبات المواد</a> / ' + esc(r.no) + '</span><h1>طلب مواد ' + esc(r.no) + '</h1><div class="actions"><span class="pill ' + si.c + '">' + si.l + '</span><a class="tag" href="#p-' + p.id + '">' + esc(pName(p)) + '</a><span class="tag">' + DEPTS[r.dept] + '</span></div></div></div>';
  h += '<div class="card"><div class="steps">' + STAGES.map((s, i) => { let c = ''; if (r.stage === 'rejected') { c = i < rejIdx ? 'done' : i === rejIdx ? 'rej' : ''; } else if (r.stage === 'done' || i < idx) c = 'done'; else if (i === idx) c = 'cur'; return '<div class="step ' + c + '"><span class="dot">' + (c === 'done' ? '✓' : c === 'rej' ? '✕' : i + 1) + '</span>' + s.l + '</div>'; }).join('') + '</div></div>';
  h += '<div class="grid2"><div style="display:flex;flex-direction:column;gap:18px;min-width:0">';
  h += actionPanel(r, p);
  const priced = r.items.some(it => it.pr != null), itot = r.items.reduce((a, it) => a + (it.pr || 0) * it.q, 0);
  if (!(r.stage === 'procurement' && canActOn(r))) h += '<div class="card"><h2>المواد المطلوبة</h2><div class="tbl"><table><thead><tr><th>#</th><th>الوصف</th><th class="n">الكمية</th><th>الوحدة</th>' + (priced ? '<th class="n">سعر الوحدة</th><th class="n">الإجمالي</th>' : '') + '</tr></thead><tbody>' + r.items.map((it, i) => '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(it.d) + '</td><td class="n">' + it.q + '</td><td>' + esc(it.u) + '</td>' + (priced ? '<td class="n">' + (it.pr != null ? money(it.pr) : '—') + '</td><td class="n">' + (it.pr != null ? money(it.pr * it.q) : '—') + '</td>' : '') + '</tr>').join('') + (priced ? '<tr class="sec"><td></td><td>إجمالي المواد</td><td></td><td></td><td></td><td class="n">' + money(itot) + '</td></tr>' : '') + '</tbody></table></div>' + (r.note ? '<p class="muted small" style="margin:10px 0 0">ملاحظة: ' + esc(r.note) + '</p>' : '') + '</div>';
  if (r.quotes.length && !(r.stage === 'procurement' && canActOn(r))) h += '<div class="card"><h2>عروض الأسعار</h2>' + quotesTable(r, false) + '</div>';
  if (r.po) h += poDoc(r, p);
  h += '</div><div style="display:flex;flex-direction:column;gap:18px;min-width:0"><div class="card"><h2>تفاصيل الطلب</h2><dl class="dl"><dt>المشروع</dt><dd><a href="#p-' + p.id + '">' + esc(pName(p)) + '</a></dd><dt>بند BOQ</dt><dd>' + (bi ? esc(bi.c + ' ' + bi.d) : '<span style="color:var(--warn)">خارج BOQ</span>') + '</dd><dt>القسم</dt><dd>' + DEPTS[r.dept] + '</dd><dt>مقدم الطلب</dt><dd>' + esc(r.by) + '</dd><dt>تاريخ الطلب</dt><dd>' + fd(r.date) + '</dd><dt>مطلوب قبل</dt><dd>' + fd(r.need) + '</dd></dl></div>' +
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
  if (r.stage === 'procurement') return '<div class="panel"><h2>تحديد المواد والأسعار</h2><span class="small">اكتب اسم كل مادة بالضبط كما بتنشترى، وسعر الوحدة، ثم سجّل عرض المورّد واختره.</span>' +
    '<div class="tbl"><table><thead><tr><th>المادة (الاسم الدقيق)</th><th class="n">الكمية</th><th>الوحدة</th><th class="n">سعر الوحدة (ر.ع)</th></tr></thead><tbody>' + r.items.map(it => '<tr><td><input class="ri" data-ri="' + it.id + '" data-k="d" value="' + esc(it.d) + '" aria-label="اسم المادة"></td><td class="n">' + it.q + '</td><td>' + esc(it.u) + '</td><td><input class="ri num" type="number" min="0" step="0.001" data-ri="' + it.id + '" data-k="price" value="' + (it.pr != null ? it.pr : '') + '" aria-label="سعر الوحدة"></td></tr>').join('') + '</tbody></table></div>' +
    '<div class="actions" style="margin:8px 0 14px"><button class="btn" data-act="reqItemsSave" data-v="' + r.id + '">حفظ المواد والأسعار</button>' + (r.items.every(it => it.pr != null) ? '<span class="muted small">إجمالي المواد ' + money(r.items.reduce((a, it) => a + it.pr * it.q, 0)) + ' ر.ع</span>' : '<span class="muted small" style="color:var(--warn)">باقي مواد بدون سعر</span>') + '</div>' +
    '<h2>عرض المورّد</h2>' + quotesTable(r, true) +
    '<form class="f" data-form="quote" data-v="' + r.id + '"><div class="fr"><label class="fld"><span>المورّد</span><input id="q-sup" required placeholder="اسم المورّد"></label><label class="fld"><span>المبلغ (ر.ع)</span><input id="q-amt" type="number" min="0" step="0.001" required></label></div><div class="fr"><label class="fld"><span>طريقة الدفع</span><select id="q-terms"><option value="credit30">آجل 30 يوم (كردت)</option><option value="advance">دفعة مقدّمة</option></select></label><label class="fld"><span>مدة التوريد (يوم)</span><input id="q-days" type="number" min="0" value="3"></label></div><div><button class="btn" type="submit">+ إضافة العرض</button></div></form>' +
    noteF + '<div class="actions"><button class="btn ok" data-act="approve" data-v="' + r.id + '" ' + (selQuote(r) && r.items.every(it => it.pr != null) ? '' : 'disabled title="اكتب الأسعار واختر عرض المورّد أولاً"') + '>إرسال للمدير العام</button><button class="btn bad" data-act="reject" data-v="' + r.id + '">إلغاء الطلب</button></div></div>';
  if (r.stage === 'gm') { const q = selQuote(r); return '<div class="panel"><h2>الاعتماد النهائي للشراء</h2><div class="check"><div class="row"><span>المورّد</span><b>' + esc(q.sup) + '</b></div><div class="row"><span>المبلغ</span><b class="num">' + money(q.amt) + ' ر.ع</b></div><div class="row"><span>الدفع</span><b>' + TERMS[q.terms] + '</b></div></div>' + budgetCheck(r, p) + noteF + btns('اعتماد الشراء') + '</div>'; }
  if (r.stage === 'po') { const q = selQuote(r); return '<div class="panel"><h2>إصدار أمر الشراء</h2><span class="small">المدير العام اعتمد الشراء. أصدر أمر الشراء للمورّد <b>' + esc(q.sup) + '</b> بمبلغ <b class="num">' + money(q.amt) + '</b> ر.ع (' + TERMS[q.terms] + ').</span><div class="actions"><button class="btn ok" data-act="approve" data-v="' + r.id + '">إصدار PO وإرساله للمورّد</button></div></div>'; }
  return '';
}
function poDoc(r, p) {
  const q = selQuote(r); if (!q) return '';
  const due = (() => { const d = D(r.po.date); if (q.terms === 'credit30') d.setDate(d.getDate() + 30); return iso(d); })();
  return '<div class="po"><div class="top"><div><h2>أمر شراء</h2><span class="num">' + esc(r.po.no) + '</span></div><div style="text-align:end"><b>كربون للهندسة</b><div class="muted small">التاريخ ' + fd(r.po.date) + '</div></div></div>' +
    '<dl class="dl"><dt>المورّد</dt><dd>' + esc(q.sup) + '</dd><dt>المشروع</dt><dd>' + esc(pName(p)) + '</dd><dt>موقع التوريد</dt><dd>' + esc(locText(p) || '—') + '</dd><dt>مرجع الطلب</dt><dd>' + esc(r.no) + (r.boq ? ' · بند BOQ ' + esc(r.boq) : '') + '</dd><dt>شروط الدفع</dt><dd>' + TERMS[q.terms] + (q.terms === 'credit30' ? ' · تاريخ الاستحقاق ' + fd(due) : ' · يُدفع قبل التوريد') + '</dd><dt>مدة التوريد</dt><dd>' + q.days + ' يوم</dd></dl>' +
    '<div class="tbl"><table><thead><tr><th>الوصف</th><th class="n">الكمية</th><th>الوحدة</th></tr></thead><tbody>' + r.items.map(it => '<tr><td>' + esc(it.d) + '</td><td class="n">' + it.q + '</td><td>' + esc(it.u) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<div class="ch"><span class="muted small">معتمد من المدير العام</span><b class="num">الإجمالي ' + money(q.amt) + ' ر.ع</b></div><div><button class="btn sm" data-act="printPO">طباعة</button></div></div>';
}
function vPetty() {
  const pend = S.petty.filter(c => c.status === 'pending'), tot = S.petty.filter(c => c.status === 'approved').reduce((a, c) => a + c.amt, 0);
  return '<div class="head"><div class="t"><h1>بيتي كاش</h1><span class="muted">مصروفات سريعة تُعتمد من المدير العام وتُحسب على المشروع</span></div><div class="actions"><button class="btn pri" data-act="newPetty">+ طلب بيتي كاش</button></div></div>' +
    '<div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="kpi"><span class="l">بانتظار اعتماد المدير العام</span><span class="v">' + pend.length + '</span><span class="s num">' + money(pend.reduce((a, c) => a + c.amt, 0)) + ' ر.ع</span></div><div class="kpi"><span class="l">إجمالي المعتمد</span><span class="v">' + money(tot) + ' <small>ر.ع</small></span><span class="s">محسوب ضمن مصروفات المشاريع</span></div></div>' +
    '<div class="card">' + pettyTable(S.petty, true) + '</div>';
}
function voTable(list, showProj) {
  return '<div class="tbl"><table><thead><tr><th>الرقم</th><th>العمل الإضافي</th>' + (showProj ? '<th>المشروع</th>' : '') + '<th class="n">القيمة</th><th>موافقة الوزارة / العميل</th><th>اعتماد المدير العام</th><th>التاريخ</th></tr></thead><tbody>' +
    list.map(v => { const p = P(v.pid);
      return '<tr><td class="num small">' + esc(v.no) + '</td><td><b>' + esc(v.title) + '</b><div class="muted small">' + esc(v.d) + '</div><div class="muted small">طلبه ' + esc(v.by) + '</div></td>' + (showProj ? '<td class="small"><a href="#p-' + v.pid + '">' + esc(pName(p)) + '</a></td>' : '') + '<td class="n">' + money(v.amt) + '</td>' +
        '<td class="small">' + (v.file ? fileLink(v.file, 'عرض الموافقة') : ((v.byId === me.id || isAdmin()) ? '<button class="btn sm" data-act="voApprove" data-v="' + v.id + '">إرفاق الموافقة</button>' : '<span class="pill p-warn">ما انرفقت</span>')) + '</td>' +
        '<td>' + (v.gm === 'approved' ? '<span class="pill p-ok">معتمد' + (v.gmBy ? ' من ' + esc(nameOf(v.gmBy)) : '') + '</span>' : v.gm === 'rejected' ? '<span class="pill p-bad">مرفوض</span>' + (v.gmNote ? '<div class="muted small">' + esc(v.gmNote) + '</div>' : '') :
          (canApprove() ? (v.file ? '<span class="actions"><button class="btn sm ok" data-act="voOk" data-v="' + v.id + '">اعتماد</button><button class="btn sm bad" data-act="voNo" data-v="' + v.id + '">رفض</button></span>' : '<span class="muted small">بانتظار إرفاق الموافقة</span>') : '<span class="pill p-warn">بانتظار المدير العام</span>')) + '</td>' +
        '<td class="small">' + fd(v.date) + '</td></tr>'; }).join('') + '</tbody></table></div>';
}
function docsTab(p) {
  const ds = S.docs.filter(x => x.pid === p.id);
  let h = '<div class="ch" style="margin-bottom:8px"><span class="muted small">العقد وجدول الكميات والمخططات وموافقات الوزارة وأي مستند يخص المشروع.</span><button class="btn pri" data-act="newDoc" data-v="' + p.id + '">+ إضافة مستند</button></div>';
  if (!ds.length) return h + '<div class="empty">ما في مستندات لهذا المشروع بعد.</div>';
  return h + '<div class="tbl"><table><thead><tr><th>المستند</th><th>النوع</th><th>رفعه</th><th>التاريخ</th><th></th></tr></thead><tbody>' + ds.map(d => '<tr><td><b>' + esc(d.title) + '</b></td><td><span class="tag">' + (DOCK[d.kind] || d.kind) + '</span></td><td class="small">' + esc(nameOf(d.byId)) + '</td><td class="small">' + fd(d.date) + '</td><td>' + fileLink(d.path, 'فتح') + (me.role === 'admin' ? ' <button class="linkbtn small" style="color:var(--bad)" data-act="docDel" data-v="' + d.id + '">حذف</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>';
}
function vInbox() {
  const q = myQueue();
  let h = '<div class="head"><div class="t"><h1>بانتظار إجرائي</h1><span class="muted">' + ROLES[me.role] + (me.dept ? ' ' + DEPTS[me.dept] : '') + '</span></div></div>';
  if (!q.n) return h + '<div class="card empty">ما عندك شي ينتظر إجراءك الحين.</div>';
  if (q.reqs.length) h += '<div class="card"><h2>طلبات المواد</h2>' + reqTable(q.reqs, true) + '</div>';
  if (q.pc.length) h += '<div class="card"><h2>بيتي كاش</h2>' + pettyTable(q.pc, true) + '</div>';
  if (q.projs.length) h += '<div class="card"><h2>مشاريع جديدة بانتظار موافقتك</h2><div class="tbl"><table><tbody>' + q.projs.map(p => '<tr class="click" data-go="p-' + p.id + '"><td><b>' + esc(pName(p)) + '</b><div class="muted small">' + esc(p.name) + '</div></td><td class="small">من ' + esc(nameOf(p.reqBy)) + ' · ' + p.boq.length + ' بند · ' + money(contract(p)) + ' ر.ع</td><td><span class="pill p-warn">بانتظار الموافقة</span></td></tr>').join('') + '</tbody></table></div></div>';
  if (q.vos.length) h += '<div class="card"><h2>أعمال إضافية بانتظار اعتمادك</h2>' + voTable(q.vos, true) + '</div>';
  if (q.sched.length) h += '<div class="card"><h2>جداول زمنية بانتظار اعتمادك</h2><div class="tbl"><table><tbody>' + q.sched.map(p => '<tr class="click" data-go="p-' + p.id + '" data-tab="time"><td><b>' + esc(pName(p)) + '</b><div class="muted small">' + esc(p.name) + '</div></td><td class="small">' + planN(p) + (p.boq.some(b => b.ps) ? ' بند' : ' مهمة') + ' · ' + fd(p.start) + ' إلى ' + fd(p.end) + '</td><td><span class="pill p-warn">مسودة</span></td></tr>').join('') + '</tbody></table></div></div>';
  return h;
}
function vUsers() {
  if (me.role !== 'admin') return '<div class="empty">صفحة المستخدمين لمدير النظام فقط.</div>';
  const sysAdmin = me.role === 'admin';
  const roleOpts = sel => Object.entries(ROLES).filter(([k]) => k !== 'pending' || sel === 'pending').map(([k, l]) => '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + (k === 'pending' ? 'موقوف' : l) + '</option>').join('');
  const deptOpts = sel => '<option value="">—</option>' + Object.entries(DEPTS).map(([k, l]) => '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + l + '</option>').join('');
  let h = '<div class="head"><div class="t"><h1>المستخدمين</h1><span class="muted">' + S.profiles.length + ' مستخدم</span></div></div>';
  if (sysAdmin) h += '<div class="card"><h2>إضافة موظف</h2><form class="f" data-form="newUser"><div class="fr"><label class="fld"><span>الاسم الكامل</span><input id="nu-name" required></label><label class="fld"><span>البريد الإلكتروني (للدخول)</span><input id="nu-email" type="email" required dir="ltr"></label></div>' +
    '<div class="fr"><label class="fld"><span>كلمة المرور</span><input id="nu-pass" type="text" required minlength="6" dir="ltr" autocomplete="off"></label><label class="fld"><span>الدور</span><select id="nu-role" required>' + roleOpts('site') + '</select></label></div>' +
    '<div class="fr"><label class="fld"><span>القسم</span><select id="nu-dept">' + deptOpts('') + '</select></label><div class="fld" style="justify-content:flex-end"><button class="btn pri" type="submit">إضافة الموظف</button></div></div>' +
    '<span class="hint">أعطِ الموظف بريده وكلمة المرور، ويقدر يدخل مباشرة. رئيس القسم يعتمد طلبات قسمه فقط، واتركه بدون قسم إذا يعتمد كل الأقسام.</span></form></div>';
  h += '<div class="card"><div class="tbl"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>القسم</th><th></th></tr></thead><tbody>' +
    S.profiles.map(u => '<tr><td><b>' + esc(u.full_name) + '</b>' + (u.role === 'pending' ? ' <span class="pill p-idle">موقوف</span>' : '') + '</td><td class="small" dir="ltr" style="text-align:end">' + esc(u.email) + '</td><td><select id="ur-' + u.id + '" aria-label="الدور"' + (u.id === me.id ? ' disabled' : '') + '>' + roleOpts(u.role) + '</select></td><td><select id="ud-' + u.id + '" aria-label="القسم">' + deptOpts(u.dept) + '</select></td><td><div class="actions"><button class="btn sm" data-act="saveUser" data-v="' + u.id + '">حفظ</button>' +
      (sysAdmin ? '<button class="btn sm" data-act="resetPass" data-v="' + u.id + '">كلمة مرور جديدة</button>' + (u.id !== me.id ? '<button class="btn sm bad" data-act="delUser" data-v="' + u.id + '">حذف</button>' : '') : '') + '</div></td></tr>').join('') + '</tbody></table></div></div>';
  return h;
}
function npState() {
  if (!ui.np) ui.np = { f: { code: '', type: 'gov', start: iso(today), depts: [] }, sections: [], items: [], tasks: [], notes: '', stated: 0, schedNotes: '', busy: '' };
  return ui.np;
}
function npSync() {
  const n = ui.np; if (!n) return;
  document.querySelectorAll('[data-npf]').forEach(el => { n.f[el.dataset.npf] = el.value; });
  const ds = document.querySelectorAll('[name=np-dept]');
  if (ds.length) n.f.depts = [...ds].filter(x => x.checked).map(x => x.value);
}
// Timeline tab: every BOQ item has its own planned dates, grouped by section. Older projects keep their task list.
function gantt(p, rows) {
  let a = D(p.start), z = D(p.end);
  rows.forEach(r => { if (D(r.s) < a) a = D(r.s); if (D(r.e) > z) z = D(r.e); });
  const span = Math.max(z - a, 864e5), pos = d => (D(d) - a) / span * 100, day = 100 / (span / 864e5), nowPos = (today - a) / span * 100;
  const months = []; const m = new Date(a.getFullYear(), a.getMonth() + 1, 1); while (m <= z) { months.push([(m - a) / span * 100, m.toLocaleDateString('ar', { month: 'short' })]); m.setMonth(m.getMonth() + 1); }
  return '<div class="tbl"><div class="gantt"><div class="gmon"><span></span><div>' + months.map(([x, l]) => '<span style="inset-inline-start:' + x.toFixed(1) + '%">' + l + '</span>').join('') + '</div></div>' +
    rows.map(r => { const s0 = Math.max(0, pos(r.s)), e = Math.min(100, Math.max(pos(r.e) + day, s0 + .6)); return '<div class="gr' + (r.ph ? ' ph' : '') + '"><span title="' + esc(r.t || r.n) + ' · ' + fd(r.s) + ' - ' + fd(r.e) + '">' + esc(r.n) + (r.dept && !r.ph ? ' <span class="tag">' + DEPTS[r.dept] + '</span>' : '') + '</span><div class="gt"><i style="inset-inline-start:' + s0.toFixed(2) + '%;width:' + (e - s0).toFixed(2) + '%"></i>' + (nowPos >= 0 && nowPos <= 100 ? '<span class="now" style="inset-inline-start:' + nowPos.toFixed(1) + '%"></span>' : '') + '</div></div>'; }).join('') +
    '</div></div><p class="muted small">' + (nowPos > 100 ? 'تاريخ اليوم بعد نهاية الخطة الزمنية (' + fd(p.end) + '). حدّث موعد التسليم من "بيانات وحالة المشروع" إذا تم الاتفاق على تمديد.' : 'الخط الأحمر يمثل تاريخ اليوم.') + '</p>';
}
function timeTab(p) {
  const st = p.sched, dated = p.boq.filter(b => b.ps && b.pe), short = t => String(t || '').length > 60 ? String(t).slice(0, 58) + '…' : String(t || '');
  let h = '';
  if (ui.ted && ui.ted.pid === p.id) {
    const idx = {}; ui.ted.list.forEach((r, i) => { idx[r.id] = i; });
    const ch = ui.ted.list.filter(r => r.start !== r.s0 || r.end !== r.e0).length;
    h += '<div class="flag warn">وضع التعديل: غيّر بداية ونهاية أي بند ثم اضغط حفظ.' + (me.role === 'head' && me.dept ? ' تقدر تعدّل بنود قسم ' + DEPTS[me.dept] + ' فقط.' : '') + '</div>' +
      '<div class="ch" style="margin-bottom:8px"><span class="muted small">' + (ch ? ch + ' بند تغيّر' : 'ما في تغيير بعد') + '</span><div class="actions">' + (isAdmin() ? '<button class="btn" data-act="schedAuto" data-v="' + p.id + '">احسب المدد تلقائياً من جديد</button>' : '') + '<button class="btn pri" data-act="schedSave">حفظ</button><button class="btn" data-act="schedCancel">إلغاء</button></div></div>' +
      '<div class="tbl"><table class="rv"><thead><tr><th>البند</th><th>الوصف</th><th>القسم</th><th class="n">القيمة</th><th>البداية</th><th>النهاية</th><th class="n">المدة</th></tr></thead><tbody>';
    p.sections.concat(p.boq.filter(b => !p.sections.some(s => s[0] === b.s)).map(b => [b.s, '']).filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i)).forEach(([sc, sn]) => {
      const it = p.boq.filter(b => b.s === sc); if (!it.length) return;
      h += '<tr class="sec"><td>' + esc(sc) + '</td><td colspan="6">' + esc(sn) + '</td></tr>';
      it.forEach(b => {
        const i = idx[b.id], r = ui.ted.list[i], ok = myItem(b), dis = ok ? '' : ' disabled', days = r.start && r.end ? daysBetween(D(r.start), D(r.end)) + 1 : '';
        h += '<tr' + (r.start !== r.s0 || r.end !== r.e0 ? ' class="chg"' : '') + '><td class="num small">' + esc(b.c) + '</td><td class="small">' + esc(short(b.d)) + '</td><td>' + (b.dept ? '<span class="tag">' + DEPTS[b.dept] + '</span>' : '<span class="muted">—</span>') + '</td><td class="n small">' + money(b.t) + '</td>' +
          '<td><input type="date" class="dt" data-ted="' + i + '" data-k="start" value="' + esc(r.start) + '"' + dis + ' aria-label="بداية البند ' + esc(b.c) + '"></td><td><input type="date" class="dt" data-ted="' + i + '" data-k="end" value="' + esc(r.end) + '"' + dis + ' aria-label="نهاية البند ' + esc(b.c) + '"></td><td class="n small"' + (days !== '' && days < 1 ? ' style="color:var(--bad)"' : '') + '>' + (days !== '' ? days + ' يوم' : '—') + '</td></tr>';
      });
    });
    return h + '</tbody></table></div>';
  }
  const has = dated.length || p.tasks.length;
  h += '<div class="ch" style="margin-bottom:8px">' + (!has ? '<span class="muted small">' + (p.boq.length ? 'ما انحسبت مدد البنود بعد.' : 'لا توجد بنود BOQ لهذا المشروع.') + '</span>' : st.status === 'approved' ? '<span class="flag ok">' + (st.by ? 'معتمد من ' + esc(nameOf(st.by)) : 'معتمد') + (st.at ? ' بتاريخ ' + fd(st.at) : '') + (st.note ? ' · ' + esc(st.note) : '') + '</span>' : '<span class="flag warn">مسودة بانتظار مراجعة واعتماد المدير العام</span>') +
    '<div class="actions">' + (canSched() && has && st.status !== 'approved' ? '<button class="btn ok" data-act="schedApprove" data-v="' + p.id + '">اعتماد الجدول</button>' : '') +
    (canDates(p) && p.boq.length && dated.length ? '<button class="btn" data-act="schedEdit" data-v="' + p.id + '">تعديل مدد البنود</button>' : '') +
    (isAdmin() && p.boq.length && !dated.length ? '<button class="btn pri" data-act="schedAuto" data-v="' + p.id + '">احسب مدة كل بند تلقائياً</button>' : '') + '</div></div>';
  if (dated.length) {
    const rows = [];
    const secs = p.sections.concat(p.boq.filter(b => !p.sections.some(s => s[0] === b.s)).map(b => [b.s, '']).filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i));
    secs.forEach(([sc, sn]) => {
      const it = dated.filter(b => b.s === sc); if (!it.length) return;
      const s0 = it.reduce((a, b) => b.ps < a ? b.ps : a, it[0].ps), e0 = it.reduce((a, b) => b.pe > a ? b.pe : a, it[0].pe);
      rows.push({ n: sc + ' ' + sn, s: s0, e: e0, ph: true });
      it.forEach(b => rows.push({ n: b.c + ' ' + short(b.d), t: b.d, s: b.ps, e: b.pe, dept: b.dept }));
    });
    h += gantt(p, rows);
    if (dated.length < p.boq.length) h += '<p class="muted small">' + (p.boq.length - dated.length) + ' بند بدون تواريخ. اضغط "تعديل مدد البنود" لإضافتها.</p>';
  } else if (p.tasks.length) h += gantt(p, p.tasks.map(t => ({ n: t.n, s: t.s, e: t.e, ph: t.ph, dept: t.dept })));
  return h;
}
function boqReview(n) {
  if (!n.items.length) return '';
  const sum = n.items.reduce((a, i) => a + (+i.total || 0), 0);
  let h = '<div class="ch" style="margin-top:6px"><b>' + n.sections.length + ' أقسام · ' + n.items.length + ' بند · الإجمالي ' + money(sum) + ' ر.ع</b><div class="actions"><button type="button" class="btn sm" data-act="npClassify">أعد توزيع الأقسام تلقائياً</button><button type="button" class="btn sm" data-act="npSchedule">احسب المدد تلقائياً</button></div></div>';
  if (n.via) h += '<span class="hint">' + esc(n.via) + '</span>';
  if (n.stated && Math.abs(n.stated - sum) > 1) h += '<div class="flag warn">الإجمالي المكتوب في الملف ' + money(n.stated) + ' ر.ع، ومجموع البنود المقروءة ' + money(sum) + ' ر.ع. راجع البنود قبل الحفظ.</div>';
  if (n.warnings && n.warnings.length) h += '<details><summary class="hint" style="cursor:pointer">' + n.warnings.length + ' ملاحظة على الأرقام</summary><div class="hint">' + n.warnings.map(esc).join('<br>') + '</div></details>';
  if (n.notes) h += '<div class="flag warn">ملاحظات القراءة: ' + esc(n.notes) + '</div>';
  if (!n.f.start || !n.f.end) h += '<div class="flag warn">حدد تاريخ البداية وموعد التسليم فوق عشان تنحسب مدة كل بند.</div>';
  h += '<div class="tbl"><table class="rv"><thead><tr><th>البند</th><th>الوصف</th><th class="n">القيمة</th><th>القسم المسؤول</th><th>البداية</th><th>النهاية</th><th class="n">المدة</th></tr></thead><tbody>';
  const order = n.sections.map(s => s[0]); n.items.forEach(i => { if (!order.includes(i.sec)) order.push(i.sec); });
  order.forEach(sc => {
    const it = n.items.map((x, k) => [x, k]).filter(([x]) => x.sec === sc); if (!it.length) return;
    const sn = (n.sections.find(s => s[0] === sc) || [sc, 'قسم ' + sc])[1];
    h += '<tr class="sec"><td>' + esc(sc) + '</td><td>' + esc(sn) + '</td><td class="n">' + money(it.reduce((a, [x]) => a + (+x.total || 0), 0)) + '</td><td>' + deptSel('', 'data-nps="' + esc(sc) + '" aria-label="قسم كل بنود ' + esc(sn) + '"', 'غيّر الكل…') + '</td><td></td><td></td><td></td></tr>';
    it.forEach(([x, k]) => {
      const days = x.start && x.end ? daysBetween(D(x.start), D(x.end)) + 1 : '';
      h += '<tr><td class="num small">' + esc(x.code) + '</td><td>' + esc(x.desc) + '<div class="muted small">' + x.qty + ' ' + esc(x.unit) + (x.rate ? ' × ' + money(x.rate) : '') + '</div></td><td class="n">' + money(x.total) + '</td><td>' + deptSel(x.dept, 'class="dsel" data-npi="' + k + '" aria-label="قسم البند ' + esc(x.code) + '"') + '</td>' +
        '<td><input type="date" class="dt" data-npd="' + k + '" data-k="start" value="' + esc(x.start || '') + '" aria-label="بداية البند ' + esc(x.code) + '"></td><td><input type="date" class="dt" data-npd="' + k + '" data-k="end" value="' + esc(x.end || '') + '" aria-label="نهاية البند ' + esc(x.code) + '"></td><td class="n small">' + (days ? days + ' يوم' : '—') + '</td></tr>';
    });
  });
  return h + '</tbody></table></div>';
}
function vNewProject() {
  if (!canNewProject()) return '<div class="empty">إضافة المشاريع لرؤساء الأقسام والإدارة.</div>';
  const n = npState(), f = n.f;
  const fv = k => esc(f[k] || '');
  let h = '<div class="head"><div class="t"><span class="crumb"><a href="#projects">المشاريع</a> / مشروع جديد</span><h1>مشروع جديد</h1><span class="muted">ارفع ملف BOQ والنظام يقرأه ويوزع البنود على الأقسام ويعطي كل بند مدة. تراجع كل شي قبل الحفظ.</span></div><div class="actions"><button class="btn" data-act="npReset">بدء من جديد</button></div></div>' +
    '<form class="f" data-form="project">' +
    '<div class="card"><h2>1. بيانات المشروع</h2>' +
    '<div class="fr"><label class="fld"><span>كود المشروع</span><input data-npf="code" id="np-code" value="' + fv('code') + '" dir="ltr" placeholder="يتولد تلقائياً مثل ' + nextCode() + '"></label><label class="fld"><span>نوع المشروع</span><select data-npf="type" id="np-type"><option value="gov"' + (f.type === 'gov' ? ' selected' : '') + '>حكومي</option><option value="private"' + (f.type === 'private' ? ' selected' : '') + '>خاص</option></select></label></div>' +
    '<div class="fr"><label class="fld"><span>اسم المشروع الكامل</span><input data-npf="name" id="np-name" required value="' + fv('name') + '"></label><label class="fld"><span>اسم مختصر (يظهر في القوائم)</span><input data-npf="short" id="np-short" required value="' + fv('short') + '"></label></div>' +
    '<div class="fr"><label class="fld"><span>العميل</span><input data-npf="client" id="np-client" value="' + fv('client') + '"></label><label class="fld"><span>تفاصيل الموقع (المنطقة أو العنوان)</span><input data-npf="loc" id="np-loc" value="' + fv('loc') + '" placeholder="مثال: الخوض، قرب جامعة السلطان قابوس"></label></div>' +
    '<div class="fr"><label class="fld"><span>المحافظة</span><select data-npf="gov" id="np-gov" required>' + govOpts(f.gov) + '</select></label><label class="fld"><span>الولاية</span><select data-npf="wil" id="np-wil" required>' + wilOpts(f.gov, f.wil) + '</select></label></div>' +
    '<div class="fr"><label class="fld"><span>تاريخ البداية</span><input data-npf="start" id="np-start" type="date" required value="' + fv('start') + '"></label><label class="fld"><span>موعد التسليم المتفق عليه</span><input data-npf="end" id="np-end" type="date" required value="' + fv('end') + '"></label></div>' +
    '</div>';
  h += '<div class="card"><h2>2. جدول الكميات BOQ والمدد</h2>' + (!f.start || !f.end ? '<div class="flag warn">اكتب تاريخ البداية وموعد التسليم في بيانات المشروع فوق قبل ما ترفع الملف، عشان النظام يعطي كل بند مدته الصحيحة.</div>' : '') +
    '<div class="fr"><label class="fld"><span>ملف BOQ (Excel هو الأفضل، أو PDF أو صورة)</span><input id="np-file" type="file" accept=".xlsx,.xls,.csv,.pdf,image/*"></label><div class="fld"><span>&nbsp;</span><button type="button" class="btn pri" data-act="npAnalyze"' + (n.busy ? ' disabled' : '') + '>' + (n.busy ? esc(n.busy) : 'اقرأ الملف') + '</button></div></div>' +
    '<span class="hint">ملف Excel أو PDF المصدّر من Excel ينقرأ فوراً. PDF المصوّر أو الصورة ينقرأ داخل البرنامج بعد، بس ياخذ وقت أطول (تقريباً 5 إلى 15 ثانية للصفحة حسب جهازك).</span>' +
    '<details' + (f.paste ? ' open' : '') + '><summary class="hint" style="cursor:pointer">أو الصق الجدول من Excel</summary><textarea data-npf="paste" id="np-boq" class="paste" placeholder="رقم البند\tالوصف\tالكمية\tالوحدة\tسعر الوحدة\tالإجمالي\n2\tأعمال التصميم\n2.1\tالتصميم المعماري المبدئي\t1\tمقطوعية\t3000\t3000">' + fv('paste') + '</textarea>' +
    '<span class="hint">انسخ الجدول من Excel مع سطر العناوين. النظام يتعرف على الأعمدة بنفسه.</span><div><button type="button" class="btn sm" data-act="npPaste">اقرأ الملصق</button></div></details>' +
    boqReview(n) + '<div class="fld" style="margin-top:14px"><span>' + (n.items.length ? 'الأقسام المشاركة: تحددت تلقائياً من توزيع البنود، وتقدر تعدلها' : 'الأقسام المشاركة: تتحدد تلقائياً بعد قراءة ملف BOQ، أو اخترها بنفسك') + '</span><div class="chk">' + Object.entries(DEPTS).map(([k, l]) => '<label><input type="checkbox" name="np-dept" value="' + k + '"' + (f.depts.includes(k) ? ' checked' : '') + '>' + l + '</label>').join('') + '</div></div></div>';
  return h + '<div class="actions"><button class="btn pri" type="submit">حفظ المشروع</button><a class="btn" href="#projects">إلغاء</a></div></form>';
}
function parseNum(s) { if (s == null) return NaN; s = String(s).replace(/[,\s]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); return s === '' ? NaN : +s; }
function parseDate(s) {
  s = (s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  return null;
}

async function callFn(body, okMsg) {
  const { data, error } = await sb.functions.invoke('manage-user', { body });
  let msg = data && data.error;
  if (error && !msg) { try { const j = await error.context.json(); msg = j.error; } catch (e) { msg = errMsg(error); } }
  if (msg) { toast(msg, true); return false; }
  if (okMsg) toast(okMsg);
  return true;
}

/* ---------- BOQ reading: built-in engine first, AI only for scanned PDFs and images ---------- */
const fileB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => no(r.error); r.readAsDataURL(f); });
function loadScript(src, name) {
  if (window[name]) return Promise.resolve(window[name]);
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok(window[name]); s.onerror = () => no(new Error('تعذّر تحميل مكتبة القراءة، تأكد من الإنترنت')); document.head.appendChild(s); });
}
const loadXLSX = () => loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'XLSX');
async function readSheets(f) {
  const X = await loadXLSX(); const wb = X.read(await f.arrayBuffer(), { cellDates: false });
  let res = null;
  wb.SheetNames.forEach(n => { const aoa = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '', blankrows: false }); const before = res ? res.items.length : 0; res = BOQ.parseRows(aoa, res || undefined); if (res.items.length === before && !before) res.sections = []; });
  return res;
}
// Text PDFs (exported from Excel/Word): rebuild table rows from text positions. Scanned PDFs return null.
async function pdfDoc(f) {
  const L = await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib');
  L.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return L.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
}
async function readPdfText(f) {
  const doc = await pdfDoc(f);
  const lines = []; let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent(); const rows = {};
    tc.items.forEach(t => { const s = (t.str || '').trim(); if (!s) return; chars += s.length; const y = Math.round(t.transform[5] / 4); (rows[y] = rows[y] || []).push({ x: t.transform[4], w: t.width || 0, s }); });
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(y => lines.push(rows[y]));
  }
  if (chars < 40 * doc.numPages) return null;
  // Column positions come from the header row; every other text piece goes to the nearest column.
  const hdr = lines.find(r => { const t = r.map(c => c.s).join(' '); return /(qty|quantity|الكمية)/i.test(t) && /(desc|الوصف|البيان)/i.test(t); });
  if (!hdr) return null;
  const cols = hdr.slice().sort((a, b) => a.x - b.x).map(c => c.x + c.w / 2);
  const aoa = lines.map(r => { const row = cols.map(() => ''); r.forEach(c => { const cx = c.x + c.w / 2; let bi = 0; cols.forEach((x, i) => { if (Math.abs(x - cx) < Math.abs(cols[bi] - cx)) bi = i; }); row[bi] = (row[bi] ? row[bi] + ' ' : '') + c.s; }); return row; });
  const res = BOQ.parseRows(aoa);
  return res.items.length ? res : null;
}
async function pdfParts(file, per) {
  const L = await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'PDFLib');
  const src = await L.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const n = src.getPageCount(), out = [];
  if (n <= per) return [await fileB64(file)];
  for (let i = 0; i < n; i += per) {
    const d = await L.PDFDocument.create();
    (await d.copyPages(src, Array.from({ length: Math.min(per, n - i) }, (_, k) => i + k))).forEach(pg => d.addPage(pg));
    out.push(await d.saveAsBase64());
  }
  return out;
}
async function pool(jobs, size, onDone) {
  const res = new Array(jobs.length); let next = 0, done = 0;
  async function worker() { while (next < jobs.length) { const i = next++; try { res[i] = await jobs[i](); } catch (e) { res[i] = await jobs[i](); } onDone(++done, jobs.length); } }
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
  return res;
}
const quietAi = async body => { const { data, error } = await sb.functions.invoke('analyze-boq', { body }); let msg = data && data.error; if (error && !msg) { try { msg = (await error.context.json()).error; } catch (e) { msg = errMsg(error); } } if (msg) throw new Error(msg); return data; };
async function readWithAI(bodies, progress) {
  const parts = await pool(bodies.map((b, i) => () => quietAi(Object.assign({ mode: 'extract', part: { n: i + 1, of: bodies.length } }, b))), 4, progress);
  const res = { sections: [], items: [], stated: 0, warnings: [], notes: [] };
  parts.forEach(d => {
    (d.sections || []).forEach(x => { if (!res.sections.find(y => y[0] === x.code)) res.sections.push([x.code, x.name]); });
    (d.items || []).forEach(i => { if (!res.items.find(y => y.code === i.code)) res.items.push({ code: i.code, desc: i.description, qty: +i.qty || 1, unit: i.unit || '', rate: +i.rate || 0, total: +i.total || 0, sec: i.section_code || String(i.code).split('.')[0], sub: '', dept: i.dept || null }); });
    if (+d.stated_total > res.stated) res.stated = +d.stated_total;
    if (d.notes && d.notes.trim()) res.notes.push(d.notes.trim());
  });
  res.notes = res.notes.join(' · ');
  return res;
}
function rerender() { npSync(); render(); }
function addDepts(n) { n.items.forEach(i => { if (i.dept && !n.f.depts.includes(i.dept)) n.f.depts.push(i.dept); }); }
function npPlan(n) { if (n.f.start && n.f.end && n.f.end >= n.f.start && n.items.length) { BOQ.schedule(n.items, n.f.start, n.f.end); n.planFor = n.f.start + '|' + n.f.end; } }
function npTake(n, res, via) {
  n.sections = res.sections; n.items = res.items; n.stated = res.stated || 0; n.warnings = res.warnings || []; n.notes = res.notes || ''; n.via = via;
  BOQ.classify(n.sections, n.items, true); addDepts(n); npPlan(n);
}
function npDatesOk(n) {
  if (!n.f.start || !n.f.end) { toast('اكتب تاريخ البداية وموعد التسليم فوق أولاً، عشان تتوزع مدد البنود صح', true); const el = document.getElementById(n.f.start ? 'np-end' : 'np-start'); if (el) el.focus(); return false; }
  if (n.f.end < n.f.start) { toast('موعد التسليم قبل تاريخ البداية', true); return false; }
  return true;
}
async function npAnalyze() {
  const n = npState(); npSync();
  if (!npDatesOk(n)) return;
  const f = (document.getElementById('np-file') || {}).files; const file = f && f[0];
  if (!file) return toast('اختر ملف BOQ أولاً', true);
  if (file.size > 20 * 1024 * 1024) return toast('حجم الملف أكبر من 20 ميجا', true);
  const name = file.name.toLowerCase(), t0 = Date.now();
  const busy = t => { n.busy = t; const b = document.querySelector('[data-act=npAnalyze]'); if (b) { b.textContent = t; b.disabled = true; } };
  try {
    if (/\.(xlsx|xls|xlsm|csv)$/.test(name)) {
      busy('جاري القراءة…'); const res = await readSheets(file);
      if (!res || !res.items.length) throw new Error('ما لقيت بنود في ملف Excel. تأكد إن فيه أعمدة الوصف والكمية أو الإجمالي');
      npTake(n, res, 'انقرأ من Excel في ' + ((Date.now() - t0) / 1000).toFixed(1) + ' ثانية');
    } else if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      busy('جاري القراءة…'); let res = null;
      try { res = await readPdfText(file); } catch (e) { res = null; }
      if (res) npTake(n, res, 'انقرأ من نص ملف PDF في ' + ((Date.now() - t0) / 1000).toFixed(1) + ' ثانية');
      else {
        // Scanned PDF: read it inside the app first (free); Claude is only the fallback.
        let rows = null;
        try { const doc = await pdfDoc(file); busy('الملف مصوّر، جاري قراءة الصور…'); rows = await BOQOCR.readPdf(doc, (p, t) => busy('قُرئت ' + p + ' من ' + t + ' صفحات…')); } catch (e) { console.warn(e); }
        const ocr = rows ? BOQ.parseRows(rows) : null;
        if (ocr && ocr.items.length) { npTake(n, ocr, 'الملف مصوّر وانقرأ داخل البرنامج في ' + Math.round((Date.now() - t0) / 1000) + ' ثانية. راجع الأرقام قبل الحفظ'); toast('تمت قراءة ' + n.items.length + ' بند'); n.busy = ''; render(); return; }
        busy('القراءة بالذكاء الاصطناعي…');
        const bodies = (await pdfParts(file, 2)).map(d => ({ file: { name: file.name, mime: 'application/pdf', data: d } }));
        busy('القراءة بالذكاء الاصطناعي… 0 من ' + bodies.length);
        const r = await readWithAI(bodies, (d, t) => busy('القراءة بالذكاء الاصطناعي… ' + d + ' من ' + t));
        npTake(n, r, 'الملف مصوّر فانقرأ بالذكاء الاصطناعي في ' + Math.round((Date.now() - t0) / 1000) + ' ثانية. راجع الأرقام');
      }
    } else if (/^image\//.test(file.type)) {
      busy('جاري قراءة الصورة…');
      let ocr = null; try { ocr = BOQ.parseRows(await BOQOCR.readImage(file)); } catch (e) { console.warn(e); }
      if (ocr && ocr.items.length) { npTake(n, ocr, 'انقرأت الصورة داخل البرنامج. راجع الأرقام قبل الحفظ'); toast('تمت قراءة ' + n.items.length + ' بند'); n.busy = ''; render(); return; }
      busy('القراءة بالذكاء الاصطناعي…');
      const r = await readWithAI([{ file: { name: file.name, mime: file.type, data: await fileB64(file) } }], () => {});
      npTake(n, r, 'انقرأت الصورة بالذكاء الاصطناعي. راجع الأرقام');
    } else throw new Error('نوع الملف غير مدعوم. ارفع Excel أو PDF أو صورة');
    toast('تمت قراءة ' + n.items.length + ' بند');
  } catch (e) { toast(errMsg(e), true); }
  n.busy = ''; render();
}
const A2 = {
  npReset: () => { ui.np = null; render(); },
  npAnalyze: () => npAnalyze(),
  npPaste: () => {
    const n = npState(); npSync(); if (!npDatesOk(n)) return; const r = BOQ.parseText(n.f.paste || '');
    if (!r.items.length) return toast('ما قدرت أقرأ بنود من النص الملصق. انسخ الجدول مع سطر العناوين', true);
    npTake(n, r, 'انقرأ من النص الملصق'); render();
  },
  npClassify: () => { const n = npState(); npSync(); n.items.forEach(i => { i.dept = null; }); BOQ.classify(n.sections, n.items); addDepts(n); npPlan(n); render(); toast('تم توزيع البنود على الأقسام'); },
  npSchedule: () => { const n = npState(); npSync(); if (!n.f.start || !n.f.end || n.f.end < n.f.start) return toast('حدد تاريخ البداية وموعد التسليم أولاً', true); npPlan(n); render(); toast('تم حساب مدة كل بند'); },
  schedEdit: d => { const p = P(d.v); ui.ted = { pid: p.id, list: p.boq.map(b => ({ id: b.id, start: b.ps || '', end: b.pe || '', s0: b.ps || '', e0: b.pe || '' })) }; render(); },
  schedCancel: () => { ui.ted = null; render(); },
  schedAuto: d => {
    const p = P(d.v); const items = p.boq.map(b => ({ id: b.id, code: b.c, desc: b.d, total: b.t, dept: b.dept, sec: b.s }));
    BOQ.classify(p.sections, items, true); BOQ.schedule(items, p.start, p.end);
    ui.ted = { pid: p.id, list: items.map(i => { const b = p.boq.find(x => x.id === i.id); return { id: i.id, start: i.start, end: i.end, s0: b.ps || '', e0: b.pe || '' }; }) };
    render(); toast('انحسبت المدد من جديد. راجعها واضغط حفظ');
  },
  schedSave: async (d, el) => {
    const ch = ui.ted.list.filter(r => r.start !== r.s0 || r.end !== r.e0);
    if (!ch.length) { ui.ted = null; render(); return; }
    const bad = ch.find(r => !r.start || !r.end || r.end < r.start);
    if (bad) { const b = P(ui.ted.pid).boq.find(x => x.id === bad.id); return toast('راجع تواريخ البند ' + (b ? b.c : ''), true); }
    el.disabled = true;
    try { await run(sb.rpc('set_item_dates', { p_items: ch.map(r => ({ id: r.id, start: r.start, end: r.end })) }), 'تم حفظ ' + ch.length + ' تعديل'); ui.ted = null; refresh(); } catch (e) { el.disabled = false; }
  },
  schedApprove: d => { const p = P(d.v); modal('اعتماد الجدول الزمني - ' + pName(p), '<form class="f" data-form="schedOk" data-v="' + p.id + '"><p class="small">مدد ' + p.boq.filter(b => b.ps).length + ' بند من ' + fd(p.start) + ' إلى ' + fd(p.end) + '. مهندس الموقع يقدر يحدّث التواريخ بعد الاعتماد حسب سير العمل.</p><label class="fld"><span>ملاحظة (اختياري)</span><input id="so-n"></label><div class="actions"><button class="btn ok" type="submit">اعتماد</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>'); },
  boqClassify: async (d, el) => {
    const p = P(d.v); const todo = p.boq.filter(b => !b.dept).map(b => ({ id: b.id, code: b.c, desc: b.d, total: b.t, sec: b.s, dept: null })); if (!todo.length) return;
    el.disabled = true;
    try {
      BOQ.classify(p.sections, todo);
      const groups = {}; todo.forEach(b => (groups[b.dept] = groups[b.dept] || []).push(b.id));
      for (const k of Object.keys(groups)) await run(sb.from('boq_items').update({ dept: k }).in('id', groups[k]));
      const ds = [...new Set(p.depts.concat(Object.keys(groups)))];
      if (ds.length !== p.depts.length) await run(sb.from('projects').update({ depts: ds }).eq('id', p.id));
      toast('تم توزيع ' + todo.length + ' بند على الأقسام');
    } catch (e) { }
    refresh();
  },
  bdeptFilter: d => { ui.bdept = d.v; render(); },
  reqItemsSave: async (d, el) => {
    const items = [...document.querySelectorAll('[data-ri]')].reduce((m, x) => { const o = m[x.dataset.ri] = m[x.dataset.ri] || { id: x.dataset.ri }; o[x.dataset.k] = x.value; return m; }, {});
    const list = Object.values(items); if (list.some(x => !String(x.d || '').trim())) return toast('اكتب اسم كل مادة', true);
    el.disabled = true; try { await run(sb.rpc('set_request_items', { p_req: d.v, p_items: list }), 'انحفظت المواد والأسعار'); } catch (e) { el.disabled = false; return; } refresh();
  },
  projOk: async (d, el) => { el.disabled = true; try { await run(sb.rpc('decide_project', { p_project: d.v, p_ok: true }), 'اعتُمد المشروع وصار ظاهر للجميع'); } catch (e) { el.disabled = false; return; } refresh(); },
  projNo: d => modal('رفض المشروع', '<form class="f" data-form="projNo" data-v="' + d.v + '"><label class="fld"><span>سبب الرفض</span><input id="pn-n" required></label><div class="actions"><button class="btn bad" type="submit">رفض</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>'),
  voOk: async (d, el) => { el.disabled = true; try { await run(sb.rpc('decide_variation', { p_id: d.v, p_ok: true }), 'اعتُمد العمل الإضافي وانضاف لقيمة المشروع'); } catch (e) { el.disabled = false; return; } refresh(); },
  voNo: d => modal('رفض العمل الإضافي', '<form class="f" data-form="voNo" data-v="' + d.v + '"><label class="fld"><span>سبب الرفض</span><input id="vn-n" required></label><div class="actions"><button class="btn bad" type="submit">رفض</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>'),
  newDoc: d => modal('إضافة مستند للمشروع', '<form class="f" data-form="doc" data-v="' + d.v + '"><div class="fr"><label class="fld"><span>نوع المستند</span><select id="dc-k">' + Object.entries(DOCK).map(([k, l]) => '<option value="' + k + '">' + l + '</option>').join('') + '</select></label><label class="fld"><span>اسم المستند</span><input id="dc-t" required placeholder="مثال: العقد الموقّع"></label></div><label class="fld"><span>الملف</span><input id="dc-f" type="file" required></label><div class="actions"><button class="btn pri" type="submit">رفع</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>'),
  docDel: async d => { try { await run(sb.from('project_docs').delete().eq('id', d.v), 'انحذف المستند'); } catch (e) { return; } refresh(); },
  projDel: d => {
    const p = P(d.v), n = S.requests.filter(r => r.pid === p.id).length + S.petty.filter(c => c.pid === p.id).length + S.variations.filter(v => v.pid === p.id).length;
    modal('حذف المشروع ' + pName(p), '<p>بيتم حذف المشروع <b>' + esc(p.name) + '</b> نهائياً مع ' + p.boq.length + ' بند BOQ و' + p.tasks.length + ' مهمة' + (n ? ' و<b>' + n + ' طلب ومصروف مرتبط فيه</b>' : '') + '. ما يمكن التراجع عن الحذف.</p><label class="fld"><span>للتأكيد اكتب كود المشروع: <b class="num">' + esc(p.code) + '</b></span><input id="pd-c" dir="ltr" autocomplete="off"></label><div class="actions"><button class="btn bad" data-act="projDelGo" data-v="' + p.id + '">حذف نهائي</button><button class="btn" data-act="close">إلغاء</button></div>');
  },
  projDelGo: async (d, el) => {
    const p = P(d.v); if ((document.getElementById('pd-c').value || '').trim().toUpperCase() !== String(p.code).toUpperCase()) return toast('الكود غير مطابق', true);
    el.disabled = true;
    try { await run(sb.from('projects').delete().eq('id', p.id), 'تم حذف المشروع'); } catch (e) { el.disabled = false; return; }
    closeModal(); ui.tab = 'boq'; ui.ted = null; location.hash = 'projects'; refresh();
  }
};

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
    '<div class="fr"><label class="fld"><span>القيمة (ر.ع)</span><input id="vo-a" type="number" min="0" step="0.001" required></label><label class="fld"><span>موافقة الوزارة أو العميل (PDF أو صورة)</span><input id="vo-f" type="file" accept="image/*,.pdf" required></label></div>' +
    '<span class="muted small">يروح العمل الإضافي للمدير العام للاعتماد، وبعد اعتماده يُضاف لقيمة المشروع وميزانيته.</span>' +
    '<div class="actions"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>');
}
function projStatusForm(pid) {
  const p = P(pid);
  modal('بيانات وحالة المشروع', '<form class="f" data-form="pstatus" data-v="' + pid + '"><label class="fld"><span>كود المشروع</span><input id="ps-c" required dir="ltr" value="' + esc(p.code || '') + '"></label>' +
    '<div class="fr"><label class="fld"><span>المحافظة</span><select id="ps-g">' + govOpts(p.gov) + '</select></label><label class="fld"><span>الولاية</span><select id="ps-w">' + wilOpts(p.gov, p.wil) + '</select></label></div>' +
    '<label class="fld"><span>تفاصيل الموقع</span><input id="ps-l" value="' + esc(p.loc || '') + '"></label><label class="fld"><span>الحالة</span><select id="ps-s"><option value="active"' + (p.status === 'active' ? ' selected' : '') + '>جاري</option><option value="stopped"' + (p.status === 'stopped' ? ' selected' : '') + '>متوقف</option><option value="closed"' + (p.status === 'closed' ? ' selected' : '') + '>مغلق</option></select></label>' +
    '<label class="fld"><span>سبب التوقف (إن وجد)</span><input id="ps-r" value="' + esc(p.stopReason || '') + '"></label>' +
    '<label class="fld"><span>موعد التسليم</span><input id="ps-e" type="date" value="' + p.end + '"></label>' +
    '<div class="actions"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button>' + (me.role === 'admin' ? '<span style="flex:1"></span><button class="btn bad" type="button" data-act="projDel" data-v="' + pid + '">حذف المشروع</button>' : '') + '</div></form>');
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
  voApprove: d => { const v = S.variations.find(x => x.id === d.v); modal('إرفاق موافقة الوزارة أو العميل - ' + v.title, '<form class="f" data-form="voFile" data-v="' + v.id + '"><label class="fld"><span>ملف الموافقة</span><input id="vf" type="file" accept="image/*,.pdf" required></label><div class="actions"><button class="btn pri" type="submit">رفع واعتماد</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>'); },
  resetPass: d => { const u = S.profiles.find(x => x.id === d.v); modal('كلمة مرور جديدة - ' + u.full_name, '<form class="f" data-form="resetPass" data-v="' + u.id + '"><label class="fld"><span>كلمة المرور الجديدة</span><input id="rp" type="text" required minlength="6" dir="ltr" autocomplete="off"></label><div class="actions"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>'); },
  delUser: d => { const u = S.profiles.find(x => x.id === d.v); modal('حذف ' + u.full_name, '<p>بيتم حذف حساب <b>' + esc(u.full_name) + '</b> نهائياً وما يقدر يدخل النظام. إذا عنده طلبات مسجلة، الأفضل توقف حسابه بتغيير دوره إلى "موقوف" بدل الحذف.</p><div class="actions"><button class="btn bad" data-act="delUserGo" data-v="' + u.id + '">حذف نهائي</button><button class="btn" data-act="close">إلغاء</button></div>'); },
  delUserGo: async d => { if (await callFn({ action: 'delete', id: d.v }, 'تم حذف الحساب')) { closeModal(); refresh(); } },
  ...A2,
  saveUser: async d => { await run(sb.rpc('set_user_role', { p_user: d.v, p_role: document.getElementById('ur-' + d.v).value, p_dept: document.getElementById('ud-' + d.v).value }), 'تم الحفظ'); refresh(); }
};
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  const a = e.target.closest('[data-act]');
  if (a && a.tagName !== 'SELECT') { const k = a.dataset.act; if (A[k]) { if (k !== 'closeOv' && k !== 'qsel') e.preventDefault(); Promise.resolve(A[k](a.dataset, a, e)).catch(() => {}); return; } }
  if (go && !e.target.closest('a,button,input,select')) { if (go.dataset.tab) ui.tab = go.dataset.tab; location.hash = go.dataset.go; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); if (e.key === 'Enter') { const g = e.target.closest && e.target.closest('[data-go]'); if (g && g.tagName === 'DIV') location.hash = g.dataset.go; } });
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.prog) { try { await run(sb.rpc('set_progress', { p_item: t.dataset.prog, p_progress: Math.round(+t.value || 0) }), 'تم تحديث الإنجاز'); } catch (x) { } refresh(); return; }
  if (t.id === 'nr-p') { const p = P(t.value); document.getElementById('nr-b').innerHTML = boqOptions(p, '', true); document.getElementById('nr-d').innerHTML = deptOptions(p); }
  if (t.id === 'pc-p') document.getElementById('pc-b').innerHTML = boqOptions(P(t.value), '', true);
  if (t.id === 'ps-g') document.getElementById('ps-w').innerHTML = wilOpts(t.value, '');
  if (t.dataset.npd != null && ui.np) { npSync(); ui.np.items[+t.dataset.npd][t.dataset.k] = t.value; render(); return; }
  if (t.dataset.ted != null && ui.ted) { ui.ted.list[+t.dataset.ted][t.dataset.k] = t.value; render(); return; }
  if ((t.id === 'np-start' || t.id === 'np-end') && ui.np) { npSync(); if (ui.np.items.length) npPlan(ui.np); render(); return; }
  if (t.id === 'np-gov') { npSync(); ui.np.f.wil = ''; render(); return; }
  if (t.dataset.npi != null && ui.np) { npSync(); ui.np.items[+t.dataset.npi].dept = t.value || null; addDepts(ui.np); render(); return; }
  if (t.dataset.nps != null && ui.np && t.value) { npSync(); ui.np.items.forEach(i => { if (i.sec === t.dataset.nps) i.dept = t.value; }); addDepts(ui.np); render(); return; }
  if (t.dataset.bdept) {
    const p = S.projects.find(x => x.boq.some(b => b.id === t.dataset.bdept));
    try {
      await run(sb.from('boq_items').update({ dept: t.value || null }).eq('id', t.dataset.bdept), 'تم تغيير القسم');
      if (t.value && p && !p.depts.includes(t.value)) await run(sb.from('projects').update({ depts: p.depts.concat(t.value) }).eq('id', p.id));
    } catch (x) { }
    refresh();
  }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.npd != null && ui.np && t.value) ui.np.items[+t.dataset.npd][t.dataset.k] = t.value;
  if (t.dataset.ted != null && ui.ted && t.value) ui.ted.list[+t.dataset.ted][t.dataset.k] = t.value;
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
    } else if (kind === 'newUser') {
      if (await callFn({ action: 'create', full_name: v('nu-name'), email: v('nu-email'), password: v('nu-pass'), role: v('nu-role'), dept: v('nu-dept') }, 'أُضيف الموظف ويقدر يدخل الحين')) { f.reset(); refresh(); }
    } else if (kind === 'resetPass') {
      if (await callFn({ action: 'password', id: f.dataset.v, password: v('rp') }, 'تم تغيير كلمة المرور')) closeModal();
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
      await run(sb.from('variations').insert({ project_id: f.dataset.v, title: v('vo-t'), description: v('vo-d'), amount: +v('vo-a'), approval_path: path, client_status: path ? 'approved' : 'pending', created_by: me.id }), 'أُرسل العمل الإضافي للمدير العام للاعتماد');
      ui.tab = 'vo'; closeModal(); refresh();
    } else if (kind === 'voFile') {
      const path = await upload(fileOf('vf'), 'variations');
      await run(sb.from('variations').update({ approval_path: path, client_status: 'approved' }).eq('id', f.dataset.v), 'انرفقت الموافقة، والعمل الإضافي عند المدير العام للاعتماد');
      closeModal(); refresh();
    } else if (kind === 'pstatus') {
      const code = v('ps-c').trim();
      if (S.projects.some(x => x.id !== f.dataset.v && String(x.code || '').toUpperCase() === code.toUpperCase())) { toast('كود المشروع مستخدم لمشروع ثاني', true); return; }
      await run(sb.from('projects').update({ code, status: v('ps-s'), stop_reason: v('ps-r') || null, end_date: v('ps-e'), governorate: v('ps-g') || null, wilayat: v('ps-w') || null, location_note: v('ps-l') || null }).eq('id', f.dataset.v), 'تم الحفظ');
      closeModal(); refresh();
    } else if (kind === 'project') {
      const n = npState(); npSync(); const pf = n.f;
      if (!pf.depts.length) { toast('اختر قسم واحد على الأقل', true); return; }
      if (pf.end < pf.start) { toast('موعد التسليم قبل تاريخ البداية', true); return; }
      if ((pf.code || '').trim() && S.projects.some(x => String(x.code || '').toUpperCase() === pf.code.trim().toUpperCase())) { toast('كود المشروع مستخدم لمشروع ثاني', true); return; }
      const badT = n.items.find(i => (i.start || i.end) && (!i.start || !i.end || i.end < i.start));
      if (badT) { toast('راجع تواريخ البند ' + badT.code + ': النهاية لازم بعد البداية', true); return; }
      const pr = await run(sb.from('projects').insert(Object.assign((pf.code || '').trim() ? { code: pf.code.trim() } : {}, { name: pf.name, short_name: pf.short, client: pf.client || '', type: pf.type, approval: isAdmin() ? 'approved' : 'pending', requested_by: me.id, depts: pf.depts, start_date: pf.start, end_date: pf.end, governorate: pf.gov || null, wilayat: pf.wil || null, location_note: pf.loc || null })).select().single());
      const secs = n.sections.slice(); n.items.forEach(i => { if (!secs.find(x => x[0] === i.sec)) secs.push([i.sec, 'قسم ' + i.sec]); });
      if (secs.length) await run(sb.from('boq_sections').insert(secs.map((x, i) => ({ project_id: pr.id, code: x[0], name: x[1], sort: i }))));
      if (n.items.length) await run(sb.from('boq_items').insert(n.items.map((b, i) => ({ project_id: pr.id, section_code: b.sec, code: b.code, description: b.desc, qty: b.qty, unit: b.unit, rate: b.rate, total: b.total, dept: b.dept || null, start_date: b.start || null, end_date: b.end || null, sort: i }))));
      const cnt = n.items.length, dated = n.items.some(i => i.start); ui.np = null; ui.tab = dated ? 'time' : 'boq';
      await loadAll(); location.hash = 'p-' + pr.id; toast('أُضيف المشروع ' + pr.code + (cnt ? ' مع ' + cnt + ' بند' : '') + (!isAdmin() ? '، وراح للمدير العام للموافقة' : dated && !canSched() ? '، والجدول عند المدير العام للاعتماد' : ''));
    } else if (kind === 'projNo') {
      await run(sb.rpc('decide_project', { p_project: f.dataset.v, p_ok: false, p_note: v('pn-n') }), 'انرفض المشروع');
      closeModal(); refresh();
    } else if (kind === 'voNo') {
      await run(sb.rpc('decide_variation', { p_id: f.dataset.v, p_ok: false, p_note: v('vn-n') }), 'انرفض العمل الإضافي');
      closeModal(); refresh();
    } else if (kind === 'doc') {
      const path = await upload(fileOf('dc-f'), 'docs');
      await run(sb.from('project_docs').insert({ project_id: f.dataset.v, kind: v('dc-k'), title: v('dc-t'), path, uploaded_by: me.id }), 'انرفع المستند');
      ui.tab = 'docs'; closeModal(); refresh();
    } else if (kind === 'schedOk') {
      await run(sb.rpc('approve_schedule', { p_project: f.dataset.v, p_note: v('so-n') || null }), 'اعتُمد الجدول الزمني');
      closeModal(); refresh();
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
  if (me.role === 'admin') items.push(['users', 'المستخدمين', 'users', 'المستخدمين']);
  const pendUsers = me.role === 'admin' ? S.profiles.filter(u => u.role === 'pending').length : 0;
  const badge = k => k === 'inbox' && q.n ? '<span class="badge">' + q.n + '</span>' : k === 'users' && pendUsers ? '<span class="badge">' + pendUsers + '</span>' : '';
  root.innerHTML = '<div class="app"><aside class="side"><div class="brand"><img src="assets/mark.png" alt="شعار كربون"><div><b>CARBON</b><span>إدارة المشاريع</span></div></div><nav class="nav">' +
    items.map(([k, l, i]) => '<a href="#' + k + '" class="' + (sec === k ? 'on' : '') + '">' + ico(i) + l + badge(k) + '</a>').join('') +
    '</nav><div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="rolebox" style="margin-top:0"><div class="me"><b>' + esc(me.full_name) + '</b><span class="muted">' + ROLES[me.role] + (me.dept ? ' · ' + DEPTS[me.dept] : '') + '</span></div><button type="button" data-act="logout">تسجيل خروج</button></div></aside>' +
    '<main><div class="wrap"><div class="mrole"><img src="assets/mark.png" alt=""><span class="small"><b>' + esc(me.full_name) + '</b> · ' + ROLES[me.role] + '</span><span style="flex:1"></span><button class="linkbtn small" data-act="logout">خروج</button></div>' + greet() + views() + '</div></main>' +
    '<nav class="bnav">' + items.filter(x => x[0] !== 'users').map(([k, l, i, s]) => '<a href="#' + k + '" class="' + (sec === k ? 'on' : '') + '">' + ico(i) + '<span>' + s + '</span>' + badge(k) + '</a>').join('') + '</nav></div>';
}

function greet() {
  const hr = new Date().getHours(), first = String(me.full_name || '').trim().split(/\s+/)[0] || '';
  return '<div class="greet"><b>' + (hr >= 4 && hr < 12 ? 'صباح الخير' : 'مساء الخير') + (first ? ' ' + esc(first) : '') + '</b><span class="muted small">' + ROLES[me.role] + (me.dept ? ' · ' + DEPTS[me.dept] : '') + ' · ' + new Date().toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span></div>';
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
