import type { BuyType, MapName, Tactics } from '../types';
import type { RNG } from './rng';

// ============ Per-map T-side strategy playbooks ============
// Each strat defines target site, tempo (round pacing), early map-control zones,
// and commentary lines with broadcast-style timing.

export type StratTempo = 'rush' | 'fast' | 'standard' | 'slow';

export interface MapStrat {
  name: string;
  site: 'A' | 'B';
  tempo: StratTempo;
  control: string[]; // zone ids taken during the early phase (must exist on the map)
  startLine?: string; // shown at round start ({team} templated)
  controlLine?: string; // shown when map control phase peaks
  executeLine?: string; // shown when committing to the hit
  weight: number;
  // info-first round: gather information, then call the hit on the weaker site
  infoFirst?: boolean;
}

// Classic AWP lanes per map: where the CT AWPer anchors and where a T AWPer
// sets up during structured rounds (the standard "mid AWP" duel).
export const AWP_LANES: Record<MapName, { ct: string; t: string }> = {
  Dust2: { ct: 'ct-mid', t: 'mid' },
  Mirage: { ct: 'window', t: 'top-mid' },
  Inferno: { ct: 'arch', t: 'second-mid' },
  Nuke: { ct: 'outside', t: 'outside' },
  Ancient: { ct: 'mid-doors', t: 'mid' },
  Anubis: { ct: 'canal', t: 'mid' },
  Vertigo: { ct: 'elevators', t: 't-mid' },
};

export const TEMPO_TICKS: Record<StratTempo, [number, number]> = {
  rush: [2, 4], // hits ~0:08-0:12 elapsed
  fast: [7, 13], // ~0:15-0:25
  standard: [16, 28], // ~0:30-0:55
  slow: [30, 42], // ~1:00-1:25
};

