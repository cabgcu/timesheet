-- Canyon Activities Board Timesheet — disposable camera
-- Run this once in the Supabase SQL editor. It is safe to re-run.
--
-- Until it's run, the app simply hides the camera; everything else works.
--
-- camera_photos  One row per picture. Everyone gets 10 shots per week (Monday–Sunday, AZ time).
--                Each week's roll stays sealed until the next Monday at 12:00 AM, when it
--                develops automatically. An admin can develop the current week early
--                (settings key CameraDeveloped_<week Monday>).
--                note   is the optional note written on the back of the shot.
--                image  holds a compressed JPEG data URL (~100-200 KB).

create table if not exists camera_photos (
  id              bigserial primary key,
  created_at      timestamptz default now(),
  academic_year   text not null,
  week_identifier text,
  student_id      text not null,
  student_name    text not null,
  team            text,
  note            text,
  image           text not null
);

-- For databases that ran an earlier version of this file
alter table camera_photos add column if not exists week_identifier text;
alter table camera_photos add column if not exists note            text;

create index if not exists camera_photos_year_idx on camera_photos (academic_year, week_identifier);
create index if not exists camera_photos_student_idx on camera_photos (academic_year, student_id, week_identifier);

-- Same trust level as the existing tables (the app uses the publishable key)
alter table camera_photos disable row level security;
