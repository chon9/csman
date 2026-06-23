// Transient (non-persisted) state shared across handlers. Anything that
// doesn't need to survive a server restart lives here so handlers.ts stays
// pure-function-friendly and the DB schema doesn't churn for ephemeral data.
//
// Contents:
//   - Live replay cache: full MatchResult (with frames) for ~5 minutes after
//     a duel ends, so the requesting client can pull frames for a replay.
//     (Chat moved to DB in Phase 6 — persists across restarts.)

import { LIVE_REPLAY_TTL_MS } from '../../src/online/protocol.ts';
import type { MatchResult } from '../../src/types.ts';

interface CachedReplay {
  result: MatchResult;
  expiresAt: number;
}

const replays = new Map<string, CachedReplay>();

/** Cache a full (frame-bearing) MatchResult for live replay fetching. */
export function cacheLiveReplay(matchId: string, result: MatchResult): void {
  replays.set(matchId, { result, expiresAt: Date.now() + LIVE_REPLAY_TTL_MS });
  // Light-touch GC: sweep expired entries each insert, no separate timer needed.
  if (replays.size > 64) {
    const now = Date.now();
    for (const [id, r] of replays.entries()) {
      if (r.expiresAt <= now) replays.delete(id);
    }
  }
}

/** Returns the cached MatchResult if still in TTL window, else null. */
export function getLiveReplay(matchId: string): MatchResult | null {
  const entry = replays.get(matchId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    replays.delete(matchId);
    return null;
  }
  return entry.result;
}

