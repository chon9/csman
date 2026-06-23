import type {
  FinanceRecord,
  Injury,
  InjurySeverity,
  InjuryType,
  MatchResult,
  Player,
  Team,
  TrainingSetup,
  TransferOffer,
} from '../types';
import { ATTRIBUTE_KEYS } from '../types';
import type { RNG } from '../engine/rng';
import { topAttrsForRole } from './playerAnalytics';
import { addDays } from './calendar';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Post-match: form/morale/fatigue/stats for every participant */
export function applyMatchAftermath(
  players: Record<string, Player>,
  result: MatchResult,
): void {
  for (const map of result.maps) {
    for (const ps of Object.values(map.playerStats)) {
      const p = players[ps.playerId];
      if (!p) continue;
      p.stats.maps++;
      p.stats.kills += ps.kills;
      p.stats.deaths += ps.deaths;
      p.stats.assists += ps.assists;
      p.stats.openingKills += ps.openingKills;
      p.stats.clutchesWon += ps.clutchesWon;
      p.stats.utilityDamage += ps.utilityDamage;
      // FM-style role familiarity gain: +1 per map at the assigned role, capped at 200.
      // A full season (~80 maps) lifts a fresh role from Awkward → Accomplished.
      if (ps.assignedRole) {
        if (!p.roleExperience) p.roleExperience = {};
        p.roleExperience[ps.assignedRole] = Math.min(
          200,
          (p.roleExperience[ps.assignedRole] ?? 0) + 1,
        );
      }
      // running avg rating
      p.stats.rating = Math.round(((p.stats.rating * (p.stats.maps - 1) + ps.rating) / p.stats.maps) * 100) / 100;
      // form: drift toward performance
      const perfForm = clamp(10 + (ps.rating - 1.0) * 8, 1, 20);
      p.form = clamp(Math.round((p.form * 0.7 + perfForm * 0.3) * 10) / 10, 1, 20);
      // Fatigue accumulation scales inversely with endurance: hardy players
      // (END 16+) gain ~4/match, fragile players (END 5) gain ~9/match.
      const fatigueGain = 9 - (p.attributes.endurance / 20) * 6;
      p.fatigue = clamp(p.fatigue + fatigueGain, 0, 100);
    }
  }
  // morale by match result
  const winners = result.winnerId;
  for (const map of result.maps) {
    for (const ps of Object.values(map.playerStats)) {
      const p = players[ps.playerId];
      if (!p || !p.teamId) continue;
      const won = p.teamId === winners;
      // High resilience dampens negative morale swings (won't tilt after a loss)
      // but doesn't suppress wins. Loss penalty range: −0.5 (RES 20) to −1.2 (RES 1).
      const lossDamper = won ? 1 : 0.5 + (15 - p.attributes.resilience) / 25;
      p.morale = clamp(p.morale + (won ? 0.8 : -0.9 * lossDamper), 1, 20);
    }
  }
}

/** Every day for every player */
/** A single injury event produced by dailyPlayerTick. The caller turns this
 *  into inbox/news entries appropriate to whether it's a user or AI player. */
export interface InjuryEvent {
  playerId: string;
  injury: Injury;
  recovered?: boolean;
}

const INJURY_DESCRIPTIONS: Record<InjuryType, string[]> = {
  'wrist-strain': [
    'Wrist strain after a heavy scrim block.',
    'Sharp pain in the wrist — needs rest.',
    'Mouse-hand strain flaring up again.',
  ],
  rsi: [
    'Repetitive strain injury flare-up — out of practice.',
    'RSI symptoms returning under heavy load.',
    'Doctors prescribe rest for the wrists.',
  ],
  'back-pain': [
    'Back stiffness from long session chairs.',
    'Lower-back pain forcing time off.',
    'Posture-related back issues.',
  ],
  burnout: [
    'Mental fatigue from a brutal tournament block.',
    'Full burnout — needs a step back.',
    'Team confirms a mental-health break.',
  ],
  illness: [
    'Caught the flu at the team house.',
    'Stomach bug going around the bootcamp.',
    'Doctors confirm a viral infection.',
  ],
  'wrist-surgery': [
    'Wrist surgery booked — extended recovery.',
    'Pre-existing wrist condition needs operating on.',
    'Surgeon clears player for a corrective procedure.',
  ],
};

/** Severity → return-day band. Stored on the Injury for reference. */
const SEVERITY_BANDS: Record<InjurySeverity, [number, number]> = {
  minor: [3, 10],
  moderate: [10, 25],
  major: [25, 60],
};

function pickInjuryType(trigger: 'fatigue' | 'match' | 'training', rng: RNG): InjuryType {
  if (trigger === 'fatigue') {
    return rng.pick(['wrist-strain', 'rsi', 'back-pain', 'burnout', 'burnout'] as InjuryType[]);
  }
  if (trigger === 'match') {
    return rng.pick(['wrist-strain', 'back-pain', 'illness'] as InjuryType[]);
  }
  return rng.pick(['rsi', 'wrist-strain', 'illness'] as InjuryType[]);
}

function rollSeverity(rng: RNG): InjurySeverity {
  const roll = rng.next();
  if (roll < 0.60) return 'minor';
  if (roll < 0.90) return 'moderate';
  return 'major';
}

