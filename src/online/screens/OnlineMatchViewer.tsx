// Match viewer for stored duels. Frames are stripped before persistence
// (too heavy to keep around), so the viewer shows the rich stat breakdown
// instead of a moving-dots replay: per-map score, per-player K/D/Rating,
// and the round-by-round outcome timeline that DOES survive stripping
// (winnerSide + reason fields are tiny). Live replay over frames is a
// future polish — we'd need to stream frames separately or keep them for
// only the last ~5 matches per team.

import { useOnline } from '../onlineStore';
import type { MatchResult, PlayerMatchStats } from '../../types';

export default function OnlineMatchViewer() {
  const team = useOnline((s) => s.team);
  const viewing = useOnline((s) => s.viewing);
  const players = useOnline((s) => s.players);
  const close = useOnline((s) => s.closeViewer);

  if (!viewing || !team) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <div className="panel"><div className="muted">Loading match…</div></div>
      </div>
    );
  }

  const r = viewing.result;
  const userIsA = r.teamAId === team.id;
  const won = r.winnerId === team.id;
  const userMaps = userIsA ? r.mapsA : r.mapsB;
  const oppMaps = userIsA ? r.mapsB : r.mapsA;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ color: won ? '#6ed09a' : '#e25555', fontWeight: 800, fontSize: 12, letterSpacing: 1.5 }}>
            {won ? 'VICTORY' : 'DEFEAT'}
          </div>
          <h2 style={{ margin: '4px 0' }}>
            {team.tag} {userMaps} — {oppMaps} {userIsA ? r.teamBId : r.teamAId}
          </h2>
          <div className="muted small">
            {r.maps.map((m) => `${m.map} ${m.scoreA}-${m.scoreB}`).join('  •  ')}
          </div>
        </div>
        <button className="btn" onClick={close}>← Back to History</button>
      </div>

      {r.vetoLog.length > 0 && (
        <div className="panel" style={{ padding: 12 }}>
          <div className="panel-title">Veto</div>
          <div className="muted small">{r.vetoLog.join('  →  ')}</div>
        </div>
      )}

      {r.maps.map((m, i) => (
        <div key={i} className="panel" style={{ padding: 14 }}>
          <div className="panel-title">
            Map {i + 1}: {m.map} <span className="muted small">— {m.scoreA}:{m.scoreB}</span>
          </div>

          {/* Round timeline (winnerSide + reason still survive stripping). */}
          <div className="round-timeline">
            {m.rounds.map((round, idx) => {
              // We don't know which team is which side anymore (no frames),
              // but `winnerTeamId` is preserved on each round.
              const userWonRound = round.winnerTeamId === team.id;
              return (
                <div
                  key={idx}
                  className={`round-cell ${userWonRound ? 'round-win' : 'round-loss'}`}
                  title={`R${round.roundNo}: ${round.winnerTeamId === team.id ? team.tag : 'opp'} via ${round.reason}`}
                >
                  {round.roundNo}
                </div>
              );
            })}
          </div>

          {/* Per-player scoreboard, both sides side-by-side. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
            <SidePanel
              title={userIsA ? team.tag : `Team A`}
              rows={Object.values(m.playerStats).filter((s) => playerOnTeam(s.playerId, players, userIsA ? team.id : null))}
              resolveName={(id) => players[id]?.nickname ?? id}
            />
            <SidePanel
              title={userIsA ? `Team B` : team.tag}
              rows={Object.values(m.playerStats).filter((s) => !playerOnTeam(s.playerId, players, userIsA ? team.id : null))}
              resolveName={(id) => players[id]?.nickname ?? id}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function playerOnTeam(playerId: string, players: Record<string, { teamId: string | null }>, teamId: string | null): boolean {
  const p = players[playerId];
  if (!p) return false;
  return p.teamId === teamId;
}

function SidePanel({
  title,
  rows,
  resolveName,
}: {
  title: string;
  rows: PlayerMatchStats[];
  resolveName: (id: string) => string;
}) {
  const sorted = [...rows].sort((a, b) => b.rating - a.rating);
  return (
    <table className="sb-table">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="num">K</th>
          <th className="num">D</th>
          <th className="num">A</th>
          <th className="num">ADR</th>
          <th className="num">Rtg</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => (
          <tr key={s.playerId}>
            <td>{resolveName(s.playerId)}</td>
            <td className="num">{s.kills}</td>
            <td className="num">{s.deaths}</td>
            <td className="num">{s.assists}</td>
            <td className="num">{s.damage > 0 ? (s.damage / 1).toFixed(0) : '—'}</td>
            <td className={`num ${s.rating >= 1.1 ? 'text-win' : s.rating < 0.9 ? 'text-loss' : ''}`} style={{ fontWeight: 700 }}>
              {s.rating.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
