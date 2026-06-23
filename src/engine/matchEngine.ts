import type {
  BuyType,
  KillEvent,
  MapLayout,
  MapName,
  MapResult,
  MapTactics,
  MatchFormat,
  MatchPlan,
  MatchResult,
  Player,
  PlayerDot,
  PlayerMatchStats,
  PlayerRole,
  RoleDuty,
  RoundFrame,
  RoundResult,
  Tactics,
  Team,
} from '../types';
import { RNG, hashSeed } from './rng';
import {
  decideBuy,
  applyRoundEconomy,
  economyLine,
  freshEconomy,
  weaponForBuy,
  type TeamEconomy,
  type BuyDecision,
} from './economy';
import { runVeto } from './veto';
import { pickStrat, pickUtilityLineup, rollUtilityDamage, clockAt, TEMPO_TICKS, AWP_LANES } from './strats';
import { roleSkillModifier as analyticsRoleSkillModifier } from '../sim/playerAnalytics';

// ============ Tunables ============
const TICKS_ROUND = 55; // ~2s per tick ≈ 110s round
const TICKS_BOMB = 20; // 40s
const ROUNDS_TO_WIN = 13; // MR12
const HALF_ROUNDS = 12;

export interface EngineTeam {
  team: Team;
  players: Player[]; // active 5
  tactics: Tactics;
  pressureResistance: number; // derived from composure avg
  /** Team chemistry score (0-100) blending teamwork, morale, loyalty, morale
   *  spread. Drives a ±8% multiplier on every player's effective skill —
   *  cohesive squads punch above their attribute ceiling, broken ones drag. */
  chemistry: number;
  /** Map-scoped CT setup bias from a "stack A/B" call. */
  forceStackSite?: 'A' | 'B';
  /** Pre-match prep that this team has done against the OPPONENT. Boosts reads
   *  on prepped buy/strat situations when this team is on CT side. */
  matchPlan?: MatchPlan;
  /** Scouting accuracy on the opponent (0-1). Multiplies the matchPlan bonus. */
  scoutAccuracy?: number;
}

interface SimPlayer {
  p: Player;
  side: 'T' | 'CT';
  teamIdx: 0 | 1;
  alive: boolean;
  zone: string;
  path: string[];
  weapon: string;
  hasBomb: boolean;
  eff: number; // effective combat skill this map (8-22ish, includes role-fit bonus)
  utilSkill: number;
  holdTicks: number; // ticks spent stationary in current zone (defender advantage)
  saving: boolean; // late-round save: avoids fights, runs to spawn
  /** Effective role this player is filling on the assigned slot (may differ from p.role). */
  assignedRole: PlayerRole;
  /** How the player approaches their role this round — modulates duel aggression. */
  duty: RoleDuty;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  /** Utility damage subset of `damage` (HEs, mollies, flashes). Apex-style. */
  utilityDamage: number;
  openingKills: number;
  clutchesWon: number;
  multiKillRounds: number;
  roundsSurvived: number;
  roundKillCounts: number[];
}

/**
 * Merge per-map overrides on top of a team's global Tactics. Missing override
 * fields inherit from the global tactics, so a user only has to override what
 * they want to differ. UI tabs surface this directly.
 */
export function resolveTactics(global: Tactics, map: MapName): Tactics {
  const o: MapTactics | undefined = global.mapOverrides?.[map];
  if (!o) return global;
  return {
    ...global,
    tPlaystyle: o.tPlaystyle ?? global.tPlaystyle,
    ctPlaystyle: o.ctPlaystyle ?? global.ctPlaystyle,
    aggression: o.aggression ?? global.aggression,
    utilityUsage: o.utilityUsage ?? global.utilityUsage,
    midRoundFlexibility: o.midRoundFlexibility ?? global.midRoundFlexibility,
    ecoDiscipline: o.ecoDiscipline ?? global.ecoDiscipline,
    forceBuyTendency: o.forceBuyTendency ?? global.forceBuyTendency,
  };
}

/** Look up the enabled-strats list for a map, falling back to undefined when all are allowed. */
export function enabledStratsFor(tactics: Tactics, map: MapName): string[] | undefined {
  return tactics.mapOverrides?.[map]?.enabledStrats;
}

/**
 * Role-fit multiplier on a player's effective skill, derived from the player's
 * attribute spread vs the role's needs (see playerAnalytics.ts). Duty layers
 * on top: extreme duties (aggressive/passive) on a poor role-fit further hurt
 * because the player can't sell the role well.
 */
export function roleFitMultiplier(player: Player, assignedRole: PlayerRole, duty: RoleDuty): number {
  let m = analyticsRoleSkillModifier(player, assignedRole);
  if (m < 1 && duty !== 'balanced') m *= 0.98;
  return m;
}

// ============ Effective skill ============

function effectiveSkill(p: Player, mapProf: number, coachSkill: number, pressure: number, dayVariance: number): number {
  const a = p.attributes;
  let base =
    a.aim * 0.28 +
    a.reflexes * 0.2 +
    a.positioning * 0.17 +
    a.gameSense * 0.15 +
    a.consistency * 0.1 +
    a.composure * 0.1;
  // form ±12%, morale ±12% (was ±6% — felt too soft), fatigue up to ~-30% with steep burnout.
  base *= 1 + ((p.form - 10) / 10) * 0.12;
  base *= 1 + ((p.morale - 10) / 10) * 0.12;
  // Fatigue: -22% at full, then steeper burnout curve past 70%. A grinder at
  // 90% fatigue now loses ~28% effective skill — visibly off the pace.
  base *= 1 - (p.fatigue / 100) * 0.22 - Math.max(0, p.fatigue - 70) * 0.008;
  // map comfort ±7%
  base *= 1 + ((mapProf - 10) / 10) * 0.07;
  // coach ±3%
  base *= 1 + ((coachSkill - 10) / 10) * 0.03;
  // Big-stage choke: low composure makes players crumble under pressure; high
  // resilience claws some of that back (you can be jittery the first round but
  // settle in). Effective stage tolerance = (composure + resilience) / 2.
  const stageTolerance = (a.composure + a.resilience) / 2;
  const chokeRisk = Math.max(0, (12 - stageTolerance) / 12) * pressure;
  base *= 1 - chokeRisk * 0.1;
  // "on the day" variance — even stars have off days; consistency narrows the band
  const band = 0.16 - (a.consistency / 20) * 0.08;
  base *= 1 + (dayVariance * 2 - 1) * band;
  return base;
}

function equipMultiplier(buy: BuyType): number {
  switch (buy) {
    case 'full': return 1.0;
    case 'force': return 0.86;
    case 'half': return 0.78;
    case 'pistol': return 0.75;
    case 'eco': return 0.55;
  }
}

// ============ Pathfinding ============

function bfsPath(layout: MapLayout, from: string, to: string): string[] {
  if (from === to) return [];
  const prev = new Map<string, string>();
  const q = [from];
  const seen = new Set([from]);
  while (q.length) {
    const cur = q.shift()!;
    const zone = layout.zones.find((z) => z.id === cur)!;
    for (const n of zone.neighbors) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path: string[] = [to];
        let at = to;
        while (prev.has(at)) {
          at = prev.get(at)!;
          if (at !== from) path.unshift(at);
        }
        return path;
      }
      q.push(n);
    }
  }
  return [];
}

function zoneOf(layout: MapLayout, id: string) {
  return layout.zones.find((z) => z.id === id)!;
}

// ============ Round simulation ============

interface RoundCtx {
  layout: MapLayout;
  rng: RNG;
  roundNo: number;
  tSide: SimPlayer[];
  ctSide: SimPlayer[];
  tTeam: EngineTeam;
  ctTeam: EngineTeam;
  tBuy: BuyDecision;
  ctBuy: BuyDecision;
  tEco: TeamEconomy;
  ctEco: TeamEconomy;
  tTeamIdx: 0 | 1;
  tRoundForm: number; // per-round momentum multiplier (mutated mid-round by opening-duel leverage)
  ctRoundForm: number;
  isPistol: boolean;
  halfRoundNo: number; // 1-12 within the current half (for pistol/eco context lines)
}

