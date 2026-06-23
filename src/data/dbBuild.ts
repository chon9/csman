import type {
  MapName,
  Player,
  PlayerAttributes,
  PlayerRole,
  Region,
  Team,
} from '../types';
import { ALL_MAPS } from '../types';
import { RNG, hashSeed } from '../engine/rng';

// Compact spec format used by the roster files
export interface PlayerSpec {
  nick: string;
  first: string;
  last: string;
  nat: string;
  age: number;
  role: PlayerRole;
  tier: 1 | 2 | 3 | 4 | 5; // 1 = superstar, 5 = weak
  attrs?: Partial<PlayerAttributes>;
  /** HLTV player id — enables lazy-loading bodyshot from img-cdn.hltv.org. */
  hltvId?: number;
}

export interface TeamSpec {
  id: string;
  name: string;
  tag: string;
  region: Region;
  rank: number;
  budget: number;
  coach: string;
  coachSkill: number;
  strongMaps: MapName[];
  weakMaps: MapName[];
  players: PlayerSpec[]; // 5, order = starting lineup
  /** HLTV team id — enables lazy-loading team logo from img-cdn.hltv.org. */
  hltvId?: number;
}

const TIER_BASE: Record<number, number> = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 10 };

const clamp = (v: number) => Math.max(1, Math.min(20, Math.round(v)));

function roleShape(role: PlayerRole, a: PlayerAttributes): void {
  switch (role) {
    case 'AWPer':
      a.aim += 2; a.reflexes += 2; a.positioning += 1; a.aggression -= 1;
      break;
    case 'IGL':
      a.leadership += 5; a.gameSense += 3; a.communication += 3; a.aim -= 2; a.reflexes -= 1;
      break;
    case 'Entry':
      a.aggression += 5; a.reflexes += 1; a.teamwork += 1; a.positioning -= 1;
      break;
    case 'Lurker':
      a.gameSense += 2; a.positioning += 2; a.clutch += 1; a.aggression -= 3;
      break;
    case 'Support':
      a.utility += 3; a.teamwork += 2; a.communication += 1; a.aggression -= 3;
      break;
    case 'Rifler':
      a.aim += 1; a.consistency += 1;
      break;
    case 'Anchor':
      a.positioning += 3; a.composure += 2; a.discipline += 2; a.utility += 1; a.aggression -= 2;
      break;
  }
}

export function buildPlayer(spec: PlayerSpec, teamId: string | null, startDate: string): Player {
  const rng = new RNG(hashSeed(spec.nick));
  const base = TIER_BASE[spec.tier];
  const a: PlayerAttributes = {
    aim: base, reflexes: base, positioning: base, utility: base - 1,
    clutch: base - 1, gameSense: base, communication: base - 2, leadership: base - 4,
    consistency: base - 1, composure: base - 1, aggression: 10, teamwork: base - 1,
    resilience: base - 1, discipline: base - 1, loyalty: rng.int(8, 16), endurance: base - 1,
  };
  // individual jitter
  for (const k of Object.keys(a) as (keyof PlayerAttributes)[]) {
    a[k] += rng.int(-1, 1);
  }
  roleShape(spec.role, a);
  Object.assign(a, spec.attrs);
  for (const k of Object.keys(a) as (keyof PlayerAttributes)[]) a[k] = clamp(a[k]);

  const core = a.aim + a.reflexes + a.positioning + a.utility + a.gameSense + a.clutch + a.consistency + a.composure;
  const currentAbility = Math.max(40, Math.min(200, Math.round(core * 1.25)));
  const headroom =
    spec.age <= 20 ? rng.int(18, 35) : spec.age <= 23 ? rng.int(8, 22) : spec.age <= 27 ? rng.int(2, 9) : rng.int(0, 3);
  const potentialAbility = Math.min(200, currentAbility + headroom);

  const askingPrice = Math.max(50000, Math.round(Math.pow(Math.max(0, currentAbility - 100), 2) * 350));
  const wage = Math.max(8000, Math.round((currentAbility * 300 - 20000) / 500) * 500);
  const years = rng.int(1, 3);
  const expires = `${parseInt(startDate.slice(0, 4)) + years}-${startDate.slice(5, 7)}-01`;

  // Seed role experience — natural role is Natural (150). Veterans pick up
  // adjacent-role familiarity from playing alongside teammates; juniors stay raw.
  const expBase = spec.age >= 25 ? rng.int(30, 70) : spec.age >= 22 ? rng.int(15, 45) : rng.int(0, 20);
  const roleExperience: Partial<Record<PlayerRole, number>> = {
    [spec.role]: 150,
    Rifler: spec.role === 'Rifler' ? 150 : Math.max(60, expBase + 20),
  };
  // Every non-natural role gets a baseline so familiarity is never undefined
  for (const r of ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Anchor'] as PlayerRole[]) {
    if (r === spec.role) continue;
    roleExperience[r] = Math.max(0, expBase + rng.int(-10, 10));
  }

  return {
    id: spec.nick.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    nickname: spec.nick,
    firstName: spec.first,
    lastName: spec.last,
    nationality: spec.nat,
    age: spec.age,
    role: spec.role,
    hltvId: spec.hltvId,
    attributes: a,
    currentAbility,
    potentialAbility,
    form: 10,
    morale: 12 + rng.int(0, 3),
    fatigue: 0,
    contract: teamId ? { wage, expires, buyout: Math.round(askingPrice * 1.2) } : null,
    teamId,
    stats: { maps: 0, kills: 0, deaths: 0, assists: 0, rating: 1.0, clutchesWon: 0, openingKills: 0, utilityDamage: 0 },
    transferListed: false,
    askingPrice,
    roleExperience,
    squadTier: teamId ? 'first' : undefined, // FA tier set when signed
  };
}

export function buildTeam(spec: TeamSpec, playerIds: string[]): Team {
  const rng = new RNG(hashSeed(spec.id));
  // Smooth reputation curve from #1 (200) down to a floor of 45 for the lowest
  // tier teams. Older slope clamped at 60 by rank 41, which flattened the
  // entire bottom of the table; this keeps a small spread.
  const reputation = Math.max(45, Math.min(200, Math.round(200 - (spec.rank - 1) * 3.0)));
  return {
    id: spec.id,
    name: spec.name,
    tag: spec.tag,
    region: spec.region,
    reputation,
    budget: spec.budget,
    playerIds,
    coachName: spec.coach,
    coachSkill: spec.coachSkill,
    hltvId: spec.hltvId,
    mapPool: ALL_MAPS.map((map) => {
      let prof: number;
      if (spec.strongMaps.includes(map)) prof = rng.int(15, 18);
      else if (spec.weakMaps.includes(map)) prof = rng.int(6, 9);
      else prof = rng.int(10, 13);
      return { map, proficiency: prof };
    }),
    worldRanking: spec.rank,
    // Linear from rank 1 ≈ 5000 pts down to rank 50 ≈ 100 pts — keeps ranking
    // points strictly positive at every table position so sort/league math
    // doesn't have to handle negatives.
    rankingPoints: Math.max(100, Math.round(5000 - (spec.rank - 1) * 100)),
  };
}
