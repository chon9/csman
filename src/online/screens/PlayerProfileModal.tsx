// Click-to-view player profile. Looks up the player in priority order:
//   1. Your own roster (players store) — full attribute sheet + contract.
//   2. Currently-viewing team profile's roster — scrubbed public view.
// Renders an attribute breakdown alongside a "how this matters" panel
// that maps each attribute to its contribution in the engine's
// effectiveSkill formula, plus the role's match-engine effect (IGL
// boosts morale, AWPer covers long range, etc.).

import { useMemo } from 'react';
import { useOnline } from '../onlineStore';
import type { Player, PlayerAttributes } from '../../types';
import { findTrait, type PublicPlayer } from '../protocol';
import { TeamTag } from './TeamProfileModal';

/** Clickable player nickname — drops into any roster/scoreboard cell. */
export function PlayerName({ playerId, label, color }: { playerId: string; label: string; color?: string }): React.ReactElement {
  const view = useOnline((s) => s.viewPlayer);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); view(playerId); }}
      title={`View ${label} profile`}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        margin: 0,
        font: 'inherit',
        float: 'none',
        display: 'inline',
        cursor: 'pointer',
        color: color ?? '#e8eaf0',
        fontWeight: 700,
        textDecoration: 'underline dotted rgba(255,255,255,0.20)',
        textUnderlineOffset: 3,
      }}
    >
      {label}
    </button>
  );
}

/** Per-attribute weight in the engine's effectiveSkill formula. Mirrors
 *  matchEngine.ts:128 — keep them in sync. */
const ATTR_WEIGHT: Partial<Record<keyof PlayerAttributes, number>> = {
  aim: 0.28,
  reflexes: 0.20,
  positioning: 0.17,
  gameSense: 0.15,
  consistency: 0.10,
  composure: 0.10,
};

/** Short blurb explaining what each attribute does in the match engine. */
const ATTR_BLURB: Partial<Record<keyof PlayerAttributes, string>> = {
  aim:           'Direct crosshair contribution — 28% of effective skill. Single biggest stat.',
  reflexes:      'First-shot speed + duel-trade reactions. 20% of effective skill.',
  positioning:   'Holds angles, picks rotations. 17% of effective skill.',
  gameSense:     'Reads opponents, sets up IGL mid-round calls. 15% of effective skill.',
  consistency:   'Narrows the "on-the-day" variance band. 10% of effective skill.',
  composure:     'Choke resistance under tournament pressure. 10% of effective skill + buffers chokeRisk.',
  clutch:        '1vX bonus + composure stacker. Decides retake situations.',
  utility:       'Grenade damage + setup quality (mostly Support role).',
  leadership:    'IGL effectiveness — pairs with gameSense for mid-round flex.',
  teamwork:      'Squad-cohesion contribution (chemistry).',
  discipline:    'Reduces tilt loss from bad rounds.',
  resilience:    'Bounce-back from lost rounds; pairs with composure vs pressure.',
  endurance:     'Slower fatigue accumulation across long maps + BO3s.',
  communication: 'Trade timing + info-share quality (multiplies leadership).',
  aggression:    'Style modifier — entry frags vs careful holds. Pairs with role.',
  loyalty:       'Resists rival transfer offers + tougher in contract demands.',
};

/** Role-impact one-liners — what this role brings to the team-level synergy. */
const ROLE_IMPACT: Record<string, string> = {
  IGL:     'In-Game Leader — your team gets +4% effective skill when EXACTLY 1 IGL is fielded. 0 IGL = −6% (no caller, lower morale + plan quality). 2+ = calling friction (−3%).',
  AWPer:   'Long-range threat — 1 AWPer = +3%. None = −4% (no scope pressure). 2+ AWPers = −5% (economy strain, only one can buy each round).',
  Entry:   'Site-opener — at least 1 = +2% (faster takes). None = −3% (slow, readable executes).',
  Support: 'Utility setups — at least 1 = +2%. Grenade damage + flash quality flows through here.',
  Lurker:  'Rotational pressure — 1 = +2%, 2+ = −4% (nobody on site at execute time).',
  Rifler:  'Flexible fifth — fills gaps without specialising. No specific synergy bonus or penalty.',
  Anchor:  'Site holder — bonus baked into positioning, not the synergy multiplier.',
};

