// AI vs AI betting market.
//
// Server runs a small periodic loop that keeps ~AI_BET_ACTIVE_CARDS open
// match cards alive at all times. Each card is two FULLY-synthetic teams
// (random names, logos, 5-player rosters) with a scheduled start time
// 8 minutes out. Players bet on either side; bets lock 20 s before
// kickoff. At start time the server runs the duel via the same engine
// the user-vs-AI flow uses, settles every bet, and stashes the full
// frames-bearing MatchResult in the live-replay cache so users can
// watch the replay for 10 minutes after.
//
// Odds derive from team CA AND role synergy AND a per-team "form" roll
// AND a tactical-matchup roll — so the highest-CA side doesn't always
// win the line, matching the user's "prevent CA high always win" ask.

import { randomBytes } from 'node:crypto';
import { RNG, hashSeed } from '../../src/engine/rng.ts';
import { roleSynergyMultiplier } from '../../src/engine/matchEngine.ts';
import { simulateMatch } from '../../src/engine/matchEngine.ts';
import { MAP_LAYOUTS } from '../../src/data/maps.ts';
import { cacheLiveReplay } from './liveState.ts';
import { generateAiOpponent } from './duels.ts';
import {
  AI_BET_ACTIVE_CARDS,
  AI_BET_COUNTDOWN_MS,
  AI_BET_HOUSE_EDGE,
  AI_BET_LOCK_LEAD_MS,
  AI_BET_REPLAY_WINDOW_MS,
  LOGO_PACK,
  type AiBetHistoryEntry,
  type AiBetTeamProfile,
  type AiMatchCardWire,
} from '../../src/online/protocol.ts';
import { DEFAULT_TACTICS, type Player, type Tactics, type Team } from '../../src/types.ts';
import type { DB } from './db.ts';
import type { Broadcast, NotifyTeam } from './handlers.ts';

// ---------------------------------------------------------------------
// Card payload — stored in payload_json. Includes the full reconstructable
// match state so we can run the sim at kickoff time without re-rolling
// the teams.
// ---------------------------------------------------------------------

interface CardPayload {
  teamA: SyntheticTeam;
  teamB: SyntheticTeam;
  oddsA: number;
  oddsB: number;
  tacticsA: Partial<Tactics>;
  tacticsB: Partial<Tactics>;
  winnerSide?: 'A' | 'B';
  /** Stripped match result (no frames) post-sim. Frames live in the
   *  live-replay cache, keyed by matchHistoryId. */
  resultMapsA?: number;
  resultMapsB?: number;
}

interface SyntheticTeam {
  team: Team;
  players: Player[];
  /** Snapshot of CA + synergy at generation time (drives odds + UI). */
  totalCA: number;
  synergy: number;
  /** Display fields the wire needs. */
  logoId: string;
  primaryColor: string;
}

// ---------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------

const PRIMARY_COLORS = [
  '#e25555', '#de9b35', '#f2c443', '#6ed09a', '#4b69ff', '#8847ff',
  '#d32ce6', '#eb4b4b', '#3b7be0', '#6aa7ec', '#9be29b', '#ff8a00',
];

function rollTargetCA(rng: RNG): number {
  // Spread of CA bands so we get a mix of marquee / mid / scrappy cards.
  // Most matches sit in the 100-160 range; a small minority are blowouts.
  const r = rng.next();
  if (r < 0.10) return rng.int(80, 110);   // weak
  if (r < 0.35) return rng.int(105, 140);  // mid
  if (r < 0.80) return rng.int(135, 175);  // strong
  return rng.int(165, 195);                // elite
}

function buildSyntheticTeam(rng: RNG): SyntheticTeam {
  // Reuse the existing user-vs-AI opponent generator but with a synthetic
  // "user" team that nudges CA toward the target band. Easiest way to
  // avoid re-implementing the player creation pipeline.
  const targetCA = rollTargetCA(rng);
  const userLike = Array.from({ length: 5 }, () => ({ currentAbility: targetCA } as Player));
  const { team, players } = generateAiOpponent(userLike, rng.int(0, 0x7fffffff));

  const totalCA = players.slice(0, 5).reduce((s, p) => s + p.currentAbility, 0);
  const synergy = roleSynergyMultiplier(players.slice(0, 5)).mult;

  return {
    team,
    players,
    totalCA,
    synergy,
    logoId: rng.pick(LOGO_PACK).id,
    primaryColor: rng.pick(PRIMARY_COLORS),
  };
}

