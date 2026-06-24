// Shared free agent pool. The first time anyone asks for the FA list the
// server seeds the DB with 200+ generated players using the same pipeline
// the single-player career mode uses (src/data/faPool). Players that get
// signed by a team simply move their teamId; the pool count drops until
// the next refill threshold is crossed.

import { generateFreeAgentPool } from '../../src/data/faPool.ts';
import { buildPlayer, type PlayerSpec, type TeamSpec } from '../../src/data/dbBuild.ts';
import { NEWGEN_POOLS } from '../../src/data/newgenNames.ts';
import { RNG, hashSeed } from '../../src/engine/rng.ts';
import { CONTRACT_DUELS_INITIAL_FA, MINT_TIERS, type MintTier } from '../../src/online/protocol.ts';
import type { Player, PlayerRole, Region } from '../../src/types.ts';
import { ROSTERS_A } from '../../src/data/rostersA.ts';
import { ROSTERS_B } from '../../src/data/rostersB.ts';
import { FREE_AGENTS as REAL_FREE_AGENTS, ROSTERS_C } from '../../src/data/rostersC.ts';
import { ROSTERS_D } from '../../src/data/rostersD.ts';
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
  // Seed source must include enough entropy that two refills in the same
  // calendar day don't replay the same RNG sequence (which would collide
  // with whatever we already inserted on the first run).
  const startDate = new Date().toISOString().slice(0, 10);
  const seedTag = `${startDate}-${have}-${Date.now()}`;
  // Collect IDs/nicks from EVERY player in the table — signed roster players
  // share the same nickname pool as the FA generator, so checking only the
  // FA subset is not enough to avoid `UNIQUE constraint failed` collisions.
  const { ids: usedIds, nicks: usedNicks } = db.loadAllPlayerKeys();
  const fresh = generateFreeAgentPool(seedTag, usedIds, usedNicks);
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

  // Collision check against every existing player — both FAs and signed
  // roster players share the same nickname pool, and a collision on either
  // would trigger a UNIQUE constraint failure on insert.
  const { ids: usedIds, nicks: usedNicks } = db.loadAllPlayerKeys();

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

/**
 * Seed the FA pool with every real-name HLTV player from the single-player
 * rosters (ROSTERS_A..D + hand-curated FREE_AGENTS in rostersC). All enter
 * the online server as free agents — anyone can sign them, and when their
 * contract expires (duel cap) they return to the FA pool same as newgens.
 *
 * Idempotent via canary check + INSERT OR IGNORE: safe to call on every
 * server boot. Only inserts that didn't previously exist actually land.
 *
 * Returns the count of records inserted on this call (0 = already seeded).
 */
export function seedRealNamePool(db: DB): { added: number } {
  // Canary: if `s1mple` is already in the players table, real-name pool
  // has already been seeded on a prior boot. Skip the work.
  if (db.loadPlayer('s1mple')) return { added: 0 };

  const startDate = new Date().toISOString().slice(0, 10);
  const { ids: usedIds, nicks: usedNicks } = db.loadAllPlayerKeys();
  let added = 0;

  const insertSpec = (spec: PlayerSpec): void => {
    const baseId = spec.nick.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let id = baseId;
    let suffix = 0;
    while (usedIds.has(id)) id = `${baseId}-${++suffix}`;
    usedIds.add(id);
    usedNicks.add(spec.nick.toLowerCase());
    // buildPlayer with teamId=null yields contract=null — pure free agent.
    const player = buildPlayer(spec, null, startDate);
    player.id = id;
    db.savePlayer(player); // INSERT OR IGNORE — duplicate ids silently no-op
    added++;
  };

  const allTeamRosters: TeamSpec[] = [...ROSTERS_A, ...ROSTERS_B, ...ROSTERS_C, ...ROSTERS_D];
  for (const team of allTeamRosters) {
    for (const spec of team.players) insertSpec(spec);
  }
  for (const spec of REAL_FREE_AGENTS) insertSpec(spec);

  return { added };
}

/**
 * Walk every signed player and stamp duelsRemaining onto contracts that
 * predate the duel-cap system. Runs once on server boot so legacy rosters
 * + any bench-promoted player (who never decremented while sitting out)
 * land with a real counter visible immediately — no more "unlimited" -looking
 * "—" cells on the home roster table.
 *
 * Cheap: one SELECT + one persistPlayer per row that needs a backfill.
 * Idempotent — re-running it finds nothing to do on subsequent boots.
 */
export function backfillLegacyContracts(db: DB): { updated: number } {
  const rows = db.raw
    .prepare(`SELECT id, json FROM players WHERE team_id IS NOT NULL`)
    .all() as { id: string; json: string }[];
  let updated = 0;
  for (const r of rows) {
    let p: Player;
    try { p = JSON.parse(r.json) as Player; }
    catch { continue; }
    if (!p.contract) continue;
    if (typeof p.contract.duelsRemaining === 'number') continue;
    p.contract.duelsRemaining = CONTRACT_DUELS_INITIAL_FA;
    db.persistPlayer(p);
    updated++;
  }
  return { updated };
}