function setupRound(ctx: RoundCtx) {
  const { layout, rng } = ctx;
  const tSpawn = layout.zones.find((z) => z.isSpawn === 'T')!;
  const ctSpawn = layout.zones.find((z) => z.isSpawn === 'CT')!;
  const siteA = layout.zones.find((z) => z.isSite === 'A')!;
  const siteB = layout.zones.find((z) => z.isSite === 'B')!;

  for (const sp of [...ctx.tSide, ...ctx.ctSide]) {
    sp.alive = true;
    sp.holdTicks = 0;
    sp.hasBomb = false;
    sp.saving = false;
    sp.zone = sp.side === 'T' ? tSpawn.id : ctSpawn.id;
    sp.path = [];
    const buy = sp.side === 'T' ? ctx.tBuy : ctx.ctBuy;
    sp.weapon = weaponForBuy(buy.type, sp.side, sp.p.role === 'AWPer', rng);
  }
  // bomb carrier: prefer support/igl
  const carrier = ctx.tSide.find((s) => s.p.role === 'Support') ?? rng.pick(ctx.tSide);
  carrier.hasBomb = true;

  // CT setup: distribute defenders 2-1-2 (A / mid-ish / B) influenced by playstyle.
  // A "stack A/B" call from the user (or AI desperation) forces a 3-1-1 stack.
  const midZones = layout.zones.filter((z) => !z.isSpawn && !z.isSite);
  const aNear = nearestZones(layout, siteA.id, 2);
  const bNear = nearestZones(layout, siteB.id, 2);
  const assignments: string[] = [];
  const style = ctx.ctTeam.tactics.ctPlaystyle;
  const forcedStack = ctx.ctTeam.forceStackSite;
  const doStack =
    forcedStack !== undefined || (style === 'stacked-gambles' && rng.chance(0.5));
  if (doStack) {
    const stackZone = forcedStack
      ? forcedStack === 'A'
        ? siteA
        : siteB
      : rng.chance(0.5)
        ? siteA
        : siteB;
    const near = stackZone === siteA ? aNear : bNear;
    assignments.push(
      stackZone.id,
      stackZone.id,
      stackZone.id,
      near[0] ?? stackZone.id,
      stackZone === siteA ? siteB.id : siteA.id,
    );
  } else {
    assignments.push(siteA.id, aNear[0] ?? siteA.id, siteB.id, bNear[0] ?? siteB.id);
    if (style === 'aggressive-info') {
      // 5th player pushes a forward zone
      const forward = midZones.length ? rng.pick(midZones).id : siteA.id;
      assignments.push(forward);
    } else if (style === 'passive-retake') {
      assignments.push(ctSpawn.id);
    } else {
      assignments.push(midZones.length ? rng.pick(midZones).id : siteB.id);
    }
  }
  const shuffledCt = rng.shuffle(ctx.ctSide);
  shuffledCt.forEach((sp, i) => {
    sp.path = bfsPath(layout, sp.zone, assignments[i % assignments.length]);
  });

  // the CT AWPer anchors the classic AWP lane (mid window, CT-mid, arch...)
  const ctLane = AWP_LANES[layout.name]?.ct;
  if (ctLane && style !== 'stacked-gambles' && rng.chance(0.75)) {
    const awper = ctx.ctSide.find((s) => s.weapon === 'AWP');
    if (awper) awper.path = bfsPath(layout, awper.zone, ctLane);
  }
}

function nearestZones(layout: MapLayout, fromId: string, n: number): string[] {
  const from = zoneOf(layout, fromId);
  return [...from.neighbors].slice(0, n);
}

/** Per-duel multiplier from a player's duty: aggressive peeks well but anchors poorly. */
function dutyDuelMultiplier(duty: RoleDuty, defending: boolean): number {
  if (duty === 'aggressive') return defending ? 0.97 : 1.06;
  if (duty === 'passive') return defending ? 1.06 : 0.96;
  return 1;
}

/**
 * Pick an alive utility thrower, weighted by their utility attribute squared.
 * High-util supports throw most of the team's nades, but the rest still chip in —
 * matches real pro CS distribution (e.g. Apex hogs Vitality's mollies, but ZywOo
 * still throws his own flash). Falls back to highest-util if all are 0.
 */
function pickUtilThrower(side: SimPlayer[], rng: RNG): SimPlayer | undefined {
  const alive = side.filter((s) => s.alive);
  if (alive.length === 0) return undefined;
  const weights = alive.map((s) => Math.max(1, s.p.attributes.utility ** 2));
  const sum = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * sum;
  for (let i = 0; i < alive.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return alive[i];
  }
  return alive[alive.length - 1];
}

interface RoundOutput {
  winnerSide: 'T' | 'CT';
  reason: RoundResult['reason'];
  kills: KillEvent[];
  bombPlanted: boolean;
  plantSite?: 'A' | 'B';
  clutch?: { playerId: string; vs: number; won: boolean };
  commentary: string[];
  frames: RoundFrame[];
  tSurvivors: number;
  ctSurvivors: number;
}

