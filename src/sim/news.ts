// Facebook/Twitter-style news feed simulation.
// Posts are generated automatically on key events: match results, transfer
// announcements, sponsor signings, retirements, milestones. The author pool
// has fixed press accounts + dynamic player/team accounts. Templates fill in
// real names/scores so the feed reads like a live scene.

import type { GameState, MatchResult, NewsAuthor, NewsPost, ScheduledMatch, Team } from '../types';
import { RNG, hashSeed } from '../engine/rng';

let nextPostId = 0;

// ============ Fixed press / analyst / fan authors ============

export const FIXED_AUTHORS: NewsAuthor[] = [
  { id: 'press-hltv', name: 'HLTV.org', handle: 'HLTVorg', kind: 'press', verified: true, avatarSeed: 'hltv' },
  { id: 'press-dexerto', name: 'Dexerto CS', handle: 'DexertoCS', kind: 'press', verified: true, avatarSeed: 'dex' },
  { id: 'press-dust2', name: 'Dust2.us', handle: 'Dust2us', kind: 'press', verified: false, avatarSeed: 'd2' },
  { id: 'press-thescore', name: 'theScore esports', handle: 'theScoreesports', kind: 'press', verified: true, avatarSeed: 'tse' },
  { id: 'press-flashpoint', name: 'Flashpoint', handle: 'FlashpointCS', kind: 'press', verified: false, avatarSeed: 'fp' },
  { id: 'analyst-spunj', name: 'Chad Burchill', handle: 'SPUNJ', kind: 'analyst', verified: true, avatarSeed: 'spunj' },
  { id: 'analyst-ynk', name: 'Janko Paunovic', handle: 'YNk', kind: 'analyst', verified: true, avatarSeed: 'ynk' },
  { id: 'analyst-launders', name: 'Duncan Shields', handle: 'launders', kind: 'analyst', verified: true, avatarSeed: 'launders' },
  { id: 'analyst-thorin', name: 'Duncan Mac', handle: 'Thorin', kind: 'analyst', verified: true, avatarSeed: 'thorin' },
  { id: 'fan-csfan42', name: 'CS Enjoyer', handle: 'csfan_42', kind: 'fan', avatarSeed: 'fan1' },
  { id: 'fan-awpmain', name: 'AWP MAIN', handle: 'awp_main_4ever', kind: 'fan', avatarSeed: 'fan2' },
  { id: 'fan-donkenjoyer', name: 'donk enjoyer', handle: 'donk_truther', kind: 'fan', avatarSeed: 'fan3' },
  { id: 'fan-csmemes', name: 'CS Memes', handle: 'cs_memes_daily', kind: 'fan', avatarSeed: 'fan4' },
  { id: 'fan-frankiej', name: 'Frankie', handle: 'frankie_csgo', kind: 'fan', avatarSeed: 'fan5' },
  { id: 'fan-clutchgod', name: 'clutchgod', handle: 'eco_AK_god', kind: 'fan', avatarSeed: 'fan6' },
];

/** Seed the news authors pool — fixed + per-team official accounts. */
export function seedNewsAuthors(g: GameState): void {
  g.newsAuthors = {};
  for (const a of FIXED_AUTHORS) g.newsAuthors[a.id] = a;
  // One official account per team
  for (const team of Object.values(g.teams)) {
    const id = `team-${team.id}-official`;
    g.newsAuthors[id] = {
      id,
      name: team.name,
      handle: `${team.tag.replace(/[^a-zA-Z0-9]/g, '')}_official`,
      kind: 'team-official',
      verified: team.worldRanking <= 20,
      teamId: team.id,
      avatarSeed: team.id,
    };
  }
  // Star players also get accounts (lazy-created when first posting)
  g.news = [];
}

/**
 * Non-destructive migration: ensure every fixed author + per-team official
 * account exists. Used on loadGame for older saves that may be missing entries.
 * Does NOT wipe news or overwrite existing authors.
 */
