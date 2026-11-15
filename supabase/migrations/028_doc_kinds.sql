-- Project document kinds: AutoCAD drawings, municipality-approved drawings and 3D models (Mohamed, 2026-11-15).
alter table public.project_docs drop constraint project_docs_kind_check;
alter table public.project_docs add constraint project_docs_kind_check
  check (kind in ('contract','boq','drawing','cad','municipality','model3d','ministry','other'));
