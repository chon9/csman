// Tactical archetype matchup layer — FM-style rock-paper-scissors on
// top of the existing positioning + timing engine. Every round the T
// side's chosen archetype interacts with the CT side's, producing a
// duel-score multiplier + a big-swing commentary line when the matchup
// is decisive.
//
// The table is intentionally a shallow ±10% range so a great roster
// running the "wrong" tactic still wins most rounds — this rewards
// the manager's meta call without invalidating raw skill. Tuning it
// hotter turns the game into strategy-only; tuning it colder makes
// tactics cosmetic. Current values were calibrated against real CS
// pro-match trends (rushes crush passive holds, stacks eat rushes,
// fakes eat rotators, mid control snowballs, etc.).

import type { CtArchetype, Player, PlayerAttributes, TStratArchetype } from '../types';

/** T archetypes in the ORDER used to key the matchup table rows. */
export const T_ARCHETYPES: TStratArchetype[] = [
  'fast-rush', 'slow-default', 'fake-execute', 'mid-control', 'contact-play',
];

/** CT archetypes in the ORDER used to key the matchup table columns. */
export const CT_ARCHETYPES: CtArchetype[] = [
  'aggressive-push', 'passive-hold', 'stack-site', 'retake-setup', 'heavy-mid',
];

/** Human-readable labels for the UI. */
export const T_ARCHETYPE_LABEL: Record<TStratArchetype, string> = {
  'fast-rush':    'Fast Rush',
  'slow-default': 'Slow Default',
  'fake-execute': 'Fake Execute',
  'mid-control':  'Mid Control',
  'contact-play': 'Contact Play',
};
export const CT_ARCHETYPE_LABEL: Record<CtArchetype, string> = {
  'aggressive-push': 'Aggressive Push',
  'passive-hold':    'Passive Hold',
  'stack-site':      'Stack Site',
  'retake-setup':    'Retake Setup',
  'heavy-mid':       'Heavy Mid Control',
};

/** Short "what it does" blurbs for the tactics UI. */
export const T_ARCHETYPE_BLURB: Record<TStratArchetype, string> = {
  'fast-rush':    'Swarm one site early. Crushes slow CT setups; folds against a stack.',
  'slow-default': 'Spread map, farm info, hit late. Punishes aggressive pushes; loses to passive holds.',
  'fake-execute': 'Bait one site, hit the other. Wrecks rotating CTs and stacks; ignored by anchors.',
  'mid-control':  'Win mid, snowball map control. Beats weak-mid setups; loses to heavy mid contests.',
  'contact-play': 'Close-range peek fights, punish over-holds. Beats passive; dies into stacks.',
};
export const CT_ARCHETYPE_BLURB: Record<CtArchetype, string> = {
  'aggressive-push': 'Peek/flank early for info. Beats slow defaults; caught out by contact play.',
  'passive-hold':    'Set up deep, retake with utility. Beats fast rushes; loses to map control.',
  'stack-site':      '3-1-1 stack the read. Crushes fast executes; blown open by fakes.',
  'retake-setup':    'Give the plant, win the retake. Punishes utility executes; contact play denies plant time.',
  'heavy-mid':       'Three-plus bodies into mid. Beats T mid defaults; opens fast side hits.',
};

/**
 * The core matchup table. Rows = T archetype, columns = CT archetype.
 * Value = T-side advantage in percentage points (positive = T favored).
 * Symmetric: applying +X% to T means -X% to CT scores (net swing = 2X%).
 *
 *                     AggPush  PassHold  Stack  Retake  HeavyMid
 * Fast Rush             +3       +10      -10     +7      +8
 * Slow Default          +8       -3       +5      -3      -6
 * Fake Execute          +8       -3       +10     +6      +5
 * Mid Control           -3       +7       +3      -4      -6
 * Contact Play          -3       +7       -8      +6      +5
 */
export const MATCHUP_TABLE: Record<TStratArchetype, Record<CtArchetype, number>> = {
  'fast-rush': {
    'aggressive-push': +3,
    'passive-hold':    +10,
    'stack-site':      -10,
    'retake-setup':    +7,
    'heavy-mid':       +8,
  },
  'slow-default': {
    'aggressive-push': +8,
    'passive-hold':    -3,
    'stack-site':      +5,
    'retake-setup':    -3,
    'heavy-mid':       -6,
  },
  'fake-execute': {
    'aggressive-push': +8,
    'passive-hold':    -3,
    'stack-site':      +10,
    'retake-setup':    +6,
    'heavy-mid':       +5,
  },
  'mid-control': {
    'aggressive-push': -3,
    'passive-hold':    +7,
    'stack-site':      +3,
    'retake-setup':    -4,
    'heavy-mid':       -6,
  },
  'contact-play': {
    'aggressive-push': -3,
    'passive-hold':    +7,
    'stack-site':      -8,
    'retake-setup':    +6,
    'heavy-mid':       +5,
  },
};

/**
 * Return the raw matchup bonus as a percentage-point value in the range
 * roughly [-10, +10]. Positive favors T, negative favors CT. Never null —
 * missing archetypes fall back to a neutral 0.
 */
export function matchupBonusPct(t: TStratArchetype, ct: CtArchetype): number {
  return MATCHUP_TABLE[t]?.[ct] ?? 0;
}

