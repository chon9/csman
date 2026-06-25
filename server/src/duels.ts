// Duel resolution. Generates a synthetic AI team scaled to the user's
// roster, builds two EngineTeams, runs the existing simulateMatch from
// src/engine/matchEngine, then strips the result of frame data before
// storing while keeping frames in the wire reply (so the requesting
// client can show a replay / scoreboard).

import { RNG, hashSeed } from '../../src/engine/rng.ts';
import { simulateMatch, type EngineTeam } from '../../src/engine/matchEngine.ts';
import { applyMatchAftermath } from '../../src/sim/daily.ts';
import { MAP_LAYOUTS } from '../../src/data/maps.ts';
import { spawnInitialRoster } from './spawn.ts';
import {
  DEFAULT_TACTICS,
  type MatchFormat,
  type MatchResult,
  type Player,
  type Region,
  type Tactics,
  type Team,
  ALL_MAPS,
} from '../../src/types.ts';

/** Merge a sparse saved Tactics on top of DEFAULT_TACTICS. */
function resolveTactics(saved: Partial<Tactics> | undefined): Tactics {
  if (!saved) return DEFAULT_TACTICS;
  return { ...DEFAULT_TACTICS, ...saved };
}

/** Halve every form/morale/fatigue delta on a player. Used after a scrim so
 *  practice doesn't grind the squad like a real match does. */
function softenAftermath(before: Player[], after: Player[]): void {
  for (let i = 0; i < before.length; i++) {
    const b = before[i];
    const a = after[i];
    if (!b || !a || b.id !== a.id) continue;
    a.form = clamp01_20(b.form + (a.form - b.form) * 0.5);
    a.morale = clamp01_20(b.morale + (a.morale - b.morale) * 0.5);
    a.fatigue = clamp(b.fatigue + (a.fatigue - b.fatigue) * 0.5, 0, 100);
  }
}
function clamp01_20(v: number): number { return Math.max(1, Math.min(20, v)); }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
import type { TeamRow } from './db.ts';

const REGIONS: Region[] = ['Europe', 'CIS', 'Americas', 'Asia'];

// ~60 prefixes × ~20 suffixes = ~1200 unique team names. Mix of
// CS-flavoured words (animals, weapons, ops codenames, mythological
// figures, weather, regional flair) so the matchups feel varied. Plus
// a small chance of a "one-word brand" (no suffix) for that real-CS feel
// (Liquid, Astralis, Furia, etc.).
const AI_NAME_PREFIXES = [
  // Animals + predators
  'Apex', 'Cobra', 'Falcon', 'Mamba', 'Lynx', 'Raven', 'Wolf', 'Tiger',
  'Bison', 'Stag', 'Orca', 'Hawk', 'Viper', 'Jaguar', 'Wyvern', 'Drake',
  // Tactical / military
  'Vector', 'Vigil', 'Recon', 'Sentinel', 'Phalanx', 'Tactical', 'Squad-9',
  'Bravo', 'Echo', 'Foxtrot', 'Kilo', 'Tango', 'Zulu', 'Onyx-7',
  // Mythic / cosmic
  'Nova', 'Phantom', 'Spectre', 'Hydra', 'Phoenix', 'Tempest', 'Helix', 'Vanta',
  'Cipher', 'Mirage', 'Oblivion', 'Solaris', 'Lumen', 'Eclipse', 'Astral',
  'Halo', 'Aegis', 'Specter', 'Genesis',
  // Power / weather / industrial
  'Pulse', 'Reign', 'Storm', 'Surge', 'Voltage', 'Fission', 'Forge',
  'Anvil', 'Granite', 'Tungsten', 'Quartz', 'Ironclad', 'Carbon',
  // Regional / cultural flair
  'Saigon', 'Mekong', 'Manila', 'Kuala', 'Bangkok', 'Penang', 'Taipei',
  'Sapporo', 'Tashkent', 'Almaty', 'Riga', 'Athens', 'Lisbon', 'Reykjavik',
];
const AI_NAME_SUFFIXES = [
  'Esports', 'Gaming', 'Club', 'Collective', 'Squad', 'Project',
  'Initiative', 'United', 'Coalition', 'Order', 'Division', 'Federation',
  'Syndicate', 'Brigade', 'Foundation', 'Crew', 'Society', 'Dynasty',
  'Legion', 'Vanguard',
];
/** Roll-once brands that show up sans suffix — gives ~20% of generated
 *  teams the real-CS "one word" feel (think Liquid, Furia, Astralis). */
