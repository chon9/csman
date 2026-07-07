// Persistent match history for the online team. Lists the last 25 duels
// (AI + PvP) with score, opponent, stake, and money outcome. Clicking
// "Watch" fetches the full MatchResult and routes to the replay viewer.

import { useEffect } from 'react';
import { useOnline } from '../onlineStore';
import type { MatchHistoryEntry } from '../protocol';
import { publicOrigin } from '../serverUrl';
import ToastStack from './ToastStack';
import Icon from '../../ui/Icon';
import { TeamTag } from './TeamProfileModal';

function timeAgo(ts: number): string {
  const days = Math.round((Date.now() - ts) / 86400000);
  if (days <= 0) {
    const hrs = Math.round((Date.now() - ts) / 3600000);
    if (hrs <= 0) return `${Math.max(1, Math.round((Date.now() - ts) / 60000))}m ago`;
    return `${hrs}h ago`;
  }
  return `${days}d ago`;
}

function outcomeColor(won: boolean): string {
  return won ? '#6ed09a' : '#e25555';
}

export default function OnlineHistoryScreen() {
  const team = useOnline((s) => s.team);
  const history = useOnline((s) => s.history);
  const refresh = useOnline((s) => s.refreshHistory);
  const watch = useOnline((s) => s.watchMatch);
  const go = useOnline((s) => s.go);

  useEffect(() => { refresh(); }, [refresh]);

  if (!team) return null;

  const rows = history.map((m) => {
    const userIsA = m.teamAId === team.id;
    const oppTag = userIsA ? m.teamBTag : m.teamATag;
    const oppTeamId = userIsA ? m.teamBId : m.teamAId;
    const userScore = userIsA ? m.mapsA : m.mapsB;
    const oppScore = userIsA ? m.mapsB : m.mapsA;
    const won = m.winnerId === team.id;
    const moneyDelta = won ? m.stake : -m.stake;
    return { m, oppTag, oppTeamId, userScore, oppScore, won, moneyDelta };
  });

  const wins = rows.filter((r) => r.won).length;
  const losses = rows.length - wins;
  const totalMoney = rows.reduce((s, r) => s + r.moneyDelta, 0);

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="history" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Match History</h2>
            <div className="hero-sub">
              Last {history.length} duels · <span className="text-win">{wins}W</span> · <span className="text-loss">{losses}L</span> ·
              net <span style={{ color: outcomeColor(totalMoney >= 0) }}>
                {totalMoney >= 0 ? '+' : ''}${totalMoney.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={refresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh" size={13} /> Refresh
          </button>
          <button className="btn" onClick={() => go('home')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="chevron-left" size={13} /> Back
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        {rows.length === 0 ? (
          <div className="muted small">No duels played yet. Hit the AI duel button on Home or accept a PvP challenge.</div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th></th>
                <th>Opponent</th>
                <th>Type</th>
                <th>Format</th>
                <th className="num">Score</th>
                <th className="num">Stake</th>
                <th className="num">Δ</th>
                <th>When</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, oppTag, oppTeamId, userScore, oppScore, won, moneyDelta }: { m: MatchHistoryEntry; oppTag: string; oppTeamId: string | null; userScore: number; oppScore: number; won: boolean; moneyDelta: number; }) => (
                <tr key={m.id}>
                  <td style={{ color: outcomeColor(won), fontWeight: 800 }}>{won ? 'W' : 'L'}</td>
                  <td>{oppTeamId ? <TeamTag teamId={oppTeamId} tag={oppTag} /> : <strong>{oppTag}</strong>}</td>
                  <td><span className="muted small">{m.kind === 'ai' ? 'AI' : 'PvP'}</span></td>
                  <td className="muted small">{m.mapsA + m.mapsB >= 2 ? 'BO3+' : 'BO1'}</td>
                  <td className="num">{userScore}-{oppScore}</td>
                  <td className="num">${m.stake.toLocaleString()}</td>
                  <td className="num" style={{ color: outcomeColor(won), fontWeight: 700 }}>
                    {moneyDelta >= 0 ? '+' : ''}${moneyDelta.toLocaleString()}
                  </td>
                  <td className="muted small">{timeAgo(m.playedAt)}</td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-tiny" onClick={() => watch(m.id)}>Watch</button>
                    <button
                      className="btn btn-tiny"
                      title="Open the public replay URL in a new tab"
                      onClick={() => { if (typeof window !== 'undefined') window.open(`${publicOrigin()}/replay/${m.id}`, '_blank'); }}
                    >🔗</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ToastStack />
    </div>
  );
}
