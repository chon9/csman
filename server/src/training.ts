// Training Center — high-risk / high-return idle mechanic.
//
// Flow:
//   1. start-training  → validates + inserts one training_sessions row
//   2. …5 real minutes…
//   3. collect-training → server rolls outcome, applies to player JSON,
//                         deletes session row, returns outcome for the
//                         result modal
//   4. cancel-training  → deletes session row (no penalty; wasted timer)
//
// Outcome roll is authoritative on the server. Client can't peek and
// can't influence RNG. `--seed`-free — uses Math.random() (each roll is
// independent; the risk profile doesn't need reproducibility).

import type { DB } from './db.ts';
import type { Player, PlayerAttributes } from '../../src/types.ts';
import {
  TRAINING_ODDS,
  trainingRarityFor,
  type TrainingOutcome,
  type TrainingRarity,
} from '../../src/online/protocol.ts';

const ATTR_MIN = 1;
const ATTR_MAX = 20;
const PA_MAX = 200;
/** How much the composure+resilience floor discounts the two bad outcomes.
 *  (comp+res)/40 * DAMPENER_MAX = fraction of retire+reduce weight removed
 *  and reallocated to success. E.g. 20 comp + 20 res = 1.0 * 0.5 = 50%
 *  of the bad probability shifts to success. */
const CR_DAMPENER_MAX = 0.5;
/** Jackpot PA bonus range — flat regardless of rarity (dream factor). */
const JACKPOT_PA_MIN = 5;
const JACKPOT_PA_MAX = 15;

/** Roll odds after adjusting for composure+resilience. Returns the four
 *  slice probabilities in the same order as TRAINING_ODDS. */
function adjustedOdds(
  rarity: TrainingRarity, composure: number, resilience: number,
): [number, number, number, number] {
  const [retire, reduce, success, jackpot] = TRAINING_ODDS[rarity];
  const cr = Math.max(0, Math.min(40, composure + resilience));
  const shift = (cr / 40) * CR_DAMPENER_MAX;
  const retireShifted = retire * (1 - shift);
  const reduceShifted = reduce * (1 - shift);
  const successBonus = (retire + reduce) - (retireShifted + reduceShifted);
  return [retireShifted, reduceShifted, success + successBonus, jackpot];
}

function pickOutcome(odds: [number, number, number, number]): 'retire' | 'reduce' | 'success' | 'jackpot' {
  const r = Math.random();
  const [retire, reduce, success] = odds;
  if (r < retire) return 'retire';
  if (r < retire + reduce) return 'reduce';
  if (r < retire + reduce + success) return 'success';
  return 'jackpot';
}

/** Roll an outcome + mutate the player object in place. Caller is
 *  responsible for persisting (persistPlayer) and, on retire, pruning
 *  the roster + team.playerIds list. */
export function rollTrainingOutcome(
  player: Player, attribute: keyof PlayerAttributes,
): TrainingOutcome {
  const pa = player.potentialAbility ?? 100;
  const rarity = trainingRarityFor(pa);
  const composure = player.attributes.composure ?? 10;
  const resilience = player.attributes.resilience ?? 10;
  const odds = adjustedOdds(rarity, composure, resilience);
  const kind = pickOutcome(odds);

  const base = {
    playerId: player.id,
    playerNickname: player.nickname,
    attribute,
  };

  switch (kind) {
    case 'retire': {
      player.retired = true;
      // player.teamId set to null by the caller (needs team.playerIds prune too).
      return { ...base, kind, attrDelta: 0, paDelta: 0, retired: true };
    }
    case 'reduce': {
      const before = player.attributes[attribute];
      const after = Math.max(ATTR_MIN, before - 1);
      player.attributes[attribute] = after;
      return { ...base, kind, attrDelta: after - before, paDelta: 0, retired: false, newAttrValue: after };
    }
    case 'success': {
      const before = player.attributes[attribute];
      const after = Math.min(ATTR_MAX, before + 1);
      player.attributes[attribute] = after;
      return { ...base, kind, attrDelta: after - before, paDelta: 0, retired: false, newAttrValue: after };
    }
    case 'jackpot': {
      const paBonus = Math.floor(JACKPOT_PA_MIN + Math.random() * (JACKPOT_PA_MAX - JACKPOT_PA_MIN + 1));
      const newPA = Math.min(PA_MAX, pa + paBonus);
      const paDelta = newPA - pa;
      player.potentialAbility = newPA;
      const beforeAttr = player.attributes[attribute];
      const afterAttr = Math.min(ATTR_MAX, beforeAttr + 1);
      player.attributes[attribute] = afterAttr;
      return {
        ...base, kind, attrDelta: afterAttr - beforeAttr, paDelta,
        retired: false, newAttrValue: afterAttr, newPA,
      };
    }
  }
}

/** Format an outcome as a compact log line for the server console. */
export function logLineFor(outcome: TrainingOutcome, teamTag: string): string {
  const attr = outcome.attribute;
  switch (outcome.kind) {
    case 'jackpot':
      return `[${teamTag}] JACKPOT · ${outcome.playerNickname} PA +${outcome.paDelta} → ${outcome.newPA}, ${attr} +1`;
    case 'success':
      return `[${teamTag}] success · ${outcome.playerNickname} ${attr} +1 → ${outcome.newAttrValue}`;
    case 'reduce':
      return `[${teamTag}] setback · ${outcome.playerNickname} ${attr} -1 → ${outcome.newAttrValue}`;
    case 'retire':
      return `[${teamTag}] CAREER-ENDING · ${outcome.playerNickname} retired`;
  }
}

/** True if the given player is eligible to enter the training center.
 *  Real-name (HLTV) players are evergreen and can't be trained. Retired
 *  players are already gone. */
export function canTrain(player: Player): boolean {
  if (player.isRealName) return false;
  if (player.retired) return false;
  return true;
}

/** Load the caller team's active training session and turn it into a
 *  wire payload. Returns null when there's no session. */
export function loadTrainingWire(
  db: DB, teamId: string,
): { session: import('../../src/online/protocol.ts').TrainingSessionWire | null } {
  const row = db.loadTrainingSession(teamId);
  if (!row) return { session: null };
  const player = db.loadPlayer(row.player_id);
  if (!player) {
    // Session is orphaned (player was released or somehow left the roster).
    // Clean it up so the user isn't stuck holding a phantom timer.
    db.clearTrainingSession(teamId);
    return { session: null };
  }
  const rarity = trainingRarityFor(player.potentialAbility ?? 100);
  const readyAt = row.started_at + (5 * 60 * 1000);
  return {
    session: {
      playerId: row.player_id,
      playerNickname: player.nickname,
      attribute: row.attribute as keyof PlayerAttributes,
      startedAt: row.started_at,
      readyAt,
      rarity,
    },
  };
}
