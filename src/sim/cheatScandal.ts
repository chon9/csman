// VAC / cheat allegation multi-stage arc.
//
// Once or twice per year, a tier-1 player gets caught up in a public cheating
// allegation. The story plays out in two beats:
//
//   1. ALLEGATION (today)     — investigation begins. Player still eligible
//      but the squad takes a morale hit. Inbox + news feed light up.
//   2. VERDICT (7-21 days)    — either cleared (50%) or banned (1-6 weeks).
//                               Cleared = morale rebound. Banned = roster
//                               crisis, sponsor pressure, ban from matches.
//
// Affects user team specifically when the accused is one of their players;
// otherwise it's atmospheric world news that occasionally lets the user
// scoop up a banned star's old team for a free win on the schedule.

import { RNG } from '../engine/rng';
import type { CheatScandal, GameState, Player } from '../types';

let nextScandalId = 1;

const ALLEGATION_TEMPLATES = [
  (n: string) => `Demo review accuses ${n} of suspicious crosshair placement — investigation opens`,
  (n: string) => `${n} flagged by anti-cheat audit after VAC patch — under review`,
  (n: string) => `Anonymous tip alleges ${n} used aim assistance in recent qualifier`,
  (n: string) => `Tournament organisers freeze ${n}'s match comms pending investigation`,
  (n: string) => `${n}'s last LAN demos pulled for forensic review by ESIC`,
];

const CLEARED_TEMPLATES = [
  (n: string) => `${n} cleared of all allegations after forensic review — vindicated`,
  (n: string) => `Investigation closed: ${n}'s gameplay logs show no manipulation`,
  (n: string) => `ESIC drops case against ${n} — no evidence of wrongdoing`,
];

const BANNED_TEMPLATES = [
  (n: string, w: number) => `${n} banned for ${w} weeks — anti-cheat caught suspicious config edits`,
  (n: string, w: number) => `ESIC suspends ${n} (${w} weeks) — demos confirm aim macro use`,
  (n: string, w: number) => `${n}: ${w}-week competitive ban for confirmed VAC trip`,
];

/** Roll once per month for a new allegation. ~30% per monthly tick = ~3/year. */
export function rollCheatAllegation(g: GameState, today: string, rng: RNG): CheatScandal | null {
  if (!rng.chance(0.30)) return null;
  // Pick a notable player — investigations target tier-1 names, not journeymen.
  const pool = Object.values(g.players).filter((p) => {
    if (!p.teamId) return false;
    if (p.currentAbility < 140) return false; // tier-1-ish only
    // Skip players already in an active scandal.
    return !(g.cheatScandals ?? []).some((s) => s.playerId === p.id && s.status === 'investigating');
  });
  if (!pool.length) return null;
  const accused: Player = rng.pick(pool);
  // Investigation runs 7-21 days.
  const verdictOn = addDaysLocal(today, rng.int(7, 21));
  const headline = rng.pick(ALLEGATION_TEMPLATES)(accused.nickname);
  const scandal: CheatScandal = {
    id: `scandal-${today}-${nextScandalId++}`,
    playerId: accused.id,
    allegedOn: today,
    verdictOn,
    status: 'investigating',
    headline,
  };

  // Squad morale dip — the whole team carries the cloud.
  if (accused.teamId) {
    const team = g.teams[accused.teamId];
    if (team) {
      for (const pid of team.playerIds) {
        const p = g.players[pid];
        if (p) p.morale = Math.max(1, p.morale - 1.5);
      }
    }
  }
  return scandal;
}

/**
 * Daily tick — deliver verdicts on investigations whose verdictOn has arrived,
 * and clear expired bans. Returns scandals whose status changed so the caller
 * can post inbox + news entries.
 */
export function processCheatScandals(
  g: GameState,
  today: string,
  rng: RNG,
): { resolved: CheatScandal[]; banLifted: CheatScandal[] } {
  const resolved: CheatScandal[] = [];
  const banLifted: CheatScandal[] = [];
  for (const s of g.cheatScandals ?? []) {
    if (s.status === 'investigating' && today >= s.verdictOn) {
      const p = g.players[s.playerId];
      // 50/50 verdict — lean to cleared if the player has elite consistency
      // (longstanding pros rarely get rolled when there's no evidence).
      const guiltyChance = p ? Math.max(0.25, 0.55 - p.attributes.consistency / 80) : 0.5;
      if (rng.chance(guiltyChance)) {
        const weeks = rng.int(2, 12);
        s.status = 'banned';
        s.banUntil = addDaysLocal(today, weeks * 7);
        s.headline = rng.pick(BANNED_TEMPLATES)(p?.nickname ?? 'Player', weeks);
        // Roster fallout: team morale tanks, sponsor pressure on the user
        // team specifically (other teams just eat the news).
        if (p?.teamId) {
          const team = g.teams[p.teamId];
          if (team) {
            for (const pid of team.playerIds) {
              const tp = g.players[pid];
              if (tp) tp.morale = Math.max(1, tp.morale - 2);
            }
            // Sponsor income pressure when the user club is hit — visible as
            // a small budget penalty (PR scramble + bonus claw-backs).
            if (team.isUser) team.budget = Math.max(0, team.budget - 80_000);
          }
        }
      } else {
        s.status = 'cleared';
        s.headline = rng.pick(CLEARED_TEMPLATES)(p?.nickname ?? 'Player');
        // Morale rebound for the squad — vindication.
        if (p?.teamId) {
          const team = g.teams[p.teamId];
          if (team) {
            for (const pid of team.playerIds) {
              const tp = g.players[pid];
              if (tp) tp.morale = Math.min(20, tp.morale + 1);
            }
          }
        }
      }
      resolved.push(s);
    } else if (s.status === 'banned' && s.banUntil && today >= s.banUntil) {
      // Ban served — quietly re-eligible. Old scandal kept in history.
      banLifted.push(s);
    }
  }
  // Keep last 20 scandals on file for storyline references.
  g.cheatScandals = (g.cheatScandals ?? []).slice(-20);
  return { resolved, banLifted };
}

/** True if the player is currently serving a competitive ban (cannot be
 *  selected for matches). UI gating + match-engine eligibility use this. */
export function isPlayerBanned(g: GameState, playerId: string, today: string): boolean {
  return (g.cheatScandals ?? []).some(
    (s) => s.playerId === playerId && s.status === 'banned' && (!s.banUntil || today < s.banUntil),
  );
}

function addDaysLocal(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
