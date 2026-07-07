// Card Duel engine — Splinterlands-style auto-battle for 5-card decks.
//
// Design:
//   - Each player picks 5 of their 12 roster players. Slot order is
//     mirrored: A slot 0 vs B slot 0, etc. When a card dies, its
//     attacks are re-targeted to the lowest-index living opponent.
//   - Each turn:
//       1. Draw a shared Situation card from a 12-template deck.
//       2. Every LIVING card strikes (fastest first). Damage:
//            base = max(1, atk × situationAtkMult - def/2)
//            if role advantage: × 1.5
//            × jitter (0.9-1.1)
//            × situationDefMult applied to target's DR
//       3. Situation-specific hooks (Flashbang skips, Crossfire hits
//          two, Clutch Time buffs the last living unit, etc.).
//   - Battle continues until one side is empty.
//   - Deterministic: same RNG seed → same battle. Used to pin frames.

import { RNG, hashSeed } from '../../src/engine/rng.ts';
import type { Player, PlayerRole } from '../../src/types.ts';
import type {
  CardDuelBattle, CardDuelCard, CardDuelSituation, CardDuelSituationId,
  CardDuelSlot, CardDuelStrike, CardDuelTurn,
} from '../../src/online/protocol.ts';

// ---------------------------------------------------------------------
// Card build — turn Player into a CardDuelCard
// ---------------------------------------------------------------------

/** HP scales with endurance: 4× + 20. Range roughly 24 (endurance 1)
 *  to 100 (endurance 20). Doesn't factor role at all — HP is pure
 *  endurance, per user spec. */
export function cardFromPlayer(p: Player, slot: CardDuelSlot): CardDuelCard {
  const a = p.attributes;
  return {
    playerId: p.id,
    nickname: p.nickname,
    role: p.role,
    slot,
    maxHp: Math.round((a.endurance ?? 10) * 4 + 20),
    attack: (a.aim + a.reflexes) / 2,
    defense: (a.positioning + a.composure) / 2,
    speed: a.reflexes,
  };
}

// ---------------------------------------------------------------------
// Role advantage cycle (rock-paper-scissors, 7-role chain)
// ---------------------------------------------------------------------
//
// Each row's role has ADVANTAGE OVER the value's role. Reads: "row
// beats value." Advantage grants +50% damage that strike.
//
//    Entry  beats  AWPer     (rushing overwhelms the sniper's setup)
//    AWPer  beats  Lurker    (long angles deny flanks)
//    Lurker beats  IGL       (flank harasses the caller)
//    IGL    beats  Rifler    (structure > raw firepower)
//    Rifler beats  Support   (outfrag wins duels)
//    Support beats Anchor    (utility digs holds out)
//    Anchor beats  Entry     (planted holds punish rushes)

const ROLE_COUNTERS: Record<PlayerRole, PlayerRole> = {
  Entry: 'AWPer',
  AWPer: 'Lurker',
  Lurker: 'IGL',
  IGL: 'Rifler',
  Rifler: 'Support',
  Support: 'Anchor',
  Anchor: 'Entry',
};

export function hasRoleAdvantage(attacker: PlayerRole, defender: PlayerRole): boolean {
  return ROLE_COUNTERS[attacker] === defender;
}

// ---------------------------------------------------------------------
// Situation-card deck (12 templates)
// ---------------------------------------------------------------------

interface SituationEffect {
  /** Multiplier on the ATTACKER's raw damage this turn. Default 1. */
  atkMult?: number;
  /** Multiplier on the DEFENDER's mitigation (>1 = harder to hurt). */
  defMult?: number;
  /** If true, the attacker with the HIGHEST speed on the striking side
   *  gets a bonus for that strike. Used by AWP Pick. */
  awpBonus?: number;
  /** If true, one random attacker per side is skipped this turn. */
  flash?: boolean;
  /** If true, attackers ignore role advantage (Smoke Wall). */
  smokedRoles?: boolean;
  /** If true, each strike also splashes to the next living opponent
   *  for half damage (Crossfire). */
  crossfire?: boolean;
  /** If true, the LAST living card on each side gets +100% damage
   *  when its side has ≤1 living cards (Clutch Time). */
  clutch?: boolean;
  /** If true, attackers get +40% damage, defenders -20% def (Rush B). */
  rush?: boolean;
  /** If true, HALF the damage all this turn (Save Round). */
  save?: boolean;
}

