-- Carbon ERP: full database setup. Paste this whole file into Supabase SQL Editor and press Run, once.

-- Carbon ERP: core schema, row level security and workflow functions.

-- ---------- users ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role text not null default 'pending'
    check (role in ('pending','owner','gm','head','site','procurement','finance')),
  dept text check (dept in ('arch','interior','fitout','joinery','contracting','supervision')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The very first account becomes the owner; everyone after waits for activation.
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email,
          case when exists (select 1 from public.profiles) then 'pending' else 'owner' end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role <> 'pending' from public.profiles where id = (select auth.uid())), false)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('owner','gm') from public.profiles where id = (select auth.uid())), false)
$$;

-- ---------- projects ----------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text not null,
  client text not null default '',
  type text not null check (type in ('gov','private')),
  depts text[] not null default '{}',
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active','stopped','closed')),
  stop_reason text,
  vat numeric not null default 5,
  created_at timestamptz not null default now()
);

create table public.boq_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  name text not null,
  sort int not null default 0
);
create index on public.boq_sections(project_id);

create table public.boq_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section_code text not null,
  code text not null,
  description text not null,
  qty numeric not null default 1,
  unit text not null default '',
  rate numeric not null default 0,
  total numeric not null default 0,
  progress int not null default 0 check (progress between 0 and 100),
  prior_spent numeric not null default 0,
  sort int not null default 0
);
create index on public.boq_items(project_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  is_phase boolean not null default false,
  sort int not null default 0
);
create index on public.tasks(project_id);

-- ---------- material requests ----------
create sequence public.req_seq start 1001;
create sequence public.po_seq start 1;
create table public.material_requests (
  id uuid primary key default gen_random_uuid(),
  no text not null unique default ('REQ-' || nextval('public.req_seq')),
  project_id uuid not null references public.projects(id) on delete cascade,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  dept text not null,
  requested_by uuid references public.profiles(id) default auth.uid(),
  need_by date,
  note text,
  stage text not null default 'dept' check (stage in ('dept','procurement','finance','gm','po','done','rejected')),
  po_no text,
  po_date date,
  created_at timestamptz not null default now()
);
create index on public.material_requests(project_id);

create table public.request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests(id) on delete cascade,
  description text not null,
  qty numeric not null default 1,
  unit text not null default ''
);
create index on public.request_items(request_id);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests(id) on delete cascade,
  supplier text not null,
  amount numeric not null,
  terms text not null check (terms in ('advance','credit30')),
  delivery_days int not null default 0,
  selected boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.quotes(request_id);

create table public.request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests(id) on delete cascade,
  actor uuid references public.profiles(id),
  actor_name text,
  role text,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);
create index on public.request_history(request_id);

