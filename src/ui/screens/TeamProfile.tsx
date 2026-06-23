// Team profile — surfaces a single team with its roster, stats, recent
// results, and tactical signature. Any team name across the app is clickable
// and lands here. Distinct from the user's Home/Squad screens which are
// always your own club.

import { useMemo } from 'react';
import { useGame } from '../../store/gameStore';
import { TeamLogo } from '../TeamLogo';
import { fmtShortDate, money } from '../util';
import type { Player } from '../../types';
import { FormationPitch } from '../FormationPitch';

export default function TeamProfile() {
  const game = useGame((s) => s.game)!;
  const selectedTeamId = useGame((s) => s.selectedTeamId);
  const openPlayer = useGame((s) => s.openPlayer);
  const openTournament = useGame((s) => s.openTournament);
  const go = useGame((s) => s.go);

  const team = selectedTeamId ? game.teams[selectedTeamId] : null;

  if (!team) {
    return (
      <div className="screen">
        <h2 className="screen-title">Team</h2>
        <div className="panel">
          <div className="muted">No team selected. Click any team name to view its profile.</div>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => go('rankings')}>
            Browse Rankings
          </button>
        </div>
      </div>
    );
  }

  const roster: Player[] = team.playerIds
    .map((id) => game.players[id])
    .filter((p): p is Player => !!p);

  // Sort: first-team starters, then reserves, then youth, all by CA desc within tier.
  const tierRank = (p: Player) => {
    const t = p.squadTier ?? 'first';
    return t === 'first' ? 0 : t === 'reserve' ? 1 : 2;
  };
  const sortedRoster = [...roster].sort(
    (a, b) => tierRank(a) - tierRank(b) || b.currentAbility - a.currentAbility,
  );

  const recentMatches = useMemo(() => {
    return game.schedule
      .filter(
        (m) =>
          m.status === 'finished' &&
          m.result &&
          (m.teamAId === team.id || m.teamBId === team.id),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8);
  }, [game.schedule, team.id]);

  const upcomingMatches = useMemo(() => {
    return game.schedule
      .filter(
        (m) =>
          m.status === 'scheduled' &&
          m.date >= game.currentDate &&
          (m.teamAId === team.id || m.teamBId === team.id),
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6);
  }, [game.schedule, team.id, game.currentDate]);

  const activeTournaments = useMemo(() => {
    return Object.values(game.tournaments).filter((t) => {
      const st = game.tournamentStates[t.id];
      return st && !st.finished && t.invitedTeamIds.includes(team.id);
    });
  }, [game.tournaments, game.tournamentStates, team.id]);

  const avgCA = roster.length
    ? Math.round(roster.reduce((s, p) => s + p.currentAbility, 0) / roster.length)
    : 0;
  const avgPA = roster.length
    ? Math.round(roster.reduce((s, p) => s + p.potentialAbility, 0) / roster.length)
    : 0;
  const avgAge = roster.length
    ? (roster.reduce((s, p) => s + p.age, 0) / roster.length).toFixed(1)
    : '0';

  return (
    <div className="screen">
      <h2 className="screen-title">Team Profile</h2>

      <div className="panel team-profile-hero">
        <TeamLogo team={team} size="lg" />
        <div className="team-profile-info">
          <div className="team-profile-name">
            {team.name}{' '}
            <span className="muted">({team.tag})</span>
            {team.isUser && <span className="self-pill">your club</span>}
          </div>
          <div className="team-profile-meta">
            <span>World #{team.worldRanking}</span>
            <span>·</span>
            <span>{team.region}</span>
            <span>·</span>
            <span>{money(team.budget)} budget</span>
            <span>·</span>
            <span>{team.rankingPoints} pts</span>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-title">
          Starting Lineup
          <span className="muted small"> — derived from {team.isUser ? 'your saved role slots' : "the team's first 5 by squad tier"}</span>
        </div>
        <FormationPitch
          team={team}
          slots={team.isUser ? game.tactics.roleSlots : undefined}
          compact
        />
      </div>

      <div className="team-profile-grid">
        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title">Squad <span className="muted small">— {roster.length} players · avg CA {avgCA} / PA {avgPA} · age {avgAge}</span></div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th></th>
                <th>Player</th>
                <th>Role</th>
                <th>Nat</th>
                <th>Age</th>
                <th className="num">CA</th>
                <th className="num">PA</th>
                <th className="num">Rtg</th>
                <th className="num">Wage</th>
              </tr>
            </thead>
            <tbody>
              {sortedRoster.map((p) => {
                const tag = p.squadTier === 'reserve' ? 'R' : p.squadTier === 'youth' ? 'Y' : '★';
                return (
                  <tr key={p.id}>
                    <td className="muted small">{tag}</td>
                    <td className="clickable cell-name" onClick={() => openPlayer(p.id)}>
                      <strong>{p.nickname}</strong>{' '}
                      <span className="muted small">{p.firstName} {p.lastName}</span>
                    </td>
                    <td>{p.role}</td>
                    <td className="muted">{p.nationality}</td>
                    <td>{p.age}</td>
                    <td className="num">{p.currentAbility}</td>
                    <td className="num">{p.potentialAbility}</td>
                    <td className="num">{p.stats.rating.toFixed(2)}</td>
                    <td className="num">{p.contract ? money(p.contract.wage) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-title">Map Pool</div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Map</th>
                <th className="num">Proficiency</th>
              </tr>
            </thead>
            <tbody>
              {[...team.mapPool]
                .sort((a, b) => b.proficiency - a.proficiency)
                .map((m) => (
                  <tr key={m.map}>
                    <td>{m.map}</td>
                    <td className="num">{m.proficiency}/20</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-title">Recent Results</div>
          {recentMatches.length === 0 ? (
            <div className="muted small">No matches played yet.</div>
          ) : (
            <table className="table table-dense">
              <tbody>
                {recentMatches.map((m) => {
                  const opp = m.teamAId === team.id ? game.teams[m.teamBId] : game.teams[m.teamAId];
                  const won = m.result?.winnerId === team.id;
                  const mapsA = m.result?.mapsA ?? 0;
                  const mapsB = m.result?.mapsB ?? 0;
                  const userScore = m.teamAId === team.id ? mapsA : mapsB;
                  const oppScore = m.teamAId === team.id ? mapsB : mapsA;
                  return (
                    <tr key={m.id}>
                      <td className="muted small">{fmtShortDate(m.date)}</td>
                      <td>{opp?.name ?? '?'}</td>
                      <td className="muted small">{m.roundLabel}</td>
                      <td className={won ? 'text-win' : 'text-loss'}>
                        {won ? 'W' : 'L'} {userScore}-{oppScore}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">Upcoming</div>
          {upcomingMatches.length === 0 ? (
            <div className="muted small">No matches scheduled.</div>
          ) : (
            <table className="table table-dense">
              <tbody>
                {upcomingMatches.map((m) => {
                  const opp = m.teamAId === team.id ? game.teams[m.teamBId] : game.teams[m.teamAId];
                  const tournament = game.tournaments[m.tournamentId];
                  return (
                    <tr key={m.id}>
                      <td className="muted small">{fmtShortDate(m.date)}</td>
                      <td>vs {opp?.name ?? '?'}</td>
                      <td className="muted small">{tournament?.name}</td>
                      <td className="muted small">{m.roundLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">Active Tournaments</div>
          {activeTournaments.length === 0 ? (
            <div className="muted small">Not currently in any active tournament.</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {activeTournaments.map((t) => (
                <button
                  key={t.id}
                  className="clickable"
                  style={{ background: 'none', border: 'none', textAlign: 'left', padding: '4px 0', color: 'var(--text)' }}
                  onClick={() => openTournament(t.id)}
                >
                  <strong>{t.name}</strong>{' '}
                  <span className="muted small">— {t.tier}-Tier · {money(t.prizePool)} pool</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