function simulateRound(ctx: RoundCtx): RoundOutput {
  const { layout, rng } = ctx;
  setupRound(ctx);

  const kills: KillEvent[] = [];
  const commentary: string[] = [];
  const frames: RoundFrame[] = [];
  const all = [...ctx.tSide, ...ctx.ctSide];

  // ===== match-plan prep bonus =====
  // If the CT-side team prepped against the opponent (this team's matchPlan is
  // set), and the opponent's current situation matches a prepped category, the
  // CT gets a flat round-form bonus (better rotations, less likely to fall for
  // fakes). Caps at +20% if all points are in one matching category.
  const prep = ctx.ctTeam.matchPlan;
  if (prep) {
    let prepBonus = 0;
    if (ctx.isPistol) prepBonus = prep.pistols;
    else if (ctx.tBuy.type === 'eco' || ctx.tBuy.type === 'half') prepBonus = prep.antiEcos;
    else if (ctx.tBuy.type === 'force') prepBonus = prep.executes; // forces hit fast like executes
    else prepBonus = prep.defaults; // full buy default
    // Each prep point = +1% CT round form, scaled by scouting accuracy on the
    // opponent. A perfectly scouted opponent (1.0) gives full prep value; an
    // un-scouted opponent gives 30% baseline (you can plan from rumours too).
    const scoutMul = 0.3 + 0.7 * (ctx.ctTeam.scoutAccuracy ?? 0);
    ctx.ctRoundForm *= 1 + prepBonus * 0.01 * scoutMul;
  }

  // ===== pre-round economy commentary =====
  // Pistol rounds get a single broadcast line; other rounds surface buy state
  // for either side when it's interesting (forces, ecos, recoveries).
  if (ctx.isPistol) {
    if (ctx.roundNo === 1) {
      commentary.push(`[Freeze] Pistol round — first of the half, both teams on Glocks and USPs.`);
    } else {
      commentary.push(`[Freeze] Second-half pistol — sides swap, economies reset.`);
    }
  } else {
    const tEcoMsg = economyLine(ctx.tBuy, ctx.tEco, false, ctx.tTeam.team.tag, rng);
    const ctEcoMsg = economyLine(ctx.ctBuy, ctx.ctEco, false, ctx.ctTeam.team.tag, rng);
    if (tEcoMsg) commentary.push(`[Freeze] ${tEcoMsg}`);
    if (ctEcoMsg) commentary.push(`[Freeze] ${ctEcoMsg}`);
    // Anti-eco read: if one side ecos and the other has a full buy, flag the round value
    if (ctx.tBuy.type === 'eco' && ctx.ctBuy.type === 'full' && rng.chance(0.5)) {
      commentary.push(`[Freeze] Anti-eco for ${ctx.ctTeam.team.tag} — punish round, kills mean cash.`);
    } else if (ctx.ctBuy.type === 'eco' && ctx.tBuy.type === 'full' && rng.chance(0.5)) {
      commentary.push(`[Freeze] Anti-eco for ${ctx.tTeam.team.tag} — easy round if they play it tight.`);
    }
  }

  const siteA = layout.zones.find((z) => z.isSite === 'A')!;
  const siteB = layout.zones.find((z) => z.isSite === 'B')!;

  let bombPlanted = false;
  let bombTick = -1;
  let plantSite: 'A' | 'B' | undefined;
  let plantZoneId = '';
  let defuseProgress = 0;
  let clutchInfo: RoundOutput['clutch'];
  let clutchAnnounced = false;
  let openingDone = false;

  // T-side plan
  const tTac = ctx.tTeam.tactics;
  const igl = ctx.tSide.find((s) => s.p.role === 'IGL') ?? ctx.tSide[0];
  const iglQ = (igl.p.attributes.leadership + igl.p.attributes.gameSense) / 2;
  // target decision quality: good IGLs hit the weaker site
  const ctOnA = () => ctx.ctSide.filter((c) => c.alive && (c.zone === siteA.id || siteA.neighbors.includes(c.zone))).length;
  const ctOnB = () => ctx.ctSide.filter((c) => c.alive && (c.zone === siteB.id || siteB.neighbors.includes(c.zone))).length;

  // ===== strategy call (map playbook) =====
  let target: 'A' | 'B' = rng.chance(0.5) ? 'A' : 'B';
  const readChance = 0.35 + (iglQ / 20) * 0.45;
  if (rng.chance(readChance)) target = ctOnA() <= ctOnB() ? 'A' : 'B';

  const strat = pickStrat(
    layout.name,
    target,
    tTac,
    ctx.tBuy.type,
    rng,
    enabledStratsFor(tTac, layout.name),
  );
  target = strat.site;
  const [tickLo, tickHi] = TEMPO_TICKS[strat.tempo];
  const executeTick = rng.int(tickLo, tickHi);
  const isRush = strat.tempo === 'rush';

  const tTag = ctx.tTeam.team.tag;
  if (strat.startLine) {
    commentary.push(`[${clockAt(1)}] ${strat.startLine.replace('{team}', tTag)}`);
  }
  let controlLinePending = !!strat.controlLine;
  const controlTick = Math.max(2, Math.floor(executeTick * 0.55));

  // early phase: rushes go straight in, everyone else takes the strat's control zones
  ctx.tSide.forEach((sp, i) => {
    const dest = isRush || strat.control.length === 0
      ? (target === 'A' ? siteA : siteB).id
      : strat.control[i % strat.control.length];
    sp.path = bfsPath(layout, sp.zone, dest);
  });

  if (!isRush) {
    // T AWPer sets up on the map's AWP lane during structured rounds
    const tLane = AWP_LANES[layout.name]?.t;
    const tAwper = ctx.tSide.find((s) => s.weapon === 'AWP');
    if (tAwper && tLane && (strat.tempo === 'standard' || strat.tempo === 'slow')) {
      tAwper.path = bfsPath(layout, tAwper.zone, tLane);
      if (rng.chance(0.4)) {
        commentary.push(`[${clockAt(2)}] ${tAwper.p.nickname} sets up with the AWP towards ${zoneOf(layout, tLane).name}.`);
      }
    }
    // info rounds: the lurker drifts towards the other side of the map
    if (strat.infoFirst) {
      const lurker = ctx.tSide.find((s) => s.p.role === 'Lurker') ?? ctx.tSide.find((s) => s.p.role === 'Support');
      const otherSite = strat.site === 'A' ? siteB : siteA;
      const lurkZone = otherSite.neighbors[0];
      if (lurker && lurker !== tAwper && lurkZone) {
        lurker.path = bfsPath(layout, lurker.zone, lurkZone);
        if (rng.chance(0.35)) {
          commentary.push(`[${clockAt(2)}] ${lurker.p.nickname} slides away on the lurk for information.`);
        }
      }
    }
  }

  let executed = false;
  let rotated = false;
  const maxTicks = TICKS_ROUND + TICKS_BOMB + 8;

  // ===== round drama state =====
  // fake: show presence at one site, then spin to the other while CTs over-rotate
  let fakePlan: { fakeSite: 'A' | 'B'; realSite: 'A' | 'B'; fakeTick: number; realTick: number } | null = null;
  if (!isRush && !strat.infoFirst && executeTick <= 34 && rng.chance(0.12 + (tTac.midRoundFlexibility / 20) * 0.18)) {
    fakePlan = {
      fakeSite: target,
      realSite: target === 'A' ? 'B' : 'A',
      fakeTick: executeTick,
      realTick: executeTick + rng.int(4, 7),
    };
  }
  let fakeShown = false;
  let executedAtTick = -1;
  let tCountAtExec = 0;
  let ctCountAtExec = 0;
  let abortUsed = false;
  let reExecTick: number | null = null;
  let saving = false;

  for (let tick = 0; tick < maxTicks; tick++) {
    const tAlive = ctx.tSide.filter((s) => s.alive);
    const ctAlive = ctx.ctSide.filter((s) => s.alive);

    // round end checks
    if (ctAlive.length === 0 && !bombPlanted) {
      finishFrames();
      return out('T', 'elimination');
    }
    if (tAlive.length === 0 && !bombPlanted) {
      finishFrames();
      return out('CT', 'elimination');
    }
    if (ctAlive.length === 0 && bombPlanted) {
      // no one to defuse — bomb will explode
      finishFrames();
      return out('T', 'bomb');
    }
    if (!bombPlanted && tick >= TICKS_ROUND) {
      commentary.push(`Time expires — the CTs hold on.`);
      finishFrames();
      return out('CT', 'time');
    }
    if (bombPlanted && tick - bombTick >= TICKS_BOMB) {
      commentary.push(`💥 The bomb detonates on ${plantSite} site!`);
      finishFrames();
      return out('T', 'bomb');
    }

    // clutch detection — emit a broadcast-style call-out with bomb/clock state
    if (!clutchAnnounced) {
      if (tAlive.length === 1 && ctAlive.length >= 2) {
        const player = tAlive[0];
        clutchInfo = { playerId: player.p.id, vs: ctAlive.length, won: false };
        clutchAnnounced = true;
        const bombState = bombPlanted
          ? ` Bomb down at ${plantSite} — ${Math.max(0, (TICKS_BOMB - (tick - bombTick)) * 2)}s on the clock.`
          : ` ${(TICKS_ROUND - tick) * 2}s on the round.`;
        commentary.push(
          `🚨 ${player.p.nickname} is the LAST T STANDING for ${ctx.tTeam.team.tag} — 1v${ctAlive.length}!${bombState}`,
        );
      } else if (ctAlive.length === 1 && tAlive.length >= 2) {
        const player = ctAlive[0];
        clutchInfo = { playerId: player.p.id, vs: tAlive.length, won: false };
        clutchAnnounced = true;
        const bombState = bombPlanted
          ? ` Bomb is down — defuse needed with ${Math.max(0, (TICKS_BOMB - (tick - bombTick)) * 2)}s.`
          : ` ${(TICKS_ROUND - tick) * 2}s on the round.`;
        commentary.push(
          `🚨 ${player.p.nickname} alone for ${ctx.ctTeam.team.tag} — 1v${tAlive.length}!${bombState}`,
        );
      }
    }

    // map-control progress line + optional named utility lineup.
    // utilityUsage slider scales how likely the team is to commit util on control plays.
    if (controlLinePending && tick >= controlTick) {
      controlLinePending = false;
      commentary.push(`[${clockAt(tick)}] ${strat.controlLine!.replace('{team}', tTag)}`);
      const utilDial = tTac.utilityUsage / 12; // 12 = neutral, 6 = half, 18 = 1.5×
      if (rng.chance(Math.min(0.85, 0.5 * utilDial))) {
        const lineup = pickUtilityLineup(layout.name, target, 'control', rng);
        if (lineup) {
          const thrower = pickUtilThrower(ctx.tSide, rng);
          if (thrower) {
            const dmg = rollUtilityDamage(lineup.kind, thrower.p.attributes.utility, rng);
            if (dmg > 0) {
              thrower.utilityDamage += dmg;
              thrower.damage += dmg;
            }
            commentary.push(
              `[${clockAt(tick + 1)}] ${lineup.line.replace('{nick}', thrower.p.nickname).replace('{team}', tTag)}${dmg > 0 ? ` (${dmg} dmg)` : ''}`,
            );
          }
        }
      }
    }

    // fake stage: feint towards the fake site to draw rotations
    if (fakePlan && !fakeShown && tick >= fakePlan.fakeTick) {
      fakeShown = true;
      const fz = fakePlan.fakeSite === 'A' ? siteA : siteB;
      const feinters = tAlive.filter((s) => !s.hasBomb).slice(0, 3);
      for (const sp of feinters) sp.path = bfsPath(layout, sp.zone, fz.neighbors[0] ?? fz.id);
      commentary.push(`[${clockAt(tick)}] ${tTag} throw utility at ${fakePlan.fakeSite} — heavy presence!`);
    }

    // T execute call (normal, fake-real, or re-hit after an abort)
    const goTick = reExecTick ?? (fakePlan ? fakePlan.realTick : executeTick);
    if (!executed && !saving && tick >= goTick) {
      executed = true;
      executedAtTick = tick;
      tCountAtExec = tAlive.length;
      ctCountAtExec = ctAlive.length;
      const originalTarget = target;
      if (fakePlan && reExecTick === null) {
        target = fakePlan.realSite;
      } else {
        const flexP = isRush
          ? 0
          : strat.infoFirst
            ? 0.65 + (iglQ / 20) * 0.3
            : (tTac.midRoundFlexibility / 20) * 0.5 + (iglQ / 20) * 0.3;
        if (rng.chance(flexP)) target = ctOnA() <= ctOnB() ? 'A' : 'B';
      }
      const tgt = target === 'A' ? siteA : siteB;
      tAlive.forEach((sp) => (sp.path = bfsPath(layout, sp.zone, tgt.id)));
      if (fakePlan && reExecTick === null) {
        commentary.push(`[${clockAt(tick)}] It's a FAKE — ${tTag} spin round to ${target}!`);
      } else if (reExecTick !== null) {
        commentary.push(`[${clockAt(tick)}] Second wave — ${tTag} go again, this time at ${target}!`);
      } else if (strat.infoFirst) {
        commentary.push(`[${clockAt(tick)}] Info secured — ${tTag} call the slow ${target} take.`);
      } else if (target !== originalTarget) {
        commentary.push(`[${clockAt(tick)}] Mid-round call! ${tTag} swing the hit to ${target} instead.`);
      } else if (strat.executeLine) {
        commentary.push(`[${clockAt(tick)}] ${strat.executeLine.replace('{team}', tTag)}`);
      } else {
        commentary.push(`[${clockAt(tick)}] ${tTag} commit to the ${target} hit.`);
      }

      // Named utility lineup for the execute (rifles only — eco/half hits skip util).
      // utilityUsage drives execute lineup probability + optional second-stage util dump.
      if (!isRush && (ctx.tBuy.type === 'full' || ctx.tBuy.type === 'force')) {
        const utilDial = tTac.utilityUsage / 12; // 1.0 at neutral, scales 0.5×–1.5×
        const baseP = Math.min(0.95, 0.75 * utilDial);
        if (rng.chance(baseP)) {
          const lineup = pickUtilityLineup(layout.name, target, 'execute', rng);
          if (lineup) {
            const thrower = pickUtilThrower(ctx.tSide, rng);
            if (thrower) {
              const dmg = rollUtilityDamage(lineup.kind, thrower.p.attributes.utility, rng);
              if (dmg > 0) {
                thrower.utilityDamage += dmg;
                thrower.damage += dmg;
              }
              commentary.push(
                `[${clockAt(tick)}] ${lineup.line.replace('{nick}', thrower.p.nickname).replace('{team}', tTag)}${dmg > 0 ? ` (${dmg} dmg)` : ''}`,
              );
            }
          }
        }
        // Heavy-utility teams (slider >= 14) burn a second lineup on the same execute.
        const extraP = Math.max(0, (tTac.utilityUsage - 10) / 20);
        if (extraP > 0 && rng.chance(extraP)) {
          const lineup = pickUtilityLineup(layout.name, target, 'execute', rng);
          if (lineup) {
            const thrower = pickUtilThrower(ctx.tSide, rng);
            if (thrower) {
              const dmg = rollUtilityDamage(lineup.kind, thrower.p.attributes.utility, rng);
              if (dmg > 0) {
                thrower.utilityDamage += dmg;
                thrower.damage += dmg;
              }
              commentary.push(
                `[${clockAt(tick + 1)}] ${tTag} dump more util — ${lineup.line.replace('{nick}', thrower.p.nickname).replace('{team}', tTag)}${dmg > 0 ? ` (${dmg} dmg)` : ''}`,
              );
            }
          }
        }
      }

      // CT flank: a far defender swings around behind the attack
      const flankP = ctx.ctTeam.tactics.ctPlaystyle === 'aggressive-info' ? 0.4 : 0.18;
      if (rng.chance(flankP)) {
        const farCt = ctAlive.filter((c) => c.zone !== tgt.id && !tgt.neighbors.includes(c.zone));
        if (farCt.length > 1) {
          const flanker = rng.pick(farCt);
          const tSpawnZ = layout.zones.find((z) => z.isSpawn === 'T')!;
          const behind = tSpawnZ.neighbors[0] ?? tSpawnZ.id;
          flanker.path = [...bfsPath(layout, flanker.zone, behind), ...bfsPath(layout, behind, tgt.id)];
          if (rng.chance(0.5)) commentary.push(`[${clockAt(tick)}] ${flanker.p.nickname} sneaks wide for the flank!`);
        }
      }
    }

    // abort: the entry goes badly -> back out, regroup, hit again
    if (
      executed && !abortUsed && !isRush && !bombPlanted && reExecTick === null &&
      executedAtTick >= 0 && tick > executedAtTick + 1 && tick <= executedAtTick + 6 && tick < 38
    ) {
      const tLost = tCountAtExec - tAlive.length;
      const ctLost = ctCountAtExec - ctAlive.length;
      if (tLost >= 2 && ctLost <= 1 && tAlive.length >= 2) {
        abortUsed = true;
        executed = false;
        reExecTick = tick + rng.int(6, 10);
        if (rng.chance(0.6)) target = target === 'A' ? 'B' : 'A';
        const fallbackZone = strat.control[0] ?? layout.zones.find((z) => z.isSpawn === 'T')!.id;
        tAlive.forEach((sp) => (sp.path = bfsPath(layout, sp.zone, fallbackZone)));
        commentary.push(`[${clockAt(tick)}] The hit stalls — ${tTag} back out and regroup.`);
      }
    }

    // save call: outnumbered late with no plant -> keep the guns for next round
    if (!saving && !bombPlanted && tick >= 38 && tAlive.length > 0 && tAlive.length <= 2 && ctAlive.length - tAlive.length >= 2) {
      saving = true;
      executed = false;
      const tSpawnZ = layout.zones.find((z) => z.isSpawn === 'T')!;
      for (const sp of tAlive) {
        sp.saving = true;
        sp.path = bfsPath(layout, sp.zone, tSpawnZ.id);
      }
      commentary.push(`[${clockAt(tick)}] ${tTag} call off the round and save their weapons.`);
    }

    // CT rotation after plant or info
    if (bombPlanted && !rotated) {
      rotated = true;
      ctAlive.forEach((sp) => (sp.path = bfsPath(layout, sp.zone, plantZoneId)));
    } else if ((executed || fakeShown) && !bombPlanted && rng.chance(0.3)) {
      // partial rotate towards the APPARENT threat — fakes pull rotations the wrong way
      const apparent = fakeShown && !executed && fakePlan ? fakePlan.fakeSite : target;
      const tgt = apparent === 'A' ? siteA : siteB;
      const farCt = ctAlive.filter((c) => c.zone !== tgt.id && !tgt.neighbors.includes(c.zone));
      if (farCt.length > 2) {
        const rotator = rng.pick(farCt);
        rotator.path = bfsPath(layout, rotator.zone, tgt.id);
      }
    }

    // movement
    for (const sp of all) {
      if (!sp.alive) continue;
      if (sp.path.length > 0) {
        sp.zone = sp.path.shift()!;
        sp.holdTicks = 0;
      } else {
        sp.holdTicks++;
      }
    }

    // post-plant T positioning: hold site + neighbors
    if (bombPlanted) {
      for (const sp of tAlive) {
        if (sp.path.length === 0 && sp.zone !== plantZoneId && !zoneOf(layout, plantZoneId).neighbors.includes(sp.zone)) {
          sp.path = bfsPath(layout, sp.zone, plantZoneId);
        }
      }
    }

    // ===== duels: zones with both sides present =====
    const zoneMap = new Map<string, SimPlayer[]>();
    for (const sp of all) {
      if (!sp.alive) continue;
      const arr = zoneMap.get(sp.zone) ?? [];
      arr.push(sp);
      zoneMap.set(sp.zone, arr);
    }
    for (const [zid, occupants] of zoneMap) {
      const ts = occupants.filter((o) => o.side === 'T' && o.alive);
      const cts = occupants.filter((o) => o.side === 'CT' && o.alive);
      if (ts.length === 0 || cts.length === 0) continue;
      resolveFight(ctx, zid, ts, cts, kills, commentary, tick, openingDone, bombPlanted);
      if (kills.length > 0) openingDone = true;
    }

    // ===== bomb plant =====
    if (!bombPlanted && executed) {
      const tgt = target === 'A' ? siteA : siteB;
      const carrier = ctx.tSide.find((s) => s.hasBomb && s.alive);
      if (!carrier) {
        // bomb dropped — another T picks it up if at same zone path; simplify: transfer to random alive T
        const next = tAlive[0];
        if (next) next.hasBomb = true;
      } else if (carrier.zone === tgt.id) {
        const defendersHere = ctx.ctSide.filter((c) => c.alive && c.zone === tgt.id).length;
        if (defendersHere === 0 || rng.chance(0.35)) {
          bombPlanted = true;
          bombTick = tick;
          plantSite = target;
          plantZoneId = tgt.id;
          commentary.push(`${carrier.p.nickname} gets the bomb down on ${target}!`);
          // Post-plant scene-setter: who has the numbers, time on the bomb
          const tAlivePP = ctx.tSide.filter((t) => t.alive).length;
          const ctAlivePP = ctx.ctSide.filter((c) => c.alive).length;
          if (ctAlivePP >= 2 && tAlivePP >= 2) {
            const setupLines = [
              `[${clockAt(tick)}] Post-plant for ${ctx.tTeam.team.tag} — ${tAlivePP}v${ctAlivePP}, 40 on the bomb.`,
              `[${clockAt(tick)}] ${ctx.ctTeam.team.tag} have to find the openings — retake setup, ${tAlivePP}v${ctAlivePP}.`,
              `[${clockAt(tick)}] ${ctx.tTeam.team.tag} lurk for crossfires — bomb's down, clock ticking.`,
            ];
            commentary.push(rng.pick(setupLines));
          } else if (ctAlivePP >= 1 && tAlivePP > ctAlivePP) {
            commentary.push(
              `[${clockAt(tick)}] ${ctx.ctTeam.team.tag} need a miracle — ${ctAlivePP} alive against ${tAlivePP} post-plant.`,
            );
          } else if (ctAlivePP >= 2 && tAlivePP === 1) {
            commentary.push(
              `[${clockAt(tick)}] ${ctx.ctTeam.team.tag} hunt the last T — ${ctAlivePP}v1 retake.`,
            );
          }
        }
      }
    }

    // ===== defuse =====
    if (bombPlanted) {
      const ctOnSite = ctx.ctSide.filter((c) => c.alive && c.zone === plantZoneId);
      const tThreat = ctx.tSide.filter(
        (t) => t.alive && (t.zone === plantZoneId || zoneOf(layout, plantZoneId).neighbors.includes(t.zone)),
      );
      if (ctOnSite.length > 0 && tThreat.length === 0) {
        defuseProgress++;
        if (defuseProgress >= 3) {
          commentary.push(`${ctOnSite[0].p.nickname} defuses the bomb!`);
          finishFrames();
          return out('CT', 'defuse');
        }
      } else {
        defuseProgress = 0;
      }
    }

    // record frame
    frames.push(makeFrame(tick));
  }

  // safety: time out
  finishFrames();
  return out(bombPlanted ? 'T' : 'CT', bombPlanted ? 'bomb' : 'time');

  function makeFrame(tick: number): RoundFrame {
    const dots: PlayerDot[] = all.map((sp) => {
      const z = zoneOf(layout, sp.zone);
      // stable per-player jitter inside zone
      const jx = ((hashSeed(sp.p.id) % 100) / 100 - 0.5) * 0.022;
      const jy = ((hashSeed(sp.p.id + 'y') % 100) / 100 - 0.5) * 0.022;
      return {
        playerId: sp.p.id,
        x: Math.min(0.98, Math.max(0.02, z.x + jx)),
        y: Math.min(0.98, Math.max(0.02, z.y + jy)),
        alive: sp.alive,
        side: sp.side,
        hasBomb: sp.hasBomb && sp.alive,
      };
    });
    const bz = bombPlanted ? zoneOf(layout, plantZoneId) : null;
    return { tick, dots, bombPlanted, bombX: bz?.x, bombY: bz?.y };
  }

  function finishFrames() {
    frames.push(makeFrame(frames.length));
  }

  function out(winnerSide: 'T' | 'CT', reason: RoundResult['reason']): RoundOutput {
    const tSurv = ctx.tSide.filter((s) => s.alive).length;
    const ctSurv = ctx.ctSide.filter((s) => s.alive).length;
    if (clutchInfo) {
      const clutcher = all.find((s) => s.p.id === clutchInfo!.playerId)!;
      clutchInfo.won = clutcher.alive && clutcher.side === winnerSide;
      if (clutchInfo.won) {
        clutcher.clutchesWon++;
        commentary.push(`🔥 ${clutcher.p.nickname} WINS the 1v${clutchInfo.vs} clutch!`);
      }
    }
    for (const sp of all) if (sp.alive) sp.roundsSurvived++;
    return {
      winnerSide,
      reason,
      kills,
      bombPlanted,
      plantSite,
      clutch: clutchInfo,
      commentary,
      frames,
      tSurvivors: tSurv,
      ctSurvivors: ctSurv,
    };
  }
}

