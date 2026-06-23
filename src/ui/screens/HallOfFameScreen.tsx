// Hall of Fame — historical retirees with their career snapshots.
// Sorted by HOF score (composite of trophies + rating + longevity + awards).

import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import type { PlayerRole } from '../../types';

const ROLE_FILTERS: ('all' | PlayerRole)[] = ['all', 'IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler'];

export default function HallOfFameScreen() {
  const game = useGame((s) => s.game)!;
  const hof = game.hallOfFame ?? [];
  const [roleFilter, setRoleFilter] = useState<(typeof ROLE_FILTERS)[number]>('all');
  const [sortBy, setSortBy] = useState<'hof' | 'rating' | 'year' | 'honours'>('hof');

  const filtered = useMemo(() => {
    const arr = hof.filter((e) => roleFilter === 'all' || e.role === roleFilter);
    arr.sort((a, b) => {
      switch (sortBy) {
        case 'rating': return b.careerRating - a.careerRating;
        case 'year': return b.retiredYear - a.retiredYear;
        case 'honours': return b.honours.length - a.honours.length;
        default: return b.hofScore - a.hofScore;
      }
    });
    return arr;
  }, [hof, roleFilter, sortBy]);

  if (hof.length === 0) {
    return (
      <div className="screen">
        <h2 className="screen-title">Hall of Fame</h2>
        <div className="panel">
          <div className="muted">
            No retirees yet. The Hall of Fame fills up at the end of each season as veteran players step away. Develop a wonderkid into a legend and his name lives here forever.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h2 className="screen-title">Hall of Fame</h2>

      <div className="panel hof-controls">
        <div className="hof-filter-row">
          <span className="muted small">Role:</span>
          {ROLE_FILTERS.map((r) => (
            <button
              key={r}
              className={`chip ${roleFilter === r ? 'active' : ''}`}
              onClick={() => setRoleFilter(r)}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
        <div className="hof-filter-row">
          <span className="muted small">Sort:</span>
          <button className={`chip ${sortBy === 'hof' ? 'active' : ''}`} onClick={() => setSortBy('hof')}>HOF score</button>
          <button className={`chip ${sortBy === 'rating' ? 'active' : ''}`} onClick={() => setSortBy('rating')}>Career rating</button>
          <button className={`chip ${sortBy === 'honours' ? 'active' : ''}`} onClick={() => setSortBy('honours')}>Honours</button>
          <button className={`chip ${sortBy === 'year' ? 'active' : ''}`} onClick={() => setSortBy('year')}>Year retired</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">{filtered.length} {filtered.length === 1 ? 'inductee' : 'inductees'}</div>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Role</th>
              <th>Nat</th>
              <th className="num">Retired</th>
              <th className="num">Rating</th>
              <th className="num">Maps</th>
              <th className="num">Honours</th>
              <th className="num">HOF</th>
              <th>Clubs</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={e.playerId} className={e.retiredOnUserTeam ? 'row-user' : ''}>
                <td className="muted">{i + 1}</td>
                <td>
                  <strong>{e.nickname}</strong>{' '}
                  <span className="muted small">{e.fullName}</span>
                </td>
                <td>{e.role}</td>
                <td className="muted">{e.nationality}</td>
                <td className="num">{e.retiredYear}<span className="muted small"> · age {e.retiredAge}</span></td>
                <td className="num">{e.careerRating.toFixed(2)}</td>
                <td className="num">{e.careerMaps}</td>
                <td className="num">{e.honours.length}</td>
                <td className="num"><strong>{e.hofScore}</strong></td>
                <td className="muted small">{e.clubs.map((c) => c.teamName).join(' → ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
