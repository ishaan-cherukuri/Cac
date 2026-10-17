-- Second language, a starter topic per language, and the words a user has spoken.
-- See docs/adr/0001-multiple-languages.md for why the launch-language lock was lifted.

-- --------------------------------------------------------------------------
-- Languages: Telugu and Hindi. Keep this list in step with LANGUAGE_CODES in
-- packages/core/src/languages.ts.
-- --------------------------------------------------------------------------

alter table public.users drop constraint target_language_is_launch_language;
alter table public.users
  add constraint target_language_supported check (target_language in ('te', 'hi'));

alter table public.topics
  add constraint target_language_supported check (target_language in ('te', 'hi'));

create index topics_language_idx on public.topics (target_language);

-- --------------------------------------------------------------------------
-- Starter topic: the conversation a new user drops straight into after onboarding.
-- At most one per language, so "which one do we open?" always has a single answer.
-- --------------------------------------------------------------------------

alter table public.topics add column starter boolean not null default false;

create unique index topics_one_starter_per_language_idx
  on public.topics (target_language)
  where starter;

-- --------------------------------------------------------------------------
-- spoken_words: vocabulary a user has actually said out loud.
--
-- A word is recorded only when the transcript of the user's own speech contained it,
-- so the list is evidence, not a guess. The transcript itself is still never stored:
-- this table holds the dictionary entry from the topic content, never what the user
-- said around it.
-- --------------------------------------------------------------------------

create table public.spoken_words (
  user_id uuid not null references public.users (id) on delete cascade,
  language text not null,

  -- The word as written in the topic's key vocabulary, in native script.
  word_native text not null,
  word_translit text not null,
  meaning text not null,

  -- Where it was first said. Topic + turn + position in key_vocab also locate the
  -- word's pre-generated audio clip: {topic_id}/{turn_number}-vocab-{vocab_index}.mp3
  topic_id uuid references public.topics (id) on delete set null,
  turn_number integer not null,
  vocab_index integer not null,

  first_spoken_at timestamptz not null default now(),

  primary key (user_id, language, word_native),
  constraint language_supported check (language in ('te', 'hi'))
);

create index spoken_words_user_recent_idx
  on public.spoken_words (user_id, first_spoken_at desc);

alter table public.spoken_words enable row level security;

create policy spoken_words_select_own on public.spoken_words
  for select using (auth.uid() = user_id);

-- The turn function writes with the caller's JWT, so inserts are gated by RLS too.
-- Re-saying a word is an insert-or-ignore, so no update policy is needed: the first
-- time a word was said never changes.
create policy spoken_words_insert_own on public.spoken_words
  for insert with check (auth.uid() = user_id);