function buildInjury(
  trigger: 'fatigue' | 'match' | 'training',
  today: string,
  rng: RNG,
  physioMul: number,
): Injury {
  const type = pickInjuryType(trigger, rng);
  // wrist-surgery has its own rare path — bypass severity roll
  let severity: InjurySeverity;
  if (rng.chance(0.01)) {
    severity = 'major';
  } else {
    severity = rollSeverity(rng);
  }
  const [minDays, maxDays] = SEVERITY_BANDS[severity];
  // Physio cuts return time (up to −40%).
  const baseDays = rng.int(minDays, maxDays);
  const days = Math.max(2, Math.round(baseDays * (1 / Math.max(1, physioMul))));
  return {
    type,
    severity,
    startedOn: today,
    returnDate: addDays(today, days),
    description: rng.pick(INJURY_DESCRIPTIONS[type]),
  };
}

export function dailyPlayerTick(
  players: Record<string, Player>,
  today: string,
  rng: RNG,
  /** Optional: user team id + physio skill — applies a fatigue-recovery boost to user players only. */
  physioBoost?: { userTeamId: string; physioSkill: number } | null,
): InjuryEvent[] {
  const physioMul =
    physioBoost && physioBoost.physioSkill > 0
      ? Math.max(1, 0.6 + physioBoost.physioSkill / 12)
      : 1;
  const events: InjuryEvent[] = [];
  for (const p of Object.values(players)) {
    // Recovery check — clear injury if return date reached.
    if (p.injury && today >= p.injury.returnDate) {
      events.push({ playerId: p.id, injury: p.injury, recovered: true });
      delete p.injury;
      // Small form/morale recovery bump when returning to full training.
      p.morale = clamp(p.morale + 1, 1, 20);
    }
    // Endurance gates recovery speed: hardy players bounce back from fatigue
    // faster. END 5 → 1.5/day, END 10 → 3/day (baseline), END 18 → 5/day.
    const baseRecovery = 1.5 + (p.attributes.endurance / 20) * 4;
    const userBoost = physioBoost && p.teamId === physioBoost.userTeamId ? physioMul : 1;
    p.fatigue = clamp(p.fatigue - baseRecovery * userBoost, 0, 100);
    // Resilience accelerates drift back to neutral form/morale after slumps/highs.
    // High resilience = bounces back fast, low resilience = lingers in slumps.
    const driftMul = 0.5 + (p.attributes.resilience / 20) * 1.0;
    p.form = clamp(p.form + (10 - p.form) * 0.02 * driftMul, 1, 20);
    p.morale = clamp(p.morale + (12 - p.morale) * 0.015 * driftMul, 1, 20);

    // Injury roll — skip if already injured, on contract-free FA, or under 18.
    if (p.injury || !p.teamId || p.age < 17) continue;
    // Heavy-fatigue trigger: linear 0% at <75 fatigue → 4%/day at 100.
    // Endurance attribute divides risk.
    let p_inj = 0;
    if (p.fatigue >= 75) {
      p_inj = ((p.fatigue - 75) / 25) * 0.04;
      p_inj /= 1 + p.attributes.endurance / 30;
    }
    // Tiny background daily roll for illness/random (~0.1%/day per player).
    p_inj += 0.001;
    if (rng.chance(p_inj)) {
      const trigger: 'fatigue' | 'match' | 'training' = p.fatigue >= 75 ? 'fatigue' : 'training';
      const newInjury = buildInjury(
        trigger,
        today,
        rng,
        physioBoost && p.teamId === physioBoost.userTeamId ? physioMul : 1,
      );
      p.injury = newInjury;
      p.form = clamp(p.form - 2.5, 1, 20);
      p.morale = clamp(p.morale - 1, 1, 20);
      events.push({ playerId: p.id, injury: newInjury });
    }
  }
  return events;
}

/** Attribute targets a focus drills into. Empty for rest / map-prep. */
const FOCUS_ATTRS: Record<TrainingSetup['focus'], (keyof Player['attributes'])[]> = {
  aim: ['aim', 'reflexes'],
  utility: ['utility', 'positioning'],
  tactics: ['gameSense', 'positioning'],
  teamplay: ['teamwork', 'communication'],
  rest: [],
  'map-prep': [],
};

/** Per-player attr group (independent of team focus). 'composure' is an
 *  individual-only option not in TrainingFocus. */
const INDIVIDUAL_FOCUS_ATTRS: Record<string, (keyof Player['attributes'])[]> = {
  aim: ['aim', 'reflexes'],
  utility: ['utility', 'positioning'],
  tactics: ['gameSense', 'leadership'],
  teamplay: ['teamwork', 'communication'],
  composure: ['composure', 'resilience', 'clutch'],
};

/**
 * Resolve which attributes a player actually trains this week. Personal
 * settings on the player override the team focus:
 *   1. developmentTarget (role retrain) → top attrs for that role
 *   2. individualFocus (attr group, not 'auto') → that group's attrs
 *   3. fallback → team focus attrs
 *
 * Exported so the forecast helper + UI stay in sync with the engine.
 */
