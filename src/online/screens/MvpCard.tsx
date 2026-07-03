// MVP card — the celebration frame that closes a match. Renders the
// top-rated player from the winning side (server-computed so opponent
// MVPs work too) with their name, role, K/D/A/rating, and the weapon
// skins they had equipped when the match kicked off.
//
// Used by both the replay end-overlay and the DuelResultModal so both
// touchpoints share the same look.

import type { DuelOutcome, SkinInstanceWire } from '../protocol';

type MvpData = NonNullable<DuelOutcome['mvp']>;

const RARITY_COLOR: Record<string, string> = {
  'mil-spec': '#4b69ff',
  'restricted': '#8847ff',
  'classified': '#d32ce6',
  'covert': '#eb4b4b',
  'rare-special': '#ffd700',
};

export default function MvpCard({
  mvp, compact,
}: { mvp: MvpData; compact?: boolean }): React.ReactElement {
  const accent = mvp.isOwn ? '#d9b344' : '#8b93a3';
  const tone = mvp.isOwn ? 'Your MVP' : 'Their MVP';
  const bg = mvp.isOwn
    ? 'linear-gradient(135deg, rgba(217,179,68,0.14), rgba(217,179,68,0.05) 60%, transparent)'
    : 'linear-gradient(135deg, rgba(139,147,163,0.14), rgba(139,147,163,0.05) 60%, transparent)';
  return (
    <div style={{
      background: bg,
      border: `1px solid ${accent}55`,
      borderRadius: 10,
      padding: compact ? 12 : 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, color: accent }}>
            🏆 {tone}
          </div>
          <div style={{ fontSize: compact ? 20 : 26, fontWeight: 800, letterSpacing: 0.5, marginTop: 2 }}>
            {mvp.nickname}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>
            {mvp.role} · {mvp.teamTag}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          <div style={{ fontSize: compact ? 24 : 32, fontWeight: 800, color: accent, letterSpacing: 1 }}>
            {mvp.avgRating.toFixed(2)}
          </div>
          <div className="muted small" style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
            HLTV Rating
          </div>
        </div>
      </div>

      {/* K/D/A pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <MvpStat label="K" value={mvp.kills} color="#6ed09a" />
        <MvpStat label="D" value={mvp.deaths} color="#e25555" />
        <MvpStat label="A" value={mvp.assists} color="#d4d8e1" />
        <MvpStat label="K/D" value={(mvp.kills / Math.max(1, mvp.deaths)).toFixed(2)} color={mvp.kills >= mvp.deaths ? '#6ed09a' : '#e25555'} />
      </div>

      {/* Equipped skins */}
      {mvp.equippedSkins.length > 0 ? (
        <div>
          <div className="muted small" style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
            🔫 Loadout
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? 140 : 180}px, 1fr))`, gap: 6 }}>
            {mvp.equippedSkins.map((s) => (
              <SkinChip key={s.id} skin={s} compact={compact} />
            ))}
          </div>
        </div>
      ) : (
        <div className="muted small" style={{ fontStyle: 'italic', fontSize: 11 }}>
          No skins equipped — showcase your inventory next time.
        </div>
      )}
    </div>
  );
}

function MvpStat({ label, value, color }: { label: string; value: number | string; color: string }): React.ReactElement {
  return (
    <div style={{
      padding: '4px 10px', borderRadius: 999,
      background: 'rgba(0,0,0,0.25)',
      border: '1px solid rgba(255,255,255,0.08)',
      fontSize: 12,
    }}>
      <span className="muted" style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</span>
      <strong style={{ color, marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </div>
  );
}

function SkinChip({ skin, compact }: { skin: SkinInstanceWire; compact?: boolean }): React.ReactElement {
  const rarityColor = RARITY_COLOR[skin.rarity] ?? '#8b93a3';
  return (
    <div style={{
      padding: compact ? '6px 8px' : '8px 10px',
      borderRadius: 6,
      background: `linear-gradient(135deg, ${rarityColor}22, transparent)`,
      borderLeft: `3px solid ${rarityColor}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {skin.weapon}
      </div>
      <div className="muted small" style={{ fontSize: 10 }}>{skin.name}</div>
      {skin.nametag && (
        <div style={{ fontSize: 10, color: '#d9b344', fontStyle: 'italic', marginTop: 2 }}>🏷 "{skin.nametag}"</div>
      )}
      <div className="muted small" style={{ fontSize: 9 }}>
        {skin.wear}{skin.statTrak ? ' · StatTrak™' : ''}
      </div>
    </div>
  );
}
