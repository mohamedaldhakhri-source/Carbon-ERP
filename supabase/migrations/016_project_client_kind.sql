-- Project kinds: government, company, private (individual). projects.type stays gov/private;
-- client_type tells a company from an individual inside "private".
alter table public.projects
  add column client_type text check (client_type in ('company','individual')),
  add column client_phone text,
  add column client_id_no text,
  add column client_id_path text,
  add column client_cr text;
update public.projects set client_type = 'individual' where type = 'private' and client_type is null;
