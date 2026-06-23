// Tournament mode. Single-elimination 4 or 8 team brackets. Any team can
// create or register; the moment a tournament's slots fill the server runs
// every bracket round instantly using the same simulateMatch the duel
// system uses, distributes prizes from the entry-fee pool, and writes
// match-history entries for each round so the participants can review
// their bracket walkthrough.

import { randomBytes } from 'node:crypto';
import type {
  BracketMatch,
  ServerMessage,
  TournamentDetail,
  TournamentSummary,
} from '../../src/online/protocol.ts';
import { TOURNAMENT_PRIZE_SPLIT } from '../../src/online/protocol.ts';
import { RNG } from '../../src/engine/rng.ts';
import type { Player, Team } from '../../src/types.ts';
import type { DB, TeamRow } from './db.ts';
import { runPvpDuel, stripFrames } from './duels.ts';
import { cacheLiveReplay } from './liveState.ts';

function teamRowToEngineTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    region: row.region,
    reputation: 100,
    budget: row.money,
    playerIds: row.playerIds,
    coachName: 'Coach',
    coachSkill: 12,
    mapPool: [],
    worldRanking: 50,
    rankingPoints: 100,
  };
}

/** Public summary list — flags whether the current viewer is registered. */
export function listTournaments(db: DB, teamId: string | null): TournamentSummary[] {
  const rows = db.loadAllTournaments();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    size: r.size as 4 | 8,
    entryFee: r.entry_fee,
    prizePool: r.prize_pool,
    registered: db.countTournamentRegistrations(r.id),
    status: r.status as 'open' | 'in-progress' | 'finished',
    createdAt: r.created_at,
    iAmIn: teamId ? db.teamIsRegistered(r.id, teamId) : false,
  }));
}

/** Build full detail (summary + bracket + prizes). */
export function buildTournamentDetail(
  db: DB,
  tournamentId: string,
  teamId: string | null,
): TournamentDetail {
  const row = db.loadTournament(tournamentId);
  if (!row) throw new Error(`tournament ${tournamentId} not found`);
  const bracket: BracketMatch[] = row.bracket_json ? JSON.parse(row.bracket_json) : [];
  const prizes = row.prizes_json ? JSON.parse(row.prizes_json) : undefined;
  return {
    id: row.id,
    name: row.name,
    size: row.size as 4 | 8,
    entryFee: row.entry_fee,
    prizePool: row.prize_pool,
    registered: db.countTournamentRegistrations(row.id),
    status: row.status as 'open' | 'in-progress' | 'finished',
    createdAt: row.created_at,
    iAmIn: teamId ? db.teamIsRegistered(row.id, teamId) : false,
    bracket,
    prizes,
  };
}

export function createTournament(
  db: DB,
  size: 4 | 8,
  entryFee: number,
  nameOverride?: string,
): { ok: true; tournament: TournamentDetail } | { ok: false; error: string } {
  if (size !== 4 && size !== 8) return { ok: false, error: 'Size must be 4 or 8.' };
  const fee = Math.max(0, Math.round(entryFee));
  const id = `tourn-${randomBytes(4).toString('hex')}`;
  const name = nameOverride ?? `${size}-Team Open · $${fee.toLocaleString()}`;
  db.createTournamentRow(id, name, size, fee);
  return { ok: true, tournament: buildTournamentDetail(db, id, null) };
}

/**
 * Ensure there's always at least one open recurring tournament available.
 * Cheap on every call — guards via `loadAllTournaments` so it no-ops when
 * an open daily already exists. Returns the freshly created tournament if
 * one was spawned, or null otherwise.
 */
export function ensureDailyTournament(db: DB): TournamentDetail | null {
  const all = db.loadAllTournaments();
  const hasOpenDaily = all.some((t) => t.status === 'open' && t.name.startsWith('Daily Open'));
  if (hasOpenDaily) return null;
  // Name with the date so the lobby reads "Daily Open · Mon Jan 6"
  const today = new Date().toUTCString().slice(0, 16); // "Mon, 06 Jan 2026"
  const name = `Daily Open · ${today}`;
  const out = createTournament(db, 4, 2_500, name);
  return out.ok ? out.tournament : null;
}

/**
 * Themed weekly event — auto-spawns if there's no currently-open Themed
 * tournament. Theme rotates by ISO week so each week the lobby reads
 * differently ("🔥 Eco Mode", "🧊 Sub-130 CA", "🌍 Region Lock", etc.).
 * Themes are cosmetic labels for now; an entry filter could be enforced
 * server-side later.
 */
