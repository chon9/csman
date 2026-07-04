import type { AttributeKey, Player, ScheduledMatch } from '../types';

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

/**
 * Compact money format for narrow UI cells (sidebar cash pill, hero
 * badges, stat cards) where full six/seven/eight-digit numbers overflow.
 *
 * Under $1M we keep the full form because it's precise and short enough
 * ($999,999 fits everywhere). At $1M+ we shift to K/M/B/T with just
 * enough precision to distinguish neighbours:
 *   - one decimal below 10 in a bucket (1.2M, 3.4B)
 *   - integer at 10+ in a bucket (12M, 340B)
 *
 * Callers should still put the exact number in a `title` attribute so
 * hover reveals the precise amount.
 */
export function moneyCompact(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  if (abs < 1_000_000) return `${sign}$${abs.toLocaleString('en-US')}`;
  const pick = (v: number, suf: string): string => {
    const rounded = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
    return `${sign}$${rounded}${suf}`;
  };
  if (abs < 1_000_000_000) return pick(abs / 1_000_000, 'M');
  if (abs < 1_000_000_000_000) return pick(abs / 1_000_000_000, 'B');
  return pick(abs / 1_000_000_000_000, 'T');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtShortDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function attrClass(v: number): string {
  if (v >= 18) return 'attr-5';
  if (v >= 15) return 'attr-4';
  if (v >= 11) return 'attr-3';
  if (v >= 6) return 'attr-2';
  return 'attr-1';
}

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic fuzzy range for unscouted attributes, e.g. "12-16". */
export function attrRange(playerId: string, key: string, v: number): string {
  const shift = (hashStr(playerId + key) % 5) - 2;
  const c = Math.max(3, Math.min(18, v + shift));
  return `${Math.max(1, c - 2)}-${Math.min(20, c + 2)}`;
}

export function kdRatio(p: Player): string {
  if (p.stats.deaths > 0) return (p.stats.kills / p.stats.deaths).toFixed(2);
  return p.stats.kills > 0 ? p.stats.kills.toFixed(2) : '-';
}

/** Whole days remaining between today (game date) and a target ISO date. */
export function daysUntil(todayIso: string, targetIso: string): number {
  const a = new Date(todayIso + 'T00:00:00Z').getTime();
  const b = new Date(targetIso + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function opponentId(m: ScheduledMatch, teamId: string): string {
  return m.teamAId === teamId ? m.teamBId : m.teamAId;
}

export function resultFor(m: ScheduledMatch, teamId: string): { text: string; win: boolean } | null {
  if (!m.result) return null;
  const mine = m.teamAId === teamId ? m.result.mapsA : m.result.mapsB;
  const theirs = m.teamAId === teamId ? m.result.mapsB : m.result.mapsA;
  return { text: `${mine}-${theirs}`, win: m.result.winnerId === teamId };
}

export const ATTR_SHORT: Record<AttributeKey, string> = {
  aim: 'AIM',
  reflexes: 'REF',
  positioning: 'POS',
  utility: 'UTL',
  clutch: 'CLU',
  gameSense: 'GS',
  communication: 'COM',
  leadership: 'LDR',
  consistency: 'CON',
  composure: 'CMP',
  resilience: 'RES',
  discipline: 'DSC',
  aggression: 'AGG',
  teamwork: 'TW',
  loyalty: 'LOY',
  endurance: 'END',
};

export const ATTR_LABEL: Record<AttributeKey, string> = {
  aim: 'Aim',
  reflexes: 'Reflexes',
  positioning: 'Positioning',
  utility: 'Utility',
  clutch: 'Clutch',
  gameSense: 'Game Sense',
  communication: 'Communication',
  leadership: 'Leadership',
  consistency: 'Consistency',
  composure: 'Composure',
  resilience: 'Resilience',
  discipline: 'Discipline',
  aggression: 'Aggression',
  teamwork: 'Teamwork',
  loyalty: 'Loyalty',
  endurance: 'Endurance',
};
