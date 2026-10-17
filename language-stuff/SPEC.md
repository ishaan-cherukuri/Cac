# Heritage Speaker MVP — Build Spec

This is the working specification for the MVP. Feed this into Claude Code at the start of every session. Also treat it as the seed for `CLAUDE.md` — copy the "Rules for Claude Code" section into the repo root.

---

## 1. What this app is

A mobile app for **receptive bilinguals** — people who understand their heritage language but can't speak it. Users practice speaking through short, scaffolded voice conversations with an AI persona that plays the role of a warm family member (grandmother, aunt, uncle).

The core loop is **scaffolded shadowing with progressive fade-out**: the AI asks a question, the user speaks a response, and the amount of help provided decreases as the user levels up.

### Who it's for

- Adult and teen heritage speakers of a single target language (chosen at launch)
- Currently understand the language fully but can't produce sentences
- Feel emotional weight around the gap (grandparents, parents, cultural identity)
- Have tried and failed with Duolingo (wrong pedagogy — teaches from zero) or classes (accent shame)

### Who it's not for

- Beginners with no receptive comprehension
- Users who want to learn a language from scratch
- Users who want gamified streak-based practice

### What makes it different

- **No shame architecture:** zero correction by default, no red X's, no streaks, no leaderboards
- **Emotionally anchored:** the AI has a family-relation persona and topics revolve around real relationships
- **Production-focused:** every session forces active speech, not passive recognition
- **Short sessions:** 5-minute hard cap

---

## 2. Non-negotiable design principles

Every design decision must pass these filters. If a proposed feature violates one of these, cut it.

1. **Reduce shame at every turn.** No harsh feedback. No "wrong." No accent policing in v1. Celebrate attempts, gently rephrase, move on.
2. **Emotional anchor > gamification.** The app is about repairing relationships, not earning XP. No streaks, badges, XP bars, leaderboards, or Duolingo-style pressure mechanics.
3. **Short sessions win.** 5-minute hard cap on sessions. Users can do multiple sessions in a day if they want, but each one ends warmly and quickly.
4. **First aha moment before signup.** User completes their first full session before the app ever asks for account creation.
5. **Content quality > content volume.** 20-30 hand-curated topics beat 200 auto-generated ones.
6. **Single language at launch.** No multi-language support in v1.
7. **The AI persona is consistent.** One warm family-relation voice across every session.

---

## 3. Core feature list (MVP scope)

### 3.1 The session loop (the app's one job)

- **20-30 pre-written conversation topics**, hand-curated. Each has 5-8 turns. Stored as structured JSON (see schema in section 6).
- **Topics anchored to real relationships and scenarios:** e.g., "Ask your grandmother about her childhood," "Tell your mom about your day," "Order food at a restaurant back home," "Congratulate a cousin on their wedding."
- **Three difficulty modes per topic:**
  - **Easy:** AI speaks the question, then the model answer. User repeats both aloud. Pure shadowing.
  - **Medium:** AI speaks the question and gives partial hints (key vocabulary, sentence starter). User completes the response.
  - **Hard:** AI speaks only the question. User produces the full response from active recall.
- **Audio loop per turn:** AI speaks → user records their response → transcription → AI acknowledges warmly and advances to next turn.
- **No correction in v1.** If the user's response is unrecognizable or nonsensical, the AI gently rephrases the question and gives one more try. If still off, it moves on without commentary.
- **Session ends at 5 minutes or at end of topic**, whichever comes first, with a warm closing line from the AI persona.

### 3.2 Onboarding

- **Three screens maximum.**
  1. Language confirmation (single language in v1 but confirm it)
  2. Self-assessment: three buttons — "I understand a lot but speak nothing" / "I can speak a little" / "I want to get better"
  3. First topic starts immediately
- **No signup wall before the first session.** User must experience the loop before account creation is requested.
- **Signup requested after session 1 completes**, framed as "save your progress" not "unlock more."

### 3.3 Auth and account

- Email or Apple/Google sign-in via Clerk or Supabase Auth
- No profile customization in v1 (no name, avatar, or bio)
- Account exists only to persist session history and subscription state