const THEMES = [
  { tag: '🔥 Hot Streak', desc: 'No limit — bring the best you have', size: 8 as const, fee: 5_000 },
  { tag: '🧊 Sub-130 CA', desc: 'Wonderkid showcase — managers usually field youngsters', size: 4 as const, fee: 2_500 },
  { tag: '💸 Big Money', desc: 'High roller table — $10k entry, prize pool stacks fast', size: 4 as const, fee: 10_000 },
  { tag: '🌍 World Tour', desc: 'Open to all — bracket of 8 from the global pool', size: 8 as const, fee: 3_000 },
];

export function ensureThemedTournament(db: DB): TournamentDetail | null {
  const all = db.loadAllTournaments();
  const hasOpen = all.some((t) => t.status === 'open' && t.name.startsWith('Themed:'));
  if (hasOpen) return null;
  // Rotate theme by current week-of-year so the spawn is deterministic.
  const weekOfYear = Math.floor((Date.now() - new Date(new Date().getUTCFullYear(), 0, 1).getTime()) / (7 * 24 * 3600 * 1000));
  const theme = THEMES[weekOfYear % THEMES.length];
  const name = `Themed: ${theme.tag}`;
  const out = createTournament(db, theme.size, theme.fee, name);
  return out.ok ? out.tournament : null;
}

export function registerForTournament(
  db: DB,
  tournamentId: string,
  teamId: string,
): { ok: true } | { ok: false; error: string } {
  const row = db.loadTournament(tournamentId);
  if (!row) return { ok: false, error: 'Tournament no longer open.' };
  if (row.status !== 'open') return { ok: false, error: 'Registration closed.' };
  if (db.teamIsRegistered(tournamentId, teamId)) return { ok: false, error: 'Already registered.' };
  const team = db.loadTeam(teamId);
  if (!team) return { ok: false, error: 'Team missing.' };
  if (team.playerIds.length < 5) return { ok: false, error: 'Need 5 players to enter.' };
  if (team.money < row.entry_fee) {
    return { ok: false, error: `Entry fee $${row.entry_fee.toLocaleString()} too high.` };
  }
  // Deduct entry fee + grow the prize pool.
  team.money -= row.entry_fee;
  db.setTeamMoneyDay(team.id, team.money, team.day);
  const newPool = row.prize_pool + row.entry_fee;
  const seed = db.countTournamentRegistrations(tournamentId);
  db.registerTeam(tournamentId, teamId, seed);
  db.saveTournament({
    id: tournamentId,
    status: 'open',
    prizePool: newPool,
    bracketJson: row.bracket_json,
    prizesJson: null,
  });
  return { ok: true };
}

/**
 * Run every tournament whose registration just filled up. Idempotent: a
 * tournament's status is flipped to 'in-progress' before sim, so the bracket
 * isn't double-rolled if this is called again concurrently.
 *
 * Calls `onResolved(tournamentId)` after each tournament's bracket completes
 * so the caller can broadcast a tournament-update to all sockets.
 */
export function runReadyTournaments(
  db: DB,
  onResolved: (id: string) => void,
  broadcast?: (msg: ServerMessage) => void,
): void {
  for (const row of db.loadAllTournaments()) {
    if (row.status !== 'open') continue;
    const registered = db.countTournamentRegistrations(row.id);
    if (registered < row.size) continue;
    // Flip status first so a concurrent register call sees in-progress.
    db.saveTournament({
      id: row.id,
      status: 'in-progress',
      prizePool: row.prize_pool,
      bracketJson: row.bracket_json,
      prizesJson: null,
    });
    runBracket(db, row.id, row.size, row.prize_pool, row.name, broadcast);
    onResolved(row.id);
  }
}

