// Periodic server-side ticks: retirement checks, coach pool refill,
// sponsor offer generation. Called from advanceDay-style hooks (currently
// the time-skip handler + refresh-state).

import { randomBytes } from 'node:crypto';
import { RNG, hashSeed } from '../../src/engine/rng.ts';
import {
  RETIREMENT_AGE_THRESHOLD,
  SPONSOR_PAYMENT_INTERVAL_MS,
  type HoFEntry,
  type SponsorOffer,
} from '../../src/online/protocol.ts';
import type { Player } from '../../src/types.ts';
import { SPONSOR_POOL } from '../../src/data/sponsors.ts';
import type { DB } from './db.ts';

// Bigger coach pools — pulled from the single-player staffPool data so the
// online server has the same name + nationality variety as the SP career.
// Kept inline (rather than imported) because staffPool.ts also bundles the
// game-state-mutating buildInitialStaffPool which we don't want on the
// server's import graph.
const COACH_FIRST_NAMES = [
  'Anders', 'Daniel', 'David', 'Dmitri', 'Eduardo', 'Emil', 'Erik', 'Felix', 'Henrik', 'Igor',
  'James', 'Jens', 'Jonas', 'Kasper', 'Kirill', 'Lars', 'Lukas', 'Marco', 'Mateusz', 'Mats',
  'Mauricio', 'Michal', 'Nicolas', 'Oleksandr', 'Pablo', 'Patrik', 'Pedro', 'Petr', 'Rafael',
  'Roman', 'Ruslan', 'Sebastian', 'Sergei', 'Stefan', 'Thomas', 'Timo', 'Tomas', 'Valentin',
  'Vincent', 'Wojciech', 'Yannick', 'Yusuf',
];
const COACH_LAST_NAMES = [
  'Andersson', 'Becker', 'Bergmann', 'Castro', 'Christensen', 'Costa', 'Diaz', 'Eriksson',
  'Fischer', 'Garcia', 'Hansen', 'Holm', 'Ivanov', 'Jansen', 'Kovac', 'Kowalski', 'Krause',
  'Larsen', 'Lindqvist', 'Maier', 'Marin', 'Melnyk', 'Meyer', 'Moller', 'Nielsen', 'Novak',
  'Pavlov', 'Petrov', 'Romero', 'Sanchez', 'Schmidt', 'Silva', 'Sokolov', 'Tanaka', 'Tarasov',
  'Vasiliev', 'Werner', 'Wilson', 'Zielinski',
];
// Region-keyed so coach nationalities feel coherent with where teams live.
const COACH_NATS_BY_REGION: Record<string, string[]> = {
  Europe: ['DK', 'SE', 'NO', 'FI', 'DE', 'FR', 'PL', 'CZ', 'NL', 'PT', 'IS', 'GB', 'BE'],
  CIS: ['RU', 'UA', 'BY', 'KZ', 'LT'],
  Americas: ['US', 'CA', 'BR', 'AR', 'CL', 'MX'],
  Asia: ['JP', 'KR', 'CN', 'MN', 'SG'],
};
const ALL_COACH_NATS = [
  ...COACH_NATS_BY_REGION.Europe,
  ...COACH_NATS_BY_REGION.CIS,
  ...COACH_NATS_BY_REGION.Americas,
  ...COACH_NATS_BY_REGION.Asia,
];

/** Top up the coach pool to ~12 open coaches whenever it dips below 8.
 *  Names drawn from the larger SP staff pool (42 first × 39 last = 1638
 *  unique combinations), nationalities region-distributed. Skill follows
 *  a tier curve so the pool isn't uniformly mediocre — ~10% chance of a
 *  tier-1 (16-20) elite coach, ~30% strong, ~35% solid, rest journeymen. */
export function ensureCoachPool(db: DB): void {
  if (db.countOpenCoaches() >= 8) return;
  const rng = new RNG(hashSeed(`coach-${Date.now()}-${Math.floor(Math.random() * 1e9)}`));
  const needed = 12 - db.countOpenCoaches();
  for (let i = 0; i < needed; i++) {
    // Tier-distributed skill: matches the SP staffPool's hidden-gem
    // distribution so the user occasionally finds a real bargain.
    const tierRoll = rng.next();
    const skill =
      tierRoll < 0.10 ? rng.int(16, 20) :  // elite
      tierRoll < 0.40 ? rng.int(13, 17) :  // strong
      tierRoll < 0.75 ? rng.int(10, 14) :  // solid
                        rng.int(6, 11);    // journeyman
    const wage = Math.round((2000 + skill * 900 + rng.int(-300, 300)) / 100) * 100;
    db.addCoachToPool({
      id: `coach-${randomBytes(4).toString('hex')}`,
      name: `${rng.pick(COACH_FIRST_NAMES)} ${rng.pick(COACH_LAST_NAMES)}`,
      nationality: rng.pick(ALL_COACH_NATS),
      skill,
      monthlyWage: wage,
    });
  }
}

/**
 * Walk the team's roster and roll a retirement for each player over the
 * threshold age. Inducts retirees into the HoF + removes them from the
 * roster. Returns the list of retired players (caller pushes notifications).
 *
 * Only fired during time-skip — gating the rolls behind real "weeks
 * advanced" prevents constant retirements from idle clients refreshing.
 */
