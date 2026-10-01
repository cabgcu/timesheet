-- Canyon Activities Board Timesheet — remove the "pending" (draft) system
-- Run this once in the Supabase SQL editor. It is safe to re-run.
--
-- Hours are now written straight into `submissions` the moment a student adds
-- them, and a new week simply starts every Monday at 12:00 AM (AZ). There is no
-- longer a draft that has to be converted into a submission when the week ends,
-- so the Monday-midnight auto-submit job is no longer needed — and it was the
-- source of hours being doubled right after Sunday 11:59 PM (the browser and the
-- job both converted the same draft and merged it into the same week).
--
-- This script:
--   1. Removes the Monday-midnight auto-submit cron job and its function.
--   2. Folds any drafts still sitting in the `drafts` table into their week's
--      submission (deduped by entry id) and clears them.
--   3. Removes duplicate entries from every existing submission and recomputes
--      total_hours, fixing weeks that were already doubled.
--
-- The `drafts` table itself is left in place (empty) so nothing that still
-- references it breaks; the app no longer reads or writes it.

-- 1. Stop the weekly auto-submit job.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'auto-submit-stale-drafts-weekly') then
      perform cron.unschedule('auto-submit-stale-drafts-weekly');
    end if;
  end if;
end $$;

drop function if exists public.auto_submit_stale_drafts();

-- Identity of one log entry: its id, falling back to date+hours+task for entries without one.
create or replace function public.ts_log_key(elem jsonb)
returns text
language sql
immutable
as $$
  select coalesce(elem->>'id', (elem->>'date') || '_' || (elem->>'hours') || '_' || (elem->>'task'));
$$;

-- Keeps the first occurrence of each entry (by ts_log_key), preserving order.
create or replace function public.ts_dedupe_logs(logs jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
  from (
    select elem, ord,
           row_number() over (partition by public.ts_log_key(elem) order by ord) as rn
    from jsonb_array_elements(coalesce(logs, '[]'::jsonb)) with ordinality as t(elem, ord)
  ) x
  where rn = 1;
$$;

-- 2. Fold leftover drafts into submissions.
do $$
declare
  active_year text;
  d           record;
  r_name      text;
  r_team      text;
  existing    jsonb;
  merged      jsonb;
begin
  select value into active_year from settings where key = 'ActiveYear';

  for d in
    select student_id, week_identifier, logs_json
    from drafts
    where jsonb_array_length(coalesce(nullif(logs_json, ''), '[]')::jsonb) > 0
  loop
    select name, team into r_name, r_team
    from roster
    where student_id = d.student_id
      and academic_year = coalesce(active_year, '');

    select logs_json::jsonb into existing
    from submissions
    where academic_year = coalesce(active_year, '')
      and student_id = d.student_id
      and week_identifier = d.week_identifier;

    merged := public.ts_dedupe_logs(coalesce(existing, '[]'::jsonb) || d.logs_json::jsonb);

    insert into submissions (academic_year, student_id, student_name, team, week_identifier, total_hours, logs_json)
    values (
      coalesce(active_year, ''),
      d.student_id,
      coalesce(r_name, ''),
      coalesce(r_team, ''),
      d.week_identifier,
      (select coalesce(sum((e->>'hours')::numeric), 0) from jsonb_array_elements(merged) e),
      merged::text
    )
    on conflict (academic_year, student_id, week_identifier) do update
      set total_hours = excluded.total_hours,
          logs_json   = excluded.logs_json;
  end loop;

  delete from drafts;
end $$;

-- 3. Remove duplicate entries from existing submissions and fix their totals.
update submissions s
set logs_json   = deduped.logs::text,
    total_hours = deduped.total
from (
  select id,
         public.ts_dedupe_logs(coalesce(nullif(logs_json, ''), '[]')::jsonb) as logs,
         (select coalesce(sum((e->>'hours')::numeric), 0)
            from jsonb_array_elements(public.ts_dedupe_logs(coalesce(nullif(logs_json, ''), '[]')::jsonb)) e) as total
  from submissions
) deduped
where s.id = deduped.id
  and (jsonb_array_length(deduped.logs) <> jsonb_array_length(coalesce(nullif(s.logs_json, ''), '[]')::jsonb)
       or s.total_hours is distinct from deduped.total);
