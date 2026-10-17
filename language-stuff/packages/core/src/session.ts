/**
 * The session state machine.
 *
 * SPEC section 10 lists this as an "ask before changing" area, and section 3.1 makes the
 * rules explicit:
 *   - a session ends at 5 minutes OR at the end of the topic, whichever comes first
 *   - there is no correction; an unclear answer earns one gentle retry, then we move on
 *   - the session must survive the app being killed, so every transition is derivable
 *     from persisted state rather than in-memory flags
 *
 * Kept dependency-free so the Deno Edge Function and the Expo client run the exact same
 * logic. Two implementations of a hard cap is two implementations to disagree.
 */

export const SESSION_LIMIT_MS = 5 * 60 * 1000;

/** SPEC section 3.1: one gentle rephrase, then advance without commentary. */
export const MAX_ATTEMPTS_PER_TURN = 2;

export type Difficulty = "easy" | "medium" | "hard";

export interface SessionState {
  /** Server timestamp, ms since epoch. Persisted as sessions.started_at. */
  startedAt: number;
  /** 1-based. Persisted as sessions.current_turn. */
  currentTurn: number;
  /** Persisted as sessions.turns_completed. */
  turnsCompleted: number;
  /** Attempts spent on the current turn. Not persisted — a resumed turn starts fresh. */
  attemptsOnCurrentTurn: number;
  totalTurns: number;
  completedAt: number | null;
}

export type SessionEndReason = "time_limit" | "topic_complete";

export type TurnOutcome =
  /** Understood. Move on warmly. */
  | { kind: "advance" }
  /** Not understood, and there is a retry left. Rephrase — never say it was unclear. */
  | { kind: "retry" }
  /** Not understood and retries are spent. Move on without commentary. */
  | { kind: "advance_without_comment" };

export interface SessionProgress {
  state: SessionState;
  /** Set when the session is over. */
  ended: SessionEndReason | null;
}

export function createSession(startedAt: number, totalTurns: number): SessionState {
  if (totalTurns < 1) throw new RangeError("a session needs at least one turn");
  return {
    startedAt,
    currentTurn: 1,
    turnsCompleted: 0,
    attemptsOnCurrentTurn: 0,
    totalTurns,
    completedAt: null,
  };
}

export function elapsedMs(state: SessionState, now: number): number {
  return Math.max(0, now - state.startedAt);
}

export function remainingMs(state: SessionState, now: number): number {
  return Math.max(0, SESSION_LIMIT_MS - elapsedMs(state, now));
}

/** The hard cap. Checked before every turn, not just at the end. */
export function isOverTimeLimit(state: SessionState, now: number): boolean {
  return elapsedMs(state, now) >= SESSION_LIMIT_MS;
}

export function isComplete(state: SessionState): boolean {
  return state.completedAt !== null;
}

/**
 * Decide what happens after the user speaks.
 *
 * `understood` is the orchestrator's judgement about the transcript. There is no notion
 * of "correct" anywhere in this machine, by design — only "did we make sense of it".
 */
export function resolveTurn(state: SessionState, understood: boolean): TurnOutcome {
  if (understood) return { kind: "advance" };
  if (state.attemptsOnCurrentTurn + 1 < MAX_ATTEMPTS_PER_TURN) return { kind: "retry" };
  return { kind: "advance_without_comment" };
}

/**
 * Apply an outcome and re-evaluate the end conditions.
 *
 * The time check runs AFTER advancing so a user who finishes their last turn at 4:59
 * still gets the warm closing line rather than being cut off mid-sentence.
 */
export function applyOutcome(
  state: SessionState,
  outcome: TurnOutcome,
  now: number,
): SessionProgress {
  if (isComplete(state)) return { state, ended: null };

  if (outcome.kind === "retry") {
    const retried: SessionState = {
      ...state,
      attemptsOnCurrentTurn: state.attemptsOnCurrentTurn + 1,
    };
    // A retry still costs time; the cap applies to it too.
    return isOverTimeLimit(retried, now)
      ? { state: { ...retried, completedAt: now }, ended: "time_limit" }
      : { state: retried, ended: null };
  }

  const advanced: SessionState = {
    ...state,
    currentTurn: state.currentTurn + 1,
    turnsCompleted: state.turnsCompleted + 1,
    attemptsOnCurrentTurn: 0,
  };

  if (advanced.turnsCompleted >= advanced.totalTurns) {
    return { state: { ...advanced, completedAt: now }, ended: "topic_complete" };
  }

  if (isOverTimeLimit(advanced, now)) {
    return { state: { ...advanced, completedAt: now }, ended: "time_limit" };
  }

  return { state: advanced, ended: null };
}

/**
 * Rebuild state after the app was killed mid-session.
 *
 * A session resumed past the cap is already over — we close it out rather than granting
 * a fresh five minutes, which would make the cap meaningless.
 */
export function resumeSession(
  persisted: Omit<SessionState, "attemptsOnCurrentTurn">,
  now: number,
): SessionProgress {
  const state: SessionState = { ...persisted, attemptsOnCurrentTurn: 0 };

  if (isComplete(state)) return { state, ended: null };
  if (isOverTimeLimit(state, now)) {
    return { state: { ...state, completedAt: now }, ended: "time_limit" };
  }
  return { state, ended: null };
}
