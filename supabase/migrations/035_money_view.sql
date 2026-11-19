-- Financial figures (contract value, BOQ prices, budget, spending, received amounts) are for the owner, GM,
-- accountant and QS only (Mohamed 2026-11-19). New permission money.view, editable on the permissions page.
insert into public.role_perms (perm, role) values
  ('money.view', 'owner'), ('money.view', 'gm'), ('money.view', 'finance'), ('money.view', 'qs'),
  ('fin.view', 'qs')
on conflict do nothing;

create or replace function public.set_role_perm(p_perm text, p_role text, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'admin' then raise exception 'تعديل الصلاحيات لمدير النظام فقط'; end if;
  if p_perm not in ('proj.create', 'proj.request', 'proj.approve', 'proj.edit', 'boq.add', 'boq.approve', 'boq.edit', 'boq.progress',
                    'sched.approve', 'mr.head', 'mr.price', 'mr.qs', 'mr.final', 'mr.po', 'pc.approve', 'vo.approve',
                    'fin.view', 'fin.record', 'money.view', 'sup.view', 'sup.edit', 'reports.view', 'ai.use') then
    raise exception 'صلاحية غير معروفة: %', p_perm; end if;
  if p_role not in ('owner', 'gm', 'head', 'site', 'procurement', 'qs', 'finance') then raise exception 'دور غير معروف: %', p_role; end if;
  if p_on then insert into public.role_perms (perm, role) values (p_perm, p_role) on conflict do nothing;
  else delete from public.role_perms where perm = p_perm and role = p_role; end if;
  if p_perm = 'boq.approve' then perform public.boq_settle(); end if;
end $$;
