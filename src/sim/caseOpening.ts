// CS2 case opening — pure roll logic. Picks a rarity per real CS odds, then a
// skin uniformly from that rarity tier, then rolls a unique float ∈ [0, 1] that
// determines wear bucket + within-bucket value premium, then StatTrak flag,
// then computes the wear-adjusted market value.
//
// Float system: every drop gets a unique decimal. Lower floats command real
// premiums (rare "white-float" trophies). The bucket frequency mirrors real
// CS2 distribution; float is uniform inside the chosen bucket so low floats
// stay statistically rare without ever being impossible.

import type { CaseDef, Skin, SkinInstance, SkinRarity, WearLevel } from '../types';
import type { RNG } from '../engine/rng';
import { CASES, RARITY_ODDS, STATTRAK_CHANCE, STATTRAK_MULT, WEAR_DIST } from '../data/cs2Cases';

const RARITY_ORDER: SkinRarity[] = ['mil-spec', 'restricted', 'classified', 'covert', 'rare-special'];

/** Float bucket bounds aligned with WEAR_DIST entries — keeps bucket
 *  frequencies identical to the legacy roll while exposing a unique
 *  float per drop. */
const BUCKET_BOUNDS: Record<WearLevel, [number, number]> = {
  'Factory New': [0.00, 0.07],
  'Minimal Wear': [0.07, 0.15],
  'Field-Tested': [0.15, 0.38],
  'Well-Worn': [0.38, 0.45],
  'Battle-Scarred': [0.45, 1.00],
};

function rollRarity(rng: RNG, casePool: Skin[]): SkinRarity {
  // Skip rarities the case doesn't have (defensive fallback).
  const present = new Set(casePool.map((s) => s.rarity));
  const r = rng.next();
  let acc = 0;
  for (const tier of RARITY_ORDER) {
    if (!present.has(tier)) continue;
    acc += RARITY_ODDS[tier];
    if (r <= acc) return tier;
  }
  // If odds didn't sum to 1 (shouldn't happen) fall back to mil-spec.
  return present.has('mil-spec') ? 'mil-spec' : (Array.from(present)[0] ?? 'mil-spec');
}

/** Pick a wear bucket per real CS2 odds, then roll a unique float inside
 *  that bucket. Returns the float + the bucket's base mult so the caller
 *  can stack the within-bucket float premium on top. */
function rollWearWithFloat(rng: RNG): { wear: WearLevel; mult: number; float: number } {
  const r = rng.next();
  let acc = 0;
  for (const w of WEAR_DIST) {
    acc += w.chance;
    if (r <= acc) {
      const [lo, hi] = BUCKET_BOUNDS[w.wear];
      const f = Math.round((lo + rng.next() * (hi - lo)) * 10_000) / 10_000;
      return { wear: w.wear, mult: w.mult, float: f };
    }
  }
  return { wear: 'Field-Tested', mult: 1.0, float: 0.25 };
}

/** Within-bucket float premium — lower float = higher market value.
 *  Ramps linearly from 1.30 (float 0.00) to 0.80 (float 1.00). Mirrors
 *  the wire-side `floatPriceMultiplier` in src/online/protocol.ts. */
function floatPremium(f: number): number {
  const clamped = Math.max(0, Math.min(1, f));
  return Math.round((1.30 - clamped * 0.50) * 1000) / 1000;
}

export interface OpenResult {
  instance: SkinInstance;
  skin: Skin;
  /** Pre-shuffled strip used by the animation. Winner sits at WINNER_INDEX. */
  strip: Skin[];
  winnerIndex: number;
}

/** Where the winning skin lands in the generated strip — chosen so the
 *  animation has enough lead-in scrolling to feel satisfying. */
export const WINNER_INDEX = 55;

/** Roll a single case-open. Returns the new SkinInstance + the strip the
 *  UI should animate over. `allocSerial` returns the next sequential mint
 *  number for the rolled skin's skinId — caller wires this to whatever
 *  storage they're using (SQLite counter table on the server, no-op
 *  number on the offline single-player path). */
export function openCase(
  caseDef: CaseDef,
  rng: RNG,
  today: string,
  instanceCounter: () => string,
  allocSerial: (skinId: string) => number = () => 0,
): OpenResult {
  const rarity = rollRarity(rng, caseDef.skins);
  const tierPool = caseDef.skins.filter((s) => s.rarity === rarity);
  const skin = tierPool[rng.int(0, tierPool.length - 1)];
  const { wear, mult, float } = rollWearWithFloat(rng);
  const statTrak = rng.chance(STATTRAK_CHANCE);
  const value = Math.round(skin.basePrice * mult * floatPremium(float) * (statTrak ? STATTRAK_MULT : 1));

  const instance: SkinInstance = {
    id: instanceCounter(),
    skinId: skin.id,
    weapon: skin.weapon,
    name: skin.name,
    rarity: skin.rarity,
    wear,
    marketValue: value,
    statTrak,
    acquiredOn: today,
    caseId: caseDef.id,
    float,
    serial: allocSerial(skin.id),
    history: [],
  };

  // Build the animation strip — 80 items drawn from the case pool, with the
  // winner placed at WINNER_INDEX so the animation lands on it.
  const strip: Skin[] = [];
  for (let i = 0; i < 80; i++) {
    if (i === WINNER_INDEX) {
      strip.push(skin);
    } else {
      strip.push(caseDef.skins[rng.int(0, caseDef.skins.length - 1)]);
    }
  }

  return { instance, skin, strip, winnerIndex: WINNER_INDEX };
}

