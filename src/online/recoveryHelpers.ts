// Tiny client-side helpers that mirror the daily-tick recovery formulas
// from src/sim/daily.ts so the UI can show "X days to rest" without
// needing the server to compute it. Kept in sync with daily.ts:183-192.

import type { Player } from '../types';

/** Per-day fatigue recovery rate. Matches src/sim/daily.ts:183-192. */
export function fatigueRecoveryPerDay(player: Player): number {
  const endurance = player.attributes.endurance ?? 10;
  // Base daily rate (no physio); physio multiplier is a server thing the
  // online mode doesn't expose to clients yet — defaults to 1.0.
  return 1.5 + (endurance / 20) * 4;
}

/** How many days of natural recovery to drop fatigue to ~0. */
export function daysToRest(player: Player): number {
  if (player.fatigue <= 1) return 0;
  return Math.ceil(player.fatigue / Math.max(0.5, fatigueRecoveryPerDay(player)));
}

/** Morale drifts toward 12 asymptotically with a per-day step proportional
 *  to (12 - morale) * 0.015 * resilienceDriftMul. Rough estimate of days to
 *  reach within ±0.5 of neutral. */
export function daysToMoraleNeutral(player: Player): number {
  const target = 12;
  const m = player.morale;
  if (Math.abs(m - target) < 0.5) return 0;
  const resilience = player.attributes.resilience ?? 10;
  const driftMul = 0.5 + (resilience / 20) * 1.0;
  // Solve for n: |12 - m| * (1 - 0.015 * driftMul)^n <= 0.5
  // → n >= log(0.5/|12-m|) / log(1 - 0.015*driftMul)
  const decay = 1 - 0.015 * driftMul;
  if (decay <= 0 || decay >= 1) return 999;
  const n = Math.log(0.5 / Math.abs(target - m)) / Math.log(decay);
  return Math.max(1, Math.ceil(n));
}

/** Plain-language summary used in the player-row tooltip. */
export function fatigueTooltip(player: Player): string {
  const rate = fatigueRecoveryPerDay(player);
  const days = daysToRest(player);
  if (player.fatigue <= 1) return 'Fully rested.';
  return `Recovers ~${rate.toFixed(1)} fatigue/day (endurance ${player.attributes.endurance ?? 10}). About ${days} day${days === 1 ? '' : 's'} of rest to reach 0.`;
}

export function moraleTooltip(player: Player): string {
  const days = daysToMoraleNeutral(player);
  const direction = player.morale < 12 ? 'recovers' : 'drifts down';
  if (days === 0) return 'Morale at neutral (12).';
  return `Morale slowly ${direction} toward 12 — about ${days} day${days === 1 ? '' : 's'} (depends on resilience ${player.attributes.resilience ?? 10}). Wins boost it (+0.8); losses sting (~-0.9).`;
}
