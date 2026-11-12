-- The very first account becomes the owner; everyone after waits for activation.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email,
          case when exists (select 1 from public.profiles) then 'pending' else 'admin' end);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