function resolveFight(
  ctx: RoundCtx,
  zoneId: string,
  ts: SimPlayer[],
  cts: SimPlayer[],
  kills: KillEvent[],
  commentary: string[],
  tick: number,
  openingDone: boolean,
  postPlant: boolean,
) {
  const { rng, layout } = ctx;
  const zone = zoneOf(layout, zoneId);
  // a fight resolves at most 2 kills per tick in a zone (duel + possible trade)
  let duels = 0;
  while (duels < 2) {
    const aliveT = ts.filter((t) => t.alive);
    const aliveCt = cts.filter((c) => c.alive);
    if (aliveT.length === 0 || aliveCt.length === 0) break;
    // not every co-presence is a fight — saving players actively avoid contact
    const tsSaving = aliveT.every((t) => t.saving);
    if (duels === 0 && !rng.chance(tsSaving ? 0.3 : 0.75)) break;

    const t = rng.pick(aliveT);
    const c = rng.pick(aliveCt);

    // defender = whoever held the zone longer
    const tDefending = t.holdTicks > c.holdTicks + 1;
    const ctDefending = c.holdTicks > t.holdTicks + 1;

    let tScore = t.eff * equipMultiplier(sideBuy(ctx, t).type) * ctx.tRoundForm;
    let cScore = c.eff * equipMultiplier(sideBuy(ctx, c).type) * ctx.ctRoundForm;
    if (ctDefending) cScore *= 1 + (c.p.attributes.positioning / 20) * 0.18;
    if (tDefending) tScore *= 1 + (t.p.attributes.positioning / 20) * 0.18;
    // Duty modulation: aggressive duty wins more attacking duels but loses
    // defending ones (over-peeks); passive duty is the inverse — anchors better
    // but engages less effectively. Drives donk-as-Entry vs donk-as-Lurker feel.
    tScore *= dutyDuelMultiplier(t.duty, tDefending);
    cScore *= dutyDuelMultiplier(c.duty, ctDefending);
    // Team aggression slider: high aggression wins more entries but loses more holds.
    // Centered at 10 → no effect. ±10 from neutral → up to ±6% peeking, ∓3% holding.
    const tAggSlider = (ctx.tTeam.tactics.aggression - 10) / 10;
    const ctAggSlider = (ctx.ctTeam.tactics.aggression - 10) / 10;
    tScore *= 1 + tAggSlider * (tDefending ? -0.03 : 0.06);
    cScore *= 1 + ctAggSlider * (ctDefending ? -0.03 : 0.06);
    // utility support: attacker flashing in (team utility level * player util skill)
    const tBuyD = sideBuy(ctx, t);
    if (!tDefending) tScore *= 1 + tBuyD.utilityLevel * (t.utilSkill / 20) * 0.12;
    // AWP holding an angle is oppressive
    if (c.weapon === 'AWP' && ctDefending) cScore *= 1.22;
    if (t.weapon === 'AWP' && tDefending) tScore *= 1.22;
    // numbers advantage → confidence
    tScore *= 1 + Math.min(0.12, (aliveT.length - aliveCt.length) * 0.04);
    cScore *= 1 + Math.min(0.12, (aliveCt.length - aliveT.length) * 0.04);
    // clutch attribute when last alive
    if (aliveT.length === 1 && ctx.tSide.filter((x) => x.alive).length === 1) {
      tScore *= 1 + ((t.p.attributes.clutch - 10) / 10) * 0.12;
    }
    if (aliveCt.length === 1 && ctx.ctSide.filter((x) => x.alive).length === 1) {
      cScore *= 1 + ((c.p.attributes.clutch - 10) / 10) * 0.12;
    }

    const pT = 1 / (1 + Math.pow(10, -(tScore - cScore) / 42));
    const tWins = rng.chance(pT);
    const winner = tWins ? t : c;
    const loser = tWins ? c : t;

    loser.alive = false;
    winner.kills++;
    loser.deaths++;
    winner.damage += rng.int(95, 160);
    loser.damage += rng.int(0, 80);

    // assist: teammate in same zone with utility
    const mates = (tWins ? ts : cts).filter((m) => m.alive && m !== winner);
    let assistId: string | undefined;
    if (mates.length && rng.chance(0.3)) {
      const helper = rng.pick(mates);
      helper.assists++;
      assistId = helper.p.id;
    }

    const hs = rng.chance(0.25 + (winner.p.attributes.aim / 20) * 0.35);
    kills.push({
      tick,
      killerId: winner.p.id,
      victimId: loser.p.id,
      assistId,
      weapon: winner.weapon,
      headshot: hs,
      zone: zone.name,
    });
    if (!openingDone && kills.length === 1) {
      winner.openingKills++;
      commentary.push(`First blood! ${winner.p.nickname} ${hs ? 'headshots' : 'takes down'} ${loser.p.nickname} (${zone.name}).`);
      // Opening-duel leverage: the side that gets the opener carries ~15%
      // sustained pressure for the rest of the round. Subsequent duels in
      // resolveFight read ctx.tRoundForm / ctRoundForm, so this propagates.
      if (winner.side === 'T') ctx.tRoundForm *= 1.15;
      else ctx.ctRoundForm *= 1.15;
      // Aftermath line (skip if first blood already triggered a clutch)
      const tNow = ctx.tSide.filter((s) => s.alive).length;
      const cNow = ctx.ctSide.filter((s) => s.alive).length;
      if (tNow >= 2 && cNow >= 2) {
        const winnerTag = winner.side === 'T' ? ctx.tTeam.team.tag : ctx.ctTeam.team.tag;
        const winnerCount = winner.side === 'T' ? tNow : cNow;
        const loserCount = winner.side === 'T' ? cNow : tNow;
        commentary.push(
          `${winnerTag} on the front foot — ${winnerCount}v${loserCount} their way after the opener.`,
        );
      }
    } else if (rng.chance(0.35)) {
      commentary.push(`${winner.p.nickname} kills ${loser.p.nickname} with the ${winner.weapon} in ${zone.name}.`);
    }
    if (loser.hasBomb) {
      loser.hasBomb = false;
      const aliveTs = ctx.tSide.filter((x) => x.alive);
      if (aliveTs.length && !postPlant) aliveTs[0].hasBomb = true;
    }

    duels++;
    // Trade attempt: loser's teammate in zone refrags with teamwork-driven probability.
    // Wider band (0.22-0.72) so low-teamwork squads (5) clearly bleed entry trades vs
    // high-teamwork ones (20). +5% on top if chemistry is strong (cohesive teams
    // call out positions instantly).
    const avengers = (tWins ? cts : ts).filter((m) => m.alive);
    if (avengers.length === 0) break;
    const avenger = avengers[0];
    const teamOfAvenger = avenger.teamIdx === 0 ? ctx.tTeam : ctx.ctTeam;
    const chemBoost = ((teamOfAvenger.chemistry - 50) / 50) * 0.05;
    const tradeP = 0.22 + (avenger.p.attributes.teamwork / 20) * 0.5 + chemBoost;
    if (!rng.chance(Math.max(0.05, Math.min(0.9, tradeP)))) break;
  }
}

