// ============ Map layout data for the 2D match viewer ============
// Coordinates are normalized 0-1 and calibrated against the official CS2
// radar images in public/maps/<MapName>.png (drawn as the canvas background).
// Zones form a connected, symmetric navigation graph per map.

import type { MapLayout, MapName, MapZone } from '../types';

function z(
  id: string,
  name: string,
  x: number,
  y: number,
  neighbors: string[],
  extra?: { isSite?: 'A' | 'B'; isSpawn?: 'T' | 'CT' },
): MapZone {
  const zone: MapZone = { id, name, x, y, neighbors: [...neighbors] };
  if (extra?.isSite) zone.isSite = extra.isSite;
  if (extra?.isSpawn) zone.isSpawn = extra.isSpawn;
  return zone;
}

// ---------------- Mirage ----------------
// Radar: B site top-left, A site bottom-center, T spawn right edge, CT spawn left-middle.
const mirage: MapLayout = {
  name: 'Mirage',
  zones: [
    z('t-spawn', 'T Spawn', 0.86, 0.37, ['top-mid', 'a-ramp', 'palace', 'b-apts'], { isSpawn: 'T' }),
    z('top-mid', 'Top Mid', 0.68, 0.44, ['t-spawn', 'mid']),
    z('a-ramp', 'A Ramp', 0.66, 0.78, ['t-spawn', 'a-site']),
    z('palace', 'Palace', 0.49, 0.85, ['t-spawn', 'a-site']),
    z('a-site', 'A Site', 0.54, 0.77, ['a-ramp', 'palace', 'stairs', 'jungle'], { isSite: 'A' }),
    z('stairs', 'Stairs', 0.47, 0.69, ['connector', 'a-site']),
    z('jungle', 'Jungle', 0.41, 0.66, ['connector', 'a-site', 'ct-spawn']),
    z('connector', 'Connector', 0.46, 0.60, ['mid', 'window', 'stairs', 'jungle']),
    z('mid', 'Mid', 0.55, 0.48, ['top-mid', 'connector', 'window', 'underpass']),
    z('window', 'Window', 0.43, 0.46, ['mid', 'connector', 'ct-spawn']),
    z('underpass', 'Underpass', 0.44, 0.37, ['mid', 'b-site']),
    z('b-apts', 'B Apartments', 0.64, 0.20, ['t-spawn', 'b-site']),
    z('b-site', 'B Site', 0.24, 0.29, ['b-apts', 'underpass', 'market'], { isSite: 'B' }),
    z('market', 'Market', 0.20, 0.44, ['ct-spawn', 'b-site']),
    z('ct-spawn', 'CT Spawn', 0.31, 0.70, ['jungle', 'window', 'market'], { isSpawn: 'CT' }),
  ],
  walls: [],
  bends: {
    'a-ramp|t-spawn': [[0.74, 0.74], [0.83, 0.60]],
    'palace|t-spawn': [[0.62, 0.86], [0.83, 0.62]],
    'b-apts|t-spawn': [[0.80, 0.24]],
    'b-site|underpass': [[0.43, 0.28]],
    'b-apts|b-site': [[0.42, 0.19]],
    'ct-spawn|market': [[0.20, 0.60]],
    'ct-spawn|window': [[0.36, 0.55]],
  },
};

// ---------------- Inferno ----------------
// Radar: T spawn left, B site (fountain) top-center, A site lower-right, CT spawn upper-right.
const inferno: MapLayout = {
  name: 'Inferno',
  zones: [
    z('t-spawn', 'T Spawn', 0.10, 0.68, ['second-mid', 'apartments'], { isSpawn: 'T' }),
    z('second-mid', 'Second Mid', 0.28, 0.69, ['t-spawn', 'mid', 'banana']),
    z('mid', 'Mid', 0.44, 0.62, ['second-mid', 'arch']),
    z('banana', 'Banana', 0.50, 0.42, ['second-mid', 'b-site']),
    z('b-site', 'B Site', 0.49, 0.22, ['banana', 'ct-spawn'], { isSite: 'B' }),
    z('arch', 'Arch', 0.63, 0.57, ['mid', 'library', 'a-site']),
    z('library', 'Library', 0.72, 0.49, ['arch', 'ct-spawn']),
    z('ct-spawn', 'CT Spawn', 0.87, 0.37, ['library', 'b-site', 'graveyard'], { isSpawn: 'CT' }),
    z('graveyard', 'Graveyard', 0.84, 0.58, ['ct-spawn', 'a-site']),
    z('apartments', 'Apartments', 0.46, 0.78, ['t-spawn', 'balcony']),
    z('balcony', 'Balcony', 0.62, 0.74, ['apartments', 'a-site', 'pit']),
    z('pit', 'Pit', 0.73, 0.82, ['balcony', 'a-site']),
    z('a-site', 'A Site', 0.79, 0.68, ['arch', 'graveyard', 'balcony', 'pit'], { isSite: 'A' }),
  ],
  walls: [],
  bends: {
    'apartments|t-spawn': [[0.27, 0.80]],
    'banana|second-mid': [[0.43, 0.52]],
    'b-site|banana': [[0.54, 0.32]],
    'b-site|ct-spawn': [[0.60, 0.16], [0.74, 0.25]],
  },
};

