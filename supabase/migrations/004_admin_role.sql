-- Separate "system admin" role: manages users and projects, sees everything, does not approve purchases.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending','admin','owner','gm','head','site','procurement','finance'));

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('admin','owner','gm') from public.profiles where id = (select auth.uid())), false)
$$;

create or replace function public.set_progress(p_item uuid, p_progress int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('site','head','gm','owner','admin') then raise exception 'تحديث الإنجاز لمهندس الموقع ورئيس القسم'; end if;
  update public.boq_items set progress = greatest(0, least(100, p_progress)) where id = p_item;
end $$;

-- The very first account becomes the system admin; everyone after waits for activation.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email,
          case when exists (select 1 from public.profiles) then 'pending' else 'admin' end);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
