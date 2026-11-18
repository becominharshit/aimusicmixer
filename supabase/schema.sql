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

-- Automatic updated_at timestamp trigger for public.profiles
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- 2. Saved Mix & Revision Analyses (Stores canonical AnalysisReport v1.0 JSON telemetry)
create table if not exists public.analyses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  parent_analysis_id uuid references public.analyses(id) on delete set null,
  track_name text not null,
  genre text not null,
  stage text not null,
  artist_vision text,
  version_label text default 'v1',
  proxy_storage_path text,
  report_json jsonb not null,
  created_at timestamptz default now()
);

-- Idempotent column upgrades for existing deployments
alter table public.analyses
  add column if not exists parent_analysis_id uuid references public.analyses(id) on delete set null;
alter table public.analyses
  add column if not exists proxy_storage_path text;

create index if not exists analyses_user_created_idx
  on public.analyses (user_id, created_at desc);

create index if not exists analyses_parent_idx
  on public.analyses (parent_analysis_id);

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

-- 7. Private Supabase Storage Bucket (mix-proxies) for persisted compressed .m4a playback proxies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mix-proxies',
  'mix-proxies',
  false,
  15728640,
  array['audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/mpeg']
)
on conflict (id) do nothing;

drop policy if exists "mix_proxies_select_own" on storage.objects;
create policy "mix_proxies_select_own"
  on storage.objects for select
  using (
    bucket_id = 'mix-proxies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "mix_proxies_insert_own" on storage.objects;
create policy "mix_proxies_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'mix-proxies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "mix_proxies_update_own" on storage.objects;
create policy "mix_proxies_update_own"
  on storage.objects for update
  using (
    bucket_id = 'mix-proxies'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'mix-proxies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "mix_proxies_delete_own" on storage.objects;
create policy "mix_proxies_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'mix-proxies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
