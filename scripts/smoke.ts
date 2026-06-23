// Engine smoke test: npx tsx scripts/smoke.ts
import { buildInitialDatabase } from '../src/data/database';
import { MAP_LAYOUTS, validateLayouts } from '../src/data/maps';
import { simulateMatch, type EngineTeam } from '../src/engine/matchEngine';
import { DEFAULT_TACTICS } from '../src/types';
import { generateSeasonTournaments } from '../src/sim/calendar';

import { validateStrats } from '../src/engine/strats';
import { ALL_MAPS } from '../src/types';

const errs = validateLayouts();
console.log('Map validation:', errs.length === 0 ? 'OK' : errs);
const zoneIds = Object.fromEntries(
  ALL_MAPS.map((m) => [m, new Set(MAP_LAYOUTS[m].zones.map((z) => z.id))]),
) as Record<(typeof ALL_MAPS)[number], Set<string>>;
const stratErrs = validateStrats(zoneIds);
console.log('Strat validation:', stratErrs.length === 0 ? 'OK' : stratErrs);

const { teams, players } = buildInitialDatabase('2026-01-05');
const teamList = Object.values(teams);
console.log(`Teams: ${teamList.length}, Players: ${Object.keys(players).length}`);
const freeAgents = Object.values(players).filter((p) => !p.teamId).length;
console.log(`Free agents: ${freeAgents}`);

for (const t of teamList) {
  const roster = t.playerIds.map((id) => players[id]).filter(Boolean);
  if (roster.length < 5) console.error(`!! ${t.name} has only ${roster.length} players`);
  const igls = roster.slice(0, 5).filter((p) => p.role === 'IGL').length;
  if (igls === 0) console.warn(`-- ${t.name} has no IGL in starting five`);
}

function eTeam(id: string): EngineTeam {
  const team = teams[id];
  const ps = team.playerIds.slice(0, 5).map((x) => players[x]);
  return { team, players: ps, tactics: DEFAULT_TACTICS, pressureResistance: 12 };
}

// 200-match calibration: top team vs mid team — expect favorite winning 65-85%
const ids = teamList.sort((a, b) => a.worldRanking - b.worldRanking).map((t) => t.id);
const top = ids[0];
const mid = ids[15];
let topWins = 0;
const N = 100;
for (let i = 0; i < N; i++) {
  const r = simulateMatch(`smoke-${i}`, eTeam(top), eTeam(mid), 'BO3', MAP_LAYOUTS, 0.3, i * 7919);
  if (r.winnerId === top) topWins++;
}
console.log(`${teams[top].name} vs ${teams[mid].name}: favorite wins ${topWins}/${N}`);

// mid-gap matchup: rank 1 vs rank 8
let w18 = 0;
for (let i = 0; i < N; i++) {
  const r = simulateMatch(`mid-${i}`, eTeam(top), eTeam(ids[7]), 'BO3', MAP_LAYOUTS, 0.3, i * 31337);
  if (r.winnerId === top) w18++;
}
console.log(`${teams[top].name} vs ${teams[ids[7]].name}: favorite wins ${w18}/${N}`);

// even matchup sanity
let aWins = 0;
for (let i = 0; i < N; i++) {
  const r = simulateMatch(`even-${i}`, eTeam(ids[2]), eTeam(ids[3]), 'BO3', MAP_LAYOUTS, 0.3, i * 104729);
  if (r.winnerId === ids[2]) aWins++;
}
console.log(`${teams[ids[2]].name} vs ${teams[ids[3]].name}: A wins ${aWins}/${N}`);

// single match detail
const detail = simulateMatch('detail', eTeam(top), eTeam(mid), 'BO3', MAP_LAYOUTS, 0.3, 42);
console.log('Veto:', detail.vetoLog.join(' | '));
for (const m of detail.maps) {
  console.log(`${m.map}: ${m.scoreA}-${m.scoreB} (${m.rounds.length} rounds)`);
  const ratings = Object.values(m.playerStats).map((s) => s.rating);
  console.log(
    `  avg rating ${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)}, ` +
      `max ${Math.max(...ratings).toFixed(2)}, min ${Math.min(...ratings).toFixed(2)}`,
  );
  const totalKills = Object.values(m.playerStats).reduce((s, p) => s + p.kills, 0);
  console.log(`  total kills ${totalKills}, kills/round ${(totalKills / m.rounds.length).toFixed(1)}`);
  const frames = m.rounds.reduce((s, r) => s + r.frames.length, 0);
  console.log(`  frames recorded: ${frames}`);
}

