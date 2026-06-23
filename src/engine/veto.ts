import { ALL_MAPS, type MapName, type MatchFormat, type Team } from '../types';
import type { RNG } from './rng';

export interface VetoResult {
  maps: MapName[];
  log: string[];
}

function teamPref(team: Team, priority: MapName[] | null): MapName[] {
  // Order maps worst-first for banning (team bans its weakest / opponent-strong maps)
  const prof = new Map(team.mapPool.map((m) => [m.map, m.proficiency]));
  if (priority) {
    // user-defined priority list (best first) → ban from the end
    return [...priority];
  }
  return [...ALL_MAPS].sort((a, b) => (prof.get(b) ?? 10) - (prof.get(a) ?? 10));
}

/**
 * Standard CS2 veto:
 * BO1: A ban, B ban, A ban, B ban, A ban, B ban, last map plays
 * BO3: A ban, B ban, A pick, B pick, A ban, B ban, last is decider
 * BO5: A ban, B ban, then alternating picks, last is map 5
 */
export function runVeto(
  teamA: Team,
  teamB: Team,
  format: MatchFormat,
  userPriorityA: MapName[] | null,
  userPriorityB: MapName[] | null,
  rng: RNG,
): VetoResult {
  let pool = [...ALL_MAPS];
  const prefA = teamPref(teamA, userPriorityA);
  const prefB = teamPref(teamB, userPriorityB);
  const log: string[] = [];
  const picked: MapName[] = [];

  const banWorst = (pref: MapName[], team: Team) => {
    // ban lowest-priority map still in pool (with slight randomness)
    const candidates = pref.filter((m) => pool.includes(m));
    const target = rng.chance(0.8) ? candidates[candidates.length - 1] : candidates[Math.max(0, candidates.length - 2)];
    pool = pool.filter((m) => m !== target);
    log.push(`${team.tag} ban ${target}`);
  };
  const pickBest = (pref: MapName[], team: Team) => {
    const candidates = pref.filter((m) => pool.includes(m));
    const target = candidates[0];
    pool = pool.filter((m) => m !== target);
    picked.push(target);
    log.push(`${team.tag} pick ${target}`);
  };

  if (format === 'BO1') {
    banWorst(prefA, teamA); banWorst(prefB, teamB);
    banWorst(prefA, teamA); banWorst(prefB, teamB);
    banWorst(prefA, teamA); banWorst(prefB, teamB);
    picked.push(pool[0]);
    log.push(`${pool[0]} is the decider`);
  } else if (format === 'BO3') {
    banWorst(prefA, teamA); banWorst(prefB, teamB);
    pickBest(prefA, teamA); pickBest(prefB, teamB);
    banWorst(prefA, teamA); banWorst(prefB, teamB);
    picked.push(pool[0]);
    log.push(`${pool[0]} is the decider`);
  } else {
    banWorst(prefA, teamA); banWorst(prefB, teamB);
    pickBest(prefA, teamA); pickBest(prefB, teamB);
    pickBest(prefA, teamA); pickBest(prefB, teamB);
    picked.push(pool[0]);
    log.push(`${pool[0]} is map five`);
  }

  return { maps: picked, log };
}
