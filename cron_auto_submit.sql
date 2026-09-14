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
  d              record;
  r_name         text;
  r_team         text;
  existing_logs  jsonb;
  merged_logs    jsonb;
  merged_total   numeric;
begin
  select value into active_year from settings where key = 'ActiveYear';
  -- America/Phoenix has no DST, so this is a stable "Monday of the current week" cutoff.
  current_monday := date_trunc('week', (now() at time zone 'America/Phoenix'))::date;

  -- Convert every draft older than the current week into an official submission.
  -- If a submission for that week already exists (e.g. an admin added an entry
  -- while the week was still in progress), merge the draft's logs into it instead
  -- of discarding them — ON CONFLICT DO NOTHING used to let the admin's smaller
  -- entry silently win, dropping everything the student had actually logged and
  -- wrongly flagging them as under their minimum hours.
  for d in
    select student_id, week_identifier, logs_json
    from drafts
    where week_identifier::date < current_monday
      and jsonb_array_length(logs_json::jsonb) > 0
  loop
    select name, team into r_name, r_team
    from roster
    where student_id = d.student_id
      and academic_year = coalesce(active_year, '');

    select logs_json::jsonb into existing_logs
    from submissions
    where academic_year = coalesce(active_year, '')
      and student_id = d.student_id
      and week_identifier = d.week_identifier;

    merged_logs := coalesce(existing_logs, '[]'::jsonb) || d.logs_json::jsonb;

    select coalesce(sum((elem->>'hours')::numeric), 0) into merged_total
    from jsonb_array_elements(merged_logs) elem;

    insert into submissions (academic_year, student_id, student_name, team, week_identifier, total_hours, logs_json)
    values (
      coalesce(active_year, ''),
      d.student_id,
      coalesce(r_name, ''),
      coalesce(r_team, ''),
      d.week_identifier,
      merged_total,
      merged_logs::text
    )
    on conflict (academic_year, student_id, week_identifier) do update
      set total_hours = excluded.total_hours,
          logs_json    = excluded.logs_json;
  end loop;

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
