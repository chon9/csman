// Auto-odds engine for the in-game sportsbook ("Bc Gaming"). Computes win
// probability from team ranking points + recent form, applies a bookmaker
// margin, and returns decimal odds.

import type { GameState, ScheduledMatch, Team } from '../types';

/** Bookmaker margin — the "overround". 1.0 = perfectly fair, lower = more juice. */
const BOOKMAKER_MARGIN = 0.94;

/** Look up the last N played matches for a team and compute a win rate. */
function recentForm(g: GameState, teamId: string, n = 8): number {
  let wins = 0, count = 0;
  for (let i = g.matchHistory.length - 1; i >= 0 && count < n; i--) {
    const m = g.matchHistory[i];
    if (m.teamAId !== teamId && m.teamBId !== teamId) continue;
    count++;
    if (m.winnerId === teamId) wins++;
  }
  return count > 0 ? wins / count : 0.5;
}

/** Compute raw win probability for team A vs team B, blending ranking + form. */
export function winProbability(
  g: GameState,
  teamA: Team,
  teamB: Team,
): { pA: number; pB: number } {
  // Ranking-points strength (scale to comparable range).
  const ptsA = Math.max(50, teamA.rankingPoints);
  const ptsB = Math.max(50, teamB.rankingPoints);
  const pRank = ptsA / (ptsA + ptsB);
  // Recent-form weight: 30% form, 70% ranking.
  const formA = recentForm(g, teamA.id);
  const formB = recentForm(g, teamB.id);
  const pForm = formA + formB > 0 ? formA / (formA + formB) : 0.5;
  let pA = pRank * 0.7 + pForm * 0.3;
  // Clamp to [0.05, 0.95] so we always price both sides.
  pA = Math.max(0.05, Math.min(0.95, pA));
  return { pA, pB: 1 - pA };
}

/** Decimal odds for both sides of a match, with bookmaker margin applied. */
export function decimalOdds(
  g: GameState,
  teamA: Team,
  teamB: Team,
): { oddsA: number; oddsB: number; pA: number; pB: number } {
  const { pA, pB } = winProbability(g, teamA, teamB);
  // Inverse probability × margin (margin <1 makes odds shorter so the book wins long-term).
  const oddsA = Math.max(1.01, (1 / pA) * BOOKMAKER_MARGIN);
  const oddsB = Math.max(1.01, (1 / pB) * BOOKMAKER_MARGIN);
  return {
    oddsA: Math.round(oddsA * 100) / 100,
    oddsB: Math.round(oddsB * 100) / 100,
    pA,
    pB,
  };
}

/** Format decimal odds for display — always 2dp with leading number trimmed. */
export function fmtOdds(o: number): string {
  return o.toFixed(2);
}

/** True if this match is still open for betting (scheduled and date in future). */
export function isBettable(m: ScheduledMatch, currentDate: string): boolean {
  return m.status === 'scheduled' && m.date >= currentDate;
}
