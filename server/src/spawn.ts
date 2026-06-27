// Newgen spawn for online teams. Reuses the existing buildPlayer pipeline so
// stats/roles/PA curves stay identical to career mode. Names come from the
// region-specific pools in src/data/newgenNames.

import { RNG, hashSeed } from '../../src/engine/rng.ts';
import { NEWGEN_POOLS } from '../../src/data/newgenNames.ts';
import { buildPlayer, type PlayerSpec } from '../../src/data/dbBuild.ts';
import type { Player, PlayerRole, Region } from '../../src/types.ts';
import { TRAIT_GEN_CHANCE, TRAIT_LIBRARY, type TraitDef } from '../../src/online/protocol.ts';

/** Weighted pick from a TraitDef array using its `weight` field. */
function weightedTrait(rng: RNG, pool: TraitDef[]): TraitDef {
  const total = pool.reduce((s, t) => s + t.weight, 0);
  let r = rng.next() * total;
  for (const t of pool) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return pool[pool.length - 1]!;
}

/** Roll a player's traits at creation time. Most players get 0 or 1 trait;
 *  a small minority get a second (often negative) one — gives every roster
 *  flavour without making every player special. */
export function rollPlayerTraits(rng: RNG): string[] {
  if (!rng.chance(TRAIT_GEN_CHANCE.hasAnyTrait)) return [];
  const traits: string[] = [];
  const positives = TRAIT_LIBRARY.filter((t) => t.tone === 'positive');
  const first = weightedTrait(rng, positives);
  traits.push(first.id);
  if (rng.chance(TRAIT_GEN_CHANCE.hasSecondTrait)) {
    const wantNegative = rng.chance(TRAIT_GEN_CHANCE.secondTraitIsNegative);
    const pool = TRAIT_LIBRARY.filter(
      (t) => t.tone === (wantNegative ? 'negative' : 'positive') && t.id !== first.id,
    );
    if (pool.length > 0) traits.push(weightedTrait(rng, pool).id);
  }
  return traits;
}

/** Roles every team needs at least one of, in the order we spawn them. */
const DEFAULT_ROLES: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support'];

/**
 * Spawn `roles.length` newgens for a freshly created team. They're tier-3
 * (decent but not elite) with healthy youth PA headroom — gives the owner
 * something to develop without starting them as world-beaters.
 */
export function spawnInitialRoster(
  teamId: string,
  region: Region,
  startDate: string,
  roles: PlayerRole[] = DEFAULT_ROLES,
  usedIds: Set<string> = new Set(),
  usedNicks: Set<string> = new Set(),
): Player[] {
  const rng = new RNG(hashSeed(`spawn-${teamId}-${startDate}`));
  const pool = NEWGEN_POOLS[region];
  const out: Player[] = [];

  for (const role of roles) {
    const age = rng.int(17, 22);

    // Pick a unique nickname.
    let nick = rng.pick(pool.nicks);
    let tries = 0;
    while (usedNicks.has(nick.toLowerCase()) && tries++ < 25) nick = rng.pick(pool.nicks);
    if (usedNicks.has(nick.toLowerCase())) {
      nick = `${nick}_${(out.length + 1).toString(36)}`;
    }
    const baseId = nick.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let id = baseId;
    let suffix = 0;
    while (usedIds.has(id)) id = `${baseId}-${++suffix}`;
    usedIds.add(id);
    usedNicks.add(nick.toLowerCase());

    const spec: PlayerSpec = {
      nick,
      first: rng.pick(pool.first),
      last: rng.pick(pool.last),
      nat: rng.pick(pool.nationalities),
      age,
      role,
      // Tier 3 (base attrs ≈ 14) — competitive enough to scrim, room to grow.
      tier: 3,
    };
    const player = buildPlayer(spec, teamId, startDate);
    player.id = id;
    // Bump PA so wonderkid arcs are possible from day one.
    player.potentialAbility = Math.min(200, player.potentialAbility + rng.int(8, 28));
    player.squadTier = 'first';
    player.traits = rollPlayerTraits(rng);
    out.push(player);
  }
  return out;
}
