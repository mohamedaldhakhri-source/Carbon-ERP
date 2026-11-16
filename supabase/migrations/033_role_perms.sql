-- Permissions per role, editable by the system admin from the app (#perms).
-- A row (perm, role) means that role may do that thing. The system admin may always do everything.
-- Request steps with no role ticked (mr.head, mr.qs) are skipped. Approvals listed under boq.approve
-- all have to agree (each ticked role approves once); every other approval needs any one ticked role.
create table if not exists public.role_perms (
  perm text not null,
  role text not null check (role in ('owner', 'gm', 'head', 'site', 'procurement', 'qs', 'finance')),
  primary key (perm, role)
);
alter table public.role_perms enable row level security;
create policy role_perms_read on public.role_perms for select using ((select public.is_active()));
revoke insert, update, delete on public.role_perms from anon, authenticated;

-- today's behaviour, so nothing changes until the admin edits it
insert into public.role_perms (perm, role) values
  ('proj.create', 'gm'), ('proj.create', 'owner'),
  ('proj.request', 'head'),
  ('proj.approve', 'gm'), ('proj.approve', 'owner'),
  ('proj.edit', 'gm'), ('proj.edit', 'owner'),
  ('boq.add', 'qs'), ('boq.add', 'head'), ('boq.add', 'gm'), ('boq.add', 'owner'),
  ('boq.approve', 'gm'), ('boq.approve', 'owner'),
  ('boq.edit', 'gm'), ('boq.edit', 'owner'),
  ('boq.progress', 'site'), ('boq.progress', 'head'), ('boq.progress', 'gm'), ('boq.progress', 'owner'),
  ('sched.approve', 'gm'),
  ('mr.head', 'head'),
  ('mr.price', 'procurement'),
  ('mr.qs', 'qs'),
  ('mr.final', 'gm'), ('mr.final', 'owner'),
  ('mr.po', 'procurement'),
  ('pc.approve', 'gm'),
  ('vo.approve', 'gm'), ('vo.approve', 'owner'),
  ('fin.view', 'finance'), ('fin.view', 'gm'), ('fin.view', 'owner'),
  ('fin.record', 'finance'),
  ('sup.view', 'procurement'), ('sup.view', 'qs'), ('sup.view', 'finance'), ('sup.view', 'gm'), ('sup.view', 'owner'),
  ('sup.edit', 'procurement'), ('sup.edit', 'gm'), ('sup.edit', 'owner'),
  ('reports.view', 'gm'), ('reports.view', 'owner'),
  ('ai.use', 'gm'), ('ai.use', 'owner')
on conflict do nothing;

create or replace function public.can(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select pr.role = 'admin' or exists (select 1 from public.role_perms rp where rp.perm = p_perm and rp.role = pr.role)
                   from public.profiles pr where pr.id = (select auth.uid())), false)
$$;
-- a step is in use when at least one role holds it
create or replace function public.step_on(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.role_perms where perm = p_perm)
$$;
revoke all on function public.can(text) from public, anon;
revoke all on function public.step_on(text) from public, anon;
grant execute on function public.can(text) to authenticated;
grant execute on function public.step_on(text) to authenticated;

-- ---------- BOQ items added by hand: approvals per role ----------
alter table public.boq_items add column if not exists oks jsonb not null default '{}'::jsonb; -- {role: {by, at}}; replaces gm_ok_by/owner_ok_by
update public.boq_items set oks = jsonb_strip_nulls(jsonb_build_object(
    'gm', case when gm_ok_by is not null then jsonb_build_object('by', gm_ok_by, 'at', gm_ok_at) end,
    'owner', case when owner_ok_by is not null then jsonb_build_object('by', owner_ok_by, 'at', owner_ok_at) end))
  where approval = 'pending' and oks = '{}'::jsonb;

-- pending items whose approvals now cover every role that has to approve join the project
create or replace function public.boq_settle() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.boq_items b set approval = 'approved'
    where b.approval = 'pending' and public.step_on('boq.approve')
      and not exists (select 1 from public.role_perms rp where rp.perm = 'boq.approve' and not (b.oks ? rp.role));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.boq_settle() from public, anon, authenticated;