const SITUATION_DECK: { id: CardDuelSituationId; effect: SituationEffect; attackerFavoured?: boolean }[] = [
  { id: 'eco',            effect: { atkMult: 0.5 } },
  { id: 'force_buy',      effect: { atkMult: 1.3, defMult: 0.8 }, attackerFavoured: true },
  { id: 'bomb_plant',     effect: { atkMult: 1.4 }, attackerFavoured: true },
  { id: 'bomb_defuse',    effect: { defMult: 1.4 }, attackerFavoured: false },
  { id: 'clutch_time',    effect: { clutch: true } },
  { id: 'awp_pick',       effect: { awpBonus: 2.0 } },
  { id: 'smoke_wall',     effect: { smokedRoles: true } },
  { id: 'flashbang',      effect: { flash: true } },
  { id: 'utility_execute', effect: { atkMult: 1.2 }, attackerFavoured: true },
  { id: 'crossfire',      effect: { crossfire: true } },
  { id: 'rush_b',         effect: { rush: true }, attackerFavoured: true },
  { id: 'save_round',     effect: { save: true } },
];

// ---------------------------------------------------------------------
// Battle sim
// ---------------------------------------------------------------------

/** Run a full auto-battle for two decks. Deterministic given the seed.
 *  Caller (server) persists the result + streams to both clients. */
