// Wall-clock auto-advance. Every team's day counter ticks forward by 1
// at every 4-hour UTC boundary (00:00 / 04:00 / 08:00 / 12:00 / 16:00 /
// 20:00 UTC — equivalent to 08/12/16/20/00/04 GMT+8). That's 6 in-game
// days per real-world day, synchronized for all teams.
//
// Catchup is lazy: the next time anyone hits the server for a team, we
// look at how many boundaries have crossed since last_auto_tick_at and
// apply that many day ticks (daily recovery + every-7th-day training).
// No background scheduler needed — refresh-state runs on every screen
// load and on an 8s interval, so users see the bump within ~10s of the
// boundary.

import type { DB, TeamRow } from './db.ts';
import { RNG, hashSeed } from '../../src/engine/rng.ts';
import { applyWeeklyTraining, dailyPlayerTick } from '../../src/sim/daily.ts';
import type { Player, Team, TrainingSetup } from '../../src/types.ts';
import { ALL_MAPS, DEFAULT_TACTICS } from '../../src/types.ts';
import { fansForRoster } from '../../src/online/protocol.ts';

/** Length of one in-game day in real-world ms. 4 hours. */
export const AUTO_TICK_MS = 4 * 3600 * 1000;
/** Safety cap on per-call catchup so a team offline for months doesn't
 *  hang the server while the day loop runs thousands of iterations. */
const MAX_CATCHUP_DAYS = 60;

/** Next 4-hour UTC boundary strictly after `now` (in ms). */
export function nextAutoTickUtcMs(now: number = Date.now()): number {
  return (Math.floor(now / AUTO_TICK_MS) + 1) * AUTO_TICK_MS;
}

/** Build a slim Team-shaped object the engine needs without a full mapPool. */
function teamForEngine(row: TeamRow, coachSkill: number): Team {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    region: row.region,
    reputation: 100,
    budget: row.money,
    playerIds: row.playerIds,
    coachName: 'Coach',
    coachSkill: Math.max(8, Math.min(20, coachSkill)),
    mapPool: ALL_MAPS.map((map) => ({ map, proficiency: 12 })),
    worldRanking: 50,
    rankingPoints: 100,
    tactics: { ...DEFAULT_TACTICS, ...row.tactics },
  };
}

export interface AutoTickResult {
  /** Days the team advanced this call. Zero means nothing changed. */
  daysAdvanced: number;
  /** New team.day after advancing. */
  newDay: number;
  /** UTC ms of the next boundary (for the client countdown). */
  nextTickUtcMs: number;
}

/**
 * Catch a team up to the current wall clock. Idempotent — if no boundary
 * crossed since last tick, no-op. Persists team.day + players. Coach skill
 * comes from the team's hired coach (if any) so training gains scale.
 */
export function applyAutoTicks(db: DB, teamId: string, now: number = Date.now()): AutoTickResult {
  const team = db.loadTeam(teamId);
  if (!team) {
    return { daysAdvanced: 0, newDay: 0, nextTickUtcMs: nextAutoTickUtcMs(now) };
  }
  const anchor = db.getAutoTickAnchor(teamId);
  // First-ever call: seed the anchor to now and skip — we don't fast-forward
  // teams retroactively. Future calls will tick normally from this point.
  if (anchor === 0) {
    db.setAutoTickAnchor(teamId, now);
    return { daysAdvanced: 0, newDay: team.day, nextTickUtcMs: nextAutoTickUtcMs(now) };
  }
  // First boundary strictly after the anchor.
  const firstBoundary = (Math.floor(anchor / AUTO_TICK_MS) + 1) * AUTO_TICK_MS;
  if (firstBoundary > now) {
    return { daysAdvanced: 0, newDay: team.day, nextTickUtcMs: firstBoundary };
  }
  let daysAdvanced = Math.floor((now - firstBoundary) / AUTO_TICK_MS) + 1;
  if (daysAdvanced > MAX_CATCHUP_DAYS) daysAdvanced = MAX_CATCHUP_DAYS;

  const players = db.loadTeamPlayers(teamId);
  const playerLookup: Record<string, Player> = Object.fromEntries(players.map((p) => [p.id, p]));
  const hiredCoach = db.loadHiredCoachFor(teamId);
  const coachSkill = hiredCoach?.skill ?? 12;
  const engineTeam = teamForEngine(team, coachSkill);

  // dailyPlayerTick passes `today` to addDays() when an injury rolls.
  // That helper does `new Date(today + 'T00:00:00Z')`, so any non-ISO
  // string explodes with "Invalid time value" the moment the random
  // injury roll lands. Use the real wall-clock date — the per-day RNG
  // seed gives all the entropy this loop needs.
  const todayIso = new Date().toISOString().slice(0, 10);
  // Merch revenue accrued across all advanced game days. Fans are cheap
  // per-tick but stack — high-audience teams generate a real passive
  // income layer. See MERCH_RATE below for the tuning knob.
  const totalFans = fansForRoster(players) + db.getTeamBonusFans(teamId);
  let merchAccrued = 0;
  for (let i = 0; i < daysAdvanced; i++) {
    team.day += 1;
    const dayRng = new RNG(hashSeed(`auto-${team.id}-${team.day}`));
    dailyPlayerTick(playerLookup, todayIso, dayRng);
    // $2 per 1000 fans per game-day tick. Since AUTO_TICK_MS = 4 hours
    // there are 6 game days per UTC day → daily merch = fans × 0.012.
    // Examples: 50k fans → $600/day · 100k → $1200/day · 500k → $6000/day.
    merchAccrued += Math.floor(totalFans / 500);
    if (team.day % 7 === 0) {
      // Smart focus: if the squad is exhausted, run a rest week (flat -18
      // fatigue + small morale lift) instead of stacking +4 fatigue from a
      // normal training intensity. Otherwise low-intensity training so the
      // weekly tick doesn't fight the daily recovery.
      const starters = team.playerIds.slice(0, 5).map((id) => playerLookup[id]).filter(Boolean);
      const avgFatigue = starters.length
        ? starters.reduce((s, p) => s + p.fatigue, 0) / starters.length
        : 0;
      const training: TrainingSetup = avgFatigue >= 60
        ? { focus: 'rest', intensity: 1, mapPrep: null }
        : { focus: 'aim', intensity: 1, mapPrep: null };
      const weekRng = new RNG(hashSeed(`autoweek-${team.id}-${team.day}`));
      applyWeeklyTraining(engineTeam, playerLookup, training, weekRng);
    }
  }

  // Persist. team.money may have grown from merch revenue this pass.
  if (merchAccrued > 0) team.money += merchAccrued;
  db.setTeamMoneyDay(team.id, team.money, team.day);
  for (const p of players) db.persistPlayer(p);
  // Anchor jumps forward to the most recent boundary we applied.
  const newAnchor = firstBoundary + (daysAdvanced - 1) * AUTO_TICK_MS;
  db.setAutoTickAnchor(teamId, newAnchor);

  return {
    daysAdvanced,
    newDay: team.day,
    nextTickUtcMs: nextAutoTickUtcMs(now),
  };
}