const AI_BRAND_ONLY = [
  'Liquid', 'Astralis', 'Furia', 'Verve', 'Eternity', 'Helios', 'Korona',
  'Cobalt', 'Riot', 'Outlaws', 'Pacific', 'Atlas', 'Citadel', 'Cosmos',
  'Diamond', 'Stratus', 'Catalyst', 'Aurora', 'Phantasm', 'Daydream',
];

/** Build a synthetic Team record for an AI opponent. Not persisted —
 *  exists only inside the simulateMatch call. */
function synthAiTeam(rng: RNG, region: Region): Team {
  // 20% chance: single-word brand (Liquid, Astralis, Furia vibe).
  // Otherwise: prefix + suffix (Cobra Esports, Helios Coalition, etc.).
  const brandOnly = rng.chance(0.2);
  const name = brandOnly
    ? rng.pick(AI_BRAND_ONLY)
    : `${rng.pick(AI_NAME_PREFIXES)} ${rng.pick(AI_NAME_SUFFIXES)}`;
  const tag = name.split(' ')[0].slice(0, 4).toUpperCase();
  return {
    id: `ai-${Math.floor(rng.next() * 1e9).toString(36)}`,
    name,
    tag,
    region,
    reputation: 100,
    budget: 0,
    playerIds: [],
    coachName: 'AI Coach',
    coachSkill: 14,
    mapPool: ALL_MAPS.map((map) => ({ map, proficiency: 12 + rng.int(-2, 3) })),
    worldRanking: 50,
    rankingPoints: 100,
  };
}

/** Generate an AI opponent scaled to the user's avg CA. Tilted hard in the
 *  player's favour — the AI averages about -12 CA across the swing range so
 *  most ranked duels are winnable. Occasional curveballs (+3 tilt + per-
 *  player jitter) keep it from being a foregone conclusion. */
export function generateAiOpponent(userPlayers: Player[], seed: number): { team: Team; players: Player[] } {
  const rng = new RNG(seed);
  const region = rng.pick(REGIONS);
  const team = synthAiTeam(rng, region);
  // Spawn 5 newgens at the same tier as the user (tier 3 baseline) — then
  // adjust their CA to approximately match the user's avg, plus a small
  // random tilt so duels feel different each time.
  const spawned = spawnInitialRoster(team.id, region, new Date().toISOString().slice(0, 10));
  const userAvgCA = userPlayers.length
    ? userPlayers.reduce((s, p) => s + p.currentAbility, 0) / userPlayers.length
    : 110;
  // Range -25..+3 → mean -11 CA. Per-player jitter narrowed to ±4 so wins
  // feel less swingy. Players should win the clear majority of ranked duels.
  const tilt = rng.int(-25, 3);
  for (const p of spawned) {
    const target = Math.max(60, Math.min(190, Math.round(userAvgCA + tilt + rng.int(-4, 4))));
    const delta = target - p.currentAbility;
    p.currentAbility = target;
    // Spread the delta across aim/reflexes/positioning so engine numbers reflect it.
    const bump = Math.round(delta / 4);
    p.attributes.aim = Math.max(1, Math.min(20, p.attributes.aim + bump));
    p.attributes.reflexes = Math.max(1, Math.min(20, p.attributes.reflexes + bump));
    p.attributes.gameSense = Math.max(1, Math.min(20, p.attributes.gameSense + bump));
  }
  team.playerIds = spawned.map((p) => p.id);
  return { team, players: spawned };
}

/** Compose an EngineTeam from team + players + tactics. Mirrors
 *  src/store/gameStore.ts engineTeam() but doesn't reach into GameState. */
function makeEngineTeam(team: Team, players: Player[], tactics: Tactics): EngineTeam {
  const lineup = players.slice(0, 5);
  const avgComposure =
    lineup.reduce((s, p) => s + p.attributes.composure, 0) / Math.max(1, lineup.length);
  const avgTeamwork = lineup.reduce((s, p) => s + p.attributes.teamwork, 0) / Math.max(1, lineup.length);
  const avgMorale = lineup.reduce((s, p) => s + p.morale, 0) / Math.max(1, lineup.length);
  const avgLoyalty = lineup.reduce((s, p) => s + p.attributes.loyalty, 0) / Math.max(1, lineup.length);
  const moraleVariance =
    lineup.reduce((s, p) => s + Math.abs(p.morale - avgMorale), 0) / Math.max(1, lineup.length);
  const chemistry = Math.max(
    0,
    Math.min(100, avgTeamwork * 3 + avgMorale * 2 + avgLoyalty * 1.5 - moraleVariance * 3),
  );
  return {
    team,
    players: lineup,
    tactics,
    pressureResistance: avgComposure,
    chemistry,
  };
}

