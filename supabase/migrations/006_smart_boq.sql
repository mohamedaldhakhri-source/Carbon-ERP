-- Smart BOQ: each BOQ item belongs to a department, the timeline has a department per task,
-- and the general manager reviews and approves the timeline.
alter table public.boq_items add column dept text
  check (dept in ('arch','interior','fitout','joinery','contracting','supervision'));
alter table public.tasks add column dept text
  check (dept in ('arch','interior','fitout','joinery','contracting','supervision'));

alter table public.projects
  add column schedule_status text not null default 'draft' check (schedule_status in ('draft','approved')),
  add column schedule_approved_by uuid references public.profiles(id) on delete set null,
  add column schedule_approved_at timestamptz,
  add column schedule_note text;

-- Projects that already had a timeline before this feature count as approved.
update public.projects p set schedule_status = 'approved'
  where exists (select 1 from public.tasks t where t.project_id = p.id);

-- Any change to the timeline sends it back to the general manager for review.
create or replace function public.tasks_reset_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.projects
    set schedule_status = 'draft', schedule_approved_by = null, schedule_approved_at = null
    where id = coalesce(new.project_id, old.project_id) and schedule_status = 'approved';
  return null;
end $$;
revoke execute on function public.tasks_reset_approval() from public, anon, authenticated;
create trigger tasks_reset_approval after insert or update or delete on public.tasks
  for each row execute function public.tasks_reset_approval();

-- Only the general manager (or the system admin) approves a timeline.
create or replace function public.approve_schedule(p_project uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() not in ('gm','admin') then raise exception 'اعتماد الجدول الزمني للمدير العام'; end if;
  if not exists (select 1 from public.tasks where project_id = p_project) then raise exception 'الجدول الزمني فاضي'; end if;
  update public.projects
    set schedule_status = 'approved', schedule_approved_by = (select auth.uid()), schedule_approved_at = now(), schedule_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_project;
end $$;
