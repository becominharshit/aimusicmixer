-- MixBench v1.0 Supabase Database Schema & Row-Level Security
-- Execute in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query).

create extension if not exists pgcrypto;

-- 1. User Profiles & Granular Privacy Preferences (All AI & dataset toggles strictly OFF by default)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  default_genre text default 'electronic',
  default_stage text default 'unmastered',
  allow_metrics_ai boolean default false not null,
  allow_audio_ai boolean default false not null,
  allow_dataset_retention boolean default false not null,
  updated_at timestamptz default now()
);

-- 2. Saved Mix & Revision Analyses (Stores canonical AnalysisReport v1.0 JSON telemetry)
create table if not exists public.analyses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  track_name text not null,
  genre text not null,
  stage text not null,
  artist_vision text,
  version_label text default 'v1',
  report_json jsonb not null,
  created_at timestamptz default now()
);

create index if not exists analyses_user_created_idx
  on public.analyses (user_id, created_at desc);

-- 3. Enable Row-Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.analyses enable row level security;

-- 4. RLS Policies for public.profiles (auth.uid() = id)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  using (auth.uid() = id);

-- 5. RLS Policies for public.analyses (auth.uid() = user_id)
drop policy if exists "analyses_select_own" on public.analyses;
create policy "analyses_select_own"
  on public.analyses for select
  using (auth.uid() = user_id);

drop policy if exists "analyses_insert_own" on public.analyses;
create policy "analyses_insert_own"
  on public.analyses for insert
  with check (auth.uid() = user_id);

drop policy if exists "analyses_update_own" on public.analyses;
create policy "analyses_update_own"
  on public.analyses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "analyses_delete_own" on public.analyses;
create policy "analyses_delete_own"
  on public.analyses for delete
  using (auth.uid() = user_id);

-- 6. Automatically provision a privacy-first profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    allow_metrics_ai,
    allow_audio_ai,
    allow_dataset_retention
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    false,
    false,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
