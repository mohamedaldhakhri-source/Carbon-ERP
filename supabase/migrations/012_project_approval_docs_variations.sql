-- 1) Department heads may propose a project; it stays pending until the GM (or owner/admin) approves it.
alter table public.projects
  add column approval text not null default 'approved' check (approval in ('pending','approved','rejected')),
  add column requested_by uuid references public.profiles(id),
  add column approval_by uuid references public.profiles(id),
  add column approval_at timestamptz,
  add column approval_note text;

create policy projects_head_ins on public.projects for insert to authenticated
  with check ((select public.my_role()) = 'head' and approval = 'pending' and requested_by = (select auth.uid()));
create policy projects_head_upd on public.projects for update to authenticated
  using ((select public.my_role()) = 'head' and approval = 'pending' and requested_by = (select auth.uid()))
  with check (approval = 'pending' and requested_by = (select auth.uid()));
create policy boq_sections_head_ins on public.boq_sections for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = project_id and p.approval = 'pending' and p.requested_by = (select auth.uid())));
create policy boq_items_head_ins on public.boq_items for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = project_id and p.approval = 'pending' and p.requested_by = (select auth.uid())));

create or replace function public.decide_project(p_project uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('gm','owner','admin') then raise exception 'اعتماد المشاريع للمدير العام وصاحب الشركة'; end if;
  update public.projects set approval = case when p_ok then 'approved' else 'rejected' end,
    approval_by = (select auth.uid()), approval_at = now(), approval_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_project and approval <> 'approved';
end $$;
grant execute on function public.decide_project(uuid, boolean, text) to authenticated;

-- 2) Project documents: contract, BOQ, drawings, ministry letters and anything else.
create table public.project_docs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null default 'other' check (kind in ('contract','boq','drawing','ministry','other')),
  title text not null,
  path text not null,
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.project_docs(project_id);
alter table public.project_docs enable row level security;
grant select, insert, delete on public.project_docs to authenticated;
create policy docs_read on public.project_docs for select to authenticated using ((select public.is_active()));
create policy docs_ins on public.project_docs for insert to authenticated
  with check ((select public.is_active()) and uploaded_by = (select auth.uid()));
create policy docs_admin_del on public.project_docs for delete to authenticated using ((select public.my_role()) = 'admin');

-- 3) Out-of-contract works: the site attaches the ministry/client approval, then the GM approves.
alter table public.variations
  add column gm_status text not null default 'pending' check (gm_status in ('pending','approved','rejected')),
  add column gm_by uuid references public.profiles(id),
  add column gm_at timestamptz,
  add column gm_note text;
update public.variations set gm_status = 'approved' where client_status = 'approved';

create or replace function public.guard_variation_gm() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.gm_status <> 'pending') or
     (tg_op = 'UPDATE' and (new.gm_status, new.gm_by, new.gm_at, new.gm_note) is distinct from (old.gm_status, old.gm_by, old.gm_at, old.gm_note)) then
    if coalesce(public.my_role(), '') not in ('gm','owner','admin') then raise exception 'اعتماد الأعمال الإضافية للمدير العام'; end if;
  end if;
  return new;
end $$;
create trigger variations_gm_guard before insert or update on public.variations for each row execute function public.guard_variation_gm();

create or replace function public.decide_variation(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('gm','owner','admin') then raise exception 'اعتماد الأعمال الإضافية للمدير العام'; end if;
  update public.variations set gm_status = case when p_ok then 'approved' else 'rejected' end,
    gm_by = (select auth.uid()), gm_at = now(), gm_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_id;
end $$;
grant execute on function public.decide_variation(uuid, boolean, text) to authenticated;
