// Periodic server-side ticks: retirement checks, coach pool refill,
// sponsor offer generation. Called from advanceDay-style hooks (currently
// the time-skip handler + refresh-state).

import { randomBytes } from 'node:crypto';
import { RNG, hashSeed } from '../../src/engine/rng.ts';
import {
  RETIREMENT_AGE_THRESHOLD,
  RETIREMENT_MATCHES_REQUIRED,
  fansForRoster,
  type HoFEntry,
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
  const retired: { playerId: string; nickname: string; lastAge: number }[] = [];
  const keepIds: string[] = [];

  // NEW retirement policy (was: age-curve random roll starting at 32):
  //   - Real-name HLTV players never retire (isRealName=true).
  //   - Everyone else needs BOTH: age >= 40 AND matchesPlayed >= 1000.
  //   - Once both hit, retirement is DETERMINISTIC (no dice) so the
  //     "sudden retirement of older players" bug goes away.
  //   - Retired players are hard-flagged retired=true + teamId=null so
  //     they can never be re-signed / re-bought (fixes the "buy after
  //     HoF, retires again after 1 match" bug).
  for (const p of players) {
    if (p.isRealName) { keepIds.push(p.id); continue; }
    if (p.age < RETIREMENT_AGE_THRESHOLD) { keepIds.push(p.id); continue; }
    if ((p.matchesPlayed ?? 0) < RETIREMENT_MATCHES_REQUIRED) { keepIds.push(p.id); continue; }

    // Both criteria met — retire deterministically.
    const teamRecord = db.loadTeamCareerRecord(team.id);
    db.inductIntoHoF({
      playerId: p.id,
      nickname: p.nickname,
      role: p.role,
      nationality: p.nationality,
      lastAge: p.age,
      peakCA: p.currentAbility,
      careerWins: teamRecord.wins,
      careerLosses: teamRecord.losses,
      lastTeamId: team.id,
      lastTeamTag: team.tag,
    });
    retired.push({ playerId: p.id, nickname: p.nickname, lastAge: p.age });
    // Hard-retire: unsigns from team AND blocks any future signing.
    p.teamId = null;
    p.retired = true;
    p.contract = null;
    db.persistPlayer(p);
  }
  if (retired.length > 0) db.setTeamPlayers(team.id, keepIds);
  return { retired };
}

/** How many wins a sponsor demands to unlock the reward. Higher-value
 *  deals ask for more wins. Floor at 3, cap at 50 so premium brands
 *  don't become uncompletable slogs. */
function winsRequiredFor(amount: number): number {
  return Math.max(3, Math.min(50, Math.round(amount / 5000)));
}

/**
 * Roll a new sponsor OFFER (objective-based) for a team if they don't
 * have a pending one already and they have a respectable resume
 * (≥3 career wins).
 *
 * Sponsors now pay a ONE-SHOT reward when the team hits a wins target
 * that scales with the reward. Bigger deals demand more wins.
 */
export function maybeOfferSponsor(db: DB, teamId: string, careerWins: number): { id: string } | null {
  if (careerWins < 3) return null;
  const existing = db.loadSponsorsForTeam(teamId);
  // Any pending / active / ready sponsor blocks fresh offers (one at a time).
  if (existing.length > 0) return null;
  const rng = new RNG(hashSeed(`sponsor-${teamId}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`));
  if (!rng.chance(0.6)) return null;

  // Map careerWins → synthetic rank (lower = better).
  const syntheticRank = Math.max(1, 35 - Math.floor(careerWins * 0.7));
  const eligible = SPONSOR_POOL.filter((s) => syntheticRank <= s.minRank);
  if (eligible.length === 0) return null;
  const tierPriority: Record<string, number> = { title: 4, premium: 3, standard: 2, minor: 1 };
  const sorted = [...eligible].sort((a, b) => (tierPriority[b.tier] ?? 0) - (tierPriority[a.tier] ?? 0));
  const topCohort = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.35)));
  const pickedDef = rng.pick(topCohort);

  // One-shot reward is scaled up from the old "monthly" figure since it's
  // paid only once (was 4-8% × baseMonthly per month → now 20-45% × base
  // paid once). Range roughly $15k for minor sponsors to $200k for title
  // brands. Rounded to $500 for tidy numbers.
  const scaledBase = Math.round(pickedDef.baseMonthly * (0.20 + rng.next() * 0.25));
  const jitter = Math.round(scaledBase * (0.85 + rng.next() * 0.3));
  // Fan reach multiplier — brands pay more to teams with an audience.
  // roster-derived fans + persisted media bonus. Caps at ×3 so a
  // stratospheric fanbase doesn't fully warp the sponsor economy.
  //   0 fans → ×1.00
  //   100k  → ×1.20
  //   500k  → ×2.00
  //   1M+   → ×3.00 (capped)
  const roster = db.loadTeamPlayers(teamId);
  const totalFans = fansForRoster(roster) + db.getTeamBonusFans(teamId);
  const fanMult = Math.min(3.0, 1 + totalFans / 500_000);
  const reward = Math.max(15_000, Math.round((jitter * fanMult) / 500) * 500);

  const id = `sponsor-${randomBytes(4).toString('hex')}`;
  db.createSponsorOffer({
    id,
    teamId,
    sponsorName: pickedDef.name,
    rewardAmount: reward,
    winsRequired: winsRequiredFor(reward),
  });
  return db.loadSponsor(id);
}

// (processSponsorPayouts intentionally removed — objective model has no
// recurring payouts; the user claims the reward once the objective is
// met, or cancels the sponsorship.)

/** Stub for HoFEntry type imports — keeps the bundler happy when the type
 *  is only used via the protocol. */
export type _Unused = HoFEntry;