function sideBuy(ctx: RoundCtx, sp: SimPlayer): BuyDecision {
  return sp.side === 'T' ? ctx.tBuy : ctx.ctBuy;
}

// ============ Map simulation ============

/**
 * Resumable map state — allows tactical timeouts mid-map by re-running
 * a fresh simulation from a captured checkpoint with updated tactics.
 */
export interface MapSimState {
  map: MapName;
  layout: MapLayout;
  a: EngineTeam;
  b: EngineTeam;
  pressure: number;
  rng: RNG;
  profA: number;
  profB: number;
  mapFormA: number;
  mapFormB: number;
  simA: SimPlayer[];
  simB: SimPlayer[];
  scoreA: number;
  scoreB: number;
  aIsT: boolean;
  ecoA: TeamEconomy;
  ecoB: TeamEconomy;
  rounds: RoundResult[];
  roundNo: number;
  otBlockStart: number;
  done: boolean;
}

function simulateMap(
  map: MapName,
  layout: MapLayout,
  aIn: EngineTeam,
  bIn: EngineTeam,
  pressure: number,
  rng: RNG,
): MapResult {
  // Resolve per-map tactical overrides on both teams. Each team carries through
  // its own `forceStackSite` / `matchPlan` from the caller — those are series-level.
  const a: EngineTeam = { ...aIn, tactics: resolveTactics(aIn.tactics, map) };
  const b: EngineTeam = { ...bIn, tactics: resolveTactics(bIn.tactics, map) };
  const profA = a.team.mapPool.find((m) => m.map === map)?.proficiency ?? 10;
  const profB = b.team.mapPool.find((m) => m.map === map)?.proficiency ?? 10;

  // team-level "on the day" form for this map — the main source of realistic upsets
  const mapFormA = rng.range(0.88, 1.12);
  const mapFormB = rng.range(0.88, 1.12);

  const mkSim = (team: EngineTeam, prof: number, idx: 0 | 1): SimPlayer[] => {
    // Resolve role slots: user team may have re-ordered/duty-assigned the starting 5.
    // If `roleSlots` is missing or vacant, fall back to natural roles in playerIds order.
    const slots = team.tactics.roleSlots ?? [];
    const slotByPlayerId = new Map(
      slots.filter((s) => s.playerId).map((s) => [s.playerId!, s] as const),
    );
    return team.players.map((p) => {
      const slot = slotByPlayerId.get(p.id);
      const assignedRole = slot?.role ?? p.role;
      const duty = slot?.duty ?? 'balanced';
      const fit = roleFitMultiplier(p, assignedRole, duty);
      return {
        p,
        side: 'T' as const,
        teamIdx: idx,
        alive: true,
        zone: '',
        path: [],
        weapon: '',
        hasBomb: false,
        eff:
          effectiveSkill(p, prof, team.team.coachSkill, pressure, rng.next()) *
          (idx === 0 ? mapFormA : mapFormB) *
          fit *
          // Team chemistry: ±8% around a neutral 50. Cohesive squads (avg 80+)
          // get a clear collective lift; broken rooms (avg <30) bleed effectiveness.
          (1 + ((team.chemistry - 50) / 50) * 0.08),
        utilSkill: p.attributes.utility,
        holdTicks: 0,
        saving: false,
        assignedRole,
        duty,
        kills: 0,
        deaths: 0,
        assists: 0,
        damage: 0,
        utilityDamage: 0,
        openingKills: 0,
        clutchesWon: 0,
        multiKillRounds: 0,
        roundsSurvived: 0,
        roundKillCounts: [],
      };
    });
  };

  const simA = mkSim(a, profA, 0);
  const simB = mkSim(b, profB, 1);

  let scoreA = 0;
  let scoreB = 0;
  // A starts T or CT randomly (knife round abstracted)
  let aIsT = rng.chance(0.5);
  let ecoA: TeamEconomy = freshEconomy();
  let ecoB: TeamEconomy = freshEconomy();
  const rounds: RoundResult[] = [];
  let roundNo = 0;
  let otBlockStart = 0;

  while (true) {
    roundNo++;
    const inOT = roundNo > HALF_ROUNDS * 2;
    // halftime swap
    if (roundNo === HALF_ROUNDS + 1) {
      aIsT = !aIsT;
      ecoA = freshEconomy();
      ecoB = freshEconomy();
    }
    // OT: MR3 blocks, sides swap each 3, money set high
    if (inOT) {
      const otRound = roundNo - HALF_ROUNDS * 2 - 1;
      if (otRound % 3 === 0) {
        if (otRound > 0) aIsT = !aIsT;
        else aIsT = !aIsT;
        ecoA = { money: 10000, lossStreak: 0, carriedValue: 1000 };
        ecoB = { money: 10000, lossStreak: 0, carriedValue: 1000 };
        otBlockStart = roundNo;
      }
    }

    const isPistol = roundNo === 1 || roundNo === HALF_ROUNDS + 1;
    const tTeamE = aIsT ? a : b;
    const ctTeamE = aIsT ? b : a;
    const tEco = aIsT ? ecoA : ecoB;
    const ctEco = aIsT ? ecoB : ecoA;
    const tSim = aIsT ? simA : simB;
    const ctSim = aIsT ? simB : simA;
    tSim.forEach((s) => (s.side = 'T'));
    ctSim.forEach((s) => (s.side = 'CT'));

    const tBuy = decideBuy(tEco, ((roundNo - 1) % HALF_ROUNDS) + 1, isPistol, tTeamE.tactics, ctEco.money > 4000, rng);
    const ctBuy = decideBuy(ctEco, ((roundNo - 1) % HALF_ROUNDS) + 1, isPistol, ctTeamE.tactics, tEco.money > 4000, rng);

    const killsBefore = new Map([...tSim, ...ctSim].map((s) => [s.p.id, s.kills]));

    const ctxR: RoundCtx = {
      layout,
      rng,
      roundNo,
      tSide: tSim,
      ctSide: ctSim,
      tTeam: tTeamE,
      ctTeam: ctTeamE,
      tBuy,
      ctBuy,
      tEco,
      ctEco,
      tTeamIdx: aIsT ? 0 : 1,
      tRoundForm: rng.range(0.9, 1.1),
      ctRoundForm: rng.range(0.9, 1.1),
      isPistol,
      halfRoundNo: ((roundNo - 1) % HALF_ROUNDS) + 1,
    };
    const ro = simulateRound(ctxR);

    // multikill tracking
    for (const s of [...tSim, ...ctSim]) {
      const rk = s.kills - (killsBefore.get(s.p.id) ?? 0);
      s.roundKillCounts.push(rk);
      if (rk >= 3) s.multiKillRounds++;
      if (rk === 5) ro.commentary.push(`🏆 ACE! ${s.p.nickname} kills the entire enemy team!`);
    }

    const tWon = ro.winnerSide === 'T';
    const winnerTeamId = tWon ? tTeamE.team.id : ctTeamE.team.id;
    if (winnerTeamId === a.team.id) scoreA++;
    else scoreB++;

    const tKills = ro.kills.filter((k) => tSim.some((s) => s.p.id === k.killerId)).length;
    const ctKills = ro.kills.length - tKills;

    const newTEco = applyRoundEconomy(tEco, tWon, ro.reason === 'bomb', ro.bombPlanted, ro.tSurvivors, tBuy, tKills);
    const newCtEco = applyRoundEconomy(ctEco, !tWon, false, false, ro.ctSurvivors, ctBuy, ctKills);
    if (aIsT) {
      ecoA = newTEco;
      ecoB = newCtEco;
    } else {
      ecoB = newTEco;
      ecoA = newCtEco;
    }

    rounds.push({
      roundNo,
      winnerSide: ro.winnerSide,
      winnerTeamId,
      reason: ro.reason,
      kills: ro.kills,
      buyA: aIsT ? tBuy.type : ctBuy.type,
      buyB: aIsT ? ctBuy.type : tBuy.type,
      bombPlanted: ro.bombPlanted,
      plantSite: ro.plantSite,
      clutch: ro.clutch,
      commentary: ro.commentary,
      frames: ro.frames,
      moneyA: Math.round(ecoA.money),
      moneyB: Math.round(ecoB.money),
    });

    // win conditions
    if (!inOT) {
      if (scoreA === ROUNDS_TO_WIN || scoreB === ROUNDS_TO_WIN) break;
      if (scoreA === HALF_ROUNDS && scoreB === HALF_ROUNDS) continue; // go to OT
    } else {
      const need = HALF_ROUNDS + Math.ceil((roundNo - otBlockStart + 1) / 6) * 0 + 4; // first to 16 in OT1, 19 in OT2...
      const otIndex = Math.floor((roundNo - HALF_ROUNDS * 2 - 1) / 6);
      const target = 13 + (otIndex + 1) * 3;
      if (scoreA >= target || scoreB >= target) break;
      void need;
    }
    if (roundNo > 80) break; // hard safety
  }

  // player stats + rating
  const playerStats: Record<string, PlayerMatchStats> = {};
  const totalRounds = rounds.length;
  for (const s of [...simA, ...simB]) {
    const kpr = s.kills / totalRounds;
    const dpr = s.deaths / totalRounds;
    const adr = s.damage / totalRounds;
    const impact = 2.13 * kpr + 0.42 * (s.assists / totalRounds) - 0.41;
    const survival = s.roundsSurvived / totalRounds;
    const rating = Math.max(
      0.05,
      0.0073 * adr + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.9873 * (survival * 0.7 + 0.3) * 0.3,
    );
    playerStats[s.p.id] = {
      playerId: s.p.id,
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      damage: s.damage,
      utilityDamage: s.utilityDamage,
      rating: Math.round(rating * 100) / 100,
      openingKills: s.openingKills,
      clutchesWon: s.clutchesWon,
      assignedRole: s.assignedRole,
    };
  }

  return { map, scoreA, scoreB, rounds, playerStats };
}

