// Tournament lobby + bracket viewer. Anyone can create or register.
// Once registrations fill, the server runs every bracket round instantly
// and broadcasts a tournament-update with the final bracket + prizes.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import type { TournamentDetail } from '../protocol';
import ToastStack from './ToastStack';
import Icon from '../../ui/Icon';

export default function OnlineTournamentsScreen() {
  const team = useOnline((s) => s.team);
  const tournaments = useOnline((s) => s.tournaments);
  const activeTournament = useOnline((s) => s.activeTournament);
  const refresh = useOnline((s) => s.refreshTournaments);
  const create = useOnline((s) => s.createTournament);
  const register = useOnline((s) => s.registerTournament);
  const fetchDetail = useOnline((s) => s.fetchTournamentDetail);
  const go = useOnline((s) => s.go);

  const [size, setSize] = useState<4 | 8>(4);
  const [entryFee, setEntryFee] = useState(5_000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tournaments.find((t) => t.id === selectedId);

  useEffect(() => {
    refresh();
    const id = setInterval(() => refresh(), 8000);
    return () => clearInterval(id);
  }, [refresh]);

  // When the user picks a tournament to view, fetch its full bracket. Also
  // re-fetch periodically while open + watching one — catches in-progress
  // brackets that just finished.
  useEffect(() => {
    if (!selectedId) return;
    fetchDetail(selectedId);
    const id = setInterval(() => fetchDetail(selectedId), 6000);
    return () => clearInterval(id);
  }, [selectedId, fetchDetail]);

  function selectTournament(id: string): void {
    setSelectedId(id);
    fetchDetail(id);
  }

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="trophy" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Tournaments</h2>
            <div className="hero-sub">
              Single-elim brackets (4 or 8). Entry fees fund the prize pool — 60/25/7.5/7.5 split. Bracket auto-runs the moment registrations fill.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={refresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh" size={13} /> Refresh
          </button>
          <button className="btn" onClick={() => go('home')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="chevron-left" size={13} /> Back
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Open a New Tournament</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <label className="field" style={{ flex: '0 0 auto' }}>
            <span className="field-label">Size</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {([4, 8] as const).map((s) => (
                <button key={s} className={`btn btn-tiny ${size === s ? 'btn-accent' : ''}`} onClick={() => setSize(s)}>
                  {s} teams
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            <span className="field-label">Entry fee ${entryFee.toLocaleString()}</span>
            <input
              type="range"
              min={0}
              max={20_000}
              step={500}
              value={entryFee}
              onChange={(e) => setEntryFee(Number(e.target.value))}
            />
          </label>
          <button className="btn btn-accent" onClick={() => create(size, entryFee)}>
            Create
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Open + Recent</div>
        {tournaments.length === 0 ? (
          <div className="muted small">No tournaments yet — open the first one above.</div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th className="num">Entry</th>
                <th className="num">Pool</th>
                <th>Status</th>
                <th>Filled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id} className={t.id === selectedId ? 'row-user' : ''}>
                  <td><strong>{t.name}</strong></td>
                  <td>{t.size}</td>
                  <td className="num">${t.entryFee.toLocaleString()}</td>
                  <td className="num">${t.prizePool.toLocaleString()}</td>
                  <td>
                    <span className={`status-chip status-${t.status === 'open' ? 'open' : t.status === 'in-progress' ? 'connecting' : 'closed'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="muted small">{t.registered}/{t.size}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-tiny" onClick={() => selectTournament(t.id)}>View</button>
                    {t.status === 'open' && !t.iAmIn && (
                      <button
                        className="btn btn-tiny btn-accent"
                        disabled={team.money < t.entryFee || team.playerIds.length < 5}
                        onClick={() => register(t.id)}
                        title={team.money < t.entryFee ? 'Insufficient funds' : team.playerIds.length < 5 ? 'Need 5 players' : ''}
                      >
                        Register
                      </button>
                    )}
                    {t.iAmIn && <span className="muted small">✓ registered</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <BracketPanel
          tournament={
            // The lobby list has the summary fields; the bracket is on
            // activeTournament after a tournament-detail message lands.
            activeTournament?.id === selected.id
              ? activeTournament
              : { ...selected, bracket: [] }
          }
        />
      )}

      <ToastStack />
    </div>
  );
}

function BracketPanel({ tournament }: { tournament: TournamentDetail }) {
  const rounds = Array.from(new Set(tournament.bracket.map((b) => b.round))).sort((a, b) => a - b);
  const team = useOnline((s) => s.team);
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title">
        {tournament.name} — Bracket
        {tournament.status === 'finished' && <span className="muted small"> · finished</span>}
      </div>
      {rounds.length === 0 ? (
        <div className="muted small">
          {tournament.status === 'open'
            ? `Bracket builds once the field fills (${tournament.registered}/${tournament.size} so far).`
            : 'Loading bracket…'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingTop: 8 }}>
          {rounds.map((r) => (
            <div key={r} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
              <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                {r === rounds[rounds.length - 1] ? 'Final' : r === rounds[rounds.length - 2] ? 'Semis' : `Round ${r + 1}`}
              </div>
              {tournament.bracket.filter((b) => b.round === r).map((m, i) => (
                <BracketCard key={`${r}-${i}`} match={m} myTeamId={team?.id ?? null} />
              ))}
            </div>
          ))}
        </div>
      )}
      {tournament.prizes && tournament.prizes.length > 0 && (
        <div className="muted small" style={{ marginTop: 12, padding: 8, background: 'var(--panel-2)', borderRadius: 4 }}>
          <strong>Payouts:</strong>{' '}
          {tournament.prizes.map((p) => `${p.teamTag} ${placeIcon(p.placement)} $${p.cash.toLocaleString()}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function placeIcon(n: number): string {
  if (n === 1) return '🏆';
  if (n === 2) return '🥈';
  if (n === 3) return '🥉';
  return `#${n}`;
}

function BracketCard({ match, myTeamId }: { match: { teamATag?: string; teamBTag?: string; teamAId: string | null; teamBId: string | null; winnerId?: string; mapsA?: number; mapsB?: number }; myTeamId: string | null }) {
  const aIsMe = match.teamAId === myTeamId;
  const bIsMe = match.teamBId === myTeamId;
  const aWon = match.winnerId && match.winnerId === match.teamAId;
  const bWon = match.winnerId && match.winnerId === match.teamBId;
  return (
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4, padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: aWon ? 700 : 400, color: aIsMe ? 'var(--accent)' : undefined }}>
        <span>{match.teamATag ?? <span className="muted">TBD</span>}</span>
        <span className="num">{match.mapsA ?? '—'}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bWon ? 700 : 400, color: bIsMe ? 'var(--accent)' : undefined }}>
        <span>{match.teamBTag ?? <span className="muted">TBD</span>}</span>
        <span className="num">{match.mapsB ?? '—'}</span>
      </div>
    </div>
  );
}