export function resolvePlayerFocusAttrs(
  player: Player,
  teamFocusAttrs: (keyof Player['attributes'])[],
): { attrs: (keyof Player['attributes'])[]; source: 'role' | 'individual' | 'team' } {
  if (player.developmentTarget) {
    return { attrs: topAttrsForRole(player.developmentTarget, 4), source: 'role' };
  }
  if (player.individualFocus && player.individualFocus !== 'auto') {
    const attrs = INDIVIDUAL_FOCUS_ATTRS[player.individualFocus];
    if (attrs) return { attrs, source: 'individual' };
  }
  return { attrs: teamFocusAttrs, source: 'team' };
}

/** Weekly (Mondays): training growth + overtraining regression + staleness penalties. */
export interface WeeklyTrainingResult {
  notes: string[];
  gains: number;
  regressions: number;
}

/** Per-player forecast for the *next* weekly training tick — exposes the same
 *  math `applyWeeklyTraining` uses so the UI can show the squad's expected
 *  outcomes (growth chances, cap status, regression risk) before Monday hits. */
export interface PlayerTrainingForecast {
  playerId: string;
  /** Attribute keys this focus targets (empty for rest/map-prep). */
  focusAttrs: (keyof Player['attributes'])[];
  /** Per-attribute growth probability (0-1) — same value across each target attr. */
  perAttrGrowChance: number;
  /** Sum of growth chances across target attrs (≈ expected attribute points gained). */
  expectedGains: number;
  /** Chance of attribute regression from overtraining (0-1). */
  regressionChance: number;
  /** Chance of -1 form (veteran wear) from heavy training on 30+ players. */
  veteranWearChance: number;
  /** Player's current ability is at potential cap — no growth possible. */
  capReached: boolean;
  /** Attributes already at 20 — can't grow further. */
  cappedAttrs: (keyof Player['attributes'])[];
  /** Predicted fatigue change (+/-). */
  fatigueDelta: number;
  /** Short reason string when there is no expected gain (e.g. "PA cap", "too old", "rest week"). */
  blocker: string | null;
  /** Where the focus came from — useful for UI badges (Personal / Role / Team). */
  focusSource: 'team' | 'individual' | 'role';
}

export interface WeeklyTrainingForecast {
  focus: TrainingSetup['focus'];
  intensity: TrainingSetup['intensity'];
  focusAttrs: (keyof Player['attributes'])[];
  /** Cumulative multipliers shared across the squad. */
  staleMul: number;
  specialistMul: number;
  /** Streak of weeks on this focus (1 = first week). */
  streak: number;
  /** Per-player forecasts (only first team + reserves passed in). */
  players: PlayerTrainingForecast[];
}

export function forecastWeeklyTraining(
  team: Team,
  players: Record<string, Player>,
  training: TrainingSetup,
  coachForFocus?: (focus: TrainingSetup['focus']) => { skill: number } | null,
): WeeklyTrainingForecast {
  const teamFocusAttrs = FOCUS_ATTRS[training.focus];
  const specialist = coachForFocus?.(training.focus) ?? null;
  const specialistMul = specialist ? Math.max(0.5, Math.min(1.8, 0.4 + specialist.skill / 12)) : 1.0;
  const streak = training.focusStreak ?? 1;
  const staleMul = streak <= 2 ? 1.0 : Math.max(0.3, 1.0 - (streak - 2) * 0.18);

  const forecasts: PlayerTrainingForecast[] = team.playerIds.map((id) => {
    const p = players[id];
    if (!p) {
      return {
        playerId: id, focusAttrs: [], perAttrGrowChance: 0, expectedGains: 0,
        regressionChance: 0, veteranWearChance: 0, capReached: false,
        cappedAttrs: [], fatigueDelta: 0, blocker: 'missing player', focusSource: 'team',
      };
    }
    const fatigueDelta = training.focus === 'rest' ? -18 : training.intensity * 4 - 4;

    if (training.focus === 'rest') {
      return {
        playerId: id, focusAttrs: [], perAttrGrowChance: 0, expectedGains: 0,
        regressionChance: 0, veteranWearChance: 0, capReached: false,
        cappedAttrs: [], fatigueDelta, blocker: 'rest week — recovery only', focusSource: 'team',
      };
    }
    if (training.focus === 'map-prep') {
      return {
        playerId: id, focusAttrs: [], perAttrGrowChance: 0, expectedGains: 0,
        regressionChance: 0, veteranWearChance: 0, capReached: false,
        cappedAttrs: [], fatigueDelta, blocker: 'map prep — squad-wide map work, no attr growth', focusSource: 'team',
      };
    }

    // Personal training overrides team focus for this player.
    const { attrs: playerAttrs, source: focusSource } = resolvePlayerFocusAttrs(p, teamFocusAttrs);

    const regressionChance = training.intensity >= 3 && p.fatigue > 80 ? 0.06 : 0;
    const veteranWearChance = training.intensity === 3 && p.age >= 30 ? 0.35 : 0;
    const cappedAttrs = playerAttrs.filter((a) => p.attributes[a] >= 20);
    const headroom = p.potentialAbility - p.currentAbility;
    const capReached = headroom <= 0;

    let blocker: string | null = null;
    if (capReached) blocker = `at potential (CA ${p.currentAbility}/${p.potentialAbility})`;
    else if (playerAttrs.length > 0 && cappedAttrs.length === playerAttrs.length) blocker = 'all focus attrs already 20';
    else if (p.age > 29) blocker = 'past peak age (30+) — growth heavily reduced';

    const ageFactor = p.age <= 21 ? 1.0 : p.age <= 25 ? 0.6 : p.age <= 29 ? 0.3 : 0.1;
    // Specialist only helps players following the TEAM focus; personal training
    // bypasses the specialist boost and pays a small 0.85× efficiency tax.
    // Mirrors applyWeeklyTraining.
    const effectiveSpecialistMul = focusSource === 'team' ? specialistMul : 1.0;
    const personalMul = focusSource === 'team' ? 1.0 : 0.85;
    const perAttrGrowChance = capReached
      ? 0
      : 0.05 * training.intensity * ageFactor * (team.coachSkill / 12) * effectiveSpecialistMul * staleMul * personalMul;
    const growableAttrs = playerAttrs.filter((a) => p.attributes[a] < 20);
    const expectedGains = capReached ? 0 : perAttrGrowChance * growableAttrs.length;

    return {
      playerId: id,
      focusAttrs: playerAttrs,
      perAttrGrowChance,
      expectedGains,
      regressionChance,
      veteranWearChance,
      capReached,
      cappedAttrs,
      fatigueDelta,
      blocker,
      focusSource,
    };
  });

  return {
    focus: training.focus,
    intensity: training.intensity,
    focusAttrs: teamFocusAttrs,
    staleMul,
    specialistMul,
    streak,
    players: forecasts,
  };
}