export function simulateCardDuel(
  seed: string,
  aTeamTag: string,
  aDeck: Player[],
  bTeamTag: string,
  bDeck: Player[],
  matchId: string,
  stake: number,
): CardDuelBattle {
  const rng = new RNG(hashSeed(seed));
  const aCards = aDeck.slice(0, 5).map((p, i) => cardFromPlayer(p, i as CardDuelSlot));
  const bCards = bDeck.slice(0, 5).map((p, i) => cardFromPlayer(p, i as CardDuelSlot));
  // Living HP tracking, indexed by slot.
  const aHp: number[] = aCards.map((c) => c.maxHp);
  const bHp: number[] = bCards.map((c) => c.maxHp);

  const turns: CardDuelTurn[] = [];
  const MAX_TURNS = 30; // safety cap so a stall doesn't loop forever

  for (let turnNumber = 1; turnNumber <= MAX_TURNS; turnNumber++) {
    if (aHp.every((h) => h <= 0) || bHp.every((h) => h <= 0)) break;
    const drawn = SITUATION_DECK[rng.int(0, SITUATION_DECK.length - 1)]!;
    const situation: CardDuelSituation = { id: drawn.id };
    if (drawn.attackerFavoured !== undefined) situation.attackerFavoured = drawn.attackerFavoured;
    const effect = drawn.effect;
    const strikes: CardDuelStrike[] = [];

    // Build the strike order — every living card, sorted by speed desc,
    // ties broken by side then slot. A card that got flashed by
    // 'flashbang' still generates a strike record but marked skipped.
    interface Actor { side: 'A' | 'B'; slot: CardDuelSlot; card: CardDuelCard; hp: number }
    const actors: Actor[] = [];
    for (let s = 0; s < 5; s++) {
      if (aHp[s]! > 0) actors.push({ side: 'A', slot: s as CardDuelSlot, card: aCards[s]!, hp: aHp[s]! });
      if (bHp[s]! > 0) actors.push({ side: 'B', slot: s as CardDuelSlot, card: bCards[s]!, hp: bHp[s]! });
    }
    actors.sort((x, y) => y.card.speed - x.card.speed);

    // Flashbang: pick one random living card per side and flag them.
    const flashed = new Set<string>();
    if (effect.flash) {
      const aLive = actors.filter((a) => a.side === 'A');
      const bLive = actors.filter((a) => a.side === 'B');
      if (aLive.length > 0) flashed.add(`A${rng.pick(aLive).slot}`);
      if (bLive.length > 0) flashed.add(`B${rng.pick(bLive).slot}`);
    }
    // AWP pick: which slot on each side has the highest speed.
    let awpA: number | null = null, awpB: number | null = null;
    if (effect.awpBonus) {
      const aLive = actors.filter((a) => a.side === 'A');
      const bLive = actors.filter((a) => a.side === 'B');
      if (aLive.length > 0) awpA = aLive.reduce((best, cur) => cur.card.speed > best.card.speed ? cur : best).slot;
      if (bLive.length > 0) awpB = bLive.reduce((best, cur) => cur.card.speed > best.card.speed ? cur : best).slot;
    }

    // Resolve strikes in speed order. Attack the mirror slot if the
    // opposing card is alive; otherwise the lowest-index living target.
    for (const actor of actors) {
      // Might have died from a prior strike this turn.
      const nowHp = actor.side === 'A' ? aHp[actor.slot]! : bHp[actor.slot]!;
      if (nowHp <= 0) continue;

      const skipped = flashed.has(`${actor.side}${actor.slot}`);
      const oppHpArr = actor.side === 'A' ? bHp : aHp;
      const oppCards = actor.side === 'A' ? bCards : aCards;
      let targetSlot = actor.slot;
      if (oppHpArr[targetSlot]! <= 0) {
        const idx = oppHpArr.findIndex((h) => h > 0);
        if (idx === -1) break; // opponent wiped mid-turn
        targetSlot = idx as CardDuelSlot;
      }
      if (skipped) {
        strikes.push({
          attackerSide: actor.side, attackerSlot: actor.slot,
          targetSlot: targetSlot as CardDuelSlot,
          damage: 0, advantage: false, skipped: true,
          targetHpAfter: oppHpArr[targetSlot]!, targetSlain: false,
        });
        continue;
      }

      const targetCard = oppCards[targetSlot]!;
      const advantage = !effect.smokedRoles && hasRoleAdvantage(actor.card.role, targetCard.role);
      const isAwpPick = (actor.side === 'A' ? actor.slot === awpA : actor.slot === awpB);

      // Base damage formula.
      let atk = actor.card.attack;
      let def = targetCard.defense;
      if (effect.atkMult) atk *= effect.atkMult;
      if (effect.defMult) def *= effect.defMult;
      if (effect.rush) { atk *= 1.4; def *= 0.8; }
      if (effect.save) { atk *= 0.5; }
      if (effect.clutch) {
        const myLive = (actor.side === 'A' ? aHp : bHp).filter((h) => h > 0).length;
        if (myLive <= 1) atk *= 2.0;
      }
      const jitter = 0.9 + rng.next() * 0.2;
      let damage = Math.max(1, Math.round((atk - def / 2) * (advantage ? 1.5 : 1) * (isAwpPick ? effect.awpBonus ?? 1 : 1) * jitter));
      // Cap damage to remaining HP so numbers don't overflow visually.
      damage = Math.min(damage, oppHpArr[targetSlot]!);

      oppHpArr[targetSlot]! -= damage;
      const slain = oppHpArr[targetSlot]! <= 0;
      strikes.push({
        attackerSide: actor.side,
        attackerSlot: actor.slot,
        targetSlot: targetSlot as CardDuelSlot,
        damage,
        advantage,
        skipped: false,
        targetHpAfter: Math.max(0, oppHpArr[targetSlot]!),
        targetSlain: slain,
      });

      // Crossfire: splash for half damage to the next living opponent.
      if (effect.crossfire) {
        const remaining = oppHpArr
          .map((h, i) => ({ h, i }))
          .filter((x) => x.h > 0 && x.i !== targetSlot);
        if (remaining.length > 0) {
          const splashTarget = remaining[0]!.i as CardDuelSlot;
          const splashDamage = Math.max(1, Math.min(Math.round(damage / 2), oppHpArr[splashTarget]!));
          oppHpArr[splashTarget]! -= splashDamage;
          strikes.push({
            attackerSide: actor.side,
            attackerSlot: actor.slot,
            targetSlot: splashTarget,
            damage: splashDamage,
            advantage: false,
            skipped: false,
            targetHpAfter: Math.max(0, oppHpArr[splashTarget]!),
            targetSlain: oppHpArr[splashTarget]! <= 0,
          });
        }
      }
    }

    turns.push({ turnNumber, situation, strikes });
    if (aHp.every((h) => h <= 0) || bHp.every((h) => h <= 0)) break;
  }

  const aAlive = aHp.some((h) => h > 0);
  const bAlive = bHp.some((h) => h > 0);
  // If both are alive at MAX_TURNS (stall), the side with MORE remaining
  // total HP wins. Ties go to A (matchmaker order).
  let winner: 'A' | 'B';
  if (aAlive && !bAlive) winner = 'A';
  else if (!aAlive && bAlive) winner = 'B';
  else {
    const aTotal = aHp.reduce((s, h) => s + Math.max(0, h), 0);
    const bTotal = bHp.reduce((s, h) => s + Math.max(0, h), 0);
    winner = aTotal >= bTotal ? 'A' : 'B';
  }

  return {
    matchId,
    aTeamTag,
    bTeamTag,
    aCards,
    bCards,
    turns,
    winner,
    quit: false,
    stake,
  };
}

/** Build a concede/quit battle result — for when a player disconnects
 *  or explicitly forfeits before the sim runs. The remaining player
 *  wins on the spot with an empty turn stream. */
export function buildConcedeBattle(
  aTeamTag: string, bTeamTag: string,
  aDeck: Player[], bDeck: Player[],
  matchId: string, stake: number,
  quitterSide: 'A' | 'B',
): CardDuelBattle {
  return {
    matchId, aTeamTag, bTeamTag,
    aCards: aDeck.slice(0, 5).map((p, i) => cardFromPlayer(p, i as CardDuelSlot)),
    bCards: bDeck.slice(0, 5).map((p, i) => cardFromPlayer(p, i as CardDuelSlot)),
    turns: [],
    winner: quitterSide === 'A' ? 'B' : 'A',
    quit: true,
    stake,
  };
}