### 3.4 Progress tracking (deliberately minimal)

- **Sessions completed:** a simple count. Displayed subtly on home screen.
- **Topics list:** which topics user has done, which are new. No progress bars or completion percentages within a topic.
- **No streaks. No XP. No graphs. No achievements. No calendar.**

### 3.5 Payment

- **Three free sessions**, then a hard paywall.
- **Single subscription tier at $9.99/month** via RevenueCat + StoreKit (iOS) and Play Billing (Android).
- No annual plan, no lifetime, no discount codes in v1.
- Standard 7-day free trial can be enabled via App Store Connect if desired but not required for MVP.

### 3.6 Notifications

- **One notification per day maximum.** Sent in the AI persona's voice, e.g., "Your grandmother is waiting to hear about your day."
- User can disable in settings.
- No engagement-farming notifications. No streak-at-risk alerts.

---

## 4. Explicit cuts — do not build these in MVP

Every one of these will be tempting. Every one is a v1.1+ decision.

- Free-form conversation mode (only structured topic scripts in v1)
- Real-time pronunciation feedback
- Multiple AI voices or user-selectable personas
- Multiple languages
- Family sharing / social features / progress sharing
- Streaks, badges, XP, levels, achievements
- User-generated topics or AI-generated topic system
- Push notifications beyond the daily one
- Full marketing site (single-page splash + email capture only)
- Community, forum, or Discord
- Family-tree feature (adding real family members to practice with)
- Web version of any kind
- Group / multiplayer practice
- Voice cloning of user's actual family members

---

## 5. Tech stack

### Client
- **Expo (React Native)** with **expo-router**
- **expo-av** for audio recording and playback
- **TypeScript strict mode**
- **Tailwind** via NativeWind for styling

### Backend
- **Supabase** (Postgres + Auth + Edge Functions) OR **Convex** — pick one and commit. Default: Supabase for continuity with prior projects.
- **Cloudflare Workers** as alternative for the AI orchestration endpoint if Supabase Edge Functions have latency issues

### AI services
- **Speech-to-text:** OpenAI Whisper API (whisper-large-v3). Verify quality on target language before any other work.
- **Conversation logic:** Claude Sonnet via the Anthropic API. Use prompt caching aggressively for the system prompt and topic scaffolding.
- **Text-to-speech:** ElevenLabs primary. Fallback to OpenAI TTS if ElevenLabs quality on target language is poor or too costly.

### Payments
- **RevenueCat** wrapping StoreKit 2 (iOS) and Google Play Billing (Android)
- No Stripe integration in v1

### Observability
- **Sentry** for crashes
- **PostHog** for product analytics. Track only the metrics in section 8.

### Auth
- **Clerk** or **Supabase Auth** — pick one. If using Supabase for backend, use Supabase Auth for simplicity.

---

## 6. Data model

Minimum viable schema. Extend later if needed but don't over-design v1.

```
users
  id (uuid, pk)
  email (text, unique)
  target_language (text)  // e.g., "hi", "pa", "ta"
  self_assessed_level (text)  // "understand_only" | "some_speaking" | "improving"
  created_at (timestamp)
  subscription_status (text)  // "trial" | "active" | "expired"

topics
  id (uuid, pk)
  target_language (text)
  title (text)  // "Ask your grandmother about her childhood"
  scenario_description (text)  // shown to user
  turns (jsonb)  // ordered array of turn objects (see below)
  emotional_anchor (text)  // "grandparent" | "parent" | "cousin" | "cultural"

turn (embedded in topics.turns)
  turn_number (int)
  ai_prompt_native (text)  // what the AI says in target language
  ai_prompt_english (text)  // translation, shown as optional hint
  model_answer_native (text)  // ideal user response
  model_answer_english (text)  // translation
  key_vocab (array of strings)  // for medium-difficulty hints

sessions
  id (uuid, pk)
  user_id (uuid, fk)
  topic_id (uuid, fk)
  difficulty (text)  // "easy" | "medium" | "hard"
  started_at (timestamp)
  completed_at (timestamp, nullable)
  turns_completed (int)
```

