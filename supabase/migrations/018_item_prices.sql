-- GM, owner and admin may correct quantities and unit rates of BOQ items (the total follows qty x rate).
create or replace function public.set_item_prices(p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; q numeric; rt numeric;
begin
  if public.my_role() not in ('gm','owner','admin') then raise exception 'تعديل الأسعار للمدير العام وصاحب الشركة'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    q := (r->>'qty')::numeric; rt := (r->>'rate')::numeric;
    if q is null or q < 0 or rt is null or rt < 0 then raise exception 'الكمية والسعر لازم أرقام موجبة'; end if;
    update public.boq_items set qty = q, rate = rt, total = round(q * rt, 3) where id = (r->>'id')::uuid;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.set_item_prices(jsonb) to authenticated;
