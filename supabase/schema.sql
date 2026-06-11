-- Amazon Strategy app schema.
-- Run this once in the Supabase SQL editor.
-- The app stores its full state as a single JSON document keyed by id='singleton'
-- per authenticated user. RLS scopes rows to the owning user.

create extension if not exists pgcrypto;

create table if not exists public.app_state (
  id text not null,
  user_id uuid not null default auth.uid(),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

alter table public.app_state enable row level security;

drop policy if exists "app_state read own" on public.app_state;
create policy "app_state read own"
  on public.app_state for select
  using (auth.uid() = user_id);

drop policy if exists "app_state write own" on public.app_state;
create policy "app_state write own"
  on public.app_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "app_state update own" on public.app_state;
create policy "app_state update own"
  on public.app_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "app_state delete own" on public.app_state;
create policy "app_state delete own"
  on public.app_state for delete
  using (auth.uid() = user_id);

-- Optional: an audit log of report uploads (the actual file bytes never leave the browser).
create table if not exists public.report_upload_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_name text not null,
  report_key text not null,
  file_name text not null,
  row_count integer,
  uploaded_at timestamptz not null default now()
);

alter table public.report_upload_log enable row level security;

drop policy if exists "log read own" on public.report_upload_log;
create policy "log read own"
  on public.report_upload_log for select
  using (auth.uid() = user_id);

drop policy if exists "log write own" on public.report_upload_log;
create policy "log write own"
  on public.report_upload_log for insert
  with check (auth.uid() = user_id);
