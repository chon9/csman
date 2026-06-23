// Duel result modal — pops over the home screen after a finished duel.
// Shows the headline score, the per-player K/D/Rating breakdown for both
// sides, and the money delta. No frame replay yet (Phase 3).

import { useOnline } from '../onlineStore';
import type { DuelOutcome } from '../protocol';

export default function DuelResultModal({ outcome }: { outcome: DuelOutcome }) {
  const dismiss = useOnline((s) => s.dismissDuelResult);
  const fetchLiveReplay = useOnline((s) => s.fetchLiveReplay);
  const team = useOnline((s) => s.team);
  const players = useOnline((s) => s.players);
  const { result } = outcome;

  if (!team) return null;
  const won = result.winnerId === team.id;
  // Flatten per-player stats across maps.
  const flat: Record<string, { kills: number; deaths: number; assists: number; rating: number; n: number }> = {};
  for (const m of result.maps) {
    for (const s of Object.values(m.playerStats)) {
      const e = flat[s.playerId] ?? { kills: 0, deaths: 0, assists: 0, rating: 0, n: 0 };
      e.kills += s.kills; e.deaths += s.deaths; e.assists += s.assists; e.rating += s.rating; e.n++;
      flat[s.playerId] = e;
    }
  }
  // Partition: own players vs the rest (= AI side).
  const ownIds = new Set(team.playerIds);
  const ourSide = Object.entries(flat)
    .filter(([id]) => ownIds.has(id))
    .sort((a, b) => b[1].rating / b[1].n - a[1].rating / a[1].n);
  const theirSide = Object.entries(flat)
    .filter(([id]) => !ownIds.has(id))
    .sort((a, b) => b[1].rating / b[1].n - a[1].rating / a[1].n);

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-head">
          <h3 style={{ color: won ? '#6ed09a' : '#e25555' }}>
            {won ? 'VICTORY' : 'DEFEAT'} — {team.tag} {result.mapsA}-{result.mapsB} {outcome.opponentTag}
          </h3>
          <button className="link-btn" onClick={dismiss}>close ✕</button>
        </div>
        <div className="modal-body">
          <div className="muted small" style={{ marginBottom: 4 }}>
            {result.maps.map((m) => `${m.map} ${m.scoreA}-${m.scoreB}`).join('  •  ')}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: won ? '#6ed09a' : '#e25555', marginBottom: 12 }}>
            {outcome.moneyDelta > 0 ? '+' : ''}${outcome.moneyDelta.toLocaleString()} → balance ${outcome.newMoney.toLocaleString()}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <SidePanel title={team.tag} rows={ourSide} resolveName={(id) => players[id]?.nickname ?? id} />
            <SidePanel title={outcome.opponentTag} rows={theirSide} resolveName={(id, fallback) => fallback} />
          </div>
        </div>
        <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button
            className="btn"
            onClick={() => { fetchLiveReplay(result.matchId); dismiss(); }}
            title="Frame-by-frame replay (available for ~5 minutes after the duel)"
          >
            ▶ Watch Live Replay
          </button>
          <button className="btn btn-accent" onClick={dismiss}>Continue</button>
        </div>
      </div>
    </div>
  );
}

interface SideRow {
  kills: number;
  deaths: number;
  assists: number;
  rating: number;
  n: number;
}

function SidePanel({
  title,
  rows,
  resolveName,
}: {
  title: string;
  rows: [string, SideRow][];
  resolveName: (id: string, fallback: string) => string;
}) {
  return (
    <table className="sb-table">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="num">K</th>
          <th className="num">D</th>
          <th className="num">A</th>
          <th className="num">Rtg</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([id, s]) => {
          const avg = s.rating / s.n;
          return (
            <tr key={id}>
              <td>{resolveName(id, id)}</td>
              <td className="num">{s.kills}</td>
              <td className="num">{s.deaths}</td>
              <td className="num">{s.assists}</td>
              <td className={`num ${avg >= 1.1 ? 'text-win' : avg < 0.9 ? 'text-loss' : ''}`} style={{ fontWeight: 700 }}>
                {avg.toFixed(2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
