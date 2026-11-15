-- Fixes found by the end-to-end test (2026-11-15):
-- 1) A site engineer could change dates and progress of items outside their departments. Now site and head
--    are limited to their own departments (no departments = all, same as everywhere else).
-- 2) A new material request could be inserted with a PO number or clarification state already filled in.
-- 3) The creator of a Variation Order could change its amount, title or description after the GM approved it.

create or replace function public.set_item_dates(p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r jsonb; n int := 0; it public.boq_items;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.role not in ('site','head','gm','owner','admin') then raise exception 'تعديل مدة البنود لمهندس الموقع ورئيس القسم والإدارة'; end if;
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

create or replace function public.set_progress(p_item uuid, p_progress integer) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; it public.boq_items;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.role not in ('site','head','gm','owner','admin') then raise exception 'تحديث الإنجاز لمهندس الموقع ورئيس القسم'; end if;
  select * into it from public.boq_items where id = p_item;
  if it.id is null then raise exception 'البند غير موجود'; end if;
  if me.role in ('head','site') and not public.dept_ok(me, it.dept) then raise exception 'البند % ليس من أقسامك', it.code; end if;
  update public.boq_items set progress = greatest(0, least(100, p_progress)) where id = p_item;
end $$;

alter policy mr_insert on public.material_requests
  with check ((select public.is_active()) and requested_by = (select auth.uid()) and stage = 'dept'
              and po_no is null and po_date is null and clarify is null and clarify_by is null);

create or replace function public.guard_variation_gm() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.gm_status <> 'pending') or
     (tg_op = 'UPDATE' and (new.gm_status, new.gm_by, new.gm_at, new.gm_note) is distinct from (old.gm_status, old.gm_by, old.gm_at, old.gm_note)) then
    if coalesce(public.my_role(), '') not in ('gm','owner','admin') then raise exception 'اعتماد الأعمال الإضافية للمدير العام'; end if;
  end if;
  if tg_op = 'UPDATE' and old.gm_status = 'approved'
     and (new.amount, new.title, new.description, new.project_id) is distinct from (old.amount, old.title, old.description, old.project_id)
     and coalesce(public.my_role(), '') not in ('gm','owner','admin') then
    raise exception 'الـ VO معتمد، ما يتعدل إلا من الإدارة';
  end if;
  return new;
end $$;
