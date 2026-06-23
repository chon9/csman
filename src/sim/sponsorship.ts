// Sponsorship lifecycle: initial assignment at game start, monthly payouts,
// expiry + renewal at season rollover, performance bonuses on tournament finishes.

import type { GameState, Sponsor, SponsorDeal, SponsorOffer, SponsorTier, Team, Tournament } from '../types';
import { SPONSOR_POOL } from '../data/sponsors';
import { RNG, hashSeed } from '../engine/rng';
import { postsForSponsor } from './news';

/** Decide how many sponsor slots a team has based on rank. */
function maxSlotsFor(rank: number): number {
  if (rank <= 5) return 4;   // title + 3 premium
  if (rank <= 12) return 3;
  if (rank <= 24) return 2;
  return 1;
}

/** What tier is realistic for this team at this rank. */
function eligibleTiers(rank: number): SponsorTier[] {
  if (rank <= 5) return ['title', 'premium', 'standard'];
  if (rank <= 15) return ['premium', 'standard'];
  if (rank <= 25) return ['standard', 'minor'];
  return ['minor'];
}

/** Discount the asking price slightly for lower-ranked teams (sponsors play hardball). */
function valueForRank(base: number, rank: number, sponsorMin: number): number {
  // Slightly above min = full price; 8+ ranks below min = -25%
  const gap = Math.max(0, rank - sponsorMin);
  const mul = Math.max(0.6, 1 - gap * 0.03);
  return Math.round(base * mul / 1000) * 1000;
}

