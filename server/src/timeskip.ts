// Time-skip: pay $TIME_SKIP_COST_PER_DAY per day to fast-forward this
// team's clock. Runs the weekly training tick for each "Monday" (here,
// every 7 advanced days starting at day % 7) and bumps player ages once
// per simulated year.

import { RNG, hashSeed } from '../../src/engine/rng.ts';
import { applyWeeklyTraining, dailyPlayerTick } from '../../src/sim/daily.ts';
import { TIME_SKIP_COST_PER_DAY } from '../../src/online/protocol.ts';
import type { DevChange, PlayerGoal } from '../../src/online/protocol.ts';
import type { Player, PlayerAttributes, Team, TrainingSetup } from '../../src/types.ts';
import type { TeamRow } from './db.ts';

export interface TimeSkipResult {
  newDay: number;
  daysAdvanced: number;
  /** Aggregated training notes across every weekly tick that fired. */
  trainingNotes: string[];
  /** Total cost charged to the team. */
  cost: number;
  /** Per-player CA deltas — only players whose CA actually moved are listed. */
  devChanges: DevChange[];
  /** Goals that crossed their target during this skip. */
  goalsReached: { playerId: string; nickname: string; attr: string; target: number }[];
}

/**
 * Advance the team's clock by `days`, charging the per-day fee and running
 * the weekly training tick on each crossed week boundary. Mutates `team.day`,
 * `team.money`, and the players' attributes/form/fatigue/morale.
 *
 * If `openGoals` is provided, the function snapshots the targeted attrs
 * before each tick and reports back any that crossed their target.
 */
export function skipTime(
  team: TeamRow,
  players: Player[],
  days: number,
  openGoals: PlayerGoal[] = [],
  coachSkill?: number,
): TimeSkipResult {
  const cost = days * TIME_SKIP_COST_PER_DAY;
  if (team.money < cost) {
    return {
      newDay: team.day,
      daysAdvanced: 0,
      trainingNotes: [`Insufficient funds: skip costs $${cost.toLocaleString()} but you have $${team.money.toLocaleString()}.`],
      cost: 0,
      devChanges: [],
      goalsReached: [],
    };
  }

  team.money -= cost;
  const startDay = team.day;
  const endDay = startDay + days;
  const notes: string[] = [];
  // Snapshot CA before any training fires so we can report per-player deltas.
  const caBefore = new Map(players.map((p) => [p.id, p.currentAbility]));
  // Snapshot the attrs targeted by open goals so we can detect crossings.
  const goalSnapshots = new Map<string, number>(); // key = `${playerId}:${attr}`
  for (const g of openGoals) {
    const p = players.find((pl) => pl.id === g.playerId);
    if (!p) continue;
    const before = p.attributes[g.attr as keyof PlayerAttributes];
    if (typeof before === 'number') goalSnapshots.set(`${g.playerId}:${g.attr}`, before);
  }

  // For applyWeeklyTraining we need a Team-shaped object (it reads
  // playerIds + mapPool + coachSkill). The TeamRow has playerIds + a
  // synthesized mapPool wouldn't make sense yet, so we fake it lightly.
  // Coach skill drives the engine's growth rate — hire a coach to boost it.
  const engineTeam: Team = {
    id: team.id,
    name: team.name,
    tag: team.tag,
    region: team.region,
    reputation: 100,
    budget: team.money,
    playerIds: team.playerIds,
    coachName: 'Coach',
    coachSkill: typeof coachSkill === 'number' ? Math.max(8, Math.min(20, coachSkill)) : 12,
    mapPool: [],
    worldRanking: 50,
    rankingPoints: 100,
  };
  const playerLookup: Record<string, Player> = Object.fromEntries(players.map((p) => [p.id, p]));

  // Walk day-by-day so the daily recovery tick (fatigue down + morale drift)
  // ACTUALLY fires for paid skips — the previous loop only ran the weekly
  // training tick, leaving fatigue stuck across whole-week skips. Mirrors
  // what autoTick.ts does for the silent 4-hour cadence so the two paths
  // behave identically.
  // dailyPlayerTick uses `today` to compute injury return dates via addDays(),
  // which calls `new Date(today + 'T00:00:00Z')`. A non-ISO string crashes
  // the request with "Invalid time value" the moment an injury rolls.
  // Pass the real wall-clock date; the per-iteration RNG seed gives the
  // unique entropy this loop needs without overloading the date param.
  const todayIso = new Date().toISOString().slice(0, 10);
  for (let dayOffset = 1; dayOffset <= days; dayOffset++) {
    const absDay = startDay + dayOffset;
    const dayRng = new RNG(hashSeed(`skip-${team.id}-${absDay}`));
    dailyPlayerTick(playerLookup, todayIso, dayRng);
    // Every 7th day from startDay → weekly training tick. Smart focus:
    // rest if the squad is exhausted, low-intensity aim otherwise. Either
    // way, no fatigue is ADDED — only removed (or zero net).
    if (dayOffset % 7 === 0) {
      const starters = team.playerIds.slice(0, 5).map((id) => playerLookup[id]).filter(Boolean);
      const avgFatigue = starters.length
        ? starters.reduce((s, p) => s + p.fatigue, 0) / starters.length
        : 0;
      const training: TrainingSetup = avgFatigue >= 60
        ? { focus: 'rest', intensity: 1, mapPrep: null }
        : { focus: 'aim', intensity: 1, mapPrep: null };
      const rng = new RNG(hashSeed(`timeskip-${team.id}-${absDay}`));
      const result = applyWeeklyTraining(engineTeam, playerLookup, training, rng);
      if (result.gains > 0 || result.regressions > 0) {
        notes.push(`Week ending day ${absDay}: ${result.gains} attribute gains, ${result.regressions} regressions.`);
      }
      for (const line of result.notes.slice(0, 2)) notes.push(`  ${line}`);
    }
  }

  team.day = endDay;
  // Build the dev-arc payload — only players who actually moved.
  const devChanges: DevChange[] = [];
  for (const p of players) {
    const before = caBefore.get(p.id) ?? p.currentAbility;
    if (before !== p.currentAbility) {
      devChanges.push({ playerId: p.id, nickname: p.nickname, caBefore: before, caAfter: p.currentAbility });
    }
  }
  // Check goal crossings.
  const goalsReached: TimeSkipResult['goalsReached'] = [];
  for (const g of openGoals) {
    const p = players.find((pl) => pl.id === g.playerId);
    if (!p) continue;
    const before = goalSnapshots.get(`${g.playerId}:${g.attr}`);
    const after = p.attributes[g.attr as keyof PlayerAttributes];
    if (typeof before === 'number' && typeof after === 'number' && before < g.target && after >= g.target) {
      goalsReached.push({ playerId: p.id, nickname: p.nickname, attr: g.attr, target: g.target });
    }
  }
  return {
    newDay: endDay,
    daysAdvanced: days,
    trainingNotes: notes.length > 0 ? notes : ['Quiet stretch — no attribute changes recorded.'],
    cost,
    devChanges,
    goalsReached,
  };
}
