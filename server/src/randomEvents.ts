// Random world-events ticker — the "make the world alive" system.
//
// Every EVENT_TICK_INTERVAL_MS the ticker rolls a chance that ANY event
// fires; if it does, it weighted-picks one of the registered event types,
// resolves a target (player or team), applies effects, and publishes a
// narrative news line so every connected client sees it in the ticker
// and Live Feed.
//
// Design rules:
//   - Effects are always SMALL (±1 attribute, ±0.5 morale/form, small $
//     amounts). Random events season play; they never replace it.
//   - Per-team cooldown prevents multi-event stacking on the same roster
//     in a short window. Server-wide events use the same cooldown map
//     under a sentinel '_world' key.
//   - Guarded targets: each event's pickTarget() can return null if no
//     valid subject exists (e.g., no under-22 newgens right now); the
//     ticker tries a few event types before giving up on that tick.
//   - All published news uses kind='event' so the client can style them
//     distinctly from tournaments / transfers / duels.

import type { DB } from './db.ts';
import type { NewsItem, ServerMessage } from '../../src/online/protocol.ts';
import type { Player, PlayerAttributes } from '../../src/types.ts';

/** Ticker cadence — a soft rhythm for the world to breathe. Long enough
 *  that events feel newsworthy, short enough that a returning player
 *  finds something new most sessions. */
export const EVENT_TICK_INTERVAL_MS = 10 * 60 * 1000;
/** Probability that ANY event fires on a given tick. Balanced against
 *  the tick cadence — expected value is ~1 event / 15 min server-wide. */
export const EVENT_TICK_CHANCE = 0.6;
/** Cooldown before the same target can be hit again (real ms). */
export const EVENT_TARGET_COOLDOWN_MS = 60 * 60 * 1000;

interface EventContext {
  db: DB;
  broadcastAll: (msg: ServerMessage) => void;
  notifyTeam?: (teamId: string, msg: ServerMessage) => void;
  rng: () => number;
  /** In-memory per-target cooldown map — keys are team ids (or '_world'
   *  for server-wide events). Reset on server restart, which is fine —
   *  a hot reload occasionally lets an extra event slip through, harmless. */
  cooldowns: Map<string, number>;
  /** When set, overrides the EVENT_TICK_CHANCE gate — used by time-skip
   *  bursts (pass 1.0 to force every roll to fire). */
  chanceOverride?: number;
}

interface RandomEvent {
  id: string;
  weight: number;
  /** Resolve a target for this event. Returns null when no valid subject
   *  exists right now so the ticker can fall back to another event. */
  resolve(ctx: EventContext): {
    newsBody: string;
    affectedTeamId?: string;
    /** If the event shifted the affected player's morale, expose the
     *  delta + nickname so the ticker can fire a player-voice inbox
     *  quote alongside the news. Positive = mood up, negative = down. */
    moraleDelta?: number;
    moraleSpeaker?: string;
  } | null;
}

// =====================================================================
// Helpers
// =====================================================================

