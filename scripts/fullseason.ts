// Headless multi-season test: drives the real zustand store through 2 full seasons.
// Run: npx tsx scripts/fullseason.ts

// localStorage shim for node
(globalThis as { localStorage?: Storage }).localStorage = (() => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
})();

import { useGame } from '../src/store/gameStore';

const s = () => useGame.getState();

s().newGame('navi', 'Headless Test');
console.log('New game as NAVI,', s().game!.currentDate);

let matchesPlayed = 0;
let safety = 0;
const placements: string[] = [];

// Snapshot population + age stats at each rollover so we can verify long-term stability
const yearSnapshots: {
  year: number;
  pool: number;
  avgAge: number;
  oldest: number;
  newgens: number;
  aiAvgCA: number;
  topAiCA: number;
  userAvgCA: number;
}[] = [];
let prevYear = s().game!.seasonYear;

while (s().game!.seasonYear <= 2031 && safety++ < 4000) {
  const st = s();
  const g = st.game!;
  // Snapshot at season boundary
  if (g.seasonYear !== prevYear) {
    const ages = Object.values(g.players).map((p) => p.age);
    const newgens = Object.values(g.players).filter((p) => p.age <= 19).length;
    // AI roster CA — players belonging to non-user teams
    const aiPlayers = Object.values(g.players).filter(
      (p) => p.teamId && p.teamId !== g.userTeamId,
    );
    const userPlayers = Object.values(g.players).filter((p) => p.teamId === g.userTeamId);
    const aiAvgCA =
      aiPlayers.length > 0
        ? Math.round(aiPlayers.reduce((a, b) => a + b.currentAbility, 0) / aiPlayers.length)
        : 0;
    const userAvgCA =
      userPlayers.length > 0
        ? Math.round(userPlayers.reduce((a, b) => a + b.currentAbility, 0) / userPlayers.length)
        : 0;
    const topAiCA =
      aiPlayers.length > 0 ? Math.max(...aiPlayers.map((p) => p.currentAbility)) : 0;
    yearSnapshots.push({
      year: g.seasonYear,
      pool: ages.length,
      avgAge: Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10,
      oldest: Math.max(...ages),
      newgens,
      aiAvgCA,
      topAiCA,
      userAvgCA,
    });
    prevYear = g.seasonYear;
  }
  const m = st.userMatchToday();
  if (m && st.screen === 'matchday') {
    st.playUserMatch();
    st.confirmUserMatch();
    matchesPlayed++;
    continue;
  }
  const before = g.currentDate;
  st.advanceDay();
  const after = s().game!.currentDate;
  if (after === before && !s().userMatchToday()) {
    console.error('!! STUCK at', before, 'screen', s().screen);
    break;
  }
  if (s().game!.seasonYear === 2032) break;
}

const g = s().game!;
console.log('--- finished:', g.currentDate, 'season', g.seasonYear);
console.log('user matches played:', matchesPlayed);
const user = g.teams[g.userTeamId];
console.log(`NAVI: rank #${user.worldRanking}, budget $${user.budget.toLocaleString()}, roster ${user.playerIds.length}`);

// sanity: tournament placements from inbox
for (const msg of g.inbox.filter((x) => x.subject.includes('finished #'))) placements.push(msg.subject);
console.log('placements:', placements.length ? placements.slice(-8).join(' | ') : '(none)');

// sanity: all teams have 5+ players, no orphan players
let bad = 0;
for (const t of Object.values(g.teams)) {
  if (t.playerIds.length < 5) { console.error(`!! ${t.name} roster ${t.playerIds.length}`); bad++; }
  for (const id of t.playerIds) {
    if (g.players[id]?.teamId !== t.id) { console.error(`!! orphan link ${id} in ${t.name}`); bad++; }
  }
}
console.log(bad === 0 ? 'roster integrity OK' : `roster issues: ${bad}`);

// sanity: season 2027 tournaments exist & RMR->Major link
const majors = Object.values(g.tournaments).filter((t) => t.isMajor);
console.log('majors this season:', majors.map((t) => `${t.name} (qualifier: ${t.qualifierId ?? 'none'})`).join(' | '));

