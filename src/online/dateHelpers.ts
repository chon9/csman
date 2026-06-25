// Tiny display helpers shared by the home screen + sidebar.

/**
 * Format a team's in-game age (days since creation) using the largest
 * meaningful unit. Once a team is more than a month old, displaying
 * "day 143" stops feeling intuitive — "4mo 23d" reads better.
 *
 *  0-29   → "day N"
 *  30-364 → "Xmo" or "Xmo Yd" if days remain
 *  365+   → "X.Yy" (years to 1 decimal)
 */
export function formatGameAge(day: number): string {
  if (!Number.isFinite(day) || day < 0) return 'day 0';
  if (day < 30) return `day ${day}`;
  if (day < 365) {
    const months = Math.floor(day / 30);
    const rem = day - months * 30;
    return rem > 0 ? `${months}mo ${rem}d` : `${months}mo`;
  }
  const years = day / 365;
  // 1.0y, 1.3y, 2.0y, etc. — drop the decimal when it's a clean integer.
  const rounded = Math.round(years * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}y` : `${rounded.toFixed(1)}y`;
}
