-- Readings kept per file, not per document: a drawing is read once (by the AI or in the browser) and the result
-- is found again whenever the same file is opened, even after the document is deleted and uploaded again.
-- Files are told apart by the SHA-256 of their bytes, worked out in the browser.
create table if not exists public.file_reads (
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  key text not null,
  val jsonb not null,
  at timestamptz not null default now(),
  primary key (hash, key)
);
alter table public.file_reads enable row level security; -- no policies: reached only through the functions below

alter table public.project_docs add column if not exists file_hash text;

-- what has been read for this document: the file's readings, then the document's own on top
create or replace function public.doc_open(p_doc uuid, p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_look jsonb; v_reads jsonb;
begin
  if not public.is_active() then raise exception 'not allowed'; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then p_hash := null; end if;
  if p_hash is not null then update public.project_docs set file_hash = p_hash where id = p_doc and file_hash is null; end if;
  select look, file_hash into v_look, p_hash from public.project_docs where id = p_doc;
  select jsonb_object_agg(key, val) into v_reads from public.file_reads where hash = p_hash;
  return coalesce(v_reads, '{}'::jsonb) || coalesce(v_look, '{}'::jsonb);
end $$;

-- a reading the browser worked out itself (no AI): anyone signed in may keep it, under a 'local:' key
create or replace function public.file_read_put(p_hash text, p_key text, p_val jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'not allowed'; end if;
  if p_hash !~ '^[0-9a-f]{64}$' or p_key !~ '^local:' or pg_column_size(p_val) > 4000000 then raise exception 'bad reading'; end if;
  insert into public.file_reads (hash, key, val) values (p_hash, p_key, p_val)
    on conflict (hash, key) do update set val = excluded.val, at = now();
end $$;

-- the AI's readings (saved by the edge function) are kept for the file as well
create or replace function public.doc_look_put(p_doc uuid, p_key text, p_val jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  update public.project_docs set look = coalesce(look, '{}'::jsonb) || jsonb_build_object(p_key, p_val) where id = p_doc returning file_hash into v_hash;
  if v_hash is not null then
    insert into public.file_reads (hash, key, val) values (v_hash, p_key, p_val)
      on conflict (hash, key) do update set val = excluded.val, at = now();
  end if;
end $$;

revoke all on function public.doc_open(uuid, text) from public, anon;
revoke all on function public.file_read_put(text, text, jsonb) from public, anon;
revoke all on function public.doc_look_put(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.doc_open(uuid, text) to authenticated;
grant execute on function public.file_read_put(text, text, jsonb) to authenticated;
grant execute on function public.doc_look_put(uuid, text, jsonb) to service_role;
