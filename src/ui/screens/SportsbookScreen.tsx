// Bc Gaming — manager-side esports sportsbook. Pick a match from the schedule
// (incl. AI vs AI), stake from the personal stash at locked odds, settle when
// the match resolves.

import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { decimalOdds, isBettable } from '../../sim/sportsbook';
import type { ScheduledMatch, SportsbookBet } from '../../types';
import { TeamLogo } from '../TeamLogo';
import { fmtShortDate, money } from '../util';

type Window = 'today' | 'week' | 'all';

export default function SportsbookScreen() {
  const game = useGame((s) => s.game)!;
  const placeBet = useGame((s) => s.placeBet);
  const cancelBet = useGame((s) => s.cancelBet);

  const stash = game.managerStash ?? 0;
  const bets = game.sportsbookBets ?? [];

  const [windowFilter, setWindowFilter] = useState<Window>('week');
  const [stakeByMatch, setStakeByMatch] = useState<Record<string, number>>({});

  const upcoming = useMemo(() => {
    const today = game.currentDate;
    const weekOut = addDays(today, 7);
    return game.schedule
      .filter((m) => isBettable(m, today))
      .filter((m) => {
        if (windowFilter === 'today') return m.date === today;
        if (windowFilter === 'week') return m.date <= weekOut;
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 80); // cap render
  }, [game.schedule, game.currentDate, windowFilter]);

  const pending = bets.filter((b) => b.status === 'pending');
  const settled = bets
    .filter((b) => b.status !== 'pending')
    .sort((a, b) => (b.settledOn ?? '').localeCompare(a.settledOn ?? ''))
    .slice(0, 30);

  const pendingByMatchId = useMemo(() => {
    const m = new Map<string, SportsbookBet>();
    for (const b of pending) m.set(b.matchId, b);
    return m;
  }, [pending]);

  const stats = useMemo(() => {
    let staked = 0, returned = 0, wins = 0;
    for (const b of bets) {
      if (b.status === 'lost') staked += b.stake;
      else if (b.status === 'won') { staked += b.stake; returned += (b.payout ?? 0); wins++; }
    }
    const settledCount = bets.filter((b) => b.status !== 'pending').length;
    const net = returned - staked;
    return { staked, returned, net, wins, settledCount };
  }, [bets]);

  function setStake(matchId: string, value: number) {
    setStakeByMatch((prev) => ({ ...prev, [matchId]: Math.max(0, Math.floor(value)) }));
  }

  function onPlace(m: ScheduledMatch, pickedTeamId: string) {
    const stake = stakeByMatch[m.id] ?? 0;
    if (stake <= 0 || stake > stash) return;
    const placed = placeBet(m.id, pickedTeamId, stake);
    if (placed) setStakeByMatch((prev) => ({ ...prev, [m.id]: 0 }));
  }

  return (
    <div className="screen">
      <h2 className="screen-title">Bc Gaming · Esports Sportsbook</h2>

      <div className="bcg-header panel">
        <div>
          <div className="muted small">Personal Stash</div>
          <div className="cases-stash">{money(stash)}</div>
        </div>
        <div className="bcg-stats">
          <div>
            <div className="muted small">Active bets</div>
            <div className="bcg-stat-val">{pending.length}</div>
          </div>
          <div>
            <div className="muted small">Settled</div>
            <div className="bcg-stat-val">{stats.settledCount}</div>
          </div>
          <div>
            <div className="muted small">Hit rate</div>
            <div className="bcg-stat-val">
              {stats.settledCount > 0 ? `${Math.round((stats.wins / stats.settledCount) * 100)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="muted small">Net P/L</div>
            <div className={`bcg-stat-val ${stats.net > 0 ? 'text-win' : stats.net < 0 ? 'text-loss' : ''}`}>
              {stats.net >= 0 ? '+' : ''}{money(stats.net)}
            </div>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="panel">
          <div className="panel-title">Active Bets <span className="badge">{pending.length}</span></div>
          <table className="table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Pick</th>
                <th>Odds</th>
                <th className="num">Stake</th>
                <th className="num">To Win</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((b) => {
                const sched = game.schedule.find((m) => m.id === b.matchId);
                const stillCancellable = sched ? isBettable(sched, game.currentDate) : false;
                return (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.teamATag}</strong> vs <strong>{b.teamBTag}</strong>{' '}
                      <span className="muted small">— {b.tournamentName} · {b.roundLabel}</span>
                    </td>
                    <td><strong>{b.pickedTeamTag}</strong></td>
                    <td>{b.odds.toFixed(2)}</td>
                    <td className="num">{money(b.stake)}</td>
                    <td className="num">{money(b.potentialPayout)}</td>
                    <td className="muted small">{sched ? `Plays ${fmtShortDate(sched.date)}` : 'pending'}</td>
                    <td>
                      {stillCancellable && (
                        <button className="btn" onClick={() => cancelBet(b.id)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">
          Upcoming Matches
          <div className="bcg-window-row">
            {(['today', 'week', 'all'] as Window[]).map((w) => (
              <button
                key={w}
                className={`chip ${windowFilter === w ? 'active' : ''}`}
                onClick={() => setWindowFilter(w)}
              >
                {w === 'today' ? 'Today' : w === 'week' ? 'Next 7d' : 'All'}
              </button>
            ))}
          </div>
        </div>
        {upcoming.length === 0 ? (
          <div className="muted">No matches in this window.</div>
        ) : (
          <div className="bcg-matches">
            {upcoming.map((m) => {
              const teamA = game.teams[m.teamAId];
              const teamB = game.teams[m.teamBId];
              if (!teamA || !teamB) return null;
              const { oddsA, oddsB } = decimalOdds(game, teamA, teamB);
              const tournament = game.tournaments[m.tournamentId];
              const stake = stakeByMatch[m.id] ?? 0;
              const alreadyBet = pendingByMatchId.has(m.id);
              const userInMatch = m.teamAId === game.userTeamId || m.teamBId === game.userTeamId;
              return (
                <div key={m.id} className={`bcg-match-row ${alreadyBet ? 'has-bet' : ''}`}>
                  <div className="bcg-match-meta">
                    <span className="bcg-match-date">{fmtShortDate(m.date)}</span>
                    <span className="muted small">{tournament?.name ?? m.tournamentId}</span>
                    <span className="muted small">· {m.roundLabel}</span>
                    <span className="muted small">· {m.format}</span>
                    {userInMatch && <span className="bcg-self-pill">your match</span>}
                  </div>
                  <div className="bcg-match-grid">
                    <button
                      className="bcg-pick"
                      disabled={alreadyBet || stake <= 0 || stake > stash}
                      onClick={() => onPlace(m, teamA.id)}
                    >
                      <div className="bcg-pick-left">
                        <TeamLogo team={teamA} size="sm" />
                        <span className="bcg-pick-tag">{teamA.tag}</span>
                        <span className="muted small">#{teamA.worldRanking}</span>
                      </div>
                      <span className="bcg-pick-odds">{oddsA.toFixed(2)}</span>
                    </button>
                    <button
                      className="bcg-pick"
                      disabled={alreadyBet || stake <= 0 || stake > stash}
                      onClick={() => onPlace(m, teamB.id)}
                    >
                      <div className="bcg-pick-left">
                        <TeamLogo team={teamB} size="sm" />
                        <span className="bcg-pick-tag">{teamB.tag}</span>
                        <span className="muted small">#{teamB.worldRanking}</span>
                      </div>
                      <span className="bcg-pick-odds">{oddsB.toFixed(2)}</span>
                    </button>
                  </div>
                  {alreadyBet ? (
                    <div className="muted small bcg-already">Bet placed — see Active Bets above.</div>
                  ) : (
                    <div className="bcg-stake-row">
                      <input
                        className="input bcg-stake-input"
                        type="number"
                        min={0}
                        max={stash}
                        step={1000}
                        value={stake || ''}
                        onChange={(e) => setStake(m.id, Number(e.target.value))}
                        placeholder="Stake"
                      />
                      <div className="bcg-stake-shortcuts">
                        {[1000, 5000, 25000, 'max'].map((v) => (
                          <button
                            key={v}
                            className="chip tiny"
                            onClick={() => setStake(m.id, v === 'max' ? Math.min(stash, 100_000) : (v as number))}
                          >
                            {v === 'max' ? 'Max' : money(v as number)}
                          </button>
                        ))}
                      </div>
                      <div className="muted small">
                        To win: {money(Math.round((stake || 0) * Math.max(oddsA, oddsB)))}
                        {' '}<span className="muted">(varies by pick)</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {settled.length > 0 && (
        <div className="panel">
          <div className="panel-title">Bet History <span className="muted small">— last {settled.length}</span></div>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Match</th>
                <th>Pick</th>
                <th>Odds</th>
                <th className="num">Stake</th>
                <th className="num">Payout</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {settled.map((b) => (
                <tr key={b.id}>
                  <td className="muted small">{fmtShortDate(b.settledOn ?? b.placedOn)}</td>
                  <td>
                    {b.teamATag} vs {b.teamBTag} <span className="muted small">— {b.tournamentName}</span>
                  </td>
                  <td><strong>{b.pickedTeamTag}</strong></td>
                  <td>{b.odds.toFixed(2)}</td>
                  <td className="num">{money(b.stake)}</td>
                  <td className={`num ${b.status === 'won' ? 'text-win' : ''}`}>{money(b.payout ?? 0)}</td>
                  <td className={b.status === 'won' ? 'text-win' : b.status === 'lost' ? 'text-loss' : 'muted'}>
                    {b.status === 'won' ? 'Won' : b.status === 'lost' ? 'Lost' : 'Void'}
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

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
