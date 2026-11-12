-- Company numbering: CEC-<type>-<YYMM>-<seq>, sequence restarts every month (Oman time).
create table public.doc_counters (
  doc_type text not null,
  period text not null,
  n int not null default 0,
  primary key (doc_type, period)
);
alter table public.doc_counters enable row level security;

create or replace function public.next_doc_no(p_type text, p_width int default 4) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare per text := to_char(now() at time zone 'Asia/Muscat', 'YYMM'); v int;
begin
  insert into public.doc_counters (doc_type, period, n) values (p_type, per, 1)
    on conflict (doc_type, period) do update set n = public.doc_counters.n + 1
    returning n into v;
  return 'CEC-' || p_type || '-' || per || '-' || lpad(v::text, p_width, '0');
end $$;
revoke execute on function public.next_doc_no(text, int) from public, anon;
grant execute on function public.next_doc_no(text, int) to authenticated;

alter table public.projects alter column code set default public.next_doc_no('PRJ', 3);
alter table public.material_requests alter column no set default public.next_doc_no('MR', 4);
alter table public.petty_cash alter column no set default public.next_doc_no('PC', 4);
alter table public.variations alter column no set default public.next_doc_no('VO', 3);

-- Renumber the only existing project to the new format.
update public.projects set code = public.next_doc_no('PRJ', 3) where code = 'CE-2026-001';

create or replace function public.advance_request(p_req uuid, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles; nxt text; act text; adm boolean;
begin
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  adm := me.role = 'admin';
  if r.stage = 'dept' and (adm or (me.role = 'head' and (me.dept is null or me.dept = r.dept))) then
    nxt := 'procurement'; act := 'وافق رئيس القسم';
  elsif r.stage = 'procurement' and (adm or me.role = 'procurement') then
    if not exists (select 1 from public.quotes where request_id = p_req and selected) then
      raise exception 'اختر عرض سعر أولاً'; end if;
    nxt := 'finance'; act := 'سجّل عروض الأسعار وأرسل للمالية';
  elsif r.stage = 'finance' and (adm or me.role = 'finance') then
    nxt := 'gm'; act := 'وافقت المالية';
  elsif r.stage = 'gm' and (adm or me.role = 'gm') then
    nxt := 'po'; act := 'اعتمد المدير العام';
  elsif r.stage = 'po' and (adm or me.role = 'procurement') then
    nxt := 'done';
    update public.material_requests
      set po_no = public.next_doc_no('PO', 4), po_date = (now() at time zone 'Asia/Muscat')::date
      where id = p_req;
    select 'أصدر أمر الشراء ' || po_no || ' وأرسله للمورّد' into act from public.material_requests where id = p_req;
  else
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  if adm then act := act || ' (بواسطة مدير النظام)'; end if;
  update public.material_requests set stage = nxt where id = p_req;
  perform public.log_request(p_req, act, p_note);
  return nxt;
end $$;
