// Negotiation logic for the two-stage transfer system. Pure helpers — no
// store mutations here; the store imports these and applies their results.

import type { GameState, PersonalTerms, Player, SquadStatusPromise, Team, TransferOffer } from '../types';
import { RNG, hashSeed } from '../engine/rng';
import { playerReputation, reputationMultiplier } from './playerAnalytics';

const AGENT_FIRST = ['Alex', 'Bruno', 'Carlos', 'David', 'Emil', 'Felix', 'Hans', 'Igor', 'Jens', 'Karl',
  'Lukas', 'Marco', 'Nikolai', 'Pavel', 'Ruslan', 'Sergei', 'Tomas', 'Viktor'];
const AGENT_LAST = ['Andersen', 'Becker', 'Costa', 'Diaz', 'Fischer', 'Hansen', 'Ivanov', 'Klein',
  'Maier', 'Nielsen', 'Petrov', 'Romero', 'Schmidt', 'Sokolov', 'Werner', 'Zielinski'];

/** Generate a deterministic agent for a player (every player gets one). */
export function agentFor(player: Player): { name: string; demandMultiplier: number } {
  const rng = new RNG(hashSeed('agent-' + player.id));
  const name = `${rng.pick(AGENT_FIRST)} ${rng.pick(AGENT_LAST)}`;
  // Agents push for 0% to +15% over base demands depending on the agent.
  const demandMultiplier = 1.0 + rng.range(0, 0.15);
  return { name, demandMultiplier };
}

/** What the SELLING club thinks the player is worth. Higher than askingPrice for stars. */
export function clubValuation(player: Player, sellingTeam: Team | undefined): number {
  const base = player.askingPrice;
  // Higher-ranked teams hold out harder (don't want to look weak).
  const rankMul = sellingTeam ? Math.max(0.85, 1.25 - sellingTeam.worldRanking / 100) : 1.0;
  // Stars demand more.
  const caMul = Math.max(1, player.currentAbility / 130);
  // Young + high-PA = blue-chip premium.
  const futureMul = player.age <= 22 && player.potentialAbility >= 160 ? 1.25 : 1.0;
  return Math.round(base * rankMul * caMul * futureMul);
}

/** What the PLAYER expects as their monthly wage, factoring loyalty/reputation/agent. */
export function playerWageDemand(
  player: Player,
  teams: Record<string, Team>,
  agentMul: number,
): number {
  const tier = playerReputation(player, teams);
  const tierMul = reputationMultiplier(tier);
  // Loyal players demand less (within reason); disloyal stars want top dollar.
  const loyaltyMul = 1.0 + (10 - player.attributes.loyalty) / 40; // ±25%
  // Current wage acts as a floor when leaving a club mid-contract.
  const currentWage = player.contract?.wage ?? 0;
  const baseAsk = Math.max(currentWage * 1.1, 80 * player.currentAbility * tierMul);
  return Math.round((baseAsk * loyaltyMul * agentMul) / 500) * 500;
}

// ============ Stage 1: club fee response ============

export type ClubFeeResponse =
  | { type: 'accept' }
  | { type: 'counter'; counterFee: number; reason: string }
  | { type: 'reject'; reason: string };

/**
 * The selling club evaluates a fee. Three outcomes:
 *  - accept if fee ≥ valuation × 0.95 OR fee ≥ buyout (auto-trigger)
 *  - counter if fee ≥ valuation × 0.5 (specific counter-fee, not opaque)
 *  - reject if fee is insulting (< valuation × 0.5) OR they've countered too much already
 */
export function evaluateClubFee(
  player: Player,
  fee: number,
  sellingTeam: Team | undefined,
  feeRound: number,
  rng: RNG,
): ClubFeeResponse {
  const buyout = player.contract?.buyout ?? Infinity;
  if (fee >= buyout) {
    return { type: 'accept' };
  }
  const valuation = clubValuation(player, sellingTeam);
  const ratio = fee / valuation;
  // Listed players are easier to budge.
  const listedBonus = player.transferListed ? 0.1 : 0;
  if (ratio + listedBonus >= 0.95) return { type: 'accept' };
  if (feeRound >= 2) {
    // We've already countered twice — final answer.
    if (ratio + listedBonus >= 0.85) return { type: 'accept' };
    return {
      type: 'reject',
      reason: 'After three rounds of talks, the selling club has walked away.',
    };
  }
  if (ratio < 0.5 && !player.transferListed) {
    return {
      type: 'reject',
      reason: 'The bid is well below their valuation — they refuse to negotiate.',
    };
  }
  // Counter: meet halfway between bid and valuation, slightly closer to valuation.
  // Round to a step that scales with the value (avoids tiny deals snapping to $0).
  const rawCounter = (fee + valuation * 2) / 3;
  const step = rawCounter < 250000 ? 2500 : rawCounter < 1000000 ? 25000 : 100000;
  const counter = Math.max(step, Math.round(rawCounter / step) * step);
  const reasons = [
    `Their analyst says ${player.nickname} is worth at least $${valuation.toLocaleString()}.`,
    `${sellingTeam?.name ?? 'The club'} won't sell their starter for less than $${counter.toLocaleString()}.`,
    `Counter on the table — they want $${counter.toLocaleString()} or no deal.`,
  ];
  return { type: 'counter', counterFee: counter, reason: rng.pick(reasons) };
}