// ---------------------------------------------------------------------
// Odds
// ---------------------------------------------------------------------

/** Decimal odds for both sides given the two teams. Multiple factors
 *  fold into the implied win probability so the higher-CA team isn't
 *  always favoured:
 *
 *    - Team total CA (the dominant factor)
 *    - Role synergy multiplier (a 2-AWPer team gets punished here)
 *    - Per-team random "form" roll (the daily upset factor)
 *    - Per-team random tactical-matchup roll (intangibles)
 *
 *  Then the bookmaker margin (AI_BET_HOUSE_EDGE) is shaved off both sides
 *  so the line is profitable on average across all matches. */
export function computeOdds(rng: RNG, a: SyntheticTeam, b: SyntheticTeam): { oddsA: number; oddsB: number } {
  // Form: each side rolls ±15% — big upsets come from here.
  const formA = 0.85 + rng.next() * 0.30;
  const formB = 0.85 + rng.next() * 0.30;
  // Tactical match-up: ±10% intangible advantage.
  const tacticA = 0.90 + rng.next() * 0.20;
  const tacticB = 0.90 + rng.next() * 0.20;
  // Composite strength.
  const strA = a.totalCA * a.synergy * formA * tacticA;
  const strB = b.totalCA * b.synergy * formB * tacticB;
  const probA = strA / (strA + strB);
  const probB = 1 - probA;
  // Margin shave + clamp so odds never go below 1.05 or above 12.
  const oddsA = Math.max(1.05, Math.min(12, (1 - AI_BET_HOUSE_EDGE) / probA));
  const oddsB = Math.max(1.05, Math.min(12, (1 - AI_BET_HOUSE_EDGE) / probB));
  return {
    oddsA: Math.round(oddsA * 100) / 100,
    oddsB: Math.round(oddsB * 100) / 100,
  };
}

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------

/** Make sure the active-card count is at AI_BET_ACTIVE_CARDS. Spawns
 *  fresh cards staggered so they don't all kick off at once. Called by
 *  the periodic tick in index.ts. */
export function ensureCards(db: DB, broadcast: Broadcast): void {
  const open = db.countOpenAiCards();
  if (open >= AI_BET_ACTIVE_CARDS) return;
  const needed = AI_BET_ACTIVE_CARDS - open;
  for (let i = 0; i < needed; i++) {
    const card = buildCardRow();
    db.createAiCard({
      id: card.id,
      status: 'open',
      scheduledStartAt: card.scheduledStartAt,
      payloadJson: JSON.stringify(card.payload),
    });
    // Push the new card to all clients so the betting screen updates live.
    broadcast({ kind: 'ai-bet-card-update', card: toWire(db, card.id, card.payload, 'open', card.scheduledStartAt, null) });
  }
}

interface BuiltCard { id: string; scheduledStartAt: number; payload: CardPayload }

function buildCardRow(): BuiltCard {
  const rng = new RNG(hashSeed(`ai-card-${Date.now()}-${Math.random()}`));
  const teamA = buildSyntheticTeam(rng);
  let teamB = buildSyntheticTeam(rng);
  // Defensive: if tags collide on a small RNG window, force a re-roll
  // once (shouldn't happen often).
  if (teamB.team.tag === teamA.team.tag) teamB = buildSyntheticTeam(rng);
  const { oddsA, oddsB } = computeOdds(rng, teamA, teamB);
  const stagger = rng.int(0, 90 * 1000); // 0-90 s offset so cards don't all share a deadline
  return {
    id: `aibet-${randomBytes(6).toString('hex')}`,
    scheduledStartAt: Date.now() + AI_BET_COUNTDOWN_MS + stagger,
    payload: { teamA, teamB, oddsA, oddsB, tacticsA: DEFAULT_TACTICS, tacticsB: DEFAULT_TACTICS },
  };
}

/** Walk every due card and run its sim + settle every bet on it.
 *  Idempotent — once a card's status is 'resolved' it gets skipped. */
