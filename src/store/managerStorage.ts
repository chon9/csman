// Cross-career persistent manager identity. Lives outside save slots — when
// the user starts a second career with the same manager name, this carries
// reputation, attributes, career history, and achievements across.

import type { ManagerAttributes, ManagerProfile, ManagerStyle } from '../types';

const STORE_PREFIX = 'cs2manager-manager-';

function slugifyManagerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'manager';
}

/** Starting attribute distribution per style. Total budget = 50 across 4 attrs. */
const STYLE_STARTING_ATTRS: Record<ManagerStyle, ManagerAttributes> = {
  tactician:        { motivating: 10, youngsters: 10, press: 13, judgingTalent: 17 },
  motivator:        { motivating: 17, youngsters: 13, press: 12, judgingTalent: 8 },
  'youth-specialist': { motivating: 11, youngsters: 17, press: 9, judgingTalent: 13 },
  'all-rounder':    { motivating: 12, youngsters: 13, press: 12, judgingTalent: 13 },
};

export function startingAttrsFor(style: ManagerStyle): ManagerAttributes {
  return { ...STYLE_STARTING_ATTRS[style] };
}

function key(id: string): string { return `${STORE_PREFIX}${id}`; }

/** Load a manager profile by name (or stable id). Returns null if not found. */
export function loadManagerByName(name: string): ManagerProfile | null {
  const id = slugifyManagerName(name);
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    return JSON.parse(raw) as ManagerProfile;
  } catch { return null; }
}

/** Persist a manager profile (overwrites by id). */
export function saveManager(m: ManagerProfile): void {
  try { localStorage.setItem(key(m.id), JSON.stringify(m)); } catch { /* ignore */ }
}

/** Create a fresh manager profile (or return the existing one for this name). */
export function getOrCreateManager(
  name: string,
  nationality: string,
  style: ManagerStyle,
): ManagerProfile {
  const existing = loadManagerByName(name);
  if (existing) return existing;
  const id = slugifyManagerName(name);
  const initials =
    name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || 'MG';
  const profile: ManagerProfile = {
    id,
    name,
    nationality: nationality || 'XX',
    initials,
    style,
    attributes: startingAttrsFor(style),
    reputation: 30,
    career: [],
    trophiesTotal: 0,
    achievements: [],
  };
  saveManager(profile);
  return profile;
}

/** List all known manager profiles (for a future profile picker). */
export function listManagers(): ManagerProfile[] {
  const out: ManagerProfile[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(STORE_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(k);
      if (raw) out.push(JSON.parse(raw) as ManagerProfile);
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.reputation - a.reputation);
}

const REPUTATION_TIERS: { min: number; label: string }[] = [
  { min: 85, label: 'Legend' },
  { min: 70, label: 'Elite' },
  { min: 55, label: 'Established' },
  { min: 40, label: 'Rising' },
  { min: 20, label: 'Up-and-coming' },
  { min: 0, label: 'Unknown' },
];

export function reputationLabel(rep: number): string {
  return REPUTATION_TIERS.find((t) => rep >= t.min)?.label ?? 'Unknown';
}
