-- Canyon Activities Board Timesheet — change history
-- Run this once in the Supabase SQL editor. It is safe to re-run.
--
-- Until it's run, the app simply hides change history; everything else works.
--
-- audit_log  One row per change to someone's hours: who made it (student or admin),
--            what it was before and after. Shown to admins under "Change History"
--            in a student's detail pop-up.

create table if not exists audit_log (
  id              bigserial primary key,
  created_at      timestamptz default now(),
  academic_year   text,
  student_id      text not null,
  week_identifier text,
  actor           text,
  action          text not null,
  details         text
);

create index if not exists audit_log_student_idx on audit_log (student_id, created_at desc);

-- Same trust level as the existing tables (the app uses the publishable key)
alter table audit_log disable row level security;
