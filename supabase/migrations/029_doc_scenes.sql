-- Furniture and landscape pieces added in the 3D viewer, kept per document (Mohamed, 2026-11-15).
create table public.doc_scenes (
  doc_id uuid primary key references public.project_docs(id) on delete cascade,
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 5000 and octet_length(items::text) <= 2000000),
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.doc_scenes enable row level security;
grant select, insert, update, delete on public.doc_scenes to authenticated;
create policy scenes_read on public.doc_scenes for select to authenticated using ((select public.is_active()));
create policy scenes_ins on public.doc_scenes for insert to authenticated
  with check ((select public.is_active()) and updated_by = (select auth.uid()));
create policy scenes_upd on public.doc_scenes for update to authenticated
  using ((select public.is_active())) with check ((select public.is_active()) and updated_by = (select auth.uid()));
create policy scenes_admin_del on public.doc_scenes for delete to authenticated using ((select public.my_role()) = 'admin');
