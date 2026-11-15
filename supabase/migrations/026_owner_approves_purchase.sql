-- The company owner can take the GM's purchase step: approve, reject or ask for clarification (Mohamed, 2026-11-15).
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
  elsif r.stage = 'gm' and (adm or me.role in ('gm','owner')) then
    nxt := 'po'; act := case when me.role = 'owner' then 'اعتمد صاحب الشركة' else 'اعتمد المدير العام' end;
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
  if r.stage = 'gm' and rl in ('gm','owner','admin') then
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
  perform public.log_request(p_req, case who when 'gm' then (case when rl = 'owner' then 'طلب صاحب الشركة توضيح من ' else 'طلب المدير العام توضيح من ' end) else 'أرجع مهندس الكميات (QS) الطلب للتوضيح من ' end || tgt, p_note);
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
       or (r.stage = 'gm' and me.role in ('gm','owner'))) then
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  update public.material_requests set stage = 'rejected', clarify = null, clarify_by = null where id = p_req;
  perform public.log_request(p_req, 'رفض ' || case me.role when 'admin' then 'مدير النظام' when 'head' then 'رئيس القسم' when 'procurement' then 'المشتريات' when 'qs' then 'مهندس الكميات (QS)' when 'finance' then 'المالية' when 'owner' then 'صاحب الشركة' else 'المدير العام' end, p_note);
end $$;
