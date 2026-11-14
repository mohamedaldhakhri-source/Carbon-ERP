-- 1) Quantity Surveyor (QS, مهندس حصر الكميات): new role and a review step between procurement and the GM.
--    Path: site -> head -> procurement (prices + quotation + registered supplier) -> QS review -> GM -> procurement issues PO.
--    The GM can ask procurement, the head or the QS for clarification; the QS can send it back to procurement or the head.
--    An answer goes straight back to whoever asked.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending','admin','owner','gm','head','site','procurement','qs','finance'));
alter table public.material_requests drop constraint material_requests_stage_check;
alter table public.material_requests add constraint material_requests_stage_check
  check (stage in ('dept','procurement','qs','finance','gm','po','done','rejected'));
alter table public.material_requests drop constraint material_requests_clarify_check;
alter table public.material_requests add constraint material_requests_clarify_check
  check (clarify in ('dept','procurement','qs'));
alter table public.material_requests add column clarify_by text check (clarify_by in ('gm','qs'));

-- 2) Company supplier register. Procurement picks the supplier of every quote from this list.
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cr_no text not null,
  cr_path text not null,
  activity text,
  contact_name text,
  phone text not null,
  email text,
  address text,
  bank_name text,
  account_name text,
  bank_account text,
  iban text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;
grant select, insert, update, delete on public.suppliers to authenticated;
create policy sup_read on public.suppliers for select to authenticated
  using ((select public.my_role()) in ('admin','owner','gm','procurement','qs','finance'));
create policy sup_ins on public.suppliers for insert to authenticated
  with check ((select public.my_role()) in ('admin','gm','owner','procurement'));
create policy sup_upd on public.suppliers for update to authenticated
  using ((select public.my_role()) in ('admin','gm','owner','procurement'));
create policy sup_del on public.suppliers for delete to authenticated
  using ((select public.my_role()) = 'admin');
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.audit_row();

alter table public.quotes add column supplier_id uuid references public.suppliers(id) on delete set null;

create or replace function public.advance_request(p_req uuid, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles; nxt text; act text; adm boolean;
  asker text;
begin
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  adm := me.role = 'admin';
  asker := case coalesce(r.clarify_by, 'gm') when 'qs' then 'مهندس الكميات (QS)' else 'المدير العام' end;
  if r.clarify is not null and r.clarify = r.stage and coalesce(trim(p_note),'') = '' then
    raise exception 'اكتب التوضيح المطلوب'; end if;
  if r.stage = 'dept' and (adm or (me.role = 'head' and public.dept_ok(me, r.dept))) then
    if r.clarify = 'dept' then
      nxt := coalesce(r.clarify_by, 'gm'); act := 'رد رئيس القسم على استيضاح ' || asker;
    else
      nxt := 'procurement'; act := 'وافق رئيس القسم';
    end if;
  elsif r.stage = 'procurement' and (adm or me.role = 'procurement') then
    if exists (select 1 from public.request_items where request_id = p_req and (unit_price is null or unit_price < 0)) then
      raise exception 'اكتب سعر كل مادة أولاً'; end if;
    if not exists (select 1 from public.quotes where request_id = p_req and selected) then
      raise exception 'اختر عرض سعر أولاً'; end if;
    if exists (select 1 from public.quotes where request_id = p_req and selected and coalesce(file_path,'') = '') then
      raise exception 'ارفق ملف الكوتيشن للعرض المختار'; end if;
    if exists (select 1 from public.quotes where request_id = p_req and selected and supplier_id is null) then
      raise exception 'اختر المورّد من قائمة الموردين المسجلين'; end if;
    if r.clarify = 'procurement' then
      nxt := coalesce(r.clarify_by, 'gm'); act := 'ردت المشتريات على استيضاح ' || asker;
    else
      nxt := 'qs'; act := 'سعّر المواد وأرفق الكوتيشن وأرسل لمهندس الكميات (QS)';
    end if;
  elsif r.stage = 'qs' and (adm or me.role = 'qs') then
    nxt := 'gm';
    act := case when r.clarify = 'qs' then 'رد مهندس الكميات (QS) على استيضاح المدير العام'
                else 'راجع مهندس الكميات (QS) الطلب ووافق وأرسل للمدير العام' end;
  elsif r.stage = 'finance' and (adm or me.role in ('finance','gm')) then
    nxt := 'gm'; act := 'أُرسل للمدير العام';
  elsif r.stage = 'gm' and (adm or me.role = 'gm') then
    nxt := 'po'; act := 'اعتمد المدير العام';
  elsif r.stage = 'po' and (adm or me.role = 'procurement') then
    nxt := 'done';
    update public.material_requests
      set po_no = public.next_doc_no('PO', 4), po_date = (now() at time zone 'Asia/Muscat')::date
      where id = p_req;
    select 'أصدر أمر الشراء ' || po_no || ' وأرسله للمورّد' into act from public.material_requests where id = p_req;
  else
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  if adm then act := act || ' (بواسطة مدير النظام)'; end if;
  update public.material_requests set stage = nxt, clarify = null, clarify_by = null where id = p_req;
  perform public.log_request(p_req, act, p_note);
  return nxt;
end $$;

create or replace function public.clarify_request(p_req uuid, p_to text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; rl text := public.my_role(); who text; tgt text;
begin
  if coalesce(trim(p_note),'') = '' then raise exception 'اكتب وش التوضيح المطلوب'; end if;
  select * into r from public.material_requests where id = p_req for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if r.stage = 'gm' and rl in ('gm','admin') then
    if p_to not in ('dept','procurement','qs') then raise exception 'اختر الجهة'; end if;
    who := 'gm';
  elsif r.stage = 'qs' and rl in ('qs','admin') then
    if p_to not in ('dept','procurement') then raise exception 'اختر الجهة'; end if;
    who := 'qs';
  else
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  tgt := case p_to when 'dept' then 'رئيس القسم' when 'qs' then 'مهندس الكميات (QS)' else 'المشتريات' end;
  update public.material_requests set stage = p_to, clarify = p_to, clarify_by = who where id = p_req;
  perform public.log_request(p_req, case who when 'gm' then 'طلب المدير العام توضيح من ' else 'أرجع مهندس الكميات (QS) الطلب للتوضيح من ' end || tgt, p_note);
end $$;

create or replace function public.reject_request(p_req uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles;
begin
  if coalesce(trim(p_note),'') = '' then raise exception 'اكتب سبب الرفض'; end if;
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if not ((me.role = 'admin' and r.stage in ('dept','procurement','qs','finance','gm','po'))
       or (r.stage = 'dept' and me.role = 'head' and public.dept_ok(me, r.dept))
       or (r.stage = 'procurement' and me.role = 'procurement')
       or (r.stage = 'qs' and me.role = 'qs')
       or (r.stage = 'finance' and me.role = 'finance')
       or (r.stage = 'gm' and me.role = 'gm')) then
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  update public.material_requests set stage = 'rejected', clarify = null, clarify_by = null where id = p_req;
  perform public.log_request(p_req, 'رفض ' || case me.role when 'admin' then 'مدير النظام' when 'head' then 'رئيس القسم' when 'procurement' then 'المشتريات' when 'qs' then 'مهندس الكميات (QS)' when 'finance' then 'المالية' else 'المدير العام' end, p_note);
end $$;
