-- =============================================================================
-- MixLearn Web DAW: project storage
-- Run once in the Supabase SQL editor (or as a migration).
--
-- Only the lightweight project JSON lives here. Audio bytes stay in the user's
-- browser (IndexedDB), so there are no storage-bucket limits to manage.
-- =============================================================================

create table if not exists public.daw_projects (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name          text        not null default 'Untitled Project' check (char_length(name) between 1 and 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  project_state jsonb       not null default '{}'::jsonb check (jsonb_typeof(project_state) = 'object')
);

comment on table public.daw_projects is 'MixLearn Web DAW projects (serialized ProjectState JSON).';

create index if not exists daw_projects_user_updated_idx
  on public.daw_projects (user_id, updated_at desc);

-- Keep updated_at fresh and make user_id immutable.
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

-- -----------------------------------------------------------------------------
-- Row-Level Security: a user can only ever see and touch their own projects.
-- -----------------------------------------------------------------------------
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

-- No anonymous access; signed-in users get CRUD (RLS still filters every row).
revoke all on public.daw_projects from anon;
grant select, insert, update, delete on public.daw_projects to authenticated;
