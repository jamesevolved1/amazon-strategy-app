-- Amazon Ads API connections per (user × app client).
--
-- Each row links an authenticated Supabase user + an app-internal client
-- (Red Land Cotton, Volt03, etc.) to an Amazon refresh token plus the latest
-- access token and its expiry. RLS scopes rows to the owning user.
--
-- Run once in the Supabase SQL editor for this project.

create table if not exists public.amazon_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  app_client_id text not null,            -- our app's internal client id (matches state.bundles[id])
  app_client_name text,                   -- snapshot of the client's display name at connect time
  refresh_token text not null,            -- long-lived (Amazon rotates ~yearly)
  access_token text,                      -- short-lived (~1 hour)
  access_token_expires_at timestamptz,
  amazon_profile_ids bigint[],            -- Ads API profile IDs this auth grants access to
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, app_client_id)
);

alter table public.amazon_connections enable row level security;

drop policy if exists "amazon_connections read own" on public.amazon_connections;
create policy "amazon_connections read own"
  on public.amazon_connections for select
  using (auth.uid() = user_id);

drop policy if exists "amazon_connections insert own" on public.amazon_connections;
create policy "amazon_connections insert own"
  on public.amazon_connections for insert
  with check (auth.uid() = user_id);

drop policy if exists "amazon_connections update own" on public.amazon_connections;
create policy "amazon_connections update own"
  on public.amazon_connections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "amazon_connections delete own" on public.amazon_connections;
create policy "amazon_connections delete own"
  on public.amazon_connections for delete
  using (auth.uid() = user_id);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists amazon_connections_set_updated_at on public.amazon_connections;
create trigger amazon_connections_set_updated_at
  before update on public.amazon_connections
  for each row execute function public.set_updated_at();