export function settleDueCards(
  db: DB,
  notifyTeam: NotifyTeam,
  broadcast: Broadcast,
  log: (s: string) => void,
): void {
  const due = db.loadDueAiCards(Date.now());
  for (const row of due) {
    try {
      resolveCard(db, row, notifyTeam, broadcast, log);
    } catch (err) {
      log(`ai-bet settle error on ${row.id}: ${String(err)}`);
    }
  }
}

function resolveCard(
  db: DB,
  row: { id: string; payload_json: string; scheduled_start_at: number },
  notifyTeam: NotifyTeam,
  broadcast: Broadcast,
  log: (s: string) => void,
): void {
  const payload = JSON.parse(row.payload_json) as CardPayload;
  db.setAiCardStatus(row.id, 'live');

  // Run the sim using the engine's full simulateMatch path. We pass
  // DEFAULT_TACTICS for both sides since neither is human-managed.
  const matchId = `aibet-match-${row.id}`;
  const a = engineTeamOf(payload.teamA, payload.tacticsA);
  const b = engineTeamOf(payload.teamB, payload.tacticsB);
  // Pressure 0.55 — slightly above neutral; these are "showcase" matches
  // with everyone watching, so the choke factor matters a bit.
  const result = simulateMatch(matchId, a, b, 'BO1', MAP_LAYOUTS, 0.55);
  const winnerSide: 'A' | 'B' = result.winnerId === payload.teamA.team.id ? 'A' : 'B';
  payload.winnerSide = winnerSide;
  payload.resultMapsA = result.mapsA;
  payload.resultMapsB = result.mapsB;

  // Live-replay cache → enables fetch-ai-bet-replay during the replay window.
  cacheLiveReplay(matchId, result);

  // Persist the resolved payload back.
  db.resolveAiCard(row.id, matchId, JSON.stringify(payload));

  // Settle every bet on this card. Winners get stake × oddsAtBet. Each
  // settlement is also snapshotted into ai_bet_history — the live
  // ai_match_bets row gets nuked by cascade when cleanupStaleCards
  // deletes the card 10 min later, but the history row survives so the
  // "My Recent Bets" panel keeps showing it.
  const bets = db.loadAllAiBetsForCard(row.id);

  // Synced replay push — every bettor on this card gets routed into the
  // replay viewer in locked mode (4× speed, no scrub) so everyone with
  // money on the line watches the same match at the same beat. We also
  // send team A's roster ids so the spectator-mode replay viewer can
  // correctly identify which dots belong to which team (it can't anchor
  // on the user's own players for an AI vs AI match).
  const teamARosterIds = payload.teamA.players.slice(0, 5).map((p) => p.id);
  for (const bet of bets) {
    notifyTeam(bet.bettor_team_id, {
      kind: 'ai-bet-replay-starting',
      cardId: row.id,
      matchId,
      result,
      teamATag: payload.teamA.team.tag,
      teamBTag: payload.teamB.team.tag,
      teamARosterIds,
    });
  }

  for (const bet of bets) {
    const won = bet.side === winnerSide;
    const payout = won ? Math.round(bet.stake * bet.odds_at_bet) : 0;
    db.settleAiBetRow(bet.card_id, bet.bettor_team_id, won ? 'won' : 'lost', payout);
    db.recordAiBetHistory({
      bettorTeamId: bet.bettor_team_id,
      cardId: row.id,
      teamATag: payload.teamA.team.tag,
      teamBTag: payload.teamB.team.tag,
      teamALogo: payload.teamA.logoId,
      teamBLogo: payload.teamB.logoId,
      teamAColor: payload.teamA.primaryColor,
      teamBColor: payload.teamB.primaryColor,
      side: bet.side,
      stake: bet.stake,
      oddsAtBet: bet.odds_at_bet,
      status: won ? 'won' : 'lost',
      payout,
      winnerSide,
      mapsA: result.mapsA,
      mapsB: result.mapsB,
    });
    db.trimAiBetHistoryForTeam(bet.bettor_team_id, 100);
    if (payout > 0) {
      const team = db.loadTeam(bet.bettor_team_id);
      if (team) {
        team.money += payout;
        db.setTeamMoneyDay(team.id, team.money, team.day);
        notifyTeam(bet.bettor_team_id, { kind: 'team-money-updated', teamId: bet.bettor_team_id, money: team.money });
      }
    }
    notifyTeam(bet.bettor_team_id, {
      kind: 'ai-bet-settled',
      cardId: row.id,
      bet: {
        side: bet.side,
        stake: bet.stake,
        oddsAtBet: bet.odds_at_bet,
        status: won ? 'won' : 'lost',
        payout,
        placedAt: bet.placed_at,
      },
      newMoney: db.loadTeam(bet.bettor_team_id)?.money ?? 0,
    });
  }
  log(`ai-bet resolved ${row.id}: ${payload.teamA.team.tag} ${result.mapsA}-${result.mapsB} ${payload.teamB.team.tag} (${bets.length} bets)`);

  // Broadcast updated card to all clients.
  broadcast({
    kind: 'ai-bet-card-update',
    card: toWire(db, row.id, payload, 'resolved', row.scheduled_start_at, null, matchId),
  });
}

