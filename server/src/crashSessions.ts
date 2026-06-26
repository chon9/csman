// In-memory Crash / Rocket session store. One active round per team max —
// starting a new round while another is open is rejected. The server picks
// the bust point at start time (using the canonical fair-with-edge formula
// below) and holds it secret until the client either cashes out or rides
// past it. Sessions are dropped after resolution; nothing persists across
// restarts (a server restart cancels in-flight bets — we refund on start
// only, never on bust, so a restart at worst loses the player nothing).

import { randomBytes } from 'node:crypto';
import {
  CRASH_GROWTH_RATE_PER_MS,
  CRASH_HOUSE_EDGE,
  CRASH_INSTANT_BUST_CHANCE,
} from '../../src/online/protocol.ts';

export interface CrashSession {
  sessionId: string;
  teamId: string;
  bet: number;
  /** ms since epoch when the round started. */
  startedAt: number;
  /** Secret multiplier at which the rocket explodes. Always ≥ 1.0. */
  crashAt: number;
}

const sessions = new Map<string, CrashSession>();

/**
 * Pick a bust point with a fat-tail distribution and the configured house
 * edge baked in. With INSTANT_BUST_CHANCE = 0.01 and HOUSE_EDGE = 0.01 the
 * formula gives ≈ 0.99 × bet expected return — players win some, but the
 * house wins long-term, same as a real Crash game.
 *
 *   - 1% chance: bust at 1.00 (insta-rug)
 *   - 99% chance: bust at (1 - HOUSE_EDGE) / (1 - u), u ∈ [0, 1)
 *
 * Median bust ≈ 2.0× → cashing out at 2× wins roughly half the time.
 */
export function rollCrashPoint(): number {
  if (Math.random() < CRASH_INSTANT_BUST_CHANCE) return 1.0;
  const u = Math.random(); // [0, 1)
  // Clamp away from 1.0 so we don't divide by ~0 and get Infinity.
  const safeU = Math.min(u, 0.999_999);
  const raw = (1 - CRASH_HOUSE_EDGE) / (1 - safeU);
  // Two-decimal precision is enough — keeps the wire payload + UI tidy.
  return Math.max(1.0, Math.round(raw * 100) / 100);
}

/** Current multiplier from elapsed real-time, using the exponential curve. */
export function multiplierAt(startedAt: number, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - startedAt);
  const m = Math.exp(CRASH_GROWTH_RATE_PER_MS * elapsed);
  return Math.max(1.0, Math.round(m * 100) / 100);
}

/** Create + register a new session. Caller is responsible for already
 *  deducting the bet from team money before calling this. */
export function openSession(teamId: string, bet: number): CrashSession {
  // Cancel any stale open session for this team — refusing to open a new
  // one if the client somehow lost track of the old session would be bad
  // UX. We just drop it; the bet was already deducted on the previous
  // open call, so nothing to refund.
  for (const [id, s] of sessions.entries()) {
    if (s.teamId === teamId) sessions.delete(id);
  }
  const session: CrashSession = {
    sessionId: randomBytes(8).toString('hex'),
    teamId,
    bet,
    startedAt: Date.now(),
    crashAt: rollCrashPoint(),
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId: string): CrashSession | null {
  return sessions.get(sessionId) ?? null;
}

export function closeSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Iterate every active session — used by the global bust ticker. */
export function activeSessions(): IterableIterator<CrashSession> {
  return sessions.values();
}

/**
 * Boot the global bust ticker. Every `intervalMs` real ms, the server
 * walks all active Crash sessions, computes the live multiplier from its
 * own clock, and fires `onBust` for any whose curve has crossed `crashAt`.
 * This is what makes the bust authoritative: there's no client-side timer
 * the user can spoof. Even if a cashout message is in flight when the
 * tick fires, the bust wins — we delete the session before invoking
 * the callback so a racing cashout handler will see "no session" and
 * reject as a stale request.
 *
 * 50 ms ≈ 20 Hz — sub-frame precision for bust detection while still
 * being cheap (one Map iteration per tick, typically <10 entries).
 */
let bustTicker: NodeJS.Timeout | null = null;

export function startBustTicker(
  intervalMs: number,
  onBust: (session: CrashSession) => void,
): void {
  if (bustTicker) clearInterval(bustTicker);
  bustTicker = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      const m = multiplierAt(session.startedAt, now);
      if (m >= session.crashAt) {
        // Remove first so a racing cashout will fail the "session exists"
        // check rather than double-resolving the round.
        sessions.delete(session.sessionId);
        try {
          onBust(session);
        } catch (err) {
          // Don't let one bad callback take down the ticker for everyone.
          console.error('[crash-ticker] onBust threw', err);
        }
      }
    }
  }, intervalMs);
  bustTicker.unref();
}

export function stopBustTicker(): void {
  if (bustTicker) {
    clearInterval(bustTicker);
    bustTicker = null;
  }
}
