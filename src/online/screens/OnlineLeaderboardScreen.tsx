// Server-wide leaderboard for the current weekly season. Two tabs:
//   - PvP (default) — derived from match_history, AI duels EXCLUDED.
//     This is the one we push to encourage live duels over AI farming.
//   - Overall — wins + losses across AI + PvP combined.
// Refreshes on mount and every 10 seconds.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import ToastStack from './ToastStack';
import { TeamTag } from './TeamProfileModal';
import RankBadge from './RankBadge';

type Tab = 'rank' | 'pvp' | 'overall' | 'players';

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

function rankBadge(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

export default function OnlineLeaderboardScreen() {
  const team = useOnline((s) => s.team);
  const season = useOnline((s) => s.leaderboardSeason);
  const rows = useOnline((s) => s.leaderboardRows);
  const me = useOnline((s) => s.myStandings);
  const pvpRows = useOnline((s) => s.pvpLeaderRows);
  const myPvp = useOnline((s) => s.myPvpStandings);
  const rankedRows = useOnline((s) => s.rankedLeaderRows);
  const playerRows = useOnline((s) => s.playerLeaderRows);
  const refresh = useOnline((s) => s.refreshLeaderboard);
  const refreshRanked = useOnline((s) => s.refreshRankedLeaderboard);
  const refreshPlayers = useOnline((s) => s.refreshPlayerLeaderboard);
  const go = useOnline((s) => s.go);

  const [tab, setTab] = useState<Tab>('rank');

  useEffect(() => {
    refresh();
    refreshRanked();
    refreshPlayers();
    const id = setInterval(() => { refresh(); refreshRanked(); refreshPlayers(); }, 10_000);
    return () => clearInterval(id);
  }, [refresh, refreshRanked, refreshPlayers]);

  if (!team) return null;
  const myOverallRow = rows.find((r) => r.teamId === team.id);
  const myPvpRow = pvpRows.find((r) => r.teamId === team.id);

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

      {/* ===== Tab strip ===== */}
      <div className="panel" style={{ padding: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button
          className={`btn ${tab === 'rank' ? 'btn-accent' : ''}`}
          onClick={() => setTab('rank')}
          style={{ flex: '1 1 160px', padding: '10px 14px' }}
        >
          🏅 Rank Ladder <span className="muted small">{rankedRows.length}</span>
        </button>
        <button
          className={`btn ${tab === 'pvp' ? 'btn-accent' : ''}`}
          onClick={() => setTab('pvp')}
          style={{ flex: '1 1 160px', padding: '10px 14px' }}
        >
          ⚔ PvP Season <span className="muted small">{pvpRows.length}</span>
        </button>
        <button
          className={`btn ${tab === 'overall' ? 'btn-accent' : ''}`}
          onClick={() => setTab('overall')}
          style={{ flex: '1 1 160px', padding: '10px 14px' }}
        >
          📊 Overall (AI + PvP) <span className="muted small">{rows.length}</span>
        </button>
        <button
          className={`btn ${tab === 'players' ? 'btn-accent' : ''}`}
          onClick={() => setTab('players')}
          style={{ flex: '1 1 160px', padding: '10px 14px' }}
        >
          🎯 Players <span className="muted small">{playerRows.length}</span>
        </button>
      </div>

      {/* ===== Rank ladder tab ===== */}
      {tab === 'rank' && (
        <>
          <div
            className="panel"
            style={{
              padding: 14,
              background: 'linear-gradient(135deg, rgba(255,215,0,0.10), rgba(75,105,255,0.08))',
              border: '1px solid rgba(255,215,0,0.30)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f4c970', letterSpacing: 0.5 }}>
              🏅 Hidden-MMR ladder · Silver I → Global Elite
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>
              Every PvP duel adjusts MMR Elo-style based on the opponent's rating. AI duels DO NOT count. Beat someone higher-rated → bigger gain. Lose to someone lower → bigger drop. New teams play 5 placement duels with doubled K-factor.
            </div>
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div className="panel-title">Top Ranked Teams</div>
            {rankedRows.length === 0 ? (
              <div className="muted small">No ranked teams yet. Win a PvP duel to enter the ladder.</div>
            ) : (
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Name</th>
                    <th>Rank</th>
                    <th className="num">MMR</th>
                    <th className="num">Peak</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedRows.map((r) => {
                    const isMe = r.teamId === team.id;
                    return (
                      <tr key={r.teamId} className={isMe ? 'row-user' : ''}>
                        <td><strong>{rankBadge(r.rank)}</strong></td>
                        <td><TeamTag teamId={r.teamId} tag={r.teamTag} /></td>
                        <td className="muted">{r.teamName}</td>
                        <td><RankBadge mmr={r.mmr} placementMatchesPlayed={r.placementMatchesPlayed} size="compact" /></td>
                        <td className="num"><strong>{r.mmr}</strong></td>
                        <td className="num muted">{r.peakMmr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ===== PvP tab ===== */}
      {tab === 'pvp' && (
        <>
          <div
            className="panel"
            style={{
              padding: 14,
              background: 'linear-gradient(135deg, rgba(75,105,255,0.12), rgba(110,208,154,0.08))',
              border: '1px solid rgba(110,208,154,0.30)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9fb4e4', letterSpacing: 0.5 }}>
              ⚔ Live duels only — AI matches do NOT count here
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>
              Post a challenge in the PvP Lobby to climb. Beating real managers is the only way up this board.
            </div>
          </div>

          {myPvp && (
            <div className="panel" style={{ padding: 14 }}>
              <div className="panel-title">Your PvP Standings <span className="muted small">— season {season?.seasonNo ?? '—'}</span></div>
              <div className="online-stat-grid">
                <StatCell label="Rank" value={myPvpRow ? rankBadge(myPvpRow.rank) : '—'} />
                <StatCell label="PvP W" value={String(myPvp.pvpWins)} cls="text-win" />
                <StatCell label="PvP L" value={String(myPvp.pvpLosses)} cls="text-loss" />
                <StatCell
                  label="Streak"
                  value={streakLabel(myPvp.pvpStreak).text}
                  cls={streakLabel(myPvp.pvpStreak).cls}
                />
                <StatCell
                  label="Stake net"
                  value={`${myPvp.pvpNetStake >= 0 ? '+' : ''}$${myPvp.pvpNetStake.toLocaleString()}`}
                  cls={myPvp.pvpNetStake >= 0 ? 'text-win' : 'text-loss'}
                />
              </div>
            </div>
          )}

          <div className="panel" style={{ padding: 14 }}>
            <div className="panel-title">PvP Standings</div>
            {pvpRows.length === 0 ? (
              <div className="muted small">
                No PvP matches yet this season — be the first to post or accept a live challenge.
              </div>
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
                    <th className="num">Stake net</th>
                  </tr>
                </thead>
                <tbody>
                  {pvpRows.map((r) => {
                    const total = r.pvpWins + r.pvpLosses;
                    const winPct = total > 0 ? Math.round((r.pvpWins / total) * 100) : 0;
                    const isMe = r.teamId === team.id;
                    const streak = streakLabel(r.pvpStreak);
                    return (
                      <tr key={r.teamId} className={isMe ? 'row-user' : ''}>
                        <td><strong>{rankBadge(r.rank)}</strong></td>
                        <td><TeamTag teamId={r.teamId} tag={r.teamTag} /></td>
                        <td className="muted">{r.teamName}</td>
                        <td className="num">{r.pvpWins}</td>
                        <td className="num">{r.pvpLosses}</td>
                        <td className="num">{winPct}%</td>
                        <td className={`num ${streak.cls}`}>{streak.text}</td>
                        <td className={`num ${r.pvpNetStake >= 0 ? 'text-win' : 'text-loss'}`}>
                          {r.pvpNetStake >= 0 ? '+' : ''}${r.pvpNetStake.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ===== Overall (legacy) tab ===== */}
      {tab === 'overall' && (
        <>
          {me && (
            <div className="panel" style={{ padding: 14 }}>
              <div className="panel-title">Your Standings <span className="muted small">— season {season?.seasonNo ?? '—'}</span></div>
              <div className="online-stat-grid">
                <StatCell label="Rank" value={myOverallRow ? rankBadge(myOverallRow.rank) : '—'} />
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
            <div className="panel-title">Overall Standings <span className="muted small">— AI duels included</span></div>
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
                        <td><strong>{rankBadge(r.rank)}</strong></td>
                        <td><TeamTag teamId={r.teamId} tag={r.teamTag} /></td>
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
        </>
      )}

      {/* ===== Players tab ===== */}
      {tab === 'players' && (
        <div className="panel" style={{ padding: 12 }}>
          <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>🎯 Top rated players <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, marginLeft: 6 }}>· career HLTV rating · requires 10+ maps</span></span>
          </div>
          {playerRows.length === 0 ? (
            <div className="muted small" style={{ padding: 12, textAlign: 'center' }}>
              No qualifying players yet — top rated fillers appear here once a player has 10+ maps.
            </div>
          ) : (
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Role</th>
                  <th className="num" title="Maps played">Mp</th>
                  <th className="num">K</th>
                  <th className="num">D</th>
                  <th className="num">A</th>
                  <th className="num" title="K/D ratio">K/D</th>
                  <th className="num" title="HLTV rating">Rtg</th>
                </tr>
              </thead>
              <tbody>
                {playerRows.map((r) => {
                  const isMine = team && r.teamId === team.id;
                  const kd = r.kills / Math.max(1, r.deaths);
                  const ratingCls = r.rating >= 1.1 ? 'text-win' : r.rating < 0.9 ? 'text-loss' : '';
                  return (
                    <tr key={r.playerId} className={isMine ? 'row-user' : ''}>
                      <td style={{ fontWeight: 700 }}>{rankBadge(r.rank)}</td>
                      <td><strong>{r.nickname}</strong></td>
                      <td><TeamTag teamId={r.teamId} tag={r.teamTag} /></td>
                      <td className="muted">{r.role}</td>
                      <td className="num muted">{r.maps}</td>
                      <td className="num">{r.kills}</td>
                      <td className="num">{r.deaths}</td>
                      <td className="num">{r.assists}</td>
                      <td className={`num ${kd >= 1 ? 'text-win' : 'text-loss'}`} style={{ fontWeight: 600 }}>{kd.toFixed(2)}</td>
                      <td className={`num ${ratingCls}`} style={{ fontWeight: 800, fontSize: 13 }}>{r.rating.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

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
