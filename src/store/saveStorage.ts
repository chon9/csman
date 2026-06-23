// Multi-slot save storage layer. Each slot lives under its own localStorage key
// (cs2manager-save-{id}) plus a single index keyed at cs2manager-saves-index
// describing all known slots. The legacy single-slot key (cs2manager-save) is
// auto-migrated into a "default" slot on first access.

import type { GameState } from '../types';

const LEGACY_KEY = 'cs2manager-save';
const SLOT_KEY_PREFIX = 'cs2manager-save-';
const INDEX_KEY = 'cs2manager-saves-index';
const ACTIVE_SLOT_KEY = 'cs2manager-active-slot';

export interface SaveSlotMeta {
  id: string;
  name: string;
  /** ISO timestamp of last write. */
  lastModified: string;
  /** Display info pulled from the GameState at save time. */
  teamName: string;
  teamTag: string;
  currentDate: string;
  seasonYear: number;
  worldRanking: number;
  budget: number;
  matchesPlayed: number;
  bytes: number;
}

interface SavesIndex {
  slots: Record<string, SaveSlotMeta>;
}

function readIndex(): SavesIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return { slots: {} };
    const parsed = JSON.parse(raw) as SavesIndex;
    if (!parsed || typeof parsed !== 'object' || !parsed.slots) return { slots: {} };
    return parsed;
  } catch {
    return { slots: {} };
  }
}

function writeIndex(index: SavesIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch { /* ignore */ }
}

function slotKey(id: string): string {
  return `${SLOT_KEY_PREFIX}${id}`;
}

/** Slugify a save name into a usable slot id. */
export function makeSlotId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'save';
  // Append short suffix if collision
  const existing = readIndex().slots;
  if (!existing[base]) return base;
  let n = 2;
  while (existing[`${base}-${n}`]) n++;
  return `${base}-${n}`;
}

function metaFromGame(id: string, name: string, game: GameState, bytes: number): SaveSlotMeta {
  const team = game.teams[game.userTeamId];
  return {
    id,
    name,
    lastModified: new Date().toISOString(),
    teamName: team?.name ?? '—',
    teamTag: team?.tag ?? '?',
    currentDate: game.currentDate,
    seasonYear: game.seasonYear,
    worldRanking: team?.worldRanking ?? 99,
    budget: team?.budget ?? 0,
    matchesPlayed: game.matchHistory?.length ?? 0,
    bytes,
  };
}

/** Migrate the legacy single-key save into a "default" slot the first time we boot. */
function migrateLegacy(): void {
  const index = readIndex();
  if (Object.keys(index.slots).length > 0) return; // already migrated or fresh install
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const game = JSON.parse(raw) as GameState;
    const id = 'legacy';
    const name = game.saveName || 'My Career';
    localStorage.setItem(slotKey(id), raw);
    const meta = metaFromGame(id, name, game, raw.length);
    writeIndex({ slots: { [id]: meta } });
    localStorage.setItem(ACTIVE_SLOT_KEY, id);
    // Don't remove the legacy key yet — keeps the door open if something blows up.
  } catch {
    // Garbage legacy data — skip.
  }
}

/** List all slots, most-recent first. */
export function listSlots(): SaveSlotMeta[] {
  migrateLegacy();
  const index = readIndex();
  return Object.values(index.slots).sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

/** Get the currently-active slot id, if any. */
export function getActiveSlotId(): string | null {
  return localStorage.getItem(ACTIVE_SLOT_KEY);
}

export function setActiveSlotId(id: string | null): void {
  if (id === null) localStorage.removeItem(ACTIVE_SLOT_KEY);
  else localStorage.setItem(ACTIVE_SLOT_KEY, id);
}

/** Most-recently-modified slot id, or null if no slots. */
export function mostRecentSlotId(): string | null {
  const slots = listSlots();
  return slots[0]?.id ?? null;
}

/** Read a slot's GameState by id. */
export function readSlot(id: string): GameState | null {
  const raw = localStorage.getItem(slotKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

/** Write a slot's GameState. Returns false on quota error. */
export function writeSlot(id: string, name: string, game: GameState): boolean {
  let payload: string;
  try {
    payload = JSON.stringify(game);
  } catch {
    return false;
  }
  try {
    localStorage.setItem(slotKey(id), payload);
  } catch {
    // Try slim: drop most match history frames
    const slim: GameState = { ...game, matchHistory: game.matchHistory.slice(-40) };
    try {
      payload = JSON.stringify(slim);
      localStorage.setItem(slotKey(id), payload);
    } catch {
      return false;
    }
  }
  const index = readIndex();
  index.slots[id] = metaFromGame(id, name, game, payload.length);
  writeIndex(index);
  return true;
}

/** Delete a slot + its index entry. Clears active-slot if it was this one. */
export function deleteSlot(id: string): void {
  try { localStorage.removeItem(slotKey(id)); } catch { /* ignore */ }
  const index = readIndex();
  delete index.slots[id];
  writeIndex(index);
  if (getActiveSlotId() === id) setActiveSlotId(null);
}

/** Rename a slot's display name (id stays stable). */
export function renameSlot(id: string, newName: string): void {
  const index = readIndex();
  if (!index.slots[id]) return;
  index.slots[id] = { ...index.slots[id], name: newName, lastModified: new Date().toISOString() };
  writeIndex(index);
}

/** Read a slot's raw JSON for export-to-file. */
export function readSlotRaw(id: string): string | null {
  return localStorage.getItem(slotKey(id));
}

/** Import a raw JSON blob into a new slot. */
export function importSlotRaw(name: string, raw: string): { ok: boolean; id?: string; error?: string } {
  let game: GameState;
  try {
    game = JSON.parse(raw) as GameState;
  } catch (e) {
    return { ok: false, error: `Invalid save JSON: ${(e as Error).message}` };
  }
  if (!game || typeof game !== 'object' || !game.teams || !game.userTeamId) {
    return { ok: false, error: 'Save file missing required fields (teams / userTeamId).' };
  }
  const id = makeSlotId(name);
  const ok = writeSlot(id, name, game);
  return ok ? { ok: true, id } : { ok: false, error: 'Failed to write slot (storage quota?).' };
}

export function hasAnySave(): boolean {
  migrateLegacy();
  return Object.keys(readIndex().slots).length > 0;
}