// ---------------- Nuke ----------------
// Radar (upper level): T spawn far left, main A building center, yard/outside right,
// CT spawn right edge, garage & secret lower-right. B site abstracted under A (lower level).
const nuke: MapLayout = {
  name: 'Nuke',
  zones: [
    z('t-spawn', 'T Spawn', 0.20, 0.55, ['lobby', 'outside'], { isSpawn: 'T' }),
    z('lobby', 'Lobby', 0.46, 0.52, ['t-spawn', 'squeaky', 'ramp', 'hut']),
    z('outside', 'Outside', 0.72, 0.52, ['t-spawn', 'secret', 'garage']),
    z('garage', 'Garage', 0.73, 0.67, ['outside', 'ct-spawn']),
    z('secret', 'Secret', 0.68, 0.74, ['outside', 'b-site']),
    z('ramp', 'Ramp', 0.64, 0.62, ['lobby', 'b-site']),
    z('squeaky', 'Squeaky', 0.50, 0.60, ['lobby', 'a-site']),
    z('hut', 'Hut', 0.50, 0.45, ['lobby', 'a-site']),
    z('a-site', 'A Site', 0.58, 0.50, ['squeaky', 'hut', 'heaven', 'vents'], { isSite: 'A' }),
    z('vents', 'Vents', 0.60, 0.57, ['a-site', 'b-site']),
    z('b-site', 'B Site', 0.59, 0.66, ['ramp', 'vents', 'secret'], { isSite: 'B' }),
    z('heaven', 'Heaven', 0.63, 0.44, ['a-site', 'ct-spawn']),
    z('ct-spawn', 'CT Spawn', 0.83, 0.47, ['heaven', 'garage'], { isSpawn: 'CT' }),
  ],
  walls: [],
  bends: {
    'outside|t-spawn': [[0.66, 0.70], [0.45, 0.67]],
  },
};

// ---------------- Ancient ----------------
// Radar: CT spawn top-center, B site upper-left, A site right, T spawn bottom-center,
// donut ring left-center linking mid to B.
const ancient: MapLayout = {
  name: 'Ancient',
  zones: [
    z('t-spawn', 'T Spawn', 0.48, 0.87, ['b-ramp', 'mid', 'a-main'], { isSpawn: 'T' }),
    z('b-ramp', 'B Ramp', 0.30, 0.72, ['t-spawn', 'b-main']),
    z('b-main', 'B Main', 0.22, 0.55, ['b-ramp', 'b-site']),
    z('b-site', 'B Site', 0.30, 0.27, ['b-main', 'cave', 'ct-spawn', 'donut'], { isSite: 'B' }),
    z('cave', 'Cave', 0.41, 0.24, ['b-site', 'mid-doors']),
    z('mid', 'Mid', 0.47, 0.57, ['t-spawn', 'mid-doors']),
    z('mid-doors', 'Mid Doors', 0.47, 0.42, ['mid', 'cave', 'donut', 'ct-spawn']),
    z('donut', 'Donut', 0.30, 0.46, ['mid-doors', 'b-site']),
    z('a-main', 'A Main', 0.72, 0.65, ['t-spawn', 'a-site']),
    z('a-site', 'A Site', 0.75, 0.41, ['a-main', 'elbow'], { isSite: 'A' }),
    z('elbow', 'Elbow', 0.62, 0.30, ['a-site', 'ct-spawn']),
    z('ct-spawn', 'CT Spawn', 0.50, 0.15, ['elbow', 'mid-doors', 'b-site'], { isSpawn: 'CT' }),
  ],
  walls: [],
  bends: {
    'a-main|t-spawn': [[0.62, 0.78]],
    'b-main|b-site': [[0.20, 0.40]],
    'b-site|ct-spawn': [[0.40, 0.16]],
    'a-main|a-site': [[0.78, 0.53]],
  },
};

