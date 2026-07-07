// Daily race — periodic rollover ticker + rollover logic.
//
// Two boards run in parallel: Points Race (MMR gained since UTC midnight)
// and Money Race (cumulative positive money deltas since UTC midnight).
// Every 5 min the ticker checks whether the current UTC date has moved
// past the last-rolled date. If so:
//   1. Snapshot yesterday's final boards
//   2. Pay top 3 on each (or fewer if fewer than 3 teams scored)
//   3. Record payout rows (idempotent — PK on date+kind+rank)
//   4. Refresh snapshots for the new day so today's baseline is clean
//
// Payouts are additive to team.money and go through setTeamMoneyDay so
// the winner's money gain also counts toward TODAY's Money Race. That's
// a feature, not a bug — winning yesterday's race gives you a small
// head start on today's.

import type { DB } from './db.ts';
import { utcDateKey } from './db.ts';
import type { ServerMessage } from '../../src/online/protocol.ts';

/** Payout schedule per race, in dollars. Points + Money are the flagship
 *  boards and pay the biggest prizes. Sportsbook / Cases / Mini Games are
 *  activity-specific and pay smaller amounts so the daily cash injection
 *  from the ticker stays reasonable across five simultaneous boards. */
const FLAGSHIP_PAYOUTS = [500_000, 250_000, 100_000] as const;
const ACTIVITY_PAYOUTS = [200_000, 100_000, 40_000] as const;

/** Ordered list of every board the rollover pays out on. */
const BOARD_CONFIGS = [
  { kind: 'points',    payouts: FLAGSHIP_PAYOUTS },
  { kind: 'money',     payouts: FLAGSHIP_PAYOUTS },
  { kind: 'sportsbook', payouts: ACTIVITY_PAYOUTS },
  { kind: 'cases',     payouts: ACTIVITY_PAYOUTS },
  { kind: 'mini_games', payouts: ACTIVITY_PAYOUTS },
] as const;

type RaceKind = typeof BOARD_CONFIGS[number]['kind'];

/** How many top rows to show on the client leaderboard. */
export const DAILY_RACE_BOARD_LIMIT = 20;

export interface DailyRaceTickerDeps {
  notifyTeam: (teamId: string, msg: ServerMessage) => void;
  broadcastAll: (msg: ServerMessage) => void;
  log: (line: string) => void;
}

/** Run once on boot: make sure today has snapshot rows for every team,
 *  and pay out any missed rollover from a previous day (if the server
 *  was offline across midnight). */
export function initDailyRaceOnBoot(db: DB, deps: DailyRaceTickerDeps): void {
  const today = utcDateKey();
  // Roll over any dates strictly before today that haven't been paid.
  // We only look back up to 7 days — if the server was off longer than
  // that, the older days are silently dropped (no data to compute deltas
  // against reliably; teams' MMR may have already moved on).
  for (let i = 7; i >= 1; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = utcDateKey(d);
    if (!db.dailyRaceRolled(key)) {
      rolloverOneDay(db, key, deps);
    }
  }
  // Seed today's snapshot so brand-new deploys have a valid baseline.
  db.snapshotAllTeamsForDate(today);
}

/** Wire up the periodic rollover check. Fires every 5 min. */
export function startDailyRaceTicker(db: DB, deps: DailyRaceTickerDeps): void {
  const check = () => {
    try {
      const today = utcDateKey();
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      const yesterday = utcDateKey(d);
      if (!db.dailyRaceRolled(yesterday)) {
        rolloverOneDay(db, yesterday, deps);
      }
      // Also make sure today has a snapshot (covers freshly-created teams).
      db.snapshotAllTeamsForDate(today);
    } catch (err) {
      deps.log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // Immediate check on startup, then every 5 minutes.
  check();
  setInterval(check, 5 * 60 * 1000).unref();
}

/** Freeze a date's boards, pay the top 3 on each, notify winners. */
function rolloverOneDay(db: DB, dateUtc: string, deps: DailyRaceTickerDeps): void {
  const all = db.loadDailyRaceBoards(dateUtc, Math.max(FLAGSHIP_PAYOUTS.length, ACTIVITY_PAYOUTS.length));
  const boardByKind: Record<RaceKind, typeof all.pointsBoard> = {
    points: all.pointsBoard,
    money: all.moneyBoard,
    sportsbook: all.sportsbookBoard,
    cases: all.casesBoard,
    mini_games: all.miniGamesBoard,
  };
  const paid: string[] = [];
  for (const cfg of BOARD_CONFIGS) {
    const board = boardByKind[cfg.kind];
    for (let i = 0; i < board.length && i < cfg.payouts.length; i++) {
      const entry = board[i];
      const amount = cfg.payouts[i];
      const team = db.loadTeam(entry.team_id);
      if (!team) continue;
      // Additive to team.money — routed through setTeamMoneyDay so the
      // gain also boosts today's Money Race (small head-start reward).
      team.money += amount;
      db.setTeamMoneyDay(team.id, team.money, team.day);
      db.recordDailyRacePayout({
        dateUtc, raceKind: cfg.kind, rank: i + 1,
        teamId: team.id, amount, valueDelta: entry.delta,
      });
      deps.notifyTeam(team.id, {
        kind: 'daily-race-payout',
        raceKind: cfg.kind,
        rank: i + 1,
        amount,
        valueDelta: entry.delta,
        dateUtc,
        newMoney: team.money,
      });
      deps.notifyTeam(team.id, { kind: 'team-money-updated', teamId: team.id, money: team.money });
      paid.push(`${team.tag}(#${i + 1} ${cfg.kind}, $${amount.toLocaleString()})`);
    }
  }
  if (paid.length > 0) {
    deps.log(`rollover ${dateUtc}: ${paid.join(', ')}`);
    deps.broadcastAll({ kind: 'daily-race-rolled', dateUtc });
  } else {
    deps.log(`rollover ${dateUtc}: no winners (empty boards)`);
    // Still insert a sentinel payout at rank 0 so the idempotency check
    // recognises the date as rolled. Use kind='points' rank=0 with $0.
    db.recordDailyRacePayout({
      dateUtc, raceKind: 'points', rank: 0,
      teamId: '_none', amount: 0, valueDelta: 0,
    });
  }
}