create or replace function public.add_boq_item(p_project uuid, p_section text, p_section_name text, p_code text, p_desc text,
  p_qty numeric, p_unit text, p_rate numeric, p_dept text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); v_id uuid; v_sort int; v_oks jsonb := '{}'::jsonb;
begin
  if not public.can('boq.add') then raise exception 'ما عندك صلاحية تضيف بنود BOQ'; end if;
  if not exists (select 1 from public.projects where id = p_project and coalesce(approval, 'approved') = 'approved') then raise exception 'المشروع غير موجود أو غير معتمد'; end if;
  p_section := nullif(trim(coalesce(p_section, '')), ''); p_code := nullif(trim(coalesce(p_code, '')), ''); p_desc := nullif(trim(coalesce(p_desc, '')), '');
  if p_section is null or p_code is null or p_desc is null then raise exception 'اكتب القسم ورقم البند والوصف'; end if;
  if coalesce(p_qty, 0) <= 0 or coalesce(p_rate, -1) < 0 then raise exception 'الكمية لازم أكبر من صفر والسعر ما يكون سالب'; end if;
  if p_dept = '' then p_dept := null; end if;
  if exists (select 1 from public.boq_items where project_id = p_project and code = p_code and approval <> 'rejected') then raise exception 'رقم البند % موجود في المشروع', p_code; end if;
  if not exists (select 1 from public.boq_sections where project_id = p_project and code = p_section) then
    insert into public.boq_sections (project_id, code, name, sort)
      values (p_project, p_section, coalesce(nullif(trim(p_section_name), ''), 'قسم ' || p_section),
              coalesce((select max(sort) + 1 from public.boq_sections where project_id = p_project), 0));
  end if;
  -- whoever adds it, if their role is one of the approvers, has approved their part already
  if exists (select 1 from public.role_perms where perm = 'boq.approve' and role = v_role) then
    v_oks := jsonb_build_object(v_role, jsonb_build_object('by', auth.uid(), 'at', now()));
  end if;
  select coalesce(max(sort) + 1, 0) into v_sort from public.boq_items where project_id = p_project;
  insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, dept, sort, approval, added_by, added_at, oks)
    values (p_project, p_section, p_code, p_desc, p_qty, coalesce(p_unit, ''), p_rate, round(p_qty * p_rate, 3), p_dept, v_sort, 'pending', auth.uid(), now(), v_oks)
    returning id into v_id;
  perform public.boq_settle();
  return v_id;
end $$;

create or replace function public.decide_boq_item(p_item uuid, p_ok boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); it public.boq_items;
begin
  if not (v_role = 'admin' or exists (select 1 from public.role_perms where perm = 'boq.approve' and role = v_role)) then
    raise exception 'ما عندك صلاحية اعتماد بنود BOQ'; end if;
  select * into it from public.boq_items where id = p_item for update;
  if not found or it.approval <> 'pending' then raise exception 'البند مو بانتظار الموافقة'; end if;
  if not p_ok then
    update public.boq_items set approval = 'rejected', decided_by = auth.uid(), decide_note = nullif(trim(coalesce(p_note, '')), '') where id = p_item;
    return 'rejected';
  end if;
  if v_role = 'admin' then
    update public.boq_items set approval = 'approved', decided_by = auth.uid(),
      oks = oks || jsonb_build_object('admin', jsonb_build_object('by', auth.uid(), 'at', now())),
      decide_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decide_note) where id = p_item;
    return 'approved';
  end if;
  update public.boq_items set oks = oks || jsonb_build_object(v_role, jsonb_build_object('by', auth.uid(), 'at', now())),
    decided_by = auth.uid(), decide_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decide_note)
    where id = p_item;
  perform public.boq_settle();
  return (select approval from public.boq_items where id = p_item);
end $$;

