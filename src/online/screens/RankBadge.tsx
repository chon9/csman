// Rank badge chip — shows a team's current competitive tier with the
// CS:GO-style colour ramp. Drops into the sidebar (your own), the
// TeamProfileModal header (any team), and the ranked leaderboard.
// Falls back to a "Placement" pill while placement matches are pending.

import {
  PLACEMENT_MATCHES,
  nextRankProgress,
  rankForMmr,
} from '../protocol';

interface RankBadgeProps {
  mmr: number | undefined;
  placementMatchesPlayed: number | undefined;
  /** Compact = short tag only. Full = tier name + MMR. */
  size?: 'compact' | 'full';
  /** When true, render the progress bar to next tier underneath. */
  showProgress?: boolean;
}

export default function RankBadge({ mmr, placementMatchesPlayed, size = 'compact', showProgress = false }: RankBadgeProps): React.ReactElement {
  const safeMmr = typeof mmr === 'number' ? mmr : 1000;
  const placements = placementMatchesPlayed ?? 0;
  const inPlacement = placements < PLACEMENT_MATCHES;

  if (inPlacement) {
    return (
      <span
        title={`Placement ${placements}/${PLACEMENT_MATCHES} — rank reveals after ${PLACEMENT_MATCHES} PvP duels.`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 999,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.18)',
          color: '#d4d8e1', fontSize: size === 'full' ? 12 : 10, fontWeight: 700,
          letterSpacing: 0.4, whiteSpace: 'nowrap',
        }}
      >
        ⏳ {size === 'full' ? `Placement ${placements}/${PLACEMENT_MATCHES}` : `P ${placements}/${PLACEMENT_MATCHES}`}
      </span>
    );
  }

  const tier = rankForMmr(safeMmr);
  const prog = showProgress ? nextRankProgress(safeMmr) : null;
  return (
    <span
      title={`${tier.name} · MMR ${safeMmr}`}
      style={{
        display: 'inline-flex', flexDirection: 'column', gap: showProgress ? 4 : 0,
        alignItems: 'flex-start', whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: size === 'full' ? '3px 9px' : '2px 7px', borderRadius: 999,
          background: `${tier.color}22`,
          border: `1px solid ${tier.color}80`,
          color: tier.color, fontSize: size === 'full' ? 12 : 10, fontWeight: 800,
          letterSpacing: 0.4,
        }}
      >
        🏅 {size === 'full' ? tier.name : tier.short}
        {size === 'full' && <span style={{ color: '#d4d8e1', fontWeight: 600, marginLeft: 4 }}>· {safeMmr}</span>}
      </span>
      {showProgress && prog && prog.next && (
        <span style={{ position: 'relative', display: 'block', width: '100%', minWidth: 110, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
          <span style={{ position: 'absolute', inset: 0, width: `${prog.pct}%`, background: tier.color }} />
        </span>
      )}
      {showProgress && prog && prog.next && (
        <span className="muted small" style={{ fontSize: 9, color: '#8b93a3' }}>
          {prog.mmrToNext} MMR → {prog.next.short}
        </span>
      )}
    </span>
  );
}
