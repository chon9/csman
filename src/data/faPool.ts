// Bulk free-agent generation — seeds ~500 unsigned players at career start so
// the transfer market and reserve squads aren't bone-dry from day one.
// Mix:
//   - 60 wonderkids (age 16-18, high PA potential, low CA) — the FM dream buy
//   - 200 young pros (age 19-23, moderate CA, room to grow)
//   - 160 mid-career journeymen (age 24-29, stable CA)
//   - 80 veterans (age 28-33, ageing curve but still useful)

import type { Player, PlayerRole, Region } from '../types';
import { RNG, hashSeed } from '../engine/rng';
import { NEWGEN_POOLS } from './newgenNames';
import { buildPlayer, type PlayerSpec } from './dbBuild';

const ALL_REGIONS: Region[] = ['Europe', 'CIS', 'Americas', 'Asia'];
const ROLES: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler', 'Anchor'];

interface BucketSpec {
  count: number;
  ageMin: number;
  ageMax: number;
  /** tier passed to buildPlayer — drives base CA. 2=elite, 3=strong, 4=mid, 5=fringe. */
  tier: PlayerSpec['tier'];
  /** Extra potential headroom on top of derived CA. Wonderkids get the most. */
  paBonusMin: number;
  paBonusMax: number;
}

const BUCKETS: BucketSpec[] = [
  { count: 60, ageMin: 16, ageMax: 18, tier: 4, paBonusMin: 35, paBonusMax: 60 }, // wonderkids
  { count: 200, ageMin: 19, ageMax: 23, tier: 3, paBonusMin: 10, paBonusMax: 30 }, // young pros
  { count: 160, ageMin: 24, ageMax: 29, tier: 4, paBonusMin: 2, paBonusMax: 12 }, // journeymen
  { count: 80, ageMin: 28, ageMax: 33, tier: 3, paBonusMin: 0, paBonusMax: 5 }, // vets
];

/**
 * Generate a free-agent pool. Returns players keyed by id, all with teamId=null.
 * `usedIds` and `usedNicks` are read-only sets of already-taken identifiers
 * (from real rosters) so we don't collide.
 */
export function generateFreeAgentPool(
  startDate: string,
  usedIds: Set<string>,
  usedNicks: Set<string>,
): Player[] {
  const rng = new RNG(hashSeed(`fa-pool-${startDate}`));
  const out: Player[] = [];

  for (const bucket of BUCKETS) {
    for (let i = 0; i < bucket.count; i++) {
      const region = ALL_REGIONS[rng.int(0, ALL_REGIONS.length - 1)];
      const pool = NEWGEN_POOLS[region];
      const role = rng.pick(ROLES);
      const age = rng.int(bucket.ageMin, bucket.ageMax);

      // Pick a nickname that's free
      let nick = rng.pick(pool.nicks);
      let attempts = 0;
      while (usedNicks.has(nick.toLowerCase()) && attempts++ < 20) nick = rng.pick(pool.nicks);
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
        tier: bucket.tier,
      };
      const player = buildPlayer(spec, null, startDate);
      player.id = id;
      // Wonderkid PA bonus — flagged for sponsor/transfer scouting later
      player.potentialAbility = Math.min(
        200,
        player.potentialAbility + rng.int(bucket.paBonusMin, bucket.paBonusMax),
      );
      // Free agents start with reserve-tier readiness — sign them and you choose where.
      // squadTier stays undefined until signed.
      out.push(player);
    }
  }
  return out;
}