Do not build a separate `attempts` table for storing per-turn transcriptions in v1. Log them to PostHog if needed for analysis, but don't persist per-turn data in the user database until there's a product reason.

---

## 7. Build order

Follow this sequence strictly. Each step de-risks the next. If any step blocks, resolve before moving forward.

### Step 1: Prove the tech loop (before any app code)

**Standalone Python or Node script that does:**
1. Take a target-language audio file as input
2. Transcribe with Whisper
3. Send a canned prompt to Claude, get a next-turn response
4. Synthesize the response with ElevenLabs
5. Save the output audio

**Success criterion:** Whisper transcribes accented heritage-speaker audio in the target language with >80% intelligibility, and ElevenLabs produces natural-sounding output. If either fails, do not proceed. Try alternative providers or reconsider language choice.

Estimated time: half a day.

### Step 2: Write the topic content

Draft 20-30 topics as JSON matching the schema in section 6. Use Claude to help write the target-language content but have a native speaker verify each one before it ships. Emotional variety across the topic set: at least 40% grandparent-anchored, 30% parent-anchored, 30% general life.

Estimated time: 2-3 evenings.

### Step 3: Expo scaffold

- Expo project with expo-router
- Basic navigation: onboarding stack, main tab stack (Home, Settings)
- Placeholder screens only, no logic
- Auth wired but not gated

Estimated time: 1 evening.

### Step 4: Hardcoded conversation screen with one topic

- Pick one topic and one difficulty
- Screen displays the current turn, plays AI audio, records user audio, advances turn on tap
- No AI orchestration yet — use the pre-generated audio from step 1
- The purpose: prove the client UX before adding backend complexity

Estimated time: 1 weekend.

### Step 5: Backend AI orchestration

- Supabase Edge Function (or Convex action) that:
  1. Receives user audio
  2. Transcribes via Whisper
  3. Sends conversation state + user response to Claude
  4. Synthesizes Claude's next line via ElevenLabs
  5. Returns audio URL to client
- Prompt caching enabled for system prompt and topic context

Estimated time: 2-3 evenings.

### Step 6: All topics + difficulty selector

- Home screen lists all topics
- Tapping a topic opens difficulty selector
- Selected difficulty parameter passes through to the AI prompt so scaffolding adjusts

Estimated time: 1 evening.

### Step 7: Onboarding + delayed signup

- Three onboarding screens
- First session accessible without account
- Signup wall triggers after session 1 completes

Estimated time: 1 evening.

### Step 8: RevenueCat + paywall

- RevenueCat integration
- Three-free-session counter (client-side is fine for MVP)
- Paywall screen on session 4 attempt

Estimated time: 1 evening.

### Step 9: One daily notification

- Expo push notifications
- User can enable/disable in settings
- Sends at a fixed time (or user-picked time) in the persona's voice

Estimated time: half an evening.

### Step 10: Polish pass

- Empty states on every screen
- Error states (no internet, API failure, mic permission denied)
- Loading states with warm copy in the persona's voice
- Session recovery if user backgrounds mid-session

Estimated time: 1 weekend.

### Step 11: TestFlight to validated users

Ship to the users who committed during interviews. Ask them to do 5 sessions over 3 days and give feedback. Fix the top 3 issues.

### Step 12: App Store submission

Follow the AI-app submission checklist in section 9.

---

## 8. Metrics to track from day one

Track only these. Any other metric is a distraction until D1 and completion are healthy.

| Metric | Definition | Target |
|--------|-----------|--------|
| **D1 return** | % of users who complete session 1 and open the app the next day | > 40% |
| **Session completion rate** | % of started sessions that reach the end | > 70% |
| **Free-to-paid conversion** | % of users hitting paywall who subscribe | > 5% |
| **Trial-to-paid conversion** | % of trial starters who convert to paid | > 30% |

If D1 return is below 40% at 20 users, the loop itself isn't sticky enough. Do not add features. Redesign the loop.

