// Shared free agent pool. The first time anyone asks for the FA list the
// server seeds the DB with 200+ generated players using the same pipeline
// the single-player career mode uses (src/data/faPool). Players that get
// signed by a team simply move their teamId; the pool count drops until
// the next refill threshold is crossed.

import { generateFreeAgentPool } from '../../src/data/faPool.ts';
import { buildPlayer, type PlayerSpec } from '../../src/data/dbBuild.ts';
import { NEWGEN_POOLS } from '../../src/data/newgenNames.ts';
import { RNG, hashSeed } from '../../src/engine/rng.ts';
import { MINT_TIERS, type MintTier } from '../../src/online/protocol.ts';
import type { Player, PlayerRole, Region } from '../../src/types.ts';
import type { DB } from './db.ts';

/** Refill the pool any time it drops below this floor — keeps the market
 *  fresh even after every team signs the headline wonderkids. */
const REFILL_THRESHOLD = 80;
/** How many new FAs to spawn when refilling. */
const REFILL_BATCH = 200;

export interface SignOutcome {
  player: Player;
  wage: number;
}

/** Ensure the FA pool has at least `REFILL_THRESHOLD` unsigned players.
 *  Cheap when already stocked (single COUNT query). */
export function ensureFreeAgentPool(db: DB): { added: number } {
  const have = db.countFreeAgents();
  if (have >= REFILL_THRESHOLD) return { added: 0 };
  // Generate a fresh batch and persist each one.
  const startDate = new Date().toISOString().slice(0, 10);
  // Collect IDs/nicks already in use to avoid collisions when seeding.
  const usedIds = new Set<string>();
  const usedNicks = new Set<string>();
  for (const p of db.loadFreeAgents(1000)) {
    usedIds.add(p.id);
    usedNicks.add(p.nickname.toLowerCase());
  }
  const fresh = generateFreeAgentPool(startDate, usedIds, usedNicks);
  const cap = Math.min(REFILL_BATCH, fresh.length);
  for (let i = 0; i < cap; i++) {
    const p = fresh[i];
    // generateFreeAgentPool returns players with teamId = null already.
    db.savePlayer(p);
  }
  return { added: cap };
}

/** Compute an FM-style suggested wage for a free agent — caller can offer
 *  this or higher when signing. Mirrors the heuristic in src/data/dbBuild. */
export function suggestedWage(player: Player): number {
  return Math.max(8000, Math.round((player.currentAbility * 300 - 20000) / 500) * 500);
}

export function buildWageMap(players: Player[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of players) out[p.id] = suggestedWage(p);
  return out;
}

const MINT_REGIONS: Region[] = ['Europe', 'CIS', 'Americas', 'Asia'];
const MINT_ROLES: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler', 'Anchor'];

/**
 * Generate a brand-new free agent for the pay-to-scout flow. Persists the
 * player to SQLite with teamId=null and returns the saved record. Uses an
 * entropy-mixed seed so repeated mints in the same second still vary.
 */
export function mintWonderkid(db: DB, tier: MintTier, startDate: string): Player {
  const meta = MINT_TIERS[tier];
  const seedSrc = `mint-${tier}-${Date.now()}-${Math.random()}`;
  const rng = new RNG(hashSeed(seedSrc));

  // Avoid id/nick collisions with the existing pool.
  const usedIds = new Set<string>();
  const usedNicks = new Set<string>();
  for (const p of db.loadFreeAgents(1000)) {
    usedIds.add(p.id);
    usedNicks.add(p.nickname.toLowerCase());
  }

  const region = MINT_REGIONS[rng.int(0, MINT_REGIONS.length - 1)];
  const pool = NEWGEN_POOLS[region];
  const role = rng.pick(MINT_ROLES);
  const age = rng.int(meta.ageRange[0], meta.ageRange[1]);

  let nick = rng.pick(pool.nicks);
  let attempts = 0;
  while (usedNicks.has(nick.toLowerCase()) && attempts++ < 20) nick = rng.pick(pool.nicks);
  if (usedNicks.has(nick.toLowerCase())) {
    nick = `${nick}_${seedSrc.slice(-4)}`;
  }
  const baseId = nick.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let id = baseId;
  let suffix = 0;
  while (usedIds.has(id)) id = `${baseId}-${++suffix}`;

  const spec: PlayerSpec = {
    nick,
    first: rng.pick(pool.first),
    last: rng.pick(pool.last),
    nat: rng.pick(pool.nationalities),
    age,
    role,
    tier: meta.baseTier,
  };
  const player = buildPlayer(spec, null, startDate);
  player.id = id;
  player.potentialAbility = Math.min(
    200,
    player.potentialAbility + rng.int(meta.paBonusRange[0], meta.paBonusRange[1]),
  );
  db.savePlayer(player);
  return player;
}
