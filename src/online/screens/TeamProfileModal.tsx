// Click-to-view team profile modal. Legacy in-app modal still exists
// (fetchTeamProfile path) for AI-bet flows and similar, but TeamTag now
// opens the public Facebook-style /team/:id page in a new tab so
// commenters land on the canonical shareable URL.

import { useOnline } from '../onlineStore';
import type { PublicPlayer, PublicTeamProfile } from '../protocol';
import { PlayerName } from './PlayerProfileModal';
import { publicOrigin } from '../serverUrl';
import RankBadge from './RankBadge';
import { CT_ARCHETYPE_LABEL, T_ARCHETYPE_LABEL } from '../../engine/tacticalMatchup';

/** Clickable team-tag chip — every team tag anywhere in the app links
 *  to the public Facebook-style profile page in a new tab. Renders the
 *  tag in the team's accent if available, else the global accent. */
export function TeamTag({ teamId, tag, accent }: { teamId: string; tag: string; accent?: string }): React.ReactElement {
  // Pre-fill the profile-page comment form with the viewer's team tag when
  // logged in. The public HTML page reads `?as=` and auto-fills the field.
  const myTeam = useOnline((s) => s.team);
  const asParam = myTeam?.tag ? `?as=${encodeURIComponent(myTeam.tag)}` : '';
  const href = `${publicOrigin()}/team/${encodeURIComponent(teamId)}${asParam}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`View ${tag} public profile (new tab)`}
      style={{
        // No className — global .link-btn floats right, which breaks
        // inline layout (notably the live-feed "TSF 1-0 JULY" line).
        background: 'transparent',
        border: 'none',
        padding: 0,
        margin: 0,
        font: 'inherit',
        float: 'none',
        display: 'inline',
        cursor: 'pointer',
        color: accent ?? 'var(--accent)',
        fontWeight: 700,
        textDecoration: 'underline dotted rgba(255,255,255,0.25)',
        textUnderlineOffset: 3,
      }}
    >
      {tag}
    </a>
  );
}

export default function TeamProfileModal(): React.ReactElement | null {
  const profile = useOnline((s) => s.viewingTeamProfile);
  const dismiss = useOnline((s) => s.dismissTeamProfile);
  if (!profile) return null;
  const accent = profile.primaryColor || '#de9b35';
  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, padding: 18 }}>
        <div className="modal-head" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 56, height: 56, borderRadius: 10, background: `linear-gradient(135deg, ${accent}, ${accent}88)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: profile.logoId ? 32 : 22, color: '#0a0d12', boxShadow: `0 0 18px ${accent}55`,
                }}
              >{profile.logoId || profile.tag.slice(0, 2).toUpperCase()}</div>
              <div>
                <h3 style={{ margin: 0 }}>
                  <span style={{ color: accent }}>{profile.tag}</span>
                  <span style={{ marginLeft: 8, fontWeight: 500, color: '#d4d8e1' }}>{profile.name}</span>
                </h3>
                <div className="muted small">
                  {profile.region} · owned by <strong>{profile.ownerNick}</strong> · {profile.ageInDays}d old
                </div>
                <div style={{ marginTop: 6 }}>
                  <RankBadge mmr={profile.mmr} placementMatchesPlayed={undefined} size="full" />
                  {typeof profile.peakMmr === 'number' && typeof profile.mmr === 'number' && profile.peakMmr > profile.mmr && (
                    <span className="muted small" style={{ marginLeft: 8 }}>peak {profile.peakMmr}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <button className="link-btn" onClick={dismiss}>close ✕</button>
        </div>

        {profile.bio && (
          <div className="muted small" style={{ padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 12, fontStyle: 'italic' }}>
            "{profile.bio}"
          </div>
        )}

        {/* ===== Headline stats ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 8, marginBottom: 14 }}>
          <ProfileStat label="Fans" value={profile.fans.toLocaleString()} color={accent} big />
          <ProfileStat label="Starter CA" value={String(profile.totalStarterCA)} color="#6ed09a" />
          <ProfileStat label="Season W/L" value={`${profile.seasonWins}/${profile.seasonLosses}`} />
          <ProfileStat label="PvP W/L" value={`${profile.pvpWins}/${profile.pvpLosses}`} color="#f2c443" />
          <ProfileStat label="Trophies" value={String(profile.achievementsUnlocked)} color="#ffd700" />
          <ProfileStat label="Roster" value={String(profile.starters.length + profile.reserves.length)} />
        </div>

        {/* ===== Tactics snapshot ===== */}
        {profile.tactics && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: '10px 12px', marginBottom: 12,
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderLeft: '3px solid #5aa4e6',
            borderRadius: 'var(--radius-sm)', fontSize: 12,
          }}>
            <div className="muted" style={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: 10, fontWeight: 700 }}>
              📋 Tactics
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="pill" title="T-side playstyle">T · {profile.tactics.tPlaystyle}</span>
              <span className="pill" title="CT-side playstyle">CT · {profile.tactics.ctPlaystyle}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, marginTop: 4 }}>
              <TacticsSlider label="Aggression" value={profile.tactics.aggression} />
              <TacticsSlider label="Utility usage" value={profile.tactics.utilityUsage} />
              <TacticsSlider label="Mid-round adapt" value={profile.tactics.midRoundFlexibility} />
              <TacticsSlider label="Eco discipline" value={profile.tactics.ecoDiscipline} />
              <TacticsSlider label="Force-buy" value={profile.tactics.forceBuyTendency} />
            </div>
          </div>
        )}

        {/* ===== Tactical tendency (scouting hook) ===== */}
        {profile.tendency && (
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 12px', marginBottom: 12,
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderLeft: '3px solid var(--accent)',
            borderRadius: 'var(--radius-sm)', fontSize: 12,
          }}>
            <span className="muted" style={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: 10, fontWeight: 700 }}>
              🎯 Tactical tendency
            </span>
            <span className="pill" style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent-hi)' }}>
              T · {T_ARCHETYPE_LABEL[profile.tendency.t]}
            </span>
            <span className="pill" style={{ background: 'var(--accent-soft)', borderColor: 'var(--border-accent)', color: 'var(--accent-hi)' }}>
              CT · {CT_ARCHETYPE_LABEL[profile.tendency.ct]}
            </span>
            <span className="muted small" style={{ marginLeft: 'auto' }}>
              {profile.tendency.source === 'explicit' && 'Committed pick'}
              {profile.tendency.source === 'inferred' && 'Inferred from roster attributes'}
              {profile.tendency.source === 'mixed' && 'Partial pick · rest inferred'}
            </span>
          </div>
        )}

        {/* ===== Social links ===== */}
        {(profile.twitchUrl || profile.twitterUrl || profile.youtubeUrl) && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {profile.twitchUrl && <a className="btn btn-tiny" href={profile.twitchUrl} target="_blank" rel="noopener noreferrer">📺 Twitch</a>}
            {profile.twitterUrl && <a className="btn btn-tiny" href={profile.twitterUrl} target="_blank" rel="noopener noreferrer">𝕏 Twitter</a>}
            {profile.youtubeUrl && <a className="btn btn-tiny" href={profile.youtubeUrl} target="_blank" rel="noopener noreferrer">▶ YouTube</a>}
          </div>
        )}

        {/* ===== Starters ===== */}
        <div style={{ marginTop: 8 }}>
          <div className="panel-title">Starters</div>
          <RosterTable players={profile.starters} accent={accent} />
        </div>

        {/* ===== Reserves (collapsed by default — only if any) ===== */}
        {profile.reserves.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary className="muted small" style={{ cursor: 'pointer' }}>
              Reserves ({profile.reserves.length})
            </summary>
            <div style={{ marginTop: 6 }}>
              <RosterTable players={profile.reserves} accent={accent} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function RosterTable({ players, accent }: { players: PublicPlayer[]; accent: string }): React.ReactElement {
  // Show K/D/A/Rating columns only when at least one player on this list
  // has recorded career stats. Keeps early-game rosters uncluttered.
  const anyStats = players.some((p) => typeof p.careerMaps === 'number' && p.careerMaps > 0);
  return (
    <table className="table table-dense" style={{ marginTop: 6 }}>
      <thead>
        <tr>
          <th>Nickname</th>
          <th>Role</th>
          <th>Nat</th>
          <th>Age</th>
          <th className="num">CA</th>
          <th className="num">PA</th>
          {anyStats && <th className="num" title="Maps played">Mp</th>}
          {anyStats && <th className="num">K</th>}
          {anyStats && <th className="num">D</th>}
          {anyStats && <th className="num">A</th>}
          {anyStats && <th className="num" title="HLTV rating">Rtg</th>}
        </tr>
      </thead>
      <tbody>
        {players.map((p) => {
          const rating = p.careerRating ?? 0;
          const ratingCls = rating >= 1.1 ? 'text-win' : rating > 0 && rating < 0.9 ? 'text-loss' : '';
          return (
            <tr key={p.id}>
              <td><PlayerName playerId={p.id} label={p.nickname} color={accent} /> <span className="muted small">{p.firstName} {p.lastName}</span></td>
              <td>{p.role}</td>
              <td className="muted">{p.nationality}</td>
              <td>{p.age.toFixed(0)}</td>
              <td className="num">{p.currentAbility}</td>
              <td className="num">{p.potentialAbility}</td>
              {anyStats && <td className="num muted">{p.careerMaps ?? '—'}</td>}
              {anyStats && <td className="num">{p.careerKills ?? '—'}</td>}
              {anyStats && <td className="num">{p.careerDeaths ?? '—'}</td>}
              {anyStats && <td className="num">{p.careerAssists ?? '—'}</td>}
              {anyStats && <td className={`num ${ratingCls}`} style={{ fontWeight: 700 }}>{typeof p.careerRating === 'number' ? p.careerRating.toFixed(2) : '—'}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
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

function TacticsSlider({ label, value }: { label: string; value: number }): React.ReactElement {
  const pct = Math.max(0, Math.min(100, (value / 20) * 100));
  const color = value >= 15 ? '#e25555' : value >= 12 ? '#f2c443' : value >= 8 ? '#d4d8e1' : value >= 5 ? '#6ed09a' : '#5aa4e6';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        <span className="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</span>
        <strong style={{ color, fontVariantNumeric: 'tabular-nums' }}>{value}/20</strong>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}