export function applyWeeklyTraining(
  team: Team,
  players: Record<string, Player>,
  training: TrainingSetup,
  rng: RNG,
  /** Optional specialist coach lookup. The relevant coach's skill multiplies training gains. */
  coachForFocus?: (focus: TrainingSetup['focus']) => { skill: number } | null,
): WeeklyTrainingResult {
  const notes: string[] = [];
  let gains = 0;
  let regressions = 0;
  if (training.focus === 'rest') {
    for (const id of team.playerIds) {
      const p = players[id];
      if (p) {
        p.fatigue = clamp(p.fatigue - 18, 0, 100);
        // Light morale lift on rest weeks — the squad appreciates downtime.
        p.morale = clamp(p.morale + 0.5, 1, 20);
      }
    }
    notes.push('The squad spent the week recovering. Fatigue down, morale up slightly.');
    return { notes, gains, regressions };
  }

  if (training.focus === 'map-prep' && training.mapPrep) {
    const entry = team.mapPool.find((m) => m.map === training.mapPrep);
    if (entry && entry.proficiency < 20) {
      const gain = rng.chance(0.5 + team.coachSkill / 40) ? 1 : 0;
      if (gain) {
        entry.proficiency = clamp(entry.proficiency + 1, 1, 20);
        notes.push(`Map preparation paying off: ${training.mapPrep} proficiency improved to ${entry.proficiency}.`);
      } else {
        notes.push(`The team grinded ${training.mapPrep} this week — progress is coming slowly.`);
      }
    }
    // other maps decay very slowly
    for (const m of team.mapPool) {
      if (m.map !== training.mapPrep && rng.chance(0.06)) m.proficiency = clamp(m.proficiency - 1, 1, 20);
    }
    return { notes, gains, regressions };
  }

  const teamAttrs = FOCUS_ATTRS[training.focus];
  // Specialist coach for this focus area boosts gain probability dramatically.
  // No specialist = 1.0× (baseline). Skill 18 specialist = ~1.6×, skill 6 = ~0.6×.
  const specialist = coachForFocus?.(training.focus) ?? null;
  const specialistMul = specialist ? Math.max(0.5, Math.min(1.8, 0.4 + specialist.skill / 12)) : 1.0;
  if (specialist) {
    notes.push(`(${training.focus} sessions led by specialist coach — skill ${specialist.skill}/20)`);
  }

  // ----- Stale-focus penalty -----
  // Same focus week after week → diminishing returns. After 2 weeks, each
  // additional week shaves 18% off the gain probability (floored at 30%).
  const streak = training.focusStreak ?? 1;
  const staleMul = streak <= 2 ? 1.0 : Math.max(0.3, 1.0 - (streak - 2) * 0.18);
  if (streak >= 3) {
    notes.push(`⚠ Stale focus: ${streak}-week ${training.focus} streak — gains down ${Math.round((1 - staleMul) * 100)}%. Rotate focus or rest soon.`);
  }

  // ----- Squad-wide fatigue check (overtraining risk warning) -----
  const avgFatigue = team.playerIds.reduce(
    (s, id) => s + (players[id]?.fatigue ?? 0),
    0,
  ) / Math.max(1, team.playerIds.length);
  if (training.intensity === 3 && avgFatigue > 65) {
    notes.push(`⚠ Heavy training with avg fatigue ${avgFatigue.toFixed(0)}% — overtraining risk elevated.`);
  }

  for (const id of team.playerIds) {
    const p = players[id];
    if (!p) continue;
    p.fatigue = clamp(p.fatigue + training.intensity * 4 - 4, 0, 100);

    // Personal training overrides team focus for THIS player.
    const { attrs: playerAttrs, source: focusSource } = resolvePlayerFocusAttrs(p, teamAttrs);

    // ----- BAD TRAINING / OVERTRAINING REGRESSION -----
    // Heavy intensity + already-fatigued player → real risk of LOSING an
    // attribute point and a morale dip. The "negative stats from bad training"
    // FM is famous for — pushing a tired squad backfires.
    if (training.intensity >= 3 && p.fatigue > 80 && rng.chance(0.06)) {
      // Pick a random focus attribute to regress (or any attribute if focus has none).
      const pool = playerAttrs.length > 0 ? playerAttrs : (Object.keys(p.attributes) as (keyof Player['attributes'])[]);
      const a = pool[rng.int(0, pool.length - 1)];
      if (p.attributes[a] > 4) {
        p.attributes[a] = clamp(p.attributes[a] - 1, 1, 20);
        p.currentAbility = clamp(p.currentAbility - 2, 1, p.potentialAbility);
        p.morale = clamp(p.morale - 1, 1, 20);
        notes.push(`✗ ${p.nickname} regressed in ${String(a)} (now ${p.attributes[a]}) — burnt out from heavy sessions.`);
        regressions++;
        continue; // skip growth roll for this player this week
      }
    }

    // ----- Veteran wear-and-tear -----
    // Heavy training on 30+ players bleeds form (their bodies don't recover).
    if (training.intensity === 3 && p.age >= 30 && rng.chance(0.35)) {
      p.form = clamp(p.form - 1, 1, 20);
      // No note — too spammy. Visible in the form column.
    }

    // ----- Growth roll (gated by potential + age + stale penalty) -----
    const headroom = p.potentialAbility - p.currentAbility;
    if (headroom <= 0) continue;
    const ageFactor = p.age <= 21 ? 1.0 : p.age <= 25 ? 0.6 : p.age <= 29 ? 0.3 : 0.1;
    // Specialist coach only helps when the team's drill IS what the player is
    // training — a Tactics coach can't sharpen aim during a personal aim block.
    const effectiveSpecialistMul = focusSource === 'team' ? specialistMul : 1.0;
    // Personal-training tax: solo drilling is less efficient than full squad
    // attention, so the chance is shaved slightly.
    const personalMul = focusSource === 'team' ? 1.0 : 0.85;
    // Stale penalty applies team-wide regardless — even the personal-focus
    // players were grinding the same room all week.
    const pGrow = 0.05 * training.intensity * ageFactor * (team.coachSkill / 12) * effectiveSpecialistMul * staleMul * personalMul;
    for (const a of playerAttrs) {
      if (p.attributes[a] < 20 && rng.chance(pGrow)) {
        p.attributes[a] = clamp(p.attributes[a] + 1, 1, 20);
        p.currentAbility = clamp(p.currentAbility + 2, 1, p.potentialAbility);
        const tag = focusSource === 'role' ? ' (role training)' : focusSource === 'individual' ? ' (personal focus)' : '';
        notes.push(`✓ ${p.nickname} improved ${String(a)} to ${p.attributes[a]}${tag}.`);
        gains++;
      }
    }
  }
  return { notes, gains, regressions };
}

