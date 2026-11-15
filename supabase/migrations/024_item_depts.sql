-- GM, owner and admin can move a BOQ item to another department from the timeline edit mode.
-- The project's department list grows to include any new department.
create or replace function public.set_item_depts(p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; d text; pid uuid;
begin
  if public.my_role() not in ('gm','owner','admin') then raise exception 'تغيير قسم البند للمدير العام وصاحب الشركة'; end if;
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
grant execute on function public.set_item_depts(jsonb) to authenticated;
