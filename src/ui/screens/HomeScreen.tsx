import { useGame } from '../../store/gameStore';
import { fmtDate, fmtShortDate, money, opponentId, resultFor } from '../util';
import { TeamLink } from '../TeamLink';
import Calendar from '../Calendar';
import { calcTeamChemistry, dressingRoomRole } from '../../sim/pressAndConcerns';
import { sackRisk } from '../../sim/board';

export default function HomeScreen() {
  const game = useGame((s) => s.game)!;
  const openTournament = useGame((s) => s.openTournament);
  const respondToConcern = useGame((s) => s.respondToConcern);
  const answerPress = useGame((s) => s.answerPress);
  const go = useGame((s) => s.go);

  const team = game.teams[game.userTeamId];
  const userId = game.userTeamId;
  const board = game.board;
  const concerns = game.playerConcerns ?? [];
  const press = game.pressConferences ?? [];
  const chemistry = calcTeamChemistry(game, team);

  const nextMatch = game.schedule
    .filter(
      (m) =>
        m.status === 'scheduled' &&
        m.date >= game.currentDate &&
        (m.teamAId === userId || m.teamBId === userId),
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const activeTournament = Object.values(game.tournaments).find((t) => {
    const st = game.tournamentStates[t.id];
    return st && !st.finished && t.invitedTeamIds.includes(userId);
  });
  const activeState = activeTournament ? game.tournamentStates[activeTournament.id] : null;

  const recent = game.schedule
    .filter((m) => m.status === 'finished' && m.result && (m.teamAId === userId || m.teamBId === userId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const squad = team.playerIds.map((id) => game.players[id]).filter(Boolean);
  const avg = (f: (p: (typeof squad)[number]) => number) =>
    squad.length ? squad.reduce((s, p) => s + f(p), 0) / squad.length : 0;
  const avgMorale = avg((p) => p.morale);
  const avgForm = avg((p) => p.form);
  const avgFatigue = avg((p) => p.fatigue);

  const top10 = Object.values(game.teams)
    .sort((a, b) => a.worldRanking - b.worldRanking)
    .slice(0, 10);

  const sack = board ? sackRisk(board) : 'safe';

  return (
    <div className="screen">
      <h2 className="screen-title">Home</h2>

      {/* ===== Press conferences pending (urgent) ===== */}
      {press.map((conf) => (
        <div key={conf.id} className="panel press-panel">
          <div className="panel-title">
            🎤 Press Conference — {conf.kind === 'pre-match' ? 'pre-match' : 'post-match'}
          </div>
          {conf.questions.map((q) => (
            <div key={q.id} className="press-q-block">
              <p className="press-q">"{q.question}"</p>
              <div className="press-options">
                {q.options.map((opt, i) => (
                  <button
                    key={i}
                    className={`press-option tone-${opt.tone}`}
                    onClick={() => answerPress(conf.id, q.id, i)}
                  >
                    <span className="press-tone-pill">{opt.tone}</span>
                    <span className="press-answer">"{opt.answer}"</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* ===== Injury report (only when squad has injuries) ===== */}
      {(() => {
        const injured = squad.filter((p) => p.injury);
        if (injured.length === 0) return null;
        const daysOut = (target: string): number => {
          const a = new Date(game.currentDate + 'T00:00:00Z').getTime();
          const b = new Date(target + 'T00:00:00Z').getTime();
          return Math.max(0, Math.round((b - a) / 86_400_000));
        };
        return (
          <div className="injury-panel" key="injury-report">
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1 }}>
              🚑 INJURY REPORT — {injured.length} {injured.length === 1 ? 'player' : 'players'} out
            </div>
            <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
              {injured.map((p) => p.injury && (
                <div key={p.id} className="muted small">
                  <strong style={{ color: 'var(--text)' }}>{p.nickname}</strong> — {p.injury.description}{' '}
                  <span style={{ color: '#e88578' }}>({daysOut(p.injury.returnDate)}d left)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ===== Player concerns (walk-in office visits) ===== */}
      {concerns.map((c) => {
        const p = game.players[c.playerId];
        return (
          <div key={c.id} className="panel concern-panel">
            <div className="panel-title">
              💬 {p?.nickname ?? 'Player'} wants to talk
            </div>
            <p className="concern-message">"{c.message}"</p>
            <div className="concern-options">
              {c.options.map((opt, i) => (
                <button key={i} className="concern-option" onClick={() => respondToConcern(c.id, i)}>
                  <strong>{opt.label}</strong>
                  <span className="muted small">{opt.description}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div className="home-grid">
        {/* ===== Board confidence + objectives ===== */}
        {board && (
          <div className="panel board-panel">
            <div className="panel-title">
              Board Confidence
              <span className={`sack-pill sack-${sack}`}>{sack}</span>
            </div>
            <div className="confidence-bar">
              <div
                className={`confidence-fill conf-${sack}`}
                style={{ width: `${board.confidence}%` }}
              />
              <span className="confidence-label">{board.confidence.toFixed(0)} / 100</span>
            </div>
            <div className="board-objectives">
              {board.objectives.map((obj) => (
                <div key={obj.id} className={`board-objective status-${obj.status}`}>
                  <span className="board-objective-icon">
                    {obj.status === 'achieved' ? '✓' : obj.status === 'failed' ? '✗' : '○'}
                  </span>
                  <span className="board-objective-text">{obj.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="panel">
          <div className="panel-title">Next Match</div>
          {nextMatch ? (
            <div className="next-match">
              <div className="next-match-opp" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {game.teams[opponentId(nextMatch, userId)] && (
                  <TeamLink team={game.teams[opponentId(nextMatch, userId)]!} logoSize="md" />
                )}
              </div>
              <div className="next-match-meta">
                <span>{game.tournaments[nextMatch.tournamentId]?.name ?? nextMatch.tournamentId}</span>
                <span>{nextMatch.roundLabel}</span>
                <span>{nextMatch.format}</span>
              </div>
              <div className="next-match-date">{fmtDate(nextMatch.date)}</div>
            </div>
          ) : (
            <div className="muted">No matches scheduled. Continue to advance the season.</div>
          )}
        </div>

        <div className="panel">
          <Calendar />
        </div>

        <div className="panel">
          <div className="panel-title">Current Tournament</div>
          {activeTournament && activeState ? (
            <div className="clickable" onClick={() => openTournament(activeTournament.id)}>
              <div className="next-match-opp">{activeTournament.name}</div>
              <div className="next-match-meta">
                <span>{activeTournament.tier}-Tier</span>
                <span>{money(activeTournament.prizePool)} pool</span>
              </div>
              <div className="muted small">
                {activeState.eliminatedTeamIds.includes(userId)
                  ? 'Eliminated'
                  : activeState.placements[userId]
                    ? `Finished #${activeState.placements[userId]}`
                    : activeState.swissRecords[userId]
                      ? `Swiss record ${activeState.swissRecords[userId].wins}-${activeState.swissRecords[userId].losses}`
                      : 'In progress'}
              </div>
            </div>
          ) : (
            <div className="muted">No active tournament.</div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">Squad Status</div>
          <div className="kv-rows">
            <div className="kv">
              <span>Chemistry</span>
              <span className={chemistry >= 70 ? 'text-win' : chemistry < 40 ? 'text-loss' : ''}>
                {chemistry} / 100
              </span>
            </div>
            <div className="kv">
              <span>Avg Morale</span>
              <span className={avgMorale >= 13 ? 'text-win' : avgMorale <= 8 ? 'text-loss' : ''}>
                {avgMorale.toFixed(1)} / 20
              </span>
            </div>
            <div className="kv">
              <span>Avg Form</span>
              <span>{avgForm.toFixed(1)} / 20</span>
            </div>
            <div className="kv">
              <span>Avg Fatigue</span>
              <span className={avgFatigue >= 60 ? 'text-loss' : ''}>{avgFatigue.toFixed(0)}%</span>
            </div>
            <div className="kv">
              <span>World Ranking</span>
              <span>#{team.worldRanking}</span>
            </div>
            <div className="kv">
              <span>Budget</span>
              <span>{money(team.budget)}</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Recent Results</div>
          {recent.length === 0 && <div className="muted">No matches played yet.</div>}
          <table className="table">
            <tbody>
              {recent.map((m) => {
                const r = resultFor(m, userId)!;
                const opp = game.teams[opponentId(m, userId)];
                return (
                  <tr key={m.id}>
                    <td className="muted">{fmtShortDate(m.date)}</td>
                    <td>{opp && <TeamLink team={opp} noLogo />}</td>
                    <td className="muted small">{m.roundLabel}</td>
                    <td className={r.win ? 'text-win' : 'text-loss'}>
                      {r.win ? 'W' : 'L'} {r.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-title">Dressing Room</div>
          <div className="dressing-list">
            {team.playerIds.slice(0, 8).map((id) => {
              const p = game.players[id];
              if (!p) return null;
              const role = dressingRoomRole(p);
              return (
                <div key={id} className={`dressing-row role-${role}`}>
                  <span className="dressing-nick">{p.nickname}</span>
                  <span className={`dressing-role-pill role-${role}`}>{role}</span>
                  <span className="muted small">M {p.morale.toFixed(0)} · L {p.attributes.loyalty}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel home-rankings">
          <div className="panel-title">
            World Top 10
            <button className="link-btn" onClick={() => go('rankings')}>
              Full rankings
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Region</th>
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((t) => (
                <tr key={t.id} className={t.id === userId ? 'row-user' : ''}>
                  <td>{t.worldRanking}</td>
                  <td><TeamLink team={t} display="both" /></td>
                  <td>{t.region}</td>
                  <td className="num">{t.rankingPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