export function ensureNewsAuthors(g: GameState): void {
  if (!g.newsAuthors) g.newsAuthors = {};
  if (!g.news) g.news = [];
  for (const a of FIXED_AUTHORS) {
    if (!g.newsAuthors[a.id]) g.newsAuthors[a.id] = a;
  }
  for (const team of Object.values(g.teams)) {
    const id = `team-${team.id}-official`;
    if (!g.newsAuthors[id]) {
      g.newsAuthors[id] = {
        id,
        name: team.name,
        handle: `${team.tag.replace(/[^a-zA-Z0-9]/g, '')}_official`,
        kind: 'team-official',
        verified: team.worldRanking <= 20,
        teamId: team.id,
        avatarSeed: team.id,
      };
    }
  }
}

/** Lazy-create / fetch a pro player's news author entry. */
function authorForPlayer(g: GameState, playerId: string): NewsAuthor | null {
  const p = g.players[playerId];
  if (!p) return null;
  const id = `player-${playerId}`;
  if (!g.newsAuthors) g.newsAuthors = {};
  if (!g.newsAuthors[id]) {
    g.newsAuthors[id] = {
      id,
      name: `${p.nickname}`,
      handle: `${p.nickname.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`,
      kind: 'pro-player',
      verified: p.currentAbility >= 150,
      teamId: p.teamId ?? undefined,
      playerId,
      avatarSeed: playerId,
    };
  }
  return g.newsAuthors[id];
}

// ============ Posting ============

// Per-category cap. Match posts fire 3-5x per game, so without per-category limits
// they'd evict every other category from the 150-post buffer. These caps guarantee
// each tab has something to show.
const PER_CATEGORY_CAP: Record<NewsPost['category'], number> = {
  match: 60,
  transfer: 30,
  rumor: 30,
  milestone: 20,
  banter: 25,
  sponsor: 15,
  'press-release': 20,
  injury: 15,
};

export function pushPost(g: GameState, post: Omit<NewsPost, 'id' | 'likes' | 'reposts' | 'comments'>, rng: RNG): NewsPost {
  if (!g.news) g.news = [];
  const author = g.newsAuthors?.[post.authorId];
  // Like counts depend on author kind + tagged teams
  const baseLikes =
    author?.kind === 'press' || author?.kind === 'analyst' ? rng.int(800, 3500) :
    author?.kind === 'team-official' ? rng.int(2000, 12000) :
    author?.kind === 'pro-player' ? rng.int(3000, 25000) :
    rng.int(20, 800);
  const reposts = Math.floor(baseLikes * rng.range(0.05, 0.18));
  const comments = generateComments(g, post.text, rng);
  const full: NewsPost = {
    id: `news-${++nextPostId}-${post.date}-${rng.int(100, 9999).toString(36)}`,
    likes: baseLikes,
    reposts,
    comments,
    ...post,
  };
  g.news.unshift(full); // newest first

  // Per-category fairness: drop OLDEST posts of THIS category if we exceed the cap.
  // Prevents match-heavy days from evicting all rumors/transfers/etc. from the feed.
  const cap = PER_CATEGORY_CAP[full.category] ?? 30;
  const sameCat = g.news.filter((p) => p.category === full.category);
  if (sameCat.length > cap) {
    const toDrop = sameCat.length - cap;
    const oldestIds = new Set(
      sameCat
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, toDrop)
        .map((p) => p.id),
    );
    g.news = g.news.filter((p) => !oldestIds.has(p.id));
  }

  // Soft overall cap as a safety net (sum of category caps = 200).
  if (g.news.length > 200) g.news = g.news.slice(0, 200);
  return full;
}

