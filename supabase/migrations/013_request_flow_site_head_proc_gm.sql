-- Material requests: site -> department head -> procurement (exact material names and prices) -> GM -> PO.
-- The finance step is no longer used; requests waiting there move to the GM.
alter table public.request_items add column unit_price numeric;

create or replace function public.set_request_items(p_req uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; x jsonb; n int := 0;
begin
  select * into r from public.material_requests where id = p_req;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if public.my_role() not in ('procurement','admin') or r.stage <> 'procurement' then raise exception 'تحديد المواد والأسعار للمشتريات'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    update public.request_items
      set description = coalesce(nullif(trim(x->>'d'),''), description),
          unit_price = nullif(x->>'price','')::numeric
      where id = (x->>'id')::uuid and request_id = p_req;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.set_request_items(uuid, jsonb) to authenticated;

create or replace function public.advance_request(p_req uuid, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles; nxt text; act text; adm boolean;
begin
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  adm := me.role = 'admin';
  if r.stage = 'dept' and (adm or (me.role = 'head' and (me.dept is null or me.dept = r.dept))) then
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

update public.material_requests set stage = 'gm' where stage = 'finance';
