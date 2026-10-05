-- Canyon Activities Board Timesheet — change history + weekly approvals
-- Run this once in the Supabase SQL editor. It is safe to re-run.
--
-- Until it's run, the app simply hides these two features; everything else works.
--
-- audit_log       One row per change to someone's hours: who made it (student, team
--                 lead or admin), what it was before and after. Shown to admins under
--                 "Change History" in a student's detail pop-up.
-- week_approvals  A Director / Assistant Director's review of a team member's week:
--                 approved, or flagged with a note. Hours count either way; the flag
--                 just tells staff to take a look. `hours` is the week's total at the
--                 moment of review, so the app can tell when hours changed afterwards.

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

create table if not exists week_approvals (
  id              bigserial primary key,
  academic_year   text not null,
  student_id      text not null,
  week_identifier text not null,
  status          text not null check (status in ('approved', 'flagged')),
  note            text,
  reviewer        text,
  hours           numeric,
  updated_at      timestamptz default now(),
  unique (academic_year, student_id, week_identifier)
);

-- Same trust level as the existing tables (the app uses the publishable key)
alter table audit_log      disable row level security;
alter table week_approvals disable row level security;