export default function PlayerProfileModal(): React.ReactElement | null {
  const playerId = useOnline((s) => s.viewingPlayerId);
  const players = useOnline((s) => s.players);
  const enemyProfile = useOnline((s) => s.viewingTeamProfile);
  const dismiss = useOnline((s) => s.dismissPlayer);

  // Resolve the player record from any available source.
  const own = playerId ? players[playerId] : null;
  const enemyMatch = useMemo(() => {
    if (!playerId || !enemyProfile) return null;
    return [...enemyProfile.starters, ...enemyProfile.reserves].find((p) => p.id === playerId) ?? null;
  }, [playerId, enemyProfile]);

  if (!playerId) return null;
  const isOwn = !!own;
  const player = (own ?? enemyMatch) as Player | PublicPlayer | null;
  if (!player) {
    return (
      <div className="modal-backdrop" onClick={dismiss}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, padding: 18 }}>
          <div className="modal-head" style={{ marginBottom: 8 }}>
            <h3>Player not found</h3>
            <button className="link-btn" onClick={dismiss}>close ✕</button>
          </div>
          <div className="muted small">This player isn't in your local cache. Refresh the roster or team profile and try again.</div>
        </div>
      </div>
    );
  }

  const ownPlayer = isOwn ? (player as Player) : null;
  const roleImpact = ROLE_IMPACT[player.role] ?? '';

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, padding: 18 }}>
        <div className="modal-head" style={{ marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              <span style={{ color: '#de9b35' }}>{player.nickname}</span>
              <span style={{ marginLeft: 8, fontWeight: 500, color: '#d4d8e1' }}>{player.firstName} {player.lastName}</span>
            </h3>
            <div className="muted small" style={{ marginTop: 2 }}>
              {player.role} · {player.nationality} · age {Number(player.age).toFixed(0)}
              {ownPlayer?.teamId && enemyProfile && enemyProfile.id !== ownPlayer.teamId && (
                <> · on <TeamTag teamId={ownPlayer.teamId} tag={'team'} /></>
              )}
              {!isOwn && <> · public profile (limited info)</>}
            </div>
          </div>
          <button className="link-btn" onClick={dismiss}>close ✕</button>
        </div>

        {/* ===== Headline stats ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 8, marginBottom: 14 }}>
          <ProfileStat label="CA" value={String(player.currentAbility)} color="#9be29b" big />
          <ProfileStat label="PA" value={String(player.potentialAbility)} color="#f2c443" />
          {ownPlayer && <ProfileStat label="Form" value={ownPlayer.form.toFixed(1)} color={ownPlayer.form >= 12 ? '#6ed09a' : ownPlayer.form <= 7 ? '#e25555' : '#d4d8e1'} />}
          {ownPlayer && <ProfileStat label="Morale" value={ownPlayer.morale.toFixed(1)} color={ownPlayer.morale >= 12 ? '#6ed09a' : ownPlayer.morale <= 7 ? '#e25555' : '#d4d8e1'} />}
          {ownPlayer && <ProfileStat label="Fatigue" value={`${Math.round(ownPlayer.fatigue)}%`} color={ownPlayer.fatigue >= 60 ? '#e25555' : ownPlayer.fatigue >= 35 ? '#f2c443' : '#6ed09a'} />}
          {ownPlayer?.contract && (
            <ProfileStat label="Contract" value={`${ownPlayer.contract.duelsRemaining ?? '∞'}d left`} color={typeof ownPlayer.contract.duelsRemaining === 'number' && ownPlayer.contract.duelsRemaining <= 5 ? '#e25555' : '#d4d8e1'} />
          )}
        </div>

        {/* ===== Traits — engine modifiers ===== */}
        {ownPlayer?.traits && ownPlayer.traits.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ownPlayer.traits.map((id) => {
              const trait = findTrait(id);
              if (!trait) return null;
              const positive = trait.tone === 'positive';
              const pillColor = positive ? '#6ed09a' : '#e25555';
              return (
                <span
                  key={id}
                  title={trait.description}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 999,
                    background: positive ? 'rgba(110,208,154,0.12)' : 'rgba(226,85,85,0.10)',
                    border: `1px solid ${positive ? 'rgba(110,208,154,0.45)' : 'rgba(226,85,85,0.45)'}`,
                    color: pillColor, fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{trait.icon}</span>
                  {trait.label}
                  <span style={{ opacity: 0.7, fontWeight: 600, fontSize: 11 }}>
                    {positive ? '+' : ''}{Math.round((trait.mult - 1) * 100)}%
                  </span>
                </span>
              );
            })}
          </div>
        )}

        {/* ===== Role impact ===== */}
        {roleImpact && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: 'linear-gradient(135deg, rgba(75,105,255,0.08), rgba(110,208,154,0.06))',
              border: '1px solid rgba(109,229,255,0.20)',
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 11, color: '#9fb4e4', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              Role impact — {player.role}
            </div>
            <div className="muted small" style={{ marginTop: 4, color: '#d4d8e1' }}>{roleImpact}</div>
          </div>
        )}

        {/* ===== Attribute bars + formula explanation ===== */}
        {ownPlayer && (
          <div className="panel" style={{ padding: 12 }}>
            <div className="panel-title">Attributes — how they shape match output</div>
            <div className="muted small" style={{ marginBottom: 8 }}>
              Effective skill = weighted attributes × form × morale × (1 − fatigue) × map comfort × coach × role synergy × choke risk × on-the-day variance.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(Object.keys(ATTR_BLURB) as (keyof PlayerAttributes)[]).map((k) => {
                const val = ownPlayer.attributes[k] ?? 0;
                const weight = ATTR_WEIGHT[k];
                return (
                  <AttrRow
                    key={k}
                    label={k}
                    value={val}
                    weightPct={weight ? Math.round(weight * 100) : null}
                    blurb={ATTR_BLURB[k] ?? ''}
                  />
                );
              })}
            </div>
          </div>
        )}

        {!ownPlayer && (
          <div className="muted small" style={{ padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
            Full attribute sheet is hidden for enemy players — scouting only reveals CA, PA, role, and basic info.
          </div>
        )}
      </div>
    </div>
  );
}

function AttrRow({ label, value, weightPct, blurb }: { label: string; value: number; weightPct: number | null; blurb: string }): React.ReactElement {
  const pct = Math.max(0, Math.min(20, value)) / 20 * 100;
  const color = value >= 16 ? '#6ed09a' : value >= 12 ? '#9be29b' : value >= 8 ? '#f2c443' : '#e25555';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 60px 1fr', gap: 8, alignItems: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#d4d8e1', textTransform: 'capitalize' }}>
        {label}
        {weightPct !== null && <span className="muted small" style={{ marginLeft: 4 }}>({weightPct}%)</span>}
      </div>
      <div style={{ position: 'relative', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: color, transition: 'width 200ms' }} />
      </div>
      <div className="muted small" style={{ fontSize: 11 }}>
        <strong style={{ color }}>{value}</strong>/20 · {blurb}
      </div>
    </div>
  );
}

function ProfileStat({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }): React.ReactElement {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
      <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: big ? 20 : 15, fontWeight: 700, color: color ?? '#e8eaf0' }}>{value}</div>
    </div>
  );
}