/** A single attribute change on a player during monthly development. */
export interface TrainingDelta {
  playerId: string;
  attr: keyof Player['attributes'];
  before: number;
  after: number;
  caBefore: number;
  caAfter: number;
  /** Source: which subsystem produced the change. */
  source: 'youth' | 'decline' | 'wisdom' | 'perf-coach';
}

const FACEIT_BOOST: Record<string, number> = {
  none: 1.0,
  basic: 1.15,
  pro: 1.35,
  premium: 1.65,
};

/** Monthly: ageing & natural development/decline (call on the 1st).
 *  Returns deltas for USER-team players so the caller can build a training report. */
export function monthlyDevelopment(
  players: Record<string, Player>,
  currentDate: string,
  rng: RNG,
  /** Optional: user team id + performance-coach skill — grows composure/resilience for user players. */
  perfCoach?: { userTeamId: string; skill: number } | null,
  /** Optional: Faceit hub subscription on the user team — boosts youth growth chance. */
  faceitTier?: 'none' | 'basic' | 'pro' | 'premium',
  /** Optional mentor-boost lookup: returns multiplier for the given mentee's monthly growth chance. */
  mentorBoost?: (menteeId: string) => number,
): TrainingDelta[] {
  const deltas: TrainingDelta[] = [];
  const userTeamId = perfCoach?.userTeamId;
  function record(p: Player, attr: keyof Player['attributes'], before: number, caBefore: number, source: TrainingDelta['source']): void {
    if (!userTeamId || p.teamId !== userTeamId) return;
    if (p.attributes[attr] === before && p.currentAbility === caBefore) return;
    deltas.push({ playerId: p.id, attr, before, after: p.attributes[attr], caBefore, caAfter: p.currentAbility, source });
  }
  // ageing happens at season rollover, not here
  for (const p of Object.values(players)) {
    // Smooth age-based decline curve: peak through 27, mild decline 28-29, real
    // decline 30+, sharp drop 33+. Replaces the old step-at-30 logic.
    const declineP =
      p.age <= 27 ? 0 : p.age <= 29 ? 0.05 : p.age <= 31 ? 0.12 : p.age <= 33 ? 0.2 : 0.3;
    if (declineP > 0 && rng.chance(declineP)) {
      const a = rng.pick(['reflexes', 'aim'] as const);
      const before = p.attributes[a]; const caBefore = p.currentAbility;
      p.attributes[a] = clamp(p.attributes[a] - 1, 1, 20);
      p.currentAbility = clamp(p.currentAbility - 2, 1, 200);
      record(p, a, before, caBefore, 'decline');
    }
    // Veterans grow in game sense / leadership (slower past mid-30s)
    const wisdomP = p.age >= 28 && p.age <= 33 ? 0.12 : p.age >= 34 ? 0.05 : 0;
    if (wisdomP > 0 && rng.chance(wisdomP)) {
      const a = rng.pick(['gameSense', 'leadership'] as const);
      const before = p.attributes[a]; const caBefore = p.currentAbility;
      p.attributes[a] = clamp(p.attributes[a] + 1, 1, 20);
      record(p, a, before, caBefore, 'wisdom');
    }
    // Performance coach grows composure/resilience.
    // User team: dedicated Performance Coach skill (up to 18%/month at skill 20).
    // AI teams: half-rate baseline from the team's general coachSkill (so AI
    // squads don't stagnate while the user gets all the development).
    let perfP = 0;
    if (perfCoach && p.teamId === perfCoach.userTeamId) {
      perfP = (perfCoach.skill / 20) * 0.18;
    } else if (p.teamId) {
      // For AI teams: use team-level coachSkill at half rate (max ~9%/month).
      // The caller is expected to thread team.coachSkill via the players' team.
      // We approximate by referencing a global lookup. Since we only have
      // players here, fall back to a flat baseline: 8%/month.
      perfP = 0.08;
    }
    if (perfP > 0 && rng.chance(perfP)) {
      const a = rng.pick(['composure', 'resilience'] as const);
      if (p.attributes[a] < 20 && p.currentAbility < p.potentialAbility) {
        const before = p.attributes[a]; const caBefore = p.currentAbility;
        p.attributes[a] = clamp(p.attributes[a] + 1, 1, 20);
        p.currentAbility = clamp(p.currentAbility + 1, 1, p.potentialAbility);
        record(p, a, before, caBefore, 'perf-coach');
      }
    }
    // Youth growth: development chance and breadth scales with how much headroom is left.
    // Newgens (age 16-19) develop fastest; 20-23 still grow steadily; 24-27 polish.
    if (p.age <= 27 && p.currentAbility < p.potentialAbility) {
      const baseYouthP =
        p.age <= 19 ? 0.35 : p.age <= 22 ? 0.25 : p.age <= 25 ? 0.15 : 0.08;
      // Faceit hub: extra training reps for user-team players only.
      const faceitMult = (userTeamId && p.teamId === userTeamId) ? FACEIT_BOOST[faceitTier ?? 'none'] : 1;
      // Mentor boost: vet teammates speed up this player's development.
      const mentorMult = mentorBoost?.(p.id) ?? 1;
      const youthP = Math.min(0.9, baseYouthP * faceitMult * mentorMult);
      if (rng.chance(youthP)) {
        // Pool priority: developmentTarget (role retrain) → individualFocus (attr group) → auto.
        let pool: (keyof Player['attributes'])[];
        if (p.developmentTarget) {
          pool = topAttrsForRole(p.developmentTarget, 6);
        } else {
          const focus = p.individualFocus ?? 'auto';
          const focusAttrs: Record<typeof focus, (keyof Player['attributes'])[]> = {
            auto: [...ATTRIBUTE_KEYS],
            aim: ['aim', 'reflexes'],
            utility: ['utility', 'positioning'],
            tactics: ['gameSense', 'leadership'],
            teamplay: ['teamwork', 'communication'],
            composure: ['composure', 'resilience', 'clutch'],
          };
          pool = focusAttrs[focus] ?? [...ATTRIBUTE_KEYS];
        }
        const a = rng.pick(pool);
        if (p.attributes[a] < 20 && p.currentAbility < p.potentialAbility) {
          const before = p.attributes[a]; const caBefore = p.currentAbility;
          p.attributes[a] = clamp(p.attributes[a] + 1, 1, 20);
          p.currentAbility = clamp(p.currentAbility + 2, 1, p.potentialAbility);
          record(p, a, before, caBefore, 'youth');
        }
      }
    }
    // Role retraining: when developmentTarget is set, the player accumulates
    // extra role experience for the target each month — converts a Support to a
    // Lurker over a season or two without needing to start them in matches.
    if (p.developmentTarget && p.developmentTarget !== p.role) {
      if (!p.roleExperience) p.roleExperience = {};
      const cur = p.roleExperience[p.developmentTarget] ?? 0;
      // +3-5/month — about 1 familiarity tier per season of focused training.
      const gain = 3 + (userTeamId && p.teamId === userTeamId ? rng.int(0, 2) : 0);
      p.roleExperience[p.developmentTarget] = Math.min(200, cur + gain);
    }
  }
  return deltas;
}

