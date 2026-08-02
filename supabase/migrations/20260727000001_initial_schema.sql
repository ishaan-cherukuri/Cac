-- Initial schema — SPEC section 6.
--
-- Deliberately minimal. There is no `attempts` table: SPEC section 6 forbids persisting
-- per-turn transcriptions until there is a product reason. Per-turn data goes to PostHog.
--
-- Delayed signup (SPEC section 3.2) shapes this schema more than anything else. The user
-- completes session 1 BEFORE an account is requested, so a session must be able to exist
-- before a "real" account does. We use Supabase anonymous auth: every user gets an
-- auth.users row immediately, and signing up later links an email to that same id rather
-- than creating a second one. That keeps user_id non-null and avoids an orphan-session
-- migration path.

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- users
-- --------------------------------------------------------------------------

create type self_assessed_level as enum ('understand_only', 'some_speaking', 'improving');
create type subscription_status as enum ('trial', 'active', 'expired');

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Null until the user signs up. Anonymous users have no email, by design.
  email text unique,

  target_language text not null default 'te',
  self_assessed_level self_assessed_level,

  subscription_status subscription_status not null default 'trial',

  -- SPEC section 3.5: three free sessions, then a hard paywall. The client counts too,
  -- but the client can be reinstalled; this is the copy that decides entitlement.
  free_sessions_used integer not null default 0,

  -- SPEC section 3.6: one notification per day maximum, user can disable.
  notifications_enabled boolean not null default true,

  created_at timestamptz not null default now(),

  constraint target_language_is_launch_language check (target_language = 'te'),
  constraint free_sessions_used_non_negative check (free_sessions_used >= 0)
);

comment on column public.users.free_sessions_used is
  'Server-side entitlement counter. SPEC allows a client-side count for MVP, but the paywall must not be defeatable by a reinstall.';

-- --------------------------------------------------------------------------
-- topics
-- --------------------------------------------------------------------------

create type emotional_anchor as enum ('grandparent', 'parent', 'cousin', 'cultural');

create table public.topics (
  id uuid primary key,
  target_language text not null default 'te',
  title text not null,
  scenario_description text not null,
  emotional_anchor emotional_anchor not null,

  -- Ordered array of turn objects. Shape is owned by packages/content/src/schema.ts —
  -- the Zod schema is the source of truth, this column just stores what it validated.
  turns jsonb not null,

  -- Mirrors the `verified` flag in the JSON. Seeding refuses to load unverified content
  -- unless explicitly forced, so this should be true for everything in production.
  verified boolean not null default false,

  created_at timestamptz not null default now(),

  constraint turns_is_array check (jsonb_typeof(turns) = 'array'),
  constraint turns_length_within_spec check (
    jsonb_array_length(turns) between 5 and 8
  )
);

create index topics_anchor_idx on public.topics (emotional_anchor);

-- --------------------------------------------------------------------------
-- sessions
-- --------------------------------------------------------------------------

create type difficulty as enum ('easy', 'medium', 'hard');

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete restrict,

  difficulty difficulty not null,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  turns_completed integer not null default 0,

  -- SPEC section 10: "a session must survive app kill mid-flow". This column is what
  -- makes that true — the client resumes from the database, not from local state.
  current_turn integer not null default 1,

  constraint turns_completed_non_negative check (turns_completed >= 0),
  constraint current_turn_positive check (current_turn >= 1),
  constraint completed_after_started check (
    completed_at is null or completed_at >= started_at
  )
);

create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

-- Resuming needs "the one unfinished session for this user" to be unambiguous.
create unique index sessions_one_open_per_user_idx
  on public.sessions (user_id)
  where completed_at is null;

comment on index sessions_one_open_per_user_idx is
  'At most one in-flight session per user, so resume-after-app-kill has a single answer.';

-- --------------------------------------------------------------------------
-- Row level security
-- --------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.topics enable row level security;
alter table public.sessions enable row level security;

-- users: you may only ever see or change yourself.
create policy users_select_own on public.users
  for select using (auth.uid() = id);

create policy users_update_own on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy users_insert_own on public.users
  for insert with check (auth.uid() = id);

-- topics: readable by any signed-in user, including anonymous ones — the first session
-- happens before signup, so anon must be able to read topics.
-- Unverified content is invisible to clients regardless of role. This is the last line
-- of defence behind assertShippable(); bad Telugu cannot reach a user even if seeded.
create policy topics_select_verified on public.topics
  for select using (verified = true);

-- Writes to topics happen only via the service role, which bypasses RLS. No policy.

-- sessions: strictly your own.
create policy sessions_select_own on public.sessions
  for select using (auth.uid() = user_id);

create policy sessions_insert_own on public.sessions
  for insert with check (auth.uid() = user_id);

create policy sessions_update_own on public.sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- New auth users get a public.users row automatically
-- --------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Fires for anonymous sign-in too, so a user exists from the very first launch.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Linking an email to an anonymous account later updates the same row.
create trigger on_auth_user_email_linked
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_new_user();
