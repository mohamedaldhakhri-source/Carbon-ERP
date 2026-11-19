-- A material request for a BOQ item carries the client's approval of the material (Mohamed 2026-11-19).
alter table public.material_requests add column if not exists client_ok_path text;

create or replace function public.require_client_ok() returns trigger language plpgsql as $$
begin
  if new.boq_item_id is not null and coalesce(new.client_ok_path, '') = '' then
    raise exception 'ارفق موافقة العميل على المادة لبند الـ BOQ';
  end if;
  return new;
end $$;

create or replace trigger material_requests_client_ok before insert on public.material_requests
  for each row execute function public.require_client_ok();