/** Monthly finance processing. Sponsor income now comes from active sponsorDeals (if any),
 *  with a small reputation-based fallback for teams that have no deals (e.g., legacy saves). */
export function processMonthlyFinances(
  team: Team,
  players: Record<string, Player>,
  month: string,
  pendingPrize: number,
  transfersIn: number,
  transfersOut: number,
  /** Active loans where this team is the parent (fromTeamId). Their players
   *  aren't in team.playerIds anymore, but the parent still owes the
   *  uncovered share of the wage — otherwise loan-and-recall is a free
   *  wage-dump exploit. */
  outboundLoans: { playerId: string; wageContribution: number }[] = [],
): FinanceRecord {
  const squadWages = team.playerIds.reduce((sum, id) => sum + (players[id]?.contract?.wage ?? 0), 0);
  const loanedWageBurden = outboundLoans.reduce((sum, l) => {
    const p = players[l.playerId];
    if (!p?.contract) return sum;
    // Recipient covers `wageContribution` × wage; parent covers the rest.
    return sum + Math.round(p.contract.wage * (1 - Math.max(0, Math.min(1, l.wageContribution))));
  }, 0);
  const wages = squadWages + loanedWageBurden;
  const dealIncome = (team.sponsorDeals ?? []).reduce((sum, d) => sum + d.monthlyValue, 0);
  // Fallback reputation income when no sponsors yet (keeps old saves & bottom-tier teams afloat)
  const fallbackIncome = dealIncome === 0
    ? Math.round(team.reputation * 900 + (team.worldRanking <= 10 ? 60000 : team.worldRanking <= 20 ? 25000 : 8000))
    : Math.round(team.reputation * 200); // small overflow income (merch, tournament app fees etc)
  const sponsorIncome = dealIncome + fallbackIncome;
  team.budget += sponsorIncome + pendingPrize + transfersIn - wages - transfersOut;
  return { month, prizeMoney: pendingPrize, sponsorIncome, wages, transfersIn, transfersOut };
}

