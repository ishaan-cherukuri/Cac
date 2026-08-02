# Supabase backend

Postgres schema, RLS, and the AI orchestration Edge Function.

## Prerequisites

Neither tool is installed yet:

```bash
brew install supabase/tap/supabase   # Supabase CLI
brew install deno                    # only needed to lint/test the Edge Function locally
```

## Applying the schema

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`migrations/20260727000001_initial_schema.sql` creates `users`, `topics`, `sessions`,
their RLS policies, and the trigger that mirrors `auth.users` into `public.users`.

### Two things in the schema worth knowing

**Anonymous auth carries the delayed signup.** SPEC section 3.2 requires the first
session to happen before an account is requested. Rather than allowing null `user_id`
and migrating orphan sessions later, every user gets an anonymous `auth.users` row at
first launch; signing up links an email to that same id. Enable anonymous sign-ins in
Dashboard → Authentication → Providers.

**Unverified topics are invisible to clients.** The `topics_select_verified` RLS policy
filters on `verified = true`. Combined with `assertShippable()` in the seed script, bad
Telugu cannot reach a user even if someone force-seeds it.

## Seeding topics

```bash
npm run content:seed                          # refuses unverified content
npm run content:seed -- --allow-unverified    # dev only; rows stay hidden by RLS
```

Idempotent upsert on `id`, so re-run freely after content edits.

## The `turn` Edge Function

```bash
supabase functions deploy turn
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set ELEVENLABS_API_KEY=...       # optional; falls back to OpenAI TTS
supabase secrets set ELEVENLABS_VOICE_ID=...
```

`POST /functions/v1/turn`, `multipart/form-data`:

| Field | Type | Description |
|---|---|---|
| `audio` | File | The user's spoken response |
| `meta` | JSON string | `{ "sessionId": "uuid", "clientTurn": 1 }` |

Pipeline: transcribe (Whisper) → moderate → advance-or-retry → chat → outbound vetting
→ TTS → persist session state → return audio as base64.

### Design notes

- **User audio is never stored.** It is transcribed and discarded. No Storage bucket is
  needed for it, and the privacy manifest can say so honestly.
- **The handler is thin on purpose.** Every decision that can be wrong — the 5-minute
  cap, retry-vs-advance, whether a generated line is shippable — lives in
  `packages/core`, which is dependency-free and unit-tested under Node. Deno imports the
  same source. There is no second implementation to disagree with the first.
- **The time cap is checked before inference**, so an expired session costs nothing.
- **TTS failures fall back rather than erroring.** A voice-provider outage degrades
  quality; it does not end someone's conversation with their grandmother.
- **Moderation fails open.** SPEC section 9 requires filtering user audio before it
  reaches the conversation model, but a moderation outage should not take down the app
  for everyone. The outbound `vetLine` check still gates whatever comes back.

### Testing

The logic that matters is tested under Node:

```bash
npm run -w @ammamma/core test    # 28 tests: state machine, cap, resume, vetting
```

The handler itself has no test yet — it is I/O wiring, and testing it needs either Deno
plus a live Supabase instance or a mock layer. **This is the one gap against SPEC section
10's "every backend function gets a unit test."** Worth closing once `supabase` and
`deno` are installed locally.

### Known constraint

The function imports `packages/core` via a relative path outside `supabase/functions/`.
The Supabase CLI bundles relative imports within the project root, so this should deploy
cleanly — but it is unverified, since the CLI is not installed. If `supabase functions
deploy` complains, the fix is to copy `packages/core/src/*.ts` into
`supabase/functions/_shared/` as part of the deploy step rather than duplicating it in
source.
