// PvP challenge lobby. Three columns of info: open challenges from other
// teams (acceptable), your own posted challenges (cancellable), and a
// quick-post form. Server pushes `challenge-cancelled` when one of your
// challenges resolves, so the local list stays accurate without polling.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  APVP_DEFENDER_WIN_SHARE,
  APVP_MAX_STAKE,
  APVP_MIN_STAKE,
  APVP_PRIMARY_DELTA,
  MAX_DUEL_STAKE,
  MIN_DUEL_STAKE,
} from '../protocol';
import type { MatchFormat } from '../../types';
import ToastStack from './ToastStack';
import { TeamTag } from './TeamProfileModal';

const APVP_PRESETS = [1000, 2500, 5000, 10000, 25000, 50000];

function timeAgo(ts: number): string {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

export default function OnlineChallengesScreen() {
  const team = useOnline((s) => s.team);
  const open = useOnline((s) => s.openChallenges);
  const mine = useOnline((s) => s.myChallenges);
  const duelPending = useOnline((s) => s.duelPending);
  const refresh = useOnline((s) => s.refreshChallenges);
  const post = useOnline((s) => s.postChallenge);
  const cancel = useOnline((s) => s.cancelChallenge);
  const accept = useOnline((s) => s.acceptChallenge);
  const findAsyncMatch = useOnline((s) => s.findAsyncMatch);
  const go = useOnline((s) => s.go);

  const [stake, setStake] = useState(5_000);
  const [format, setFormat] = useState<MatchFormat>('BO1');
  const [message, setMessage] = useState('');
  const [apvpStake, setApvpStake] = useState(5_000);

  useEffect(() => {
    refresh();
    // Refresh every 6s while on the screen so new challenges from other
    // teams appear without the user clicking.
    const id = setInterval(() => refresh(), 6000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!team) return null;
  const canPost = team.money >= stake && team.playerIds.length >= 5;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>PvP Lobby</h2>
          <div className="muted small">
            Post open challenges or accept another team's. Resolves instantly when accepted — frame-by-frame replay watchable in History.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={refresh}>Refresh</button>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* ===== Quick Match (async PvP) ===== */}
      <div
        className="panel"
        style={{
          padding: 16,
          background: 'linear-gradient(135deg, rgba(75,105,255,0.18) 0%, rgba(110,208,154,0.10) 100%)',
          border: '1px solid rgba(109,229,255,0.30)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚡ Quick Match <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: 'rgba(110,255,179,0.22)', border: '1px solid rgba(110,255,179,0.55)', color: '#b8ffd9', letterSpacing: 1, fontWeight: 800 }}>ASYNC</span>
            </div>
            <div className="muted small" style={{ marginTop: 4, color: 'rgba(255,255,255,0.78)' }}>
              Server pairs you with a random team within ±{APVP_PRIMARY_DELTA} total starter CA. No waiting, no posting — duels in seconds.
              Defender risks nothing — no cash lost, no fatigue, no contract burn. Only wins {Math.round(APVP_DEFENDER_WIN_SHARE * 100)}% of the stake on an upset. You carry the full risk.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {APVP_PRESETS.filter((s) => s >= APVP_MIN_STAKE && s <= APVP_MAX_STAKE).map((s) => (
              <button
                key={s}
                className={`btn btn-tiny ${apvpStake === s ? 'btn-accent' : ''}`}
                onClick={() => setApvpStake(s)}
              >${s.toLocaleString()}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 12, flexWrap: 'wrap' }}>
          <span className="muted small" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Win <strong style={{ color: '#6ed09a' }}>+${apvpStake.toLocaleString()}</strong> · lose <strong style={{ color: '#e25555' }}>−${apvpStake.toLocaleString()}</strong> · counts toward your daily duel cap and PvP leaderboard.
          </span>
          <button
            className="btn btn-accent"
            disabled={duelPending || team.money < apvpStake || team.playerIds.length < 5}
            onClick={() => findAsyncMatch(apvpStake)}
            title={
              team.playerIds.length < 5 ? 'Need 5 players on the roster' :
              team.money < apvpStake ? `Need $${apvpStake.toLocaleString()} on hand` :
              `Find an opponent at $${apvpStake.toLocaleString()}`
            }
            style={{ padding: '10px 22px', fontSize: 14, fontWeight: 700 }}
          >
            {duelPending ? 'Searching…' : '⚡ Find Match'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* ===== Post a challenge ===== */}
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Post a Challenge</div>
          <p className="muted small" style={{ marginTop: 2 }}>
            Sits in the lobby until another team accepts. You can hold up to 3 open challenges.
          </p>
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            <label className="field">
              <span className="field-label">Stake ${stake.toLocaleString()}</span>
              <input
                type="range"
                min={MIN_DUEL_STAKE}
                max={MAX_DUEL_STAKE}
                step={500}
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">Format</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['BO1', 'BO3', 'BO5'] as MatchFormat[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`btn ${format === f ? 'btn-accent' : ''}`}
                    onClick={() => setFormat(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </label>
            <label className="field">
              <span className="field-label">Smack talk (optional, max 120)</span>
              <input
                className="input"
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 120))}
                placeholder="any takers?"
              />
            </label>
            <button
              className="btn btn-accent"
              disabled={!canPost || mine.length >= 3}
              onClick={() => { post(stake, format, message || undefined); setMessage(''); }}
              title={
                team.playerIds.length < 5
                  ? 'Need 5 players to post'
                  : team.money < stake
                    ? 'Insufficient funds'
                    : mine.length >= 3
                      ? 'Cancel one first (3 max)'
                      : ''
              }
            >
              Post Challenge
            </button>
          </div>
        </div>

        {/* ===== My open challenges ===== */}
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">My Open Challenges <span className="muted small">— {mine.length}/3</span></div>
          {mine.length === 0 ? (
            <div className="muted small">No open challenges. Post one to start fishing for opponents.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {mine.map((c) => (
                <div key={c.id} className="panel-2" style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div>
                      <strong>${c.stake.toLocaleString()}</strong> · {c.format}
                      <div className="muted small">{timeAgo(c.createdAt)}</div>
                    </div>
                    <button className="btn btn-tiny btn-danger" onClick={() => cancel(c.id)}>Cancel</button>
                  </div>
                  {c.message && <div className="muted small" style={{ marginTop: 4, fontStyle: 'italic' }}>"{c.message}"</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== Open lobby ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Open Lobby <span className="muted small">— {open.length} challenge{open.length === 1 ? '' : 's'}</span></div>
        {open.length === 0 ? (
          <div className="muted small">No open challenges right now. Be the first to post.</div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Team</th>
                <th>Owner</th>
                <th>Format</th>
                <th className="num">Stake</th>
                <th>Message</th>
                <th>Posted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {open.map((c) => {
                const canAfford = team.money >= c.stake;
                return (
                  <tr key={c.id}>
                    <td><TeamTag teamId={c.challengerTeamId} tag={c.challengerTag} /></td>
                    <td className="muted">{c.challengerNick}</td>
                    <td>{c.format}</td>
                    <td className="num">${c.stake.toLocaleString()}</td>
                    <td className="muted small" style={{ fontStyle: c.message ? 'italic' : 'normal' }}>
                      {c.message ? `"${c.message}"` : '—'}
                    </td>
                    <td className="muted small">{timeAgo(c.createdAt)}</td>
                    <td>
                      <button
                        className="btn btn-tiny btn-accent"
                        disabled={!canAfford || duelPending || team.playerIds.length < 5}
                        onClick={() => accept(c.id)}
                        title={
                          team.playerIds.length < 5
                            ? 'Need 5 players to accept'
                            : !canAfford
                              ? 'Insufficient funds'
                              : ''
                        }
                      >
                        {duelPending ? '…' : 'Accept'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ToastStack />
    </div>
  );
}
