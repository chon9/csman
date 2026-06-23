// Manager attribute → engine multiplier helpers. Centralised so every call site
// uses the same scaling and the design is tuned in one place.
//
// Attribute scale: 1-20 (lifetime, drifts with performance).
// Baseline (avg = 10) returns 1.0 — no effect either way.

import type { Achievement, AchievementId, GameState, MatchResult, Tournament } from '../types';

function attr(g: GameState, key: 'motivating' | 'youngsters' | 'press' | 'judgingTalent'): number {
  return g.manager?.attributes?.[key] ?? 10;
}

/** Morale bounceback bonus after a loss. Avg manager: 1.0, elite (20): 1.5, weak (1): 0.55. */
export function moraleBouncebackMult(g: GameState): number {
  return 1 + (attr(g, 'motivating') - 10) * 0.05;
}

/** Multiplier applied on top of the base mentor boost for a user-team mentee. */
export function mentorBoostMult(g: GameState): number {
  // Avg 1.0, elite 1.4, weak 0.7.
  return 1 + (attr(g, 'youngsters') - 10) * 0.04;
}

/** Multiplier on media-trust gains; >1 means tone backlash is softened. */
export function pressFactor(g: GameState): number {
  // Avg 1.0, elite 1.6, weak 0.5.
  return 1 + (attr(g, 'press') - 10) * 0.06;
}

/** Scout-report accuracy multiplier. >1 narrows the random variance. */
export function scoutAccuracyMult(g: GameState): number {
  // Avg 1.0, elite 1.5, weak 0.5.
  return 1 + (attr(g, 'judgingTalent') - 10) * 0.05;
}

// ============ Career arc: reputation + achievements ============

/** Reputation gain for winning a tournament, scaled by tier + Major flag. */
export function reputationForChampionship(t: Tournament): number {
  if (t.isMajor) return 8;
  if (t.tier === 'S') return 4;
  if (t.tier === 'A') return 2;
  return 1;
}

/** Look up a region for a team id, for the globetrotter achievement. */
function regionOf(g: GameState, teamId: string): string | undefined {
  return g.teams[teamId]?.region;
}

function unlockedAlready(m: GameState['manager'], id: AchievementId): boolean {
  return !!m && m.achievements.some((a) => a.id === id);
}

function addAchievement(g: GameState, id: AchievementId, context?: string): Achievement | null {
  const m = g.manager;
  if (!m || unlockedAlready(m, id)) return null;
  const a: Achievement = { id, unlockedOn: g.currentDate, context };
  m.achievements.push(a);
  // Reputation halo for unlocking an achievement.
  m.reputation = Math.max(0, Math.min(100, m.reputation + 3));
  return a;
}

/** Returns the list of achievements unlocked by this win (for inbox/news). */
export function applyManagerChampionship(
  g: GameState,
  tournament: Tournament,
  championTeamId: string,
): Achievement[] {
  const m = g.manager;
  if (!m || championTeamId !== g.userTeamId) return [];
  // Reputation + lifetime trophy count
  const repGain = reputationForChampionship(tournament);
  m.reputation = Math.max(0, Math.min(100, m.reputation + repGain));
  m.trophiesTotal += 1;
  // Update current stint
  const stint = m.career[m.career.length - 1];
  if (stint) {
    stint.trophies += 1;
    const rank = g.teams[g.userTeamId]?.worldRanking ?? 99;
    if (stint.bestRank == null || rank < stint.bestRank) stint.bestRank = rank;
  }
  // Achievement checks
  const unlocked: Achievement[] = [];
  if (tournament.isMajor) {
    const a1 = addAchievement(g, 'first-major', `Won ${tournament.name}`);
    if (a1) unlocked.push(a1);
    if (m.trophiesTotal >= 5) {
      const a2 = addAchievement(g, 'major-winner', `${m.trophiesTotal} trophies lifted`);
      if (a2) unlocked.push(a2);
    }
    // Underdog king: won a Major while ranked outside top 5
    const rank = g.teams[g.userTeamId]?.worldRanking ?? 99;
    if (rank > 5) {
      const a3 = addAchievement(g, 'underdog-king', `Won ${tournament.name} ranked #${rank}`);
      if (a3) unlocked.push(a3);
    }
  }
  if (m.trophiesTotal >= 10) {
    const a4 = addAchievement(g, 'serial-winner', `${m.trophiesTotal} career trophies`);
    if (a4) unlocked.push(a4);
  }
  // Globetrotter: managed in 3+ unique regions across career
  const regions = new Set(m.career.map((s) => regionOf(g, s.teamId)).filter(Boolean));
  if (regions.size >= 3) {
    const a5 = addAchievement(g, 'globetrotter', `Tenures across ${regions.size} regions`);
    if (a5) unlocked.push(a5);
  }
  return unlocked;
}

/** Season-end reputation drift from board objectives. Call from rolloverSeason. */
export function applyManagerSeasonReview(
  g: GameState,
  achieved: number,
  failed: number,
): void {
  const m = g.manager;
  if (!m) return;
  const delta = achieved * 2 - failed * 3;
  m.reputation = Math.max(0, Math.min(100, m.reputation + delta));
  // Hall of fame: sustained elite reputation
  if (m.reputation >= 85) addAchievement(g, 'hall-of-fame', `Reputation ${Math.round(m.reputation)}/100`);
  // Untouchable: rare end-of-season feat — top of world rankings AND <2 failed objectives.
  const userRank = g.teams[g.userTeamId]?.worldRanking ?? 99;
  if (userRank === 1 && failed <= 1) addAchievement(g, 'untouchable', `World #1 in ${g.seasonYear}`);
}

/** Apply manager-motivation bounceback bump to user-team players after a loss.
 *  Run AFTER applyMatchAftermath on the user-team match. Lifts morale a touch
 *  for elite motivators; nudges it down further for weak ones. */
export function applyManagerPostMatchBounceback(g: GameState, result: MatchResult): void {
  if (!g.manager) return;
  const lostUser = result.winnerId !== g.userTeamId;
  if (!lostUser) return;
  const mult = moraleBouncebackMult(g);
  const delta = (mult - 1) * 0.6; // ±0.3 morale at the extremes
  if (delta === 0) return;
  for (const map of result.maps) {
    for (const ps of Object.values(map.playerStats)) {
      const p = g.players[ps.playerId];
      if (!p || p.teamId !== g.userTeamId) continue;
      p.morale = Math.max(1, Math.min(20, p.morale + delta));
    }
  }
}
