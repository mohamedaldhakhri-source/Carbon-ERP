-- Project status 'done' (منجز): work finished and handed over, separate from 'closed' (مغلق).
alter table public.projects drop constraint projects_status_check;
alter table public.projects add constraint projects_status_check check (status in ('active','stopped','done','closed'));
