-- The contract value can be entered by hand (a lump-sum contract, or before the BOQ is in).
-- Empty means the value is the total of the BOQ items, as before.
alter table public.projects add column if not exists contract_value numeric(14,3) check (contract_value is null or contract_value >= 0);
