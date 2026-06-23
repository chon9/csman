// Long-career sustainability: retirement at season rollover and an annual
// youth intake of newgens. Without these the same 188 players would just keep
// aging forever and the talent pool would ossify.

import type { GameState, HallOfFameEntry, Player, PlayerRole, Region } from '../types';
import { RNG, hashSeed } from '../engine/rng';
import { NEWGEN_POOLS } from '../data/newgenNames';
import { buildPlayer, type PlayerSpec } from '../data/dbBuild';

/**
 * Per-age base retirement probability. Tuned so the average pro career runs to
 * ~30-31 with rare 34-35 year olds still hanging on — matches real CS pro careers.
 * Below 28 = never retires.
 */
const RETIRE_PROB_BY_AGE: Record<number, number> = {
  28: 0.01,
  29: 0.03,
  30: 0.08,
  31: 0.16,
  32: 0.28,
  33: 0.45,
  34: 0.65,
  35: 0.82,
};

export interface RetirementEvent {
  playerId: string;
  /** HOF snapshot captured before the player record was deleted. */
  hof: HallOfFameEntry;
  /** Player nickname (convenience — already in hof). */
  nickname: string;
  /** Was on user team at the moment of retirement. */
  wasOnUserTeam: boolean;
  /** "Star" by lifetime ability (drives whether news posts publicly). */
  wasStar: boolean;
}

/** Score a HOF career — drives the default sort on the Hall of Fame screen.
 *  Weighted blend of trophies, career rating, longevity, and elite MVP awards. */
function hofScoreOf(p: Player): number {
  const honours = p.honours ?? [];
  const mvpCount = honours.filter((h) => h.kind.includes('mvp') || h.kind.includes('best')).length;
  const longevityYears = Math.max(0, p.age - 17); // years pro, approx
  return Math.round(
    honours.length * 18 +
      mvpCount * 12 +
      p.stats.rating * 100 +
      Math.min(longevityYears, 15) * 4 +
      Math.min(p.stats.maps, 800) * 0.05,
  );
}

/** Returns the retirement events for this tick. The caller is responsible for
 *  pushing inbox messages, news posts, and unlocking achievements based on these. */
export function attemptRetirements(g: GameState, today: string, rng: RNG): RetirementEvent[] {
  const year = parseInt(today.slice(0, 4), 10);
  const events: RetirementEvent[] = [];
  for (const p of Object.values(g.players)) {
    if (p.age < 28) continue;
    const base = RETIRE_PROB_BY_AGE[p.age] ?? (p.age >= 36 ? 0.95 : 0);
    // Form / rating modifiers: slumping vets retire sooner, hot stars hang on.
    const formMod = p.form < 8 ? 0.1 : p.form > 14 ? -0.07 : 0;
    const ratingMod = p.stats.rating < 0.95 ? 0.08 : p.stats.rating > 1.15 ? -0.07 : 0;
    const benchMod = p.teamId && g.teams[p.teamId]?.playerIds.indexOf(p.id) >= 5 ? 0.05 : 0;
    const prob = Math.max(0, Math.min(0.95, base + formMod + ratingMod + benchMod));
    if (!rng.chance(prob)) continue;

    const wasOnUserTeam = p.teamId === g.userTeamId;
    const wasStar = p.currentAbility >= 150;
    // Snapshot to HOF — captures clubs played for, honours, lifetime stats.
    const clubs: HallOfFameEntry['clubs'] = (p.clubHistory ?? []).map((c) => ({
      teamId: c.teamId,
      teamName: c.teamName,
    }));
    // If clubHistory was empty (legacy save) but they retired on a team, record that one.
    if (clubs.length === 0 && p.teamId && g.teams[p.teamId]) {
      clubs.push({ teamId: p.teamId, teamName: g.teams[p.teamId].name });
    }
    const hof: HallOfFameEntry = {
      playerId: p.id,
      nickname: p.nickname,
      fullName: `${p.firstName} ${p.lastName}`.trim(),
      nationality: p.nationality,
      role: p.role,
      retiredYear: year,
      retiredAge: p.age,
      careerRating: Math.round(p.stats.rating * 100) / 100,
      careerMaps: p.stats.maps,
      honours: [...(p.honours ?? [])],
      clubs,
      hofScore: hofScoreOf(p),
      retiredOnUserTeam: wasOnUserTeam,
    };

    // Remove from team roster
    if (p.teamId) {
      const team = g.teams[p.teamId];
      if (team) team.playerIds = team.playerIds.filter((id) => id !== p.id);
    }

    events.push({ playerId: p.id, hof, nickname: p.nickname, wasOnUserTeam, wasStar });
  }

  // Persist HOF entries + clean up references.
  g.hallOfFame ??= [];
  for (const ev of events) {
    g.hallOfFame.push(ev.hof);
    delete g.players[ev.playerId];
    if (g.scoutReports?.[ev.playerId]) delete g.scoutReports[ev.playerId];
    if (g.interactions?.[ev.playerId]) delete g.interactions[ev.playerId];
    g.offers = g.offers.filter((o) => o.playerId !== ev.playerId);
    if (g.tactics.roleSlots) {
      for (const slot of g.tactics.roleSlots) {
        if (slot.playerId === ev.playerId) slot.playerId = null;
      }
    }
  }
  return events;
}

/**
 * Annual youth intake — generate ~24 new 16-19 year olds across regions.
 * Distribution roughly mirrors the real CS pro scene (Europe heavy, CIS solid,
 * Americas + Asia smaller). Talent ceiling varies: most are journeymen, a
 * handful are real prospects (high PA).
 */
