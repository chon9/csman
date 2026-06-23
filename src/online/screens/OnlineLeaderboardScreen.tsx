// Server-wide leaderboard for the current weekly season. Refreshes on
// mount and every 10 seconds so duel results land live without a manual
// refresh. Highlights your own row and shows a banner with your standings.

import { useEffect } from 'react';
import { useOnline } from '../onlineStore';
import ToastStack from './ToastStack';

function fmtDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const secs = Math.floor(ms / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function streakLabel(s: number): { text: string; cls: string } {
  if (s >= 3) return { text: `W${s} 🔥`, cls: 'text-win' };
  if (s > 0) return { text: `W${s}`, cls: 'text-win' };
  if (s <= -3) return { text: `L${-s} ❄`, cls: 'text-loss' };
  if (s < 0) return { text: `L${-s}`, cls: 'text-loss' };
  return { text: '—', cls: '' };
}

export default function OnlineLeaderboardScreen() {
  const team = useOnline((s) => s.team);
  const season = useOnline((s) => s.leaderboardSeason);
  const rows = useOnline((s) => s.leaderboardRows);
  const me = useOnline((s) => s.myStandings);
  const refresh = useOnline((s) => s.refreshLeaderboard);
  const go = useOnline((s) => s.go);

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!team) return null;
  const myRow = rows.find((r) => r.teamId === team.id);

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>
            Season {season?.seasonNo ?? '—'} Leaderboard
          </h2>
          <div className="muted small">
            {season
              ? <>Ends in <strong>{fmtDuration(season.endsAt - Date.now())}</strong> · prize pool ${season.prizePool.toLocaleString()}</>
              : 'Loading…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={refresh}>Refresh</button>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {me && (
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Your Standings <span className="muted small">— season {season?.seasonNo ?? '—'}</span></div>
          <div className="online-stat-grid">
            <StatCell label="Rank" value={myRow ? `#${myRow.rank}` : '—'} />
            <StatCell label="W" value={String(me.wins)} cls="text-win" />
            <StatCell label="L" value={String(me.losses)} cls="text-loss" />
            <StatCell
              label="Streak"
              value={streakLabel(me.streak).text}
              cls={streakLabel(me.streak).cls}
            />
            <StatCell
              label="Net $"
              value={`${me.netMoney >= 0 ? '+' : ''}$${me.netMoney.toLocaleString()}`}
              cls={me.netMoney >= 0 ? 'text-win' : 'text-loss'}
            />
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Standings</div>
        {rows.length === 0 ? (
          <div className="muted small">No matches recorded this season yet — be the first to register a win!</div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Name</th>
                <th className="num">W</th>
                <th className="num">L</th>
                <th className="num">Win%</th>
                <th className="num">Streak</th>
                <th className="num">Net $</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total = r.wins + r.losses;
                const winPct = total > 0 ? Math.round((r.wins / total) * 100) : 0;
                const isMe = r.teamId === team.id;
                const streak = streakLabel(r.streak);
                return (
                  <tr key={r.teamId} className={isMe ? 'row-user' : ''}>
                    <td><strong>{r.rank}</strong></td>
                    <td><strong style={{ color: 'var(--accent)' }}>{r.teamTag}</strong></td>
                    <td className="muted">{r.teamName}</td>
                    <td className="num">{r.wins}</td>
                    <td className="num">{r.losses}</td>
                    <td className="num">{winPct}%</td>
                    <td className={`num ${streak.cls}`}>{streak.text}</td>
                    <td className={`num ${r.netMoney >= 0 ? 'text-win' : 'text-loss'}`}>
                      {r.netMoney >= 0 ? '+' : ''}${r.netMoney.toLocaleString()}
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

function StatCell({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
      <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div className={cls} style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
