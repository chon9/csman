// Player analytics: role-fit scoring and reputation tier derivation.
// Used by Player Profile (UI display) and the engine (continuous role-fit
// multiplier in matchEngine).

import type { Player, PlayerAttributes, PlayerRole, ReputationTier, Team } from '../types';

/**
 * Weight tables for each role — which attributes matter most for that position.
 * Numbers sum to ~1.0 within a role. Tuned against the 12-attr CS pro archetypes:
 *  - IGL: leadership + game sense + communication carry; raw mechanics secondary
 *  - AWPer: aim + reflexes + positioning + composure
 *  - Entry: aim + reflexes + aggression + teamwork (selfless first-contact)
 *  - Lurker: positioning + game sense + clutch + composure
 *  - Support: utility + teamwork + communication + game sense
 *  - Rifler: balanced (aim/reflexes/positioning) — generalist baseline
 */
const ROLE_WEIGHTS: Record<PlayerRole, Partial<Record<keyof PlayerAttributes, number>>> = {
  IGL: {
    leadership: 0.28,
    gameSense: 0.22,
    communication: 0.18,
    composure: 0.10,
    teamwork: 0.07,
    aim: 0.05,
    reflexes: 0.05,
    positioning: 0.05,
  },
  AWPer: {
    aim: 0.26,
    reflexes: 0.20,
    positioning: 0.18,
    composure: 0.12,
    clutch: 0.08,
    gameSense: 0.08,
    consistency: 0.08,
  },
  Entry: {
    aim: 0.20,
    reflexes: 0.22,
    aggression: 0.18,
    teamwork: 0.12,
    positioning: 0.08,
    composure: 0.08,
    gameSense: 0.06,
    consistency: 0.06,
  },
  Lurker: {
    positioning: 0.22,
    gameSense: 0.22,
    clutch: 0.18,
    composure: 0.12,
    aim: 0.12,
    consistency: 0.08,
    reflexes: 0.06,
  },
  Support: {
    utility: 0.28,
    teamwork: 0.20,
    communication: 0.14,
    gameSense: 0.14,
    aim: 0.10,
    positioning: 0.08,
    composure: 0.06,
  },
  Rifler: {
    aim: 0.18,
    reflexes: 0.15,
    positioning: 0.15,
    gameSense: 0.12,
    consistency: 0.10,
    teamwork: 0.10,
    composure: 0.10,
    clutch: 0.10,
  },
  Anchor: {
    // CT-side site holder — composure, positioning, utility, lurking-style reads.
    // Strong solo holds + clutch awareness.
    positioning: 0.24,
    composure: 0.18,
    clutch: 0.15,
    aim: 0.12,
    gameSense: 0.12,
    utility: 0.10,
    consistency: 0.09,
  },
};

/**
 * Score a player's fit for a given role. Returns 0-20 (matching attribute scale).
 * Internally: weighted sum of attribute values, plus a small natural-role bonus
 * so the player's own role still feels like "home."
 */
export function calcRoleScore(player: Player, role: PlayerRole): number {
  const weights = ROLE_WEIGHTS[role];
  let score = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights) as [keyof PlayerAttributes, number][]) {
    score += (player.attributes[key] ?? 10) * weight;
    totalWeight += weight;
  }
  // Normalize so missing weights don't punish, then add +0.6 if it's their natural role
  const normalized = totalWeight > 0 ? score / totalWeight : 10;
  const naturalBonus = player.role === role ? 0.6 : 0;
  return Math.min(20, normalized + naturalBonus);
}

/** Convert a 0-20 role score to a 0-5 star display rating. */
export function roleStars(player: Player, role: PlayerRole): number {
  const score = calcRoleScore(player, role);
  // 20 → 5 stars, 12 → 3 stars, 4 → 1 star. Use a slight curve so elite separation reads.
  const stars = Math.max(0, Math.min(5, (score - 4) / 3.2));
  return Math.round(stars * 2) / 2; // half-star precision
}

/** Continuous role-fit multiplier for the engine. Centered at 1.0 (3 stars). */
export function roleFitMultiplier(player: Player, assignedRole: PlayerRole): number {
  const stars = roleStars(player, assignedRole);
  // 5★ = +8%, 3★ = 0%, 1★ = −5%, 0★ = −7%
  const offset = (stars - 3) * 0.04;
  return Math.max(0.93, Math.min(1.08, 1 + offset));
}

/**
 * Top N attributes a role values most, derived from ROLE_WEIGHTS. Used as the
 * training-focus pool when developmentTarget is set, so the player grows the
 * attributes that matter for that role.
 */