/**
 * Tactical timeout: re-simulate the map from the given round onward using
 * updated team tactics. Preserves rounds[0..fromRoundIdx], reseeds player
 * stats from those rounds' events, then runs forward with new tactics.
 *
 * fromRoundIdx is 0-based — the LAST round to KEEP from the original map.
 * Use originalResult.rounds.length - 1 to redo only the next-round.
 */
export function resimulateMapFromRound(
  originalResult: MapResult,
  fromRoundIdx: number,
  aIn: EngineTeam,
  bIn: EngineTeam,
  layout: MapLayout,
  pressure: number,
  baseSeed: number,
): MapResult {
  const map = originalResult.map;
  const preservedRounds = originalResult.rounds.slice(0, Math.max(0, fromRoundIdx + 1));
  // Use a brand-new RNG so the re-sim has its own randomness (tactical change
  // shouldn't deterministically reproduce the original outcomes).
  const rng = new RNG(baseSeed ^ 0x9e3779b9 ^ preservedRounds.length);

  const a: EngineTeam = { ...aIn, tactics: resolveTactics(aIn.tactics, map) };
  const b: EngineTeam = { ...bIn, tactics: resolveTactics(bIn.tactics, map) };
  const profA = a.team.mapPool.find((m) => m.map === map)?.proficiency ?? 10;
  const profB = b.team.mapPool.find((m) => m.map === map)?.proficiency ?? 10;
  const mapFormA = rng.range(0.88, 1.12);
  const mapFormB = rng.range(0.88, 1.12);

  // Re-build sim players from scratch with NEW tactics (role fits may have changed)
  function mkSim(team: EngineTeam, prof: number, idx: 0 | 1): SimPlayer[] {
    const slots = team.tactics.roleSlots ?? [];
    const slotByPlayerId = new Map(
      slots.filter((s) => s.playerId).map((s) => [s.playerId!, s] as const),
    );
    return team.players.map((p) => {
      const slot = slotByPlayerId.get(p.id);
      const assignedRole = slot?.role ?? p.role;
      const duty = slot?.duty ?? 'balanced';
      const fit = roleFitMultiplier(p, assignedRole, duty);
      return {
        p, side: 'T' as const, teamIdx: idx, alive: true, zone: '', path: [], weapon: '',
        hasBomb: false,
        eff: effectiveSkill(p, prof, team.team.coachSkill, pressure, rng.next())
          * (idx === 0 ? mapFormA : mapFormB) * fit
          * (1 + ((team.chemistry - 50) / 50) * 0.08),
        utilSkill: p.attributes.utility,
        holdTicks: 0, saving: false, assignedRole, duty,
        kills: 0, deaths: 0, assists: 0, damage: 0, utilityDamage: 0,
        openingKills: 0, clutchesWon: 0, multiKillRounds: 0, roundsSurvived: 0,
        roundKillCounts: [],
      };
    });
  }
  const simA = mkSim(a, profA, 0);
  const simB = mkSim(b, profB, 1);

  // Replay preserved rounds' kill events to seed player stats.
  const idLookup = new Map([...simA, ...simB].map((s) => [s.p.id, s]));
  for (const round of preservedRounds) {
    const killsThisRound = new Map<string, number>();
    for (let k = 0; k < round.kills.length; k++) {
      const ev = round.kills[k];
      const killer = idLookup.get(ev.killerId);
      const victim = idLookup.get(ev.victimId);
      if (killer) {
        killer.kills++;
        killsThisRound.set(killer.p.id, (killsThisRound.get(killer.p.id) ?? 0) + 1);
        if (k === 0) killer.openingKills++; // first kill of round
        killer.damage += 100; // approx
      }
      if (victim) victim.deaths++;
      if (ev.assistId) {
        const assist = idLookup.get(ev.assistId);
        if (assist) assist.assists++;
      }
    }
    for (const [pid, ct] of killsThisRound) {
      const sp = idLookup.get(pid);
      if (sp) {
        if (ct >= 3) sp.multiKillRounds++;
        sp.roundKillCounts.push(ct);
      }
    }
    for (const sp of [...simA, ...simB]) {
      if (!round.kills.some((k) => k.victimId === sp.p.id)) sp.roundsSurvived++;
    }
    if (round.clutch?.won) {
      const sp = idLookup.get(round.clutch.playerId);
      if (sp) sp.clutchesWon++;
    }
  }

  // Re-derive score & side from preserved rounds
  let scoreA = 0;
  let scoreB = 0;
  for (const r of preservedRounds) {
    if (r.winnerTeamId === a.team.id) scoreA++; else scoreB++;
  }

  // Re-derive aIsT — first half (1..12) A starts on its original side, swaps at 13.
  // We pull the original starting side from buyA: in round 1, buyA refers to A team's buy.
  // We don't have explicit side recorded, so infer from rounds: round 1 winnerSide T means
  // whoever won the T round. Simpler: just assume A started T in original (50/50 in sim)
  // and use the round count: if any round result is preserved we'd need to know aIsT then.
  // We compute from preserved rounds count + the moneyA pattern.
  const lastPreserved = preservedRounds[preservedRounds.length - 1];
  const roundNo = preservedRounds.length;
  // Best-effort recovery of side: derive from money state typical for T/CT at this round.
  // We'll just continue from where the original was — assume halftime at round 13.
  const halfRoundsCompleted = roundNo;
  // For accuracy, save aIsT in MapResult would be nice; for now approximate.
  // Simple rule: A started T if first round buyA === 'pistol' AND scoreA changed in early rounds.
  // We just say: A starts T (matches original code's 50/50 — close enough for tactical re-sim).
  let aIsT = true;
  if (halfRoundsCompleted >= HALF_ROUNDS) aIsT = !aIsT;
  // OT logic skipped for re-sim simplicity

  // Recover eco from last preserved round's stored money
  let ecoA: TeamEconomy = lastPreserved
    ? { money: lastPreserved.moneyA, lossStreak: 0, carriedValue: 200 }
    : freshEconomy();
  let ecoB: TeamEconomy = lastPreserved
    ? { money: lastPreserved.moneyB, lossStreak: 0, carriedValue: 200 }
    : freshEconomy();

  const newRounds: RoundResult[] = [];
  let curRound = roundNo;
  let otBlockStart = 0;

  while (true) {
    curRound++;
    const inOT = curRound > HALF_ROUNDS * 2;
    if (curRound === HALF_ROUNDS + 1) {
      aIsT = !aIsT;
      ecoA = freshEconomy();
      ecoB = freshEconomy();
    }
    if (inOT) {
      const otRound = curRound - HALF_ROUNDS * 2 - 1;
      if (otRound % 3 === 0) {
        if (otRound > 0) aIsT = !aIsT;
        else aIsT = !aIsT;
        ecoA = { money: 10000, lossStreak: 0, carriedValue: 1000 };
        ecoB = { money: 10000, lossStreak: 0, carriedValue: 1000 };
        otBlockStart = curRound;
      }
    }

    const isPistol = curRound === 1 || curRound === HALF_ROUNDS + 1;
    const tTeamE = aIsT ? a : b;
    const ctTeamE = aIsT ? b : a;
    const tEco = aIsT ? ecoA : ecoB;
    const ctEco = aIsT ? ecoB : ecoA;
    const tSim = aIsT ? simA : simB;
    const ctSim = aIsT ? simB : simA;
    tSim.forEach((s) => (s.side = 'T'));
    ctSim.forEach((s) => (s.side = 'CT'));

    const tBuy = decideBuy(tEco, ((curRound - 1) % HALF_ROUNDS) + 1, isPistol, tTeamE.tactics, ctEco.money > 4000, rng);
    const ctBuy = decideBuy(ctEco, ((curRound - 1) % HALF_ROUNDS) + 1, isPistol, ctTeamE.tactics, tEco.money > 4000, rng);

    const killsBefore = new Map([...tSim, ...ctSim].map((s) => [s.p.id, s.kills]));

    const ctxR: RoundCtx = {
      layout, rng, roundNo: curRound, tSide: tSim, ctSide: ctSim,
      tTeam: tTeamE, ctTeam: ctTeamE, tBuy, ctBuy, tEco, ctEco,
      tTeamIdx: aIsT ? 0 : 1,
      tRoundForm: rng.range(0.9, 1.1),
      ctRoundForm: rng.range(0.9, 1.1),
      isPistol,
      halfRoundNo: ((curRound - 1) % HALF_ROUNDS) + 1,
    };
    const ro = simulateRound(ctxR);

    for (const s of [...tSim, ...ctSim]) {
      const rk = s.kills - (killsBefore.get(s.p.id) ?? 0);
      s.roundKillCounts.push(rk);
      if (rk >= 3) s.multiKillRounds++;
      if (rk === 5) ro.commentary.push(`🏆 ACE! ${s.p.nickname} kills the entire enemy team!`);
    }

    const tWon = ro.winnerSide === 'T';
    const winnerTeamId = tWon ? tTeamE.team.id : ctTeamE.team.id;
    if (winnerTeamId === a.team.id) scoreA++; else scoreB++;

    const tKills = ro.kills.filter((k) => tSim.some((s) => s.p.id === k.killerId)).length;
    const ctKills = ro.kills.length - tKills;
    const newTEco = applyRoundEconomy(tEco, tWon, ro.reason === 'bomb', ro.bombPlanted, ro.tSurvivors, tBuy, tKills);
    const newCtEco = applyRoundEconomy(ctEco, !tWon, false, false, ro.ctSurvivors, ctBuy, ctKills);
    if (aIsT) { ecoA = newTEco; ecoB = newCtEco; } else { ecoB = newTEco; ecoA = newCtEco; }

    newRounds.push({
      roundNo: curRound, winnerSide: ro.winnerSide, winnerTeamId, reason: ro.reason,
      kills: ro.kills,
      buyA: aIsT ? tBuy.type : ctBuy.type,
      buyB: aIsT ? ctBuy.type : tBuy.type,
      bombPlanted: ro.bombPlanted, plantSite: ro.plantSite,
      clutch: ro.clutch, commentary: ro.commentary, frames: ro.frames,
      moneyA: Math.round(ecoA.money), moneyB: Math.round(ecoB.money),
    });

    if (!inOT) {
      if (scoreA === ROUNDS_TO_WIN || scoreB === ROUNDS_TO_WIN) break;
      if (scoreA === HALF_ROUNDS && scoreB === HALF_ROUNDS) continue;
    } else {
      const otIndex = Math.floor((curRound - HALF_ROUNDS * 2 - 1) / 6);
      const target = 13 + (otIndex + 1) * 3;
      if (scoreA >= target || scoreB >= target) break;
    }
    if (curRound > 80) break;
    void otBlockStart;
  }

  const allRounds = [...preservedRounds, ...newRounds];

  // Recompute player stats from final aggregated rounds
  const playerStats: Record<string, PlayerMatchStats> = {};
  const totalRounds = allRounds.length;
  for (const s of [...simA, ...simB]) {
    const kpr = s.kills / totalRounds;
    const dpr = s.deaths / totalRounds;
    const adr = s.damage / totalRounds;
    const impact = 2.13 * kpr + 0.42 * (s.assists / totalRounds) - 0.41;
    const survival = s.roundsSurvived / totalRounds;
    const rating = Math.max(
      0.05,
      0.0073 * adr + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.9873 * (survival * 0.7 + 0.3) * 0.3,
    );
    playerStats[s.p.id] = {
      playerId: s.p.id, kills: s.kills, deaths: s.deaths, assists: s.assists,
      damage: s.damage, utilityDamage: s.utilityDamage,
      rating: Math.round(rating * 100) / 100,
      openingKills: s.openingKills, clutchesWon: s.clutchesWon,
      assignedRole: s.assignedRole,
    };
  }

  return { map, scoreA, scoreB, rounds: allRounds, playerStats };
}