/** Pretty colour for a rarity — matches CS2's classic tier hues. */
export const RARITY_COLOR: Record<SkinRarity, string> = {
  'mil-spec': '#4b69ff',
  restricted: '#8847ff',
  classified: '#d32ce6',
  covert: '#eb4b4b',
  'rare-special': '#ffd700',
};

export const RARITY_LABEL: Record<SkinRarity, string> = {
  'mil-spec': 'Mil-Spec',
  restricted: 'Restricted',
  classified: 'Classified',
  covert: 'Covert',
  'rare-special': '★ Rare Special',
};

const RARITY_NEXT: Record<SkinRarity, SkinRarity | null> = {
  'mil-spec': 'restricted',
  restricted: 'classified',
  classified: 'covert',
  covert: 'rare-special',
  'rare-special': null, // cannot trade up further
};

/** Trade-up contract: 10 same-rarity skins → 1 random skin of NEXT rarity
 *  tier. Output float = AVERAGE of input floats (CS2 rule), so low-float
 *  collections produce low-float outputs and the trade-up minigame has
 *  real depth. Wear bucket derived from that averaged float; bucket base
 *  mult comes from WEAR_DIST, with float premium stacked on top.
 *  Returns null if rarity is rare-special (cannot trade up) or inputs
 *  mismatch. Caller supplies an `allocSerial` for the new mint. */
export function tradeUpContract(
  inputs: SkinInstance[],
  rng: RNG,
  today: string,
  instanceCounter: () => string,
  allocSerial: (skinId: string) => number = () => 0,
): SkinInstance | null {
  if (inputs.length !== 10) return null;
  const rarity = inputs[0].rarity;
  if (!inputs.every((s) => s.rarity === rarity)) return null;
  const nextRarity = RARITY_NEXT[rarity];
  if (!nextRarity) return null;
  // Pool: all skins at next rarity from all cases.
  const pool: { skin: Skin; caseId: string }[] = [];
  for (const c of CASES) {
    for (const s of c.skins) {
      if (s.rarity === nextRarity) pool.push({ skin: s, caseId: c.id });
    }
  }
  if (pool.length === 0) return null;
  const picked = pool[rng.int(0, pool.length - 1)];
  // Average input floats — fall back to 0.25 (mid Field-Tested) for any
  // legacy inputs that predate the float system.
  const floats = inputs.map((s) => (typeof s.float === 'number' ? s.float : 0.25));
  const outFloat = Math.round((floats.reduce((a, b) => a + b, 0) / floats.length) * 10_000) / 10_000;
  const wear = wearForFloatLocal(outFloat);
  const bucket = WEAR_DIST.find((b) => b.wear === wear);
  const baseMult = bucket?.mult ?? 1.0;
  const statTrak = rng.chance(STATTRAK_CHANCE);
  const value = Math.round(picked.skin.basePrice * baseMult * floatPremium(outFloat) * (statTrak ? STATTRAK_MULT : 1));
  return {
    id: instanceCounter(),
    skinId: picked.skin.id,
    weapon: picked.skin.weapon,
    name: picked.skin.name,
    rarity: picked.skin.rarity,
    wear,
    marketValue: value,
    statTrak,
    acquiredOn: today,
    caseId: picked.caseId,
    float: outFloat,
    serial: allocSerial(picked.skin.id),
    history: [],
  };
}

/** Local mirror of wearForFloat used by tradeUpContract — duplicated
 *  here so caseOpening.ts has no dependency on the online protocol module
 *  (it's used by single-player code too). Bounds match WEAR_BUCKETS. */
function wearForFloatLocal(f: number): WearLevel {
  if (f < 0.07) return 'Factory New';
  if (f < 0.15) return 'Minimal Wear';
  if (f < 0.38) return 'Field-Tested';
  if (f < 0.45) return 'Well-Worn';
  return 'Battle-Scarred';
}

/** Souvenir Package roll — biased toward higher rarities (3% mil-spec, 17%
 *  restricted, 35% classified, 35% covert, 10% rare-special). Pool is all
 *  skins from all cases. Stamps the result with souvenir=true (+20% value). */
export function openSouvenirPackage(
  rng: RNG,
  today: string,
  instanceCounter: () => string,
  allocSerial: (skinId: string) => number = () => 0,
): SkinInstance {
  // Souvenir odds skew up — these are reward packages, not gachas.
  const r = rng.next();
  let rarity: SkinRarity;
  if (r < 0.03) rarity = 'mil-spec';
  else if (r < 0.20) rarity = 'restricted';
  else if (r < 0.55) rarity = 'classified';
  else if (r < 0.90) rarity = 'covert';
  else rarity = 'rare-special';

  const pool: { skin: Skin; caseId: string }[] = [];
  for (const c of CASES) {
    for (const s of c.skins) {
      if (s.rarity === rarity) pool.push({ skin: s, caseId: c.id });
    }
  }
  if (pool.length === 0) {
    // Fallback to any skin if pool empty (defensive).
    for (const c of CASES) for (const s of c.skins) pool.push({ skin: s, caseId: c.id });
  }
  const picked = pool[rng.int(0, pool.length - 1)];
  const { wear, mult, float } = rollWearWithFloat(rng);
  const statTrak = false; // Souvenirs don't get StatTrak in real CS.
  const value = Math.round(picked.skin.basePrice * mult * floatPremium(float) * 1.2); // +20% souvenir premium
  return {
    id: instanceCounter(),
    skinId: picked.skin.id,
    weapon: picked.skin.weapon,
    name: picked.skin.name,
    rarity: picked.skin.rarity,
    wear,
    marketValue: value,
    statTrak,
    acquiredOn: today,
    caseId: 'souvenir-major',
    souvenir: true,
    float,
    serial: allocSerial(picked.skin.id),
    history: [],
  };
}
