// Round-highlight detection — pure functions over RoundResult that drive the
// transient "drama" overlays in the match viewer. Lifted out of the screen so
// detection logic is easy to test and tweak independently of UI.

import type { Player, RoundResult } from '../../types';

export type HighlightKind = 'ace' | 'multikill' | 'clutch' | 'eco-upset' | 'ninja' | 'pistol';

export interface Highlight {
  /** Stable key — used to dedupe banners when a round is replayed. */
  id: string;
  kind: HighlightKind;
  title: string;
  /** Sub-line shown smaller below the title. */
  sub: string;
  /** Drives banner colour (0..1). 1 = ACE-class moment. */
  intensity: number;
}

const MULTIKILL_LABEL: Record<number, string> = {
  3: 'TRIPLE KILL',
  4: 'QUAD KILL',
  5: 'ACE',
};

/** Build all highlights for a single completed round. Returns ordered list
 *  (most dramatic first) so the UI can stack them right. */
export function detectRoundHighlights(
  round: RoundResult,
  players: Record<string, Player>,
  rosterAIds: Set<string>,
): Highlight[] {
  const out: Highlight[] = [];

  // Multi-kills / ACE — group kills by killer.
  const killsBy = new Map<string, number>();
  for (const k of round.kills) {
    killsBy.set(k.killerId, (killsBy.get(k.killerId) ?? 0) + 1);
  }
  for (const [killerId, n] of killsBy) {
    if (n < 3) continue;
    const p = players[killerId];
    const label = MULTIKILL_LABEL[n] ?? `${n}-KILL`;
    out.push({
      id: `r${round.roundNo}-mk-${killerId}`,
      kind: n >= 5 ? 'ace' : 'multikill',
      title: label,
      sub: `${p?.nickname ?? 'Unknown'} drops ${n} in one round`,
      intensity: n >= 5 ? 1 : n === 4 ? 0.85 : 0.65,
    });
  }

  // Big clutches (1v3+) — already detected by engine.
  if (round.clutch?.won && round.clutch.vs >= 3) {
    const p = players[round.clutch.playerId];
    out.push({
      id: `r${round.roundNo}-clutch-${round.clutch.playerId}`,
      kind: 'clutch',
      title: `1v${round.clutch.vs} CLUTCH`,
      sub: `${p?.nickname ?? 'Unknown'} wins the impossible round`,
      intensity: Math.min(1, 0.7 + round.clutch.vs * 0.08),
    });
  }

  // Ninja defuse — defuse that came down to a lone CT.
  if (round.reason === 'defuse' && round.bombPlanted && round.frames.length > 0) {
    const lastFrame = round.frames[round.frames.length - 1];
    const ctSurvivors = lastFrame.dots.filter((d) => d.side === 'CT' && d.alive).length;
    if (ctSurvivors === 1 && lastFrame.tick >= 60) {
      out.push({
        id: `r${round.roundNo}-ninja`,
        kind: 'ninja',
        title: 'NINJA DEFUSE',
        sub: 'Defused with seconds to spare',
        intensity: 0.9,
      });
    }
  }

  // Eco upset — winner spent eco/half while loser spent full.
  // Determine which team won by counting kills from each roster.
  if (round.kills.length > 0) {
    const aKills = round.kills.filter((k) => rosterAIds.has(k.killerId)).length;
    const bKills = round.kills.length - aKills;
    const aWon = aKills > bKills;
    const winnerBuy = aWon ? round.buyA : round.buyB;
    const loserBuy = aWon ? round.buyB : round.buyA;
    if ((winnerBuy === 'eco' || winnerBuy === 'half') && loserBuy === 'full') {
      out.push({
        id: `r${round.roundNo}-eco`,
        kind: 'eco-upset',
        title: 'ECO UPSET',
        sub: 'Pistols beat rifles — huge round',
        intensity: 0.6,
      });
    }
  }

  // Pistol-round wins — first round of each half.
  if (round.roundNo === 1 || round.roundNo === 13) {
    out.push({
      id: `r${round.roundNo}-pistol`,
      kind: 'pistol',
      title: round.roundNo === 1 ? 'PISTOL WIN' : 'SECOND-HALF PISTOL',
      sub: 'Crucial early-half momentum',
      intensity: 0.5,
    });
  }

  // Sort by intensity desc so the loudest moment shows first.
  out.sort((a, b) => b.intensity - a.intensity);
  return out;
}

/** Round momentum window — last N rounds' winner. +1 = team A win, -1 = team B win. */
export function computeMomentum(rounds: RoundResult[], teamAId: string, window = 5): number {
  if (rounds.length === 0) return 0;
  const slice = rounds.slice(-window);
  let sum = 0;
  for (const r of slice) sum += r.winnerTeamId === teamAId ? 1 : -1;
  return sum / slice.length;
}
