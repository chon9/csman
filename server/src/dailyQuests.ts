// Daily quests + login streak.
//
// One quest pool, three difficulties. At each UTC day rollover the server
// rolls a fresh trio (1 easy + 1 medium + 1 hard) for every team that asks
// — generation is lazy + idempotent (keyed by team_id + utc_date so the
// roll for a given day is stable).
//
// Progress bumps from gameplay handlers (PvP win, case open, stream, etc.)
// flow through bumpQuestProgress, which writes to whichever active quest
// kind matches. Reward claim hits claim-quest; bonus-on-all-done hits
// claim-all-done-bonus; both check the row's claimed_at to be idempotent.
//
// Login streak: increments by 1 when a team claims their first quest on
// a UTC day that's exactly one day after their previous streak day. Skip
// a day and the streak resets to 1 on the next claim. Streak multiplier
// (1.0 → 2.0 over 14 days) applies to every quest reward.

import { randomBytes } from 'node:crypto';
import { RNG, hashSeed } from '../../src/engine/rng.ts';
import {
  QUEST_ALL_DONE_BONUS,
  QUEST_REWARD,
  questStreakMultiplier,
  type DailyQuest,
  type QuestDifficulty,
  type QuestSnapshot,
} from '../../src/online/protocol.ts';
import type { DB } from './db.ts';

interface QuestTemplate {
  kind: string;
  difficulty: QuestDifficulty;
  target: number;
  label: (target: number) => string;
}

/** Pool the day-roll picks from. Spread across game systems so the user
 *  bounces between PvP, cases, streaming, mini-games, market. */
export const QUEST_POOL: QuestTemplate[] = [
  // ----- Easy (1.0× cost effort) -----
  { kind: 'ai_wins', difficulty: 'easy', target: 1, label: () => 'Win 1 AI duel' },
  { kind: 'cases_opened', difficulty: 'easy', target: 1, label: () => 'Open 1 case' },
  { kind: 'streams_done', difficulty: 'easy', target: 2, label: (t) => `Stream ${t} times` },
  { kind: 'dragon_gate_plays', difficulty: 'easy', target: 3, label: (t) => `Play ${t} Dragon Gate rounds` },
  { kind: 'skin_buys', difficulty: 'easy', target: 1, label: () => 'Buy a skin off the peer market' },
  { kind: 'crash_plays', difficulty: 'easy', target: 2, label: (t) => `Launch ${t} Crash rounds` },

  // ----- Medium -----
  { kind: 'pvp_wins', difficulty: 'medium', target: 2, label: (t) => `Win ${t} PvP duels` },
  { kind: 'ai_wins', difficulty: 'medium', target: 3, label: (t) => `Win ${t} AI duels` },
  { kind: 'cases_opened', difficulty: 'medium', target: 5, label: (t) => `Open ${t} cases` },
  { kind: 'streams_done', difficulty: 'medium', target: 5, label: (t) => `Stream ${t} times` },
  { kind: 'crash_cashouts', difficulty: 'medium', target: 2, label: (t) => `Cash out ${t} Crash rounds` },
  { kind: 'contracts_renewed', difficulty: 'medium', target: 1, label: () => 'Renew a player contract' },
  { kind: 'free_agent_signs', difficulty: 'medium', target: 1, label: () => 'Sign a free agent' },
  { kind: 'market_buys', difficulty: 'medium', target: 1, label: () => 'Buy a player off the transfer market' },
  { kind: 'market_sells', difficulty: 'medium', target: 1, label: () => 'Sell a player on the transfer market' },
  { kind: 'skin_sells', difficulty: 'medium', target: 1, label: () => 'Sell a skin on the peer market' },

  // ----- Hard -----
  { kind: 'pvp_wins', difficulty: 'hard', target: 5, label: (t) => `Win ${t} PvP duels` },
  { kind: 'streams_done', difficulty: 'hard', target: 10, label: (t) => `Stream ${t} times` },
  { kind: 'cases_opened', difficulty: 'hard', target: 15, label: (t) => `Open ${t} cases` },
  { kind: 'mines_clears', difficulty: 'hard', target: 1, label: () => 'Clear an entire Mines board' },
  { kind: 'crash_cashouts_5x', difficulty: 'hard', target: 1, label: () => 'Cash out Crash at 5×+' },
  { kind: 'underdog_pvp', difficulty: 'hard', target: 1, label: () => 'Win a PvP against a higher-CA team' },
];

