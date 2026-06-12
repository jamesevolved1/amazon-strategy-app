-- Slice B: extend amazon_connections with a pending_reports list and a place
-- to stash the latest ingested data per (user × app client).
--
-- pending_reports holds in-flight Amazon report requests. Shape:
--   [
--     {
--       reportId: string,           -- Amazon report id
--       profileId: number,          -- Amazon profile id
--       adProduct: 'SP'|'SB'|'SD',  -- abbreviated
--       status: 'PENDING'|'IN_PROGRESS'|'COMPLETED'|'FAILED'|'INGESTED',
--       requestedAt: string (ISO),
--       startDate: string (YYYY-MM-DD),
--       endDate: string (YYYY-MM-DD),
--       error?: string
--     }, ...
--   ]
--
-- synced_data is the latest BulkCampaignData payload ingested for this client.
-- Shape matches src/utils/parsers.ts BulkCampaignData { campaigns, daily? }.

alter table public.amazon_connections
  add column if not exists pending_reports jsonb not null default '[]';

alter table public.amazon_connections
  add column if not exists synced_data jsonb;

alter table public.amazon_connections
  add column if not exists synced_data_at timestamptz;
