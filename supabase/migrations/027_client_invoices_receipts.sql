-- Money received from clients (Mohamed, 2026-11-15).
-- Finance issues an invoice to the client for work done (e.g. a government interim invoice), then records each
-- amount received against it with the date. The owner sees the totals and can open every receipt with its invoice number.
-- Finance and admin record; owner, GM and admin read. Nobody else sees these figures.
create table public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_no text not null,
  invoice_date date not null,
  amount numeric not null check (amount > 0),
  work_desc text,
  work_pct numeric check (work_pct between 0 and 100),
  file_path text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, invoice_no)
);
create table public.client_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid references public.client_invoices(id) on delete set null,
  amount numeric not null check (amount > 0),
  received_on date not null,
  method text check (method in ('transfer','cheque','cash')),
  reference text,
  note text,
  file_path text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.client_invoices(project_id);
create index on public.client_payments(project_id);
create index on public.client_payments(invoice_id);

alter table public.client_invoices enable row level security;
alter table public.client_payments enable row level security;
grant select, insert, update, delete on public.client_invoices, public.client_payments to authenticated;

create policy ci_read on public.client_invoices for select to authenticated
  using ((select public.my_role()) in ('finance','owner','gm','admin'));
create policy ci_ins on public.client_invoices for insert to authenticated
  with check ((select public.my_role()) in ('finance','admin') and created_by = (select auth.uid()));
create policy ci_upd on public.client_invoices for update to authenticated
  using ((select public.my_role()) in ('finance','admin'));
create policy ci_del on public.client_invoices for delete to authenticated
  using ((select public.my_role()) = 'admin');

create policy cp_read on public.client_payments for select to authenticated
  using ((select public.my_role()) in ('finance','owner','gm','admin'));
create policy cp_ins on public.client_payments for insert to authenticated
  with check ((select public.my_role()) in ('finance','admin') and created_by = (select auth.uid()));
create policy cp_upd on public.client_payments for update to authenticated
  using ((select public.my_role()) in ('finance','admin'));
create policy cp_del on public.client_payments for delete to authenticated
  using ((select public.my_role()) = 'admin');

-- A payment must belong to the same project as its invoice.
create or replace function public.check_payment_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.invoice_id is not null and not exists (select 1 from public.client_invoices where id = new.invoice_id and project_id = new.project_id) then
    raise exception 'الفاتورة مو من نفس المشروع';
  end if;
  return new;
end $$;
create trigger client_payments_check before insert or update on public.client_payments
  for each row execute function public.check_payment_invoice();

create trigger audit_client_invoices after insert or update or delete on public.client_invoices
  for each row execute function public.audit_row();
create trigger audit_client_payments after insert or update or delete on public.client_payments
  for each row execute function public.audit_row();