const REGION_INTAKE: Record<Region, number> = {
  Europe: 10,
  CIS: 6,
  Americas: 5,
  Asia: 3,
};

const ROLES: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler'];

export function generateYouthIntake(g: GameState, year: number, rng: RNG): Player[] {
  const startDate = `${year}-01-05`;
  const generated: Player[] = [];
  const usedNicks = new Set(Object.values(g.players).map((p) => p.nickname.toLowerCase()));
  const usedIds = new Set(Object.keys(g.players));

  for (const [region, count] of Object.entries(REGION_INTAKE) as [Region, number][]) {
    const pool = NEWGEN_POOLS[region];
    for (let i = 0; i < count; i++) {
      // Talent distribution: 60% tier 4-5 (journeyman), 30% tier 3, 10% tier 2 (prospect)
      const talentRoll = rng.next();
      const tier: PlayerSpec['tier'] = talentRoll < 0.1 ? 2 : talentRoll < 0.4 ? 3 : talentRoll < 0.8 ? 4 : 5;
      const age = rng.int(16, 19);
      const role = rng.pick(ROLES);

      // Pick a nickname not already in use (prevents collisions across decades).
      // Fall back to a numeric suffix if exhausted.
      let nick = rng.pick(pool.nicks);
      let attempts = 0;
      while (usedNicks.has(nick.toLowerCase()) && attempts++ < 12) nick = rng.pick(pool.nicks);
      if (usedNicks.has(nick.toLowerCase())) nick = `${nick}${(year % 100).toString().padStart(2, '0')}`;
      // Ensure id uniqueness too (id derives from nick)
      const baseId = nick.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      let id = baseId;
      let suffix = 0;
      while (usedIds.has(id)) id = `${baseId}-${++suffix}`;
      usedNicks.add(nick.toLowerCase());
      usedIds.add(id);

      const spec: PlayerSpec = {
        nick: suffix > 0 ? `${nick}_${suffix}` : nick,
        first: rng.pick(pool.first),
        last: rng.pick(pool.last),
        nat: rng.pick(pool.nationalities),
        age,
        role,
        tier,
      };
      const player = buildPlayer(spec, null, startDate);
      // Override id to guarantee uniqueness (buildPlayer derives from nickname)
      player.id = id;
      // Boost potential ceiling for newgens — they're meant to develop
      const headroomBonus = tier === 2 ? rng.int(15, 30) : tier === 3 ? rng.int(8, 18) : rng.int(0, 8);
      player.potentialAbility = Math.min(200, player.potentialAbility + headroomBonus);
      g.players[player.id] = player;
      generated.push(player);
    }
  }

  // Headline inbox: the class of <year>
  const topProspects = [...generated]
    .sort((a, b) => b.potentialAbility - a.potentialAbility)
    .slice(0, 3)
    .map((p) => `${p.nickname} (PA ${p.potentialAbility}, ${p.nationality})`)
    .join(', ');
  g.inbox.push({
    id: `msg-newgen-${year}`,
    date: `${year}-01-05`,
    category: 'scouting',
    subject: `Class of ${year}: ${generated.length} new prospects enter the scene`,
    body:
      `A fresh wave of academy graduates has joined the free agent pool. ` +
      `Top prospects to watch: ${topProspects}. ` +
      `Check the Scouting screen → Free Agents to find your next star.`,
    read: false,
  });
  return generated;
}

/**
 * Prune stale state at rollover so saves don't bloat indefinitely:
 * - matchHistory: keep only the current + previous season (by date prefix).
 * - inbox: drop read messages older than 60 days (keeps unread + recent ones).
 */
export function pruneStaleState(g: GameState, newYearStart: string): void {
  const cutoffYear = parseInt(newYearStart.slice(0, 4)) - 1;
  g.matchHistory = g.matchHistory.filter((m) => {
    // matches don't carry a date directly — use the first map's first round frame? simpler:
    // approximate by id prefix or just keep last N. Cap at 200 matches.
    return true; // placeholder, replaced below
  });
  // Hard cap on matchHistory (last 200 matches is plenty for stats / Hall of Fame)
  if (g.matchHistory.length > 200) {
    g.matchHistory = g.matchHistory.slice(-200);
  }
  // Cap on processedDates as well
  if (g.processedDates.length > 800) {
    g.processedDates = g.processedDates.slice(-800);
  }
  // Inbox: drop read messages older than 60 days
  const cutoffDate = subtractDays(newYearStart, 60);
  g.inbox = g.inbox.filter((m) => !m.read || m.date >= cutoffDate);
  // Hard cap on inbox at 200 messages (drops oldest first regardless of read state)
  if (g.inbox.length > 200) {
    g.inbox = g.inbox.slice(-200);
  }
  // Schedule grows every season — drop finished matches older than 120 days.
  // Scheduled (future) matches always kept. Without this the schedule array
  // accumulates years of finished fixtures, bloating saves + slowing every
  // .filter() call that scans it (Bc Gaming, Schedule screen, AI ticks).
  const scheduleCutoff = subtractDays(newYearStart, 120);
  g.schedule = g.schedule.filter((m) => m.status !== 'finished' || m.date >= scheduleCutoff);
  // Sportsbook bet history was capped per-settle but keep a hard cap here too.
  if (g.sportsbookBets && g.sportsbookBets.length > 80) {
    const pending = g.sportsbookBets.filter((b) => b.status === 'pending');
    const settled = g.sportsbookBets
      .filter((b) => b.status !== 'pending')
      .slice(-60);
    g.sportsbookBets = [...pending, ...settled];
  }
  void cutoffYear; // unused for now (year-based pruning could replace count-based)
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
