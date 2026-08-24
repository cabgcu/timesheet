-- Canyon Activities Board Timesheet — Supabase Schema
-- Run this once in the Supabase SQL editor, then re-run setupDatabase() equivalent
-- (just insert the seed settings row below).

create table if not exists settings (
  key   text primary key,
  value text
);

create table if not exists roster (
  id           bigserial primary key,
  academic_year text not null,
  student_id   text not null,
  name         text not null,
  team         text not null,
  unique (academic_year, student_id)
);

-- Email/position are read and written by the admin roster editor
-- (saveAdminChanges in index.html) and are also what the Gotcha app's
-- "Sync Roster" reads student_id/name/team from — added here so a fresh
-- database has them without a manual ALTER TABLE step.
alter table roster add column if not exists email    text;
alter table roster add column if not exists position text;

create table if not exists submissions (
  id            bigserial primary key,
  academic_year text    not null,
  student_id    text    not null,
  student_name  text    not null,
  team          text    not null,
  week_identifier text  not null,
  total_hours   numeric default 0,
  logs_json     text    default '[]',
  created_at    timestamptz default now(),
  unique (academic_year, student_id, week_identifier)
);

create table if not exists drafts (
  id              bigserial primary key,
  student_id      text not null,
  week_identifier text not null,
  logs_json       text default '[]',
  last_updated    timestamptz default now(),
  unique (student_id, week_identifier)
);

-- Allow anon key full access (same trust level as the previous Apps Script)
alter table settings    disable row level security;
alter table roster      disable row level security;
alter table submissions disable row level security;
alter table drafts      disable row level security;

-- Seed default settings (safe to re-run)
insert into settings (key, value) values
  ('AdminPassword', 'admin123'),
  ('ActiveYear',    '2025-2026'),
  ('Teams',         '["Arts Team","CAB Team","Media Team","Street Team"]'),
  ('AcademicYears', '["2024-2025","2025-2026"]')
on conflict (key) do nothing;