// ---------------- Anubis ----------------
// Radar: T spawn bottom, CT spawn top-center, A site top-right, B site left-center.
const anubis: MapLayout = {
  name: 'Anubis',
  zones: [
    z('t-spawn', 'T Spawn', 0.49, 0.89, ['mid', 'a-main', 'b-main'], { isSpawn: 'T' }),
    z('a-main', 'A Main', 0.70, 0.74, ['t-spawn', 'a-site', 'palace']),
    z('palace', 'Palace', 0.62, 0.68, ['a-main', 'mid']),
    z('mid', 'Mid', 0.55, 0.62, ['t-spawn', 'palace', 'connector', 'water']),
    z('connector', 'Connector', 0.66, 0.45, ['mid', 'a-site']),
    z('water', 'Water', 0.53, 0.50, ['mid', 'canal']),
    z('canal', 'Canal', 0.48, 0.36, ['water', 'b-site', 'ct-spawn']),
    z('b-main', 'B Main', 0.31, 0.77, ['t-spawn', 'b-site']),
    z('b-site', 'B Site', 0.33, 0.49, ['b-main', 'canal', 'street'], { isSite: 'B' }),
    z('street', 'Street', 0.38, 0.31, ['b-site', 'ct-spawn']),
    z('a-site', 'A Site', 0.76, 0.27, ['a-main', 'connector', 'ct-spawn'], { isSite: 'A' }),
    z('ct-spawn', 'CT Spawn', 0.43, 0.22, ['a-site', 'canal', 'street'], { isSpawn: 'CT' }),
  ],
  walls: [],
  bends: {
    'b-main|b-site': [[0.26, 0.62]],
    'a-main|a-site': [[0.80, 0.60], [0.82, 0.40]],
    'a-site|ct-spawn': [[0.58, 0.22]],
  },
};

// ---------------- Vertigo ----------------
// Radar: A site top-left, B site right-center, CT spawn top-center, T spawn lower-left.
const vertigo: MapLayout = {
  name: 'Vertigo',
  zones: [
    z('t-spawn', 'T Spawn', 0.42, 0.74, ['t-mid', 'a-ramp', 'b-stairs'], { isSpawn: 'T' }),
    z('t-mid', 'T Mid', 0.44, 0.61, ['t-spawn', 'mid']),
    z('a-ramp', 'A Ramp', 0.30, 0.61, ['t-spawn', 'scaffold', 'a-site']),
    z('scaffold', 'Scaffolding', 0.18, 0.43, ['a-ramp', 'a-site']),
    z('a-site', 'A Site', 0.22, 0.24, ['a-ramp', 'scaffold', 'ct-spawn'], { isSite: 'A' }),
    z('ct-spawn', 'CT Spawn', 0.56, 0.25, ['a-site', 'elevators', 'b-site'], { isSpawn: 'CT' }),
    z('elevators', 'Elevators', 0.51, 0.34, ['ct-spawn', 'mid']),
    z('mid', 'Mid', 0.46, 0.48, ['t-mid', 'elevators', 'ladder']),
    z('ladder', 'Ladder Room', 0.57, 0.50, ['mid', 'b-site']),
    z('b-stairs', 'B Stairs', 0.58, 0.71, ['t-spawn', 'window']),
    z('window', 'Window', 0.66, 0.65, ['b-stairs', 'b-site']),
    z('b-site', 'B Site', 0.71, 0.58, ['window', 'ladder', 'ct-spawn'], { isSite: 'B' }),
  ],
  walls: [],
  bends: {
    'a-ramp|a-site': [[0.20, 0.45]],
    'a-site|ct-spawn': [[0.38, 0.22]],
    'b-site|ct-spawn': [[0.68, 0.40]],
  },
};

