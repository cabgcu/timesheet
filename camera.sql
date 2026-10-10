-- Canyon Activities Board Timesheet — disposable camera
-- Run this once in the Supabase SQL editor. It is safe to re-run.
--
-- Until it's run, the app simply hides the camera; everything else works.
--
-- camera_photos  One row per picture. Each student gets 27 shots per academic year.
--                Photos stay sealed until the admin hits "Develop Now" (settings key
--                CameraDeveloped_<year>) or the develop date passes (CameraDevelopDate_<year>,
--                defaults to May 1 of the year the academic year ends).
--                image holds a compressed JPEG data URL (~100-200 KB).

create table if not exists camera_photos (
  id              bigserial primary key,
  created_at      timestamptz default now(),
  academic_year   text not null,
  student_id      text not null,
  student_name    text not null,
  team            text,
  image           text not null
);

create index if not exists camera_photos_year_idx on camera_photos (academic_year, created_at);
create index if not exists camera_photos_student_idx on camera_photos (academic_year, student_id);

-- Same trust level as the existing tables (the app uses the publishable key)
alter table camera_photos disable row level security;