/** Run one duel end-to-end. Returns the match result, money delta for the
 *  user, and a short flavour line. Mutates the user's players via
 *  applyMatchAftermath (form/fatigue/morale). The AI side is throwaway.
 *  When `stake === 0` (scrim mode), no money flows and the aftermath is
 *  softened. */
export function runAiDuel(
  userTeam: Team,
  userPlayers: Player[],
  stake: number,
  format: MatchFormat,
  matchId: string,
  savedTactics?: Partial<Tactics>,
): {
  result: MatchResult;
  opponentName: string;
  opponentTag: string;
  opponentPlayers: Player[];
  moneyDelta: number;
  summary: string;
  isScrim: boolean;
} {
  const seed = hashSeed(`duel-${matchId}`);
  const { team: aiTeam, players: aiPlayers } = generateAiOpponent(userPlayers, seed);

  const a = makeEngineTeam(userTeam, userPlayers, resolveTactics(savedTactics));
  const b = makeEngineTeam(aiTeam, aiPlayers, DEFAULT_TACTICS);

  // Pressure 0.5 (neutral) — not a tournament, no stakes effect on choke.
  const result = simulateMatch(matchId, a, b, format, MAP_LAYOUTS, 0.5, seed);

  const won = result.winnerId === userTeam.id;
  const isScrim = stake === 0;
  const moneyDelta = isScrim ? 0 : (won ? stake : -stake);

  // Snapshot before aftermath so we can soften deltas if it's a scrim.
  const before = userPlayers.map((p) => ({ ...p }));
  applyMatchAftermath(Object.fromEntries(userPlayers.map((p) => [p.id, p])), result);
  if (isScrim) softenAftermath(before, userPlayers);

  const summary = isScrim
    ? `Scrim vs ${aiTeam.name} — ${won ? 'win' : 'loss'} ${result.mapsA}-${result.mapsB}. No money, light recovery.`
    : won
      ? `Beat ${aiTeam.name} ${result.mapsA}-${result.mapsB}. +$${stake.toLocaleString()} from the duel pot.`
      : `Lost to ${aiTeam.name} ${result.mapsA}-${result.mapsB}. -$${stake.toLocaleString()} from the bankroll.`;

  return {
    result,
    opponentName: aiTeam.name,
    opponentTag: aiTeam.tag,
    opponentPlayers: aiPlayers,
    moneyDelta,
    summary,
    isScrim,
  };
}

/** PvP variant — two live teams. Both sides get aftermath applied. Pressure
 *  is bumped slightly because head-to-head stakes feel real. */
export function runPvpDuel(
  teamA: Team,
  playersA: Player[],
  teamB: Team,
  playersB: Player[],
  stake: number,
  format: MatchFormat,
  matchId: string,
  tacticsA?: Partial<Tactics>,
  tacticsB?: Partial<Tactics>,
): {
  result: MatchResult;
  winnerTeamId: string;
  loserTeamId: string;
} {
  const seed = hashSeed(`pvp-${matchId}`);
  const a = makeEngineTeam(teamA, playersA, resolveTactics(tacticsA));
  const b = makeEngineTeam(teamB, playersB, resolveTactics(tacticsB));
  // Slightly elevated pressure (0.6) — losing here costs the buyer real money
  // and the loser's stake, so composure under fire matters.
  const result = simulateMatch(matchId, a, b, format, MAP_LAYOUTS, 0.6, seed);

  const isScrim = stake === 0;
  const beforeA = playersA.map((p) => ({ ...p }));
  const beforeB = playersB.map((p) => ({ ...p }));
  applyMatchAftermath(Object.fromEntries(playersA.map((p) => [p.id, p])), result);
  applyMatchAftermath(Object.fromEntries(playersB.map((p) => [p.id, p])), result);
  if (isScrim) {
    softenAftermath(beforeA, playersA);
    softenAftermath(beforeB, playersB);
  }

  const winnerTeamId = result.winnerId;
  const loserTeamId = winnerTeamId === teamA.id ? teamB.id : teamA.id;
  return { result, winnerTeamId, loserTeamId };
}

/** Drop frames + commentary + kills from a MatchResult before persisting.
 *  Same trim as the career-mode stripFrames — finished matches only need
 *  scoreline + playerStats for history display. */
export function stripFrames(result: MatchResult): MatchResult {
  return {
    ...result,
    maps: result.maps.map((m) => ({
      ...m,
      rounds: m.rounds.map((r) => ({
        ...r,
        frames: [],
        kills: [],
        commentary: [],
      })),
    })),
  };
}
