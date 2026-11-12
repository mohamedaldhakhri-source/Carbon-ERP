-- Where the project is: governorate and wilayat in Oman, plus free text for the area or address.
alter table public.projects
  add column governorate text,
  add column wilayat text,
  add column location_note text;
