-- Material requests:
-- 1) Every supplier quote carries the quotation file; procurement cannot send to the GM without it.
-- 2) The GM can send a request back for clarification to procurement or to the department head.
--    After the answer it returns straight to the GM (it does not walk the whole path again).
-- 3) Procurement can raise a request itself: it starts at the pricing step (no department head step).
alter table public.quotes add column file_path text;
alter table public.material_requests add column clarify text check (clarify in ('dept','procurement'));

create or replace function public.start_proc_request(p_req uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests;
begin
  select * into r from public.material_requests where id = p_req for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if r.requested_by <> (select auth.uid()) or public.my_role() not in ('procurement','admin') or r.stage <> 'dept' then
    raise exception 'هذه الخطوة ليست من صلاحيتك'; end if;
  update public.material_requests set stage = 'procurement' where id = p_req;
  perform public.log_request(p_req, 'طلب من المشتريات مباشرة', null);
end $$;
grant execute on function public.start_proc_request(uuid) to authenticated;

create or replace function public.advance_request(p_req uuid, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles; nxt text; act text; adm boolean;
begin
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  adm := me.role = 'admin';
  if r.stage = 'dept' and (adm or (me.role = 'head' and public.dept_ok(me, r.dept))) then
    if r.clarify = 'dept' then
      if coalesce(trim(p_note),'') = '' then raise exception 'اكتب التوضيح المطلوب'; end if;
      nxt := 'gm'; act := 'رد رئيس القسم على استيضاح المدير العام';
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
    if r.clarify = 'procurement' then
      if coalesce(trim(p_note),'') = '' then raise exception 'اكتب التوضيح المطلوب'; end if;
      act := 'ردت المشتريات على استيضاح المدير العام';
    else
      act := 'سعّر المواد وأرفق الكوتيشن وأرسل للمدير العام';
    end if;
    nxt := 'gm';
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
  update public.material_requests set stage = nxt, clarify = null where id = p_req;
  perform public.log_request(p_req, act, p_note);
  return nxt;
end $$;

create or replace function public.clarify_request(p_req uuid, p_to text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests;
begin
  if public.my_role() not in ('gm','admin') then raise exception 'طلب التوضيح للمدير العام'; end if;
  if p_to not in ('dept','procurement') then raise exception 'اختر الجهة'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'اكتب وش التوضيح المطلوب'; end if;
  select * into r from public.material_requests where id = p_req for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if r.stage <> 'gm' then raise exception 'الطلب مو عند المدير العام'; end if;
  update public.material_requests set stage = p_to, clarify = p_to where id = p_req;
  perform public.log_request(p_req, 'طلب المدير العام توضيح من ' || case p_to when 'dept' then 'رئيس القسم' else 'المشتريات' end, p_note);
end $$;
grant execute on function public.clarify_request(uuid, text, text) to authenticated;