/** AI sends transfer offers for strong/listed user players */
export function generateAiOffers(
  userTeam: Team,
  teams: Record<string, Team>,
  players: Record<string, Player>,
  currentDate: string,
  rng: RNG,
  existingOffers: TransferOffer[] = [],
): TransferOffer[] {
  const offers: TransferOffer[] = [];
  // Players who already have an unresolved incoming offer — skip to avoid spam piling.
  const hasPendingIncoming = new Set(
    existingOffers
      .filter((o) => o.direction === 'in' && (o.status === 'pending' || o.status === 'club-counter'))
      .map((o) => o.playerId),
  );
  for (const pid of userTeam.playerIds) {
    if (hasPendingIncoming.has(pid)) continue;
    const p = players[pid];
    if (!p) continue;
    // Loyalty gates how often rivals even bother bidding. LOY 16+ players rarely
    // attract unsolicited offers (they're "off the market"). LOY 5 = pursued constantly.
    const loyaltyMul = p.transferListed ? 1 : Math.max(0.25, 1 - (p.attributes.loyalty - 10) * 0.05);
    // Star pursuit is aggressive: top-tier players are constantly courted.
    // Listed: 22%/day (≈97% over 14d). Star (CA>=160): 5%. Quality (CA>=140): 3%.
    // Squad (CA>=120): 1.6%. Depth: 0.8%.
    const baseChance = (
      p.transferListed ? 0.22
        : p.currentAbility >= 160 ? 0.05
        : p.currentAbility >= 140 ? 0.03
        : p.currentAbility >= 120 ? 0.016
        : 0.008
    ) * loyaltyMul;
    if (!rng.chance(baseChance)) continue;
    // Bidders just need enough budget to cover the LOW end of their first bid
    // (75% of asking for listed, 85% otherwise). Was 80% which gated out most
    // mid-tier clubs even when the deal was achievable.
    const minFee = p.askingPrice * (p.transferListed ? 0.55 : 0.7);
    const richTeams = Object.values(teams).filter((t) => !t.isUser && t.budget >= minFee);
    if (!richTeams.length) continue;
    // Prefer clubs that can comfortably afford a star — weight by budget so the
    // big clubs come knocking for top players more often than minnows.
    const weighted = richTeams.map((t) => ({ t, w: Math.max(1, t.budget / 250_000) }));
    const totalW = weighted.reduce((s, x) => s + x.w, 0);
    let roll = rng.next() * totalW;
    let bidder = weighted[0].t;
    for (const x of weighted) {
      roll -= x.w;
      if (roll <= 0) { bidder = x.t; break; }
    }
    const fee = Math.round(p.askingPrice * rng.range(p.transferListed ? 0.75 : 0.85, 1.25));
    // Loyal players demand more wage to even consider leaving (offsets the lower
    // bid frequency with stickier deals when an offer does land).
    const loyaltyWageHike = 1 + Math.max(0, p.attributes.loyalty - 12) * 0.04;
    offers.push({
      id: `offer-${pid}-${currentDate}-${rng.int(0, 9999)}`,
      date: currentDate,
      fromTeamId: bidder.id,
      playerId: pid,
      fee,
      wage: Math.round((p.contract?.wage ?? 10000) * rng.range(1.0, 1.5) * loyaltyWageHike),
      direction: 'in',
      status: 'pending',
      expiresOn: addDaysLocal(currentDate, 7),
    });
  }
  return offers;
}