function generateComments(g: GameState, parentText: string, rng: RNG): NewsPost['comments'] {
  // 0-4 mock comments
  const count = rng.int(0, 4);
  if (count === 0) return [];
  const fanIds = Object.values(g.newsAuthors ?? {})
    .filter((a) => a.kind === 'fan')
    .map((a) => a.id);
  const out: NewsPost['comments'] = [];
  const lines = [
    'no way 💀',
    'goated',
    'absolute scenes',
    'unreal',
    'told y\'all',
    'cope',
    'GG',
    'first 🎉',
    'bait or real',
    'this team is washed',
    'PRIME',
    'who asked',
    'name a better duo... i\'ll wait',
    'tactical masterclass',
    'rigged',
    'so back',
    'we are SO back',
    'it\'s over',
    '🥶🥶🥶',
    'where is the lie',
  ];
  for (let i = 0; i < count; i++) {
    out.push({
      authorId: rng.pick(fanIds.length ? fanIds : ['fan-csfan42']),
      text: rng.pick(lines),
    });
  }
  void parentText;
  return out;
}

// ============ Event-driven generators ============

/** Generate 2-4 posts after a notable match result. */
export function postsForMatch(
  g: GameState,
  match: ScheduledMatch,
  result: MatchResult,
  rng: RNG,
): void {
  const winner = g.teams[result.winnerId];
  const loserId = result.winnerId === match.teamAId ? match.teamBId : match.teamAId;
  const loser = g.teams[loserId];
  if (!winner || !loser) return;
  const score = `${result.mapsA}-${result.mapsB}`;
  const tournament = g.tournaments[match.tournamentId];
  if (!tournament) return;
  // Find MVP from match
  const allStats = result.maps.flatMap((m) => Object.values(m.playerStats));
  const mvp = allStats.sort((a, b) => b.rating - a.rating)[0];
  const mvpPlayer = mvp ? g.players[mvp.playerId] : null;

  // Press headline
  pushPost(g, {
    date: g.currentDate,
    authorId: rng.pick(['press-hltv', 'press-dexerto', 'press-dust2', 'press-thescore']),
    text: rng.pick([
      `🚨 ${winner.tag} take down ${loser.tag} ${score} at ${tournament.name}${mvpPlayer ? ` — ${mvpPlayer.nickname} drops a ${mvp!.rating.toFixed(2)} rating` : ''}.`,
      `${winner.name} ${score} ${loser.name} — what a ${match.roundLabel.toLowerCase()} at ${tournament.name}.`,
      `BREAKING: ${winner.tag} get the better of ${loser.tag} in the ${match.roundLabel} (${score}). The ${tournament.name} story continues.`,
    ]),
    category: 'match',
    taggedTeamIds: [winner.id, loser.id],
    taggedPlayerIds: mvpPlayer ? [mvpPlayer.id] : undefined,
  }, rng);

  // Team-official celebration (winner)
  const winnerOfficialId = `team-${winner.id}-official`;
  if (g.newsAuthors?.[winnerOfficialId]) {
    pushPost(g, {
      date: g.currentDate,
      authorId: winnerOfficialId,
      text: rng.pick([
        `JOB DONE ✅ ${score} over ${loser.tag} at ${tournament.name}. Onto the next one. 💪`,
        `GG ${loser.tag}. We march on. ${winner.tag} 🚀`,
        `The team showed up when it mattered. ${score} W. We're ${winner.name}. 🔥`,
      ]),
      category: 'match',
      taggedTeamIds: [winner.id],
    }, rng);
  }

  // Pro player tweet (MVP)
  if (mvpPlayer) {
    const author = authorForPlayer(g, mvpPlayer.id);
    if (author) {
      pushPost(g, {
        date: g.currentDate,
        authorId: author.id,
        text: rng.pick([
          `Trusted the work. Big W ❤️ #${winner.tag}`,
          `GG. On to the next.`,
          `Team carried me today, real talk. ${winner.tag} for life.`,
          `Felt it. Locked in.`,
          `🎯`,
          `One match at a time. Stay focused.`,
        ]),
        category: 'match',
        taggedTeamIds: [winner.id],
      }, rng);
    }
  }

  // Fan banter
  if (rng.chance(0.7)) {
    pushPost(g, {
      date: g.currentDate,
      authorId: rng.pick(['fan-csfan42', 'fan-awpmain', 'fan-donkenjoyer', 'fan-frankiej', 'fan-clutchgod']),
      text: rng.pick([
        `${winner.tag} are SO BACK`,
        `nobody can stop ${winner.tag} rn`,
        `${loser.tag} are washed. time for a roster move imo`,
        `told y'all ${winner.tag} would take this`,
        `${mvpPlayer?.nickname ?? 'this team'} is unreal 🐐`,
        `${loser.tag} fans where you at 💀`,
      ]),
      category: 'banter',
      taggedTeamIds: [winner.id, loser.id],
    }, rng);
  }

  // Analyst hot take (occasionally)
  if (rng.chance(0.35)) {
    pushPost(g, {
      date: g.currentDate,
      authorId: rng.pick(['analyst-spunj', 'analyst-ynk', 'analyst-launders', 'analyst-thorin']),
      text: rng.pick([
        `${winner.tag}'s mid-round adaptation has been the biggest factor for me here. Their ability to flip the script on a dime is elite.`,
        `Watch the way ${winner.tag} use utility in the post-plant. Textbook stuff.`,
        `${loser.tag} need to take a long look in the mirror. That's two big losses in a row.`,
        `Hot take: ${mvpPlayer?.nickname ?? winner.tag} is the most underrated player in the world right now.`,
        `If you're sleeping on ${winner.tag} for ${tournament.name}, that's your problem.`,
      ]),
      category: 'press-release',
      taggedTeamIds: [winner.id, loser.id],
    }, rng);
  }
}

