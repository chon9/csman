// Message routing. Each handler consumes a typed ClientMessage and either
// returns a single ServerMessage reply (sent over the connection that
// originated the request) or null when nothing to send. Side-effects mutate
// SQLite via the DB facade.

import { randomBytes } from 'node:crypto';
import type {
  ClientMessage,
  MarketListing,
  MatchHistoryEntry,
  NewsItem,
  OnlineTeam,
  PlayerGoal,
  PvpChallenge,
  ServerMessage,
  TacticsPreset,
  TeamDirectoryEntry,
} from '../../src/online/protocol.ts';
import {
  ACHIEVEMENT_LABELS,
  DAILY_BONUS_AMOUNT,
  DAILY_DUEL_CAP,
  EXTRA_DUEL_COST,
  FREE_AGENT_POOL_SIZE,
  MAX_EXTRA_DUELS_PER_DAY,
  INITIAL_ROSTER_SIZE,
  MAX_DUEL_STAKE,
  MAX_LOAN_DAYS,
  MAX_OPEN_GOALS,
  MAX_TACTICS_PRESETS,
  MAX_TIME_SKIP_DAYS,
  MIN_DUEL_STAKE,
  MINT_TIERS,
  STARTING_MONEY,
  TIME_SKIP_COST_PER_DAY,
  isDmParticipant,
  type MintTier,
} from '../../src/online/protocol.ts';
import type { MatchResult, Player, Region, Team } from '../../src/types.ts';

/**
 * Process expired loans — restore the player to the lender, mark loan as
 * returned, and push a `loan-event` to both parties. Idempotent + cheap
 * (single index lookup); safe to call on every refresh-state.
 */
function processDueLoans(db: DB, notifyTeam: NotifyTeam, log: (s: string) => void): void {
  const due = db.loadDueLoans(Date.now());
  for (const loan of due) {
    const lender = db.loadTeam(loan.fromTeamId);
    const borrower = db.loadTeam(loan.toTeamId);
    const player = db.loadPlayer(loan.playerId);
    if (!lender || !borrower || !player) {
      db.setLoanStatus(loan.id, 'returned');
      continue;
    }
    // Move player back if still on borrower's roster (might have been
    // sold mid-loan; in that case just close the loan without forcing).
    if (player.teamId === borrower.id) {
      borrower.playerIds = borrower.playerIds.filter((id) => id !== player.id);
      lender.playerIds = [...lender.playerIds, player.id];
      player.teamId = lender.id;
      db.setTeamPlayers(borrower.id, borrower.playerIds);
      db.setTeamPlayers(lender.id, lender.playerIds);
      db.persistPlayer(player);
    }
    db.setLoanStatus(loan.id, 'returned');
    log(`loan returned: ${lender.tag} ← ${borrower.tag} (${player.nickname})`);
    const payload = {
      ...loan, status: 'returned' as const,
      fromTeamTag: lender.tag, toTeamTag: borrower.tag, playerNickname: player.nickname,
    };
    notifyTeam(lender.id, { kind: 'loan-event', loan: payload });
    notifyTeam(borrower.id, { kind: 'loan-event', loan: payload });
  }
}

/**
 * Achievement unlock helper. Fires the DB insert + (if it's a fresh unlock)
 * pushes a notification to that team's connected sockets so the UI can
 * toast the badge. No-op if the team already had this achievement.
 */
function tryUnlock(
  db: DB,
  notifyTeam: NotifyTeam,
  teamId: string,
  kind: string,
  label: string,
  value?: number,
): void {
  if (!db.unlockAchievement(teamId, kind, value)) return;
  notifyTeam(teamId, {
    kind: 'achievement-unlocked',
    achievement: { teamId, kind, label, value, achievedAt: Date.now() },
  });
}

/** Compact list of every persisted team — used to populate the DM picker
 *  and any future "team directory" view. Pulls straight from SQLite, no
 *  caching — small servers, this is cheap. */
function listAllTeamsCompact(db: DB): TeamDirectoryEntry[] {
  const rows = db.raw.prepare(`SELECT id, tag, name, owner_nick, region FROM teams ORDER BY tag ASC LIMIT 200`).all() as Array<{
    id: string;
    tag: string;
    name: string;
    owner_nick: string;
    region: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    tag: r.tag,
    name: r.name,
    ownerNick: r.owner_nick,
    region: r.region,
  }));
}
import { DEFAULT_TACTICS } from '../../src/types.ts';
import type { DB, TeamRow } from './db.ts';
import { spawnInitialRoster } from './spawn.ts';
import { runAiDuel, runPvpDuel, stripFrames } from './duels.ts';
import { skipTime } from './timeskip.ts';
import { buildWageMap, ensureFreeAgentPool, mintWonderkid, suggestedWage } from './freeAgents.ts';
import { CASES, DAILY_FREE_CASE_ID } from '../../src/data/cs2Cases.ts';
import { openCase as rollCaseOpen } from '../../src/sim/caseOpening.ts';
import { RNG } from '../../src/engine/rng.ts';
import type { ActiveBoostWire, BoostAttrKey, BoostCard, BoostRarity, CaseSummary, SkinInstanceWire } from '../../src/online/protocol.ts';
import { BOOST_CARD_LIBRARY, BOOST_PACK_COST, BOOST_PACK_ODDS } from '../../src/online/protocol.ts';
import type { PlayerAttributes } from '../../src/types.ts';
import type { SkinInstance } from '../../src/types.ts';
import { cacheLiveReplay, getLiveReplay } from './liveState.ts';
import { applyAutoTicks, nextAutoTickUtcMs } from './autoTick.ts';
import { ensureCoachPool, maybeOfferSponsor, processRetirements, processSponsorPayouts } from './serverTick.ts';
import {
  buildTournamentDetail,
  createTournament,
  ensureDailyTournament,
  ensureThemedTournament,
  listTournaments,
  registerForTournament,
  runReadyTournaments,
} from './tournaments.ts';

/** ISO timestamp of the next 00:00 UTC — used to tell the client when the
 *  daily bonus resets so it can show a countdown without polling. */
function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Default targets for legacy boosts persisted before BOOST_CARD_LIBRARY
 *  existed — those carry attrBonus but no attrTargets. */
const LEGACY_BOOST_TARGETS: BoostAttrKey[] = ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'];

/** Mutate a player's attributes in-place to include any active boost.
 *  Returns the snapshot needed to restore the un-boosted values. Idempotent
 *  for boost-less players (no-op snapshot). */
function applyBoostToPlayer(player: Player): Partial<PlayerAttributes> | null {
  const boost = player.activeBoost;
  if (!boost || boost.duelsLeft <= 0) return null;
  const targets = (boost.attrTargets && boost.attrTargets.length > 0)
    ? boost.attrTargets
    : LEGACY_BOOST_TARGETS;
  const snapshot: Partial<PlayerAttributes> = {};
  for (const k of targets) {
    snapshot[k] = player.attributes[k];
    // Cap at 25 — engine still scales smoothly there, but stops boosts from
    // stacking to absurd values if anyone ever wires up double-cards.
    player.attributes[k] = Math.min(25, (player.attributes[k] ?? 10) + boost.attrBonus);
  }
  return snapshot;
}
function restoreBoostSnapshot(player: Player, snapshot: Partial<PlayerAttributes> | null): void {
  if (!snapshot) return;
  for (const k of Object.keys(snapshot) as (keyof PlayerAttributes)[]) {
    if (snapshot[k] !== undefined) player.attributes[k] = snapshot[k]!;
  }
}
/** Tick down duelsLeft on every active boost in the roster. Clears the
 *  field entirely (and notifies via the supplied callback) when it hits 0. */
function tickBoostsAfterDuel(
  players: Player[],
  notify: (p: Player) => void,
): void {
  for (const p of players) {
    if (!p.activeBoost) continue;
    p.activeBoost.duelsLeft -= 1;
    if (p.activeBoost.duelsLeft <= 0) {
      delete p.activeBoost;
      notify(p);
    }
  }
}

/** Roll a single booster card: pick rarity by BOOST_PACK_ODDS, then pick a
 *  template uniformly from BOOST_CARD_LIBRARY entries at that rarity. */
function rollBoostCard(): BoostCard {
  const r = Math.random();
  let acc = 0;
  let chosen: BoostRarity = 'common';
  const order: BoostRarity[] = ['common', 'rare', 'epic', 'legendary'];
  for (const rarity of order) {
    acc += BOOST_PACK_ODDS[rarity];
    if (r <= acc) { chosen = rarity; break; }
  }
  const pool = BOOST_CARD_LIBRARY.filter((t) => t.rarity === chosen);
  // Defensive — if a rarity tier ever ends up empty, fall back to commons.
  const tmpl = pool.length > 0
    ? pool[Math.floor(Math.random() * pool.length)]
    : BOOST_CARD_LIBRARY.find((t) => t.rarity === 'common')!;
  return {
    id: `boost-${randomBytes(5).toString('hex')}`,
    templateId: tmpl.id,
    rarity: tmpl.rarity,
    name: tmpl.name,
    attrTargets: tmpl.attrTargets,
    attrBonus: tmpl.attrBonus,
    duels: tmpl.duels,
    flavor: tmpl.flavor,
    acquiredAt: Date.now(),
  };
}

/** Nickname (lowercased) that gets admin powers. Set via CSM_ADMIN_NICK env
 *  var at server boot — empty/unset means no admin exists. Case-insensitive
 *  match against the connecting client's nickname. */
const ADMIN_NICK = (process.env.CSM_ADMIN_NICK ?? '').trim().toLowerCase();
function isAdminConn(conn: ConnSession): boolean {
  return !!ADMIN_NICK && !!conn.nickname && conn.nickname.toLowerCase() === ADMIN_NICK;
}

/** Callback wired in index.ts — pushes a message to every connected socket
 *  belonging to the given teamId. Used for PvP "your challenge was accepted"
 *  pushes. No-op if the target team is offline. */
export type NotifyTeam = (teamId: string, msg: ServerMessage) => void;
/** Push to every connected socket regardless of team — chat + tournament-wide
 *  events. The index.ts shell owns the implementation. */
export type Broadcast = (msg: ServerMessage) => void;

