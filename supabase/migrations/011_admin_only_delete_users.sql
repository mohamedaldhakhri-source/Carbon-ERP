-- Only the system admin may delete anything or manage users. Owner and GM keep everything else.
alter policy projects_admin_del on public.projects using ((select public.my_role()) = 'admin');
alter policy boq_items_admin_del on public.boq_items using ((select public.my_role()) = 'admin');
alter policy boq_sections_admin_del on public.boq_sections using ((select public.my_role()) = 'admin');
alter policy tasks_admin_del on public.tasks using ((select public.my_role()) = 'admin');

create or replace function public.set_user_role(p_user uuid, p_role text, p_dept text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'admin' then raise exception 'إدارة المستخدمين لمدير النظام فقط'; end if;
  update public.profiles set role = p_role, dept = nullif(p_dept,'') where id = p_user;
end $$;