function pickSponsorForTeam(
  team: Team,
  used: Set<string>,
  rng: RNG,
): Sponsor | null {
  const tiers = eligibleTiers(team.worldRanking);
  const eligible = SPONSOR_POOL.filter((s) => {
    if (used.has(s.id)) return false;
    if (!tiers.includes(s.tier)) return false;
    if (s.minRank < team.worldRanking) return false;
    if (s.preferredRegions && !s.preferredRegions.includes(team.region)) {
      // 70% pass-through if region mismatch — many sponsors will still sign with non-preferred regions
      if (!rng.chance(0.3)) return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;
  // Bias toward higher-value sponsors first
  eligible.sort((a, b) => b.baseMonthly - a.baseMonthly);
  // Add some randomness — pick from top 3 weighted
  const top = eligible.slice(0, Math.min(3, eligible.length));
  return rng.pick(top);
}

function makeDeal(
  sponsor: Sponsor,
  team: Team,
  startDate: string,
  rng: RNG,
): SponsorDeal {
  const monthly = valueForRank(sponsor.baseMonthly, team.worldRanking, sponsor.minRank);
  const months = sponsor.baseLengthMonths + rng.int(-3, 3);
  const start = new Date(startDate + 'T00:00:00Z');
  const expires = new Date(start);
  expires.setUTCMonth(expires.getUTCMonth() + Math.max(6, months));
  return {
    sponsorId: sponsor.id,
    startDate,
    expiresDate: expires.toISOString().slice(0, 10),
    monthlyValue: monthly,
    bonusPerMajor: Math.round((sponsor.bonusPerMajor ?? 0) * (monthly / sponsor.baseMonthly)),
    bonusPerPodium: Math.round((sponsor.bonusPerPodium ?? 0) * (monthly / sponsor.baseMonthly)),
  };
}

/**
 * Seed sponsors at game start: every team gets up to their max slots filled,
 * subject to availability and tier eligibility. Top teams get title + premium;
 * bottom teams get a minor brand or nothing.
 */
export function seedInitialSponsors(g: GameState): void {
  g.sponsors = {};
  for (const s of SPONSOR_POOL) g.sponsors[s.id] = s;
  const usedTitleOrPremium = new Set<string>();
  const teamsByRank = Object.values(g.teams).sort((a, b) => a.worldRanking - b.worldRanking);
  for (const team of teamsByRank) {
    const rng = new RNG(hashSeed('sponsor-seed-' + team.id));
    team.sponsorDeals = [];
    const slots = maxSlotsFor(team.worldRanking);
    for (let i = 0; i < slots; i++) {
      // Title + premium are exclusive league-wide (one brand can't sign 32 teams); standard/minor can recur
      const sponsor = pickSponsorForTeam(team, usedTitleOrPremium, rng);
      if (!sponsor) break;
      team.sponsorDeals.push(makeDeal(sponsor, team, g.currentDate, rng));
      if (sponsor.tier === 'title' || sponsor.tier === 'premium') {
        usedTitleOrPremium.add(sponsor.id);
      }
    }
  }
}

/** Sum monthly sponsor payouts for a team. */
export function monthlySponsorIncome(team: Team): number {
  return (team.sponsorDeals ?? []).reduce((sum, d) => sum + d.monthlyValue, 0);
}

/**
 * Run sponsor expiry + renewal sweep. Called at season rollover; renews
 * deals that expire within the next ~60 days, with values adjusted to current rank.
 * Returns the count of renewals + new signings + losses, for inbox copy.
 */
export function processSponsorExpiry(
  g: GameState,
  today: string,
): { renewed: number; signed: number; lost: number } {
  let renewed = 0, signed = 0, lost = 0;
  const usedTitleOrPremium = new Set<string>();
  // First gather currently-locked premium/title across all teams (so renewals can keep them)
  for (const team of Object.values(g.teams)) {
    for (const d of team.sponsorDeals ?? []) {
      const s = g.sponsors?.[d.sponsorId];
      if (s && (s.tier === 'title' || s.tier === 'premium') && d.expiresDate > today) {
        usedTitleOrPremium.add(s.id);
      }
    }
  }
  for (const team of Object.values(g.teams)) {
    if (!team.sponsorDeals) team.sponsorDeals = [];
    const rng = new RNG(hashSeed(`sponsor-renew-${team.id}-${today}`));
    // Expire dead deals
    const before = team.sponsorDeals.length;
    team.sponsorDeals = team.sponsorDeals.filter((d) => d.expiresDate > today);
    lost += before - team.sponsorDeals.length;
    // Try to renew up to max slots
    const slots = maxSlotsFor(team.worldRanking);
    while (team.sponsorDeals.length < slots) {
      const sponsor = pickSponsorForTeam(team, usedTitleOrPremium, rng);
      if (!sponsor) break;
      const deal = makeDeal(sponsor, team, today, rng);
      team.sponsorDeals.push(deal);
      if (sponsor.tier === 'title' || sponsor.tier === 'premium') {
        usedTitleOrPremium.add(sponsor.id);
      }
      // News feed: title/premium deals for any top-16 team are newsworthy.
      // Standard/minor deals only post for the very top to avoid spam.
      const newsworthy =
        (sponsor.tier === 'title' || sponsor.tier === 'premium') && team.worldRanking <= 16
        || team.worldRanking <= 5;
      if (newsworthy) {
        const newsRng = new RNG(hashSeed(`news-sponsor-${team.id}-${sponsor.id}-${today}`));
        postsForSponsor(g, team.id, sponsor.name, newsRng);
      }
      if (lost > 0) {
        renewed++;
        lost--; // count as replacement, not pure loss
      } else {
        signed++;
      }
    }
  }
  return { renewed, signed, lost };
}

/**
 * Roll for a new sponsor approach to the user team. Probability scales with:
 *  - Open sponsor slots (more open = more interest)
 *  - Recent ranking (top teams attract more offers daily)
 *  - Time since last offer (cooldown)
 * Returns a SponsorOffer if generated, otherwise null.
 */
export function rollSponsorOffer(g: GameState, today: string, rng: RNG): SponsorOffer | null {
  const team = g.teams[g.userTeamId];
  if (!team) return null;
  const deals = team.sponsorDeals ?? [];
  const slots = maxSlotsFor(team.worldRanking);
  const openSlots = Math.max(0, slots - deals.length);

  // Base chance: top teams 4%/day, mid 2%/day, bottom 0.8%/day. +2% per open slot.
  let p = team.worldRanking <= 5 ? 0.04 : team.worldRanking <= 16 ? 0.02 : 0.008;
  p += openSlots * 0.02;
  // Existing pending offers throttle further offers
  const pending = (g.sponsorOffers ?? []).length;
  p *= Math.max(0.2, 1 - pending * 0.4);
  if (!rng.chance(p)) return null;

  // Pick a sponsor not already signed and not pending
  const lockedIds = new Set<string>([
    ...deals.map((d) => d.sponsorId),
    ...(g.sponsorOffers ?? []).map((o) => o.sponsorId),
  ]);
  const tiers = eligibleTiers(team.worldRanking);
  const eligible = SPONSOR_POOL.filter((s) => {
    if (lockedIds.has(s.id)) return false;
    if (!tiers.includes(s.tier)) return false;
    if (s.minRank < team.worldRanking) return false;
    // Title/premium sponsors are exclusive — check no other team has them
    if (s.tier === 'title' || s.tier === 'premium') {
      const taken = Object.values(g.teams).some((t) =>
        (t.sponsorDeals ?? []).some((d) => d.sponsorId === s.id),
      );
      if (taken) return false;
    }
    if (s.preferredRegions && !s.preferredRegions.includes(team.region)) {
      if (!rng.chance(0.3)) return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;
  // Bias to higher-value sponsors but keep some variety
  eligible.sort((a, b) => b.baseMonthly - a.baseMonthly);
  const sponsor = rng.pick(eligible.slice(0, Math.min(4, eligible.length)));

  // Build the offer — incoming offers are typically 5-15% better than the auto-renew baseline
  // (they're courting you specifically).
  const baseValue = valueForRank(sponsor.baseMonthly, team.worldRanking, sponsor.minRank);
  const courtingBonus = 1 + rng.range(0.05, 0.15);
  const monthlyValue = Math.round((baseValue * courtingBonus) / 500) * 500;
  const lengthMonths = sponsor.baseLengthMonths + rng.int(-3, 3);

  // If no open slot, mark the smallest existing deal as the replacement target
  let replacesDealOfSponsorId: string | undefined;
  if (openSlots === 0) {
    const smallest = [...deals].sort((a, b) => a.monthlyValue - b.monthlyValue)[0];
    if (!smallest || smallest.monthlyValue >= monthlyValue) return null; // not worth replacing
    replacesDealOfSponsorId = smallest.sponsorId;
  }

  const expiresOn = addDaysIso(today, 7);
  return {
    id: `sponsoroffer-${today}-${sponsor.id}`,
    sponsorId: sponsor.id,
    date: today,
    expiresOn,
    monthlyValue,
    lengthMonths: Math.max(6, lengthMonths),
    bonusPerMajor: Math.round((sponsor.bonusPerMajor ?? 0) * courtingBonus),
    bonusPerPodium: Math.round((sponsor.bonusPerPodium ?? 0) * courtingBonus),
    replacesDealOfSponsorId,
  };
}

/** Convert an accepted offer into a SponsorDeal and attach to user team. */
export function applySponsorOffer(g: GameState, offer: SponsorOffer): SponsorDeal | null {
  const team = g.teams[g.userTeamId];
  if (!team) return null;
  team.sponsorDeals = team.sponsorDeals ?? [];
  // Drop replacement target if specified
  if (offer.replacesDealOfSponsorId) {
    team.sponsorDeals = team.sponsorDeals.filter((d) => d.sponsorId !== offer.replacesDealOfSponsorId);
  }
  const expires = addDaysIso(offer.date, offer.lengthMonths * 30);
  const deal: SponsorDeal = {
    sponsorId: offer.sponsorId,
    startDate: offer.date,
    expiresDate: expires,
    monthlyValue: offer.monthlyValue,
    bonusPerMajor: offer.bonusPerMajor,
    bonusPerPodium: offer.bonusPerPodium,
  };
  team.sponsorDeals.push(deal);
  return deal;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Performance bonus payout when a team finishes top-3 at a tournament. */
export function payPerformanceBonus(
  g: GameState,
  team: Team,
  tournament: Tournament,
  placement: number,
): number {
  let total = 0;
  for (const d of team.sponsorDeals ?? []) {
    if (placement === 1 && tournament.tier === 'S') total += d.bonusPerMajor;
    if (placement <= 3) total += d.bonusPerPodium;
  }
  team.budget += total;
  return total;
}