/** Per-connection mutable session state, kept in the ws server's connection map. */
export interface ConnSession {
  sessionToken: string | null;
  nickname: string | null;
  teamId: string | null;
}

export function newConnSession(): ConnSession {
  return { sessionToken: null, nickname: null, teamId: null };
}

/** Synthesize a Team (engine-shaped) from a TeamRow. The wire shape is
 *  flatter than the engine's; this fills in the rep + mapPool defaults the
 *  match engine expects. */
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

function teamRowToOnline(row: TeamRow): OnlineTeam {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    region: row.region,
    ownerNick: row.ownerNick,
    money: row.money,
    day: row.day,
    createdAt: row.createdAt,
    playerIds: row.playerIds,
    tactics: row.tactics ?? {},
  };
}

function buildState(db: DB, teamId: string): ServerMessage | null {
  // Wall-clock auto-advance: bring the team forward to the current UTC
  // tick boundary (every 4 hours = 1 in-game day). Lazy + idempotent —
  // costs nothing if no boundary has crossed since the last call.
  applyAutoTicks(db, teamId);
  const team = db.loadTeam(teamId);
  if (!team) return null;
  const players: Player[] = db.loadTeamPlayers(teamId);
  const today = new Date().toISOString().slice(0, 10);
  const duelStats = db.getDuelStats(teamId, today);
  return {
    kind: 'state',
    team: teamRowToOnline(team),
    players,
    dailyBonusAvailable: db.getDailyClaimDate(teamId) !== today,
    freeCaseAvailable: db.getFreeCaseDate(teamId) !== today,
    duelsUsed: duelStats.used,
    duelsExtra: duelStats.extra,
    nextTickUtcMs: nextAutoTickUtcMs(),
  };
}