/**
 * Convert the raw percentage bonus into two round-level score multipliers.
 * Applied per-duel in the engine: tScore *= tMult, cScore *= cMult.
 *
 * A +8% matchup for T means:
 *   tMult = 1.04, cMult = 0.96  (net ~8% swing on the duel outcome)
 *
 * We split the bonus evenly across both sides so the total swing stays
 * proportional to the raw table value.
 */
export function matchupMultipliers(t: TStratArchetype, ct: CtArchetype): { tMult: number; cMult: number } {
  const pct = matchupBonusPct(t, ct);
  const half = (pct / 100) / 2;
  return { tMult: 1 + half, cMult: 1 - half };
}

/** True if the matchup is decisive enough to deserve a commentary callout. */
export function isDecisiveMatchup(t: TStratArchetype, ct: CtArchetype): boolean {
  return Math.abs(matchupBonusPct(t, ct)) >= 6;
}

/**
 * Pick a broadcast-style commentary line describing the matchup verdict.
 * Called once per map on round 1 (or at overtime break) so the user
 * clearly hears WHY they're being favored or punished. Not per-round
 * — that would spam the log.
 */
export function matchupCommentary(
  t: TStratArchetype, ct: CtArchetype, tTag: string, ctTag: string,
): string | null {
  const pct = matchupBonusPct(t, ct);
  if (Math.abs(pct) < 6) return null; // not decisive enough to call out
  const tLabel = T_ARCHETYPE_LABEL[t];
  const ctLabel = CT_ARCHETYPE_LABEL[ct];
  if (pct >= 6) {
    // T favored
    return `[Analyst] ${tTag}'s ${tLabel} is a nightmare draw for ${ctTag}'s ${ctLabel} — expect early bomb-plants.`;
  }
  // CT favored
  return `[Analyst] ${ctTag}'s ${ctLabel} is tailor-made against ${tTag}'s ${tLabel} — ${tTag} will need clean executes.`;
}

/**
 * Infer both archetypes from a team's roster average attributes. Used as
 * the fallback when a team hasn't set their archetype explicitly — the
 * game reads their star player pool and picks the most fitting style.
 *
 * The inference is DETERMINISTIC given the same roster, so an opponent's
 * tendency is scoutable by looking at their profile.
 */
export function inferArchetypesFromRoster(starters: Player[]): {
  t: TStratArchetype; ct: CtArchetype;
} {
  if (starters.length === 0) {
    return { t: 'slow-default', ct: 'passive-hold' };
  }
  const avg = (k: keyof PlayerAttributes): number => {
    let s = 0;
    for (const p of starters) s += p.attributes[k] ?? 10;
    return s / starters.length;
  };
  const aggression = avg('aggression');
  const gameSense = avg('gameSense');
  const utility = avg('utility');
  const clutch = avg('clutch');
  const composure = avg('composure');
  const leadership = avg('leadership');

  // T archetype — pick the option whose lead attribute is highest.
  const tScores: Array<{ arch: TStratArchetype; score: number }> = [
    { arch: 'fast-rush',    score: aggression * 1.2 + clutch * 0.3 },
    { arch: 'slow-default', score: gameSense * 1.0 + composure * 0.5 },
    { arch: 'fake-execute', score: leadership * 1.1 + gameSense * 0.6 + utility * 0.3 },
    { arch: 'mid-control',  score: utility * 0.9 + gameSense * 0.5 + aggression * 0.3 },
    { arch: 'contact-play', score: clutch * 1.0 + aggression * 0.5 },
  ];
  const t = tScores.sort((a, b) => b.score - a.score)[0]!.arch;

  const ctScores: Array<{ arch: CtArchetype; score: number }> = [
    { arch: 'aggressive-push', score: aggression * 1.2 + gameSense * 0.3 },
    { arch: 'passive-hold',    score: composure * 1.0 + utility * 0.4 },
    { arch: 'stack-site',      score: clutch * 0.8 + composure * 0.6 },
    { arch: 'retake-setup',    score: utility * 1.1 + leadership * 0.3 },
    { arch: 'heavy-mid',       score: gameSense * 0.9 + utility * 0.5 + aggression * 0.2 },
  ];
  const ct = ctScores.sort((a, b) => b.score - a.score)[0]!.arch;

  return { t, ct };
}

/**
 * Resolve a team's effective archetypes: explicit tactics setting first,
 * otherwise inferred from the starting five. Used by the engine at match
 * start and by the UI to display an opponent's tendency.
 */
export function resolveArchetypes(
  tacticsTArch: TStratArchetype | undefined,
  tacticsCtArch: CtArchetype | undefined,
  starters: Player[],
): { t: TStratArchetype; ct: CtArchetype; source: 'explicit' | 'inferred' | 'mixed' } {
  if (tacticsTArch && tacticsCtArch) {
    return { t: tacticsTArch, ct: tacticsCtArch, source: 'explicit' };
  }
  const inferred = inferArchetypesFromRoster(starters);
  return {
    t: tacticsTArch ?? inferred.t,
    ct: tacticsCtArch ?? inferred.ct,
    source: tacticsTArch || tacticsCtArch ? 'mixed' : 'inferred',
  };
}