export const MAP_STRATS: Record<MapName, MapStrat[]> = {
  Dust2: [
    {
      name: 'B Rush', site: 'B', tempo: 'rush', control: [],
      startLine: '{team} send all five through Upper Tunnels — B rush!',
      executeLine: '{team} flood out of Tunnels onto the B site!',
      weight: 1,
    },
    {
      name: 'Long Take', site: 'A', tempo: 'fast', control: ['outside-long', 'long-doors'],
      startLine: '{team} flash through Long Doors and take Long control.',
      executeLine: '{team} hit A from Long with the bomb trailing.',
      weight: 1.1,
    },
    {
      name: 'Mid-to-B Split', site: 'B', tempo: 'standard', control: ['mid', 'lower-tunnels'],
      startLine: 'First smoke of the round goes down Mid for {team}.',
      controlLine: '{team} are set up for the B split — Tunnels and Mid doors.',
      executeLine: '{team} split B through Mid doors and Upper Tunnels!',
      weight: 1,
    },
    {
      name: 'Short A Execute', site: 'A', tempo: 'standard', control: ['mid', 'short'],
      startLine: '{team} smoke Mid and sneak up Catwalk.',
      executeLine: '{team} pop flashes and hit A through Short!',
      weight: 1,
    },
    {
      name: 'Default Spread', site: 'A', tempo: 'slow', control: ['mid', 'outside-long', 'upper-tunnels'],
      startLine: '{team} spread across the map in a slow default — nothing committed yet.',
      controlLine: '{team} hold Mid, Long and Tunnels — gathering information.',
      weight: 1, infoFirst: true,
    },
    {
      name: 'Mid AWP Setup', site: 'B', tempo: 'standard', control: ['mid', 'lower-tunnels'],
      startLine: '{team} post their AWP at Mid Doors and play around the pick.',
      controlLine: 'The Mid battle defines this round — both AWPs staring each other down.',
      executeLine: '{team} use the Mid opening to collapse onto B!',
      weight: 1, infoFirst: true,
    },
  ],
  Mirage: [
    {
      name: 'B Apps Rush', site: 'B', tempo: 'rush', control: [],
      startLine: '{team} sprint down B Apartments — full send!',
      executeLine: '{team} jump out of Apartments onto B!',
      weight: 1,
    },
    {
      name: 'Mid Control Default', site: 'B', tempo: 'standard', control: ['top-mid', 'mid'],
      startLine: 'The first smoke goes down Mid — {team} take Top Mid control.',
      controlLine: '{team} own Mid and threaten Connector, Underpass and short.',
      executeLine: '{team} flow through Mid into the B short hit!',
      weight: 1.2,
    },
    {
      name: 'Full A Execute', site: 'A', tempo: 'standard', control: ['top-mid'],
      startLine: '{team} set up slow, lining up the A execute.',
      executeLine: '{team} throw the full A execute — smokes for CT, Jungle and Stairs!',
      weight: 1.1,
    },
    {
      name: 'Palace-Ramp Hit', site: 'A', tempo: 'fast', control: ['a-ramp'],
      startLine: '{team} stack Palace and Ramp early.',
      executeLine: '{team} hit A from Palace and Ramp together!',
      weight: 0.9,
    },
    {
      name: 'Underpass Sneak', site: 'B', tempo: 'slow', control: ['top-mid', 'underpass'],
      startLine: '{team} play a quiet default, creeping Underpass.',
      controlLine: '{team} have five players hidden — total silence from the T side.',
      executeLine: '{team} pop out of Underpass and Apartments at B!',
      weight: 0.8,
    },
    {
      name: 'Mid AWP Default', site: 'A', tempo: 'slow', control: ['top-mid', 'mid'],
      startLine: '{team} give their AWPer the Mid angle and feel for openings.',
      controlLine: 'The Window battle is live — whoever wins Mid wins the round setup.',
      executeLine: '{team} play off the Mid pick and roll towards the site!',
      weight: 1, infoFirst: true,
    },
  ],
  Inferno: [
    {
      name: 'Banana Rush', site: 'B', tempo: 'rush', control: [],
      startLine: '{team} send five down Banana immediately!',
      executeLine: '{team} crash onto the B site through Banana!',
      weight: 1,
    },
    {
      name: 'Banana Control', site: 'B', tempo: 'standard', control: ['banana'],
      startLine: '{team} fight for Banana control with molotovs and smokes.',
      controlLine: '{team} hold deep Banana — the B hit is loaded.',
      executeLine: '{team} commit to B behind a wall of utility!',
      weight: 1.2,
    },
    {
      name: 'Apps A Take', site: 'A', tempo: 'standard', control: ['apartments'],
      startLine: '{team} take Apartments early and hold close.',
      executeLine: '{team} jump down from Balcony and hit A with Pit support!',
      weight: 1.1,
    },
    {
      name: 'Mid-Arch Split', site: 'A', tempo: 'slow', control: ['second-mid', 'mid'],
      startLine: '{team} grind out Mid control in a slow default.',
      controlLine: '{team} threaten both Arch and Apartments — CTs guessing.',
      executeLine: '{team} split A through Arch and Apartments!',
      weight: 1, infoFirst: true,
    },
    {
      name: 'Pick & Probe', site: 'B', tempo: 'slow', control: ['second-mid', 'banana'],
      startLine: '{team} look for an opening pick before committing anywhere.',
      controlLine: '{team} poke Banana and Mid — reading the rotations.',
      weight: 0.9, infoFirst: true,
    },
  ],
  Nuke: [
    {
      name: 'Squeaky A Hit', site: 'A', tempo: 'fast', control: ['lobby'],
      startLine: '{team} go straight at the building through Lobby.',
      executeLine: '{team} break Squeaky and Hut and pile onto A!',
      weight: 1.1,
    },
    {
      name: 'Ramp Rush B', site: 'B', tempo: 'rush', control: [],
      startLine: '{team} sprint Ramp — straight down to B!',
      executeLine: '{team} flood down Ramp into the lower site!',
      weight: 1,
    },
    {
      name: 'Outside Take', site: 'B', tempo: 'slow', control: ['outside'],
      startLine: '{team} smoke the Outside crosses and walk the yard.',
      controlLine: '{team} own Outside — Secret and Garage both live.',
      executeLine: '{team} go B through Secret behind the smoke wall!',
      weight: 1,
    },
    {
      name: 'Vent Split', site: 'A', tempo: 'standard', control: ['lobby', 'hut'],
      startLine: '{team} take Hut quietly and hold Lobby.',
      executeLine: '{team} hit A through Hut and Squeaky at once!',
      weight: 0.9,
    },
    {
      name: 'Split Presence', site: 'A', tempo: 'slow', control: ['lobby', 'outside'],
      startLine: '{team} split between Lobby and Outside for information.',
      controlLine: '{team} have both routes scouted — the call is coming.',
      weight: 0.9, infoFirst: true,
    },
  ],
  Ancient: [
    {
      name: 'B Rush', site: 'B', tempo: 'rush', control: [],
      startLine: '{team} run the B ramp rush!',
      executeLine: '{team} pour out of B Main onto the site!',
      weight: 1,
    },
    {
      name: 'Donut Split', site: 'B', tempo: 'standard', control: ['mid', 'mid-doors'],
      startLine: '{team} smoke Mid Doors and take map control.',
      controlLine: '{team} control Mid — Donut and Cave both threatened.',
      executeLine: '{team} split B through Donut and B Main!',
      weight: 1.1,
    },
    {
      name: 'A Main Take', site: 'A', tempo: 'fast', control: ['a-main'],
      startLine: '{team} push up A Main early with flashes.',
      executeLine: '{team} clear the triple box and take the A site!',
      weight: 1.1,
    },
    {
      name: 'Mid Default', site: 'A', tempo: 'slow', control: ['mid', 'mid-doors'],
      startLine: '{team} settle into a patient Mid default.',
      controlLine: '{team} poke at Mid Doors and Elbow for information.',
      weight: 1, infoFirst: true,
    },
  ],
  Anubis: [
    {
      name: 'B Main Rush', site: 'B', tempo: 'rush', control: [],
      startLine: '{team} rush B Main off the gun round!',
      executeLine: '{team} swarm the B site through Main!',
      weight: 1,
    },
    {
      name: 'Water Control', site: 'B', tempo: 'standard', control: ['mid', 'water'],
      startLine: '{team} smoke Mid and slide into Water.',
      controlLine: '{team} hold Water and Canal — B collapse incoming.',
      executeLine: '{team} hit B from Water and Main together!',
      weight: 1.1,
    },
    {
      name: 'A Main-Con Split', site: 'A', tempo: 'standard', control: ['mid', 'palace'],
      startLine: '{team} take Palace and lurk Mid.',
      executeLine: '{team} split A through Main and Connector!',
      weight: 1.1,
    },
    {
      name: 'Slow Mid Default', site: 'A', tempo: 'slow', control: ['mid', 'water', 'palace'],
      startLine: '{team} spread out — slow round from the Ts.',
      controlLine: '{team} have presence everywhere; CTs cannot push anything.',
      weight: 1, infoFirst: true,
    },
  ],
  Vertigo: [
    {
      name: 'B Stairs Rush', site: 'B', tempo: 'rush', control: [],
      startLine: '{team} rush up B Stairs!',
      executeLine: '{team} burst onto B from Stairs and Window!',
      weight: 1.1,
    },
    {
      name: 'Mid-Ladder Split', site: 'B', tempo: 'standard', control: ['t-mid', 'mid'],
      startLine: '{team} take Mid with an early smoke on Elevators.',
      controlLine: '{team} hold Mid — Ladder room and B both in play.',
      executeLine: '{team} split B through Ladder and Stairs!',
      weight: 1,
    },
    {
      name: 'A Ramp Grind', site: 'A', tempo: 'standard', control: ['a-ramp'],
      startLine: '{team} smoke off Ramp and walk up together.',
      executeLine: '{team} push through the Ramp smokes onto A!',
      weight: 1.2,
    },
    {
      name: 'Scaffold Sneak', site: 'A', tempo: 'slow', control: ['a-ramp', 'scaffold'],
      startLine: '{team} creep the Scaffolding in a slow round.',
      executeLine: '{team} appear from Scaffolding behind the A defence!',
      weight: 0.8,
    },
    {
      name: 'Mid AWP Hold', site: 'B', tempo: 'standard', control: ['t-mid', 'mid'],
      startLine: '{team} let the AWP hold Mid while the rest probe for info.',
      controlLine: 'Mid is frozen — neither AWPer blinks.',
      executeLine: '{team} win Mid and pour towards B!',
      weight: 1, infoFirst: true,
    },
  ],
};

