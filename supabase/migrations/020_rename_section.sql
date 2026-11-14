-- GM, owner and admin can rename a BOQ section (scanned files often lose the heading).
create or replace function public.rename_section(p_project uuid, p_code text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('gm','owner','admin') then raise exception 'تعديل أسماء الأقسام للمدير العام وصاحب الشركة'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'اكتب اسم القسم'; end if;
  update public.boq_sections set name = trim(p_name) where project_id = p_project and code = p_code;
  if not found then insert into public.boq_sections (project_id, code, name, sort) values (p_project, p_code, trim(p_name), 999); end if;
end $$;
grant execute on function public.rename_section(uuid, text, text) to authenticated;