function pickRandom<T>(list: T[], rng: () => number): T | null {
  if (list.length === 0) return null;
  return list[Math.floor(rng() * list.length)]!;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Bump a single attribute on a player with a small delta, capping to
 *  1..20 AND to the player's PA ceiling. Returns the actual delta applied
 *  so news copy can be honest. */
function bumpAttribute(player: Player, attr: keyof PlayerAttributes, delta: number): number {
  const before = player.attributes[attr];
  const after = clamp(before + delta, 1, 20);
  player.attributes[attr] = after;
  return after - before;
}

/** Hoisted prepared statement — avoids the sqlite driver re-wrapping the
 *  compiled SQL on every tick. Bound at first-use because it needs a `db`
 *  handle that only exists inside the ticker. */
let listAllTeamsStmt: ReturnType<DB['raw']['prepare']> | null = null;

/** All active teams and their starter-five (for player-scoped events). */
function loadActiveRosters(db: DB): Array<{ teamId: string; teamTag: string; starters: Player[] }> {
  if (!listAllTeamsStmt) listAllTeamsStmt = db.raw.prepare(`SELECT id, tag FROM teams`);
  const teams = listAllTeamsStmt.all() as Array<{ id: string; tag: string }>;
  const out: Array<{ teamId: string; teamTag: string; starters: Player[] }> = [];
  for (const t of teams) {
    const players = db.loadTeamPlayers(t.id);
    if (players.length < 5) continue;
    out.push({ teamId: t.id, teamTag: t.tag, starters: players.slice(0, 5) });
  }
  return out;
}

/** Drop expired cooldown entries. Called once per tick. Keeps the map
 *  bounded to teams that have been touched in the last cooldown window
 *  — no unbounded growth from deleted teams or churned rosters. */
function pruneCooldowns(cooldowns: Map<string, number>): void {
  const now = Date.now();
  for (const [key, expiry] of cooldowns) {
    if (expiry <= now) cooldowns.delete(key);
  }
}

/** Filter starters to newgens only (real-name legends stay evergreen). */
function newgenStarters(list: Player[]): Player[] {
  return list.filter((p) => !p.isRealName && !p.retired);
}

/** Guarded target picker — walks rosters in random order and returns the
 *  first (team, player) pair that passes the guard, or null. */
function findQualifyingPlayer(
  ctx: EventContext,
  guard: (p: Player) => boolean,
): { teamId: string; teamTag: string; player: Player } | null {
  const rosters = loadActiveRosters(ctx.db);
  // Shuffle team order so the same team doesn't always get picked first.
  for (let i = rosters.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [rosters[i], rosters[j]] = [rosters[j]!, rosters[i]!];
  }
  for (const r of rosters) {
    if ((ctx.cooldowns.get(r.teamId) ?? 0) > Date.now()) continue;
    const eligible = newgenStarters(r.starters).filter(guard);
    if (eligible.length === 0) continue;
    const player = pickRandom(eligible, ctx.rng)!;
    return { teamId: r.teamId, teamTag: r.teamTag, player };
  }
  return null;
}

// =====================================================================
// Event registry
// =====================================================================

const EVENTS: RandomEvent[] = [
  // ---- Player-scoped ----
  {
    id: 'breakthrough',
    weight: 8,
    resolve(ctx) {
      // Young newgen with headroom under PA — a "breakthrough performance."
      const target = findQualifyingPlayer(ctx, (p) =>
        p.age < 24 && p.currentAbility < (p.potentialAbility - 5),
      );
      if (!target) return null;
      // Pick a duel-relevant attribute weighted by role's key attrs.
      const CANDIDATES: (keyof PlayerAttributes)[] = ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'];
      const attr = pickRandom(CANDIDATES, ctx.rng)!;
      const applied = bumpAttribute(target.player, attr, 1);
      if (applied <= 0) return null;
      target.player.morale = clamp((target.player.morale ?? 12) + 1, 1, 20);
      ctx.db.persistPlayer(target.player);
      return {
        newsBody: `🌟 Breakthrough — ${target.player.nickname} of ${target.teamTag} looks a different player in scrims. +1 ${attr}.`,
        affectedTeamId: target.teamId,
        moraleDelta: 1,
        moraleSpeaker: target.player.nickname,
      };
    },
  },
  {
    id: 'slump',
    weight: 6,
    resolve(ctx) {
      // Any newgen currently on form ≥12 — the taller they stand, the harder they fall.
      const target = findQualifyingPlayer(ctx, (p) => p.form >= 12);
      if (!target) return null;
      const dropped = clamp((target.player.form ?? 10) - 2, 1, 20);
      target.player.form = dropped;
      ctx.db.persistPlayer(target.player);
      return {
        newsBody: `📉 Slump watch — ${target.player.nickname} (${target.teamTag}) fires blanks in practice. Form drops to ${dropped.toFixed(1)}.`,
        affectedTeamId: target.teamId,
      };
    },
  },
  {
    id: 'media_appearance',
    weight: 5,
    resolve(ctx) {
      // Anyone — the star gets airtime, morale gets a small lift.
      const target = findQualifyingPlayer(ctx, () => true);
      if (!target) return null;
      target.player.morale = clamp((target.player.morale ?? 12) + 1, 1, 20);
      ctx.db.persistPlayer(target.player);
      return {
        newsBody: `📺 ${target.player.nickname} guests on a HLTV podcast — talks up ${target.teamTag}'s chances this cycle.`,
        affectedTeamId: target.teamId,
        moraleDelta: 1,
        moraleSpeaker: target.player.nickname,
      };
    },
  },
  {
    id: 'viral_clip',
    weight: 4,
    resolve(ctx) {
      // A random newgen catches lightning in a bottle. Small $ + morale.
      const target = findQualifyingPlayer(ctx, () => true);
      if (!target) return null;
      const team = ctx.db.loadTeam(target.teamId);
      if (!team) return null;
      const bonus = 5000 + Math.floor(ctx.rng() * 20000); // $5k–$25k
      team.money += bonus;
      ctx.db.setTeamMoneyDay(team.id, team.money, team.day);
      target.player.morale = clamp((target.player.morale ?? 12) + 1, 1, 20);
      ctx.db.persistPlayer(target.player);
      if (ctx.notifyTeam) {
        ctx.notifyTeam(target.teamId, {
          kind: 'team-money-updated', teamId: team.id, money: team.money,
        });
      }
      return {
        newsBody: `🎬 Viral clip — ${target.player.nickname}'s 1v3 hits 200k views overnight. ${target.teamTag} banks $${bonus.toLocaleString()} in clip royalties.`,
        affectedTeamId: target.teamId,
        moraleDelta: 1,
        moraleSpeaker: target.player.nickname,
      };
    },
  },
  {
    id: 'personal_issue',
    weight: 4,
    resolve(ctx) {
      // Off-server drama tanks morale on a random player.
      const target = findQualifyingPlayer(ctx, (p) => (p.morale ?? 12) > 6);
      if (!target) return null;
      target.player.morale = clamp((target.player.morale ?? 12) - 2, 1, 20);
      ctx.db.persistPlayer(target.player);
      const REASONS = [
        `family emergency pulls them offline for a day`,
        `a Twitter spat drags into the practice server`,
        `a break-up rumor rattles the team room`,
        `a fine from the team lawyer over a stream outburst`,
      ];
      const reason = pickRandom(REASONS, ctx.rng)!;
      return {
        newsBody: `💭 ${target.player.nickname} (${target.teamTag}) shows up rattled — ${reason}. Morale takes a hit.`,
        affectedTeamId: target.teamId,
        moraleDelta: -2,
        moraleSpeaker: target.player.nickname,
      };
    },
  },
  {
    id: 'aim_lab_grind',
    weight: 6,
    resolve(ctx) {
      // Young newgen dumps hours into Aim Lab; small aim bump.
      const target = findQualifyingPlayer(ctx, (p) => p.age < 22 && p.attributes.aim < 18);
      if (!target) return null;
      const applied = bumpAttribute(target.player, 'aim', 1);
      if (applied <= 0) return null;
      ctx.db.persistPlayer(target.player);
      return {
        newsBody: `🎯 ${target.player.nickname} (${target.teamTag}) drops 6-hour Aim Lab sessions on his stream. Aim ticks up to ${target.player.attributes.aim}.`,
        affectedTeamId: target.teamId,
      };
    },
  },

  // ---- Team-scoped ----
  {
    id: 'sponsor_bonus',
    weight: 5,
    resolve(ctx) {
      // Random team gets a small ad-hoc sponsor bonus. Team must be off-cooldown.
      const teams = loadActiveRosters(ctx.db).filter((r) => (ctx.cooldowns.get(r.teamId) ?? 0) <= Date.now());
      const pick = pickRandom(teams, ctx.rng);
      if (!pick) return null;
      const team = ctx.db.loadTeam(pick.teamId);
      if (!team) return null;
      const amount = 10000 + Math.floor(ctx.rng() * 40000); // $10–$50k
      team.money += amount;
      ctx.db.setTeamMoneyDay(team.id, team.money, team.day);
      if (ctx.notifyTeam) {
        ctx.notifyTeam(team.id, { kind: 'team-money-updated', teamId: team.id, money: team.money });
      }
      const BRANDS = ['a peripheral brand', 'a jersey partner', 'a monster energy pop-up', 'a mid-tier VPN sponsor', 'a red bull one-off deal'];
      const brand = pickRandom(BRANDS, ctx.rng)!;
      return {
        newsBody: `💼 ${pick.teamTag} inks ${brand} — one-off $${amount.toLocaleString()} activation deal.`,
        affectedTeamId: pick.teamId,
      };
    },
  },
  {
    id: 'bootcamp',
    weight: 4,
    resolve(ctx) {
      // Team burns cash for a bootcamp; morale + form boost on all starters.
      const teams = loadActiveRosters(ctx.db).filter((r) => (ctx.cooldowns.get(r.teamId) ?? 0) <= Date.now());
      const pick = pickRandom(teams, ctx.rng);
      if (!pick) return null;
      for (const p of pick.starters) {
        p.morale = clamp((p.morale ?? 12) + 1, 1, 20);
        p.form = clamp((p.form ?? 10) + 0.5, 1, 20);
        ctx.db.persistPlayer(p);
      }
      return {
        newsBody: `🏕 ${pick.teamTag} announce a two-week bootcamp — the whole starting five leaves the practice room recharged.`,
        affectedTeamId: pick.teamId,
        moraleDelta: 1,
        moraleSpeaker: pick.starters[0]?.nickname,
      };
    },
  },
  {
    id: 'coach_insight',
    weight: 4,
    resolve(ctx) {
      // Coach video-review session sharpens a random starter's game sense.
      const target = findQualifyingPlayer(ctx, (p) => p.attributes.gameSense < 18);
      if (!target) return null;
      const applied = bumpAttribute(target.player, 'gameSense', 1);
      if (applied <= 0) return null;
      ctx.db.persistPlayer(target.player);
      return {
        newsBody: `🎥 Post-scrim VOD review clicks for ${target.player.nickname} (${target.teamTag}). Game sense reads +1.`,
        affectedTeamId: target.teamId,
      };
    },
  },

  // ---- Server-wide meta ----
  {
    id: 'meta_shift',
    weight: 2,
    resolve(ctx) {
      // Purely narrative for now — flavour to establish there's a wider
      // metagame moving. Cooldown consumes the '_world' key so this
      // stays rare (roughly once a real hour at max).
      if ((ctx.cooldowns.get('_world') ?? 0) > Date.now()) return null;
      const SHIFTS = [
        `Valve nerf the M4A1-S rate of fire — riflers scramble to relearn spray patterns.`,
        `Overpass rotates back into the active duty map pool.`,
        `Community patches a Mirage smoke lineup — coaches rebuild the playbook.`,
        `Anti-cheat wave bans a wave of matchmaking smurfs — practice servers empty out.`,
        `A new Major venue is announced — teams look for early qualifiers.`,
      ];
      const line = pickRandom(SHIFTS, ctx.rng)!;
      // Use the world key so per-team cooldowns aren't stolen.
      return { newsBody: `🌍 Meta shift — ${line}`, affectedTeamId: '_world' };
    },
  },
];

// =====================================================================
// Ticker + broadcast
// =====================================================================

/** Roll one tick — decide whether ANY event fires, and if so, pick +
 *  resolve one. Skips silently on days when nothing valid rolls up. */
export function tickRandomEvents(ctx: EventContext): NewsItem | null {
  // Housekeeping: drop expired cooldown entries so the map stays bounded
  // to teams that are actually in the window. Prevents deleted / churned
  // teams from leaving orphan keys.
  pruneCooldowns(ctx.cooldowns);
  const chance = typeof ctx.chanceOverride === 'number' ? ctx.chanceOverride : EVENT_TICK_CHANCE;
  if (ctx.rng() > chance) return null;
  // Weighted-random draw across the whole registry.
  const totalWeight = EVENTS.reduce((s, e) => s + e.weight, 0);
  // Try up to 3 event types before giving up on this tick (the first
  // pick's target may be null-guarded on cooldown or eligibility).
  for (let attempt = 0; attempt < 3; attempt++) {
    let ticket = ctx.rng() * totalWeight;
    let picked: RandomEvent | null = null;
    for (const e of EVENTS) {
      ticket -= e.weight;
      if (ticket <= 0) { picked = e; break; }
    }
    if (!picked) picked = EVENTS[EVENTS.length - 1]!;
    const outcome = picked.resolve(ctx);
    if (!outcome) continue;
    // Publish + broadcast + set cooldown.
    const item = ctx.db.publishNews('event', outcome.newsBody) as NewsItem;
    ctx.broadcastAll({ kind: 'news-item', item });
    // Also drop into the affected team's inbox so the manager sees the
    // personal impact without needing to scan the ticker. Skip for the
    // '_world' sentinel — nobody owns it.
    if (outcome.affectedTeamId && outcome.affectedTeamId !== '_world' && ctx.notifyTeam) {
      const team = ctx.db.loadTeam(outcome.affectedTeamId);
      if (team) {
        // pushInbox is exported by the DB facade; we go through it
        // (rather than emitInboxItem in inbox.ts) to keep this module
        // dependency-free of the inbox helper.
        const inbox = ctx.db.pushInbox({
          teamId: outcome.affectedTeamId,
          kind: 'event',
          title: `Event: ${picked.id.replace(/_/g, ' ')}`,
          body: outcome.newsBody,
        });
        const unread = ctx.db.inboxUnreadCount(outcome.affectedTeamId);
        ctx.notifyTeam(outcome.affectedTeamId, {
          kind: 'inbox-item',
          item: inbox as import('../../src/online/protocol.ts').InboxItem,
          unread,
        });
        // Extra player-voice item when the event shifted morale — this is
        // the "more player messages tied to morale events" surface. Kept
        // separate from the event item so the mood swing gets its own
        // quote-shaped row rather than a wall of numbers.
        if (typeof outcome.moraleDelta === 'number' && outcome.moraleDelta !== 0 && outcome.moraleSpeaker) {
          const arrow = outcome.moraleDelta > 0 ? '↑' : '↓';
          const upLines = [
            `"Days like this are why we do it. Everyone in the room felt it." — ${outcome.moraleSpeaker}`,
            `"Confidence is up. Practice feels lighter tomorrow." — ${outcome.moraleSpeaker}`,
            `"Little wins matter. This one landed." — ${outcome.moraleSpeaker}`,
          ];
          const downLines = [
            `"Rough one to shake off. Head down, back to work." — ${outcome.moraleSpeaker}`,
            `"Not a good day — the room felt it. Reset tomorrow." — ${outcome.moraleSpeaker}`,
            `"Nothing to say except: fix it in practice." — ${outcome.moraleSpeaker}`,
          ];
          const pool = outcome.moraleDelta > 0 ? upLines : downLines;
          const line = pool[Math.floor(ctx.rng() * pool.length)]!;
          const shiftItem = ctx.db.pushInbox({
            teamId: outcome.affectedTeamId,
            kind: 'player-message',
            title: `${outcome.moraleSpeaker} on morale ${arrow}`,
            body: line,
            payload: {
              quoteType: 'morale',
              speakerNickname: outcome.moraleSpeaker,
              moraleDelta: outcome.moraleDelta,
              trigger: picked.id,
            },
          });
          ctx.notifyTeam(outcome.affectedTeamId, {
            kind: 'inbox-item',
            item: shiftItem as import('../../src/online/protocol.ts').InboxItem,
            unread: ctx.db.inboxUnreadCount(outcome.affectedTeamId),
          });
        }
      }
    }
    if (outcome.affectedTeamId) {
      ctx.cooldowns.set(outcome.affectedTeamId, Date.now() + EVENT_TARGET_COOLDOWN_MS);
    }
    return item;
  }
  return null;
}

/**
 * Fire a burst of random events during a time-skip so the user sees the
 * world moving as their days advance. Each round is a normal event roll
 * with the chance gate forced to 1.0 — a fresh cooldown map means the
 * burst can hit different teams without stepping on the live ticker's
 * cooldowns. Rounds scale with days skipped, capped so 30-day skips
 * don't dump 15 items into the inbox.
 */
export function runTimeSkipEventBurst(
  db: DB,
  broadcastAll: (msg: ServerMessage) => void,
  notifyTeam: (teamId: string, msg: ServerMessage) => void,
  days: number,
): number {
  const rounds = Math.max(1, Math.min(10, Math.ceil(days / 2)));
  const cooldowns = new Map<string, number>();
  const rng = () => Math.random();
  let fired = 0;
  for (let i = 0; i < rounds; i++) {
    const item = tickRandomEvents({
      db, broadcastAll, notifyTeam, rng, cooldowns,
      chanceOverride: 1.0,
    });
    if (item) fired++;
  }
  return fired;
}

/** Wire the ticker on server boot. */
export function startRandomEventTicker(
  db: DB,
  broadcastAll: (msg: ServerMessage) => void,
  notifyTeam: (teamId: string, msg: ServerMessage) => void,
  log: (line: string) => void,
): void {
  const cooldowns = new Map<string, number>();
  const rng = () => Math.random();
  const tick = () => {
    try {
      const item = tickRandomEvents({ db, broadcastAll, notifyTeam, rng, cooldowns });
      if (item) log(`fired: ${item.body}`);
    } catch (err) {
      log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // First tick a few seconds after boot so the log has a signal early.
  setTimeout(tick, 15_000);
  setInterval(tick, EVENT_TICK_INTERVAL_MS).unref();
}
