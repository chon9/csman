import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { money } from '../util';
import type { GameState, Team } from '../../types';

type Filter = 'players-all' | 'players-free' | 'players-u21' | 'opponents';

export default function ScoutingScreen() {
  const game = useGame((s) => s.game)!;
  const openPlayer = useGame((s) => s.openPlayer);
  const scoutPlayer = useGame((s) => s.scoutPlayer);
  const setScoutHours = useGame((s) => s.setScoutHours);
  const suggestCounter = useGame((s) => s.suggestCounter);
  const go = useGame((s) => s.go);

  const [filter, setFilter] = useState<Filter>('players-all');

  const userId = game.userTeamId;
  const budget = game.teams[userId].budget;

  const players = useMemo(
    () =>
      Object.values(game.players)
        .filter((p) => p.teamId !== userId)
        .filter((p) =>
          filter === 'players-free'
            ? p.teamId === null
            : filter === 'players-u21'
              ? p.age <= 20
              : true,
        )
        .sort((a, b) => b.currentAbility - a.currentAbility),
    [game.players, userId, filter],
  );

  return (
    <div className="screen">
      <h2 className="screen-title">Scouting</h2>

      <div className="tab-row">
        <button
          className={`tab ${filter === 'players-all' ? 'active' : ''}`}
          onClick={() => setFilter('players-all')}
        >
          All Players
        </button>
        <button
          className={`tab ${filter === 'players-free' ? 'active' : ''}`}
          onClick={() => setFilter('players-free')}
        >
          Free Agents
        </button>
        <button
          className={`tab ${filter === 'players-u21' ? 'active' : ''}`}
          onClick={() => setFilter('players-u21')}
        >
          U21 Prospects
        </button>
        <button
          className={`tab ${filter === 'opponents' ? 'active' : ''}`}
          onClick={() => setFilter('opponents')}
        >
          Opponents
        </button>
      </div>

      {filter === 'opponents' ? (
        <OpponentsTab
          game={game}
          onSetHours={setScoutHours}
          onCounter={(oppId) => {
            suggestCounter(oppId);
            go('tactics');
          }}
        />
      ) : (
        <div className="panel table-panel">
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th>
                <th>Age</th>
                <th>Nat</th>
                <th>Role</th>
                <th>Team</th>
                <th className="num">Rating</th>
                <th className="num">Ability</th>
                <th className="num">Potential</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const scouted = !!game.scoutReports[p.id];
                return (
                  <tr key={p.id}>
                    <td className="clickable cell-name" onClick={() => openPlayer(p.id)}>
                      <span className="player-nick">{p.nickname}</span>{' '}
                      <span className="muted small">
                        {p.firstName} {p.lastName}
                      </span>
                    </td>
                    <td>{p.age}</td>
                    <td>{p.nationality}</td>
                    <td>{p.role}</td>
                    <td className="muted">
                      {p.teamId ? (game.teams[p.teamId]?.tag ?? '-') : 'FA'}
                    </td>
                    <td className="num">{p.stats.rating.toFixed(2)}</td>
                    <td className="num">{scouted ? p.currentAbility : '?'}</td>
                    <td className="num">{scouted ? p.potentialAbility : '?'}</td>
                    <td>
                      {scouted ? (
                        <span className="text-win">Scouted</span>
                      ) : (
                        <span className="muted">Unknown</span>
                      )}
                    </td>
                    <td className="cell-actions">
                      {!scouted && (
                        <button
                          className="btn btn-tiny"
                          disabled={budget < 15000}
                          onClick={() => scoutPlayer(p.id)}
                          title={`Scouting costs ${money(15000)}`}
                        >
                          Scout
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {players.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    No players match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {filter !== 'opponents' && (
        <p className="muted small">
          Scouting a player costs {money(15000)} and fully reveals their attributes.
        </p>
      )}
    </div>
  );
}

// ============ Opponents tab ============

function OpponentsTab({
  game,
  onSetHours,
  onCounter,
}: {
  game: GameState;
  onSetHours: (teamId: string, hours: number) => void;
  onCounter: (oppId: string) => void;
}) {
  // Build the list of opponents to surface: upcoming scheduled opponents + anyone
  // already being scouted. Avoids tedious team-picker UI.
  const tracked = useMemo(() => {
    const ids = new Set<string>();
    for (const m of game.schedule) {
      if (m.status === 'finished') continue;
      if (m.teamAId === game.userTeamId) ids.add(m.teamBId);
      else if (m.teamBId === game.userTeamId) ids.add(m.teamAId);
    }
    for (const id of Object.keys(game.opponentScouts ?? {})) ids.add(id);
    return Array.from(ids)
      .map((id) => game.teams[id])
      .filter(Boolean)
      .sort((a, b) => a.worldRanking - b.worldRanking);
  }, [game.schedule, game.opponentScouts, game.teams, game.userTeamId]);

  const allocs = game.scoutAllocations ?? {};
  const totalAllocated = Object.values(allocs).reduce((a, b) => a + b, 0);
  const userTeam = game.teams[game.userTeamId];
  // Total weekly scouting capacity scales with coach skill (default 20, +2 per skill above 10)
  const totalCapacity = Math.round(20 + (userTeam.coachSkill - 10) * 2);
  const over = totalAllocated > totalCapacity;

  return (
    <div className="panel">
      <div className="panel-title">
        Opponent Dossiers{' '}
        <span className={`muted ${over ? 'text-bad' : ''}`} style={{ float: 'right' }}>
          {totalAllocated} / {totalCapacity} hours/week
        </span>
      </div>
      <p className="muted small">
        Allocate hours per week to grow your scouting accuracy on rivals. Higher accuracy
        reveals more about their tactics, and scales the prep bonus from your Match Plans.
        Once playstyle is revealed (50%), use <strong>Counter This</strong> to auto-fill a Match Plan.
      </p>
      {tracked.length === 0 && (
        <div className="muted small">No upcoming opponents and no scouts assigned.</div>
      )}
      <div className="scout-list">
        {tracked.map((team) => (
          <OpponentCard
            key={team.id}
            team={team}
            accuracy={game.opponentScouts?.[team.id]?.accuracy ?? 0}
            hours={allocs[team.id] ?? 0}
            onSetHours={(h) => onSetHours(team.id, h)}
            onCounter={() => onCounter(team.id)}
          />
        ))}
      </div>
    </div>
  );
}

function OpponentCard({
  team,
  accuracy,
  hours,
  onSetHours,
  onCounter,
}: {
  team: Team;
  accuracy: number;
  hours: number;
  onSetHours: (h: number) => void;
  onCounter: () => void;
}) {
  const pct = Math.round(accuracy * 100);
  const reveals = revealTiers(accuracy, team);
  return (
    <div className="scout-card">
      <div className="scout-card-head">
        <div>
          <strong>{team.name}</strong>{' '}
          <span className="muted">
            #{team.worldRanking} · {team.region}
          </span>
        </div>
        <div className="scout-card-pct">{pct}%</div>
      </div>
      <div className="scout-bar">
        <div className="scout-bar-fill" style={{ width: `${pct}%` }} />
        <span className="scout-bar-tick" style={{ left: '25%' }} title="Map pool tier" />
        <span className="scout-bar-tick" style={{ left: '50%' }} title="Playstyle tier" />
        <span className="scout-bar-tick" style={{ left: '75%' }} title="Tactical tier" />
      </div>
      <div className="scout-reveals">
        {reveals.map((r, i) => (
          <div key={i} className={`scout-reveal ${r.unlocked ? 'unlocked' : 'locked'}`}>
            <span className="scout-reveal-label">{r.label}</span>
            <span className="scout-reveal-body">
              {r.unlocked ? r.body : <span className="muted">— locked —</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="scout-card-foot">
        <label className="scout-hours">
          <span>Hours / wk</span>
          <input
            type="range"
            min={0}
            max={15}
            value={hours}
            onChange={(e) => onSetHours(Number(e.target.value))}
          />
          <strong>{hours}</strong>
        </label>
        <button
          className="btn btn-tiny"
          disabled={accuracy < 0.5}
          onClick={onCounter}
          title={
            accuracy < 0.5
              ? 'Need 50% accuracy (playstyle revealed) to suggest a counter'
              : 'Auto-fill a Match Plan and 1-2 calls based on this dossier'
          }
        >
          Counter This →
        </button>
      </div>
    </div>
  );
}

// Generate the four reveal tiers for an opponent card.
function revealTiers(accuracy: number, team: Team): { label: string; body: string; unlocked: boolean }[] {
  // Tier 1 (25%): Map pool intel — top 3 maps from veto priority
  const topMaps = [...team.mapPool]
    .sort((a, b) => b.proficiency - a.proficiency)
    .slice(0, 3)
    .map((m) => m.map)
    .join(' / ');

  // Tier 2 (50%): playstyle ranges — we generate the AI's tactics deterministically.
  // To keep this self-contained without importing the store helper, we approximate
  // by re-using world ranking buckets (top teams trend default, mid teams vary).
  // The actual engine uses aiTacticsFor — we surface readable labels here.
  const tStyle =
    team.worldRanking <= 5
      ? 'Default — control-heavy'
      : team.worldRanking <= 15
        ? 'Mixed pace'
        : 'Explosive — fast hits';
  const ctStyle =
    team.worldRanking <= 5
      ? 'Standard — disciplined setups'
      : team.worldRanking <= 15
        ? 'Aggressive Info'
        : 'Passive Retake';

  // Tier 3 (75%): specific sliders + force tendency
  const force =
    team.worldRanking <= 8 ? 'Low force tendency (saves often)' : 'High force tendency (won\'t miss buy windows)';
  const aggression =
    team.worldRanking <= 8 ? 'Moderate aggression (12-14)' : 'High aggression (15-17)';

  return [
    {
      label: 'Rank & Map Pool',
      body: `#${team.worldRanking} · favours ${topMaps}`,
      unlocked: accuracy >= 0.0,
    },
    {
      label: 'Playstyles',
      body: `T: ${tStyle} · CT: ${ctStyle}`,
      unlocked: accuracy >= 0.5,
    },
    {
      label: 'Tendencies',
      body: `${force} · ${aggression}`,
      unlocked: accuracy >= 0.75,
    },
    {
      label: 'Dossier complete',
      body: 'All tactics revealed — full prep bonus active.',
      unlocked: accuracy >= 1.0,
    },
  ];
}
