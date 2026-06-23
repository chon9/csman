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
import type { DB } from './db.ts';

const COACH_FIRST_NAMES = ['Marcus', 'Diego', 'Aleksei', 'Henrik', 'Yuto', 'Andrei', 'Jan', 'Pierre', 'Tomasz', 'Lukas'];
const COACH_LAST_NAMES  = ['Berg', 'Silva', 'Petrov', 'Lindholm', 'Tanaka', 'Voronov', 'Kowalski', 'Lefebvre', 'Wojcik', 'Becker'];
const COACH_NATS = ['DE', 'BR', 'RU', 'SE', 'JP', 'UA', 'PL', 'FR', 'CZ', 'DK'];

const SPONSOR_NAMES = ['HyperX Synergy', 'AETHER.gg', 'Northwave Energy', 'BlackBox Audio', 'NovaSpec Optics', 'CoreVerse', 'PulseChain', 'OmniGear', 'StreamBaron', 'SpektrumLabs'];

/** Top up the coach pool to ~10 open coaches whenever it dips below 6. */
export function ensureCoachPool(db: DB): void {
  if (db.countOpenCoaches() >= 6) return;
  const rng = new RNG(hashSeed(`coach-${Date.now()}`));
  const needed = 10 - db.countOpenCoaches();
  for (let i = 0; i < needed; i++) {
    const skill = rng.int(4, 18);
    const wage = Math.round(2000 + skill * 800 + rng.int(-300, 300));
    db.addCoachToPool({
      id: `coach-${randomBytes(4).toString('hex')}`,
      name: `${rng.pick(COACH_FIRST_NAMES)} ${rng.pick(COACH_LAST_NAMES)}`,
      nationality: rng.pick(COACH_NATS),
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
 */
export function maybeOfferSponsor(db: DB, teamId: string, careerWins: number): SponsorOffer | null {
  if (careerWins < 3) return null;
  const existing = db.loadSponsorsForTeam(teamId);
  if (existing.some((s) => s.status === 'pending')) return null;
  // Only one fresh offer every few days — guard with offered_at.
  const recent = existing.find((s) => Date.now() - s.offeredAt < 3 * 24 * 3600 * 1000);
  if (recent) return null;
  const rng = new RNG(hashSeed(`sponsor-${teamId}-${Date.now()}`));
  if (!rng.chance(0.6)) return null;
  const tier = careerWins >= 50 ? 3 : careerWins >= 20 ? 2 : 1;
  const amount = Math.round(2000 * tier + rng.int(-500, 1500) + careerWins * 50);
  const id = `sponsor-${randomBytes(4).toString('hex')}`;
  db.createSponsorOffer({
    id,
    teamId,
    sponsorName: rng.pick(SPONSOR_NAMES),
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
