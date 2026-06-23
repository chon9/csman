// End-of-season individual awards. Computed at season rollover from the live
// season stats (rating, kills, clutches, ages, roles). Recipients get a
// permanent entry on their player.honours list + a news ceremony post.

import type { GameState, Player, SeasonAward, PlayerRole } from '../types';

const MIN_MAPS_FOR_AWARDS = 20;

interface AwardCtx {
  year: number;
  pool: Player[]; // ratedPlayers (maps ≥ MIN_MAPS_FOR_AWARDS)
  byId: Map<string, Player>;
  teams: GameState['teams'];
}

function makeAward(
  ctx: AwardCtx,
  kind: SeasonAward['kind'],
  player: Player,
  stat?: string,
): SeasonAward {
  return {
    kind,
    year: ctx.year,
    recipientId: player.id,
    recipientName: player.nickname,
    teamId: player.teamId ?? undefined,
    teamName: player.teamId ? ctx.teams[player.teamId]?.name : 'Free agent',
    stat,
  };
}

/** Compute the full slate of awards. Returns an array; empty if pool too small. */
export function computeSeasonAwards(g: GameState, year: number): SeasonAward[] {
  const pool = Object.values(g.players).filter((p) => p.stats.maps >= MIN_MAPS_FOR_AWARDS);
  if (pool.length < 5) return [];
  const ctx: AwardCtx = {
    year,
    pool,
    byId: new Map(pool.map((p) => [p.id, p])),
    teams: g.teams,
  };
  const out: SeasonAward[] = [];

  // Player of the Year — highest rating
  const poty = [...pool].sort((a, b) => b.stats.rating - a.stats.rating)[0];
  if (poty) out.push(makeAward(ctx, 'player-of-year', poty, `Rating ${poty.stats.rating.toFixed(2)}`));

  // Rookie of the Year — best rating among age ≤ 21
  const rookieEligible = pool.filter((p) => p.age <= 21);
  const rookie = rookieEligible.sort((a, b) => b.stats.rating - a.stats.rating)[0];
  if (rookie) out.push(makeAward(ctx, 'rookie-of-year', rookie, `Rating ${rookie.stats.rating.toFixed(2)} at ${rookie.age}`));

  // Top Fragger — most kills
  const fragger = [...pool].sort((a, b) => b.stats.kills - a.stats.kills)[0];
  if (fragger) out.push(makeAward(ctx, 'top-fragger', fragger, `${fragger.stats.kills} kills`));

  // Clutch King — most clutchesWon, ties broken by rating
  const clutch = [...pool].sort((a, b) => b.stats.clutchesWon - a.stats.clutchesWon || b.stats.rating - a.stats.rating)[0];
  if (clutch && clutch.stats.clutchesWon > 0) {
    out.push(makeAward(ctx, 'clutch-king', clutch, `${clutch.stats.clutchesWon} clutches won`));
  }

  // Major MVP — best rating; bias toward players who attended a Major-winning team
  const majors = Object.values(g.tournaments).filter((t) => t.isMajor);
  if (majors.length > 0) {
    const majorChampionIds = new Set<string>();
    for (const t of majors) {
      const state = g.tournamentStates[t.id];
      if (!state) continue;
      const championId = Object.entries(state.placements).find(([, p]) => p === 1)?.[0];
      if (championId) majorChampionIds.add(championId);
    }
    const majorPool = pool.filter((p) => p.teamId && majorChampionIds.has(p.teamId));
    const mvp = (majorPool.length > 0 ? majorPool : pool).sort((a, b) => b.stats.rating - a.stats.rating)[0];
    if (mvp) out.push(makeAward(ctx, 'major-mvp', mvp, `Rating ${mvp.stats.rating.toFixed(2)}`));
  }

  // All-Star Five — 1 IGL + 1 AWPer + 3 fragger (highest rating in each bucket).
  // Avoid double-picking the same player across slots.
  const used = new Set<string>();
  function pickByRole(roles: PlayerRole[]): Player | undefined {
    return [...pool]
      .filter((p) => roles.includes(p.role) && !used.has(p.id))
      .sort((a, b) => b.stats.rating - a.stats.rating)[0];
  }
  const asIgl = pickByRole(['IGL']);
  if (asIgl) { out.push(makeAward(ctx, 'all-star-igl', asIgl, `Rating ${asIgl.stats.rating.toFixed(2)}`)); used.add(asIgl.id); }
  const asAwp = pickByRole(['AWPer']);
  if (asAwp) { out.push(makeAward(ctx, 'all-star-awper', asAwp, `Rating ${asAwp.stats.rating.toFixed(2)}`)); used.add(asAwp.id); }
  const fragger1 = pickByRole(['Entry', 'Lurker', 'Rifler', 'Anchor', 'Support']);
  if (fragger1) { out.push(makeAward(ctx, 'all-star-1', fragger1, `Rating ${fragger1.stats.rating.toFixed(2)}`)); used.add(fragger1.id); }
  const fragger2 = pickByRole(['Entry', 'Lurker', 'Rifler', 'Anchor', 'Support']);
  if (fragger2) { out.push(makeAward(ctx, 'all-star-2', fragger2, `Rating ${fragger2.stats.rating.toFixed(2)}`)); used.add(fragger2.id); }
  const fragger3 = pickByRole(['Entry', 'Lurker', 'Rifler', 'Anchor', 'Support']);
  if (fragger3) { out.push(makeAward(ctx, 'all-star-3', fragger3, `Rating ${fragger3.stats.rating.toFixed(2)}`)); used.add(fragger3.id); }

  // Coach of the Year — team whose final rank is best vs preseason expectation.
  // We approximate preseason expectation by reputation rank (higher rep = better
  // expected). Coach with the largest overperformance (smaller actual rank than rep rank).
  const allTeams = Object.values(g.teams);
  const byRep = [...allTeams].sort((a, b) => b.reputation - a.reputation);
  const repRankById = new Map(byRep.map((t, i) => [t.id, i + 1]));
  const overperformer = [...allTeams]
    .filter((t) => t.worldRanking <= 16)
    .sort((a, b) => (repRankById.get(a.id)! - a.worldRanking) - (repRankById.get(b.id)! - b.worldRanking))
    .reverse()[0];
  if (overperformer) {
    out.push({
      kind: 'coach-of-year',
      year,
      recipientId: overperformer.id,
      recipientName: overperformer.coachName,
      teamId: overperformer.id,
      teamName: overperformer.name,
      stat: `${overperformer.name} finished #${overperformer.worldRanking} (expected ~#${repRankById.get(overperformer.id)})`,
    });
  }

  return out;
}

export const AWARD_LABEL: Record<SeasonAward['kind'], string> = {
  'player-of-year': 'Player of the Year',
  'rookie-of-year': 'Rookie of the Year',
  'top-fragger': 'Top Fragger',
  'clutch-king': 'Clutch King',
  'major-mvp': 'Major MVP',
  'all-star-igl': 'All-Star Five — IGL',
  'all-star-awper': 'All-Star Five — AWPer',
  'all-star-1': 'All-Star Five — Rifler',
  'all-star-2': 'All-Star Five — Rifler',
  'all-star-3': 'All-Star Five — Rifler',
  'coach-of-year': 'Coach of the Year',
};

export function isPlayerAward(kind: SeasonAward['kind']): boolean {
  return kind !== 'coach-of-year';
}
