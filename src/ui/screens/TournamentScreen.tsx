import { useGame } from '../../store/gameStore';
import { fmtDate, money } from '../util';

export default function TournamentScreen() {
  const game = useGame((s) => s.game)!;
  const tid = useGame((s) => s.selectedTournamentId);
  const go = useGame((s) => s.go);

  const t = tid ? game.tournaments[tid] : null;
  if (!t) {
    return (
      <div className="screen">
        <div className="panel">
          <p className="muted">No tournament selected.</p>
          <button className="btn" onClick={() => go('schedule')}>
            Back to Schedule
          </button>
        </div>
      </div>
    );
  }

  const st = game.tournamentStates[t.id];
  const userId = game.userTeamId;
  const matches = game.schedule.filter((m) => m.tournamentId === t.id);

  // swiss standings
  const swissRows = st
    ? Object.entries(st.swissRecords)
        .map(([teamId, rec]) => ({ teamId, ...rec }))
        .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
    : [];

  // playoff matches grouped by roundLabel (preserve first-occurrence order)
  const playoffMatches = matches.filter((m) => m.stageName !== 'Swiss Stage');
  const roundOrder: string[] = [];
  const byRound = new Map<string, typeof playoffMatches>();
  for (const m of playoffMatches) {
    if (!byRound.has(m.roundLabel)) {
      byRound.set(m.roundLabel, []);
      roundOrder.push(m.roundLabel);
    }
    byRound.get(m.roundLabel)!.push(m);
  }

  const placements = st
    ? Object.entries(st.placements)
        .map(([teamId, place]) => ({ teamId, place }))
        .sort((a, b) => a.place - b.place)
    : [];

  function statusOf(teamId: string): { text: string; cls: string } {
    if (!st) return { text: '-', cls: 'muted' };
    if (st.placements[teamId]) return { text: `#${st.placements[teamId]}`, cls: '' };
    if (st.eliminatedTeamIds.includes(teamId)) return { text: 'Eliminated', cls: 'text-loss' };
    if (st.currentStageIdx > 0 && st.aliveTeamIds.includes(teamId)) return { text: 'Advanced', cls: 'text-win' };
    return { text: 'Alive', cls: '' };
  }

  return (
    <div className="screen">
      <div className="panel tournament-header">
        <div>
          <h2 className="screen-title" style={{ marginBottom: 4 }}>
            {t.name} {t.isMajor && <span className="major-badge">MAJOR</span>}
          </h2>
          <div className="profile-meta">
            <span className={`tier-badge tier-${t.tier}`}>{t.tier}-Tier</span>
            <span>{money(t.prizePool)} prize pool</span>
            <span>
              {fmtDate(t.startDate)} - {fmtDate(t.endDate)}
            </span>
            <span>{t.teamCount} teams</span>
            {st?.finished && <span className="invited-badge">Finished</span>}
          </div>
        </div>
      </div>

      {!st && (
        <div className="panel">
          <p className="muted">Tournament has not started yet. Invited teams:</p>
          <div className="chip-row">
            {t.invitedTeamIds.map((id) => (
              <span key={id} className={`chip ${id === userId ? 'chip-user' : ''}`}>
                {game.teams[id]?.name ?? id}
              </span>
            ))}
          </div>
        </div>
      )}

      {st && placements.length > 0 && (
        <div className="panel table-panel">
          <div className="panel-title">Placements</div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Place</th>
                <th>Team</th>
                <th className="num">Prize</th>
              </tr>
            </thead>
            <tbody>
              {placements.map((row) => (
                <tr key={row.teamId} className={row.teamId === userId ? 'row-user' : ''}>
                  <td>#{row.place}</td>
                  <td>{game.teams[row.teamId]?.name ?? row.teamId}</td>
                  <td className="num">{money(Math.round(t.prizePool * (t.prizeSpread[row.place - 1] ?? 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {st && swissRows.length > 0 && (
        <div className="panel table-panel">
          <div className="panel-title">Swiss Standings</div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Team</th>
                <th className="num">W</th>
                <th className="num">L</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {swissRows.map((row) => {
                const s = statusOf(row.teamId);
                return (
                  <tr key={row.teamId} className={row.teamId === userId ? 'row-user' : ''}>
                    <td>{game.teams[row.teamId]?.name ?? row.teamId}</td>
                    <td className="num text-win">{row.wins}</td>
                    <td className="num text-loss">{row.losses}</td>
                    <td className={s.cls}>{s.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {roundOrder.length > 0 && (
        <div className="panel table-panel">
          <div className="panel-title">Playoffs</div>
          {roundOrder.map((round) => (
            <div key={round} className="round-group">
              <div className="round-label">{round}</div>
              <table className="table table-dense">
                <tbody>
                  {byRound.get(round)!.map((m) => {
                    const isUser = m.teamAId === userId || m.teamBId === userId;
                    return (
                      <tr key={m.id} className={isUser ? 'row-user' : ''}>
                        <td className="muted">{fmtDate(m.date)}</td>
                        <td className={m.result?.winnerId === m.teamAId ? 'text-win' : ''}>
                          {game.teams[m.teamAId]?.name ?? 'TBD'}
                        </td>
                        <td className="num score-cell">
                          {m.result ? `${m.result.mapsA} - ${m.result.mapsB}` : m.format}
                        </td>
                        <td className={m.result?.winnerId === m.teamBId ? 'text-win' : ''}>
                          {game.teams[m.teamBId]?.name ?? 'TBD'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {st && (
        <div className="panel table-panel">
          <div className="panel-title">All Matches</div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Date</th>
                <th>Round</th>
                <th>Team A</th>
                <th>Score</th>
                <th>Team B</th>
              </tr>
            </thead>
            <tbody>
              {[...matches]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((m) => (
                  <tr key={m.id} className={m.teamAId === userId || m.teamBId === userId ? 'row-user' : ''}>
                    <td className="muted">{fmtDate(m.date)}</td>
                    <td>{m.roundLabel}</td>
                    <td className={m.result?.winnerId === m.teamAId ? 'text-win' : ''}>
                      {game.teams[m.teamAId]?.name ?? 'TBD'}
                    </td>
                    <td className="num">{m.result ? `${m.result.mapsA}-${m.result.mapsB}` : '-'}</td>
                    <td className={m.result?.winnerId === m.teamBId ? 'text-win' : ''}>
                      {game.teams[m.teamBId]?.name ?? 'TBD'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
