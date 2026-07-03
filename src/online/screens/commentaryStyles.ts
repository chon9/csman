// Shared commentary classifier + style table. Used by both the replay
// screen (in-flight overlay) and the Live Feed's read-only Commentary
// modal so the same colour language applies everywhere.

/** Commentary category — determines the visual style applied when rendered.
 *  Order = display priority (first match wins). */
export type CommentaryCat = 'analyst' | 'epic' | 'bomb' | 'tactic-shift' | 'freeze' | 'normal';

/** Classify a commentary line by pattern-matching. Keeps the engine's
 *  emitted strings as-is (no marker prefixes) — pattern rules live here
 *  and are the ONLY place to update if engine phrasing changes. */
export function classifyCommentary(text: string): CommentaryCat {
  if (text.startsWith('[Analyst]')) return 'analyst';
  if (text.startsWith('🏆') || text.startsWith('🔥') || text.includes('WINS the 1v')) return 'epic';
  if (text.startsWith('💥') || text.includes('bomb down')) return 'bomb';
  if (text.includes("It's a FAKE") || text.includes('Mid-round call') || text.includes('Second wave')) return 'tactic-shift';
  if (text.startsWith('[Freeze]')) return 'freeze';
  return 'normal';
}

export interface CommentaryStyle {
  color: string;
  weight: number;
  stripe?: string;
  background?: string;
}

/** Per-category visual style. Kept as data (not classes) so both callers
 *  stay self-contained. */
export const COMMENTARY_STYLE: Record<CommentaryCat, CommentaryStyle> = {
  analyst:       { color: '#f2c443', weight: 700, stripe: '#d9b344', background: 'rgba(217,179,68,0.10)' },
  epic:          { color: '#ff8a5c', weight: 700, stripe: '#ff8a5c', background: 'rgba(255,138,92,0.10)' },
  bomb:          { color: '#ffd700', weight: 700 },
  'tactic-shift':{ color: '#6ed8ff', weight: 600, stripe: '#5aa4e6' },
  freeze:        { color: '#8a93a3', weight: 400 },
  normal:        { color: '#d4d8e1', weight: 400 },
};
