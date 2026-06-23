// Board objectives + manager confidence. Set at season start, evaluated
// throughout. Manages confidence drift and sack risk.

import type { BoardObjective, BoardState, GameState, Team } from '../types';
import { RNG, hashSeed } from '../engine/rng';

let nextObjId = 0;
function newId(): string {
  return `obj-${++nextObjId}-${Date.now().toString(36)}`;
}

/**
 * Generate season objectives at game start (or season rollover). The set is
 * sized to team reputation — top teams get harder goals, bottom teams just
 * need to survive.
 */
export function generateSeasonObjectives(team: Team, year: number, rng: RNG): BoardObjective[] {
  const objectives: BoardObjective[] = [];
  const rank = team.worldRanking;

  if (rank <= 4) {
    // Elite teams: win a Major, top-4 season, develop talent
    objectives.push({
      id: newId(),
      type: 'win-major',
      description: `Win at least one Major this season — anything less is failure for a top-4 club.`,
      target: 1,
      progress: 0,
      status: 'pending',
      confidenceImpact: 30,
    });
    objectives.push({
      id: newId(),
      type: 'top-finish',
      description: `Finish the ${year} season ranked top 4 in the world.`,
      target: 4,
      progress: rank,
      status: 'pending',
      confidenceImpact: 15,
    });
  } else if (rank <= 10) {
    // Contenders: reach a major final, podium at an S-tier event
    objectives.push({
      id: newId(),
      type: 'finals',
      description: `Reach the final of at least one S-tier event this season.`,
      target: 1,
      progress: 0,
      status: 'pending',
      confidenceImpact: 25,
    });
    objectives.push({
      id: newId(),
      type: 'top-finish',
      description: `Finish ${year} ranked top 8.`,
      target: 8,
      progress: rank,
      status: 'pending',
      confidenceImpact: 15,
    });
    objectives.push({
      id: newId(),
      type: 'qualify-major',
      description: `Qualify for both Majors this season.`,
      target: 2,
      progress: 0,
      status: 'pending',
      confidenceImpact: 12,
    });
  } else if (rank <= 20) {
    // Mid-pack: aim for top 12, develop youth, qualify for at least one Major
    objectives.push({
      id: newId(),
      type: 'top-finish',
      description: `Push for top 12 by the end of ${year}.`,
      target: 12,
      progress: rank,
      status: 'pending',
      confidenceImpact: 18,
    });
    objectives.push({
      id: newId(),
      type: 'qualify-major',
      description: `Qualify for at least one Major this season.`,
      target: 1,
      progress: 0,
      status: 'pending',
      confidenceImpact: 12,
    });
    objectives.push({
      id: newId(),
      type: 'develop-youth',
      description: `Give 100+ maps to under-22 players this season.`,
      target: 100,
      progress: 0,
      status: 'pending',
      confidenceImpact: 10,
    });
  } else {
    // Bottom tier: survive, balance the books, develop something
    objectives.push({
      id: newId(),
      type: 'avoid-bottom',
      description: `Avoid finishing ${year} in the bottom 4 of the world rankings.`,
      target: 4,
      progress: 0,
      status: 'pending',
      confidenceImpact: 15,
    });
    objectives.push({
      id: newId(),
      type: 'profit',
      description: `Don't burn the budget — keep at least $${(team.budget / 2).toFixed(0)} in the bank by season end.`,
      target: Math.round(team.budget / 2),
      progress: team.budget,
      status: 'pending',
      confidenceImpact: 10,
    });
    objectives.push({
      id: newId(),
      type: 'develop-youth',
      description: `Give 80+ maps to under-22 players to build for the future.`,
      target: 80,
      progress: 0,
      status: 'pending',
      confidenceImpact: 8,
    });
    void rng; // unused for now, available for variant objectives
  }
  return objectives;
}

/** Initialise the board state at new game / season start. */
export function initBoardState(team: Team, year: number, today: string): BoardState {
  const rng = new RNG(hashSeed(`board-${team.id}-${year}`));
  return {
    confidence: 60,
    objectives: generateSeasonObjectives(team, year, rng),
    lastUpdate: today,
  };
}