/** Generate 1-2 posts when a transfer goes through. */
export function postsForTransfer(
  g: GameState,
  playerId: string,
  fromTeamId: string | null,
  toTeamId: string,
  fee: number,
  rng: RNG,
): void {
  const player = g.players[playerId];
  const fromTeam = fromTeamId ? g.teams[fromTeamId] : null;
  const toTeam = g.teams[toTeamId];
  if (!player || !toTeam) return;
  const feeStr = fee > 0 ? `for $${fee.toLocaleString()}` : 'on a free';
  pushPost(g, {
    date: g.currentDate,
    authorId: 'press-hltv',
    text: `🚨 OFFICIAL: ${player.nickname} joins ${toTeam.name}${fromTeam ? ` from ${fromTeam.name}` : ' as a free agent'} ${feeStr}.`,
    category: 'transfer',
    taggedTeamIds: fromTeam ? [fromTeam.id, toTeam.id] : [toTeam.id],
    taggedPlayerIds: [playerId],
  }, rng);

  const officialId = `team-${toTeam.id}-official`;
  if (g.newsAuthors?.[officialId] && rng.chance(0.7)) {
    pushPost(g, {
      date: g.currentDate,
      authorId: officialId,
      text: rng.pick([
        `Welcome home, ${player.nickname}. 🏠 #${toTeam.tag}`,
        `New chapter starts now. ${player.nickname} is one of us. ${toTeam.tag} 💚`,
        `It's official. ${player.nickname} signs for ${toTeam.name}.`,
      ]),
      category: 'transfer',
      taggedTeamIds: [toTeam.id],
      taggedPlayerIds: [playerId],
    }, rng);
  }
}

