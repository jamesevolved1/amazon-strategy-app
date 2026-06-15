-- SP-API (Selling Partner API) connections per (user × app client).
--
-- Separate from amazon_connections (Ads API) because SP-API uses a different
-- LWA app, a different authorization flow (Seller Central consent), and
-- different tokens. Stores the Sales & Traffic report data that gives us
-- total/ordered product sales — the missing piece for TACOS, organic sales,
-- and total-sales projections.
--
-- Run once in the Supabase SQL editor.
--
-- pending_reports shape:
--   [{ reportId, status, requestedAt, startDate, endDate, reportDocumentId?, error? }]
-- synced_data shape:
--   { daily: [{ date, totalSales, orders, units, sessions, pageViews }] }

create table if not exists public.spapi_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  app_client_id text not null,
  app_client_name text,
  selling_partner_id text,
  marketplace_ids text[],
  region text not null default 'NA',          -- NA | EU | FE
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  pending_reports jsonb not null default '[]',
  synced_data jsonb,
  synced_data_at timestamptz,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, app_client_id)
);

alter table public.spapi_connections enable row level security;

drop policy if exists "spapi read own" on public.spapi_connections;
create policy "spapi read own"
  on public.spapi_connections for select
  using (auth.uid() = user_id);

drop policy if exists "spapi insert own" on public.spapi_connections;
create policy "spapi insert own"
  on public.spapi_connections for insert
  with check (auth.uid() = user_id);

drop policy if exists "spapi update own" on public.spapi_connections;
create policy "spapi update own"
  on public.spapi_connections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "spapi delete own" on public.spapi_connections;
create policy "spapi delete own"
  on public.spapi_connections for delete
  using (auth.uid() = user_id);

-- reuse the set_updated_at() trigger function from 0002
drop trigger if exists spapi_connections_set_updated_at on public.spapi_connections;
create trigger spapi_connections_set_updated_at
  before update on public.spapi_connections
  for each row execute function public.set_updated_at();
