// Player social fabric: mentors, rivals, friend cliques.
// Generated at game start + refreshed at season rollover. Drives small monthly
// morale drifts + mentor development boost — none individually huge, but they
// compound over a season into the "this player wants out" / "vet is bringing
// the kid along" stories that make rosters feel alive.

import type { GameState, Player, PlayerRelation, RelationKind, RelationSource } from '../types';
import { RNG, hashSeed } from '../engine/rng';

const TARGET_RELATIONS_PER_PLAYER = 2; // soft target, not enforced strictly

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function add(
  out: PlayerRelation[],
  seen: Set<string>,
  fromId: string,
  toId: string,
  kind: RelationKind,
  source: RelationSource,
  today: string,
): void {
  if (fromId === toId) return;
  const k = pairKey(fromId, toId);
  if (seen.has(k)) return;
  seen.add(k);
  out.push({ fromId, toId, kind, source, startedOn: today });
}

/** Build the initial set of relationships from the current player pool. */
export function generateInitialRelationships(g: GameState, today: string): PlayerRelation[] {
  const rng = new RNG(hashSeed(`relations-init-${today}`));
  const out: PlayerRelation[] = [];
  const seen = new Set<string>();
  const players = Object.values(g.players);
  // Group teammates for nationality + age-gap rolls
  const byTeam = new Map<string, Player[]>();
  for (const p of players) {
    if (!p.teamId) continue;
    const arr = byTeam.get(p.teamId) ?? [];
    arr.push(p);
    byTeam.set(p.teamId, arr);
  }

  for (const [, roster] of byTeam) {
    // Nationality cliques — friend ties between same-nat teammates (60% chance per pair)
    const byNat = new Map<string, Player[]>();
    for (const p of roster) {
      const arr = byNat.get(p.nationality) ?? [];
      arr.push(p);
      byNat.set(p.nationality, arr);
    }
    for (const [, group] of byNat) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (rng.chance(0.6)) add(out, seen, group[i].id, group[j].id, 'friend', 'nationality', today);
        }
      }
    }
    // Age-gap mentor: each vet (28+) + rookie (≤21) pair has 45% chance
    const vets = roster.filter((p) => p.age >= 28);
    const rookies = roster.filter((p) => p.age <= 21);
    for (const v of vets) {
      for (const r of rookies) {
        if (rng.chance(0.45)) add(out, seen, v.id, r.id, 'mentor', 'age-gap', today);
      }
    }
    // Role rivalry: two same-role players on same team — 35% chance rival (sparks fly)
    const byRole = new Map<string, Player[]>();
    for (const p of roster) {
      const arr = byRole.get(p.role) ?? [];
      arr.push(p);
      byRole.set(p.role, arr);
    }
    for (const [, group] of byRole) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (rng.chance(0.35)) add(out, seen, group[i].id, group[j].id, 'rival', 'role-rivalry', today);
        }
      }
    }
  }
  // A sprinkle of cross-team friendships among top players (historical scene ties)
  const stars = players.filter((p) => p.currentAbility >= 150);
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < Math.min(stars.length, i + 8); j++) {
      if (stars[i].nationality === stars[j].nationality && rng.chance(0.25)) {
        add(out, seen, stars[i].id, stars[j].id, 'friend', 'history', today);
      }
    }
  }
  return out;
}

/** Cull dead relationships (player retired/released) + add fresh ones for new arrivals. */
export function refreshRelationships(g: GameState, today: string): void {
  const rng = new RNG(hashSeed(`relations-refresh-${today}`));
  g.relationships = (g.relationships ?? []).filter((r) => g.players[r.fromId] && g.players[r.toId]);
  const seen = new Set(g.relationships.map((r) => pairKey(r.fromId, r.toId)));
  // For each team, look for any vet+rookie pair not yet related → small chance.
  const byTeam = new Map<string, Player[]>();
  for (const p of Object.values(g.players)) {
    if (!p.teamId) continue;
    const arr = byTeam.get(p.teamId) ?? [];
    arr.push(p);
    byTeam.set(p.teamId, arr);
  }
  for (const [, roster] of byTeam) {
    const vets = roster.filter((p) => p.age >= 28);
    const rookies = roster.filter((p) => p.age <= 21);
    for (const v of vets) {
      for (const r of rookies) {
        if (seen.has(pairKey(v.id, r.id))) continue;
        if (rng.chance(0.2)) add(g.relationships, seen, v.id, r.id, 'mentor', 'age-gap', today);
      }
    }
  }
  // Soft cap per player
  const counts = new Map<string, number>();
  const kept: PlayerRelation[] = [];
  for (const r of g.relationships) {
    const a = counts.get(r.fromId) ?? 0;
    const b = counts.get(r.toId) ?? 0;
    if (a >= TARGET_RELATIONS_PER_PLAYER * 3 && b >= TARGET_RELATIONS_PER_PLAYER * 3) continue;
    kept.push(r);
    counts.set(r.fromId, a + 1);
    counts.set(r.toId, b + 1);
  }
  g.relationships = kept;
}

/** Apply monthly social effects on user-team players (morale drift, mentor boost). */
export function applyMonthlyRelationshipEffects(g: GameState): { mentorMoraleBoost: number; friendBoost: number; rivalDrag: number } {
  const rels = g.relationships ?? [];
  let mentorMoraleBoost = 0;
  let friendBoost = 0;
  let rivalDrag = 0;
  for (const r of rels) {
    const a = g.players[r.fromId];
    const b = g.players[r.toId];
    if (!a || !b) continue;
    const sameTeam = a.teamId === b.teamId && a.teamId !== null;
    if (!sameTeam) continue;
    if (r.kind === 'friend') {
      a.morale = clamp(a.morale + 0.4, 1, 20);
      b.morale = clamp(b.morale + 0.4, 1, 20);
      friendBoost++;
    } else if (r.kind === 'rival') {
      a.morale = clamp(a.morale - 0.3, 1, 20);
      b.morale = clamp(b.morale - 0.3, 1, 20);
      rivalDrag++;
    } else if (r.kind === 'mentor') {
      // Mentor (a) lifts mentee (b) morale + small form bump if mentor is in form.
      b.morale = clamp(b.morale + 0.3, 1, 20);
      if (a.form >= 12) b.form = clamp(b.form + 0.2, 1, 20);
      mentorMoraleBoost++;
    }
  }
  return { mentorMoraleBoost, friendBoost, rivalDrag };
}

/** Look up the bonus multiplier the engine should apply to mentee youth growth. */
export function mentorBoostFor(g: GameState, menteeId: string): number {
  const rels = g.relationships ?? [];
  let boost = 1;
  for (const r of rels) {
    if (r.kind !== 'mentor' || r.toId !== menteeId) continue;
    const mentor = g.players[r.fromId];
    const mentee = g.players[menteeId];
    if (!mentor || !mentee || mentor.teamId !== mentee.teamId) continue;
    // +25% per active mentor on the same team. Cap at +60%.
    boost += 0.25;
  }
  return Math.min(1.6, boost);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