/** Tournament champion announcement. */
export function postsForChampion(g: GameState, championId: string, tournamentName: string, rng: RNG): void {
  const team = g.teams[championId];
  if (!team) return;
  pushPost(g, {
    date: g.currentDate,
    authorId: 'press-hltv',
    text: `🏆 ${team.name} are your ${tournamentName} CHAMPIONS!`,
    category: 'milestone',
    taggedTeamIds: [team.id],
  }, rng);
  const officialId = `team-${team.id}-official`;
  if (g.newsAuthors?.[officialId]) {
    pushPost(g, {
      date: g.currentDate,
      authorId: officialId,
      text: rng.pick([
        `WE DID IT 🏆 ${tournamentName} CHAMPIONS!! What a journey. ❤️ #${team.tag}`,
        `THE TROPHY IS COMING HOME 🏆 ${team.tag} ${tournamentName} CHAMPIONS!`,
        `Words can't describe it. Champions. ${team.tag} 🏆`,
      ]),
      category: 'milestone',
      taggedTeamIds: [team.id],
    }, rng);
  }
}

/** Sponsor signing. */
export function postsForSponsor(g: GameState, teamId: string, sponsorName: string, rng: RNG): void {
  const team = g.teams[teamId];
  if (!team) return;
  const officialId = `team-${team.id}-official`;
  if (!g.newsAuthors?.[officialId]) return;
  pushPost(g, {
    date: g.currentDate,
    authorId: officialId,
    text: rng.pick([
      `Big news 🤝 ${sponsorName} joins ${team.name} as a new partner. Excited for what's ahead!`,
      `Welcome to the family, ${sponsorName} 🚀 #${team.tag}`,
      `${team.name} is proud to announce a new partnership with ${sponsorName}.`,
    ]),
    category: 'sponsor',
    taggedTeamIds: [team.id],
  }, rng);
}

/** Player retirement. */
export function postsForRetirement(g: GameState, playerId: string, rng: RNG): void {
  const p = g.players[playerId];
  if (!p) return;
  pushPost(g, {
    date: g.currentDate,
    authorId: 'press-dexerto',
    text: `📜 ${p.nickname} retires at age ${p.age}. The CS community wishes him well in his next chapter.`,
    category: 'milestone',
    taggedPlayerIds: [p.id],
  }, rng);
  // Player farewell post
  const author = authorForPlayer(g, p.id);
  if (author) {
    pushPost(g, {
      date: g.currentDate,
      authorId: author.id,
      text: rng.pick([
        `It's been a journey ❤️ Thank you to everyone who supported me. Time to step away from competitive. New chapter incoming.`,
        `Retiring with a full heart. Thank you, CS. ❤️`,
        `End of one road, start of another. Forever grateful.`,
      ]),
      category: 'milestone',
    }, rng);
  }
}

/** Idle "rumor mill" post — adds atmosphere when nothing big is happening. */
/** Post an injury news entry for a high-profile player. */
export function pushPostInjury(
  g: GameState,
  today: string,
  playerId: string,
  nickname: string,
  teamTag: string,
  injury: { type: string; severity: string; description: string; returnDate: string },
  daysOut: number,
  rng: RNG,
): NewsPost {
  const severityLabel = injury.severity === 'minor' ? 'short-term' : injury.severity === 'moderate' ? 'mid-term' : 'long-term';
  const text =
    `🚑 ${nickname} (${teamTag}) ruled out — ${injury.description.replace(/\.$/, '')}. ` +
    `${severityLabel} absence, expected back around ${injury.returnDate} (~${daysOut} days).`;
  return pushPost(
    g,
    {
      date: today,
      authorId: rng.pick(['press-hltv', 'press-dexerto', 'press-thescore', 'analyst-launders']),
      text,
      category: 'injury',
      taggedPlayerIds: [playerId],
    },
    rng,
  );
}

/**
 * Daily roll for sponsor-flavoured news: brand extension rumours, hype around
 * existing top-team deals, new product launches, etc. Keeps the Sponsors tab
 * alive between season-end renewal sweeps.
 */
