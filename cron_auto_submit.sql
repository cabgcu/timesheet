-- Canyon Activities Board Timesheet — Monday-midnight auto-submit
-- Run this once in the Supabase SQL editor. It is safe to re-run.
--
-- Why this exists: relying on a student logging back in to convert their
-- unsubmitted draft into a real submission doesn't work, because the
-- missing-hours email goes out Monday morning regardless of whether anyone
-- has logged in. This creates a scheduled job that runs at 12:00 AM
-- America/Phoenix time every Monday and does the conversion itself, so it
-- always happens before that email check runs — independent of the app.
--
-- Running this script also performs one immediate pass, so any drafts that
-- are currently stuck from past weeks get migrated right away.

create extension if not exists pg_cron;

create or replace function public.auto_submit_stale_drafts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_year    text;
  current_monday date;
begin
  select value into active_year from settings where key = 'ActiveYear';
  -- America/Phoenix has no DST, so this is a stable "Monday of the current week" cutoff.
  current_monday := date_trunc('week', (now() at time zone 'America/Phoenix'))::date;

  -- Convert any draft older than the current week into an official submission.
  -- ON CONFLICT DO NOTHING: if a submission already exists for that week
  -- (e.g. an admin entered it manually), the existing record wins.
  insert into submissions (academic_year, student_id, student_name, team, week_identifier, total_hours, logs_json)
  select
    coalesce(active_year, ''),
    d.student_id,
    coalesce(r.name, ''),
    coalesce(r.team, ''),
    d.week_identifier,
    coalesce((select sum((elem->>'hours')::numeric) from jsonb_array_elements(d.logs_json::jsonb) elem), 0),
    d.logs_json
  from drafts d
  left join roster r
    on r.student_id = d.student_id
   and r.academic_year = coalesce(active_year, '')
  where d.week_identifier::date < current_monday
    and jsonb_array_length(d.logs_json::jsonb) > 0
  on conflict (academic_year, student_id, week_identifier) do nothing;

  -- Every stale draft is now either migrated above or was empty/redundant — clear it.
  delete from drafts
  where week_identifier::date < current_monday;
end;
$$;

-- (Re)schedule the weekly job. 07:00 UTC = 12:00 AM America/Phoenix (no DST to account for).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'auto-submit-stale-drafts-weekly') then
    perform cron.unschedule('auto-submit-stale-drafts-weekly');
  end if;
end $$;

select cron.schedule(
  'auto-submit-stale-drafts-weekly',
  '0 7 * * 1',
  $$select public.auto_submit_stale_drafts();$$
);

-- Run it once now to migrate whatever is currently stuck.
select public.auto_submit_stale_drafts();
