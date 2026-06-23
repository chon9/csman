// Academy / youth match simulator.
//
// Youth matches run in the background — the manager never picks lineups or
// watches the play, they just get a weekly inbox report. The goal is to give
// the academy roster *visibility*: which kids are showing up against regional
// competition, who deserves a promotion shout, who's coasting. Abstracted
// purely from CA + role + a noise roll — no map engine, no kill feed.

import { RNG } from '../engine/rng';
import type { GameState, Player, Region, Team } from '../types';

export interface YouthPlayerLine {
  playerId: string;
  nickname: string;
  age: number;
  role: string;
  kills: number;
  deaths: number;
  assists: number;
  rating: number;
}

export interface YouthMatchRecord {
  date: string;
  /** Synthesized opponent name (e.g. "Aurora Academy", "EU Tier-2 XI"). */
  oppName: string;
  /** Opponent strength rating (~roughly comparable to user academy avg CA). */
  oppRating: number;
  userScore: number;   // map score, e.g. 16-12
  oppScore: number;
  won: boolean;
  /** Up to 5 user youth players who started — sorted by rating desc. */
  lineup: YouthPlayerLine[];
  /** Highest-rated user player ID, if any (used for inbox highlight). */
  standoutId: string | null;
  /** Inbox-ready one-liner about the standout, even if loss. */
  standoutLine: string;
}

const REGION_LABELS: Record<Region, string> = {
  Europe: 'EU',
  CIS: 'CIS',
  Americas: 'NA',
  Asia: 'Asia',
};

const OPP_FLAVOR = [
  'Academy', 'Junior', 'Prospects', 'Wildcards', 'Underdogs', 'Reserves', 'Next-Gen', 'Trial XI',
];

/** Build a synthetic opponent name + rating from the user team's region. */
function pickOpponent(userTeam: Team, allTeams: Record<string, Team>, rng: RNG): { name: string; rating: number } {
  // 60% chance: a real rival club's academy (gives the report flavour)
  if (rng.chance(0.6)) {
    const peers = Object.values(allTeams)
      .filter((t) => t.id !== userTeam.id && t.region === userTeam.region)
      .sort((a, b) => Math.abs(a.worldRanking - userTeam.worldRanking) - Math.abs(b.worldRanking - userTeam.worldRanking))
      .slice(0, 8);
    if (peers.length) {
      const opp = rng.pick(peers);
      // Their academy is weaker than the senior team — scale rep down.
      return { name: `${opp.tag} ${rng.pick(['Academy', 'Junior', 'Reserves'])}`, rating: Math.max(60, opp.reputation * 0.55 + rng.int(-8, 8)) };
    }
  }
  // 40%: regional academy XI
  const region = REGION_LABELS[userTeam.region];
  const flavor = rng.pick(OPP_FLAVOR);
  return { name: `${region} ${flavor}`, rating: 65 + rng.int(-12, 15) };
}

/** Estimate a youth player's match rating from their CA + role + noise. */
function simulatePlayerLine(p: Player, oppRating: number, rng: RNG): YouthPlayerLine {
  // Form/morale/fatigue still bias performance — academy kids are still humans.
  const formMul = 0.88 + (p.form - 10) * 0.018;
  const moraleMul = 0.95 + (p.morale - 10) * 0.008;
  // Higher relative skill vs opp = better lines. Centred on ~1.00 rating.
  const skillDelta = (p.currentAbility - oppRating) / 40;
  const noise = rng.range(-0.22, 0.22);
  const rating = Math.max(0.35, Math.min(2.4, 1.0 + skillDelta + noise) * formMul * moraleMul);

  // Convert rating to a plausible K/D for an MR-15 youth match (avg ~20 rounds).
  const rounds = 24;
  const kills = Math.max(0, Math.round(rounds * (0.55 + (rating - 1.0) * 0.45) + rng.int(-3, 3)));
  const deaths = Math.max(2, Math.round(rounds * (0.6 - (rating - 1.0) * 0.3) + rng.int(-2, 3)));
  const assists = Math.max(0, Math.round(rounds * 0.18 + rng.int(-2, 4)));

  return {
    playerId: p.id,
    nickname: p.nickname,
    age: p.age,
    role: p.role,
    kills,
    deaths,
    assists,
    rating: Number(rating.toFixed(2)),
  };
}