// season history archived?
const hist = g.seasonHistory ?? [];
console.log('season records:', hist.length);
for (const h of hist) {
  console.log(
    `  ${h.year}: rank #${h.userRank}, PotY ${h.playerOfSeason?.nickname ?? '-'} (${h.playerOfSeason?.rating.toFixed(2) ?? '-'}), ` +
      `events with champions: ${h.events.filter((e) => e.championTeamId).length}/${h.events.length}`,
  );
}

// AI transfer news happened?
const transferNews = g.inbox.filter((m) => m.subject === 'Transfer market round-up').length;
console.log('AI transfer round-ups:', transferNews);

// News category breakdown (Mike's "news bugged" verification)
const newsByCat = (g.news ?? []).reduce<Record<string, number>>((acc, p) => {
  acc[p.category] = (acc[p.category] ?? 0) + 1;
  return acc;
}, {});
console.log('news category breakdown:', JSON.stringify(newsByCat));

// Training reports
const trainingReports = g.inbox.filter((m) => m.subject.startsWith('Training report')).length;
console.log('Training reports in inbox:', trainingReports);

// CA vs PA invariant — CA must NEVER exceed PA
const violations = Object.values(g.players).filter((p) => p.currentAbility > p.potentialAbility);
console.log(`CA > PA violations: ${violations.length}${violations.length > 0 ? ' — BUG' : ' — PASS'}`);
if (violations.length > 0) {
  violations.slice(0, 5).forEach((p) => console.log(`  ${p.nickname}: CA ${p.currentAbility} > PA ${p.potentialAbility}`));
}

// Relationships
const rels = g.relationships ?? [];
console.log(`Total relationships: ${rels.length}`);
const byKind = rels.reduce<Record<string, number>>((acc, r) => { acc[r.kind] = (acc[r.kind] ?? 0) + 1; return acc; }, {});
console.log(`Relationship breakdown: ${JSON.stringify(byKind)}`);
const playersWithRels = Object.values(g.players).filter((p) => rels.some((r) => r.fromId === p.id || r.toId === p.id)).length;
console.log(`Players with at least 1 relationship: ${playersWithRels}`);

// Awards
const totalAwards = (g.seasonHistory ?? []).reduce((s, r) => s + (r.awards?.length ?? 0), 0);
const playersWithHonours = Object.values(g.players).filter((p) => (p.honours?.length ?? 0) > 0);
console.log(`Total season awards: ${totalAwards}`);
console.log(`Players with honours: ${playersWithHonours.length}`);
console.log(`Top honoured players:`);
playersWithHonours
  .sort((a, b) => (b.honours?.length ?? 0) - (a.honours?.length ?? 0))
  .slice(0, 5)
  .forEach((p) => console.log(`  ${p.nickname} — ${p.honours!.length} honours: ${p.honours!.map((h) => `${h.kind}(${h.year})`).join(', ')}`));

// Long-term lifecycle stability
console.log('\n--- pool stability across seasons ---');
for (const snap of yearSnapshots) {
  console.log(
    `  ${snap.year}: pool=${snap.pool}, avgAge=${snap.avgAge}, oldest=${snap.oldest}, newgens (≤19)=${snap.newgens}, ` +
      `aiAvgCA=${snap.aiAvgCA}, topAiCA=${snap.topAiCA}, userAvgCA=${snap.userAvgCA}`,
  );
}

// Inbox / state size sanity (state pruning should keep these bounded)
console.log(`final inbox=${g.inbox.length} (read: ${g.inbox.filter(m => m.read).length}), ` +
  `matchHistory=${g.matchHistory.length}, processedDates=${g.processedDates.length}`);

// Retirement log
const retireMsgs = g.inbox.filter((x) => x.subject.includes('retires from competitive') || x.subject.includes('players retire'));
console.log(`retirement notices in inbox: ${retireMsgs.length}`);

// Newgen log
const newgenMsgs = g.inbox.filter((x) => x.subject.startsWith('Class of '));
console.log(`newgen class notices in inbox: ${newgenMsgs.length}`);

// ages advanced?
const donk = Object.values(g.players).find((p) => p.nickname === 'donk');
console.log('donk age (started 18):', donk?.age, '| stats reset:', donk?.stats.maps, 'maps');
console.log('inbox size:', g.inbox.length, '| schedule size:', g.schedule.length, '| history:', g.matchHistory.length);
console.log('Full-season test complete.');