/** Drop resolved cards past the replay window. */
export function cleanupStaleCards(db: DB): void {
  const cutoff = Date.now() - AI_BET_REPLAY_WINDOW_MS;
  for (const id of db.loadStaleAiCardIds(cutoff)) {
    db.deleteAiCardById(id);
  }
}

// ---------------------------------------------------------------------
// Wire conversion
// ---------------------------------------------------------------------

function engineTeamOf(s: SyntheticTeam, tactics: Partial<Tactics>) {
  // Match the EngineTeam shape used elsewhere — chemistry rough-derived.
  const lineup = s.players.slice(0, 5);
  const avgMorale = lineup.reduce((sum, p) => sum + p.morale, 0) / Math.max(1, lineup.length);
  const avgTeamwork = lineup.reduce((sum, p) => sum + p.attributes.teamwork, 0) / Math.max(1, lineup.length);
  const avgComposure = lineup.reduce((sum, p) => sum + p.attributes.composure, 0) / Math.max(1, lineup.length);
  return {
    team: s.team,
    players: lineup,
    tactics: tactics as Tactics,
    pressureResistance: avgComposure,
    chemistry: Math.max(0, Math.min(100, avgTeamwork * 3 + avgMorale * 2.5)),
  };
}

/** Render a card payload for the wire, including the user's own bet
 *  (if any) and aggregate pool totals. */
export function toWire(
  db: DB,
  cardId: string,
  payload: CardPayload,
  status: 'open' | 'closing' | 'live' | 'resolved',
  scheduledStartAt: number,
  forTeamId: string | null,
  matchHistoryId?: string,
): AiMatchCardWire {
  const bets = db.loadAllAiBetsForCard(cardId);
  let poolA = 0, poolB = 0;
  for (const bet of bets) {
    if (bet.side === 'A') poolA += bet.stake;
    else poolB += bet.stake;
  }
  let myBet: AiMatchCardWire['myBet'] = null;
  if (forTeamId) {
    const mine = bets.find((b) => b.bettor_team_id === forTeamId);
    if (mine) {
      myBet = {
        side: mine.side,
        stake: mine.stake,
        oddsAtBet: mine.odds_at_bet,
        status: mine.status,
        payout: mine.payout ?? undefined,
        placedAt: mine.placed_at,
      };
    }
  }
  return {
    id: cardId,
    teamA: summary(payload.teamA),
    teamB: summary(payload.teamB),
    oddsA: payload.oddsA,
    oddsB: payload.oddsB,
    scheduledStartAt,
    status,
    winnerSide: payload.winnerSide ?? null,
    poolA, poolB,
    myBet,
    matchHistoryId,
  };
}

function summary(t: SyntheticTeam) {
  return {
    name: t.team.name,
    tag: t.team.tag,
    logoId: t.logoId,
    primaryColor: t.primaryColor,
    totalCA: t.totalCA,
    synergy: t.synergy,
  };
}

/** Walk all visible cards (open / closing / live / recently-resolved)
 *  and convert to wire shape. Filters by replay window for resolved
 *  cards client-side via the resolved_at check the SQL doesn't do. */