export function topAttrsForRole(role: PlayerRole, take: number = 6): (keyof PlayerAttributes)[] {
  const weights = ROLE_WEIGHTS[role] ?? {};
  return (Object.entries(weights) as [keyof PlayerAttributes, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([k]) => k);
}

/** Five FM-style familiarity tiers. */
export type FamiliarityTier =
  | 'Natural'
  | 'Accomplished'
  | 'Competent'
  | 'Unconvincing'
  | 'Awkward';

/**
 * Familiarity = accumulated role-specific experience. Scale buckets:
 *  150+ Natural | 100+ Accomplished | 60+ Competent | 30+ Unconvincing | <30 Awkward
 * Natural role of the player seeds at 150 (Natural).
 */
export function roleFamiliarityPoints(player: Player, role: PlayerRole): number {
  const stored = player.roleExperience?.[role];
  if (typeof stored === 'number') return stored;
  // Lazy default for pre-feature saves: natural role = Natural, Rifler = Competent,
  // others derived from positional fit so attribute-leaning players read sensibly.
  if (player.role === role) return 150;
  if (role === 'Rifler') return 70; // most pros can rifle as a baseline
  if (role === 'Anchor' && player.role !== 'Entry') return 50; // riflers/lurkers anchor decently
  const stars = roleStars(player, role); // 0..5
  return Math.round(stars * 12); // 5★ → 60 (Competent), 3★ → 36, 1★ → 12
}

export function familiarityTier(points: number): FamiliarityTier {
  if (points >= 150) return 'Natural';
  if (points >= 100) return 'Accomplished';
  if (points >= 60) return 'Competent';
  if (points >= 30) return 'Unconvincing';
  return 'Awkward';
}

export function tierMultiplier(tier: FamiliarityTier): number {
  switch (tier) {
    case 'Natural': return 1.05;
    case 'Accomplished': return 1.02;
    case 'Competent': return 1.0;
    case 'Unconvincing': return 0.97;
    case 'Awkward': return 0.93;
  }
}

/** Combined fit + familiarity multiplier used by the match engine. */
export function roleSkillModifier(player: Player, assignedRole: PlayerRole): number {
  const fit = roleFitMultiplier(player, assignedRole);
  const fam = tierMultiplier(familiarityTier(roleFamiliarityPoints(player, assignedRole)));
  // Geometric blend keeps both contributions in a sane range.
  return fit * fam;
}

/** Compute fit stars for ALL roles — drives the PlayerProfile star block. */
export function allRoleStars(player: Player): { role: PlayerRole; stars: number }[] {
  const roles: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler', 'Anchor'];
  return roles.map((role) => ({ role, stars: roleStars(player, role) }));
}

/**
 * Reputation tier badge — derived from currentAbility, age, and team prominence.
 * Surfaces on the Player Profile and feeds sponsor/transfer logic later.
 *
 * - Superstar: CA 175+ or PotY-tier (rating 1.30+ over 30+ maps)
 * - Star: CA 160+
 * - Established: CA 140+
 * - Hot Prospect: age ≤ 21 with high PA (potential 150+)
 * - Journeyman: rest
 * - Unknown: <40 maps played AND not on a top-12 team
 */
export function reputationTier(player: Player, teamRanking?: number): ReputationTier {
  const eliteRating = player.stats.maps >= 30 && player.stats.rating >= 1.3;
  if (player.currentAbility >= 175 || eliteRating) return 'Superstar';
  if (player.currentAbility >= 160) return 'Star';
  if (player.currentAbility >= 140) return 'Established';
  if (player.age <= 21 && player.potentialAbility >= 150) return 'Hot Prospect';
  if (player.stats.maps < 40 && (teamRanking ?? 99) > 12) return 'Unknown';
  return 'Journeyman';
}

/** For sponsor / transfer market scaling. */
export function reputationMultiplier(tier: ReputationTier): number {
  switch (tier) {
    case 'Superstar': return 2.0;
    case 'Star': return 1.5;
    case 'Established': return 1.2;
    case 'Hot Prospect': return 1.1;
    case 'Journeyman': return 1.0;
    case 'Unknown': return 0.85;
  }
}

/** Helper: gather reputation tier with optional team lookup. */
export function playerReputation(player: Player, teams?: Record<string, Team>): ReputationTier {
  const teamRank = player.teamId && teams ? teams[player.teamId]?.worldRanking : undefined;
  return reputationTier(player, teamRank);
}