function runBracket(
  db: DB,
  tournamentId: string,
  size: number,
  prizePool: number,
  tournamentName: string,
  broadcast?: (msg: ServerMessage) => void,
): void {
  const regs = db.loadRegistrations(tournamentId);
  const rng = new RNG(hashSeed(`tourn-${tournamentId}`));
  // Shuffle for seeding randomness — beats strictly ordered registrations.
  const order = rng.shuffle(regs.map((r) => r.teamId));

  // Build round-0 bracket: pair adjacent teams.
  const rounds = Math.log2(size); // 4 → 2, 8 → 3
  const bracket: BracketMatch[] = [];
  for (let i = 0; i < size; i += 2) {
    bracket.push({
      round: 0,
      slot: i / 2,
      teamAId: order[i],
      teamBId: order[i + 1],
    });
  }
  // Empty placeholder slots for subsequent rounds (filled as we go).
  for (let r = 1; r < rounds; r++) {
    const slotsInRound = size / Math.pow(2, r + 1);
    for (let s = 0; s < slotsInRound; s++) {
      bracket.push({ round: r, slot: s, teamAId: null, teamBId: null });
    }
  }

  // Simulate round by round, advancing winners into next-round slots.
  for (let r = 0; r < rounds; r++) {
    const slots = bracket.filter((b) => b.round === r);
    for (const match of slots) {
      if (!match.teamAId || !match.teamBId) continue;
      const teamA = db.loadTeam(match.teamAId);
      const teamB = db.loadTeam(match.teamBId);
      if (!teamA || !teamB) continue;
      match.teamATag = teamA.tag;
      match.teamBTag = teamB.tag;
      const playersA = db.loadTeamPlayers(teamA.id);
      const playersB = db.loadTeamPlayers(teamB.id);
      const matchId = `tourn-${tournamentId}-r${r}-s${match.slot}-${Date.now()}`;
      const duel = runPvpDuel(
        teamRowToEngineTeam(teamA),
        playersA,
        teamRowToEngineTeam(teamB),
        playersB,
        0, // No per-match stake — winnings come from the bracket prize pool.
        'BO3',
        matchId,
        teamA.tactics,
        teamB.tactics,
      );
      match.winnerId = duel.winnerTeamId;
      match.mapsA = duel.result.mapsA;
      match.mapsB = duel.result.mapsB;
      match.matchHistoryId = matchId;

      for (const p of playersA) db.persistPlayer(p);
      for (const p of playersB) db.persistPlayer(p);
      db.recordMatch({
        id: matchId,
        teamAId: teamA.id,
        teamBId: teamB.id,
        teamATag: teamA.tag,
        teamBTag: teamB.tag,
        winnerId: duel.winnerTeamId,
        mapsA: duel.result.mapsA,
        mapsB: duel.result.mapsB,
        stake: 0,
        kind: 'pvp',
        resultJson: JSON.stringify(stripFrames(duel.result)),
      });
      cacheLiveReplay(matchId, duel.result);
      if (broadcast) {
        const roundLabel =
          r === Math.log2(size) - 1 ? 'Final'
            : r === Math.log2(size) - 2 ? 'Semifinal'
            : `Round ${r + 1}`;
        broadcast({
          kind: 'live-match-feed',
          entry: {
            matchId,
            kind: 'tournament',
            teamATag: teamA.tag,
            teamBTag: teamB.tag,
            mapsA: duel.result.mapsA,
            mapsB: duel.result.mapsB,
            context: `${tournamentName} · ${roundLabel}`,
            at: Date.now(),
          },
        });
      }

      // Promote winner into the next-round slot (slot/2 of the next round).
      if (r + 1 < rounds) {
        const nextMatch = bracket.find((b) => b.round === r + 1 && b.slot === Math.floor(match.slot / 2));
        if (nextMatch) {
          if (nextMatch.teamAId === null) nextMatch.teamAId = duel.winnerTeamId;
          else nextMatch.teamBId = duel.winnerTeamId;
        }
      }
    }
  }

  // Compute placements + prize payouts.
  // Final = last round's only match; runner-up = loser of final.
  const finalMatch = bracket[bracket.length - 1];
  const champion = finalMatch.winnerId!;
  const runnerUp = finalMatch.teamAId === champion ? finalMatch.teamBId! : finalMatch.teamAId!;
  // Semi-finalists = losers of round (rounds - 2). Only exists for size ≥ 4 (always true here).
  const semifinalists: string[] = [];
  if (rounds >= 2) {
    const semis = bracket.filter((b) => b.round === rounds - 2);
    for (const s of semis) {
      if (!s.winnerId) continue;
      const loser = s.teamAId === s.winnerId ? s.teamBId : s.teamAId;
      if (loser) semifinalists.push(loser);
    }
  }
  const placements: Array<{ teamId: string; placement: number }> = [
    { teamId: champion, placement: 1 },
    { teamId: runnerUp, placement: 2 },
  ];
  for (const sf of semifinalists) {
    if (sf !== champion && sf !== runnerUp) placements.push({ teamId: sf, placement: 3 });
  }

  const prizes: TournamentDetail['prizes'] = [];
  for (const p of placements) {
    const splitIdx = p.placement - 1;
    const split = TOURNAMENT_PRIZE_SPLIT[splitIdx] ?? 0;
    const cash = Math.round(prizePool * split);
    const team = db.loadTeam(p.teamId);
    if (!team) continue;
    if (cash > 0) {
      team.money += cash;
      db.setTeamMoneyDay(team.id, team.money, team.day);
    }
    prizes.push({ teamId: p.teamId, teamTag: team.tag, placement: p.placement, cash });
  }

  db.saveTournament({
    id: tournamentId,
    status: 'finished',
    prizePool,
    bracketJson: JSON.stringify(bracket),
    prizesJson: JSON.stringify(prizes),
  });
}

// Local copy of hashSeed (RNG.ts isn't node-friendly to import deeply
// through the project — keep this tiny to dodge import churn).
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