// ---------------- Dust2 ----------------
// Radar: B site top-left, A site top-right, CT spawn top-center, T spawn bottom,
// mid vertical center, long along the right, tunnels along the left.
const dust2: MapLayout = {
  name: 'Dust2',
  zones: [
    z('t-spawn', 'T Spawn', 0.38, 0.88, ['outside-long', 'mid', 'upper-tunnels'], { isSpawn: 'T' }),
    z('outside-long', 'Outside Long', 0.57, 0.78, ['t-spawn', 'long-doors']),
    z('long-doors', 'Long Doors', 0.66, 0.55, ['outside-long', 'long']),
    z('long', 'Long A', 0.82, 0.45, ['long-doors', 'pit', 'a-site']),
    z('pit', 'Pit', 0.73, 0.25, ['long', 'a-site']),
    z('a-site', 'A Site', 0.80, 0.16, ['long', 'pit', 'short', 'ct-spawn'], { isSite: 'A' }),
    z('short', 'Catwalk', 0.62, 0.33, ['mid', 'a-site']),
    z('mid', 'Mid', 0.47, 0.45, ['t-spawn', 'short', 'ct-mid', 'lower-tunnels']),
    z('ct-mid', 'CT Mid', 0.49, 0.28, ['mid', 'ct-spawn', 'b-doors']),
    z('ct-spawn', 'CT Spawn', 0.61, 0.19, ['ct-mid', 'a-site'], { isSpawn: 'CT' }),
    z('b-doors', 'B Doors', 0.36, 0.25, ['ct-mid', 'b-site']),
    z('upper-tunnels', 'Upper Tunnels', 0.27, 0.48, ['t-spawn', 'lower-tunnels', 'b-site']),
    z('lower-tunnels', 'Lower Tunnels', 0.38, 0.53, ['upper-tunnels', 'mid']),
    z('b-site', 'B Site', 0.20, 0.14, ['upper-tunnels', 'b-doors'], { isSite: 'B' }),
  ],
  walls: [],
  bends: {
    't-spawn|upper-tunnels': [[0.25, 0.70]],
    'mid|t-spawn': [[0.47, 0.65]],
    'b-site|upper-tunnels': [[0.22, 0.30]],
    'a-site|short': [[0.68, 0.22]],
  },
};

export const MAP_LAYOUTS: Record<MapName, MapLayout> = {
  Mirage: mirage,
  Inferno: inferno,
  Nuke: nuke,
  Ancient: ancient,
  Anubis: anubis,
  Vertigo: vertigo,
  Dust2: dust2,
};

/** Runtime validation: connectivity, neighbor symmetry, required spawns/sites. */
export function validateLayouts(): string[] {
  const errors: string[] = [];
  for (const layout of Object.values(MAP_LAYOUTS)) {
    const ids = new Set(layout.zones.map((zz) => zz.id));
    if (ids.size !== layout.zones.length) errors.push(`${layout.name}: duplicate zone ids`);
    for (const zone of layout.zones) {
      for (const n of zone.neighbors) {
        if (!ids.has(n)) {
          errors.push(`${layout.name}: ${zone.id} -> unknown neighbor ${n}`);
          continue;
        }
        const other = layout.zones.find((o) => o.id === n)!;
        if (!other.neighbors.includes(zone.id)) {
          errors.push(`${layout.name}: asymmetric edge ${zone.id} -> ${n}`);
        }
      }
    }
    for (const req of [
      ['isSpawn', 'T'],
      ['isSpawn', 'CT'],
      ['isSite', 'A'],
      ['isSite', 'B'],
    ] as const) {
      const count = layout.zones.filter((zz) => zz[req[0]] === req[1]).length;
      if (count !== 1) errors.push(`${layout.name}: expected exactly one ${req[0]}=${req[1]}, got ${count}`);
    }
    // connectivity (BFS from first zone)
    const seen = new Set<string>([layout.zones[0].id]);
    const q = [layout.zones[0].id];
    while (q.length) {
      const curId = q.shift()!;
      const cur = layout.zones.find((zz) => zz.id === curId)!;
      for (const n of cur.neighbors) {
        if (!seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    if (seen.size !== layout.zones.length) errors.push(`${layout.name}: graph not connected`);
  }
  return errors;
}