/**
 * Recompute objective progress based on current game state. Returns the
 * objectives that just flipped status — used to push inbox notices.
 */
export function evaluateObjectives(
  g: GameState,
  team: Team,
): BoardObjective[] {
  if (!g.board) return [];
  const changed: BoardObjective[] = [];
  for (const obj of g.board.objectives) {
    if (obj.status !== 'pending') continue;
    let progress = obj.progress;
    let achieved = false;
    switch (obj.type) {
      case 'win-major': {
        // Count S-tier tournament wins this season
        const majors = Object.values(g.tournaments).filter((t) => t.tier === 'S');
        let wins = 0;
        for (const t of majors) {
          const st = g.tournamentStates[t.id];
          if (!st || !st.finished) continue;
          const champion = Object.entries(st.placements).find(([, p]) => p === 1)?.[0];
          if (champion === team.id) wins++;
        }
        progress = wins;
        if (wins >= obj.target) achieved = true;
        break;
      }
      case 'finals': {
        // Reached final = placement <= 2 in any S-tier
        const majors = Object.values(g.tournaments).filter((t) => t.tier === 'S');
        for (const t of majors) {
          const st = g.tournamentStates[t.id];
          if (!st) continue;
          if ((st.placements[team.id] ?? 99) <= 2) {
            progress = 1;
            achieved = true;
            break;
          }
        }
        break;
      }
      case 'top-finish': {
        // Currently above target rank — only finalised at season end
        progress = team.worldRanking;
        // Don't mark achieved/failed mid-season; rolloverSeason finalises
        break;
      }
      case 'develop-youth': {
        // Sum maps played by under-22 players on our team this season
        let maps = 0;
        for (const id of team.playerIds) {
          const p = g.players[id];
          if (p && p.age <= 22) maps += p.stats.maps;
        }
        progress = maps;
        if (maps >= obj.target) achieved = true;
        break;
      }
      case 'profit': {
        progress = team.budget;
        // Finalised at season end
        break;
      }
      case 'qualify-major': {
        // Count Majors where team is in invitedTeamIds
        const majors = Object.values(g.tournaments).filter((t) => t.isMajor);
        const quals = majors.filter((t) => t.invitedTeamIds.includes(team.id)).length;
        progress = quals;
        if (quals >= obj.target) achieved = true;
        break;
      }
      case 'avoid-bottom': {
        progress = team.worldRanking;
        // Finalised at season end
        break;
      }
    }
    obj.progress = progress;
    if (achieved) {
      obj.status = 'achieved';
      changed.push(obj);
    }
  }
  return changed;
}

/**
 * Finalise pending objectives at season rollover. Top-finish/profit/avoid-bottom
 * are decided here. Returns changed objectives.
 */
export function finaliseObjectives(g: GameState, team: Team): BoardObjective[] {
  if (!g.board) return [];
  const changed: BoardObjective[] = [];
  const totalTeams = Object.keys(g.teams).length;
  for (const obj of g.board.objectives) {
    if (obj.status !== 'pending') continue;
    let achieved = false;
    let failed = false;
    switch (obj.type) {
      case 'top-finish':
        if (team.worldRanking <= obj.target) achieved = true;
        else failed = true;
        break;
      case 'profit':
        if (team.budget >= obj.target) achieved = true;
        else failed = true;
        break;
      case 'avoid-bottom':
        if (team.worldRanking <= totalTeams - obj.target) achieved = true;
        else failed = true;
        break;
      default:
        // Already-evaluated types — if still pending at season end, they failed
        failed = true;
        break;
    }
    obj.status = achieved ? 'achieved' : failed ? 'failed' : 'pending';
    changed.push(obj);
  }
  return changed;
}

/** Apply a confidence delta with bounds. */
export function bumpConfidence(state: BoardState, delta: number): void {
  state.confidence = Math.max(0, Math.min(100, state.confidence + delta));
}

/** Determine sack risk — board confidence below 15 is critical. */
export function sackRisk(state: BoardState): 'safe' | 'shaky' | 'critical' {
  if (state.confidence < 15) return 'critical';
  if (state.confidence < 35) return 'shaky';
  return 'safe';
}
