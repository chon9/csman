import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { fmtDate, money, opponentId, resultFor } from '../util';
import { TeamLink } from '../TeamLink';
import type { MapName } from '../../types';
import { ALL_MAPS } from '../../types';

export default function ScheduleScreen() {
  const game = useGame((s) => s.game)!;
  const openTournament = useGame((s) => s.openTournament);
  const scheduleScrimmage = useGame((s) => s.scheduleScrimmage);
  const [scrimOpp, setScrimOpp] = useState<string>('');
  const [scrimMap, setScrimMap] = useState<MapName>('Mirage');

  const userId = game.userTeamId;
  const matches = game.schedule
    .filter((m) => m.teamAId === userId || m.teamBId === userId)
    .sort((a, b) => a.date.localeCompare(b.date));

  const upcoming = matches.filter((m) => m.status !== 'finished');
  const past = matches.filter((m) => m.status === 'finished').reverse();

  const tournaments = Object.values(game.tournaments).sort((a, b) => a.startDate.localeCompare(b.startDate));

  const matchRows = (list: typeof matches) => (
    <table className="table table-dense">
      <thead>
        <tr>
          <th>Date</th>
          <th>Event</th>
          <th>Round</th>
          <th>Opponent</th>
          <th>Format</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {list.map((m) => {
          const r = resultFor(m, userId);
          return (
            <tr key={m.id}>
              <td className="muted">{fmtDate(m.date)}</td>
              <td className="clickable" onClick={() => openTournament(m.tournamentId)}>
                {game.tournaments[m.tournamentId]?.name ?? m.tournamentId}
              </td>
              <td>{m.roundLabel}</td>
              <td>
                {game.teams[opponentId(m, userId)] ? (
                  <TeamLink team={game.teams[opponentId(m, userId)]!} />
                ) : 'TBD'}
              </td>
              <td>{m.format}</td>
              <td className={r ? (r.win ? 'text-win' : 'text-loss') : 'muted'}>
                {r ? `${r.win ? 'W' : 'L'} ${r.text}` : m.status === 'live' ? 'Live' : '-'}
              </td>
            </tr>
          );
        })}
        {list.length === 0 && (
          <tr>
            <td colSpan={6} className="muted">
              No matches.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );

  return (
    <div className="screen">
      <h2 className="screen-title">Schedule</h2>

      <div className="panel table-panel">
        <div className="panel-title">Upcoming Matches</div>
        {matchRows(upcoming)}
      </div>

      <div className="panel">
        <div className="panel-title">Scrimmage / Friendly</div>
        <p className="muted small">
          Schedule a single-map practice match against any team. No prize money or
          ranking points — just match reps, mild fatigue (+3%), small form swing,
          and a confidence/morale ripple based on the result.
        </p>
        <div className="scrim-row">
          <label className="field">
            <span className="field-label">Opponent</span>
            <select className="input" value={scrimOpp} onChange={(e) => setScrimOpp(e.target.value)}>
              <option value="">— pick a team —</option>
              {Object.values(game.teams)
                .filter((t) => t.id !== userId)
                .sort((a, b) => a.worldRanking - b.worldRanking)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.worldRanking} {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Map</span>
            <select
              className="input"
              value={scrimMap}
              onChange={(e) => setScrimMap(e.target.value as MapName)}
            >
              {ALL_MAPS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-accent"
            disabled={!scrimOpp}
            onClick={() => {
              scheduleScrimmage(scrimOpp, scrimMap);
              setScrimOpp('');
            }}
          >
            Play scrim
          </button>
        </div>
      </div>

      <div className="panel table-panel">
        <div className="panel-title">Past Matches</div>
        {matchRows(past)}
      </div>

      <div className="panel table-panel">
        <div className="panel-title">Season Tournaments</div>
        <table className="table table-dense">
          <thead>
            <tr>
              <th>Tournament</th>
              <th>Tier</th>
              <th className="num">Prize Pool</th>
              <th>Dates</th>
              <th>Teams</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tournaments.map((t) => {
              const invited = t.invitedTeamIds.includes(userId);
              const st = game.tournamentStates[t.id];
              return (
                <tr key={t.id} className="clickable" onClick={() => openTournament(t.id)}>
                  <td>
                    {t.name} {t.isMajor && <span className="major-badge">MAJOR</span>}
                  </td>
                  <td>
                    <span className={`tier-badge tier-${t.tier}`}>{t.tier}</span>
                  </td>
                  <td className="num">{money(t.prizePool)}</td>
                  <td className="muted">
                    {fmtDate(t.startDate)} - {fmtDate(t.endDate)}
                  </td>
                  <td>{t.teamCount}</td>
                  <td>
                    {invited && <span className="invited-badge">Invited</span>}{' '}
                    {st?.finished && <span className="muted small">Finished</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
