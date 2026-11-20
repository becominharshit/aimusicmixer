-- MixBench v1.0 Supabase Database Schema & Row-Level Security
-- Execute in the Supabase SQL Editor (Dashboard -> SQL Editor -> New Query).

create extension if not exists pgcrypto;

-- 1. User Profiles & Granular Privacy Preferences (All AI & dataset toggles strictly OFF by default)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  default_genre text default 'electronic',
  default_stage text default 'unmastered',
  preferred_daw text default 'Mixit Web DAW',
  default_theme text default 'dark',
  allow_metrics_ai boolean default false not null,
  allow_audio_ai boolean default false not null,
  allow_dataset_retention boolean default false not null,
  updated_at timestamptz default now()
);

alter table public.profiles
  add column if not exists preferred_daw text default 'Mixit Web DAW';
alter table public.profiles
  add column if not exists default_theme text default 'dark';

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
  share_token text unique,
  is_public boolean default false not null,
  checklist_progress jsonb not null default '{}'::jsonb,
  report_json jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Idempotent column upgrades & payload cap for existing deployments
alter table public.analyses
  add column if not exists parent_analysis_id uuid references public.analyses(id) on delete set null;
alter table public.analyses
  add column if not exists proxy_storage_path text;
alter table public.analyses
  add column if not exists share_token text unique;
alter table public.analyses
  add column if not exists is_public boolean default false not null;
alter table public.analyses
  add column if not exists checklist_progress jsonb not null default '{}'::jsonb;
alter table public.analyses
  add column if not exists updated_at timestamptz default now();

-- Database-level payload size cap (<= 512 KB) to prevent JSONB storage bloat / DoS
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'analyses_report_json_size_cap'
      and conrelid = 'public.analyses'::regclass
  ) then
    alter table public.analyses
      add constraint analyses_report_json_size_cap
      check (pg_column_size(report_json) <= 524288);
  end if;
end $$;

drop trigger if exists set_analyses_updated_at on public.analyses;
create trigger set_analyses_updated_at
  before update on public.analyses
  for each row execute procedure public.set_updated_at();

create index if not exists analyses_user_created_idx
  on public.analyses (user_id, created_at desc);

create index if not exists analyses_parent_idx
  on public.analyses (parent_analysis_id);

create unique index if not exists analyses_share_token_idx
  on public.analyses (share_token)
  where share_token is not null;

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

-- 5. Strict Per-User RLS Policies for public.analyses (auth.uid() = user_id ONLY)
-- Broad public SELECT policies are intentionally omitted so anon/other users can NEVER enumerate rows.
-- Public read-only shared links are resolved strictly via exact cryptographic share_token RPC below.
drop policy if exists "analyses_select_own" on public.analyses;
create policy "analyses_select_own"
  on public.analyses for select
  using (auth.uid() = user_id);

drop policy if exists "analyses_select_public_shared" on public.analyses;

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

-- Exact-token public share lookup (redacts user_id and proxy_storage_path; requires exact share_token >= 16 chars)
create or replace function public.get_shared_analysis_by_token(p_share_token text)
returns table (
  id uuid,
  track_name text,
  genre text,
  stage text,
  artist_vision text,
  version_label text,
  share_token text,
  is_public boolean,
  report_json jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    a.id,
    a.track_name,
    a.genre,
    a.stage,
    a.artist_vision,
    a.version_label,
    a.share_token,
    a.is_public,
    a.report_json,
    a.created_at
  from public.analyses a
  where a.is_public = true
    and a.share_token is not null
    and length(trim(p_share_token)) >= 16
    and a.share_token = trim(p_share_token)
  limit 1;
$$;

revoke all on function public.get_shared_analysis_by_token(text) from public;
grant execute on function public.get_shared_analysis_by_token(text) to anon, authenticated;

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

-- 8. Mixit Web DAW Projects (Serialized ProjectState JSON; strict auth.uid() = user_id RLS)
create table if not exists public.daw_projects (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name          text        not null default 'Untitled Project' check (char_length(name) between 1 and 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  project_state jsonb       not null default '{}'::jsonb check (jsonb_typeof(project_state) = 'object')
);

comment on table public.daw_projects is 'Mixit Web DAW projects (serialized ProjectState JSON).';

create index if not exists daw_projects_user_updated_idx
  on public.daw_projects (user_id, updated_at desc);

create or replace function public.daw_projects_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists daw_projects_before_write on public.daw_projects;
create trigger daw_projects_before_write
  before insert or update on public.daw_projects
  for each row execute function public.daw_projects_before_write();

alter table public.daw_projects enable row level security;

drop policy if exists "daw_projects_select_own" on public.daw_projects;
create policy "daw_projects_select_own"
  on public.daw_projects for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "daw_projects_insert_own" on public.daw_projects;
create policy "daw_projects_insert_own"
  on public.daw_projects for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "daw_projects_update_own" on public.daw_projects;
create policy "daw_projects_update_own"
  on public.daw_projects for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "daw_projects_delete_own" on public.daw_projects;
create policy "daw_projects_delete_own"
  on public.daw_projects for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.daw_projects from anon;
grant select, insert, update, delete on public.daw_projects to authenticated;
