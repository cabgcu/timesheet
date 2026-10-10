-- Canyon Activities Board Timesheet — disposable camera
-- Run this once in the Supabase SQL editor. It is safe to re-run.
--
-- Until it's run, the app simply hides the camera; everything else works.
--
-- camera_photos  One row per picture. Everyone gets 10 shots per week (Monday–Sunday, AZ time).
--                Each week's roll stays sealed until the next Monday at 12:00 AM, when it
--                develops automatically. An admin can develop the current week early
--                (settings key CameraDeveloped_<week Monday>).
--                note        is the optional note written on the back of the shot.
--                image_path  is where the JPEG lives in the "camera" storage bucket
--                            (<academic year>/<week Monday>/<random id>.jpg, ~100-200 KB each).
--
-- Photos are kept in Supabase Storage (not the database), which has its own free 1 GB.

create table if not exists camera_photos (
  id              bigserial primary key,
  created_at      timestamptz default now(),
  academic_year   text not null,
  week_identifier text,
  student_id      text not null,
  student_name    text not null,
  team            text,
  note            text,
  image_path      text
);

-- For databases that ran an earlier version of this file
alter table camera_photos add column if not exists week_identifier text;
alter table camera_photos add column if not exists note            text;
alter table camera_photos add column if not exists image_path      text;
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'camera_photos' and column_name = 'image') then
    alter table camera_photos alter column image drop not null;
  end if;
end $$;

create index if not exists camera_photos_year_idx on camera_photos (academic_year, week_identifier);
create index if not exists camera_photos_student_idx on camera_photos (academic_year, student_id, week_identifier);

-- Same trust level as the existing tables (the app uses the publishable key)
alter table camera_photos disable row level security;

-- Storage bucket for the photos. Public so the gallery can show them by plain URL, with random
-- file names. Like the tables, it's open to anyone holding the app's publishable key (the app
-- keeps photos sealed, but someone technical could list the bucket early).
-- Only JPEGs up to 2 MB are accepted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('camera', 'camera', true, 2097152, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

-- Let the app upload and delete photos in that bucket (deleting needs select too)
drop policy if exists "camera upload" on storage.objects;
drop policy if exists "camera read"   on storage.objects;
drop policy if exists "camera delete" on storage.objects;
create policy "camera upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'camera');
create policy "camera read"   on storage.objects for select to anon, authenticated using (bucket_id = 'camera');
create policy "camera delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'camera');
