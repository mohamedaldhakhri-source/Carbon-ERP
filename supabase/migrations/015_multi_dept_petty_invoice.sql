-- 1) A department head or site engineer can hold several departments.
--    profiles.depts lists them; profiles.dept keeps the first one for older screens. No departments = all departments.
alter table public.profiles add column depts text[] not null default '{}';
update public.profiles set depts = array[dept] where dept is not null;

create or replace function public.dept_ok(p_me public.profiles, p_d text) returns boolean
language sql stable set search_path = '' as $$
  select (p_me.dept is null and coalesce(cardinality(p_me.depts), 0) = 0) or p_d = p_me.dept or p_d = any(p_me.depts)
$$;

create or replace function public.set_user_depts(p_user uuid, p_depts text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare d text;
begin
  if public.my_role() <> 'admin' then raise exception 'إدارة المستخدمين لمدير النظام فقط'; end if;
  foreach d in array coalesce(p_depts, '{}') loop
    if d not in ('arch','interior','fitout','joinery','contracting','supervision') then raise exception 'قسم غير معروف: %', d; end if;
  end loop;
  update public.profiles set depts = coalesce(p_depts, '{}'), dept = (coalesce(p_depts, '{}'))[1] where id = p_user;
end $$;
grant execute on function public.set_user_depts(uuid, text[]) to authenticated;

create or replace function public.advance_request(p_req uuid, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles; nxt text; act text; adm boolean;
begin
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  adm := me.role = 'admin';
  if r.stage = 'dept' and (adm or (me.role = 'head' and public.dept_ok(me, r.dept))) then
    nxt := 'procurement'; act := 'وافق رئيس القسم';
  elsif r.stage = 'procurement' and (adm or me.role = 'procurement') then
    if exists (select 1 from public.request_items where request_id = p_req and (unit_price is null or unit_price < 0)) then
      raise exception 'اكتب سعر كل مادة أولاً'; end if;
    if not exists (select 1 from public.quotes where request_id = p_req and selected) then
      raise exception 'اختر عرض سعر أولاً'; end if;
    nxt := 'gm'; act := 'حدد المواد والأسعار وأرسل للمدير العام';
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
  update public.material_requests set stage = nxt where id = p_req;
  perform public.log_request(p_req, act, p_note);
  return nxt;
end $$;

create or replace function public.reject_request(p_req uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles;
begin
  if coalesce(trim(p_note),'') = '' then raise exception 'اكتب سبب الرفض'; end if;
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if not ((me.role = 'admin' and r.stage in ('dept','procurement','finance','gm','po'))
       or (r.stage = 'dept' and me.role = 'head' and public.dept_ok(me, r.dept))
       or (r.stage = 'procurement' and me.role = 'procurement')
       or (r.stage = 'finance' and me.role = 'finance')
       or (r.stage = 'gm' and me.role = 'gm')) then
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  update public.material_requests set stage = 'rejected' where id = p_req;
  perform public.log_request(p_req, 'رفض ' || case me.role when 'admin' then 'مدير النظام' when 'head' then 'رئيس القسم' when 'procurement' then 'المشتريات' when 'finance' then 'المالية' else 'المدير العام' end, p_note);
end $$;

create or replace function public.set_item_dates(p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r jsonb; n int := 0; it public.boq_items;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.role not in ('site','head','gm','owner','admin') then raise exception 'تعديل مدد البنود لمهندس الموقع ورئيس القسم والإدارة'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    select * into it from public.boq_items where id = (r->>'id')::uuid;
    if it.id is null then continue; end if;
    if me.role = 'head' and not public.dept_ok(me, it.dept) then
      raise exception 'البند % ليس من أقسامك', it.code; end if;
    if (r->>'end')::date < (r->>'start')::date then raise exception 'تاريخ النهاية قبل البداية في البند %', it.code; end if;
    update public.boq_items set start_date = (r->>'start')::date, end_date = (r->>'end')::date where id = it.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 2) Petty cash: request -> GM approves -> the requester attaches the invoice, so nothing stays open against them.
alter table public.petty_cash add column invoice_path text, add column invoice_at timestamptz;
-- Receipts sent with the request count as the invoice for requests already approved.
update public.petty_cash set invoice_path = receipt_path, invoice_at = coalesce(decided_at, created_at) where receipt_path is not null and status = 'approved';

create or replace function public.attach_petty_invoice(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.petty_cash;
begin
  select * into c from public.petty_cash where id = p_id for update;
  if c.id is null then raise exception 'الطلب غير موجود'; end if;
  if c.requested_by <> (select auth.uid()) and public.my_role() <> 'admin' then raise exception 'إرفاق الفاتورة لصاحب الطلب'; end if;
  if c.status <> 'approved' then raise exception 'الفاتورة تُرفق بعد موافقة المدير العام'; end if;
  if coalesce(trim(p_path), '') = '' then raise exception 'اختر ملف الفاتورة'; end if;
  update public.petty_cash set invoice_path = p_path, invoice_at = now() where id = p_id;
end $$;
grant execute on function public.attach_petty_invoice(uuid, text) to authenticated;