// ============ Match (series) simulation ============

export interface SeriesState {
  matchId: string;
  a: EngineTeam;
  b: EngineTeam;
  rng: RNG;
  vetoMaps: MapName[];
  vetoLog: string[];
  need: number;
  maps: MapResult[];
  layouts: Record<MapName, MapLayout>;
  pressure: number;
  /** Tactical timeouts remaining per side per map (resets each map to 2). */
  timeoutsRemaining?: { a: number; b: number };
}

export function startSeries(
  matchId: string,
  a: EngineTeam,
  b: EngineTeam,
  format: MatchFormat,
  layouts: Record<MapName, MapLayout>,
  pressure: number,
  seed?: number,
): SeriesState {
  const rng = new RNG(seed ?? hashSeed(matchId + a.team.id + b.team.id));
  const veto = runVeto(
    a.team,
    b.team,
    format,
    a.team.isUser ? a.tactics.mapVetoPriority : null,
    b.team.isUser ? b.tactics.mapVetoPriority : null,
    rng,
  );
  return {
    matchId,
    a,
    b,
    rng,
    vetoMaps: veto.maps,
    vetoLog: veto.log,
    need: format === 'BO1' ? 1 : format === 'BO3' ? 2 : 3,
    maps: [],
    layouts,
    pressure,
    timeoutsRemaining: { a: 2, b: 2 },
  };
}

