// Manager job market — AI clubs approach the user manager based on reputation
// + performance. Closes the career-arc loop: managers can move between clubs,
// build dynasties, get sacked, or chase prestige jobs abroad.

import type { GameState, ManagerJobOffer, Team } from '../types';
import type { RNG } from '../engine/rng';
import { addDays } from './calendar';

let nextOfferId = 0;

const PITCH_TEMPLATES: Record<'top' | 'mid' | 'rebuild', string[]> = {
  top: [
    'We need a Major. Bring us back to the top of the world.',
    'Our board is ready to back a serial winner. Are you in?',
    'Major-tier ambitions, Major-tier budget. We want you in the dugout.',
  ],
  mid: [
    'We have the roster — we need the right voice in the room. Interested?',
    'Stable budget, ambitious owners, a project worth a 2-year contract.',
    'We want a Top 8 finish next season. Can you take us there?',
  ],
  rebuild: [
    'A rebuild job for the right manager. Patience and a free hand.',
    'New ownership, fresh slate. Help us build something from the ground up.',
    'Young roster, modest budget — but the long-term plan is yours to write.',
  ],
};

function pickTier(team: Team): 'top' | 'mid' | 'rebuild' {
  if (team.worldRanking <= 8) return 'top';
  if (team.worldRanking <= 20) return 'mid';
  return 'rebuild';
}

function signOnFor(team: Team): number {
  if (team.worldRanking <= 5) return 250_000;
  if (team.worldRanking <= 12) return 120_000;
  if (team.worldRanking <= 24) return 50_000;
  return 20_000;
}

/** Run on the 1st of each month. Returns newly-generated offers (also pushed
 *  onto game state) for the caller to surface in the inbox. */
export function generateMonthlyJobOffers(
  g: GameState,
  rng: RNG,
): ManagerJobOffer[] {
  const m = g.manager;
  if (!m) return [];
  g.managerJobOffers ??= [];
  // Expire stale offers first.
  g.managerJobOffers = g.managerJobOffers.filter((o) => o.expiresOn >= g.currentDate);

  // Approach chance scales with reputation. Below 35: rare. 70+: routine.
  const baseChance = Math.max(0, (m.reputation - 25) / 100);
  if (!rng.chance(Math.min(0.85, baseChance))) return [];

  // Candidate clubs: not the user's current team, ranked within ±15 of user club
  // when established (rep 55+) or only weaker clubs when low rep (gives a foothold).
  const userTeam = g.teams[g.userTeamId];
  const userRank = userTeam?.worldRanking ?? 50;
  const minRank = m.reputation >= 70 ? Math.max(1, userRank - 12) : Math.max(1, userRank - 4);
  const maxRank = m.reputation >= 55 ? userRank + 18 : userRank + 25;

  const candidates = Object.values(g.teams).filter((t) => {
    if (t.id === g.userTeamId) return false;
    if (t.worldRanking < minRank || t.worldRanking > maxRank) return false;
    // Don't re-offer from a club that already has a pending offer.
    if (g.managerJobOffers!.some((o) => o.teamId === t.id)) return false;
    return true;
  });
  if (candidates.length === 0) return [];

  // Pick 1-2 clubs weighted toward better rank (more prestige = more attractive offer).
  const offers: ManagerJobOffer[] = [];
  const offerCount = m.reputation >= 75 ? 2 : 1;
  for (let i = 0; i < offerCount && candidates.length > 0; i++) {
    const idx = rng.int(0, Math.min(candidates.length - 1, 3));
    const team = candidates[idx];
    candidates.splice(idx, 1);
    const tier = pickTier(team);
    const isHeadHunt = team.worldRanking < userRank - 5 && m.reputation >= 65;
    const offer: ManagerJobOffer = {
      id: `mjo-${++nextOfferId}-${Date.now().toString(36)}`,
      offeredOn: g.currentDate,
      expiresOn: addDays(g.currentDate, 14),
      teamId: team.id,
      teamName: team.name,
      teamRank: team.worldRanking,
      pitch: rng.pick(PITCH_TEMPLATES[tier]),
      signOnBonus: signOnFor(team),
      kind: isHeadHunt ? 'head-hunt' : 'approach',
    };
    g.managerJobOffers.push(offer);
    offers.push(offer);
  }
  return offers;
}

/** Generate a forced post-sack rebound offer from a smaller club, ~7 days
 *  after a sack. Keeps the career going instead of stalling. */
export function generateReboundOffer(g: GameState, rng: RNG): ManagerJobOffer | null {
  const m = g.manager;
  if (!m) return null;
  g.managerJobOffers ??= [];
  const candidates = Object.values(g.teams).filter(
    (t) => t.id !== g.userTeamId && t.worldRanking >= 20 && t.worldRanking <= 36,
  );
  if (candidates.length === 0) return null;
  const team = rng.pick(candidates);
  const offer: ManagerJobOffer = {
    id: `mjo-rebound-${++nextOfferId}-${Date.now().toString(36)}`,
    offeredOn: g.currentDate,
    expiresOn: addDays(g.currentDate, 21),
    teamId: team.id,
    teamName: team.name,
    teamRank: team.worldRanking,
    pitch: 'We saw what happened. We think you deserve another shot — come prove it with us.',
    signOnBonus: 30_000,
    kind: 'rebound',
  };
  g.managerJobOffers.push(offer);
  return offer;
}

/** Check whether the board has lost patience to the point of sacking. */
export function shouldSack(g: GameState): boolean {
  if (!g.board) return false;
  if (!g.manager) return false;
  if (g.managerUnattached) return false;
  // Confidence under 8 AND at least 60 days into the season (so a bad start
  // doesn't auto-sack on day 5 before the manager has played).
  const daysIntoSeason =
    (new Date(g.currentDate + 'T00:00:00Z').getTime() -
      new Date(`${g.seasonYear}-01-05T00:00:00Z`).getTime()) /
    86_400_000;
  return g.board.confidence < 8 && daysIntoSeason >= 60;
}
