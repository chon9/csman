import { useGame } from '../../store/gameStore';
import { money } from '../util';
import { AWARD_LABEL } from '../../sim/awards';

export default function HistoryScreen() {
  const game = useGame((s) => s.game)!;
  const history = [...(game.seasonHistory ?? [])].reverse();

  return (
    <div className="screen">
      <h2 className="screen-title">History</h2>
      {history.length === 0 && (
        <div className="panel" style={{ padding: 16, color: '#8b93a3' }}>
          No completed seasons yet. Records appear here after each season ends in December.
        </div>
      )}
      {history.map((s) => (
        <div key={s.year} className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>{s.year} Season</h3>
            <div style={{ color: '#8b93a3', fontSize: 13 }}>
              Finished world <span style={{ color: '#de9b35', fontWeight: 700 }}>#{s.userRank}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '10px 0 14px', fontSize: 13 }}>
            <div>
              <div style={{ color: '#8b93a3', fontSize: 11, letterSpacing: 1 }}>WORLD TOP 3</div>
              {s.worldTop3.map((t, i) => (
                <div key={t.teamId}>
                  {i + 1}. {t.name}
                </div>
              ))}
            </div>
            {s.playerOfSeason && (
              <div>
                <div style={{ color: '#8b93a3', fontSize: 11, letterSpacing: 1 }}>PLAYER OF THE YEAR</div>
                <div style={{ color: '#de9b35', fontWeight: 600 }}>{s.playerOfSeason.nickname}</div>
                <div style={{ color: '#8b93a3' }}>
                  {s.playerOfSeason.teamName} — {s.playerOfSeason.rating.toFixed(2)} over {s.playerOfSeason.maps} maps
                </div>
              </div>
            )}
            {s.userBestPlayer && (
              <div>
                <div style={{ color: '#8b93a3', fontSize: 11, letterSpacing: 1 }}>YOUR BEST PLAYER</div>
                <div style={{ fontWeight: 600 }}>{s.userBestPlayer.nickname}</div>
                <div style={{ color: '#8b93a3' }}>
                  {s.userBestPlayer.rating.toFixed(2)} over {s.userBestPlayer.maps} maps
                </div>
              </div>
            )}
          </div>

          {s.awards && s.awards.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#8b93a3', fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>
                🏆 SEASON AWARDS
              </div>
              <div className="honours-list">
                {s.awards.map((a) => (
                  <div key={a.kind + a.recipientId} className="honour-row">
                    <span className="honour-year">{a.year}</span>
                    <span className="honour-label">
                      {AWARD_LABEL[a.kind]} — <strong>{a.recipientName}</strong>
                      {a.teamName && <span className="muted small"> ({a.teamName})</span>}
                    </span>
                    {a.stat && <span className="muted small">{a.stat}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Tier</th>
                <th>Champion</th>
                <th>Your placement</th>
                <th>Prize won</th>
              </tr>
            </thead>
            <tbody>
              {s.events.map((e) => (
                <tr key={e.tournamentName}>
                  <td>{e.tournamentName}</td>
                  <td>{e.tier}</td>
                  <td style={{ color: e.championTeamId === s.userTeamId ? '#de9b35' : undefined, fontWeight: e.championTeamId === s.userTeamId ? 700 : 400 }}>
                    {e.championName}
                  </td>
                  <td>
                    {e.userPlacement === null ? (
                      <span style={{ color: '#5d6678' }}>not invited</span>
                    ) : e.userPlacement === 1 ? (
                      <span style={{ color: '#de9b35', fontWeight: 700 }}>CHAMPIONS</span>
                    ) : (
                      `#${e.userPlacement}`
                    )}
                  </td>
                  <td>{e.userPrize > 0 ? money(e.userPrize) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
