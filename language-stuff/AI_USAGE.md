# AI usage disclosure

The Congressional App Challenge rules allow AI tools if every use is disclosed, and AI "must not
constitute the entirety of the technical development." This file is that disclosure. It is kept
current as the project changes, and every commit made with an AI tool carries a
`Co-Authored-By` trailer, so `git log` shows exactly which changes involved one.

<!-- AUTHOR: everything under "What I did" is a draft for you to correct. Only you know what you
     actually did — rewrite it in your own words before submitting. Delete this comment after. -->

## What I did

- **The idea and the problem.** I understand Telugu but can't speak it. I designed the app around
  that gap — speaking, not comprehension — and around the people I want to be able to talk to.
- **Product decisions.** The no-correction, no-score design; the three difficulty levels that fade
  the help out; the 5-minute cap. I tested early versions and changed what didn't work:
  - removed the visible countdown timer because it felt like being timed in a test;
  - stopped her reading the Easy answer aloud because it felt patronising;
  - added the voice note so practice leads back to a real grandmother.
- **Technical direction and debugging.** I chose the stack and drove the investigation that found:
  - `whisper-1` rejects Telugu outright, so speech-to-text uses `gpt-4o-transcribe`;
  - only ElevenLabs `eleven_v3` speaks Telugu;
  - streaming the voice instead of returning a finished clip cut the wait from ~15s to ~1s.
- **Testing with real people.** Native-speaker review of the content, and testing with heritage
  speakers. <!-- AUTHOR: add who reviewed and who tested, once it has happened. -->
- **Understanding the code.** I can explain every part of it, including the session state machine
  (`packages/core/src/session.ts`), the `/turn` pipeline (`supabase/functions/turn/handler.ts`), and
  the signed speech tokens (`supabase/functions/_shared/speech-token.ts`).

## What AI tools did

| Tool | Used for |
|---|---|
| **Claude Code** (Anthropic) | Wrote most of the code to my specifications and reviewed it with me: the Expo app, the Supabase Edge Functions, the database schema, the tests and the scripts. |
| **Claude** (Anthropic) | Drafted the topic content (Telugu and Hindi dialogue, romanization, English). **All of it is unverified until a native speaker reviews it**, and unverified content never reaches users. |
| **OpenAI `gpt-4o-transcribe`** | At runtime: turns the user's speech into text. |
| **OpenAI `gpt-4o`** | At runtime: the grandmother's replies, and judging whether a reply was understood. Every line passes code-based checks (no correction, no payment talk) before the user hears it. |
| **OpenAI moderation** | At runtime: screens what the user said before the conversation model sees it. |
| **ElevenLabs `eleven_v3`, OpenAI TTS** | At runtime: the grandmother's voice. |

## Open-source libraries

Expo / React Native, expo-router, expo-audio, expo-sharing, NativeWind + Tailwind CSS, TanStack
Query, Supabase (Postgres, Auth, Edge Functions, Storage) and supabase-js, Zod, the OpenAI SDK.
Full list with versions: `package.json` in each workspace and `package-lock.json`.
