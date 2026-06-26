// In-memory Mines session store. Each session holds the secret mine
// layout for one team's active round. Server is sole authority on
// every reveal — the client only ever sees tiles it has already picked
// (or the full layout once the round ends). No timers needed; the game
// is purely event-driven by client picks + cashout.

import { randomBytes } from 'node:crypto';
import { MINES_GRID_SIZE } from '../../src/online/protocol.ts';

export interface MinesSession {
  sessionId: string;
  teamId: string;
  bet: number;
  mineCount: number;
  /** Set of tile indices that are mines. Stable for the round. */
  mines: Set<number>;
  /** Set of tile indices already safely revealed. */
  revealed: Set<number>;
  startedAt: number;
}

const sessions = new Map<string, MinesSession>();

/** Pick `count` distinct tile indices in [0, MINES_GRID_SIZE). Uses
 *  Fisher-Yates partial shuffle for unbiased selection. */
function rollMines(count: number): Set<number> {
  const indices = Array.from({ length: MINES_GRID_SIZE }, (_, i) => i);
  // Partial shuffle — only need to shuffle the first `count` slots.
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (indices.length - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, count));
}

/** Create + register a new session. Caller is responsible for already
 *  deducting the bet from team money before calling this. */
export function openSession(teamId: string, bet: number, mineCount: number): MinesSession {
  // Cancel any stale open session for this team — same logic as Crash.
  for (const [id, s] of sessions.entries()) {
    if (s.teamId === teamId) sessions.delete(id);
  }
  const session: MinesSession = {
    sessionId: randomBytes(8).toString('hex'),
    teamId,
    bet,
    mineCount,
    mines: rollMines(mineCount),
    revealed: new Set(),
    startedAt: Date.now(),
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId: string): MinesSession | null {
  return sessions.get(sessionId) ?? null;
}

export function closeSession(sessionId: string): void {
  sessions.delete(sessionId);
}