-- ---------- the admin edits the permissions ----------
create or replace function public.set_role_perm(p_perm text, p_role text, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'admin' then raise exception 'تعديل الصلاحيات لمدير النظام فقط'; end if;
  if p_perm not in ('proj.create', 'proj.request', 'proj.approve', 'proj.edit', 'boq.add', 'boq.approve', 'boq.edit', 'boq.progress',
                    'sched.approve', 'mr.head', 'mr.price', 'mr.qs', 'mr.final', 'mr.po', 'pc.approve', 'vo.approve',
                    'fin.view', 'fin.record', 'sup.view', 'sup.edit', 'reports.view', 'ai.use') then
    raise exception 'صلاحية غير معروفة: %', p_perm; end if;
  if p_role not in ('owner', 'gm', 'head', 'site', 'procurement', 'qs', 'finance') then raise exception 'دور غير معروف: %', p_role; end if;
  if p_on then insert into public.role_perms (perm, role) values (p_perm, p_role) on conflict do nothing;
  else delete from public.role_perms where perm = p_perm and role = p_role; end if;
  if p_perm = 'boq.approve' then perform public.boq_settle(); end if;
end $$;
revoke all on function public.set_role_perm(text, text, boolean) from public, anon;
grant execute on function public.set_role_perm(text, text, boolean) to authenticated;

-- ---------- projects, BOQ and timeline ----------
alter policy projects_admin_ins on public.projects with check ((select public.can('proj.create')));
alter policy projects_head_ins on public.projects with check ((select public.can('proj.request')) and approval = 'pending' and requested_by = (select auth.uid()));
alter policy projects_admin_upd on public.projects using ((select public.can('proj.edit')));
alter policy projects_head_upd on public.projects using ((select public.can('proj.request')) and approval = 'pending' and requested_by = (select auth.uid()))
  with check (approval = 'pending' and requested_by = (select auth.uid()));
alter policy boq_items_admin_ins on public.boq_items with check ((select public.can('proj.create')) or (select public.can('boq.edit')));
alter policy boq_items_admin_upd on public.boq_items using ((select public.can('boq.edit')));
alter policy boq_sections_admin_ins on public.boq_sections with check ((select public.can('proj.create')) or (select public.can('boq.edit')));
alter policy boq_sections_admin_upd on public.boq_sections using ((select public.can('boq.edit')));
alter policy tasks_admin_ins on public.tasks with check ((select public.can('proj.create')) or (select public.can('proj.edit')));
alter policy tasks_admin_upd on public.tasks using ((select public.can('proj.edit')));
alter policy vo_update on public.variations using (created_by = (select auth.uid()) or (select public.can('vo.approve')));

create or replace function public.decide_project(p_project uuid, p_ok boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can('proj.approve') then raise exception 'ما عندك صلاحية اعتماد المشاريع'; end if;
  update public.projects set approval = case when p_ok then 'approved' else 'rejected' end,
    approval_by = (select auth.uid()), approval_at = now(), approval_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_project and approval <> 'approved';
end $$;

create or replace function public.approve_schedule(p_project uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can('sched.approve') then raise exception 'ما عندك صلاحية اعتماد الجدول الزمني'; end if;
  if not exists (select 1 from public.tasks where project_id = p_project)
     and not exists (select 1 from public.boq_items where project_id = p_project and start_date is not null) then
    raise exception 'الجدول الزمني فاضي'; end if;
  update public.projects
    set schedule_status = 'approved', schedule_approved_by = (select auth.uid()), schedule_approved_at = now(), schedule_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_project;
end $$;

create or replace function public.rename_section(p_project uuid, p_code text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can('boq.edit') then raise exception 'ما عندك صلاحية تعديل BOQ'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'اكتب اسم القسم'; end if;
  update public.boq_sections set name = trim(p_name) where project_id = p_project and code = p_code;
  if not found then insert into public.boq_sections (project_id, code, name, sort) values (p_project, p_code, trim(p_name), 999); end if;
end $$;

create or replace function public.set_item_prices(p_items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; q numeric; rt numeric;
begin
  if not public.can('boq.edit') then raise exception 'ما عندك صلاحية تعديل الكميات والأسعار'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    q := (r->>'qty')::numeric; rt := (r->>'rate')::numeric;
    if q is null or q < 0 or rt is null or rt < 0 then raise exception 'الكمية والسعر لازم أرقام موجبة'; end if;
    update public.boq_items set qty = q, rate = rt, total = round(q * rt, 3) where id = (r->>'id')::uuid;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.set_item_depts(p_items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; d text; pid uuid;
begin
  if not public.can('boq.edit') then raise exception 'ما عندك صلاحية تغيير قسم البند'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    d := nullif(r->>'dept','');
    if d is not null and d not in ('arch','interior','fitout','joinery','contracting','supervision') then raise exception 'قسم غير معروف: %', d; end if;
    update public.boq_items set dept = d where id = (r->>'id')::uuid returning project_id into pid;
    if pid is not null and d is not null then
      update public.projects set depts = array_append(depts, d) where id = pid and not (d = any(coalesce(depts, '{}')));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- site engineers and department heads only touch the items of their own departments
create or replace function public.set_progress(p_item uuid, p_progress integer)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; it public.boq_items;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if not public.can('boq.progress') then raise exception 'ما عندك صلاحية تحديث الإنجاز'; end if;
  select * into it from public.boq_items where id = p_item;
  if it.id is null then raise exception 'البند غير موجود'; end if;
  if me.role in ('head','site') and not public.dept_ok(me, it.dept) then raise exception 'البند % ليس من أقسامك', it.code; end if;
  update public.boq_items set progress = greatest(0, least(100, p_progress)) where id = p_item;
end $$;

create or replace function public.set_item_dates(p_items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r jsonb; n int := 0; it public.boq_items;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if not public.can('boq.progress') then raise exception 'ما عندك صلاحية تعديل مدة البنود'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    select * into it from public.boq_items where id = (r->>'id')::uuid;
    if it.id is null then continue; end if;
    if me.role in ('head','site') and not public.dept_ok(me, it.dept) then
      raise exception 'البند % ليس من أقسامك', it.code; end if;
    if (r->>'end')::date < (r->>'start')::date then raise exception 'تاريخ النهاية قبل البداية في البند %', it.code; end if;
    update public.boq_items set start_date = (r->>'start')::date, end_date = (r->>'end')::date where id = it.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- petty cash and variations ----------
create or replace function public.decide_petty(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can('pc.approve') then raise exception 'ما عندك صلاحية اعتماد البيتي كاش'; end if;
  update public.petty_cash
    set status = case when p_approve then 'approved' else 'rejected' end,
        decided_by = (select auth.uid()), decided_at = now(), decision_note = p_note
    where id = p_id and status = 'pending';
end $$;

create or replace function public.decide_variation(p_id uuid, p_ok boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can('vo.approve') then raise exception 'ما عندك صلاحية اعتماد الأعمال الإضافية'; end if;
  update public.variations set gm_status = case when p_ok then 'approved' else 'rejected' end,
    gm_by = (select auth.uid()), gm_at = now(), gm_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_id;
end $$;

create or replace function public.guard_variation_gm()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.gm_status <> 'pending') or
     (tg_op = 'UPDATE' and (new.gm_status, new.gm_by, new.gm_at, new.gm_note) is distinct from (old.gm_status, old.gm_by, old.gm_at, old.gm_note)) then
    if not public.can('vo.approve') then raise exception 'ما عندك صلاحية اعتماد الأعمال الإضافية'; end if;
  end if;
  if tg_op = 'UPDATE' and old.gm_status = 'approved'
     and (new.amount, new.title, new.description, new.project_id) is distinct from (old.amount, old.title, old.description, old.project_id)
     and not public.can('vo.approve') then
    raise exception 'الـ VO معتمد، ما يتعدل إلا من الإدارة';
  end if;
  return new;
end $$;

-- ---------- money from clients, suppliers, quotes ----------
alter policy ci_read on public.client_invoices using ((select public.can('fin.view')) or (select public.can('fin.record')));
alter policy ci_ins on public.client_invoices with check ((select public.can('fin.record')) and created_by = (select auth.uid()));
alter policy ci_upd on public.client_invoices using ((select public.can('fin.record')));
alter policy cp_read on public.client_payments using ((select public.can('fin.view')) or (select public.can('fin.record')));
alter policy cp_ins on public.client_payments with check ((select public.can('fin.record')) and created_by = (select auth.uid()));
alter policy cp_upd on public.client_payments using ((select public.can('fin.record')));
alter policy sup_read on public.suppliers using ((select public.can('sup.view')) or (select public.can('sup.edit')) or (select public.can('mr.price')));
alter policy sup_ins on public.suppliers with check ((select public.can('sup.edit')));
alter policy sup_upd on public.suppliers using ((select public.can('sup.edit')));
alter policy q_ins on public.quotes with check ((select public.can('mr.price')) and exists (select 1 from public.material_requests r where r.id = quotes.request_id and r.stage = 'procurement'));
alter policy q_upd on public.quotes using ((select public.can('mr.price')) and exists (select 1 from public.material_requests r where r.id = quotes.request_id and r.stage = 'procurement'));
alter policy q_del on public.quotes using ((select public.can('mr.price')) and exists (select 1 from public.material_requests r where r.id = quotes.request_id and r.stage = 'procurement'));

-- ---------- material requests ----------
create or replace function public.role_label(p_role text) returns text language sql immutable set search_path = '' as $$
  select case p_role when 'admin' then 'مدير النظام' when 'owner' then 'صاحب الشركة' when 'gm' then 'المدير العام' when 'head' then 'رئيس القسم'
    when 'site' then 'مهندس الموقع' when 'procurement' then 'المشتريات' when 'qs' then 'مهندس الكميات (QS)' when 'finance' then 'المالية' else p_role end
$$;

-- the requester sends it on to pricing: procurement's own requests, or any request when no role approves for the department
create or replace function public.start_proc_request(p_req uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; own boolean;
begin
  select * into r from public.material_requests where id = p_req for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  own := public.my_role() <> 'admin' and public.can('mr.price');
  if r.requested_by <> (select auth.uid()) or r.stage <> 'dept' or not (own or not public.step_on('mr.head')) then
    raise exception 'هذه الخطوة ليست من صلاحيتك'; end if;
  update public.material_requests set stage = 'procurement' where id = p_req;
  perform public.log_request(p_req, case when own then 'طلب من المشتريات مباشرة' else 'راح للمشتريات مباشرة (بدون موافقة رئيس القسم)' end, null);
end $$;

create or replace function public.set_request_items(p_req uuid, p_items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; x jsonb; n int := 0;
begin
  select * into r from public.material_requests where id = p_req;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not public.can('mr.price') or r.stage <> 'procurement' then raise exception 'تحديد المواد والأسعار للمشتريات'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    update public.request_items
      set description = coalesce(nullif(trim(x->>'d'),''), description),
          unit_price = nullif(x->>'price','')::numeric
      where id = (x->>'id')::uuid and request_id = p_req;
    n := n + 1;
  end loop;
  return n;
end $$;

-- who may act on a request at its current step
create or replace function public.may_act(r public.material_requests) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null then return false; end if;
  if me.role = 'admin' then return r.stage in ('dept','procurement','qs','finance','gm','po'); end if;
  return case r.stage
    when 'dept' then public.can('mr.head') and (me.role not in ('head','site') or public.dept_ok(me, r.dept))
    when 'procurement' then public.can('mr.price')
    when 'qs' then public.can('mr.qs')
    when 'finance' then me.role in ('finance','gm')
    when 'gm' then public.can('mr.final')
    when 'po' then public.can('mr.po')
    else false end;
end $$;
revoke all on function public.may_act(public.material_requests) from public, anon;
grant execute on function public.may_act(public.material_requests) to authenticated;

create or replace function public.advance_request(p_req uuid, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles; nxt text; act text; adm boolean; asker text; who text;
begin
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if not public.may_act(r) then raise exception 'هذه الخطوة ليست من صلاحيتك'; end if;
  adm := me.role = 'admin'; who := public.role_label(me.role);
  asker := case coalesce(r.clarify_by, 'gm') when 'qs' then 'مهندس الكميات (QS)' else 'الاعتماد النهائي' end;
  if r.clarify is not null and r.clarify = r.stage and coalesce(trim(p_note),'') = '' then
    raise exception 'اكتب التوضيح المطلوب'; end if;
  if r.stage = 'dept' then
    if r.clarify = 'dept' then nxt := coalesce(r.clarify_by, 'gm'); act := 'رد ' || who || ' على استيضاح ' || asker;
    else nxt := 'procurement'; act := 'وافق ' || who || ' (موافقة القسم)'; end if;
  elsif r.stage = 'procurement' then
    if exists (select 1 from public.request_items where request_id = p_req and (unit_price is null or unit_price < 0)) then
      raise exception 'اكتب سعر كل مادة أولاً'; end if;
    if not exists (select 1 from public.quotes where request_id = p_req and selected) then
      raise exception 'اختر عرض سعر أولاً'; end if;
    if exists (select 1 from public.quotes where request_id = p_req and selected and coalesce(file_path,'') = '') then
      raise exception 'ارفق ملف الكوتيشن للعرض المختار'; end if;
    if exists (select 1 from public.quotes where request_id = p_req and selected and supplier_id is null) then
      raise exception 'اختر المورّد من قائمة الموردين المسجلين'; end if;
    if r.clarify = 'procurement' then nxt := coalesce(r.clarify_by, 'gm'); act := 'ردت المشتريات على استيضاح ' || asker;
    elsif public.step_on('mr.qs') then nxt := 'qs'; act := 'سعّر المواد وأرفق الكوتيشن وأرسل لمهندس الكميات (QS)';
    else nxt := 'gm'; act := 'سعّر المواد وأرفق الكوتيشن وأرسل للاعتماد النهائي'; end if;
  elsif r.stage = 'qs' then
    nxt := 'gm';
    act := case when r.clarify = 'qs' then 'رد مهندس الكميات (QS) على الاستيضاح' else 'راجع ' || who || ' الطلب ووافق وأرسل للاعتماد النهائي' end;
  elsif r.stage = 'finance' then
    nxt := 'gm'; act := 'أُرسل للاعتماد النهائي';
  elsif r.stage = 'gm' then
    nxt := 'po'; act := 'اعتمد ' || who;
  elsif r.stage = 'po' then
    nxt := 'done';
    update public.material_requests
      set po_no = public.next_doc_no('PO', 4), po_date = (now() at time zone 'Asia/Muscat')::date
      where id = p_req;
    select 'أصدر أمر الشراء ' || po_no || ' وأرسله للمورّد' into act from public.material_requests where id = p_req;
  end if;
  update public.material_requests set stage = nxt, clarify = null, clarify_by = null where id = p_req;
  perform public.log_request(p_req, act, p_note);
  return nxt;
end $$;

create or replace function public.reject_request(p_req uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.material_requests;
begin
  if coalesce(trim(p_note),'') = '' then raise exception 'اكتب سبب الرفض'; end if;
  select * into r from public.material_requests where id = p_req for update;
  if r.id is null or not public.may_act(r) then raise exception 'هذه الخطوة ليست من صلاحيتك'; end if;
  update public.material_requests set stage = 'rejected', clarify = null, clarify_by = null where id = p_req;
  perform public.log_request(p_req, 'رفض ' || public.role_label(public.my_role()), p_note);
end $$;

create or replace function public.clarify_request(p_req uuid, p_to text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; rl text := public.my_role(); who text; tgt text;
begin
  if coalesce(trim(p_note),'') = '' then raise exception 'اكتب وش التوضيح المطلوب'; end if;
  select * into r from public.material_requests where id = p_req for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if r.stage = 'gm' and public.may_act(r) then
    if p_to not in ('dept','procurement','qs') then raise exception 'اختر الجهة'; end if;
    who := 'gm';
  elsif r.stage = 'qs' and public.may_act(r) then
    if p_to not in ('dept','procurement') then raise exception 'اختر الجهة'; end if;
    who := 'qs';
  else
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  tgt := case p_to when 'dept' then 'رئيس القسم' when 'qs' then 'مهندس الكميات (QS)' else 'المشتريات' end;
  update public.material_requests set stage = p_to, clarify = p_to, clarify_by = who where id = p_req;
  perform public.log_request(p_req, 'طلب ' || public.role_label(rl) || ' توضيح من ' || tgt, p_note);
end $$;
