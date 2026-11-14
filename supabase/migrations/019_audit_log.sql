-- Activity log: every change to company data (who, when, what changed from what to what), plus sign-ins,
-- with the caller's IP address and approximate location. Only the system admin can read it; nobody can edit it.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_name text,
  user_role text,
  action text not null,            -- insert | update | delete | login | logout | ...
  table_name text,
  record_id text,
  record_label text,               -- document number or name at the time (CEC-MR-2611-0001, project name)
  project_id uuid,
  changes jsonb,                   -- update: {field: [old, new]}; insert: new row; delete: old row
  ip text,
  country text,
  city text,
  user_agent text
);
create index on public.audit_log (at desc);
create index on public.audit_log (user_id, at desc);
create index on public.audit_log (project_id, at desc);
alter table public.audit_log enable row level security;
grant select on public.audit_log to authenticated;
create policy audit_admin_read on public.audit_log for select to authenticated using ((select public.my_role()) = 'admin');

-- Request headers come from the API gateway (PostgREST puts them in request.headers).
create or replace function public.req_header(p_name text) returns text
language sql stable set search_path = '' as $$
  select nullif(coalesce(current_setting('request.headers', true), '{}')::jsonb ->> p_name, '')
$$;
create or replace function public.req_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(public.req_header('cf-connecting-ip'), split_part(public.req_header('x-forwarded-for'), ',', 1), public.req_header('x-real-ip'))
$$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  ch jsonb := '{}'; k text; me public.profiles; pid uuid; lbl text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at') and (o -> k) is distinct from (n -> k) then ch := ch || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k)); end if;
    end loop;
    if ch = '{}' then return null; end if;
  else
    ch := r;
  end if;
  select * into me from public.profiles where id = (select auth.uid());
  pid := case when tg_table_name = 'projects' then (r ->> 'id')::uuid
              when r ? 'project_id' then (r ->> 'project_id')::uuid
              when r ? 'request_id' then (select project_id from public.material_requests where id = (r ->> 'request_id')::uuid) end;
  lbl := coalesce(r ->> 'no', r ->> 'code', r ->> 'name', r ->> 'title', r ->> 'full_name', r ->> 'supplier', r ->> 'description');
  if tg_table_name = 'boq_items' then lbl := concat_ws(' ', r ->> 'code', left(r ->> 'description', 60)); end if;
  if tg_table_name in ('request_items','quotes') then lbl := concat_ws(' · ', (select no from public.material_requests where id = (r ->> 'request_id')::uuid), left(lbl, 60)); end if;
  insert into public.audit_log (user_id, user_name, user_role, action, table_name, record_id, record_label, project_id, changes, ip, country, user_agent)
  values ((select auth.uid()), me.full_name, me.role, lower(tg_op), tg_table_name, r ->> 'id', left(lbl, 200), pid, ch,
          public.req_ip(), public.req_header('cf-ipcountry'), left(public.req_header('user-agent'), 300));
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['projects','boq_sections','boq_items','tasks','material_requests','request_items','quotes','petty_cash','variations','project_docs','profiles'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Sign-in / sign-out and other events sent by the app. The IP is taken from the request, not from the app;
-- the city/country the app sends is only a hint from an IP lookup.
create or replace function public.log_event(p_action text, p_city text default null, p_country text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  if p_action not in ('login','logout','session') then raise exception 'حدث غير معروف'; end if;
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null then return; end if;
  insert into public.audit_log (user_id, user_name, user_role, action, ip, country, city, user_agent)
  values (me.id, me.full_name, me.role, p_action, public.req_ip(), coalesce(public.req_header('cf-ipcountry'), left(p_country, 60)), left(p_city, 80), left(public.req_header('user-agent'), 300));
end $$;
grant execute on function public.log_event(text, text, text) to authenticated;
