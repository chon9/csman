// Click-to-view team profile modal. Pops up when any TeamTag is
// clicked anywhere in the app. Shows a scrubbed view of the target
// team — branding, roster headlines (no full attribute sheet —
// scouting should be flavour, not perfect intel), season + PvP
// record, and total fans.

import { useOnline } from '../onlineStore';
import type { PublicPlayer, PublicTeamProfile } from '../protocol';

/** Clickable team-tag chip — drops into any screen that shows a team
 *  tag, fires fetchTeamProfile on click. Renders the tag in the team's
 *  accent if available, else the global accent. */
export function TeamTag({ teamId, tag, accent }: { teamId: string; tag: string; accent?: string }): React.ReactElement {
  const fetchTeamProfile = useOnline((s) => s.fetchTeamProfile);
  const loading = useOnline((s) => s.teamProfileLoading);
  const isLoading = loading === teamId;
  return (
    <button
      className="link-btn"
      onClick={(e) => { e.stopPropagation(); fetchTeamProfile(teamId); }}
      disabled={isLoading}
      title={`View ${tag} profile`}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: isLoading ? 'wait' : 'pointer',
        color: accent ?? 'var(--accent)',
        fontWeight: 700,
        textDecoration: 'underline dotted rgba(255,255,255,0.25)',
        textUnderlineOffset: 3,
      }}
    >
      {isLoading ? `${tag}…` : tag}
    </button>
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
                  fontWeight: 800, fontSize: 22, color: '#0a0d12', boxShadow: `0 0 18px ${accent}55`,
                }}
              >{profile.tag.slice(0, 2).toUpperCase()}</div>
              <div>
                <h3 style={{ margin: 0 }}>
                  <span style={{ color: accent }}>{profile.tag}</span>
                  <span style={{ marginLeft: 8, fontWeight: 500, color: '#d4d8e1' }}>{profile.name}</span>
                </h3>
                <div className="muted small">
                  {profile.region} · owned by <strong>{profile.ownerNick}</strong> · {profile.ageInDays}d old
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
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={p.id}>
            <td><strong style={{ color: accent }}>{p.nickname}</strong> <span className="muted small">{p.firstName} {p.lastName}</span></td>
            <td>{p.role}</td>
            <td className="muted">{p.nationality}</td>
            <td>{p.age.toFixed(0)}</td>
            <td className="num">{p.currentAbility}</td>
            <td className="num">{p.potentialAbility}</td>
          </tr>
        ))}
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