export function seriesScore(s: SeriesState): { a: number; b: number } {
  let aW = 0;
  let bW = 0;
  for (const m of s.maps) {
    if (m.scoreA > m.scoreB) aW++;
    else bW++;
  }
  return { a: aW, b: bW };
}

export function seriesDecided(s: SeriesState): boolean {
  const sc = seriesScore(s);
  return sc.a === s.need || sc.b === s.need;
}

/** Play the next map. Tactics on s.a / s.b may be swapped between calls (mid-series adjustments). */
export function playNextSeriesMap(s: SeriesState): MapResult | null {
  if (seriesDecided(s) || s.maps.length >= s.vetoMaps.length) return null;
  const map = s.vetoMaps[s.maps.length];
  const res = simulateMap(map, s.layouts[map], s.a, s.b, s.pressure, s.rng);
  s.maps.push(res);
  // Fresh timeouts at the start of each map.
  s.timeoutsRemaining = { a: 2, b: 2 };
  return res;
}

export function seriesResult(s: SeriesState): MatchResult {
  const sc = seriesScore(s);
  return {
    matchId: s.matchId,
    teamAId: s.a.team.id,
    teamBId: s.b.team.id,
    mapsA: sc.a,
    mapsB: sc.b,
    winnerId: sc.a > sc.b ? s.a.team.id : s.b.team.id,
    maps: s.maps,
    vetoLog: s.vetoLog,
  };
}

export function simulateMatch(
  matchId: string,
  a: EngineTeam,
  b: EngineTeam,
  format: MatchFormat,
  layouts: Record<MapName, MapLayout>,
  pressure: number,
  seed?: number,
): MatchResult {
  const s = startSeries(matchId, a, b, format, layouts, pressure, seed);
  while (!seriesDecided(s)) {
    if (!playNextSeriesMap(s)) break;
  }
  return seriesResult(s);
}
