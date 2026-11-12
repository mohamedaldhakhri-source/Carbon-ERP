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