// ============ Stage 2: personal terms response ============

export type PlayerTermsResponse =
  | { type: 'accept' }
  | { type: 'counter'; demand: PersonalTerms; reason: string }
  | { type: 'reject'; reason: string };

// ---- Expected-value helpers per term ----

const STATUS_RANK: Record<SquadStatusPromise, number> = {
  star: 5, 'first-team': 4, rotation: 3, backup: 2, prospect: 1,
};

/** What squad status the player feels he deserves based on CA + age + role. */
export function expectedSquadStatus(player: Player): SquadStatusPromise {
  if (player.currentAbility >= 160) return 'star';
  if (player.currentAbility >= 140) return 'first-team';
  if (player.currentAbility >= 115) return 'rotation';
  if (player.age <= 21) return 'prospect';
  return 'backup';
}

/** Players want richer rises when their agent is pushier. 5-15%. */
function expectedWageRisePct(agentMul: number): number {
  return Math.round((5 + (agentMul - 1) * 60) * 10) / 10;
}

/** Players expect a signing bonus roughly 3-6 months of wage for stars. */
function expectedSigningBonus(wageAsk: number, player: Player): number {
  const months = player.currentAbility >= 150 ? 5 : player.currentAbility >= 120 ? 3 : 1.5;
  return Math.round((wageAsk * months) / 1000) * 1000;
}

/** Sell-on percent tolerance: stars hate giving away upside; juniors care less. */
function maxToleratedSellOn(player: Player): number {
  if (player.currentAbility >= 150) return 5;
  if (player.currentAbility >= 120) return 15;
  return 30;
}

/**
 * The player evaluates personal terms across every knob. Returns concrete
 * accept/counter/reject with a player-facing reason that names which terms
 * fell short. The counter demand always touches the SPECIFIC fields the
 * player is unhappy with — the user can then haggle on those without giving
 * up everything.
 */
export function evaluatePersonalTerms(
  player: Player,
  terms: PersonalTerms,
  teams: Record<string, Team>,
  bidderId: string,
  feeRound: number,
  agent: { demandMultiplier: number },
  rng: RNG,
): PlayerTermsResponse {
  // Bidder reputation softens the player's resistance.
  const bidder = teams[bidderId];
  const bidderRankMul = bidder ? Math.max(0.85, 1.15 - bidder.worldRanking / 80) : 1.0;
  // Agent fee softens the agent — every $50k of fee shaves 5% off the demand multiplier.
  const agentSoftening = Math.min(0.15, (terms.agentFee ?? 0) / 1_000_000);
  const effectiveAgentMul = Math.max(1.0, agent.demandMultiplier - agentSoftening);
  const wageAsk = playerWageDemand(player, teams, effectiveAgentMul);

  // ---- Per-term grievances (each adds friction; bigger gap = louder complaint) ----
  type Grievance = { field: string; phrase: string; severity: number };
  const grievances: Grievance[] = [];

  // Wage (the headline number)
  const wageRatio = terms.wage / wageAsk;
  if (wageRatio < 0.97 * bidderRankMul) {
    grievances.push({
      field: 'wage',
      phrase: `wants $${wageAsk.toLocaleString()}/mo — your offer falls short`,
      severity: (1 - wageRatio) * 100,
    });
  }

  // Signing bonus (stars expect one)
  const expectedSign = expectedSigningBonus(wageAsk, player);
  if ((terms.signingBonus ?? 0) < expectedSign * 0.5 && player.currentAbility >= 120) {
    grievances.push({
      field: 'signing',
      phrase: `expects a signing bonus around $${expectedSign.toLocaleString()}`,
      severity: 30,
    });
  }

  // Wage rises — pushy agents demand at least 5%/yr on multi-year deals
  const expectedRise = expectedWageRisePct(effectiveAgentMul);
  if (terms.contractYears >= 2 && (terms.wageRisePct ?? 0) < expectedRise * 0.7) {
    grievances.push({
      field: 'rises',
      phrase: `wants a ${expectedRise}%/year wage escalator`,
      severity: 20,
    });
  }

  // Squad status — player won't accept below his expectation
  const wantStatus = expectedSquadStatus(player);
  const offerStatus = terms.squadStatus ?? 'rotation';
  if (STATUS_RANK[offerStatus] < STATUS_RANK[wantStatus]) {
    grievances.push({
      field: 'status',
      phrase: `expects to be promised "${wantStatus}" status, not "${offerStatus}"`,
      severity: 40,
    });
  }

  // Sell-on percent — stars resent giving away resale value
  const maxSellOn = maxToleratedSellOn(player);
  if ((terms.sellOnPercent ?? 0) > maxSellOn) {
    grievances.push({
      field: 'sellon',
      phrase: `won't agree to more than ${maxSellOn}% sell-on`,
      severity: 25,
    });
  }

  // Buyout clause — too low = they want more wage to compensate (less freedom)
  // We treat "low" as below 1.5× the fee.
  const minBuyout = bidder ? Math.round((terms.wage * 12 * terms.contractYears) * 1.5) : 0;
  if (bidder && (terms.buyoutClause ?? 0) < minBuyout * 0.5) {
    grievances.push({
      field: 'buyout',
      phrase: `wants a release clause near $${minBuyout.toLocaleString()}`,
      severity: 15,
    });
  }

  // Total dissatisfaction score
  const totalSeverity = grievances.reduce((s, g) => s + g.severity, 0);

  // Decide outcome
  if (totalSeverity < 5) {
    return { type: 'accept' };
  }
  if (feeRound >= 2) {
    if (totalSeverity < 20) return { type: 'accept' };
    const worst = grievances.sort((a, b) => b.severity - a.severity)[0];
    return {
      type: 'reject',
      reason: `Final answer — ${player.nickname} ${worst.phrase}. Negotiation called off.`,
    };
  }
  if (totalSeverity > 120) {
    return {
      type: 'reject',
      reason: `${player.nickname}'s camp finds the offer insulting and walks away.`,
    };
  }

  // ---- Build a counter that addresses each grievance ----
  const counterWage = wageRatio < 0.97 * bidderRankMul
    ? Math.round(((terms.wage + wageAsk * 2) / 3) / 500) * 500
    : terms.wage;
  const demand: PersonalTerms = {
    ...terms,
    wage: counterWage,
  };
  for (const g of grievances) {
    switch (g.field) {
      case 'signing':
        demand.signingBonus = expectedSign;
        break;
      case 'rises':
        demand.wageRisePct = expectedRise;
        break;
      case 'status':
        demand.squadStatus = wantStatus;
        break;
      case 'sellon':
        demand.sellOnPercent = Math.min(terms.sellOnPercent ?? 0, maxSellOn);
        break;
      case 'buyout':
        demand.buyoutClause = Math.max(terms.buyoutClause ?? 0, Math.round(minBuyout * 0.75));
        break;
    }
  }

  // Compose a player-voice reason listing the top 1-2 grievances.
  const top = grievances.sort((a, b) => b.severity - a.severity).slice(0, 2);
  const phraseList = top.map((g) => g.phrase).join('; and ');
  const opener = effectiveAgentMul > 1.1
    ? `Agent ${agent.demandMultiplier > 1.1 ? 'is pushing hard' : 'pushes back'}:`
    : `${player.nickname} responds:`;
  const reason = `${opener} ${phraseList}.`;
  void rng; // reserved for future flavour variations
  return { type: 'counter', demand, reason };
}

