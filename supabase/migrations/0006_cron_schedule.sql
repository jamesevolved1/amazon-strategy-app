-- Schedule the amazon-cron Edge Function to run every 30 minutes.
--
-- BEFORE running this:
--   1. Deploy the amazon-cron Edge Function (JWT verify OFF).
--   2. Set the CRON_SECRET Edge Function secret to a random string.
--   3. Replace REPLACE_WITH_YOUR_CRON_SECRET below with that SAME string.
--
-- Requires the pg_cron and pg_net extensions. Enable them first in the
-- Supabase dashboard: Database -> Extensions -> enable "pg_cron" and "pg_net".
-- (Or the create-extension statements below will enable them if permitted.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any prior schedule with this name (safe to re-run).
select cron.unschedule('amazon-cron-30min')
where exists (select 1 from cron.job where jobname = 'amazon-cron-30min');

-- Run every 30 minutes. The function itself is time-budgeted + idempotent, so
-- it advances each client's report pipeline a little each run and keeps data
-- fresh without any manual Sync.
select cron.schedule(
  'amazon-cron-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := 'https://txksmxlttdlzultcbxkf.supabase.co/functions/v1/amazon-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'REPLACE_WITH_YOUR_CRON_SECRET'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- To verify it's scheduled:   select * from cron.job;
-- To see recent runs:         select * from cron.job_run_details order by start_time desc limit 10;
-- To stop it:                 select cron.unschedule('amazon-cron-30min');
