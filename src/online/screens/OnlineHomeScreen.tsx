// Online-mode home — Phase 2 adds a duel pad (stake + format + register
// button), a time-skip control, and routes to the marketplace. Duel results
// arrive as a modal overlay; toasts cover time-skip + market success.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  MAX_DUEL_STAKE,
  MAX_TIME_SKIP_DAYS,
  MIN_DUEL_STAKE,
  TIME_SKIP_COST_PER_DAY,
} from '../protocol';
import type { MatchFormat } from '../../types';
import DuelResultModal from './DuelResultModal';
import ToastStack from './ToastStack';
import ChatWidget from './ChatWidget';
import DevReportModal from './DevReportModal';
import LiveFeedWidget from './LiveFeedWidget';
import GoalEditorModal from './GoalEditorModal';
import NewsTicker from './NewsTicker';
import AchievementsPanel from './AchievementsPanel';
import LoanOffersPanel from './LoanOffersPanel';
import ProfileEditorModal from './ProfileEditorModal';
import LoanOfferModal from './LoanOfferModal';
import CoachesPanel from './CoachesPanel';
import SponsorsPanel from './SponsorsPanel';
import { publicOrigin } from '../serverUrl';
import type { Player } from '../../types';

export default function OnlineHomeScreen() {
  const team = useOnline((s) => s.team);
  const players = useOnline((s) => s.players);
  const status = useOnline((s) => s.status);
  const duelPending = useOnline((s) => s.duelPending);
  const skipPending = useOnline((s) => s.skipPending);
  const duelResult = useOnline((s) => s.duelResult);
  const refresh = useOnline((s) => s.refreshState);
  const disconnect = useOnline((s) => s.disconnect);
  const spawnInitialRoster = useOnline((s) => s.spawnInitialRoster);
  const isAdmin = useOnline((s) => s.isAdmin);
  const registerAiDuel = useOnline((s) => s.registerAiDuel);
  const timeSkip = useOnline((s) => s.timeSkip);
  const go = useOnline((s) => s.go);

  const [stake, setStake] = useState(5_000);
  const [format, setFormat] = useState<MatchFormat>('BO1');
  const [skipDays, setSkipDays] = useState(7);
  const [scrimMode, setScrimMode] = useState(false);
  const [goalPlayer, setGoalPlayer] = useState<Player | null>(null);
  const [loanPlayer, setLoanPlayer] = useState<Player | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const goals = useOnline((s) => s.playerGoals);
  const refreshGoals = useOnline((s) => s.refreshGoals);
  const exportTeam = useOnline((s) => s.exportTeam);
  const onlineTeams = useOnline((s) => s.onlineTeams);

  useEffect(() => {
    const id = setInterval(() => refresh(), 8000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => { refreshGoals(); }, [refreshGoals]);

  if (!team) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <div className="panel"><div className="muted">Loading team…</div></div>
      </div>
    );
  }

  const roster = team.playerIds
    .map((id) => players[id])
    .filter((p): p is NonNullable<typeof p> => !!p);

  const avgCA = roster.length
    ? Math.round(roster.reduce((s, p) => s + p.currentAbility, 0) / roster.length)
    : 0;
  const avgPA = roster.length
    ? Math.round(roster.reduce((s, p) => s + p.potentialAbility, 0) / roster.length)
    : 0;
  const avgAge = roster.length
    ? (roster.reduce((s, p) => s + p.age, 0) / roster.length).toFixed(1)
    : '0';

  const skipCost = skipDays * TIME_SKIP_COST_PER_DAY;
  const effectiveStake = scrimMode ? 0 : stake;
  const canDuel = !duelPending && roster.length >= 5 && (scrimMode || team.money >= stake);
  const canSkip = !skipPending && team.money >= skipCost;

  // Public profile URL resolved via the shared origin helper so it works
  // both for HTTPS-behind-Caddy deploys and raw-IP dev setups.
  const profileUrl = `${publicOrigin()}/team/${team.id}`;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <NewsTicker />
      <div className="panel" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="team-logo team-logo-lg team-logo-placeholder">{team.tag.slice(0, 2)}</div>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>
              <span style={{ color: 'var(--accent)' }}>{team.tag}</span> · {team.name}
            </h2>
            <div className="muted small">
              {team.region} · owner <strong>{team.ownerNick}</strong> · day {team.day}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className={`status-chip status-${status}`}>{status}</span>
          <span
            className="status-chip status-open"
            title={`${onlineTeams} team${onlineTeams === 1 ? '' : 's'} currently connected to this server`}
            style={{ background: 'rgba(76,175,125,0.18)' }}
          >
            👥 {onlineTeams} online
          </span>
          <button className="btn" onClick={refresh}>Refresh</button>
          <button className="btn" onClick={() => { go('tactics'); }}>Tactics</button>
          <button className="btn" onClick={() => { go('challenges'); }}>PvP Lobby</button>
          <button className="btn" onClick={() => { go('tournaments'); }}>Tournaments</button>
          <button className="btn" onClick={() => { go('market'); }}>Market</button>
          <button className="btn" onClick={() => { go('leaderboard'); }}>Leaderboard</button>
          <button className="btn" onClick={() => { go('history'); }}>History</button>
          {isAdmin && (
            <button
              className="btn"
              onClick={() => { go('admin'); }}
              title="Admin console — manage users, reset PINs, edit teams"
              style={{ background: 'rgba(242,161,60,0.18)' }}
            >
              🛠 Admin
            </button>
          )}
          <button className="btn" onClick={exportTeam} title="Download your team as a portable JSON file">Export</button>
          <button className="btn" onClick={() => setProfileOpen(true)} title="Edit bio, color, social links">Edit Profile</button>
          <button
            className="btn"
            onClick={() => { navigator.clipboard?.writeText(profileUrl); }}
            title={`Copy public team page URL: ${profileUrl}`}
          >🔗 Profile</button>
          <button
            className="btn"
            title="Open server-wide Hall of Fame in a new tab"
            onClick={() => { if (typeof window !== 'undefined') window.open(`${publicOrigin()}/hof`, '_blank'); }}
          >🏛 HoF</button>
          <button
            className="btn"
            title="Open server-wide stats in a new tab"
            onClick={() => { if (typeof window !== 'undefined') window.open(`${publicOrigin()}/stats`, '_blank'); }}
          >📊 Stats</button>
          <button className="btn btn-danger" onClick={disconnect}>Disconnect</button>
        </div>
      </div>

      <div className="online-stat-grid">
        <StatCard label="Cash" value={`$${team.money.toLocaleString()}`} />
        <StatCard label="Roster" value={`${roster.length} / ${team.playerIds.length || 5}`} />
        <StatCard label="Avg CA" value={String(avgCA)} />
        <StatCard label="Avg PA" value={String(avgPA)} />
        <StatCard label="Avg age" value={avgAge} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* ===== Duel pad ===== */}
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Register Duel <span className="muted small">— vs scaled AI</span></div>
          <p className="muted small" style={{ marginTop: 2 }}>
            AI opponent is generated with avg CA close to yours (±10). Win takes the stake; lose pays it.
            Scrim mode = no money, no leaderboard, half aftermath — pure practice.
          </p>
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={`btn ${!scrimMode ? 'btn-accent' : ''}`}
                onClick={() => setScrimMode(false)}
              >Ranked</button>
              <button
                type="button"
                className={`btn ${scrimMode ? 'btn-accent' : ''}`}
                onClick={() => setScrimMode(true)}
              >Scrim (free)</button>
            </div>
            <label className="field" style={{ opacity: scrimMode ? 0.4 : 1 }}>
              <span className="field-label">Stake ${stake.toLocaleString()}{scrimMode ? ' · IGNORED in scrim' : ''}</span>
              <input
                type="range"
                min={MIN_DUEL_STAKE}
                max={MAX_DUEL_STAKE}
                step={500}
                value={stake}
                disabled={scrimMode}
                onChange={(e) => setStake(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">Format</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['BO1', 'BO3', 'BO5'] as MatchFormat[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`btn ${format === f ? 'btn-accent' : ''}`}
                    onClick={() => setFormat(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </label>
            <button
              className="btn btn-accent"
              disabled={!canDuel}
              onClick={() => registerAiDuel(effectiveStake, format)}
              title={roster.length < 5 ? 'Need 5 players' : !canDuel ? 'Insufficient funds' : ''}
            >
              {duelPending
                ? 'Simulating…'
                : scrimMode
                  ? 'Run Scrim (free)'
                  : `Duel for $${stake.toLocaleString()}`}
            </button>
          </div>
        </div>

        {/* ===== Time-skip ===== */}
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Advance Time <span className="muted small">— pay to train</span></div>
          <p className="muted small" style={{ marginTop: 2 }}>
            Fast-forward your team clock. Each week boundary runs a weekly training tick (gains, possible regressions).
            ${TIME_SKIP_COST_PER_DAY}/day · max {MAX_TIME_SKIP_DAYS} days/skip.
          </p>
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            <label className="field">
              <span className="field-label">Days {skipDays}</span>
              <input
                type="range"
                min={1}
                max={MAX_TIME_SKIP_DAYS}
                step={1}
                value={skipDays}
                onChange={(e) => setSkipDays(Number(e.target.value))}
              />
            </label>
            <div className="muted small">
              Cost: <strong>${skipCost.toLocaleString()}</strong> · runs ~{Math.floor(skipDays / 7)} weekly training tick{Math.floor(skipDays / 7) === 1 ? '' : 's'}
            </div>
            <button
              className="btn btn-accent"
              disabled={!canSkip}
              onClick={() => timeSkip(skipDays)}
              title={team.money < skipCost ? 'Insufficient funds' : ''}
            >
              {skipPending ? 'Advancing…' : `Skip ${skipDays} day${skipDays === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Roster</div>
        {roster.length === 0 ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="muted small">
              No players yet. If you just created the team this should fill in a moment — otherwise the initial spawn never completed.
            </div>
            <button className="btn btn-accent btn-tiny" onClick={spawnInitialRoster}>
              Spawn roster
            </button>
          </div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th>Nat</th>
                <th>Age</th>
                <th className="num">CA</th>
                <th className="num">PA</th>
                <th className="num">Form</th>
                <th className="num">Morale</th>
                <th className="num">Fatigue</th>
                <th>Goals</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => {
                const myGoals = goals.filter((g) => g.playerId === p.id);
                return (
                  <tr key={p.id}>
                    <td><strong>{p.nickname}</strong> <span className="muted small">{p.firstName} {p.lastName}</span></td>
                    <td>{p.role}</td>
                    <td className="muted">{p.nationality}</td>
                    <td>{p.age}</td>
                    <td className="num">{p.currentAbility}</td>
                    <td className="num">{p.potentialAbility}</td>
                    <td className="num">{p.form.toFixed(1)}</td>
                    <td className={`num ${p.morale >= 14 ? 'text-win' : p.morale <= 7 ? 'text-loss' : ''}`}>{p.morale.toFixed(1)}</td>
                    <td className={`num ${p.fatigue >= 60 ? 'text-loss' : p.fatigue <= 25 ? 'text-win' : ''}`}>{p.fatigue.toFixed(0)}%</td>
                    <td>
                      {myGoals.length === 0 ? (
                        <span className="muted small">—</span>
                      ) : (
                        myGoals.map((g) => {
                          const v = (p.attributes as unknown as Record<string, number>)[g.attr] ?? 0;
                          const reached = g.reachedAt !== undefined || v >= g.target;
                          return (
                            <div key={g.attr} className="goal-chip">
                              <span>{g.attr}</span>
                              <span className={reached ? 'text-win' : ''}>{v}/{g.target}</span>
                              {reached && <span>✓</span>}
                            </div>
                          );
                        })
                      )}
                    </td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-tiny" onClick={() => setGoalPlayer(p)}>+ Goal</button>
                      <button
                        className="btn btn-tiny"
                        title="Loan this player out for N days"
                        disabled={roster.length <= 5}
                        onClick={() => setLoanPlayer(p)}
                      >Loan</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <LoanOffersPanel />
      <CoachesPanel />
      <SponsorsPanel />
      <AchievementsPanel />

      {duelResult && <DuelResultModal outcome={duelResult} />}
      {goalPlayer && <GoalEditorModal player={goalPlayer} onClose={() => setGoalPlayer(null)} />}
      {loanPlayer && <LoanOfferModal player={loanPlayer} onClose={() => setLoanPlayer(null)} />}
      {profileOpen && <ProfileEditorModal onClose={() => setProfileOpen(false)} />}
      <DevReportModal />
      <ChatWidget />
      <LiveFeedWidget />
      <ToastStack />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
      <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