function addDaysLocal(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A completed AI-to-AI transfer, returned by aiToAiTransfers so the caller can
 *  post each one to the news feed with author/team attribution. */
export interface AiTransferEvent {
  playerId: string;
  buyerId: string;
  sellerId: string;
  fee: number;
  /** The faceless replacement (free agent) the seller pulled in, if any. */
  replacementId?: string;
}

/** Monthly AI-to-AI transfer activity. Mutates teams/players, returns news lines + events. */
export function aiToAiTransfers(
  teams: Record<string, Team>,
  players: Record<string, Player>,
  userTeamId: string,
  currentDate: string,
  rng: RNG,
  /** Player IDs currently out on loan — not eligible to be sold by the
   *  recipient (they don't own the registration). Without this, the
   *  parent club could exploit recall to recover a sold player free. */
  loanedPlayerIds: Set<string> = new Set(),
): { lines: string[]; events: AiTransferEvent[] } {
  const news: string[] = [];
  const events: AiTransferEvent[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!rng.chance(0.55)) continue;
    const buyers = Object.values(teams).filter((t) => t.id !== userTeamId && t.budget > 600000);
    if (!buyers.length) break;
    const buyer = rng.pick(buyers);
    const starters = buyer.playerIds.slice(0, 5).map((id) => players[id]).filter(Boolean);
    const weakest = starters.filter((p) => p.role !== 'IGL').sort((a, b) => a.currentAbility - b.currentAbility)[0];
    if (!weakest) continue;

    const candidates = Object.values(players)
      .filter(
        (p) =>
          p.teamId &&
          p.teamId !== buyer.id &&
          p.teamId !== userTeamId &&
          !loanedPlayerIds.has(p.id) &&
          p.currentAbility > weakest.currentAbility + 8 &&
          p.askingPrice <= buyer.budget * 0.6 &&
          (teams[p.teamId]?.reputation ?? 200) < buyer.reputation + 25,
      )
      .sort((a, b) => b.currentAbility - a.currentAbility)
      .slice(0, 5);
    if (!candidates.length) continue;
    const target = rng.pick(candidates);
    const acceptP = target.transferListed ? 0.75 : 0.45;
    if (!rng.chance(acceptP)) continue;

    const seller = teams[target.teamId!];
    const fee = Math.round(target.askingPrice * rng.range(0.9, 1.25));
    buyer.budget -= fee;
    seller.budget += fee;
    seller.playerIds = seller.playerIds.filter((x) => x !== target.id);
    // new signing enters the starting five; displaced player drops to the bench
    const benchIdx = buyer.playerIds.indexOf(weakest.id);
    if (benchIdx >= 0 && benchIdx < 5) {
      buyer.playerIds[benchIdx] = target.id;
      buyer.playerIds.push(weakest.id);
    } else {
      buyer.playerIds.unshift(target.id);
    }
    target.teamId = buyer.id;
    target.clubHistory ??= [];
    if (target.clubHistory[target.clubHistory.length - 1]?.teamId !== buyer.id) {
      target.clubHistory.push({ teamId: buyer.id, teamName: buyer.name, joinedOn: currentDate });
    }
    target.transferListed = false;
    target.contract = {
      wage: Math.round(((target.contract?.wage ?? 15000) * rng.range(1.05, 1.35)) / 500) * 500,
      expires: addDaysLocal(currentDate, 365 * 2),
      buyout: Math.round(fee * 1.3),
    };

    // seller restocks from free agency if short
    let replacementId: string | undefined;
    if (seller.playerIds.length < 5) {
      const fa = Object.values(players)
        .filter((p) => !p.teamId)
        .sort((a, b) => b.currentAbility - a.currentAbility)[0];
      if (fa) {
        fa.teamId = seller.id;
        fa.clubHistory ??= [];
        if (fa.clubHistory[fa.clubHistory.length - 1]?.teamId !== seller.id) {
          fa.clubHistory.push({ teamId: seller.id, teamName: seller.name, joinedOn: currentDate });
        }
        fa.contract = { wage: Math.max(8000, fa.currentAbility * 250), expires: addDaysLocal(currentDate, 365), buyout: fa.askingPrice };
        seller.playerIds.push(fa.id);
        news.push(`${seller.name} replace him with free agent ${fa.nickname}.`);
        replacementId = fa.id;
      }
    }
    news.unshift(`${target.nickname} joins ${buyer.name} from ${seller.name} for $${fee.toLocaleString()}.`);
    events.push({ playerId: target.id, buyerId: buyer.id, sellerId: seller.id, fee, replacementId });
  }
  return { lines: news, events };
}

/** Update world rankings from points */
export function recomputeRankings(teams: Record<string, Team>): void {
  // Defunct orgs sink to the bottom regardless of historical points.
  const live = Object.values(teams).filter((t) => !t.defunct);
  const dead = Object.values(teams).filter((t) => t.defunct);
  live.sort((a, b) => b.rankingPoints - a.rankingPoints);
  live.forEach((t, i) => (t.worldRanking = i + 1));
  dead.forEach((t) => (t.worldRanking = 999));
}