export function rollSponsorAnnouncement(g: GameState, today: string, rng: RNG): NewsPost | null {
  if (!rng.chance(0.35)) return null;
  // Pick a top-16 team that has at least one sponsor deal we can reference
  const eligible = Object.values(g.teams)
    .filter((t) => t.worldRanking <= 16 && (t.sponsorDeals ?? []).length > 0);
  if (!eligible.length) return null;
  const team = rng.pick(eligible);
  const deal = rng.pick(team.sponsorDeals ?? []);
  const sponsor = g.sponsors?.[deal.sponsorId];
  if (!sponsor) return null;
  const templates: Array<() => string> = [
    () => `${sponsor.brand} extending their presence in CS — ${team.tag} fans loving the new merch drop.`,
    () => `Rumour: ${sponsor.brand} considering bumping their ${team.tag} deal value at next renewal.`,
    () => `${team.tag} x ${sponsor.brand} announce a co-branded jersey for the upcoming event. Limited run.`,
    () => `${sponsor.brand} ad spend in CS is up sharply this quarter — good news for top orgs like ${team.tag}.`,
    () => `${team.name} CEO praises ${sponsor.brand} partnership in latest org statement. "Aligned values."`,
    () => `${sponsor.brand} launches a player meet & greet with ${team.tag} at the next major.`,
    () => `Industry: ${sponsor.brand}'s ${team.tag} sponsorship is reportedly setting the rate card for ${sponsor.tier}-tier deals.`,
  ];
  const text = rng.pick(templates)();
  return pushPost(
    g,
    {
      date: today,
      authorId: rng.pick(['press-hltv', 'press-dexerto', 'press-flashpoint', 'analyst-thorin']),
      text,
      category: 'sponsor',
      taggedTeamIds: [team.id],
    },
    rng,
  );
}

export function rollIdleRumor(g: GameState, today: string, rng: RNG): NewsPost | null {
  // Bumped from 0.4 → 0.75; multiple variants so the scene feels active even on idle days.
  if (!rng.chance(0.75)) return null;
  const teams = Object.values(g.teams).filter((t) => t.worldRanking <= 28);
  if (teams.length < 2) return null;
  const a = rng.pick(teams);
  let b = rng.pick(teams);
  while (b.id === a.id) b = rng.pick(teams);
  const aStar = Object.values(g.players).filter((p) => p.teamId === a.id).sort((x, y) => y.currentAbility - x.currentAbility)[0];
  const aWonderkid = Object.values(g.players).filter((p) => p.teamId === a.id && p.age <= 21 && p.potentialAbility - p.currentAbility >= 25)[0];
  const templates: Array<() => string> = [
    () => `Sources: ${a.tag} are looking at a roster move. Multiple names rumoured but nothing concrete yet.`,
    () => aStar ? `Whispers: ${b.tag} have shown interest in ${a.tag}'s ${aStar.nickname}. Could be a summer move.` : `Whispers in the scene about ${a.tag} possibly shaking up their roster.`,
    () => `In-form ${a.tag} look like genuine title threats heading into the next event. Watch this space.`,
    () => `Form of ${a.tag} is starting to dip. Is something off in the team house?`,
    () => aWonderkid ? `Scouts buzzing about ${aWonderkid.nickname} at ${a.tag} — early projections have him as a future star.` : `Quiet confidence around ${a.tag}'s training block this week.`,
    () => `${a.tag} vs ${b.tag} would be a banger if these two run it back in playoffs.`,
    () => aStar ? `${aStar.nickname} (${a.tag}) reportedly putting up monster numbers in scrims. Watch out for him.` : `Tactical experiments in scrims for ${a.tag} — could mean a new style at the next event.`,
    () => `Bracket-watchers think ${a.tag} can leapfrog ${b.tag} in the rankings if results break their way.`,
    () => `${a.tag} have been signing scrim wins all week. Don't sleep on them.`,
  ];
  const text = rng.pick(templates)();
  return pushPost(
    g,
    {
      date: today,
      authorId: rng.pick(['press-dust2', 'press-flashpoint', 'press-thescore', 'analyst-launders', 'analyst-spunj', 'analyst-thorin']),
      text,
      category: 'rumor',
      taggedTeamIds: [a.id, b.id],
    },
    rng,
  );
}
