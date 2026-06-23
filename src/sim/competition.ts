import type {
  MatchFormat,
  ScheduledMatch,
  Tournament,
  TournamentState,
} from '../types';
import { addDays } from './calendar';
import { RNG, hashSeed } from '../engine/rng';

let matchCounter = 0;
function newMatchId(tid: string): string {
  return `${tid}-m${++matchCounter}-${Date.now().toString(36)}`;
}

export function initTournamentState(t: Tournament): TournamentState {
  return {
    tournamentId: t.id,
    currentStageIdx: 0,
    swissRecords: Object.fromEntries(t.invitedTeamIds.map((id) => [id, { wins: 0, losses: 0 }])),
    aliveTeamIds: [...t.invitedTeamIds],
    eliminatedTeamIds: [],
    placements: {},
    finished: false,
    bracketRound: 0,
  };
}

/** Generate the opening matches of a tournament. Returns new ScheduledMatch[] */
export function startTournament(t: Tournament, state: TournamentState, seeding: Record<string, number>): ScheduledMatch[] {
  const stage = t.stages[0];
  const seeded = [...t.invitedTeamIds].sort((a, b) => (seeding[a] ?? 99) - (seeding[b] ?? 99));
  if (stage.type === 'swiss') {
    // R1: 1v9, 2v10 ...
    const half = seeded.length / 2;
    const matches: ScheduledMatch[] = [];
    for (let i = 0; i < half; i++) {
      matches.push(mkMatch(t, stage.format, 'Swiss R1', t.startDate, seeded[i], seeded[i + half]));
    }
    return matches;
  }
  // single elim (8 teams): 1v8, 4v5, 2v7, 3v6
  state.bracketRound = 1;
  const order = [0, 7, 3, 4, 1, 6, 2, 5].map((i) => seeded[i]);
  const matches: ScheduledMatch[] = [];
  for (let i = 0; i < order.length; i += 2) {
    matches.push(mkMatch(t, stage.format, 'Quarterfinal', t.startDate, order[i], order[i + 1]));
  }
  return matches;
}

function mkMatch(
  t: Tournament,
  format: MatchFormat,
  roundLabel: string,
  date: string,
  a: string,
  b: string,
): ScheduledMatch {
  return {
    id: newMatchId(t.id),
    tournamentId: t.id,
    stageName: roundLabel.startsWith('Swiss') ? 'Swiss Stage' : 'Playoffs',
    roundLabel,
    date,
    teamAId: a,
    teamBId: b,
    format,
    status: 'scheduled',
  };
}

export interface ProgressResult {
  newMatches: ScheduledMatch[];
  finishedNow: boolean;
  // teamId -> placement assigned in this step
  newPlacements: Record<string, number>;
}

/**
 * Called when ALL matches of the current round (same roundLabel) are finished.
 * Decides next round pairings / advances stage / finishes tournament.
 */
