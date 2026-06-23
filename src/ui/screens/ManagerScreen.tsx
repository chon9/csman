// Manager profile screen — lifetime identity, attributes, career stints, achievements.
// Persists across save slots (anchored by manager name).

import { useGame } from '../../store/gameStore';
import { reputationLabel } from '../../store/managerStorage';
import { fmtShortDate, money } from '../util';
import type { AchievementId } from '../../types';

const ACHIEVEMENT_LABEL: Record<AchievementId, string> = {
  'first-major': 'First Major Win',
  'major-winner': 'Major Winner',
  'wonderkid-whisperer': 'Wonderkid Whisperer',
  untouchable: 'Untouchable',
  globetrotter: 'Globetrotter',
  'serial-winner': 'Serial Winner',
  'underdog-king': 'Underdog King',
  'hall-of-fame': 'Hall of Fame',
};

const STYLE_LABEL: Record<string, string> = {
  tactician: 'Tactician',
  motivator: 'Motivator',
  'youth-specialist': 'Youth Specialist',
  'all-rounder': 'All-rounder',
};

export default function ManagerScreen() {
  const game = useGame((s) => s.game)!;
  const acceptOffer = useGame((s) => s.acceptManagerJobOffer);
  const declineOffer = useGame((s) => s.declineManagerJobOffer);
  const resign = useGame((s) => s.resignFromJob);
  const m = game.manager;
  if (!m) {
    return (
      <div className="screen">
        <h2 className="screen-title">Manager</h2>
        <div className="panel">
          <div className="muted">
            No manager profile attached to this career. Start a new career and enter a manager name
            on the New Career screen to unlock the manager identity.
          </div>
        </div>
      </div>
    );
  }

  const rep = Math.round(m.reputation);
  const tier = reputationLabel(rep);
  const currentStint = m.career[m.career.length - 1];
  const offers = game.managerJobOffers ?? [];
  const unattached = !!game.managerUnattached;

  return (
    <div className="screen">
      <h2 className="screen-title">Manager</h2>

      <div className="panel manager-hero">
        <div className="manager-avatar">{m.initials}</div>
        <div className="manager-hero-body">
          <div className="manager-name">{m.name}</div>
          <div className="manager-meta">
            <span>{m.nationality || 'XX'}</span>
            <span>·</span>
            <span>{STYLE_LABEL[m.style] ?? m.style}</span>
            <span>·</span>
            <span>
              {m.trophiesTotal} {m.trophiesTotal === 1 ? 'trophy' : 'trophies'}
            </span>
            <span>·</span>
            <span>
              {m.career.length} {m.career.length === 1 ? 'stint' : 'stints'}
            </span>
            {unattached && <span className="mgr-unattached-pill">Between jobs</span>}
          </div>
        </div>
        {!unattached && (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm('Resign from your current job? You will be between clubs until a rebound offer lands.')) {
                resign();
              }
            }}
          >
            Resign
          </button>
        )}
      </div>

      {offers.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            Pending Job Offers <span className="badge">{offers.length}</span>
          </div>
          <div className="offer-list">
            {offers.map((o) => (
              <div key={o.id} className={`offer-card kind-${o.kind}`}>
                <div className="offer-head">
                  <span className="offer-team">
                    {o.teamName} <span className="muted">#{o.teamRank}</span>
                  </span>
                  <span className={`offer-kind-pill kind-${o.kind}`}>
                    {o.kind === 'head-hunt' ? 'Head-hunt' : o.kind === 'rebound' ? 'Rebound' : 'Approach'}
                  </span>
                </div>
                <div className="offer-pitch">"{o.pitch}"</div>
                <div className="offer-meta muted small">
                  Sign-on {money(o.signOnBonus)} · Expires {fmtShortDate(o.expiresOn)}
                </div>
                <div className="offer-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      if (
                        confirm(
                          `Accept the ${o.teamName} job?\n\nThis closes your current stint and ports your manager identity to ${o.teamName}.`,
                        )
                      ) {
                        acceptOffer(o.id);
                      }
                    }}
                  >
                    Accept
                  </button>
                  <button className="btn" onClick={() => declineOffer(o.id)}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="manager-grid">
        <div className="panel">
          <div className="panel-title">Reputation</div>
          <div className="rep-bar">
            <div className="rep-fill" style={{ width: `${rep}%` }} />
            <span className="rep-label">
              {rep} / 100 · {tier}
            </span>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            Drives club approaches, board patience, and AI job offers between careers.
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Attributes</div>
          <div className="kv-rows">
            <AttrRow label="Motivating" value={m.attributes.motivating} hint="Loss bounceback" />
            <AttrRow label="Youngsters" value={m.attributes.youngsters} hint="Mentor boost mult" />
            <AttrRow label="Press" value={m.attributes.press} hint="Media trust handling" />
            <AttrRow label="Judging Talent" value={m.attributes.judgingTalent} hint="Scouting accuracy" />
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Current Job</div>
          {currentStint && !currentStint.endDate ? (
            <div className="kv-rows">
              <div className="kv">
                <span>Club</span>
                <span>{currentStint.teamName}</span>
              </div>
              <div className="kv">
                <span>Since</span>
                <span>{fmtShortDate(currentStint.startDate)}</span>
              </div>
              <div className="kv">
                <span>Trophies this stint</span>
                <span>{currentStint.trophies}</span>
              </div>
              <div className="kv">
                <span>Best rank</span>
                <span>{currentStint.bestRank ? `#${currentStint.bestRank}` : '—'}</span>
              </div>
            </div>
          ) : (
            <div className="muted">Currently unattached.</div>
          )}
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title">Board Confidence &amp; Season Mandates</div>
          <BoardConfidencePanel />
        </div>

        <div className="panel table-panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title">Career Stints</div>
          <table className="table">
            <thead>
              <tr>
                <th>Club</th>
                <th>From</th>
                <th>To</th>
                <th className="num">Trophies</th>
                <th>Best</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {m.career.map((s, i) => (
                <tr key={`${s.teamId}-${s.startDate}-${i}`} className={i === m.career.length - 1 ? 'row-user' : ''}>
                  <td>{s.teamName}</td>
                  <td className="muted small">{fmtShortDate(s.startDate)}</td>
                  <td className="muted small">{s.endDate ? fmtShortDate(s.endDate) : 'current'}</td>
                  <td className="num">{s.trophies}</td>
                  <td>{s.bestRank ? `#${s.bestRank}` : '—'}</td>
                  <td className="muted small">{s.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title">Achievements</div>
          {m.achievements.length === 0 ? (
            <div className="muted small">No achievements yet. Win a Major, manage abroad, or build a dynasty to unlock honours.</div>
          ) : (
            <div className="achievement-grid">
              {m.achievements.map((a) => (
                <div key={a.id} className="achievement-card">
                  <div className="achievement-name">🏆 {ACHIEVEMENT_LABEL[a.id] ?? a.id}</div>
                  <div className="muted small">{fmtShortDate(a.unlockedOn)}</div>
                  {a.context && <div className="achievement-ctx">{a.context}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttrRow({ label, value, hint }: { label: string; value: number; hint: string }) {
  const cls = value >= 16 ? 'text-win' : value <= 7 ? 'text-loss' : '';
  return (
    <div className="kv">
      <span>
        {label} <span className="muted small">· {hint}</span>
      </span>
      <span className={cls}>
        <strong>{value}</strong> / 20
      </span>
    </div>
  );
}

function BoardConfidencePanel() {
  const game = useGame((s) => s.game)!;
  const conf = Math.round(game.boardConfidence ?? 50);
  const mandates = game.boardMandates ?? [];
  // Vibe label based on confidence band — FM-style copy.
  const verdict =
    conf >= 80 ? { label: 'Adored', cls: 'tier-superstar' } :
    conf >= 60 ? { label: 'Trusted', cls: 'tier-established' } :
    conf >= 40 ? { label: 'Stable', cls: 'tier-journeyman' } :
    conf >= 20 ? { label: 'Wavering', cls: 'tier-prospect' } :
    conf >= 10 ? { label: 'Hot seat', cls: 'tier-star' } :
                 { label: 'Sacking watch', cls: 'tier-superstar' };
  return (
    <>
      <div className="confidence-bar">
        <div className="confidence-track">
          <div
            className="confidence-fill"
            style={{
              width: `${conf}%`,
              background:
                conf >= 60
                  ? 'linear-gradient(90deg, #4caf7d, #6ed09a)'
                  : conf >= 30
                    ? 'linear-gradient(90deg, #de9b35, #f0c050)'
                    : 'linear-gradient(90deg, #c44a4a, #e25555)',
            }}
          />
          <span className="confidence-label">
            {conf}% · <span className={verdict.cls}>{verdict.label}</span>
          </span>
        </div>
        <div className="muted small" style={{ marginTop: 4 }}>
          Confidence swings on results, mandates, and scandals. Below 20% the board sends warnings; below 10% sacking is imminent.
        </div>
      </div>

      <div className="panel-title" style={{ marginTop: 12 }}>This Season's Mandates</div>
      {mandates.length === 0 ? (
        <div className="muted small">No active mandates — the board is leaving you to it for now.</div>
      ) : (
        <div className="mandate-list">
          {mandates.map((m) => {
            const statusTag =
              m.status === 'met' ? <span className="text-win">✓ Met</span> :
              m.status === 'failed' ? <span className="text-loss">✗ Failed</span> :
              <span className="muted small">Open · judged {fmtShortDate(m.deadline)}</span>;
            return (
              <div key={m.id} className={`mandate-row mandate-${m.status}`}>
                <div className="mandate-head">
                  <strong>{m.label}</strong>
                  {statusTag}
                </div>
                <div className="muted small">{m.detail}</div>
                {m.rewardCash && m.rewardCash > 0 && (
                  <div className="muted small">
                    Reward: +{m.rewardConfidence}% confidence · ${m.rewardCash.toLocaleString()} cash bonus
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