/**
 * Run one academy match for the user. Returns null if the academy is too thin
 * (< 3 youth players) to field a match — caller should skip the inbox push.
 */
export function simulateYouthMatch(
  g: GameState,
  rng: RNG,
): YouthMatchRecord | null {
  const userTeam = g.teams[g.userTeamId];
  if (!userTeam) return null;

  const youth = userTeam.playerIds
    .map((id) => g.players[id])
    .filter((p): p is Player => !!p && (p.squadTier ?? 'first') === 'youth' && !p.injury);

  if (youth.length < 3) return null;

  // Field the top 5 (or all available) by CA. Anything past 5 sits on the bench.
  const lineupPool = [...youth].sort((a, b) => b.currentAbility - a.currentAbility).slice(0, 5);

  const opp = pickOpponent(userTeam, g.teams, rng);

  // Per-player line.
  const lines = lineupPool.map((p) => simulatePlayerLine(p, opp.rating, rng));

  // Aggregate team rating decides the score.
  const teamAvgRating = lines.reduce((s, l) => s + l.rating, 0) / lines.length;
  // CT/T 15-round format. Diff scales with rating gap; cap at 16-4 / 4-16 blowouts.
  const gap = Math.round((teamAvgRating - 1.0) * 18) + rng.int(-3, 3);
  let userScore: number;
  let oppScore: number;
  if (gap >= 0) {
    userScore = 16;
    oppScore = Math.max(2, Math.min(14, 14 - gap));
  } else {
    oppScore = 16;
    userScore = Math.max(2, Math.min(14, 14 + gap));
  }
  const won = userScore > oppScore;

  // Standout = top user rating (≥ 1.0 even on a loss is still a positive note).
  const sorted = [...lines].sort((a, b) => b.rating - a.rating);
  const top = sorted[0];
  const topPlayer = g.players[top.playerId];
  let standoutLine: string;
  if (top.rating >= 1.30) {
    standoutLine = `🌟 ${top.nickname} (${topPlayer?.age}yo ${top.role}) was unplayable — ${top.kills}-${top.deaths}, ${top.rating.toFixed(2)} rating. One to watch.`;
  } else if (top.rating >= 1.10) {
    standoutLine = `${top.nickname} (${topPlayer?.age}yo ${top.role}) led the line — ${top.kills}-${top.deaths}, ${top.rating.toFixed(2)} rating.`;
  } else if (top.rating >= 0.95) {
    standoutLine = `${top.nickname} (${topPlayer?.age}yo ${top.role}) was the brightest spot — ${top.kills}-${top.deaths}, ${top.rating.toFixed(2)} rating.`;
  } else {
    standoutLine = `Tough day across the academy — best of a bad bunch was ${top.nickname} (${top.rating.toFixed(2)} rating).`;
  }

  // Light development nudge: a strong performance lifts the player's morale by
  // a touch (matches happen — they should feel rewarding for kids who showed
  // up). A heavy loss costs morale slightly. Form moves with rating too.
  for (const line of lines) {
    const p = g.players[line.playerId];
    if (!p) continue;
    if (line.rating >= 1.15) {
      p.morale = Math.min(20, p.morale + 0.4);
      p.form = Math.min(20, p.form + 0.3);
    } else if (line.rating <= 0.75) {
      p.morale = Math.max(1, p.morale - 0.25);
      p.form = Math.max(1, p.form - 0.2);
    }
  }

  return {
    date: g.currentDate,
    oppName: opp.name,
    oppRating: Math.round(opp.rating),
    userScore,
    oppScore,
    won,
    lineup: sorted,
    standoutId: top.playerId,
    standoutLine,
  };
}