/** UTC date in YYYY-MM-DD — keys quests + streak per day. */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function utcDateNDaysBefore(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Pick today's quest trio for a team. Deterministic per team+date so the
 *  same team rolling twice the same day gets the same set. */
function rollQuestsFor(teamId: string, utcDate: string, streak: number): DailyQuest[] {
  const rng = new RNG(hashSeed(`quests-${teamId}-${utcDate}`));
  const mult = questStreakMultiplier(streak);
  const out: DailyQuest[] = [];
  for (const diff of ['easy', 'medium', 'hard'] as const) {
    const pool = QUEST_POOL.filter((q) => q.difficulty === diff);
    if (pool.length === 0) continue;
    const t = pool[rng.int(0, pool.length - 1)]!;
    out.push({
      id: `q-${randomBytes(4).toString('hex')}`,
      kind: t.kind,
      label: t.label(t.target),
      difficulty: t.difficulty,
      target: t.target,
      progress: 0,
      reward: Math.round(QUEST_REWARD[t.difficulty] * mult),
      claimedAt: null,
    });
  }
  return out;
}

/** Ensure today's quests exist for `teamId`. Returns the current snapshot
 *  including streak + all-done-bonus state. Idempotent — safe to call on
 *  every list-quests + every progress bump. */
export function ensureTodayQuests(db: DB, teamId: string): QuestSnapshot {
  const utcDate = utcToday();
  const existing = db.loadDailyQuests(teamId, utcDate);
  const streak = db.getLoginStreak(teamId);
  const streakMult = questStreakMultiplier(streak);

  if (existing.length === 0) {
    const fresh = rollQuestsFor(teamId, utcDate, streak);
    for (const q of fresh) {
      db.insertDailyQuest({
        id: q.id,
        teamId,
        utcDate,
        kind: q.kind,
        label: q.label,
        difficulty: q.difficulty,
        target: q.target,
        reward: q.reward,
      });
    }
    return {
      utcDate,
      quests: fresh,
      loginStreak: streak,
      streakMult,
      allDoneBonusClaimed: false,
      allDoneBonus: Math.round(QUEST_ALL_DONE_BONUS * streakMult),
    };
  }

  const allClaimed = existing.every((q) => q.claimedAt !== null);
  const bonusClaimed = db.getAllDoneBonusDate(teamId) === utcDate;
  return {
    utcDate,
    quests: existing,
    loginStreak: streak,
    streakMult,
    allDoneBonusClaimed: bonusClaimed || (!allClaimed && false),
    allDoneBonus: Math.round(QUEST_ALL_DONE_BONUS * streakMult),
  };
}

/** Increment progress on every active quest whose kind matches. Returns
 *  the list of newly-completed quests (caller may want to fire a toast).
 *  Safe to spam — capped at the target. */
export function bumpQuestProgress(db: DB, teamId: string, kind: string, amount = 1): void {
  if (amount <= 0) return;
  ensureTodayQuests(db, teamId);
  db.bumpDailyQuestProgress(teamId, utcToday(), kind, amount);
}

/** Update the login streak when the user claims their first quest of the
 *  day. Returns the new streak count. */
export function tickLoginStreak(db: DB, teamId: string): number {
  const utcDate = utcToday();
  const lastDate = db.getLastStreakDate(teamId);
  if (lastDate === utcDate) {
    // Already ticked today — no change.
    return db.getLoginStreak(teamId);
  }
  const yesterday = utcDateNDaysBefore(utcDate, 1);
  const newStreak = lastDate === yesterday ? db.getLoginStreak(teamId) + 1 : 1;
  db.setLoginStreak(teamId, newStreak, utcDate);
  return newStreak;
}
