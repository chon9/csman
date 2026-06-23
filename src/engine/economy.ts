import type { BuyType, Tactics } from '../types';
import type { RNG } from './rng';

// CS2 MR12 economy model (per-team aggregate, per-player money tracked as avg)
export const START_MONEY = 800;
export const MAX_MONEY = 16000;
export const WIN_REWARD = 3250;
export const WIN_REWARD_BOMB = 3500;
export const PLANT_REWARD = 800; // team bonus when T loses but planted
export const LOSS_BONUS = [1400, 1900, 2400, 2900, 3400];

export interface TeamEconomy {
  money: number; // average per player
  lossStreak: number;
  // equipment value carried into next round (survivors keep guns)
  carriedValue: number;
}

export function freshEconomy(): TeamEconomy {
  return { money: START_MONEY, lossStreak: 0, carriedValue: 200 };
}

export interface BuyDecision {
  type: BuyType;
  equipValue: number; // avg equipment value per player after buy
  utilityLevel: number; // 0-1 how much utility purchased
}

const FULL_BUY_COST = 4700; // rifle + armor + util avg
const FORCE_COST = 2600;
const HALF_COST = 2000;
const ECO_COST = 400;

export function decideBuy(
  eco: TeamEconomy,
  roundNo: number,
  isPistolRound: boolean,
  tactics: Pick<Tactics, 'ecoDiscipline' | 'forceBuyTendency'>,
  oppLikelyStrong: boolean,
  rng: RNG,
): BuyDecision {
  if (isPistolRound) {
    return { type: 'pistol', equipValue: 800 + eco.carriedValue * 0.1, utilityLevel: 0.25 };
  }
  const effective = eco.money + eco.carriedValue * 0.55;

  if (effective >= FULL_BUY_COST) {
    return { type: 'full', equipValue: Math.min(5400, effective), utilityLevel: 0.9 };
  }

  // Force-buy logic: tendency slider + situational desperation
  const forceBias = tactics.forceBuyTendency / 20;
  const discipline = tactics.ecoDiscipline / 20;
  const desperation = roundNo === 12 || roundNo === 24 ? 0.35 : 0; // last round of half: nothing to save for
  const oppWeak = !oppLikelyStrong ? 0.2 : 0;
  const forceP = Math.max(0, Math.min(0.95, 0.18 + forceBias * 0.5 - discipline * 0.3 + desperation + oppWeak));

  if (effective >= FORCE_COST && rng.chance(forceP)) {
    return { type: 'force', equipValue: Math.min(3600, effective), utilityLevel: 0.45 };
  }
  if (effective >= HALF_COST && rng.chance(0.3)) {
    return { type: 'half', equipValue: Math.min(2800, effective), utilityLevel: 0.35 };
  }
  return { type: 'eco', equipValue: ECO_COST + eco.carriedValue * 0.3, utilityLevel: 0.05 };
}

export function applyRoundEconomy(
  eco: TeamEconomy,
  won: boolean,
  byBomb: boolean,
  planted: boolean,
  survivors: number,
  buy: BuyDecision,
  kills: number,
): TeamEconomy {
  let money = eco.money - Math.min(eco.money, buyCost(buy));
  let lossStreak = eco.lossStreak;
  if (won) {
    money += byBomb ? WIN_REWARD_BOMB : WIN_REWARD;
    lossStreak = Math.max(0, lossStreak - 1);
  } else {
    money += LOSS_BONUS[Math.min(lossStreak, LOSS_BONUS.length - 1)];
    if (planted && !won) money += PLANT_REWARD;
    lossStreak = Math.min(4, lossStreak + 1);
  }
  money += kills * 230; // avg kill reward spread over 5 players ≈ 300*kills/5*~4
  money = Math.min(MAX_MONEY, money);

  // survivors carry equipment
  const carriedValue = won
    ? buy.equipValue * 0.85
    : (survivors / 5) * buy.equipValue * 0.6;

  return { money, lossStreak, carriedValue };
}

function buyCost(buy: BuyDecision): number {
  switch (buy.type) {
    case 'pistol': return 650;
    case 'eco': return ECO_COST;
    case 'half': return HALF_COST;
    case 'force': return FORCE_COST;
    case 'full': return FULL_BUY_COST;
  }
}

/**
 * Pre-round broadcast line describing the team's buy state. Returns null when
 * the buy is uninteresting (e.g. routine full buy with healthy economy) so the
 * commentary feed isn't spammed every round.
 */
export function economyLine(
  buy: BuyDecision,
  eco: TeamEconomy,
  isPistol: boolean,
  teamTag: string,
  rng: RNG,
): string | null {
  if (isPistol) return null;
  switch (buy.type) {
    case 'full': {
      // Only call out full buys when they're notable: coming off a save,
      // big economy lead, or recovery after a loss streak.
      if (eco.lossStreak === 0 && eco.money > 5500) return null;
      if (eco.lossStreak >= 2) {
        return rng.pick([
          `${teamTag} reset to a full buy after the loss streak — they need this round.`,
          `${teamTag} finally full buy — first proper round in a while.`,
        ]);
      }
      return rng.pick([
        `${teamTag} full buy — rifles, armour and a full util pack.`,
        `${teamTag} loaded up — they have everything for this round.`,
      ]);
    }
    case 'force':
      return rng.pick([
        `${teamTag} force buy — going all in on this round.`,
        `${teamTag} can't afford to save — they're forcing it.`,
        `Force from ${teamTag} — rifles down, but utility's thin.`,
      ]);
    case 'half':
      return rng.pick([
        `${teamTag} half-buy — SMGs and pistols, hunting picks.`,
        `Half-buy from ${teamTag} — they're keeping it cheap.`,
      ]);
    case 'eco': {
      if (eco.lossStreak >= 3) {
        return `${teamTag} on the deck — full save after a brutal stretch.`;
      }
      return rng.pick([
        `${teamTag} save the round — banking for the next buy.`,
        `${teamTag} on a full save — pistols only.`,
      ]);
    }
    case 'pistol':
      return null;
  }
}

export function weaponForBuy(buy: BuyType, side: 'T' | 'CT', isAwper: boolean, rng: RNG): string {
  switch (buy) {
    case 'pistol':
      return side === 'T' ? rng.pick(['Glock-18', 'Glock-18', 'Glock-18']) : rng.pick(['USP-S', 'USP-S', 'P2000']);
    case 'eco':
      return rng.pick(side === 'T' ? ['Glock-18', 'P250', 'Tec-9'] : ['USP-S', 'P250', 'Five-SeveN']);
    case 'half':
      return rng.pick(['MAC-10', 'MP9', 'FAMAS', 'Galil AR', 'P250']);
    case 'force':
      return isAwper && rng.chance(0.2) ? 'SSG 08' : rng.pick(side === 'T' ? ['Galil AR', 'MAC-10', 'Tec-9', 'AK-47'] : ['FAMAS', 'MP9', 'UMP-45', 'M4A1-S']);
    case 'full':
      if (isAwper) return rng.chance(0.85) ? 'AWP' : side === 'T' ? 'AK-47' : 'M4A4';
      return side === 'T' ? 'AK-47' : rng.chance(0.6) ? 'M4A1-S' : 'M4A4';
  }
}