export function processRetirements(
  db: DB,
  team: { id: string; tag: string; playerIds: string[] },
  players: Player[],
  weeksAdvanced: number,
): { retired: { playerId: string; nickname: string; lastAge: number }[] } {
  if (weeksAdvanced <= 0) return { retired: [] };
  const rng = new RNG(hashSeed(`retire-${team.id}-${Date.now()}`));
  const retired: { playerId: string; nickname: string; lastAge: number }[] = [];
  const keepIds: string[] = [];

  for (const p of players) {
    if (p.age < RETIREMENT_AGE_THRESHOLD) { keepIds.push(p.id); continue; }
    // Age-curve retirement: 32 → 4%/week, 35 → 18%/week, 38+ → 50%/week.
    // Scaled by weeks advanced (a 2-week skip rolls roughly twice as often).
    const base = p.age >= 38 ? 0.5 : p.age >= 35 ? 0.18 : p.age >= 33 ? 0.08 : 0.04;
    const chance = Math.min(0.95, base * Math.max(1, weeksAdvanced));
    if (!rng.chance(chance)) { keepIds.push(p.id); continue; }
    // Retire — induct into HoF.
    db.inductIntoHoF({
      playerId: p.id,
      nickname: p.nickname,
      role: p.role,
      nationality: p.nationality,
      lastAge: p.age,
      peakCA: p.currentAbility,
      lastTeamId: team.id,
      lastTeamTag: team.tag,
    });
    retired.push({ playerId: p.id, nickname: p.nickname, lastAge: p.age });
    // Player record itself stays in the players table for history, but with
    // teamId nulled so they no longer appear on rosters or in the market.
    p.teamId = null;
    db.persistPlayer(p);
  }
  if (retired.length > 0) db.setTeamPlayers(team.id, keepIds);
  return { retired };
}

/**
 * Roll a new sponsor offer for a team if they don't have a pending one
 * already and they have a respectable resume (≥3 career wins).
 *
 * Picks from the real-brand SPONSOR_POOL (Red Bull, BMW, HyperX, …)
 * filtered by the team's tier (minRank check inverted — career wins
 * map to a synthetic rank). Monthly amount is the brand's baseMonthly
 * scaled down for the online economy (online matches are smaller
 * stakes than SP careers) plus a small variance.
 */
export function maybeOfferSponsor(db: DB, teamId: string, careerWins: number): SponsorOffer | null {
  if (careerWins < 3) return null;
  const existing = db.loadSponsorsForTeam(teamId);
  if (existing.some((s) => s.status === 'pending')) return null;
  // Only one fresh offer every few days — guard with offered_at.
  const recent = existing.find((s) => Date.now() - s.offeredAt < 3 * 24 * 3600 * 1000);
  if (recent) return null;
  const rng = new RNG(hashSeed(`sponsor-${teamId}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`));
  if (!rng.chance(0.6)) return null;

  // Map careerWins → a synthetic "rank" the way the SP world ranking works
  // (lower = better). 100+ wins ≈ top 1, 50 wins ≈ top 8, 3 wins ≈ rank ~32.
  const syntheticRank = Math.max(1, 35 - Math.floor(careerWins * 0.7));
  const eligible = SPONSOR_POOL.filter((s) => syntheticRank <= s.minRank);
  if (eligible.length === 0) return null;
  // Bias toward the highest tier this team qualifies for so a top-15 team
  // sees premium brands more often than the minor ones.
  const tierPriority: Record<string, number> = { title: 4, premium: 3, standard: 2, minor: 1 };
  const sorted = [...eligible].sort((a, b) => (tierPriority[b.tier] ?? 0) - (tierPriority[a.tier] ?? 0));
  const topCohort = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.35)));
  const pickedDef = rng.pick(topCohort);

  // Scale baseMonthly down for the online economy — SP careers run for
  // years and pay ~$100k+/mo; online is per-tick. Use 4-8% of the SP base
  // plus jitter so even the title sponsors hit ~$10-30k/mo, manageable.
  const scaledBase = Math.round(pickedDef.baseMonthly * (0.04 + rng.next() * 0.04));
  const jitter = Math.round(scaledBase * (0.85 + rng.next() * 0.3));
  const amount = Math.max(1500, Math.round(jitter / 100) * 100);

  const id = `sponsor-${randomBytes(4).toString('hex')}`;
  db.createSponsorOffer({
    id,
    teamId,
    sponsorName: pickedDef.name,
    monthlyAmount: amount,
  });
  return db.loadSponsor(id);
}

/**
 * Pay out any active sponsor whose 30 days have lapsed. Returns the
 * payouts so the caller can push a notification + roll the team's money.
 */
export function processSponsorPayouts(
  db: DB,
  teamId: string,
): { sponsorId: string; sponsorName: string; amount: number }[] {
  const cutoff = Date.now() - SPONSOR_PAYMENT_INTERVAL_MS;
  const due = db.loadDueSponsors(teamId, cutoff);
  const payouts: { sponsorId: string; sponsorName: string; amount: number }[] = [];
  for (const s of due) {
    payouts.push({ sponsorId: s.id, sponsorName: s.sponsorName, amount: s.monthlyAmount });
    db.recordSponsorPaid(s.id);
  }
  return payouts;
}

/** Stub for HoFEntry type imports — keeps the bundler happy when the type
 *  is only used via the protocol. */
export type _Unused = HoFEntry;
