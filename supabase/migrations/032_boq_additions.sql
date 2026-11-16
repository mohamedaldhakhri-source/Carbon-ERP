-- BOQ items added by hand to a running project wait for both the GM and the owner before they count in the project
-- (value, progress, budget, requests). Items that came with the project when it was created stay 'approved'.
alter table public.boq_items
  add column if not exists approval text not null default 'approved' check (approval in ('pending', 'approved', 'rejected')),
  add column if not exists added_by uuid references public.profiles(id),
  add column if not exists added_at timestamptz,
  add column if not exists gm_ok_by uuid references public.profiles(id),
  add column if not exists gm_ok_at timestamptz,
  add column if not exists owner_ok_by uuid references public.profiles(id),
  add column if not exists owner_ok_at timestamptz,
  add column if not exists decided_by uuid references public.profiles(id),
  add column if not exists decide_note text;

create or replace function public.add_boq_item(p_project uuid, p_section text, p_section_name text, p_code text, p_desc text,
  p_qty numeric, p_unit text, p_rate numeric, p_dept text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); v_id uuid; v_sort int;
begin
  if v_role is null or v_role not in ('qs', 'head', 'gm', 'owner', 'admin') then raise exception 'ما عندك صلاحية تضيف بنود BOQ'; end if;
  if not exists (select 1 from public.projects where id = p_project and coalesce(approval, 'approved') = 'approved') then raise exception 'المشروع غير موجود أو غير معتمد'; end if;
  p_section := nullif(trim(coalesce(p_section, '')), ''); p_code := nullif(trim(coalesce(p_code, '')), ''); p_desc := nullif(trim(coalesce(p_desc, '')), '');
  if p_section is null or p_code is null or p_desc is null then raise exception 'اكتب القسم ورقم البند والوصف'; end if;
  if coalesce(p_qty, 0) <= 0 or coalesce(p_rate, -1) < 0 then raise exception 'الكمية لازم أكبر من صفر والسعر ما يكون سالب'; end if;
  if p_dept is not null and p_dept = '' then p_dept := null; end if;
  if exists (select 1 from public.boq_items where project_id = p_project and code = p_code and approval <> 'rejected') then raise exception 'رقم البند % موجود في المشروع', p_code; end if;
  if not exists (select 1 from public.boq_sections where project_id = p_project and code = p_section) then
    insert into public.boq_sections (project_id, code, name, sort)
      values (p_project, p_section, coalesce(nullif(trim(p_section_name), ''), 'قسم ' || p_section),
              coalesce((select max(sort) + 1 from public.boq_sections where project_id = p_project), 0));
  end if;
  select coalesce(max(sort) + 1, 0) into v_sort from public.boq_items where project_id = p_project;
  insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, dept, sort, approval, added_by, added_at,
                                gm_ok_by, gm_ok_at, owner_ok_by, owner_ok_at)
    values (p_project, p_section, p_code, p_desc, p_qty, coalesce(p_unit, ''), p_rate, round(p_qty * p_rate, 3), p_dept, v_sort, 'pending', auth.uid(), now(),
            case when v_role = 'gm' then auth.uid() end, case when v_role = 'gm' then now() end,
            case when v_role = 'owner' then auth.uid() end, case when v_role = 'owner' then now() end)
    returning id into v_id;
  return v_id;
end $$;

-- the GM and the owner each approve their part; the item joins the project once both have. Either can reject.
-- The system admin (full power) approves both parts at once.
create or replace function public.decide_boq_item(p_item uuid, p_ok boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); it public.boq_items;
begin
  if v_role is null or v_role not in ('gm', 'owner', 'admin') then raise exception 'الاعتماد للمدير العام وصاحب الشركة'; end if;
  select * into it from public.boq_items where id = p_item for update;
  if not found or it.approval <> 'pending' then raise exception 'البند مو بانتظار الموافقة'; end if;
  if not p_ok then
    update public.boq_items set approval = 'rejected', decided_by = auth.uid(), decide_note = nullif(trim(coalesce(p_note, '')), '') where id = p_item;
    return 'rejected';
  end if;
  update public.boq_items set
    gm_ok_by = case when v_role in ('gm', 'admin') and gm_ok_by is null then auth.uid() else gm_ok_by end,
    gm_ok_at = case when v_role in ('gm', 'admin') and gm_ok_by is null then now() else gm_ok_at end,
    owner_ok_by = case when v_role in ('owner', 'admin') and owner_ok_by is null then auth.uid() else owner_ok_by end,
    owner_ok_at = case when v_role in ('owner', 'admin') and owner_ok_by is null then now() else owner_ok_at end,
    decide_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decide_note)
  where id = p_item returning * into it;
  if it.gm_ok_by is not null and it.owner_ok_by is not null then
    update public.boq_items set approval = 'approved', decided_by = auth.uid() where id = p_item;
    return 'approved';
  end if;
  return 'pending';
end $$;

revoke all on function public.add_boq_item(uuid, text, text, text, text, numeric, text, numeric, text) from public, anon;
revoke all on function public.decide_boq_item(uuid, boolean, text) from public, anon;
grant execute on function public.add_boq_item(uuid, text, text, text, text, numeric, text, numeric, text) to authenticated;
grant execute on function public.decide_boq_item(uuid, boolean, text) to authenticated;
