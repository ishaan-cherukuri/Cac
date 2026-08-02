# CLAUDE.md

Working rules for this repo. Copied from `SPEC.md` section 10, plus decisions locked during the build.

## What this app is

A mobile app for **receptive bilinguals** — people who understand Telugu but can't speak it. Users
practice through short, scaffolded voice conversations with **Ammamma** (maternal grandmother), a
warm AI persona.

The core loop is **scaffolded shadowing with progressive fade-out**.

## Locked decisions

| Decision | Value | Notes |
|---|---|---|
| Launch language | **Telugu** (`te`) | Single language. No multi-language code paths. |
| Dialect | **Coastal Andhra** | All content normalizes to this register. |
| Persona | **Ammamma** (maternal grandmother) | One voice, every session. |
| Ammamma voice | ElevenLabs `TLhTqATJ3nsbNZKRJQB3` ("Naira J") | Middle-aged Indian female. No elderly Telugu voice exists in the library. |
| ElevenLabs model | **`eleven_v3` only** | Verified against `/v1/models`: the ONLY model listing Telugu. `multilingual_v2` and `turbo/flash_v2_5` do NOT — using them reads Telugu with a non-Telugu phoneme set. |
| Backend | **Supabase** | Postgres + Auth + Edge Functions + Storage. |
| STT | **`gpt-4o-transcribe`** | **NOT `whisper-1`** — it rejects Telugu outright: `400 Language 'te' is not supported` (verified 2026-07-29). Deviation from SPEC §5, forced by the provider. |
| Conversation | **OpenAI chat** | Behind a provider interface. Spec prefers Claude; swap is one file. |
| TTS | **ElevenLabs** primary, **OpenAI TTS** fallback | Telugu quality UNVERIFIED for both. |
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
- Session state lives in the database, not just in client state — a session must survive app kill mid-flow.

## Product rules

- Never introduce a red X, "wrong," "incorrect," or any punitive feedback UI
- Never add a streak counter or streak-related mechanic
- Never add gamification (XP, badges, levels) without explicit approval
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

All topic content in `content/topics/` is drafted by Claude and carries `"verified": false`.
**Nothing ships to TestFlight until a native Telugu speaker reviews each topic** and flips the flag.
See `content/REVIEW.md`.
