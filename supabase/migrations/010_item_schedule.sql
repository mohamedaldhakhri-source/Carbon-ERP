-- Built-in scheduling: every BOQ item has its own planned start and end date.
alter table public.boq_items add column start_date date, add column end_date date;

-- Site engineers, department heads (their department or all), GM, owner and admin may change item dates.
create or replace function public.set_item_dates(p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r jsonb; n int := 0; it public.boq_items;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.role not in ('site','head','gm','owner','admin') then raise exception 'تعديل مدد البنود لمهندس الموقع ورئيس القسم والإدارة'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    select * into it from public.boq_items where id = (r->>'id')::uuid;
    if it.id is null then continue; end if;
    if me.role = 'head' and me.dept is not null and it.dept is distinct from me.dept then
      raise exception 'البند % ليس من قسمك', it.code; end if;
    if (r->>'end')::date < (r->>'start')::date then raise exception 'تاريخ النهاية قبل البداية في البند %', it.code; end if;
    update public.boq_items set start_date = (r->>'start')::date, end_date = (r->>'end')::date where id = it.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.approve_schedule(p_project uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('gm','admin') then raise exception 'اعتماد الجدول الزمني للمدير العام'; end if;
  if not exists (select 1 from public.tasks where project_id = p_project)
     and not exists (select 1 from public.boq_items where project_id = p_project and start_date is not null) then
    raise exception 'الجدول الزمني فاضي'; end if;
  update public.projects
    set schedule_status = 'approved', schedule_approved_by = (select auth.uid()), schedule_approved_at = now(), schedule_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_project;
end $$;
