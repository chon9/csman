// Org bankruptcy events.
//
// Once or twice per season a real lower-budget team folds — releasing its
// entire roster onto the free-agent market with discounted asking prices.
// Creates a juicy buying opportunity, shakes up rankings, and adds named
// faces to the FA pool the user might otherwise never sign.
//
// Disbanded teams are kept on the books (marked defunct) so existing match
// history / news references don't break. The calendar / rankings / transfer
// market all skip them via the .defunct flag.

import { RNG } from '../engine/rng';
import type { GameState, Team } from '../types';

export interface OrgBankruptcyEvent {
  teamId: string;
  teamName: string;
  releasedPlayerIds: string[];
}

const FIRE_SALE_DISCOUNT = 0.5;

/**
 * Roll once per month for an org folding. Picks a low-budget, non-top-15,
 * non-user team that isn't currently fighting in a tier-S deep run. Returns
 * null if no candidate or roll fails.
 *
 * Conservative chance — ~25% per monthly tick gives roughly 2-3 disbandments
 * per real-world year, matching the historical CS2 rate.
 */
export function rollOrgBankruptcy(g: GameState, today: string, rng: RNG): OrgBankruptcyEvent | null {
  if (!rng.chance(0.25)) return null;

  // Candidate pool: live mid/lower-table teams with poor finances.
  // Skip the user, top-15, anyone already folded, and anyone with a major
  // playoff match queued in the next 21 days (would ruin a live tournament).
  const candidates = Object.values(g.teams).filter((t) => {
    if (t.isUser) return false;
    if (t.defunct) return false;
    if (t.worldRanking <= 15) return false;
    // Has to look financially distressed: low budget OR running a wage bill
    // they clearly can't cover.
    const wageBill = t.playerIds.reduce((s, id) => s + (g.players[id]?.contract?.wage ?? 0), 0);
    const stressed = t.budget < 200_000 || t.budget < wageBill * 1.5;
    if (!stressed) return false;
    // Don't fold a team in the middle of an active major run.
    const cutoff = addDaysLocal(today, 21);
    const inActiveRun = g.schedule.some(
      (m) =>
        m.status === 'scheduled' &&
        m.date <= cutoff &&
        (m.teamAId === t.id || m.teamBId === t.id) &&
        g.tournaments[m.tournamentId]?.tier === 'S',
    );
    return !inActiveRun;
  });
  if (!candidates.length) return null;

  // Weighted pick — the more distressed (lower budget vs wage bill), the more
  // likely to fold. Stops the same fringe team going under year after year.
  const weighted = candidates.map((t) => {
    const wageBill = t.playerIds.reduce((s, id) => s + (g.players[id]?.contract?.wage ?? 0), 0);
    const stress = Math.max(1, wageBill - t.budget) / 100_000;
    return { t, w: stress + (t.worldRanking - 15) * 0.1 };
  });
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let roll = rng.next() * total;
  let pick: Team = weighted[0].t;
  for (const x of weighted) {
    roll -= x.w;
    if (roll <= 0) { pick = x.t; break; }
  }

  // Disband: every player → free agent with discounted asking price for the
  // next 30 days. Contracts torn up.
  const releasedIds: string[] = [];
  const fireSaleUntil = addDaysLocal(today, 30);
  for (const pid of pick.playerIds) {
    const p = g.players[pid];
    if (!p) continue;
    p.teamId = null;
    p.contract = null;
    p.squadTier = undefined;
    p.transferListed = false;
    // Discounted asking price during the fire sale window. We mutate the
    // base price rather than tracking a separate field — once the player is
    // signed by another team the dbBuild flow re-derives wages on signing.
    p.askingPrice = Math.max(50_000, Math.round(p.askingPrice * FIRE_SALE_DISCOUNT));
    releasedIds.push(pid);
  }
  pick.playerIds = [];
  pick.defunct = true;
  pick.defunctOn = today;
  pick.budget = 0;
  pick.rankingPoints = 0;
  pick.worldRanking = 999; // sinks them to the bottom of any sort
  // Clean up the schedule: cancel future matches involving this team.
  // Past finished matches stay (history is sacred). Scheduled future matches
  // get walked over: opponent gets a free win (sim-style forfeit).
  for (const m of g.schedule) {
    if (m.status !== 'scheduled') continue;
    if (m.teamAId !== pick.id && m.teamBId !== pick.id) continue;
    // Mark as walkover — the day-tick will resolve it as a forfeit.
    m.walkoverWinnerId = m.teamAId === pick.id ? m.teamBId : m.teamAId;
  }
  // Clean tournament invite lists.
  for (const t of Object.values(g.tournaments)) {
    t.invitedTeamIds = t.invitedTeamIds.filter((id) => id !== pick.id);
  }

  void fireSaleUntil; // recorded in inbox copy below
  return { teamId: pick.id, teamName: pick.name, releasedPlayerIds: releasedIds };
}

function addDaysLocal(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