If session completion is below 70%, sessions are too long, too hard, or too shame-inducing. Investigate before continuing.

---

## 9. App Store submission checklist (AI apps in 2026)

Apple has raised the bar for AI apps. Handle these before first submission.

- [ ] Demo account with active subscription, credentials in App Review notes
- [ ] Every screen has non-empty state — no blank screens on cold open
- [ ] Content moderation on user-submitted audio (Whisper output filtered for harmful content before Claude processes)
- [ ] User-reporting mechanism (in Settings)
- [ ] Privacy manifest completed honestly, disclosing OpenAI, Anthropic, and ElevenLabs as third-party data processors
- [ ] Privacy policy live and linked from app + App Store listing
- [ ] No references to external payment anywhere in AI-generated content (add a post-processing filter on Claude's outputs)
- [ ] Terms of Service linked from onboarding
- [ ] Age rating set appropriately (likely 4+ unless language content warrants otherwise)

Budget one rejection cycle. Two weeks wall clock from build-done to live.

---

## 10. Rules for Claude Code

Copy this section into `CLAUDE.md` at the repo root.

### Code style
- TypeScript strict mode, no `any`
- No `useEffect` for data fetching — use TanStack Query or Supabase realtime hooks
- Prefer small, single-purpose components
- Colocate types with the code that uses them
- No inline styles — Tailwind classes only

### Architecture rules
- Never call the Anthropic API from the client. All AI calls go through the backend.
- Never store API keys in the client. Ever.
- Audio files: user audio uploads to Supabase Storage, AI audio served from signed URLs
- Session state lives in the database, not just in client state — a session must survive app kill mid-flow

### Product rules
- Never introduce a red X, "wrong," "incorrect," or any punitive feedback UI
- Never add a streak counter or streak-related mechanic
- Never add gamification (XP, badges, levels) without explicit approval
- Session length hard cap is 5 minutes — enforce in the state machine
- Every AI-generated line to the user passes through a warmth check: rephrase anything that sounds sterile, clinical, or like a Duolingo error message

### When in doubt
- Ask before installing a new dependency
- Ask before adding a new screen or route
- Ask before changing the session state machine
- Do not ask before writing tests — always write them

### Testing
- Every screen gets a Maestro or Detox E2E test covering the happy path
- Every backend function gets a unit test covering the happy path and one error case
- AI prompts get regression tests: pinned example inputs → expected structural output (not exact strings)

---

## 11. Open questions to resolve before building

Answer these before starting step 1.

1. **Which language is the launch language?** Based on your background and the users you've validated (Punjabi, Tamil, Bengali dialect all appeared in interviews), pick one. Verify Whisper quality on that specific language before committing.
2. **What is the AI persona's name and family role?** Grandmother is likely strongest but confirm it matches the launch language culture. Examples: Nani/Dadi (Hindi/Punjabi), Paati (Tamil), Amma-mma (Telugu), Lola (Filipino).
3. **What's the launch persona's voice like?** Warm, patient, slightly imperfect grammar (like an older relative). Test 3-5 ElevenLabs voices before locking one in.
4. **Supabase or Convex?** Default: Supabase. Only switch to Convex if you specifically want its reactive query model.
5. **Do you want a 7-day free trial in addition to three free sessions?** Optional but standard for consumer subscriptions.

---

## 12. Definition of done for MVP

The MVP ships when all of the following are true:

- A new user can install, complete onboarding, do their first session, sign up, do two more sessions, hit paywall, subscribe, and continue — all without a bug that requires a restart
- The AI persona feels consistent, warm, and in-character across all 20-30 topics
- All three difficulty levels work distinguishably differently
- The 5-minute session cap is enforced
- Empty, error, and loading states exist on every screen
- The app is approved on the App Store
- At least 3 users from your validation cohort have completed 5+ sessions each
- D1 return in the first 20 users is above 30% (target 40%+ but 30% is the floor to keep going)

Anything else — additional topics, another language, pronunciation feedback, family features — is v1.1 and beyond. Ship the MVP first.
