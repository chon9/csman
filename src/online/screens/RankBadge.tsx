// Rank badge chip — shows a team's current competitive tier with the
// CS:GO-style colour ramp. Drops into the sidebar (your own), the
// TeamProfileModal header (any team), and the ranked leaderboard.
// Falls back to a "Placement" pill while placement matches are pending.

import {
  PLACEMENT_MATCHES,
  nextRankProgress,
  rankForMmr,
} from '../protocol';
import Icon from '../../ui/Icon';

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
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: size === 'full' ? '3px 8px' : '2px 7px',
          borderRadius: 4,
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-dim)',
          fontSize: size === 'full' ? 11 : 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        <Icon name="clock" size={11} />
        {size === 'full' ? `Placement ${placements}/${PLACEMENT_MATCHES}` : `P ${placements}/${PLACEMENT_MATCHES}`}
      </span>
    );
  }

  const tier = rankForMmr(safeMmr);
  const prog = showProgress ? nextRankProgress(safeMmr) : null;
  return (
    <span
      title={`${tier.name} · MMR ${safeMmr}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: showProgress ? 5 : 0,
        alignItems: 'flex-start',
        maxWidth: '100%', minWidth: 0,
      }}
    >
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: size === 'full' ? '3px 8px' : '2px 7px',
          borderRadius: 4,
          background: `${tier.color}15`,
          border: `1px solid ${tier.color}55`,
          color: tier.color,
          fontSize: size === 'full' ? 11 : 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          flexWrap: 'wrap',
          maxWidth: '100%',
          lineHeight: 1.3,
        }}
      >
        <Icon name="shield-check" size={11} />
        <span>{size === 'full' ? tier.name : tier.short}</span>
        {size === 'full' && (
          <span style={{
            color: 'var(--text-dim)', fontWeight: 600,
            letterSpacing: 0, textTransform: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}>· {safeMmr}</span>
        )}
      </span>
      {showProgress && prog && prog.next && (
        <span style={{
          position: 'relative', display: 'block', width: '100%', minWidth: 110,
          height: 3, background: 'var(--border-soft)', borderRadius: 999, overflow: 'hidden',
        }}>
          <span style={{ position: 'absolute', inset: 0, width: `${prog.pct}%`, background: tier.color, borderRadius: 999 }} />
        </span>
      )}
      {showProgress && prog && prog.next && (
        <span
          className="muted small"
          style={{
            fontSize: 9.5, color: 'var(--muted)',
            letterSpacing: '0.04em', textTransform: 'uppercase',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {prog.mmrToNext} to {prog.next.short}
        </span>
      )}
    </span>
  );
}
