import { useEffect, useState } from "react";
import { SESSION_LIMIT_MS } from "@shared/core";

/**
 * Ticks once a second so the 5-minute cap can be enforced and shown.
 *
 * The cap itself is decided by @shared/core from timestamps, not by counting ticks —
 * a dropped tick while the app is backgrounded must not buy the user extra time.
 */
export function useSessionClock(startedAt: number | null): {
  elapsedMs: number;
  remainingMs: number;
  expired: boolean;
} {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (startedAt === null) return { elapsedMs: 0, remainingMs: SESSION_LIMIT_MS, expired: false };

  const elapsedMs = Math.max(0, now - startedAt);
  const remainingMs = Math.max(0, SESSION_LIMIT_MS - elapsedMs);
  return { elapsedMs, remainingMs, expired: remainingMs === 0 };
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