-- ---------- petty cash ----------
create sequence public.pc_seq start 1;
create table public.petty_cash (
  id uuid primary key default gen_random_uuid(),
  no text not null unique default ('PC-' || lpad(nextval('public.pc_seq')::text, 4, '0')),
  project_id uuid not null references public.projects(id) on delete cascade,
  boq_item_id uuid references public.boq_items(id) on delete set null,
  amount numeric not null check (amount > 0),
  description text not null,
  receipt_path text,
  requested_by uuid references public.profiles(id) default auth.uid(),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index on public.petty_cash(project_id);

-- ---------- variations ----------
create sequence public.vo_seq start 1;
create table public.variations (
  id uuid primary key default gen_random_uuid(),
  no text not null unique default ('VO-' || lpad(nextval('public.vo_seq')::text, 3, '0')),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text not null default '',
  amount numeric not null default 0,
  approval_path text,
  client_status text not null default 'pending' check (client_status in ('pending','approved')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.variations(project_id);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.boq_sections enable row level security;
alter table public.boq_items enable row level security;
alter table public.tasks enable row level security;
alter table public.material_requests enable row level security;
alter table public.request_items enable row level security;
alter table public.quotes enable row level security;
alter table public.request_history enable row level security;
alter table public.petty_cash enable row level security;
alter table public.variations enable row level security;

-- Everyone with an active account sees the company data; a pending account sees only itself.
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_active()));

do $$ declare t text; begin
  foreach t in array array['projects','boq_sections','boq_items','tasks','material_requests','request_items','quotes','request_history','petty_cash','variations'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using ((select public.is_active()))', t);
  end loop;
end $$;

-- Owner / GM manage projects, BOQ and timeline.
do $$ declare t text; begin
  foreach t in array array['projects','boq_sections','boq_items','tasks'] loop
    execute format('create policy %1$s_admin_ins on public.%1$s for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('create policy %1$s_admin_upd on public.%1$s for update to authenticated using ((select public.is_admin()))', t);
    execute format('create policy %1$s_admin_del on public.%1$s for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

-- Creating requests, petty cash and variations: any active user, as themselves, at the first step.
create policy mr_insert on public.material_requests for insert to authenticated
  with check ((select public.is_active()) and requested_by = (select auth.uid()) and stage = 'dept');
create policy ri_insert on public.request_items for insert to authenticated
  with check (exists (select 1 from public.material_requests r where r.id = request_id and r.requested_by = (select auth.uid()) and r.stage = 'dept'));
create policy pc_insert on public.petty_cash for insert to authenticated
  with check ((select public.is_active()) and requested_by = (select auth.uid()) and status = 'pending');
create policy vo_insert on public.variations for insert to authenticated
  with check ((select public.is_active()) and created_by = (select auth.uid()));
-- Variations: the creator or owner/GM can attach the client approval.
create policy vo_update on public.variations for update to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));
-- Procurement manages quotes while the request is at its step.
create policy q_ins on public.quotes for insert to authenticated
  with check ((select public.my_role()) = 'procurement' and exists (select 1 from public.material_requests r where r.id = request_id and r.stage = 'procurement'));
create policy q_upd on public.quotes for update to authenticated
  using ((select public.my_role()) = 'procurement' and exists (select 1 from public.material_requests r where r.id = request_id and r.stage = 'procurement'));
create policy q_del on public.quotes for delete to authenticated
  using ((select public.my_role()) = 'procurement' and exists (select 1 from public.material_requests r where r.id = request_id and r.stage = 'procurement'));

-- ---------- workflow functions ----------
create or replace function public.log_request(p_req uuid, p_action text, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into public.request_history (request_id, actor, actor_name, role, action, note)
  select p_req, p.id, p.full_name, p.role, p_action, nullif(p_note,'')
  from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function public.log_request_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.log_request(new.id, 'أنشأ الطلب', null);
  return new;
end $$;
create trigger mr_created after insert on public.material_requests
  for each row execute function public.log_request_created();

-- Move a request one step forward. Each step can only be taken by its role.
create or replace function public.advance_request(p_req uuid, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles; nxt text; act text;
begin
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if r.stage = 'dept' and me.role = 'head' and (me.dept is null or me.dept = r.dept) then
    nxt := 'procurement'; act := 'وافق رئيس القسم';
  elsif r.stage = 'procurement' and me.role = 'procurement' then
    if not exists (select 1 from public.quotes where request_id = p_req and selected) then
      raise exception 'اختر عرض سعر أولاً'; end if;
    nxt := 'finance'; act := 'سجّل عروض الأسعار وأرسل للمالية';
  elsif r.stage = 'finance' and me.role = 'finance' then
    nxt := 'gm'; act := 'وافقت المالية';
  elsif r.stage = 'gm' and me.role = 'gm' then
    nxt := 'po'; act := 'اعتمد المدير العام';
  elsif r.stage = 'po' and me.role = 'procurement' then
    nxt := 'done';
    update public.material_requests
      set po_no = 'PO-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.po_seq')::text,4,'0'), po_date = current_date
      where id = p_req;
    select 'أصدر أمر الشراء ' || po_no || ' وأرسله للمورّد' into act from public.material_requests where id = p_req;
  else
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  update public.material_requests set stage = nxt where id = p_req;
  perform public.log_request(p_req, act, p_note);
  return nxt;
end $$;

create or replace function public.reject_request(p_req uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.material_requests; me public.profiles;
begin
  if coalesce(trim(p_note),'') = '' then raise exception 'اكتب سبب الرفض'; end if;
  select * into r from public.material_requests where id = p_req for update;
  select * into me from public.profiles where id = (select auth.uid());
  if not ((r.stage = 'dept' and me.role = 'head' and (me.dept is null or me.dept = r.dept))
       or (r.stage = 'procurement' and me.role = 'procurement')
       or (r.stage = 'finance' and me.role = 'finance')
       or (r.stage = 'gm' and me.role = 'gm')) then
    raise exception 'هذه الخطوة ليست من صلاحيتك';
  end if;
  update public.material_requests set stage = 'rejected' where id = p_req;
  perform public.log_request(p_req, 'رفض ' || case me.role when 'head' then 'رئيس القسم' when 'procurement' then 'المشتريات' when 'finance' then 'المالية' else 'المدير العام' end, p_note);
end $$;

create or replace function public.decide_petty(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'gm' then raise exception 'اعتماد البيتي كاش للمدير العام فقط'; end if;
  update public.petty_cash
    set status = case when p_approve then 'approved' else 'rejected' end,
        decided_by = (select auth.uid()), decided_at = now(), decision_note = p_note
    where id = p_id and status = 'pending';
end $$;

create or replace function public.set_progress(p_item uuid, p_progress int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('site','head','gm','owner') then raise exception 'تحديث الإنجاز لمهندس الموقع ورئيس القسم'; end if;
  update public.boq_items set progress = greatest(0, least(100, p_progress)) where id = p_item;
end $$;

create or replace function public.set_user_role(p_user uuid, p_role text, p_dept text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'إدارة المستخدمين لصاحب الشركة والمدير العام'; end if;
  update public.profiles set role = p_role, dept = nullif(p_dept,'') where id = p_user;
end $$;

create or replace function public.update_my_name(p_name text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set full_name = p_name where id = (select auth.uid());
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.log_request_created() from public, anon, authenticated;
revoke execute on function public.log_request(uuid,text,text) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['my_role()','is_active()','is_admin()','advance_request(uuid,text)','reject_request(uuid,text)','decide_petty(uuid,boolean,text)','set_progress(uuid,int)','set_user_role(uuid,text,text)','update_my_name(text)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- ---------- file storage (receipts, client approvals) ----------
insert into storage.buckets (id, name, public) values ('attachments','attachments', false)
  on conflict (id) do nothing;
create policy att_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (select public.is_active()));
create policy att_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (select public.is_active()));

-- Seed: Specialized Incubators project from the client's BOQ and timeline (progress and spend start at 0).
do $$ declare pid uuid; begin
insert into public.projects (name, short_name, client, type, depts, start_date, end_date, vat)
values ('تصميم وتنفيذ الحاضنات المتخصصة في الصناعات الحرفية الإبداعية', 'الحاضنات الحرفية', 'هيئة تنمية المؤسسات الصغيرة والمتوسطة (ريادة)', 'gov', array['arch','interior','fitout','joinery','contracting','supervision'], '2026-04-16', '2026-10-28', 5) returning id into pid;
insert into public.boq_sections (project_id, code, name, sort) values (pid, '1', 'التمهيدات', 0);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '2', 'أعمال التصميم', 1);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '3', 'الأعمال الإنشائية', 2);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '4', 'أعمال التشطيبات', 3);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '5', 'الديكور الداخلي', 4);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '6', 'أعمال التكييف', 5);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '7', 'الأعمال الكهربائية', 6);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '8', 'الأمن والسلامة والشبكات', 7);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '9', 'مكافحة الحريق', 8);
insert into public.boq_sections (project_id, code, name, sort) values (pid, '10', 'أعمال متفرقة', 9);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '1', '1.1', 'التمهيدات (التجهيز والإخلاء)', 1, 'مقطوعية', 2000, 2000, 0);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.1', 'التصميم المعماري المبدئي واعتماده من المالك', 1, 'مقطوعية', 3000, 3000, 1);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.2', 'المخططات المعمارية التفصيلية', 1, 'مقطوعية', 300, 300, 2);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.3', 'التصميم والتحليل الإنشائي', 1, 'مقطوعية', 600, 600, 3);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.4', 'مخططات الكهرباء', 1, 'مقطوعية', 600, 600, 4);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.5', 'مخططات التكييف والميكانيك', 1, 'مقطوعية', 300, 300, 5);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.6', 'مخطط ومواصفات التشطيبات الداخلية', 1, 'مقطوعية', 200, 200, 6);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.7', 'إعداد جدول كميات تفصيلي', 1, 'مقطوعية', 300, 300, 7);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.8', 'المخططات التنفيذية (Shop Drawings)', 1, 'مقطوعية', 300, 300, 8);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.9', 'تقديم التصاميم للبلدية والدفاع المدني', 1, 'مقطوعية', 300, 300, 9);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.10', 'زيارات الإشراف على التصميم (4 مراحل)', 1, 'مقطوعية', 3600, 3600, 10);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '2', '2.11', 'مخططات As-Built وكتيبات التشغيل', 1, 'مقطوعية', 400, 400, 11);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '3', '3.1', 'أعمدة حديد HEB / HSS', 4, 'طن', 1217, 4867, 12);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '3', '3.2', 'جسور رئيسية IPE 300', 4, 'طن', 1182, 4728, 13);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '3', '3.3', 'جسور ثانوية IPE 200', 2, 'طن', 2016, 4032, 14);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '3', '3.4', 'ألواح ديك مجلفنة 1.2 مم', 230, 'م²', 17, 3963, 15);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '3', '3.5', 'خرسانة خفيفة 100 مم فوق الديك', 23, 'م³', 170, 3910, 16);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '4', '4.1.1', 'أرضية إيبوكسي - الطابق الأرضي', 406, 'م²', 35, 14114, 17);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '4', '4.1.2', 'أرضية إيبوكسي - الميزانين', 230, 'م²', 35, 7995, 18);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '4', '4.2.1', 'لياسة الجدران الداخلية', 600, 'م²', 13, 7509, 19);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '4', '4.2.2', 'معجون وأساس ودهان الجدران', 600, 'م²', 6, 3754, 20);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '4', '4.2.3', 'دهان السقف المكشوف والدكت', 636, 'م²', 9, 5773, 21);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.1', 'قواطع زجاج سيكوريت 10-12 مم', 255, 'م²', 41, 10429, 22);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.2', 'أبواب زجاج مفردة 12 مم', 13, 'عدد', 202, 2621, 23);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.3', 'أبواب زجاج مزدوجة', 4, 'عدد', 358, 1432, 24);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.4', 'أرضيات فينيل LVT', 100, 'م²', 33, 3337, 25);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.5', 'تكسية جدران خشبية', 60, 'م²', 63, 3754, 26);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.6', 'كاونتر الاستقبال', 1, 'عدد', 3441, 3441, 27);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.7', 'ورق جدران', 45, 'م²', 21, 939, 28);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.8', 'اللوحات الإرشادية', 30, 'عدد', 21, 626, 29);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.9', 'ستائر رول', 80, 'م²', 21, 1669, 30);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '5', '5.10', 'نباتات صناعية وأحواض', 20, 'م²', 118, 2364, 31);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '6', '6.1', 'دكت مجلفن رئيسي وفرعي', 180, 'م²', 49, 8899, 32);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '6', '6.2', 'وصلات دكت مرنة', 40, 'عدد', 27, 1097, 33);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '6', '6.3', 'مخارج هواء 60×60', 45, 'عدد', 77, 3476, 34);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '6', '6.4', 'دامبرات تحكم VCD', 12, 'عدد', 127, 1530, 35);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '7', '7.1', 'نقاط القوى والإنارة والمفاتيح', 1, 'مجموعة', 10981, 10981, 36);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '7', '7.5', 'وحدات الإنارة LED والأفياش', 1, 'مجموعة', 7464, 7464, 37);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '7', '7.6', 'لوحات التوزيع والتأريض والكيبل الرئيسي', 1, 'مجموعة', 6968, 6968, 38);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '7', '7.9', 'أعمال مساندة ومخططات واختبارات', 1, 'مجموعة', 5771, 5771, 39);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '8', '8.1', 'نقاط الشبكة والكاميرات والدخول', 1, 'مجموعة', 16102, 16102, 40);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '8', '8.3', 'نظام كاميرات المراقبة CCTV', 1, 'مجموعة', 5284, 5284, 41);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '8', '8.4', 'أجهزة الدخول والبصمة والواي فاي', 1, 'مجموعة', 3615, 3615, 42);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '9', '9.1', 'نقاط إنذار الحريق', 1, 'مجموعة', 3795, 3795, 43);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '9', '9.2', 'ملحقات ولوحة إنذار الحريق', 1, 'مجموعة', 3735, 3735, 44);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '9', '9.3', 'طفايات الحريق', 12, 'عدد', 77, 919, 45);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '10', '10.1.1', 'وحدات FCU', 10, 'عدد', 1053, 10530, 46);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '10', '10.1.2', 'مراوح شفط', 5, 'عدد', 127, 633, 47);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '10', '10.1.3', 'تمديدات الغاز', 20, 'عدد', 14, 278, 48);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '10', '10.1.4', 'أعمال تعديل حسب تعليمات المهندس', 1, 'مقطوعية', 1112, 1112, 49);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '10', '10.1.5', 'جبس بورد', 40, 'م²', 14, 556, 50);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '10', '10.1.6', 'أنابيب غاز', 50, 'م.ط', 14, 695, 51);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '10', '10.1.7', 'سباكة المطبخ', 1, 'مقطوعية', 417, 417, 52);
insert into public.boq_items (project_id, section_code, code, description, qty, unit, rate, total, sort) values (pid, '10', '10.1.8', 'تعديلات ديكورية للسقف والجدران', 10, 'م²', 120, 1200, 53);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'التمهيدات والتجهيز', '2026-04-16', '2026-04-22', true, 0);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'مرحلة التصميم', '2026-04-23', '2026-07-15', true, 1);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'التصميم المعماري المبدئي والاعتماد', '2026-04-23', '2026-05-20', false, 2);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'المخططات المعمارية التفصيلية', '2026-05-21', '2026-05-27', false, 3);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'التصميم الإنشائي', '2026-05-28', '2026-06-05', false, 4);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'مخططات الكهرباء والتكييف', '2026-06-08', '2026-06-23', false, 5);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'جدول الكميات والمخططات التنفيذية', '2026-06-22', '2026-07-01', false, 6);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'تقديم التصاميم للجهات المختصة', '2026-06-22', '2026-07-15', false, 7);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'مرحلة التنفيذ', '2026-06-08', '2026-10-19', true, 8);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'تركيب الهيكل الحديدي', '2026-06-08', '2026-07-03', false, 9);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'التمديدات الأولى (كهرباء، تكييف، حريق، غاز)', '2026-07-06', '2026-07-20', false, 10);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'الخرسانة الخفيفة', '2026-07-16', '2026-07-17', false, 11);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'اللياسة والمعجون', '2026-07-20', '2026-08-04', false, 12);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'أرضيات الإيبوكسي', '2026-08-05', '2026-08-13', false, 13);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'القواطع والأبواب الزجاجية', '2026-08-14', '2026-09-03', false, 14);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'LVT والتكسية الخشبية وورق الجدران', '2026-08-14', '2026-09-03', false, 15);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'كاونتر الاستقبال', '2026-08-14', '2026-09-08', false, 16);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'التمديدات الثانية', '2026-09-09', '2026-09-22', false, 17);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'الدهان النهائي', '2026-09-21', '2026-10-02', false, 18);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'التركيبات النهائية', '2026-10-05', '2026-10-14', false, 19);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'اللوحات والستائر والنباتات', '2026-10-15', '2026-10-19', false, 20);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'الإخلاء والتسليم', '2026-10-15', '2026-10-28', true, 21);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'التنظيف', '2026-10-20', '2026-10-26', false, 22);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'الاختبار والتشغيل', '2026-10-15', '2026-10-26', false, 23);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'مخططات As-Built والضمانات', '2026-10-27', '2026-10-27', false, 24);
insert into public.tasks (project_id, name, start_date, end_date, is_phase, sort) values (pid, 'تسليم المشروع', '2026-10-28', '2026-10-28', false, 25);
end $$;
