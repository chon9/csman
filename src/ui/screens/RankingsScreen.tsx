import { useGame } from '../../store/gameStore';
import { TeamLink } from '../TeamLink';

export default function RankingsScreen() {
  const game = useGame((s) => s.game)!;
  const teams = Object.values(game.teams).sort((a, b) => a.worldRanking - b.worldRanking);

  return (
    <div className="screen">
      <h2 className="screen-title">World Rankings</h2>
      <div className="panel table-panel">
        <table className="table table-dense">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th>Tag</th>
              <th>Region</th>
              <th className="num">Points</th>
              <th className="num">Reputation</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id} className={t.id === game.userTeamId ? 'row-user' : ''}>
                <td>{t.worldRanking}</td>
                <td><TeamLink team={t} /></td>
                <td className="muted">{t.tag}</td>
                <td>{t.region}</td>
                <td className="num">{t.rankingPoints}</td>
                <td className="num">{t.reputation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