/** Helper for the UI to surface what the player is asking for, even before any counter lands. */
export function previewExpectedTerms(
  player: Player,
  teams: Record<string, Team>,
  agentMul: number,
): { wage: number; signingBonus: number; status: SquadStatusPromise; wageRisePct: number } {
  const wage = playerWageDemand(player, teams, agentMul);
  return {
    wage,
    signingBonus: expectedSigningBonus(wage, player),
    status: expectedSquadStatus(player),
    wageRisePct: expectedWageRisePct(agentMul),
  };
}

// ============ Rival bid drama ============

/**
 * Roll for a rival club to drop a competing bid during an active negotiation.
 * Returns the rival bid if it happens, null otherwise. Higher-ranked teams
 * attract more poaching attention.
 */
export function maybeRivalBid(
  player: Player,
  offer: TransferOffer,
  teams: Record<string, Team>,
  today: string,
  rng: RNG,
): TransferOffer['rivalBid'] | null {
  if (offer.rivalBid) return null; // already happened once
  // Big-name players (high CA) attract more interest. Base 4%/day, ramps with CA.
  const p = 0.03 + Math.max(0, (player.currentAbility - 130) / 600);
  if (!rng.chance(p)) return null;
  // Pick a top-12 rival team (not the user, not the current bidder)
  const rivals = Object.values(teams)
    .filter((t) => !t.isUser && t.id !== offer.fromTeamId && t.worldRanking <= 12)
    .sort((a, b) => a.worldRanking - b.worldRanking);
  if (rivals.length === 0) return null;
  const rival = rng.pick(rivals.slice(0, 6));
  // Rival bid is 10-25% over your current offer.
  const rivalFee = Math.round(offer.fee * (1.1 + rng.next() * 0.15));
  return { teamId: rival.id, fee: rivalFee, receivedOn: today };
}

// ============ Sell-on payout ============

/** Compute and pay out a sell-on cut to a player's previous club, if any. */
export function applySellOnPayout(g: GameState, soldPlayer: Player, fee: number): number {
  const pct = soldPlayer.contract?.sellOnPercent ?? 0;
  const beneficiary = soldPlayer.contract?.sellOnBeneficiary;
  if (pct <= 0 || !beneficiary) return 0;
  const cut = Math.round((fee * pct) / 100);
  const bene = g.teams[beneficiary];
  if (!bene) return 0;
  bene.budget += cut;
  return cut;
}
