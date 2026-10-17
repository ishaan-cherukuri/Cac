# CLAUDE.md

Working rules for this repo. Copied from `SPEC.md` section 10, plus decisions locked during the build.

## What this app is

A mobile app for **receptive bilinguals** — people who understand their family's language but can't
speak it. Users practise through short, scaffolded voice conversations with a warm AI **grandmother
persona** (maternal grandmother) who speaks that language. Telugu is the launch language; Hindi is a
pilot. Vocabulary is in `GLOSSARY.md`.

**The app's name is not chosen yet.** It lives only in `packages/core/src/brand.ts` (`APP_NAME`,
`APP_SLUG`, `BUNDLE_ID`, `SUPPORT_EMAIL`). Never write the name anywhere else. English copy refers
to the grandmother through the `{persona}` token or `languageProfile(code).personaName` — never a
hardcoded name.

The core loop is **scaffolded shadowing with progressive fade-out**.

## Locked decisions

| Decision | Value | Notes |
|---|---|---|
| Languages | **Telugu** (`te`, launch) + **Hindi** (`hi`, pilot) | Everything that differs per language lives in `packages/core/src/languages.ts`. Nothing else branches on language. See `docs/adr/0001-multiple-languages.md`. |
| Dialect | Telugu: **Coastal Andhra**. Hindi: everyday spoken Hindustani | Content normalizes to these registers. |
| Persona | The maternal grandmother — Ammamma in Telugu, Nani in Hindi | One voice per language, every session. |
| Telugu voice | ElevenLabs `TLhTqATJ3nsbNZKRJQB3` ("Naira J") | Middle-aged Indian female. No elderly Telugu voice exists in the library. |
| Hindi voice | Not chosen — `scripts/audition-voices.mjs --language hi` | Until chosen, /speak uses the OpenAI fallback for Hindi. |
| ElevenLabs model | **`eleven_v3` only** | Verified against `/v1/models`: the ONLY model listing Telugu. `multilingual_v2` and `turbo/flash_v2_5` do NOT — using them reads Telugu with a non-Telugu phoneme set. |
| Backend | **Supabase** | Postgres + Auth + Edge Functions + Storage. |
| STT | **`gpt-4o-transcribe`** | **NOT `whisper-1`** — it rejects Telugu outright: `400 Language 'te' is not supported` (verified 2026-07-29). Deviation from SPEC §5, forced by the provider. |
| Conversation | **OpenAI chat** | Behind a provider interface. Spec prefers Claude; swap is one file. |
| TTS | **ElevenLabs** primary, **OpenAI TTS** fallback | Quality UNVERIFIED for both, both languages. |
| Audio lib | **expo-audio** | NOT `expo-av` — deprecated and removed in current SDKs. |
| Styling | **NativeWind 4** + **tailwindcss 3.4.x** | Tailwind 4 is incompatible with NativeWind 4. |

## Never run Expo commands from the repo root

Always `npm run ios:device` / `npm run ios` from the root, or `cd app` first. Running
`npx expo run:ios` at the repo root makes Expo treat the monorepo root as its project:
it writes a stray `/ios`, sets the bundle id to `com.anonymous.*`, and **adds
`expo`/`react`/`react-native` to the root `package.json`**.

That last one is the damaging part. A root copy at a slightly different version than the
`app` workspace makes npm hoist a conflicting second tree, and some `@expo/*` packages
install with missing source files. It has already broken the build twice, in two
different places and with two unrelated-looking errors:

- `@expo/ui` — Xcode "Build input files cannot be found" on ~140 Swift files
- `@expo/metro-runtime` — Metro "Unable to resolve module ./ExceptionsManager"

The root `package.json` must have **no `dependencies` block at all**. If one appears,
delete it, then delete `package-lock.json` and every `node_modules` and reinstall — the
lockfile remembers the pollution and keeps restoring it.

## Code style

- TypeScript strict mode, no `any`
- No `useEffect` for data fetching — use TanStack Query
- Prefer small, single-purpose components
- Colocate types with the code that uses them
- No inline styles — Tailwind classes only

## Architecture rules

- Never call the AI APIs from the client. All AI calls go through the backend.
- Never store API keys in the client. Ever.
- AI audio served from signed URLs. Per-turn user audio is transcribed and **discarded** — never persisted.
  Transcripts are not persisted either; `spoken_words` stores only the dictionary entry of a key-vocab
  word that the transcript contained.
- The only user audio that is ever written to disk is the voice note on the closing screen: it stays
  in the app's cache on the phone and leaves only if the user shares it themselves.
- Edge Functions are split into `handler.ts` (all logic, dependencies passed in, runs under Node for
  tests) and `index.ts` (Deno wiring only). Keep runtime-specific imports out of `handler.ts`.
- Session state lives in the database, not just in client state — a session must survive app kill mid-flow.

## Product rules

- Never introduce a red X, "wrong," "incorrect," or any punitive feedback UI
- Never add a streak counter or streak-related mechanic
- Never add gamification (XP, badges, levels) without explicit approval. "Words you've said" is a
  list, not a score: no totals, no goals.
- Session length hard cap is 5 minutes — enforce in the state machine
- Every AI-generated line to the user passes through a warmth check: rephrase anything that sounds
  sterile, clinical, or like a Duolingo error message

## When in doubt

- Ask before installing a new dependency
- Ask before adding a new screen or route
- Ask before changing the session state machine
- Do not ask before writing tests — always write them

## Testing

- Every screen gets a Maestro E2E test covering the happy path
- Every backend function gets a unit test covering the happy path and one error case
- AI prompts get regression tests: pinned example inputs → expected structural output (not exact strings)

## Content status

All topic content in `content/topics/` is drafted by Claude and carries `"verified": false` until
a native speaker reviews it. **Only verified topics are seeded**, so a partly reviewed corpus ships
only its reviewed part. See `content/REVIEW.md` for the first-release review plan.

## Commands

- `npm test` — core, content, spike and Edge Function tests (all under Node)
- `npm run typecheck` — each workspace
- `npm run content:validate` / `npm run content:seed`
- `node --env-file=.env scripts/pregenerate-audio.mjs` — prompts, answers and vocab clips
- `app/.maestro/*.yaml` — Maestro happy paths (`maestro test app/.maestro/<flow>.yaml`)

## AI disclosure

`AI_USAGE.md` records what AI did and what the author did. Keep it current: the Congressional App
Challenge requires full disclosure, and every commit made with Claude carries a Co-Authored-By trailer.