export function loadVisibleWire(db: DB, forTeamId: string | null): AiMatchCardWire[] {
  const rows = db.loadVisibleAiCards();
  const cutoff = Date.now() - AI_BET_REPLAY_WINDOW_MS;
  const out: AiMatchCardWire[] = [];
  for (const row of rows) {
    if (row.status === 'resolved' && (row.resolved_at ?? 0) < cutoff) continue;
    const payload = JSON.parse(row.payload_json) as CardPayload;
    // Recompute status: open until lock lead, then 'closing', then 'live' or 'resolved'.
    let liveStatus: 'open' | 'closing' | 'live' | 'resolved' = row.status as 'open' | 'closing' | 'live' | 'resolved';
    if (liveStatus === 'open' && Date.now() >= row.scheduled_start_at - AI_BET_LOCK_LEAD_MS) {
      liveStatus = 'closing';
    }
    out.push(toWire(db, row.id, payload, liveStatus, row.scheduled_start_at, forTeamId, row.match_history_id ?? undefined));
  }
  return out;
}

/** Place a bet — returns the new card wire shape (so the caller can
 *  echo it back) or an error message. */
export function placeBet(
  db: DB,
  cardId: string,
  bettorTeamId: string,
  side: 'A' | 'B',
  stake: number,
): { ok: true; card: AiMatchCardWire; teamMoney: number } | { ok: false; code: string; message: string } {
  const row = db.loadAiCard(cardId);
  if (!row) return { ok: false, code: 'no-card', message: 'Card not found.' };
  if (row.status !== 'open') {
    return { ok: false, code: 'closed', message: 'Bets are closed on this card.' };
  }
  if (Date.now() >= row.scheduled_start_at - AI_BET_LOCK_LEAD_MS) {
    return { ok: false, code: 'closed', message: 'Bets locked — kickoff imminent.' };
  }
  const team = db.loadTeam(bettorTeamId);
  if (!team) return { ok: false, code: 'no-team', message: 'Team missing.' };
  if (team.money < stake) return { ok: false, code: 'insufficient-funds', message: `Need $${stake.toLocaleString()} on hand.` };
  const payload = JSON.parse(row.payload_json) as CardPayload;
  const oddsAtBet = side === 'A' ? payload.oddsA : payload.oddsB;
  team.money -= stake;
  db.setTeamMoneyDay(team.id, team.money, team.day);
  db.placeAiBet({ cardId, bettorTeamId, side, stake, oddsAtBet });
  return {
    ok: true,
    teamMoney: team.money,
    card: toWire(db, cardId, payload, 'open', row.scheduled_start_at, bettorTeamId, row.match_history_id ?? undefined),
  };
}

/** Build the in-app "view team" profile for one side of a bet card.
 *  Pulled live from the card payload — these synthetic teams are NEVER
 *  written to the teams table, keeping the DB clean of throwaway rows. */
export function loadTeamProfileForCard(
  db: DB, cardId: string, side: 'A' | 'B',
): AiBetTeamProfile | null {
  const row = db.loadAiCard(cardId);
  if (!row) return null;
  const payload = JSON.parse(row.payload_json) as CardPayload;
  const s = side === 'A' ? payload.teamA : payload.teamB;
  return {
    name: s.team.name,
    tag: s.team.tag,
    logoId: s.logoId,
    primaryColor: s.primaryColor,
    totalCA: s.totalCA,
    synergy: s.synergy,
    players: s.players.slice(0, 5).map((p) => ({
      nickname: p.nickname,
      firstName: p.firstName,
      lastName: p.lastName,
      nationality: p.nationality,
      role: p.role,
      age: p.age,
      ca: p.currentAbility,
      pa: p.potentialAbility,
      traits: p.traits ?? [],
    })),
  };
}

/** Last N settled bets for one team — read directly from the permanent
 *  history table so entries survive the card cleanup window. */
export function loadMyBetHistory(db: DB, teamId: string, limit = 10): AiBetHistoryEntry[] {
  return db.loadAiBetHistory(teamId, limit).map((r) => ({
    cardId: r.card_id,
    teamATag: r.team_a_tag,
    teamBTag: r.team_b_tag,
    teamALogo: r.team_a_logo,
    teamBLogo: r.team_b_logo,
    teamAColor: r.team_a_color,
    teamBColor: r.team_b_color,
    side: r.side,
    stake: r.stake,
    oddsAtBet: r.odds_at_bet,
    status: r.status,
    payout: r.payout,
    winnerSide: r.winner_side,
    mapsA: r.maps_a,
    mapsB: r.maps_b,
    settledAt: r.settled_at,
  }));
}

// Re-export for handlers
export type { CardPayload };