export function progressTournament(
  t: Tournament,
  state: TournamentState,
  allMatches: ScheduledMatch[],
  lastDate: string,
): ProgressResult {
  const tMatches = allMatches.filter((m) => m.tournamentId === t.id);
  const pendingExists = tMatches.some((m) => m.status !== 'finished');
  if (pendingExists) return { newMatches: [], finishedNow: false, newPlacements: {} };

  const stage = t.stages[state.currentStageIdx];
  const nextDate = addDays(lastDate, 1);
  const newPlacements: Record<string, number> = {};

  if (stage.type === 'swiss') {
    // update records from finished swiss matches not yet tallied is done in caller; here records are current
    const records = state.swissRecords;
    const advanced = Object.entries(records).filter(([, r]) => r.wins >= 3).map(([id]) => id);
    const eliminated = Object.entries(records).filter(([, r]) => r.losses >= 3).map(([id]) => id);

    for (const id of eliminated) {
      if (!(id in state.placements)) {
        // HLTV-style spread: 2-3 exits 9th, 1-3 exits 12th, 0-3 exits 15th
        const w = records[id].wins;
        const place = w >= 2 ? 9 : w === 1 ? 12 : 15;
        state.placements[id] = place;
        newPlacements[id] = place;
        if (!state.eliminatedTeamIds.includes(id)) state.eliminatedTeamIds.push(id);
      }
    }
    state.aliveTeamIds = t.invitedTeamIds.filter((id) => records[id].wins < 3 && records[id].losses < 3);

    if (advanced.length >= 8 || state.aliveTeamIds.length === 0) {
      // move to playoffs
      state.currentStageIdx++;
      state.bracketRound = 1;
      const seeds = [...advanced].sort(
        (a, b) => records[b].wins - records[a].wins || records[a].losses - records[b].losses,
      );
      const order = [0, 7, 3, 4, 1, 6, 2, 5].map((i) => seeds[i]).filter(Boolean);
      const matches: ScheduledMatch[] = [];
      for (let i = 0; i + 1 < order.length; i += 2) {
        matches.push(mkMatch(t, t.stages[state.currentStageIdx].format, 'Quarterfinal', addDays(nextDate, 1), order[i], order[i + 1]));
      }
      state.aliveTeamIds = seeds;
      return { newMatches: matches, finishedNow: false, newPlacements };
    }

    // next swiss round: pair within same record groups
    const roundNo = Math.max(...t.invitedTeamIds.map((id) => records[id].wins + records[id].losses)) + 1;
    const groups = new Map<string, string[]>();
    for (const id of state.aliveTeamIds) {
      const key = `${records[id].wins}-${records[id].losses}`;
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    const matches: ScheduledMatch[] = [];
    const rng = new RNG(hashSeed(t.id + roundNo));
    for (const [, ids] of groups) {
      const shuffled = rng.shuffle(ids);
      for (let i = 0; i + 1 < shuffled.length; i += 2) {
        matches.push(mkMatch(t, stage.format, `Swiss R${roundNo}`, nextDate, shuffled[i], shuffled[i + 1]));
      }
      // odd team floats — pair with anyone (rare; record drift acceptable)
      if (shuffled.length % 2 === 1) {
        const floater = shuffled[shuffled.length - 1];
        const lastMatch = matches[matches.length - 1];
        if (lastMatch && rng.chance(0.5)) {
          // leave floater with a bye → counts as win
          records[floater].wins++;
        } else {
          records[floater].wins++;
        }
      }
    }
    return { newMatches: matches, finishedNow: false, newPlacements };
  }

  // ===== single-elim playoffs =====
  const roundMatches = tMatches.filter((m) => m.stageName === 'Playoffs');
  const currentRound = state.bracketRound;
  const labels = ['', 'Quarterfinal', 'Semifinal', 'Grand Final'];
  const thisRound = roundMatches.filter((m) => m.roundLabel === labels[currentRound] || (currentRound >= 3 && m.roundLabel === 'Grand Final'));
  const winners = thisRound.map((m) => m.result!.winnerId);
  const losers = thisRound.map((m) => (m.result!.winnerId === m.teamAId ? m.teamBId : m.teamAId));

  // placements for losers
  const loserPlace = winners.length === 4 ? 5 : winners.length === 2 ? 3 : 2;
  for (const id of losers) {
    state.placements[id] = loserPlace;
    newPlacements[id] = loserPlace;
    state.eliminatedTeamIds.push(id);
  }

  if (winners.length === 1) {
    state.placements[winners[0]] = 1;
    newPlacements[winners[0]] = 1;
    state.finished = true;
    return { newMatches: [], finishedNow: true, newPlacements };
  }

  state.bracketRound++;
  const isFinal = winners.length === 2;
  const fmt = isFinal ? (stage.finalFormat ?? stage.format) : stage.format;
  const label = isFinal ? 'Grand Final' : labels[state.bracketRound];
  const matches: ScheduledMatch[] = [];
  for (let i = 0; i + 1 < winners.length; i += 2) {
    matches.push(mkMatch(t, fmt, label, nextDate, winners[i], winners[i + 1]));
  }
  state.aliveTeamIds = winners;
  return { newMatches: matches, finishedNow: false, newPlacements };
}

/** prize money for a placement */
export function prizeFor(t: Tournament, placement: number): number {
  const idx = Math.min(placement - 1, t.prizeSpread.length - 1);
  return Math.round(t.prizePool * (t.prizeSpread[idx] ?? 0));
}

/** ranking points for a placement */
export function pointsFor(t: Tournament, placement: number): number {
  const frac = placement === 1 ? 1 : placement === 2 ? 0.6 : placement <= 4 ? 0.4 : placement <= 8 ? 0.2 : 0.08;
  return Math.round(t.rankingPoints * frac);
}
