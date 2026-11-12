-- System admin can take any step of any workflow and manage quotes, petty cash and variations.
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
    if not exists (select 1 from public.quotes where request_id = p_req and selected) then
      raise exception 'اختر عرض سعر أولاً'; end if;
    nxt := 'finance'; act := 'سجّل عروض الأسعار وأرسل للمالية';
  elsif r.stage = 'finance' and (adm or me.role = 'finance') then
    nxt := 'gm'; act := 'وافقت المالية';
  elsif r.stage = 'gm' and (adm or me.role = 'gm') then
    nxt := 'po'; act := 'اعتمد المدير العام';
  elsif r.stage = 'po' and (adm or me.role = 'procurement') then
    nxt := 'done';
    update public.material_requests
      set po_no = 'PO-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.po_seq')::text,4,'0'), po_date = current_date
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
       or (r.stage = 'dept' and me.role = 'head' and (me.dept is null or me.dept = r.dept))
       or (r.stage = 'procurement' and me.role = 'procurement')
       or (r.stage = 'finance' and me.role = 'finance')
       or (r.stage = 'gm' and me.role = 'gm')) then
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  update public.material_requests set stage = 'rejected' where id = p_req;
  perform public.log_request(p_req, 'رفض ' || case me.role when 'admin' then 'مدير النظام' when 'head' then 'رئيس القسم' when 'procurement' then 'المشتريات' when 'finance' then 'المالية' else 'المدير العام' end, p_note);
end $$;

create or replace function public.decide_petty(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('gm','admin') then raise exception 'اعتماد البيتي كاش للمدير العام'; end if;
  update public.petty_cash
    set status = case when p_approve then 'approved' else 'rejected' end,
        decided_by = (select auth.uid()), decided_at = now(), decision_note = p_note
    where id = p_id and status = 'pending';
end $$;

alter policy q_ins on public.quotes
  with check ((select public.my_role()) in ('procurement','admin') and exists (select 1 from public.material_requests r where r.id = request_id and r.stage = 'procurement'));
alter policy q_upd on public.quotes
  using ((select public.my_role()) in ('procurement','admin') and exists (select 1 from public.material_requests r where r.id = request_id and r.stage = 'procurement'));
alter policy q_del on public.quotes
  using ((select public.my_role()) in ('procurement','admin') and exists (select 1 from public.material_requests r where r.id = request_id and r.stage = 'procurement'));

-- Admin can correct or delete any record.
do $$ declare t text; begin
  foreach t in array array['material_requests','request_items','petty_cash','variations','request_history'] loop
    execute format('create policy %1$s_admin_upd on public.%1$s for update to authenticated using ((select public.my_role()) = ''admin'')', t);
    execute format('create policy %1$s_admin_del on public.%1$s for delete to authenticated using ((select public.my_role()) = ''admin'')', t);
  end loop;
end $$;
create policy profiles_admin_del on public.profiles for delete to authenticated using ((select public.my_role()) = 'admin');
create policy att_admin_del on storage.objects for delete to authenticated using (bucket_id = 'attachments' and (select public.my_role()) = 'admin');
