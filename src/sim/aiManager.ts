// AI club activity that runs alongside the scheduled monthly tick to make
// rival teams feel alive: free-agent scrambles for notable FAs, and monthly
// roster turnover (release deadwood, sign a replacement). Pure helpers — the
// store wires them into advanceDay's monthly block.

import type { GameState, Player, Team } from '../types';
import type { RNG } from '../engine/rng';
import { addDays } from './calendar';

/** A signing the helpers performed — returned so the caller can post inbox/news. */
export interface AiSigningEvent {
  teamId: string;
  teamName: string;
  playerId: string;
  playerNick: string;
  wage: number;
  kind: 'free-agent-scramble' | 'roster-turnover-replacement';
  /** Nick of the released player (only for roster-turnover). */
  releasedNick?: string;
}

/** Notable free-agent threshold — CA at which AI teams scramble to sign. */
const FA_HOT_CA = 130;
const WONDERKID_PA = 165;

/**
 * Scan the FA pool for hot signings; if any exist, rival AI teams who can
 * afford the wage race to sign them. Runs each month tick. Each hot FA can
 * be claimed by at most one team per call.
 */
export function aiFreeAgentScramble(
  g: GameState,
  rng: RNG,
  today: string,
): AiSigningEvent[] {
  const events: AiSigningEvent[] = [];
  const hotFAs = Object.values(g.players)
    .filter((p) => !p.teamId && !p.injury)
    .filter((p) => p.currentAbility >= FA_HOT_CA || (p.age <= 21 && p.potentialAbility >= WONDERKID_PA))
    .sort((a, b) => b.currentAbility - a.currentAbility)
    .slice(0, 8);
  if (hotFAs.length === 0) return events;

  for (const fa of hotFAs) {
    // 35% chance any rival actually acts on this player in a given month —
    // keeps the FA pool from being instantly drained.
    if (!rng.chance(0.35)) continue;
    // Eligible teams: not user, room on roster (< 8), enough budget for ~6 months wage.
    const wage = Math.max(8000, Math.round((fa.currentAbility * 300) / 500) * 500);
    const eligible = Object.values(g.teams).filter(
      (t) => !t.isUser && t.playerIds.length < 8 && t.budget >= wage * 6,
    );
    if (eligible.length === 0) continue;
    // Bidding war weighted by reputation — better clubs win the race.
    const weights = eligible.map((t) => Math.max(1, t.reputation));
    const total = weights.reduce((s, w) => s + w, 0);
    let pick = rng.next() * total;
    let buyer: Team | null = null;
    for (let i = 0; i < eligible.length; i++) {
      pick -= weights[i];
      if (pick <= 0) { buyer = eligible[i]; break; }
    }
    if (!buyer) buyer = eligible[0];

    // Sign the player.
    fa.teamId = buyer.id;
    fa.squadTier = fa.age <= 19 ? 'youth' : fa.currentAbility >= 140 ? 'first' : 'reserve';
    fa.contract = {
      wage,
      expires: addDays(today, 365 * 2),
      buyout: Math.max(fa.askingPrice, fa.currentAbility * 5000),
    };
    fa.clubHistory ??= [];
    if (fa.clubHistory[fa.clubHistory.length - 1]?.teamId !== buyer.id) {
      fa.clubHistory.push({ teamId: buyer.id, teamName: buyer.name, joinedOn: today });
    }
    buyer.playerIds.push(fa.id);
    buyer.budget -= wage; // first month upfront
    events.push({
      teamId: buyer.id,
      teamName: buyer.name,
      playerId: fa.id,
      playerNick: fa.nickname,
      wage,
      kind: 'free-agent-scramble',
    });
  }
  return events;
}

/** Score "deadwood-ness" — high = good release candidate. */
function deadwoodScore(p: Player): number {
  if (!p.contract) return -1;
  // Old + low form + high wage relative to CA = release candidate.
  const ageFactor = Math.max(0, p.age - 28) * 8;
  const formFactor = Math.max(0, 10 - p.form) * 4;
  const wageVsCA = p.contract.wage / Math.max(1, p.currentAbility * 100);
  const wageFactor = Math.max(0, wageVsCA - 1) * 30;
  // Bench-warming reserves with no playing time also count.
  const reserveFactor = p.squadTier === 'reserve' && p.stats.maps < 5 ? 15 : 0;
  return ageFactor + formFactor + wageFactor + reserveFactor;
}

/**
 * Each AI team has a small monthly chance to refresh: release their worst
 * deadwood AND sign a replacement free agent. Keeps rosters churning so the
 * AI doesn't feel frozen with the same lineup all season.
 */
export function aiRosterTurnover(
  g: GameState,
  rng: RNG,
  today: string,
): AiSigningEvent[] {
  const events: AiSigningEvent[] = [];
  for (const team of Object.values(g.teams)) {
    if (team.isUser) continue;
    // ~10% per team per month — averages to ~3-4 turnovers across the league per month.
    if (!rng.chance(0.1)) continue;
    if (team.playerIds.length < 6) continue; // need bench depth to release

    // Pick the player with the highest deadwood score.
    const roster = team.playerIds.map((id) => g.players[id]).filter((p): p is Player => !!p);
    const scored = roster.map((p) => ({ p, score: deadwoodScore(p) })).sort((a, b) => b.score - a.score);
    const target = scored[0];
    if (!target || target.score < 20) continue; // no obvious deadwood

    const releasedNick = target.p.nickname;
    target.p.teamId = null;
    target.p.contract = null;
    target.p.squadTier = undefined;
    team.playerIds = team.playerIds.filter((id) => id !== target.p.id);

    // Sign a replacement from the FA pool — prefer same role + best CA in budget.
    const candidates = Object.values(g.players)
      .filter((p) => !p.teamId && !p.injury)
      .map((p) => ({ p, score: p.currentAbility + (p.role === target.p.role ? 25 : 0) }))
      .sort((a, b) => b.score - a.score);
    let replacementEvent: AiSigningEvent | null = null;
    for (const { p } of candidates.slice(0, 12)) {
      const wage = Math.max(8000, Math.round((p.currentAbility * 280) / 500) * 500);
      if (team.budget < wage * 6) continue;
      p.teamId = team.id;
      p.squadTier = p.age <= 19 ? 'youth' : p.currentAbility >= 130 ? 'first' : 'reserve';
      p.contract = {
        wage,
        expires: addDays(today, 365 * 2),
        buyout: Math.max(p.askingPrice, p.currentAbility * 4000),
      };
      p.clubHistory ??= [];
      if (p.clubHistory[p.clubHistory.length - 1]?.teamId !== team.id) {
        p.clubHistory.push({ teamId: team.id, teamName: team.name, joinedOn: today });
      }
      team.playerIds.push(p.id);
      team.budget -= wage;
      replacementEvent = {
        teamId: team.id,
        teamName: team.name,
        playerId: p.id,
        playerNick: p.nickname,
        wage,
        kind: 'roster-turnover-replacement',
        releasedNick,
      };
      break;
    }
    if (replacementEvent) events.push(replacementEvent);
  }
  return events;
}