export function handle(
  db: DB,
  conn: ConnSession,
  msg: ClientMessage,
  log: (line: string) => void,
  notifyTeam: NotifyTeam = () => {},
  broadcast: Broadcast = () => {},
): ServerMessage | null {
  switch (msg.kind) {
    case 'ping':
      return { kind: 'pong' };

    case 'hello': {
      const nick = msg.nickname.trim().slice(0, 24);
      const pin = msg.pin.trim();
      if (!nick || !/^\d{4,8}$/.test(pin)) {
        return { kind: 'error', code: 'bad-credentials', message: 'Nickname required and PIN must be 4-8 digits.' };
      }
      const auth = db.authenticateOrRegister(nick, pin);
      if (!auth.ok) return { kind: 'hello-bad-pin' };
      conn.nickname = nick;
      conn.teamId = auth.teamId;
      const sessionToken = auth.teamId ? db.issueSession(auth.teamId) : randomBytes(16).toString('hex');
      conn.sessionToken = sessionToken;
      const admin = isAdminConn(conn);
      log(`hello ok: ${nick}${auth.teamId ? ' (team ' + auth.teamId + ')' : ' (no team yet)'}${admin ? ' [ADMIN]' : ''}`);
      return { kind: 'hello-ok', sessionToken, hasTeam: !!auth.teamId, isAdmin: admin };
    }

    case 'create-team': {
      if (!conn.nickname) {
        return { kind: 'error', code: 'no-session', message: 'Send hello first.' };
      }
      if (conn.teamId) {
        return { kind: 'error', code: 'has-team', message: 'You already own a team.' };
      }
      const name = msg.name.trim().slice(0, 32);
      const tag = msg.tag.trim().slice(0, 6).toUpperCase();
      if (!name || !tag) {
        return { kind: 'error', code: 'bad-name', message: 'Team name and tag required.' };
      }
      const team: TeamRow = {
        id: `team-${randomBytes(6).toString('hex')}`,
        name,
        tag,
        region: msg.region,
        ownerNick: conn.nickname,
        money: STARTING_MONEY,
        day: 1,
        createdAt: Date.now(),
        playerIds: [],
        tactics: {},
        bio: '',
        primaryColor: '#de9b35',
        twitchUrl: '',
        twitterUrl: '',
        youtubeUrl: '',
      };
      db.createTeam(team);
      conn.teamId = team.id;
      log(`team created: ${tag} (${name}) for ${conn.nickname}`);
      return { kind: 'team-created', team: teamRowToOnline(team) };
    }

    case 'spawn-initial-players': {
      if (!conn.teamId) {
        return { kind: 'error', code: 'no-team', message: 'Create a team first.' };
      }
      const team = db.loadTeam(conn.teamId);
      if (!team) {
        return { kind: 'error', code: 'no-team', message: 'Team not found.' };
      }
      if (team.playerIds.length > 0) {
        return { kind: 'error', code: 'has-roster', message: 'Your roster has already been spawned.' };
      }
      const roles =
        msg.roles && msg.roles.length === INITIAL_ROSTER_SIZE
          ? msg.roles
          : undefined;
      const startDate = new Date(team.createdAt).toISOString().slice(0, 10);
      // Seed collision-avoidance with the entire existing player pool — every
      // signed roster + every free agent — so we never hand `savePlayer` a
      // duplicate id (which silently dropped under INSERT OR IGNORE, and
      // hard-crashed the whole spawn under plain INSERT before that).
      const { ids: usedIds, nicks: usedNicks } = db.loadAllPlayerKeys();
      const players = spawnInitialRoster(team.id, team.region, startDate, roles, usedIds, usedNicks);
      for (const p of players) db.savePlayer(p);
      db.setTeamPlayers(
        team.id,
        players.map((p) => p.id),
      );
      log(`spawned ${players.length} newgens for ${team.tag}`);
      return { kind: 'players-spawned', players };
    }

    case 'refresh-state': {
      if (!conn.teamId) {
        return { kind: 'error', code: 'no-team', message: 'No team in session.' };
      }
      // Cheap tick: any loans past their end-date get returned right here.
      // No scheduler thread needed — every team's home screen polls
      // refresh-state every 8s, which keeps loans flowing on time.
      processDueLoans(db, notifyTeam, log);

      // Sponsor payouts: any active sponsor whose 30 days have elapsed
      // auto-credits. Quiet — broadcasts a sponsors message to the team
      // so a toast can fire.
      const payouts = processSponsorPayouts(db, conn.teamId);
      if (payouts.length > 0) {
        const t = db.loadTeam(conn.teamId);
        if (t) {
          const total = payouts.reduce((s, p) => s + p.amount, 0);
          t.money += total;
          db.setTeamMoneyDay(t.id, t.money, t.day);
          notifyTeam(conn.teamId, {
            kind: 'sponsors',
            offers: db.loadSponsorsForTeam(conn.teamId),
            paid: payouts.map((p) => ({ sponsorId: p.sponsorId, amount: p.amount })),
          });
        }
      }

      // Periodically offer a fresh sponsor when the team has a track record.
      const season = db.currentSeason();
      const standings = db.loadTeamStandings(season.seasonNo, conn.teamId);
      const newOffer = maybeOfferSponsor(db, conn.teamId, standings.wins);
      if (newOffer) {
        notifyTeam(conn.teamId, {
          kind: 'sponsors',
          offers: db.loadSponsorsForTeam(conn.teamId),
          paid: [],
        });
      }

      return buildState(db, conn.teamId);
    }

    // ---------- Phase 2: duels ----------

    case 'register-ai-duel': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      if (team.playerIds.length < 5) {
        return { kind: 'error', code: 'roster-incomplete', message: 'Need 5 players to duel.' };
      }
      // Daily duel cap — counts both AI and PvP duels. Scrims (stake=0)
      // skip the check so unranked practice stays unlimited.
      const isScrim = msg.stake === 0;
      const today = new Date().toISOString().slice(0, 10);
      if (!isScrim) {
        const stats = db.getDuelStats(team.id, today);
        const cap = DAILY_DUEL_CAP + stats.extra;
        if (stats.used >= cap) {
          return {
            kind: 'error',
            code: 'duel-cap',
            message: `Daily duel cap (${cap}) reached. Buy an extra slot ($${EXTRA_DUEL_COST.toLocaleString()}) or wait until 00:00 UTC.`,
          };
        }
      }
      const stake = isScrim ? 0 : Math.max(MIN_DUEL_STAKE, Math.min(MAX_DUEL_STAKE, Math.round(msg.stake)));
      if (!isScrim && team.money < stake) {
        return { kind: 'error', code: 'insufficient-funds', message: `Need $${stake.toLocaleString()} stake — you have $${team.money.toLocaleString()}.` };
      }
      const players = db.loadTeamPlayers(team.id);
      // Build Team-shaped object for the engine (mirror of buildEngineTeam in
      // duels.ts but using TeamRow's fields). Reuse mapPool default.
      const engineTeam: Team = teamRowToEngineTeam(team);
      const matchId = `duel-${team.id}-${Date.now()}`;
      // Boost integration: spread the card's bonus across combat attributes
      // BEFORE the engine reads them; restore after so daily.ts sees the
      // baseline values when computing form/morale/fatigue gains.
      const boostSnapshots: Array<[Player, Partial<Player['attributes']> | null]> = [];
      if (!isScrim) for (const p of players) boostSnapshots.push([p, applyBoostToPlayer(p)]);
      const duel = runAiDuel(engineTeam, players, stake, msg.format ?? 'BO1', matchId, team.tactics);
      for (const [p, snap] of boostSnapshots) restoreBoostSnapshot(p, snap);
      team.money = Math.max(0, team.money + duel.moneyDelta);
      db.setTeamMoneyDay(team.id, team.money, team.day);
      // Tick the daily duel counter — scrims don't count toward the cap.
      if (!isScrim) {
        db.recordDuelUsed(team.id, today);
        // Decrement boost duels-left; emit boost-expired pushes if any ran out.
        tickBoostsAfterDuel(players, (p) => {
          notifyTeam(team.id, { kind: 'boost-expired', playerId: p.id });
        });
      }
      // Persist the mutated players (form/morale/fatigue + match stats + boost tick).
      for (const p of players) db.persistPlayer(p);
      // Persist a stripped copy to match history so the History screen can
      // show this duel and the user can replay it later.
      db.recordMatch({
        id: matchId,
        teamAId: team.id,
        teamBId: null,
        teamATag: team.tag,
        teamBTag: duel.opponentTag,
        winnerId: duel.result.winnerId,
        mapsA: duel.result.mapsA,
        mapsB: duel.result.mapsB,
        stake,
        kind: 'ai',
        resultJson: JSON.stringify(stripFrames(duel.result)),
      });
      // Cache the full (frames-bearing) result for live replay fetching.
      cacheLiveReplay(matchId, duel.result);
      // Live feed: broadcast to all sockets so spectators can watch.
      broadcast({
        kind: 'live-match-feed',
        entry: {
          matchId,
          kind: 'ai',
          teamATag: team.tag,
          teamBTag: duel.opponentTag,
          mapsA: duel.result.mapsA,
          mapsB: duel.result.mapsB,
          context: isScrim ? 'Scrim' : `$${stake.toLocaleString()} duel`,
          at: Date.now(),
        },
      });
      // Season standings — only real duels, not scrims.
      if (!isScrim) {
        const season = db.currentSeason();
        const standings = db.recordSeasonOutcome(
          season.seasonNo,
          team.id,
          duel.result.winnerId === team.id,
          duel.moneyDelta,
        );
        // Achievement checks against the cumulative season standings.
        if (standings.wins >= 1) tryUnlock(db, notifyTeam, team.id, 'first_blood', ACHIEVEMENT_LABELS.first_blood);
        if (standings.wins >= 10) tryUnlock(db, notifyTeam, team.id, 'ten_wins', ACHIEVEMENT_LABELS.ten_wins, standings.wins);
        if (standings.wins >= 50) tryUnlock(db, notifyTeam, team.id, 'fifty_wins', ACHIEVEMENT_LABELS.fifty_wins, standings.wins);
        if (standings.netMoney >= 100_000) tryUnlock(db, notifyTeam, team.id, 'bankroll_100k', ACHIEVEMENT_LABELS.bankroll_100k, standings.netMoney);
      }
      log(`${isScrim ? 'Scrim' : 'AI duel'}: ${team.tag} vs ${duel.opponentTag} → ${duel.moneyDelta > 0 ? 'WIN' : duel.moneyDelta < 0 ? 'LOSS' : 'NEUTRAL'} ($${duel.moneyDelta})`);
      return {
        kind: 'duel-result',
        outcome: {
          // Keep frames in the reply so the requesting client can show a replay.
          // (Server doesn't store them — they're trimmed via stripFrames on the
          // next refresh-state, but a one-shot push to the client is fine.)
          result: duel.result,
          opponentName: duel.opponentName,
          opponentTag: duel.opponentTag,
          moneyDelta: duel.moneyDelta,
          newMoney: team.money,
          summary: duel.summary,
        },
      };
    }

    // ---------- Phase 2: time-skip ----------

    case 'time-skip': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const days = Math.max(1, Math.min(MAX_TIME_SKIP_DAYS, Math.round(msg.days)));
      const cost = days * TIME_SKIP_COST_PER_DAY;
      if (team.money < cost) {
        return { kind: 'error', code: 'insufficient-funds', message: `Need $${cost.toLocaleString()} for ${days} days — you have $${team.money.toLocaleString()}.` };
      }
      const players = db.loadTeamPlayers(team.id);
      const openGoals = db.loadGoalsForTeam(team.id).filter((g) => !g.reachedAt);
      const hiredCoach = db.loadHiredCoachFor(team.id);
      const ts = skipTime(team, players, days, openGoals, hiredCoach?.skill);
      // Charge the coach's monthly wage prorated by the days skipped.
      if (hiredCoach) {
        const cost = Math.round(hiredCoach.monthlyWage * (days / 30));
        if (team.money >= cost) team.money -= cost;
      }
      db.setTeamMoneyDay(team.id, team.money, team.day);
      for (const p of players) db.persistPlayer(p);
      // Persist any newly-reached goals + push notifications.
      for (const reached of ts.goalsReached) {
        db.flagGoalReached(reached.playerId, reached.attr);
        notifyTeam(team.id, { kind: 'goal-reached', ...reached });
        tryUnlock(db, notifyTeam, team.id, 'first_goal_reached', ACHIEVEMENT_LABELS.first_goal_reached);
      }
      // Age + retirement roll once per real week skipped.
      const weeks = Math.floor(days / 7);
      if (weeks > 0) {
        for (const p of players) p.age += weeks * 0.02; // ~1 year per 50 weeks of game-day skip
      }
      const ret = processRetirements(db, team, players, weeks);
      for (const r of ret.retired) {
        notifyTeam(team.id, { kind: 'player-retired', playerId: r.playerId, nickname: r.nickname, lastAge: r.lastAge });
        const newsItem = db.publishNews('other', `${r.nickname} retires from competitive play at ${r.lastAge}. Inducted into the Hall of Fame.`);
        broadcast({ kind: 'news-item', item: newsItem as NewsItem });
      }
      for (const p of players) db.persistPlayer(p);
      log(`time-skip: +${ts.daysAdvanced}d, -$${ts.cost} (day ${ts.newDay}), ${ts.devChanges.length} dev moves, ${ts.goalsReached.length} goals reached, ${ret.retired.length} retired`);
      return {
        kind: 'time-skipped',
        newDay: ts.newDay,
        daysAdvanced: ts.daysAdvanced,
        trainingNotes: ts.trainingNotes,
        cost: ts.cost,
        devChanges: ts.devChanges,
      };
    }

    // ---------- Phase 2: marketplace ----------

    case 'list-market': {
      const listings = db.loadAllListings();
      // Fetch the player records for every listed playerId so the client can
      // render attrs without a second roundtrip per row.
      const players: Player[] = [];
      for (const l of listings) {
        const p = db.loadPlayer(l.playerId);
        if (p) players.push(p);
      }
      return { kind: 'market', listings: listings as MarketListing[], players };
    }

    case 'list-player': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      if (!team.playerIds.includes(msg.playerId)) {
        return { kind: 'error', code: 'not-your-player', message: 'You can only list your own players.' };
      }
      // Need at least 5 players left after the listing fires (won't lose
      // them until someone buys, but the seller shouldn't be able to even
      // offer the player if their squad is at the floor).
      if (team.playerIds.length <= 5) {
        return { kind: 'error', code: 'roster-floor', message: 'Squad already at 5 — sign a backup before listing.' };
      }
      const existing = db.loadListingByPlayer(msg.playerId);
      if (existing) {
        return { kind: 'error', code: 'already-listed', message: 'Player is already on the market.' };
      }
      const askingPrice = Math.max(1_000, Math.round(msg.askingPrice));
      const listingId = `list-${randomBytes(6).toString('hex')}`;
      const listing = db.createListing(listingId, msg.playerId, team.id, team.tag, askingPrice);
      log(`market: ${team.tag} listed ${msg.playerId} @ $${askingPrice.toLocaleString()}`);
      return { kind: 'market-listed', listing: listing as MarketListing };
    }

    case 'unlist-player': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const listing = db.loadListing(msg.listingId);
      if (!listing) return { kind: 'error', code: 'no-listing', message: 'Listing not found.' };
      if (listing.sellerTeamId !== conn.teamId) {
        return { kind: 'error', code: 'not-your-listing', message: 'You can only unlist your own players.' };
      }
      db.removeListing(msg.listingId);
      return { kind: 'market-unlisted', listingId: msg.listingId };
    }

    // ---------- Phase 3: PvP challenges ----------

    case 'post-challenge': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      if (team.playerIds.length < 5) {
        return { kind: 'error', code: 'roster-incomplete', message: 'Need 5 players to post a challenge.' };
      }
      const stake = Math.max(MIN_DUEL_STAKE, Math.min(MAX_DUEL_STAKE, Math.round(msg.stake)));
      if (team.money < stake) {
        return { kind: 'error', code: 'insufficient-funds', message: `Stake must be covered (need $${stake.toLocaleString()}).` };
      }
      // Cap: only allow 3 open challenges per team so the lobby doesn't get spammed.
      const mine = db.loadChallengesByTeam(team.id);
      if (mine.length >= 3) {
        return { kind: 'error', code: 'too-many', message: 'Cancel an existing challenge before posting another (3 max).' };
      }
      const id = `chal-${randomBytes(6).toString('hex')}`;
      db.createChallenge({
        id,
        challengerTeamId: team.id,
        challengerTag: team.tag,
        challengerNick: team.ownerNick,
        stake,
        format: msg.format ?? 'BO1',
        message: msg.message?.slice(0, 120),
      });
      const challenge = db.loadChallenge(id);
      if (!challenge) return { kind: 'error', code: 'storage-error', message: 'Could not persist challenge.' };
      log(`PvP challenge posted: ${team.tag} stake $${stake} ${challenge.format}`);
      return { kind: 'challenge-posted', challenge: challenge as PvpChallenge };
    }

    case 'cancel-challenge': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const ch = db.loadChallenge(msg.challengeId);
      if (!ch) return { kind: 'error', code: 'no-challenge', message: 'Challenge not found.' };
      if (ch.challengerTeamId !== conn.teamId) {
        return { kind: 'error', code: 'not-yours', message: 'You can only cancel your own challenges.' };
      }
      db.removeChallenge(msg.challengeId);
      log(`PvP challenge cancelled: ${ch.id}`);
      return { kind: 'challenge-cancelled', challengeId: msg.challengeId };
    }

    case 'list-challenges': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const open = db.loadOpenChallenges();
      const mine = open.filter((c) => c.challengerTeamId === conn.teamId);
      const others = open.filter((c) => c.challengerTeamId !== conn.teamId);
      return { kind: 'challenges', open: others as PvpChallenge[], mine: mine as PvpChallenge[] };
    }

    case 'accept-challenge': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const challenge = db.loadChallenge(msg.challengeId);
      if (!challenge) return { kind: 'error', code: 'no-challenge', message: 'Challenge no longer open.' };
      if (challenge.challengerTeamId === conn.teamId) {
        return { kind: 'error', code: 'self-accept', message: 'You cannot accept your own challenge.' };
      }
      const accepter = db.loadTeam(conn.teamId);
      const challenger = db.loadTeam(challenge.challengerTeamId);
      if (!accepter || !challenger) {
        return { kind: 'error', code: 'no-team', message: 'A team is missing.' };
      }
      if (accepter.playerIds.length < 5) {
        return { kind: 'error', code: 'roster-incomplete', message: 'Need 5 players to accept.' };
      }
      if (accepter.money < challenge.stake) {
        return { kind: 'error', code: 'insufficient-funds', message: `Need $${challenge.stake.toLocaleString()} to cover the stake.` };
      }
      if (challenger.money < challenge.stake) {
        // Challenger went broke between posting and accepting — auto-cancel.
        db.removeChallenge(challenge.id);
        return { kind: 'error', code: 'challenger-broke', message: 'Challenger can no longer cover the stake.' };
      }
      // Both sides have to have a duel slot available — PvP counts for both.
      const pvpToday = new Date().toISOString().slice(0, 10);
      const accepterStats = db.getDuelStats(accepter.id, pvpToday);
      const challengerStats = db.getDuelStats(challenger.id, pvpToday);
      if (accepterStats.used >= DAILY_DUEL_CAP + accepterStats.extra) {
        return {
          kind: 'error',
          code: 'duel-cap',
          message: `You've hit your daily duel cap (${DAILY_DUEL_CAP + accepterStats.extra}). Buy an extra slot or wait until 00:00 UTC.`,
        };
      }
      if (challengerStats.used >= DAILY_DUEL_CAP + challengerStats.extra) {
        db.removeChallenge(challenge.id);
        return {
          kind: 'error',
          code: 'challenger-capped',
          message: 'Challenger has hit their daily duel cap — challenge auto-cancelled.',
        };
      }

      const challengerPlayers = db.loadTeamPlayers(challenger.id);
      const accepterPlayers = db.loadTeamPlayers(accepter.id);
      const matchId = `pvp-${challenge.id}`;
      // Boost integration on both sides — apply before engine reads, restore after.
      const pvpBoostSnaps: Array<[Player, Partial<Player['attributes']> | null]> = [];
      for (const p of challengerPlayers) pvpBoostSnaps.push([p, applyBoostToPlayer(p)]);
      for (const p of accepterPlayers) pvpBoostSnaps.push([p, applyBoostToPlayer(p)]);
      const duel = runPvpDuel(
        teamRowToEngineTeam(challenger),
        challengerPlayers,
        teamRowToEngineTeam(accepter),
        accepterPlayers,
        challenge.stake,
        challenge.format,
        matchId,
        challenger.tactics,
        accepter.tactics,
      );
      for (const [p, snap] of pvpBoostSnaps) restoreBoostSnapshot(p, snap);

      // Money flow — winner gets stake, loser pays it.
      if (duel.winnerTeamId === challenger.id) {
        challenger.money += challenge.stake;
        accepter.money = Math.max(0, accepter.money - challenge.stake);
      } else {
        accepter.money += challenge.stake;
        challenger.money = Math.max(0, challenger.money - challenge.stake);
      }
      db.setTeamMoneyDay(challenger.id, challenger.money, challenger.day);
      db.setTeamMoneyDay(accepter.id, accepter.money, accepter.day);
      // PvP counts toward both teams' daily caps.
      db.recordDuelUsed(challenger.id, pvpToday);
      db.recordDuelUsed(accepter.id, pvpToday);
      // Tick boost duels-left for both sides; push expiry notices per team.
      tickBoostsAfterDuel(challengerPlayers, (p) => notifyTeam(challenger.id, { kind: 'boost-expired', playerId: p.id }));
      tickBoostsAfterDuel(accepterPlayers, (p) => notifyTeam(accepter.id, { kind: 'boost-expired', playerId: p.id }));
      for (const p of challengerPlayers) db.persistPlayer(p);
      for (const p of accepterPlayers) db.persistPlayer(p);
      db.recordMatch({
        id: matchId,
        teamAId: challenger.id,
        teamBId: accepter.id,
        teamATag: challenger.tag,
        teamBTag: accepter.tag,
        winnerId: duel.winnerTeamId,
        mapsA: duel.result.mapsA,
        mapsB: duel.result.mapsB,
        stake: challenge.stake,
        kind: 'pvp',
        resultJson: JSON.stringify(stripFrames(duel.result)),
      });
      cacheLiveReplay(matchId, duel.result);
      broadcast({
        kind: 'live-match-feed',
        entry: {
          matchId,
          kind: 'pvp',
          teamATag: challenger.tag,
          teamBTag: accepter.tag,
          mapsA: duel.result.mapsA,
          mapsB: duel.result.mapsB,
          context: `$${challenge.stake.toLocaleString()} PvP`,
          at: Date.now(),
        },
      });
      db.removeChallenge(challenge.id);
      // Season standings — record both sides. PvP always counts.
      {
        const season = db.currentSeason();
        const challengerWon = duel.winnerTeamId === challenger.id;
        const cS = db.recordSeasonOutcome(season.seasonNo, challenger.id, challengerWon, challengerWon ? challenge.stake : -challenge.stake);
        const aS = db.recordSeasonOutcome(season.seasonNo, accepter.id, !challengerWon, challengerWon ? -challenge.stake : challenge.stake);
        const winnerStandings = challengerWon ? cS : aS;
        const winnerId = challengerWon ? challenger.id : accepter.id;
        if (winnerStandings.wins >= 1) tryUnlock(db, notifyTeam, winnerId, 'first_blood', ACHIEVEMENT_LABELS.first_blood);
        if (winnerStandings.wins >= 10) tryUnlock(db, notifyTeam, winnerId, 'ten_wins', ACHIEVEMENT_LABELS.ten_wins, winnerStandings.wins);
        if (winnerStandings.wins >= 50) tryUnlock(db, notifyTeam, winnerId, 'fifty_wins', ACHIEVEMENT_LABELS.fifty_wins, winnerStandings.wins);
        if (winnerStandings.netMoney >= 100_000) tryUnlock(db, notifyTeam, winnerId, 'bankroll_100k', ACHIEVEMENT_LABELS.bankroll_100k, winnerStandings.netMoney);
        // Underdog check: winner's avg CA was lower than loser's.
        const winnerAvgCA = (challengerWon ? challengerPlayers : accepterPlayers)
          .slice(0, 5).reduce((s, p) => s + p.currentAbility, 0) / 5;
        const loserAvgCA = (challengerWon ? accepterPlayers : challengerPlayers)
          .slice(0, 5).reduce((s, p) => s + p.currentAbility, 0) / 5;
        if (winnerAvgCA + 8 < loserAvgCA) {
          tryUnlock(db, notifyTeam, winnerId, 'underdog_win', ACHIEVEMENT_LABELS.underdog_win);
        }
      }

      // Push duel-result to BOTH sides. The challenger sees it via notifyTeam;
      // the accepter (= this connection) gets it as the reply below.
      const accepterWon = duel.winnerTeamId === accepter.id;
      const challengerOutcome = {
        result: duel.result,
        opponentName: accepter.name,
        opponentTag: accepter.tag,
        moneyDelta: accepterWon ? -challenge.stake : challenge.stake,
        newMoney: challenger.money,
        summary: accepterWon
          ? `Lost to ${accepter.tag} ${duel.result.mapsA}-${duel.result.mapsB}. -$${challenge.stake.toLocaleString()}.`
          : `Beat ${accepter.tag} ${duel.result.mapsA}-${duel.result.mapsB}. +$${challenge.stake.toLocaleString()}.`,
      };
      const accepterOutcome = {
        result: duel.result,
        opponentName: challenger.name,
        opponentTag: challenger.tag,
        moneyDelta: accepterWon ? challenge.stake : -challenge.stake,
        newMoney: accepter.money,
        summary: accepterWon
          ? `Beat ${challenger.tag} ${duel.result.mapsB}-${duel.result.mapsA}. +$${challenge.stake.toLocaleString()}.`
          : `Lost to ${challenger.tag} ${duel.result.mapsB}-${duel.result.mapsA}. -$${challenge.stake.toLocaleString()}.`,
      };
      notifyTeam(challenger.id, { kind: 'duel-result', outcome: challengerOutcome });
      // Also tell the challenger their challenge resolved (so any list-challenges UI clears).
      notifyTeam(challenger.id, { kind: 'challenge-cancelled', challengeId: challenge.id });
      // High-stakes PvP gets a news headline so the server feels alive.
      if (challenge.stake >= 10_000) {
        const winnerTag = duel.winnerTeamId === challenger.id ? challenger.tag : accepter.tag;
        const loserTag = duel.winnerTeamId === challenger.id ? accepter.tag : challenger.tag;
        const newsItem = db.publishNews(
          'duel',
          `${winnerTag} beat ${loserTag} ${Math.max(duel.result.mapsA, duel.result.mapsB)}-${Math.min(duel.result.mapsA, duel.result.mapsB)} in a $${challenge.stake.toLocaleString()} PvP.`,
        );
        broadcast({ kind: 'news-item', item: newsItem as NewsItem });
      }
      log(`PvP resolved: ${challenger.tag} vs ${accepter.tag} → winner ${duel.winnerTeamId === challenger.id ? challenger.tag : accepter.tag}`);
      return { kind: 'duel-result', outcome: accepterOutcome };
    }

    // ---------- Phase 3: free agents ----------

    case 'list-free-agents': {
      ensureFreeAgentPool(db);
      const fas = db.loadFreeAgents(FREE_AGENT_POOL_SIZE);
      return { kind: 'free-agents', players: fas, suggestedWageById: buildWageMap(fas) };
    }

    case 'sign-free-agent': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const player = db.loadPlayer(msg.playerId);
      if (!player || player.teamId !== null) {
        return { kind: 'error', code: 'not-free', message: 'Player is no longer a free agent.' };
      }
      // Wage offered = upfront cost for two months (first + signing fee).
      const wage = Math.max(suggestedWage(player), Math.round(msg.wage));
      const signingFee = wage * 2;
      if (team.money < signingFee) {
        return { kind: 'error', code: 'insufficient-funds', message: `Signing fee $${signingFee.toLocaleString()} too high — you have $${team.money.toLocaleString()}.` };
      }
      team.money -= signingFee;
      player.teamId = team.id;
      player.squadTier = team.playerIds.length < 5 ? 'first' : 'reserve';
      player.contract = {
        wage,
        expires: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        buyout: Math.round(player.askingPrice * 1.2),
      };
      team.playerIds = [...team.playerIds, player.id];
      db.setTeamMoneyDay(team.id, team.money, team.day);
      db.setTeamPlayers(team.id, team.playerIds);
      db.persistPlayer(player);
      log(`FA signed: ${team.tag} <- ${player.nickname} ($${wage}/mo, fee $${signingFee})`);
      const newsItem = db.publishNews(
        'transfer',
        `${team.tag} sign FA ${player.nickname} (${player.age}yo ${player.role}, CA ${player.currentAbility}) at $${wage.toLocaleString()}/mo.`,
      );
      broadcast({ kind: 'news-item', item: newsItem as NewsItem });
      tryUnlock(db, notifyTeam, team.id, 'first_fa_sign', ACHIEVEMENT_LABELS.first_fa_sign);
      return { kind: 'free-agent-signed', player, wage };
    }

    case 'mint-free-agent': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const tier: MintTier = (['standard', 'premium', 'elite'] as const).includes(msg.tier)
        ? msg.tier
        : 'standard';
      const meta = MINT_TIERS[tier];
      if (team.money < meta.cost) {
        return {
          kind: 'error',
          code: 'insufficient-funds',
          message: `Need $${meta.cost.toLocaleString()} to commission a ${meta.label} — you have $${team.money.toLocaleString()}.`,
        };
      }
      team.money -= meta.cost;
      db.setTeamMoneyDay(team.id, team.money, team.day);
      const startDate = new Date().toISOString().slice(0, 10);
      const player = mintWonderkid(db, tier, startDate);
      log(`mint(${tier}): ${team.tag} -$${meta.cost} → FA ${player.nickname} (PA ${player.potentialAbility})`);
      const newsItem = db.publishNews(
        'transfer',
        `${team.tag} commissioned a ${meta.label} — ${player.nickname} (${player.age}yo ${player.role}, PA ${player.potentialAbility}) hits the market.`,
      );
      broadcast({ kind: 'news-item', item: newsItem as NewsItem });
      return { kind: 'free-agent-minted', player, cost: meta.cost, tier };
    }

    // ---------- Daily login bonus ----------

    case 'claim-daily-bonus': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const today = new Date().toISOString().slice(0, 10);
      const last = db.getDailyClaimDate(conn.teamId);
      if (last === today) {
        return {
          kind: 'error',
          code: 'already-claimed',
          message: `Already claimed today — next reward unlocks at 00:00 UTC.`,
        };
      }
      const newMoney = team.money + DAILY_BONUS_AMOUNT;
      team.money = newMoney;
      db.setTeamMoneyDay(team.id, newMoney, team.day);
      db.markDailyClaim(team.id, today);
      log(`daily: ${team.tag} claimed $${DAILY_BONUS_AMOUNT.toLocaleString()} (total $${newMoney.toLocaleString()})`);
      return {
        kind: 'daily-bonus-claimed',
        amount: DAILY_BONUS_AMOUNT,
        newMoney,
        nextClaimUtc: nextUtcMidnight(),
      };
    }

    case 'buy-extra-duel': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const today = new Date().toISOString().slice(0, 10);
      const stats = db.getDuelStats(team.id, today);
      if (stats.extra >= MAX_EXTRA_DUELS_PER_DAY) {
        return {
          kind: 'error',
          code: 'extra-cap',
          message: `You've already bought ${stats.extra} extra duel slots today — that's the daily ceiling.`,
        };
      }
      if (team.money < EXTRA_DUEL_COST) {
        return {
          kind: 'error',
          code: 'insufficient-funds',
          message: `Need $${EXTRA_DUEL_COST.toLocaleString()} for an extra slot — you have $${team.money.toLocaleString()}.`,
        };
      }
      team.money -= EXTRA_DUEL_COST;
      db.setTeamMoneyDay(team.id, team.money, team.day);
      const next = db.recordDuelExtraPurchased(team.id, today);
      const remaining = DAILY_DUEL_CAP + next.extra - next.used;
      log(`duel-cap: ${team.tag} bought slot #${next.extra} ($${EXTRA_DUEL_COST}) → ${remaining} left today`);
      return {
        kind: 'extra-duel-purchased',
        cost: EXTRA_DUEL_COST,
        newMoney: team.money,
        remaining,
        extra: next.extra,
      };
    }

    // ---------- Case opening ----------

    case 'list-cases': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const today = new Date().toISOString().slice(0, 10);
      const last = db.getFreeCaseDate(conn.teamId);
      const summaries: CaseSummary[] = CASES.map((c) => ({
        id: c.id,
        name: c.name,
        keyPrice: c.keyPrice,
        skinCount: c.skins.length,
        accent: c.accent,
      }));
      return {
        kind: 'case-list',
        cases: summaries,
        freeCaseId: DAILY_FREE_CASE_ID,
        freeCaseAvailable: last !== today,
      };
    }

    case 'open-case':
    case 'open-free-case': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const isFree = msg.kind === 'open-free-case';
      const caseId = isFree ? DAILY_FREE_CASE_ID : msg.caseId;
      const caseDef = CASES.find((c) => c.id === caseId);
      if (!caseDef) return { kind: 'error', code: 'no-case', message: 'Unknown case.' };
      const today = new Date().toISOString().slice(0, 10);
      let cost = 0;
      if (isFree) {
        if (db.getFreeCaseDate(team.id) === today) {
          return { kind: 'error', code: 'free-case-used', message: 'Daily free case already opened — come back tomorrow.' };
        }
        db.markFreeCaseClaim(team.id, today);
      } else {
        cost = caseDef.keyPrice;
        if (team.money < cost) {
          return { kind: 'error', code: 'insufficient-funds', message: `Need $${cost.toLocaleString()} for a key.` };
        }
        team.money -= cost;
        db.setTeamMoneyDay(team.id, team.money, team.day);
      }
      const rng = new RNG((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
      let counter = 0;
      const result = rollCaseOpen(caseDef, rng, today, () => `skin-${Date.now().toString(36)}-${(counter++).toString(36)}`);
      db.addSkin(team.id, result.instance.id, JSON.stringify(result.instance));
      log(`case(${caseId}): ${team.tag} ${isFree ? '[FREE]' : `-$${cost}`} → ${result.instance.weapon} ${result.instance.name} (${result.instance.rarity}, $${result.instance.marketValue})`);
      return {
        kind: 'case-opened',
        instance: result.instance as SkinInstanceWire,
        caseId,
        cost,
        newMoney: team.money,
        freeCase: isFree ? true : undefined,
        strip: result.strip.map((s) => ({ weapon: s.weapon, name: s.name, rarity: s.rarity as SkinInstanceWire['rarity'] })),
        winnerIndex: result.winnerIndex,
      };
    }

    case 'list-skins': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const skins = db.loadSkins(conn.teamId) as SkinInstance[];
      return { kind: 'skin-inventory', skins: skins as SkinInstanceWire[] };
    }

    case 'sell-skin': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const skin = db.loadSkin(conn.teamId, msg.skinId) as SkinInstance | null;
      if (!skin) return { kind: 'error', code: 'no-skin', message: 'Skin not in inventory.' };
      const payout = Math.max(0, Math.round(skin.marketValue));
      db.removeSkin(conn.teamId, msg.skinId);
      team.money += payout;
      db.setTeamMoneyDay(team.id, team.money, team.day);
      log(`skin sold: ${team.tag} +$${payout.toLocaleString()} (${skin.weapon} ${skin.name})`);
      return { kind: 'skin-sold', skinId: msg.skinId, payout, newMoney: team.money };
    }

    // ---------- Booster packs (gacha) ----------

    case 'list-boosts': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const cards = db.loadBoosts(conn.teamId) as BoostCard[];
      const players = db.loadTeamPlayers(conn.teamId);
      const activeByPlayer: Record<string, ActiveBoostWire> = {};
      for (const p of players) {
        if (p.activeBoost && p.activeBoost.duelsLeft > 0) {
          activeByPlayer[p.id] = {
            rarity: p.activeBoost.rarity,
            name: p.activeBoost.name,
            attrTargets: (p.activeBoost.attrTargets ?? LEGACY_BOOST_TARGETS) as BoostAttrKey[],
            attrBonus: p.activeBoost.attrBonus,
            duelsLeft: p.activeBoost.duelsLeft,
            appliedAt: p.activeBoost.appliedAt,
          };
        }
      }
      return { kind: 'boost-inventory', cards, activeByPlayer };
    }

    case 'buy-boost-pack': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      if (team.money < BOOST_PACK_COST) {
        return { kind: 'error', code: 'insufficient-funds', message: `Pack costs $${BOOST_PACK_COST.toLocaleString()} — you have $${team.money.toLocaleString()}.` };
      }
      team.money -= BOOST_PACK_COST;
      db.setTeamMoneyDay(team.id, team.money, team.day);
      const card = rollBoostCard();
      db.addBoost(team.id, card.id, card.rarity, JSON.stringify(card));
      log(`boost pack: ${team.tag} -$${BOOST_PACK_COST} → ${card.rarity} ${card.name} (+${card.attrBonus} attrs × ${card.duels} duel${card.duels === 1 ? '' : 's'})`);
      return { kind: 'boost-pack-opened', card, cost: BOOST_PACK_COST, newMoney: team.money };
    }

    case 'apply-boost': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const card = db.loadBoost(conn.teamId, msg.cardId) as BoostCard | null;
      if (!card) return { kind: 'error', code: 'no-card', message: 'Card not in inventory.' };
      const player = db.loadPlayer(msg.playerId);
      if (!player || player.teamId !== team.id) {
        return { kind: 'error', code: 'not-your-player', message: 'Player not on your roster.' };
      }
      if (player.activeBoost && player.activeBoost.duelsLeft > 0) {
        return { kind: 'error', code: 'already-boosted', message: `${player.nickname} already has an active boost (${player.activeBoost.duelsLeft} duel${player.activeBoost.duelsLeft === 1 ? '' : 's'} left).` };
      }
      player.activeBoost = {
        rarity: card.rarity,
        name: card.name,
        attrTargets: card.attrTargets,
        attrBonus: card.attrBonus,
        duelsLeft: card.duels,
        appliedAt: Date.now(),
      };
      db.persistPlayer(player);
      db.removeBoost(conn.teamId, msg.cardId);
      log(`boost applied: ${team.tag} ${player.nickname} ← ${card.rarity} ${card.name} (+${card.attrBonus} on ${card.attrTargets.join('+')}, ${card.duels} duels)`);
      return {
        kind: 'boost-applied',
        cardId: msg.cardId,
        playerId: msg.playerId,
        active: {
          rarity: card.rarity,
          name: card.name,
          attrTargets: card.attrTargets,
          attrBonus: card.attrBonus,
          duelsLeft: card.duels,
          appliedAt: player.activeBoost.appliedAt,
        },
      };
    }

    case 'discard-boost': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      if (!db.removeBoost(conn.teamId, msg.cardId)) {
        return { kind: 'error', code: 'no-card', message: 'Card not in inventory.' };
      }
      return { kind: 'boost-discarded', cardId: msg.cardId };
    }

    // ---------- Phase 3: match history ----------

    case 'list-history': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const rows = db.loadMatchesForTeam(conn.teamId, 25);
      const matches: MatchHistoryEntry[] = rows.map((r) => ({
        id: r.id,
        teamAId: r.team_a_id,
        teamBId: r.team_b_id,
        teamATag: r.team_a_tag,
        teamBTag: r.team_b_tag,
        winnerId: r.winner_id,
        mapsA: r.maps_a,
        mapsB: r.maps_b,
        stake: r.stake,
        kind: r.kind as 'ai' | 'pvp',
        playedAt: r.played_at,
      }));
      return { kind: 'history', matches };
    }

    case 'fetch-match': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const row = db.loadMatch(msg.matchId);
      if (!row) return { kind: 'error', code: 'no-match', message: 'Match not found.' };
      // Only let the participants fetch their own matches.
      if (row.team_a_id !== conn.teamId && row.team_b_id !== conn.teamId) {
        return { kind: 'error', code: 'forbidden', message: 'Match belongs to a different team.' };
      }
      const result = JSON.parse(row.result_json) as MatchResult;
      return { kind: 'match-detail', matchId: msg.matchId, result };
    }

    // ---------- Phase 4: tactics, lineup, leaderboard ----------

    case 'set-tactics': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      // Clamp slider fields server-side so a manipulated client can't push
      // attributes outside their engine-meaningful range.
      const t = msg.tactics ?? {};
      const clean: Partial<typeof t> = { ...t };
      const sliderKeys = ['aggression', 'utilityUsage', 'midRoundFlexibility', 'ecoDiscipline', 'forceBuyTendency'] as const;
      for (const k of sliderKeys) {
        if (typeof clean[k] === 'number') {
          clean[k] = Math.max(1, Math.min(20, Math.round(clean[k] as number)));
        }
      }
      db.setTeamTactics(team.id, clean);
      return { kind: 'tactics-saved', tactics: clean };
    }

    case 'reorder-lineup': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      // Must be a permutation of the existing roster — no adds/drops.
      const incoming = msg.playerIds;
      if (
        incoming.length !== team.playerIds.length ||
        new Set(incoming).size !== incoming.length ||
        !incoming.every((id) => team.playerIds.includes(id))
      ) {
        return { kind: 'error', code: 'invalid-lineup', message: 'Lineup must be a permutation of your current roster.' };
      }
      db.setTeamPlayers(team.id, incoming);
      return { kind: 'lineup-saved', playerIds: incoming };
    }

    case 'list-leaderboard': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const season = db.currentSeason();
      const rows = db.loadLeaderboard(season.seasonNo);
      const me = db.loadTeamStandings(season.seasonNo, conn.teamId);
      return { kind: 'leaderboard', season, rows, me };
    }

    // ---------- Phase 5: live replays ----------

    case 'fetch-live-replay': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const cached = getLiveReplay(msg.matchId);
      if (!cached) {
        return { kind: 'live-replay-expired', matchId: msg.matchId };
      }
      return { kind: 'live-replay', matchId: msg.matchId, result: cached };
    }

    // ---------- Phase 5: chat ----------

    case 'send-chat': {
      if (!conn.nickname) return { kind: 'error', code: 'no-session', message: 'Authenticate first.' };
      const text = msg.text.trim();
      if (!text) return null;
      const channel = msg.channel ?? 'global';
      // DM channels are only writable by the two parties — block strangers
      // from squeezing into a private convo.
      if (channel.startsWith('dm:') && (!conn.teamId || !isDmParticipant(channel, conn.teamId))) {
        return { kind: 'error', code: 'dm-forbidden', message: 'You are not a participant in this DM.' };
      }
      const tag = conn.teamId ? db.loadTeam(conn.teamId)?.tag : undefined;
      const stored = db.appendChatMessage(channel, conn.nickname, tag, text.slice(0, 280));
      broadcast({ kind: 'chat-message', message: stored });
      return null;
    }

    case 'fetch-chat-history': {
      const channel = msg.channel ?? 'global';
      // Same DM permission check on history reads.
      if (channel.startsWith('dm:') && (!conn.teamId || !isDmParticipant(channel, conn.teamId))) {
        return { kind: 'error', code: 'dm-forbidden', message: 'You are not a participant in this DM.' };
      }
      return { kind: 'chat-history', messages: db.loadChatHistory(channel, 100) };
    }

    // ---------- Phase 5: tournaments ----------

    case 'list-tournaments': {
      // Ensure the daily + themed recurring tournaments are always available.
      const spawnedDaily = ensureDailyTournament(db);
      if (spawnedDaily) broadcast({ kind: 'tournament-update', tournament: spawnedDaily });
      const spawnedThemed = ensureThemedTournament(db);
      if (spawnedThemed) broadcast({ kind: 'tournament-update', tournament: spawnedThemed });
      // Drive bracket execution from the periodic list call too, not just on
      // register. Otherwise a tournament whose final slot fills can sit idle
      // forever until someone else hits register on a different tournament.
      runReadyTournaments(db, (tid) => {
        const tournament = buildTournamentDetail(db, tid, null);
        broadcast({ kind: 'tournament-update', tournament });
        if (tournament.status === 'finished' && tournament.prizes && tournament.prizes.length > 0) {
          const champ = tournament.prizes.find((p) => p.placement === 1);
          if (champ) {
            const newsItem = db.publishNews(
              'tournament',
              `🏆 ${champ.teamTag} won ${tournament.name} — pocketed $${champ.cash.toLocaleString()}.`,
            );
            broadcast({ kind: 'news-item', item: newsItem as NewsItem });
          }
        }
      });
      const list = listTournaments(db, conn.teamId);
      return { kind: 'tournaments', list };
    }

    case 'fetch-tournament-detail': {
      // Lets the user view ANY tournament's bracket (open / in-progress /
      // finished), not just ones they registered for.
      const tournament = buildTournamentDetail(db, msg.tournamentId, conn.teamId ?? null);
      return { kind: 'tournament-detail', tournament };
    }

    case 'create-tournament': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const result = createTournament(db, msg.size, msg.entryFee);
      if (!result.ok) return { kind: 'error', code: 'create-failed', message: result.error };
      broadcast({ kind: 'tournament-update', tournament: result.tournament });
      log(`tournament created: ${result.tournament.id} size=${msg.size} fee=$${msg.entryFee}`);
      return { kind: 'tournament-detail', tournament: result.tournament };
    }

    // ---------- Phase 6: player goals + team logos ----------

    case 'set-player-goal': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team || !team.playerIds.includes(msg.playerId)) {
        return { kind: 'error', code: 'not-your-player', message: 'Player not on your roster.' };
      }
      const target = Math.max(1, Math.min(20, Math.round(msg.target)));
      const existing = db.loadGoalsForTeam(team.id).filter((g) => !g.reachedAt);
      const isReplacement = existing.some((g) => g.playerId === msg.playerId && g.attr === msg.attr);
      if (!isReplacement && existing.length >= MAX_OPEN_GOALS) {
        return { kind: 'error', code: 'too-many-goals', message: `Max ${MAX_OPEN_GOALS} open goals — finish or drop one first.` };
      }
      db.setGoal(msg.playerId, msg.attr, target);
      return { kind: 'player-goals', goals: db.loadGoalsForTeam(team.id) as PlayerGoal[] };
    }

    case 'clear-player-goal': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team || !team.playerIds.includes(msg.playerId)) {
        return { kind: 'error', code: 'not-your-player', message: 'Player not on your roster.' };
      }
      db.clearGoal(msg.playerId, msg.attr);
      return { kind: 'player-goals', goals: db.loadGoalsForTeam(team.id) as PlayerGoal[] };
    }

    case 'list-player-goals': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      return { kind: 'player-goals', goals: db.loadGoalsForTeam(conn.teamId) as PlayerGoal[] };
    }

    // ---------- Phase 7: tactics presets ----------

    case 'save-tactics-preset': {
      if (!conn.teamId || !conn.nickname) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const existing = db.loadPresetsForOwner(conn.nickname);
      if (existing.length >= MAX_TACTICS_PRESETS) {
        return { kind: 'error', code: 'too-many-presets', message: `Max ${MAX_TACTICS_PRESETS} presets — delete one first.` };
      }
      const name = msg.name.trim().slice(0, 32);
      if (!name) return { kind: 'error', code: 'bad-name', message: 'Preset name required.' };
      const id = `preset-${randomBytes(4).toString('hex')}`;
      // Snapshot whatever tactics the team currently has saved.
      db.savePreset(id, conn.nickname, name, team.tactics ?? {});
      return { kind: 'tactics-presets', presets: db.loadPresetsForOwner(conn.nickname) as TacticsPreset[] };
    }

    case 'list-tactics-presets': {
      if (!conn.nickname) return { kind: 'error', code: 'no-session', message: 'Authenticate first.' };
      return { kind: 'tactics-presets', presets: db.loadPresetsForOwner(conn.nickname) as TacticsPreset[] };
    }

    case 'apply-tactics-preset': {
      if (!conn.teamId || !conn.nickname) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const preset = db.loadPreset(msg.presetId);
      if (!preset || preset.ownerNick.toLowerCase() !== conn.nickname.toLowerCase()) {
        return { kind: 'error', code: 'no-preset', message: 'Preset not found or not yours.' };
      }
      db.setTeamTactics(conn.teamId, preset.tactics);
      return { kind: 'tactics-saved', tactics: preset.tactics };
    }

    case 'delete-tactics-preset': {
      if (!conn.nickname) return { kind: 'error', code: 'no-session', message: 'Authenticate first.' };
      db.removePreset(msg.presetId, conn.nickname);
      return { kind: 'tactics-presets', presets: db.loadPresetsForOwner(conn.nickname) as TacticsPreset[] };
    }

    // ---------- Phase 7: news ticker ----------

    case 'fetch-news': {
      return { kind: 'news-history', items: db.loadRecentNews(50) as NewsItem[] };
    }

    // ---------- Phase 7: team directory (for DM picker) ----------

    case 'list-online-teams': {
      // Surface every persisted team — small servers, so no pagination yet.
      // The DM picker filters out the requesting team's own entry.
      const teams = listAllTeamsCompact(db);
      return { kind: 'online-teams', teams };
    }

    // ---------- Phase 7: cross-server team export / import ----------

    case 'export-team': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const players = db.loadTeamPlayers(team.id);
      const payload = JSON.stringify({
        version: 7,
        team: {
          name: team.name,
          tag: team.tag,
          region: team.region,
          tactics: team.tactics,
        },
        players, // includes contract, attributes, etc.
        exportedAt: Date.now(),
      });
      return { kind: 'team-export', payload };
    }

    case 'import-team': {
      if (!conn.nickname) return { kind: 'error', code: 'no-session', message: 'Authenticate first.' };
      if (conn.teamId) return { kind: 'error', code: 'has-team', message: 'You already own a team.' };
      let parsed: { version?: number; team?: { name: string; tag: string; region: string; tactics?: object }; players?: Player[] };
      try { parsed = JSON.parse(msg.payload); }
      catch { return { kind: 'error', code: 'bad-payload', message: 'Invalid JSON.' }; }
      if (!parsed.team || !Array.isArray(parsed.players)) {
        return { kind: 'error', code: 'bad-shape', message: 'Export payload missing team or players.' };
      }
      // Fresh team id, fresh player ids — never trust the IDs from another server.
      const newTeam: TeamRow = {
        id: `team-${randomBytes(6).toString('hex')}`,
        name: parsed.team.name.slice(0, 32),
        tag: parsed.team.tag.slice(0, 6).toUpperCase(),
        region: parsed.team.region as TeamRow['region'],
        ownerNick: conn.nickname,
        money: STARTING_MONEY, // imported teams start with stock money — no economy abuse
        day: 1,
        createdAt: Date.now(),
        playerIds: [],
        tactics: (parsed.team.tactics ?? {}) as TeamRow['tactics'],
        bio: '',
        primaryColor: '#de9b35',
        twitchUrl: '',
        twitterUrl: '',
        youtubeUrl: '',
      };
      db.createTeam(newTeam);
      conn.teamId = newTeam.id;
      // Reassign player IDs to avoid collisions with any existing players.
      const remappedIds: string[] = [];
      for (const original of parsed.players) {
        const fresh: Player = {
          ...original,
          id: `${original.id}-${randomBytes(3).toString('hex')}`,
          teamId: newTeam.id,
          contract: original.contract ? { ...original.contract } : null,
        };
        db.savePlayer(fresh);
        remappedIds.push(fresh.id);
      }
      db.setTeamPlayers(newTeam.id, remappedIds);
      const finalTeam = db.loadTeam(newTeam.id)!;
      const onlineTeam = teamRowToOnline(finalTeam);
      log(`team imported: ${onlineTeam.tag} (${remappedIds.length} players) for ${conn.nickname}`);
      // News + team-imported reply.
      const newsItem = db.publishNews('other', `${onlineTeam.tag} imported by ${conn.nickname} (${remappedIds.length} players).`);
      broadcast({ kind: 'news-item', item: newsItem as NewsItem });
      return { kind: 'team-imported', team: onlineTeam };
    }

    // ---------- Phase 8: achievements + profile + loans ----------

    case 'list-achievements': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const entries = db.loadAchievements(conn.teamId).map((e) => ({
        ...e,
        label: ACHIEVEMENT_LABELS[e.kind] ?? e.kind,
      }));
      return { kind: 'achievements', entries };
    }

    case 'update-profile': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      db.updateTeamProfile(conn.teamId, msg.fields);
      const updated = db.loadTeam(conn.teamId);
      if (!updated) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      return { kind: 'profile-updated', team: teamRowToOnline(updated) };
    }

    case 'offer-loan': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      if (msg.toTeamId === conn.teamId) return { kind: 'error', code: 'self-loan', message: 'Cannot loan to yourself.' };
      const fromTeam = db.loadTeam(conn.teamId);
      const toTeam = db.loadTeam(msg.toTeamId);
      const player = db.loadPlayer(msg.playerId);
      if (!fromTeam || !toTeam) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      if (!player || player.teamId !== fromTeam.id) {
        return { kind: 'error', code: 'not-your-player', message: 'Player not on your roster.' };
      }
      const fee = Math.max(0, Math.round(msg.fee));
      const days = Math.max(1, Math.min(MAX_LOAN_DAYS, Math.round(msg.days)));
      if (fromTeam.playerIds.length <= 5) {
        return { kind: 'error', code: 'roster-floor', message: 'Need 6+ players to loan one out.' };
      }
      const id = `loan-${randomBytes(6).toString('hex')}`;
      db.createLoanOffer({ id, fromTeamId: fromTeam.id, toTeamId: toTeam.id, playerId: player.id, fee, days });
      const loanRecord = db.loadLoan(id)!;
      // Build the wire payload with display names.
      const payload = {
        ...loanRecord,
        fromTeamTag: fromTeam.tag,
        toTeamTag: toTeam.tag,
        playerNickname: player.nickname,
      };
      notifyTeam(toTeam.id, { kind: 'loan-event', loan: payload });
      log(`loan offered: ${fromTeam.tag} → ${toTeam.tag} (${player.nickname}, fee $${fee}, ${days}d)`);
      return { kind: 'loan-event', loan: payload };
    }

    case 'list-loan-offers': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const buildPayload = (raw: ReturnType<typeof db.loadLoansFromTeam>) =>
        raw.map((l) => {
          const fromT = db.loadTeam(l.fromTeamId);
          const toT = db.loadTeam(l.toTeamId);
          const p = db.loadPlayer(l.playerId);
          return {
            ...l,
            fromTeamTag: fromT?.tag ?? '???',
            toTeamTag: toT?.tag ?? '???',
            playerNickname: p?.nickname ?? l.playerId,
          };
        });
      return {
        kind: 'loan-offers',
        outgoing: buildPayload(db.loadLoansFromTeam(conn.teamId)),
        incoming: buildPayload(db.loadLoansToTeam(conn.teamId)),
      };
    }

    case 'accept-loan': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const loan = db.loadLoan(msg.loanId);
      if (!loan || loan.status !== 'pending') return { kind: 'error', code: 'no-loan', message: 'Loan not found.' };
      if (loan.toTeamId !== conn.teamId) return { kind: 'error', code: 'not-yours', message: 'Loan not offered to you.' };
      const borrower = db.loadTeam(conn.teamId);
      const lender = db.loadTeam(loan.fromTeamId);
      const player = db.loadPlayer(loan.playerId);
      if (!borrower || !lender || !player) return { kind: 'error', code: 'stale', message: 'Loan parties missing.' };
      if (borrower.money < loan.fee) {
        return { kind: 'error', code: 'insufficient-funds', message: `Need $${loan.fee.toLocaleString()} to cover the loan fee.` };
      }
      // Fee transfers, rosters swap, player gets temporary new home.
      borrower.money -= loan.fee;
      lender.money += loan.fee;
      lender.playerIds = lender.playerIds.filter((id) => id !== player.id);
      borrower.playerIds = [...borrower.playerIds, player.id];
      player.teamId = borrower.id;
      db.setTeamMoneyDay(borrower.id, borrower.money, borrower.day);
      db.setTeamMoneyDay(lender.id, lender.money, lender.day);
      db.setTeamPlayers(lender.id, lender.playerIds);
      db.setTeamPlayers(borrower.id, borrower.playerIds);
      db.persistPlayer(player);
      const endsAt = Date.now() + loan.days * 24 * 3600 * 1000;
      db.setLoanStatus(loan.id, 'active', endsAt);
      const payload = {
        ...loan, status: 'active' as const, endsAt,
        fromTeamTag: lender.tag, toTeamTag: borrower.tag, playerNickname: player.nickname,
      };
      notifyTeam(lender.id, { kind: 'loan-event', loan: payload });
      log(`loan accepted: ${lender.tag} → ${borrower.tag} (${player.nickname}, ends in ${loan.days}d)`);
      return { kind: 'loan-event', loan: payload };
    }

    case 'decline-loan': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const loan = db.loadLoan(msg.loanId);
      if (!loan || loan.status !== 'pending') return { kind: 'error', code: 'no-loan', message: 'Loan not found.' };
      if (loan.toTeamId !== conn.teamId) return { kind: 'error', code: 'not-yours', message: 'Loan not offered to you.' };
      db.setLoanStatus(loan.id, 'declined');
      const payload = { ...loan, status: 'declined' as const, fromTeamTag: '', toTeamTag: '', playerNickname: '' };
      notifyTeam(loan.fromTeamId, { kind: 'loan-event', loan: payload });
      return { kind: 'loan-event', loan: payload };
    }

    // ---------- Phase 9: HoF + coaches + sponsors ----------

    case 'list-hof': {
      return { kind: 'hof', entries: db.loadHallOfFame(50) };
    }

    case 'list-coaches': {
      ensureCoachPool(db);
      const open = db.loadOpenCoaches();
      const mine = conn.teamId ? db.loadHiredCoachFor(conn.teamId) : null;
      return { kind: 'coach-pool', openCoaches: open, myCoach: mine };
    }

    case 'hire-coach': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const coach = db.loadCoach(msg.coachId);
      if (!coach || coach.hiredByTeamId) {
        return { kind: 'error', code: 'no-coach', message: 'Coach not available.' };
      }
      const team = db.loadTeam(conn.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team missing.' };
      const existing = db.loadHiredCoachFor(team.id);
      if (existing) return { kind: 'error', code: 'has-coach', message: 'Fire your current coach first.' };
      // Upfront cost = 1 month wage as signing fee.
      if (team.money < coach.monthlyWage) {
        return { kind: 'error', code: 'insufficient-funds', message: `Need $${coach.monthlyWage.toLocaleString()} signing fee.` };
      }
      team.money -= coach.monthlyWage;
      db.setTeamMoneyDay(team.id, team.money, team.day);
      db.hireCoach(coach.id, team.id);
      log(`coach hired: ${team.tag} <- ${coach.name} (skill ${coach.skill})`);
      const updated = db.loadCoach(coach.id)!;
      return { kind: 'coach-hired', coach: updated };
    }

    case 'fire-coach': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const existing = db.loadHiredCoachFor(conn.teamId);
      if (!existing) return { kind: 'error', code: 'no-coach', message: 'No coach to fire.' };
      db.hireCoach(existing.id, null);
      return { kind: 'coach-pool', openCoaches: db.loadOpenCoaches(), myCoach: null };
    }

    case 'list-sponsors': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      return { kind: 'sponsors', offers: db.loadSponsorsForTeam(conn.teamId), paid: [] };
    }

    case 'respond-sponsor': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const sponsor = db.loadSponsor(msg.sponsorId);
      if (!sponsor || sponsor.teamId !== conn.teamId) {
        return { kind: 'error', code: 'no-sponsor', message: 'Sponsor not found.' };
      }
      db.setSponsorStatus(sponsor.id, msg.accept ? 'active' : 'declined');
      if (msg.accept) db.recordSponsorPaid(sponsor.id); // first payout on acceptance, next due in 30d
      const team = db.loadTeam(conn.teamId);
      if (msg.accept && team) {
        team.money += sponsor.monthlyAmount;
        db.setTeamMoneyDay(team.id, team.money, team.day);
      }
      return {
        kind: 'sponsors',
        offers: db.loadSponsorsForTeam(conn.teamId),
        paid: msg.accept ? [{ sponsorId: sponsor.id, amount: sponsor.monthlyAmount }] : [],
      };
    }

    case 'register-tournament': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const reg = registerForTournament(db, msg.tournamentId, conn.teamId);
      if (!reg.ok) return { kind: 'error', code: 'register-failed', message: reg.error };
      log(`tournament register: ${msg.tournamentId} <- ${conn.teamId}`);
      // If registration filled the bracket, run the whole thing instantly.
      runReadyTournaments(db, (tid) => {
        const tournament = buildTournamentDetail(db, tid, null);
        broadcast({ kind: 'tournament-update', tournament });
        if (tournament.status === 'finished' && tournament.prizes && tournament.prizes.length > 0) {
          const champ = tournament.prizes.find((p) => p.placement === 1);
          if (champ) {
            const newsItem = db.publishNews(
              'tournament',
              `🏆 ${champ.teamTag} win ${tournament.name} — $${champ.cash.toLocaleString()} prize.`,
            );
            broadcast({ kind: 'news-item', item: newsItem as NewsItem });
            tryUnlock(db, notifyTeam, champ.teamId, 'first_tournament', ACHIEVEMENT_LABELS.first_tournament);
          }
        }
      }, broadcast);
      const tournament = buildTournamentDetail(db, msg.tournamentId, conn.teamId);
      broadcast({ kind: 'tournament-update', tournament });
      return { kind: 'tournament-detail', tournament };
    }

    case 'buy-listed-player': {
      if (!conn.teamId) return { kind: 'error', code: 'no-team', message: 'No team.' };
      const listing = db.loadListing(msg.listingId);
      if (!listing) return { kind: 'error', code: 'no-listing', message: 'Listing not found.' };
      if (listing.sellerTeamId === conn.teamId) {
        return { kind: 'error', code: 'self-buy', message: 'Cannot buy your own listing.' };
      }
      const buyerTeam = db.loadTeam(conn.teamId);
      const sellerTeam = db.loadTeam(listing.sellerTeamId);
      const player = db.loadPlayer(listing.playerId);
      if (!buyerTeam || !sellerTeam || !player) {
        return { kind: 'error', code: 'stale-listing', message: 'Listing is stale (player or team gone).' };
      }
      if (buyerTeam.money < listing.askingPrice) {
        return { kind: 'error', code: 'insufficient-funds', message: `Need $${listing.askingPrice.toLocaleString()} — you have $${buyerTeam.money.toLocaleString()}.` };
      }
      // Execute the transfer atomically: money, rosters, player.teamId, listing.
      buyerTeam.money -= listing.askingPrice;
      sellerTeam.money += listing.askingPrice;
      sellerTeam.playerIds = sellerTeam.playerIds.filter((id) => id !== player.id);
      buyerTeam.playerIds = [...buyerTeam.playerIds, player.id];
      player.teamId = buyerTeam.id;
      db.setTeamMoneyDay(buyerTeam.id, buyerTeam.money, buyerTeam.day);
      db.setTeamMoneyDay(sellerTeam.id, sellerTeam.money, sellerTeam.day);
      db.setTeamPlayers(buyerTeam.id, buyerTeam.playerIds);
      db.setTeamPlayers(sellerTeam.id, sellerTeam.playerIds);
      db.persistPlayer(player);
      db.removeListing(msg.listingId);
      log(`market: ${buyerTeam.tag} bought ${player.nickname} from ${sellerTeam.tag} for $${listing.askingPrice.toLocaleString()}`);
      const newsItem = db.publishNews(
        'transfer',
        `${player.nickname} joins ${buyerTeam.tag} from ${sellerTeam.tag} for $${listing.askingPrice.toLocaleString()}.`,
      );
      broadcast({ kind: 'news-item', item: newsItem as NewsItem });
      // Seller bagged a market sale — gates the badge.
      tryUnlock(db, notifyTeam, sellerTeam.id, 'first_market_sale', ACHIEVEMENT_LABELS.first_market_sale);
      return { kind: 'market-bought', listingId: msg.listingId, player, cost: listing.askingPrice };
    }

    // ---------- Admin (gated by CSM_ADMIN_NICK env var) ----------

    case 'admin-list-users': {
      if (!isAdminConn(conn)) return { kind: 'error', code: 'forbidden', message: 'Admin only.' };
      const rows = db.listAllOwners().map((r) => ({
        nickname: r.nickname,
        teamId: r.team_id,
        teamTag: r.team_tag,
        teamName: r.team_name,
        region: (r.region ?? null) as Region | null,
        money: r.money,
        rosterSize: r.player_ids ? (JSON.parse(r.player_ids) as string[]).length : 0,
        createdAt: r.created_at,
      }));
      return { kind: 'admin-users', rows };
    }

    case 'admin-reset-pin': {
      if (!isAdminConn(conn)) return { kind: 'error', code: 'forbidden', message: 'Admin only.' };
      const target = msg.nickname.trim();
      const newPin = msg.newPin.trim();
      if (!target || !/^\d{4,8}$/.test(newPin)) {
        return { kind: 'error', code: 'bad-credentials', message: 'PIN must be 4-8 digits.' };
      }
      const ok = db.resetOwnerPin(target, newPin);
      if (!ok) return { kind: 'error', code: 'not-found', message: 'Nickname not registered.' };
      log(`admin(${conn.nickname}): reset PIN for ${target}`);
      return { kind: 'admin-pin-reset', nickname: target, newPin };
    }

    case 'admin-edit-team': {
      if (!isAdminConn(conn)) return { kind: 'error', code: 'forbidden', message: 'Admin only.' };
      const team = db.loadTeam(msg.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team not found.' };
      const f = msg.fields;
      if (typeof f.name === 'string') {
        const v = f.name.trim().slice(0, 32);
        if (v) db.adminEditTeamField(msg.teamId, 'name', v);
      }
      if (typeof f.tag === 'string') {
        const v = f.tag.trim().slice(0, 6).toUpperCase();
        if (v) db.adminEditTeamField(msg.teamId, 'tag', v);
      }
      if (typeof f.region === 'string') {
        const allowed: Region[] = ['Europe', 'CIS', 'Americas', 'Asia'];
        if (allowed.includes(f.region)) db.adminEditTeamField(msg.teamId, 'region', f.region);
      }
      log(`admin(${conn.nickname}): edited team ${msg.teamId} fields=${JSON.stringify(f)}`);
      return { kind: 'admin-team-edited', teamId: msg.teamId };
    }

    case 'admin-adjust-money': {
      if (!isAdminConn(conn)) return { kind: 'error', code: 'forbidden', message: 'Admin only.' };
      const team = db.loadTeam(msg.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team not found.' };
      const next = Math.max(0, Math.round(team.money + msg.delta));
      db.adminSetTeamMoney(msg.teamId, next);
      log(`admin(${conn.nickname}): adjusted ${team.tag} money by ${msg.delta} → $${next}${msg.note ? ' (' + msg.note + ')' : ''}`);
      // Push live update to the affected team if they're connected.
      notifyTeam(msg.teamId, { kind: 'team-money-updated', teamId: msg.teamId, money: next });
      return { kind: 'admin-team-edited', teamId: msg.teamId };
    }

    case 'admin-delete-team': {
      if (!isAdminConn(conn)) return { kind: 'error', code: 'forbidden', message: 'Admin only.' };
      const team = db.loadTeam(msg.teamId);
      if (!team) return { kind: 'error', code: 'no-team', message: 'Team not found.' };
      db.deleteTeamCascade(msg.teamId);
      log(`admin(${conn.nickname}): force-deleted team ${team.tag} (${msg.teamId})`);
      // Kick the deleted team's connected sockets back to the create-team flow.
      notifyTeam(msg.teamId, { kind: 'team-deleted-by-admin', teamId: msg.teamId });
      return { kind: 'admin-team-deleted', teamId: msg.teamId };
    }

    default:
      // exhaustiveness — TS will error here if a new ClientMessage kind is
      // added without a handler.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _exhaustive: never = msg;
      return { kind: 'error', code: 'unknown-kind', message: 'Unknown message.' };
  }
}