// strat commentary + tempo sample
const sample = simulateMatch('strat-sample', eTeam(ids[0]), eTeam(ids[5]), 'BO1', MAP_LAYOUTS, 0.3, 777);
const sMap = sample.maps[0];
console.log(`--- sample commentary (${sMap.map}) ---`);
for (const r of sMap.rounds.slice(0, 5)) {
  console.log(`R${r.roundNo} (${r.winnerSide} ${r.reason}, ${r.frames.length} ticks, buy ${r.buyA}/${r.buyB}):`);
  for (const c of r.commentary) console.log('   ' + c);
}
const avgTicks = sMap.rounds.reduce((s, r) => s + r.frames.length, 0) / sMap.rounds.length;
console.log(`avg round length: ${avgTicks.toFixed(1)} ticks (~${(avgTicks * 2).toFixed(0)}s)`);

// commentary richness: count line types across a full match
const allLines = sMap.rounds.flatMap((r) => r.commentary);
const linesPerRound = allLines.length / sMap.rounds.length;
const ecoLines = allLines.filter((l) => l.startsWith('[Freeze]')).length;
const utilLines = allLines.filter((l) => /smoke|molot|flash|util/i.test(l)).length;
const postPlantLines = allLines.filter((l) => /Post-plant|retake|on the bomb/i.test(l)).length;
const clutchLines = allLines.filter((l) => /🚨|LAST T|alone for/i.test(l)).length;
const openerLines = allLines.filter((l) => /front foot/i.test(l)).length;
console.log(
  `commentary density: ${linesPerRound.toFixed(1)} lines/round | ` +
    `eco ${ecoLines}, util ${utilLines}, postplant ${postPlantLines}, ` +
    `clutch ${clutchLines}, opener-aftermath ${openerLines}`,
);

// utility damage leaderboard across the sample map
const utilLeaders = Object.values(sMap.playerStats)
  .sort((a, b) => b.utilityDamage - a.utilityDamage)
  .slice(0, 5);
console.log('--- utility damage leaders (sample map) ---');
for (const s of utilLeaders) {
  const p = players[s.playerId];
  console.log(
    `   ${p?.nickname ?? s.playerId.slice(0, 6)} (util ${p?.attributes.utility ?? '?'}): ` +
      `${s.utilityDamage} total / ${(s.utilityDamage / sMap.rounds.length).toFixed(1)} per round`,
  );
}

// drama frequency across many rounds
let fakes = 0, aborts = 0, saves = 0, flanks = 0, swings = 0, totalRounds = 0;
for (let i = 0; i < 30; i++) {
  const r = simulateMatch(`drama-${i}`, eTeam(ids[3]), eTeam(ids[6]), 'BO1', MAP_LAYOUTS, 0.3, i * 1337);
  for (const m of r.maps) {
    for (const rd of m.rounds) {
      totalRounds++;
      const text = rd.commentary.join('|');
      if (text.includes("It's a FAKE")) fakes++;
      if (text.includes('back out and regroup')) aborts++;
      if (text.includes('save their weapons')) saves++;
      if (text.includes('for the flank')) flanks++;
      if (text.includes('Mid-round call')) swings++;
    }
  }
}
console.log(
  `drama over ${totalRounds} rounds: fakes ${fakes} (${((fakes / totalRounds) * 100).toFixed(0)}%), ` +
    `aborts ${aborts} (${((aborts / totalRounds) * 100).toFixed(0)}%), saves ${saves} (${((saves / totalRounds) * 100).toFixed(0)}%), ` +
    `flank calls ${flanks}, mid-round swings ${swings}`,
);

// tournament generation sanity
const tours = generateSeasonTournaments(2026, teams, ids[10]);
console.log(`Tournaments: ${Object.keys(tours).length}`);
for (const t of Object.values(tours)) {
  if (t.invitedTeamIds.length !== t.teamCount) {
    console.error(`!! ${t.name}: invited ${t.invitedTeamIds.length} != ${t.teamCount}`);
  }
}
console.log('Smoke test complete.');
