import type { Player, Team } from '../types';
import { buildPlayer, buildTeam, type TeamSpec } from './dbBuild';
import { ROSTERS_A } from './rostersA';
import { ROSTERS_B } from './rostersB';
import { ROSTERS_C } from './rostersC';
import { ROSTERS_D } from './rostersD';
import { FREE_AGENTS } from './rostersC';
import { generateFreeAgentPool } from './faPool';

export function buildInitialDatabase(startDate: string): {
  teams: Record<string, Team>;
  players: Record<string, Player>;
} {
  const specs: TeamSpec[] = [...ROSTERS_A, ...ROSTERS_B, ...ROSTERS_C, ...ROSTERS_D];
  const teams: Record<string, Team> = {};
  const players: Record<string, Player> = {};

  for (const spec of specs) {
    const ids: string[] = [];
    for (const ps of spec.players) {
      const player = buildPlayer(ps, spec.id, startDate);
      // dedupe id collisions across teams
      let id = player.id;
      let n = 2;
      while (players[id]) id = `${player.id}-${n++}`;
      player.id = id;
      // Real-roster signed players default to first-team
      player.squadTier = 'first';
      players[id] = player;
      ids.push(id);
    }
    teams[spec.id] = buildTeam(spec, ids);
  }

  for (const fa of FREE_AGENTS) {
    const player = buildPlayer(fa, null, startDate);
    let id = player.id;
    let n = 2;
    while (players[id]) id = `${player.id}-${n++}`;
    player.id = id;
    players[id] = player;
  }

  // ~500 generated free agents (wonderkids + young pros + journeymen + vets)
  const usedIds = new Set(Object.keys(players));
  const usedNicks = new Set(Object.values(players).map((p) => p.nickname.toLowerCase()));
  const bulkFAs = generateFreeAgentPool(startDate, usedIds, usedNicks);
  for (const p of bulkFAs) players[p.id] = p;

  return { teams, players };
}
