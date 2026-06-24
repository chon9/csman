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
  // Prefer the snapshot the server sent — team.playerIds may have already
  // been mutated by post-duel contract expiry, which would mis-classify
  // any starter whose deal ran out as an "opponent" in the scoreboard.
  const ownIds = new Set(outcome.userLineupIds && outcome.userLineupIds.length > 0
    ? outcome.userLineupIds
    : team.playerIds);
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

          {/* ===== Why did this match go this way? ===== */}
          {outcome.diagnostics && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Match diagnostics
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: outcome.diagnostics.warnings.length > 0 ? 10 : 0 }}>
                <DiagStat label="Your avg CA" value={outcome.diagnostics.userAvgCA.toFixed(1)} />
                <DiagStat label="Opp avg CA" value={outcome.diagnostics.oppAvgCA.toFixed(1)} highlight={outcome.diagnostics.oppAvgCA > outcome.diagnostics.userAvgCA + 4 ? 'loss' : 'win'} />
                <DiagStat label="Avg form" value={outcome.diagnostics.userAvgForm.toFixed(1)} highlight={outcome.diagnostics.userAvgForm <= 7 ? 'loss' : outcome.diagnostics.userAvgForm >= 13 ? 'win' : undefined} />
                <DiagStat label="Avg morale" value={outcome.diagnostics.userAvgMorale.toFixed(1)} highlight={outcome.diagnostics.userAvgMorale <= 7 ? 'loss' : outcome.diagnostics.userAvgMorale >= 14 ? 'win' : undefined} />
                <DiagStat label="Avg fatigue" value={`${outcome.diagnostics.userAvgFatigue}%`} highlight={outcome.diagnostics.userAvgFatigue >= 60 ? 'loss' : outcome.diagnostics.userAvgFatigue <= 25 ? 'win' : undefined} />
              </div>
              {outcome.diagnostics.warnings.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, color: '#f2c443', fontSize: 12, lineHeight: 1.5 }}>
                  {outcome.diagnostics.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
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

function DiagStat({ label, value, highlight }: { label: string; value: string; highlight?: 'win' | 'loss' }): React.ReactElement {
  const color = highlight === 'win' ? '#6ed09a' : highlight === 'loss' ? '#e25555' : '#d4d8e1';
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: 6 }}>
      <div className="muted small" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  );
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