/** Round clock string for a tick (round starts at 1:55). */
export function clockAt(tick: number): string {
  const s = Math.max(0, 115 - tick * 2);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Pick a strat for the round: site is decided first (IGL read), then a strat
 * for that site weighted by tempo preference from tactics + economy.
 *
 * `enabledStrats` (optional): when non-empty, restricts the pool to the named
 * strats — this is how the per-map Playbook surfaces in the engine. If filtering
 * leaves no eligible candidates, falls back to the full pool so we don't crash.
 */
export function pickStrat(
  map: MapName,
  site: 'A' | 'B',
  tactics: Pick<Tactics, 'tPlaystyle' | 'aggression'>,
  buy: BuyType,
  rng: RNG,
  enabledStrats?: string[],
): MapStrat {
  const enabledSet = enabledStrats && enabledStrats.length ? new Set(enabledStrats) : null;
  const matchesEnabled = (s: MapStrat) => !enabledSet || enabledSet.has(s.name);
  let pool = MAP_STRATS[map].filter((s) => s.site === site && matchesEnabled(s));
  // If the user disabled every strat for this site, drop the filter for this site
  // so the engine still has options (better than crashing or stalling).
  if (pool.length === 0) pool = MAP_STRATS[map].filter((s) => s.site === site);
  const candidates = pool.length ? pool : MAP_STRATS[map];

  const weights = candidates.map((s) => {
    let w = s.weight;
    // economy: broke rounds favour rushes/fast hits; full buys favour structure
    if (buy === 'eco' || buy === 'pistol') w *= s.tempo === 'rush' ? 3 : s.tempo === 'fast' ? 1.6 : 0.5;
    if (buy === 'force') w *= s.tempo === 'rush' ? 1.8 : s.tempo === 'fast' ? 1.4 : 0.8;
    if (buy === 'full') w *= s.tempo === 'slow' || s.tempo === 'standard' ? 1.3 : 0.7;
    // playstyle
    switch (tactics.tPlaystyle) {
      case 'explosive':
        w *= s.tempo === 'rush' ? 2.4 : s.tempo === 'fast' ? 1.8 : 0.6;
        break;
      case 'slow-default':
        w *= s.tempo === 'slow' ? 2.4 : s.tempo === 'standard' ? 1.4 : 0.4;
        break;
      case 'default':
        w *= s.tempo === 'standard' ? 1.6 : 1;
        break;
      case 'mixed':
        break;
    }
    // aggression slider nudges pace
    w *= 1 + ((tactics.aggression - 10) / 10) * (s.tempo === 'rush' || s.tempo === 'fast' ? 0.5 : -0.3);
    return Math.max(0.05, w);
  });

  let roll = rng.next() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// ============ Named utility lineups per map ============
// Picked during control or execute phases to give the round texture beyond
// generic "first smoke goes down Mid". Templates: {nick} = utility thrower
// nickname, {team} = team tag.

export type UtilityKind = 'smoke' | 'flash' | 'molly' | 'he';

export interface UtilityLineup {
  line: string;
  kind: UtilityKind;
  forSites?: ('A' | 'B')[]; // omit = both sites
  phase?: 'control' | 'execute'; // omit = both phases
}

export const UTILITY_LINEUPS: Record<MapName, UtilityLineup[]> = {
  Mirage: [
    { line: '{nick} pops the CT cross smoke — A is split off from rotations.', kind: 'smoke', forSites: ['A'], phase: 'execute' },
    { line: '{nick} lands the Jungle one-way — Window AWP is dark.', kind: 'smoke', forSites: ['A'], phase: 'control' },
    { line: '{nick} drops Stairs smoke — Top Mid is locked off.', kind: 'smoke', phase: 'control' },
    { line: 'Molotov bursts in Connector — anyone holding there gets flushed.', kind: 'molly', forSites: ['A'], phase: 'execute' },
    { line: '{nick} arcs a pop-flash over Window — the AWPer flinches.', kind: 'flash', phase: 'control' },
    { line: 'Two smokes wall off Apps — Underpass is invisible.', kind: 'smoke', forSites: ['B'], phase: 'execute' },
    { line: '{nick} flashes over Short — pop and peek!', kind: 'flash', forSites: ['A'], phase: 'execute' },
    { line: 'Molotov on Ramp — anyone playing there cooks.', kind: 'molly', forSites: ['A'], phase: 'control' },
  ],
  Dust2: [
    { line: '{nick} smokes Xbox — Mid becomes a one-way.', kind: 'smoke', phase: 'control' },
    { line: '{nick} pops the CT cross smoke — A rotations cut off.', kind: 'smoke', forSites: ['A'], phase: 'execute' },
    { line: 'Long Doors smoke goes up — Long is being opened.', kind: 'smoke', forSites: ['A'], phase: 'control' },
    { line: 'B Doors smoke seals off — Tunnels rotation is dead.', kind: 'smoke', forSites: ['B'], phase: 'execute' },
    { line: 'Molotov hits Catwalk — the CT holding it has to bail.', kind: 'molly', forSites: ['A'], phase: 'control' },
    { line: '{nick} smokes off Pit — the A anchor is blind.', kind: 'smoke', forSites: ['A'], phase: 'execute' },
    { line: 'Molotov burns in Back Plat — the camper is forced out.', kind: 'molly', forSites: ['B'], phase: 'execute' },
    { line: '{nick} cracks an HE on B doors — chip damage on the rotation.', kind: 'he', forSites: ['B'], phase: 'control' },
  ],
  Inferno: [
    { line: '{nick} smokes off CT spawn — B retake is cut.', kind: 'smoke', forSites: ['B'], phase: 'execute' },
    { line: 'Coffin smoke up — the back of B is dark.', kind: 'smoke', forSites: ['B'], phase: 'execute' },
    { line: 'Molotov bursts in Pit — A anchor forced out.', kind: 'molly', forSites: ['A'], phase: 'execute' },
    { line: 'Molotov hits Banana — the choke clears.', kind: 'molly', forSites: ['B'], phase: 'control' },
    { line: 'Library smoke wall — Arch sightline is gone.', kind: 'smoke', forSites: ['A'], phase: 'execute' },
    { line: '{nick} pops a flash over Apps — quick swing on Balcony!', kind: 'flash', forSites: ['A'], phase: 'control' },
    { line: 'Molotov on Top Banana — pushing CTs cook out.', kind: 'molly', forSites: ['B'], phase: 'control' },
    { line: '{nick} HE stack on Banana — health gone before the fight.', kind: 'he', forSites: ['B'], phase: 'control' },
  ],
  Nuke: [
    { line: '{nick} smokes Heaven — A retake is harder.', kind: 'smoke', forSites: ['A'], phase: 'execute' },
    { line: 'Outside smokes go up — Yard is closed off.', kind: 'smoke', phase: 'control' },
    { line: '{nick} smokes off Vents — rotations are cut.', kind: 'smoke', phase: 'control' },
    { line: 'Ramp smoke up — B players walk in unseen.', kind: 'smoke', forSites: ['B'], phase: 'execute' },
    { line: '{nick} flashes over Hut — A peek incoming.', kind: 'flash', forSites: ['A'], phase: 'control' },
    { line: 'Molotov hits Squeaky — anyone holding has to swing out.', kind: 'molly', forSites: ['A'], phase: 'execute' },
  ],
  Ancient: [
    { line: 'Mid Doors smoke up — sightlines are dead.', kind: 'smoke', phase: 'control' },
    { line: 'Molotov in Donut — anyone holding there cooks.', kind: 'molly', forSites: ['B'], phase: 'execute' },
    { line: '{nick} smokes A Main — CT angles disappear.', kind: 'smoke', forSites: ['A'], phase: 'execute' },
    { line: 'Flash over Cave — the entry pops!', kind: 'flash', forSites: ['B'], phase: 'execute' },
    { line: 'Heaven smoke up — A retake is one-way.', kind: 'smoke', forSites: ['A'], phase: 'control' },
    { line: '{nick} drops a smoke on Elbow — Mid control tightens.', kind: 'smoke', phase: 'control' },
  ],
  Anubis: [
    { line: '{nick} smokes Connector — A rotations cut.', kind: 'smoke', forSites: ['A'], phase: 'control' },
    { line: 'Flash bursts over Water — the Ts pop out!', kind: 'flash', forSites: ['B'], phase: 'execute' },
    { line: '{nick} smokes Palace — A peek is shielded.', kind: 'smoke', forSites: ['A'], phase: 'control' },
    { line: 'Molotov hits Heaven — the anchor is forced down.', kind: 'molly', forSites: ['A'], phase: 'execute' },
    { line: 'B Main smoke — the choke is opened up.', kind: 'smoke', forSites: ['B'], phase: 'control' },
    { line: '{nick} arcs the Canal smoke — Mid stalemate broken.', kind: 'smoke', phase: 'control' },
  ],
  Vertigo: [
    { line: '{nick} smokes Elevators — Mid becomes one-way.', kind: 'smoke', phase: 'control' },
    { line: 'A Ramp smoke up — anchors can\'t see anything.', kind: 'smoke', forSites: ['A'], phase: 'execute' },
    { line: 'B back-of-site smoke goes down — retake is harder.', kind: 'smoke', forSites: ['B'], phase: 'execute' },
    { line: 'Flash over B Stairs — the entry takes the peek!', kind: 'flash', forSites: ['B'], phase: 'execute' },
    { line: 'Molotov bursts in Window — A anchor pushed off.', kind: 'molly', forSites: ['A'], phase: 'control' },
    { line: '{nick} pops the Ladder Room smoke — sneak route opens.', kind: 'smoke', forSites: ['B'], phase: 'control' },
  ],
};

/**
 * Roll utility damage for a thrown lineup. Smokes do nothing; flashes chip ~10;
 * HEs and especially mollies hurt. Player utility attribute scales 0.6× → 1.4×.
 */
export function rollUtilityDamage(kind: UtilityKind, utilAttr: number, rng: RNG): number {
  const utilMult = 0.6 + (utilAttr / 20) * 0.8;
  let base = 0;
  switch (kind) {
    case 'smoke': base = 0; break;
    case 'flash': base = rng.int(0, 12); break;
    case 'he': base = rng.int(20, 55); break;
    case 'molly': base = rng.int(30, 85); break;
  }
  return Math.round(base * utilMult);
}

export function pickUtilityLineup(
  map: MapName,
  site: 'A' | 'B',
  phase: 'control' | 'execute',
  rng: RNG,
): UtilityLineup | null {
  const all = UTILITY_LINEUPS[map] || [];
  const eligible = all.filter(
    (u) => (!u.forSites || u.forSites.includes(site)) && (!u.phase || u.phase === phase),
  );
  if (eligible.length === 0) return null;
  return rng.pick(eligible);
}

/** Validation helper: every control zone id must exist on its map. */
export function validateStrats(zoneIdsByMap: Record<MapName, Set<string>>): string[] {
  const errors: string[] = [];
  for (const [map, strats] of Object.entries(MAP_STRATS) as [MapName, MapStrat[]][]) {
    for (const s of strats) {
      for (const z of s.control) {
        if (!zoneIdsByMap[map]?.has(z)) errors.push(`${map}/${s.name}: unknown control zone '${z}'`);
      }
    }
    if (!strats.some((s) => s.site === 'A') || !strats.some((s) => s.site === 'B')) {
      errors.push(`${map}: needs at least one strat per site`);
    }
    const lanes = AWP_LANES[map];
    if (!zoneIdsByMap[map]?.has(lanes.ct)) errors.push(`${map}: unknown CT AWP lane '${lanes.ct}'`);
    if (!zoneIdsByMap[map]?.has(lanes.t)) errors.push(`${map}: unknown T AWP lane '${lanes.t}'`);
  }
  return errors;
}
