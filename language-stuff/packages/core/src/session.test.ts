import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  resolveTurn,
  applyOutcome,
  resumeSession,
  isOverTimeLimit,
  remainingMs,
  SESSION_LIMIT_MS,
  MAX_ATTEMPTS_PER_TURN,
  type SessionState,
} from "./session.ts";

const T0 = 1_700_000_000_000;

describe("createSession", () => {
  test("starts at turn 1 with nothing completed", () => {
    const state = createSession(T0, 6);
    assert.equal(state.currentTurn, 1);
    assert.equal(state.turnsCompleted, 0);
    assert.equal(state.completedAt, null);
  });

  test("refuses a session with no turns", () => {
    assert.throws(() => createSession(T0, 0), RangeError);
  });
});

describe("the 5-minute hard cap", () => {
  test("is exactly 5 minutes", () => {
    assert.equal(SESSION_LIMIT_MS, 300_000);
  });

  test("is not reached one millisecond early", () => {
    const state = createSession(T0, 8);
    assert.equal(isOverTimeLimit(state, T0 + SESSION_LIMIT_MS - 1), false);
  });

  test("is reached exactly at the boundary", () => {
    const state = createSession(T0, 8);
    assert.equal(isOverTimeLimit(state, T0 + SESSION_LIMIT_MS), true);
  });

  test("ends the session on the turn that crosses it", () => {
    const state = createSession(T0, 8);
    const { state: next, ended } = applyOutcome(state, { kind: "advance" }, T0 + SESSION_LIMIT_MS);
    assert.equal(ended, "time_limit");
    assert.equal(next.completedAt, T0 + SESSION_LIMIT_MS);
  });

  test("applies to retries too, so a stalling user cannot run past it", () => {
    const state = createSession(T0, 8);
    const { ended } = applyOutcome(state, { kind: "retry" }, T0 + SESSION_LIMIT_MS + 1);
    assert.equal(ended, "time_limit");
  });

  test("remainingMs never goes negative", () => {
    const state = createSession(T0, 8);
    assert.equal(remainingMs(state, T0 + SESSION_LIMIT_MS * 3), 0);
  });
});

describe("finishing the topic", () => {
  test("ends with topic_complete when the last turn is done in time", () => {
    let state = createSession(T0, 3);
    let ended: string | null = null;

    for (let i = 0; i < 3; i++) {
      const progress = applyOutcome(state, { kind: "advance" }, T0 + 1000 * (i + 1));
      state = progress.state;
      ended = progress.ended;
    }

    assert.equal(ended, "topic_complete");
    assert.equal(state.turnsCompleted, 3);
    assert.notEqual(state.completedAt, null);
  });

  test("topic completion wins over the time limit on the final turn", () => {
    // A user who finishes their last turn right at the cap should get the warm closing
    // line, not be cut off — the end reason changes the copy the user sees.
    const state: SessionState = {
      startedAt: T0,
      currentTurn: 3,
      turnsCompleted: 2,
      attemptsOnCurrentTurn: 0,
      totalTurns: 3,
      completedAt: null,
    };
    const { ended } = applyOutcome(state, { kind: "advance" }, T0 + SESSION_LIMIT_MS);
    assert.equal(ended, "topic_complete");
  });
});

describe("resolveTurn — no correction, one gentle retry", () => {
  test("advances when understood", () => {
    const state = createSession(T0, 5);
    assert.deepEqual(resolveTurn(state, true), { kind: "advance" });
  });

  test("offers exactly one retry when not understood", () => {
    const state = createSession(T0, 5);
    assert.deepEqual(resolveTurn(state, false), { kind: "retry" });
  });

  test("moves on without commentary once retries are spent", () => {
    const state = { ...createSession(T0, 5), attemptsOnCurrentTurn: MAX_ATTEMPTS_PER_TURN - 1 };
    // SPEC 3.1: "if still off, it moves on without commentary" — never a third attempt,
    // which would start to feel like being marked wrong.
    assert.deepEqual(resolveTurn(state, false), { kind: "advance_without_comment" });
  });

  test("a retry does not consume a turn", () => {
    const state = createSession(T0, 5);
    const { state: next } = applyOutcome(state, { kind: "retry" }, T0 + 1000);
    assert.equal(next.currentTurn, 1);
    assert.equal(next.turnsCompleted, 0);
    assert.equal(next.attemptsOnCurrentTurn, 1);
  });
});

describe("resumeSession — surviving an app kill", () => {
  test("restores an in-flight session and clears attempts", () => {
    const { state, ended } = resumeSession(
      {
        startedAt: T0,
        currentTurn: 3,
        turnsCompleted: 2,
        totalTurns: 6,
        completedAt: null,
      },
      T0 + 60_000,
    );
    assert.equal(ended, null);
    assert.equal(state.currentTurn, 3);
    assert.equal(state.attemptsOnCurrentTurn, 0);
  });

  test("closes out a session resumed after the cap rather than granting fresh time", () => {
    // Backgrounding the app must not be a way to get a 10-minute session.
    const { state, ended } = resumeSession(
      {
        startedAt: T0,
        currentTurn: 2,
        turnsCompleted: 1,
        totalTurns: 6,
        completedAt: null,
      },
      T0 + SESSION_LIMIT_MS + 60_000,
    );
    assert.equal(ended, "time_limit");
    assert.notEqual(state.completedAt, null);
  });

  test("leaves an already-completed session alone", () => {
    const completedAt = T0 + 120_000;
    const { state, ended } = resumeSession(
      { startedAt: T0, currentTurn: 6, turnsCompleted: 6, totalTurns: 6, completedAt },
      T0 + 999_999,
    );
    assert.equal(ended, null);
    assert.equal(state.completedAt, completedAt);
  });
});
