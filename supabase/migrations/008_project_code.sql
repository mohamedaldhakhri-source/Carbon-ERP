-- Every project has a unique company code (suggested as CE-<year>-<seq>, editable).
alter table public.projects add column code text;
update public.projects p set code = 'CE-' || to_char(p.created_at,'YYYY') || '-' || lpad(x.n::text,3,'0')
  from (select id, row_number() over (order by created_at) n from public.projects) x
  where x.id = p.id and p.code is null;
alter table public.projects alter column code set not null;
create unique index projects_code_key on public.projects (upper(code));
