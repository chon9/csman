// Online-mode home — Phase 2 adds a duel pad (stake + format + register
// button), a time-skip control, and routes to the marketplace. Duel results
// arrive as a modal overlay; toasts cover time-skip + market success.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import { starterContractWarning } from '../contractWarn';
import {
  CONTRACT_DUELS_WARN_AT,
  CONTRACT_RENEWAL_DUELS,
  CONTRACT_RENEWAL_WAGE_MULT,
  MIN_RELEASE_FEE,
  RELEASE_WAGE_MULT,
  DAILY_DUEL_CAP,
  MAX_DUEL_STAKE,
  MAX_REFILLS_PER_DAY,
  MAX_TIME_SKIP_DAYS,
  MIN_DUEL_STAKE,
  MIN_REFILL_COST,
  REFILL_COST_PER_DUEL,
  TIME_SKIP_COST_PER_DAY,
} from '../protocol';
import type { MatchFormat } from '../../types';
import DuelResultModal from './DuelResultModal';
import ToastStack from './ToastStack';
import { moneyCompact } from '../../ui/util';
import Icon from '../../ui/Icon';
import { PlayerName } from './PlayerProfileModal';
import DailyQuestsPanel from './DailyQuestsPanel';
import ChatWidget from './ChatWidget';
import DevReportModal from './DevReportModal';
import LiveFeedWidget from './LiveFeedWidget';
import FabDock from './FabDock';
import GoalEditorModal from './GoalEditorModal';
import NewsTicker from './NewsTicker';
import AchievementsPanel from './AchievementsPanel';
import LoanOffersPanel from './LoanOffersPanel';
import ProfileEditorModal from './ProfileEditorModal';
import LoanOfferModal from './LoanOfferModal';
import CoachesPanel from './CoachesPanel';
import SponsorsPanel from './SponsorsPanel';
import type { Player } from '../../types';
import { fatigueTooltip, moraleTooltip } from '../recoveryHelpers';
import { formatGameAge } from '../dateHelpers';

export default function OnlineHomeScreen() {
  const team = useOnline((s) => s.team);
  const players = useOnline((s) => s.players);
  const duelPending = useOnline((s) => s.duelPending);
  const skipPending = useOnline((s) => s.skipPending);
  const duelResult = useOnline((s) => s.duelResult);
  const refresh = useOnline((s) => s.refreshState);
  const spawnInitialRoster = useOnline((s) => s.spawnInitialRoster);
  const duelsUsed = useOnline((s) => s.duelsUsed);
  const duelsRefillsUsed = useOnline((s) => s.duelsRefillsUsed);
  const refillDuels = useOnline((s) => s.refillDuels);
  const renewContract = useOnline((s) => s.renewContract);
  const releasePlayer = useOnline((s) => s.releasePlayer);
  const registerAiDuel = useOnline((s) => s.registerAiDuel);
  const timeSkip = useOnline((s) => s.timeSkip);

  const [stake, setStake] = useState(5_000);
  const [format, setFormat] = useState<MatchFormat>('BO1');
  const [skipDays, setSkipDays] = useState(7);
  const [scrimMode, setScrimMode] = useState(false);
  const [goalPlayer, setGoalPlayer] = useState<Player | null>(null);
  const [loanPlayer, setLoanPlayer] = useState<Player | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const goals = useOnline((s) => s.playerGoals);
  const refreshGoals = useOnline((s) => s.refreshGoals);

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
  // Cap only applies to ranked duels — scrims stay free + unlimited.
  const duelsLeft = Math.max(0, DAILY_DUEL_CAP - duelsUsed);
  const cappedOut = !scrimMode && duelsLeft <= 0;
  const canDuel = !duelPending && roster.length >= 5 && !cappedOut && (scrimMode || team.money >= stake);
  const canSkip = !skipPending && team.money >= skipCost;

  // Human-readable reason the duel button is locked — used as both the
  // button tooltip and the body of the warning toast on click attempts.
  const duelBlockedReason =
    roster.length < 5 ? `Need 5 players in the lineup (have ${roster.length}).` :
    cappedOut ? `No duels left this in-game day. Refill from the chip above or wait for the next tick.` :
    !scrimMode && team.money < stake ? `Insufficient funds — need $${stake.toLocaleString()}, have $${team.money.toLocaleString()}.` :
    '';

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <NewsTicker />
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div className="team-logo team-logo-lg team-logo-placeholder">{team.tag.slice(0, 2)}</div>
          <div>
            <h2>
              <span style={{ color: 'var(--accent)' }}>{team.tag}</span> · {team.name}
            </h2>
            <div className="hero-sub">
              {team.region} · owner <strong>{team.ownerNick}</strong> · {formatGameAge(team.day)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <DuelCapChip
            used={duelsUsed}
            refillsUsed={duelsRefillsUsed}
            money={team.money}
            onRefill={refillDuels}
          />
          <button className="btn btn-tiny" onClick={refresh} title="Refresh state" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="refresh" size={12} /> Refresh
          </button>
          <button className="btn btn-tiny" onClick={() => setProfileOpen(true)} title="Edit bio, color, social links" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="settings" size={12} /> Edit profile
          </button>
        </div>
      </div>

      <div className="online-stat-grid">
        <StatCard label="Cash" value={moneyCompact(team.money)} title={`$${team.money.toLocaleString()}`} />
        <StatCard label="Roster" value={`${roster.length} / ${team.playerIds.length || 5}`} />
        <StatCard label="Avg CA" value={String(avgCA)} />
        <StatCard label="Avg PA" value={String(avgPA)} />
        <StatCard label="Avg age" value={avgAge} />
      </div>

      <div className="home-action-grid">
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
              onClick={() => {
                // Scrims don't tick contracts (see server's isScrim guard
                // around tickContractsAfterDuel) so skip the warning there.
                if (!scrimMode) {
                  const warn = starterContractWarning(team, players);
                  if (warn && !window.confirm(warn.message)) return;
                }
                registerAiDuel(effectiveStake, format);
              }}
              title={duelBlockedReason || (scrimMode ? 'Run a free scrim' : `Register a $${stake.toLocaleString()} duel`)}
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
          <div className="panel-title">Advance Time <span className="muted small">— optional fast-forward</span></div>
          <p className="muted small" style={{ marginTop: 2 }}>
            Time auto-advances <strong>+1 day every 4 hours UTC</strong> (00 / 04 / 08 / 12 / 16 / 20 UTC, i.e. 6 days per real day) — see the sidebar countdown. Pay here if you want to skip ahead of the global pace.
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
              Cost: <strong>${skipCost.toLocaleString()}</strong> · {Math.floor(skipDays / 7)} weekly training tick{Math.floor(skipDays / 7) === 1 ? '' : 's'}
            </div>
            <button
              className="btn btn-accent"
              disabled={!canSkip}
              onClick={() => timeSkip(skipDays)}
              title={team.money < skipCost ? 'Insufficient funds' : ''}
            >
              {skipPending ? 'Advancing…' : `Skip ${skipDays} day${skipDays === 1 ? '' : 's'}`}
            </button>

            {/* What changes when you skip — surfaces the hidden mechanics. */}
            <div style={{ marginTop: 4, padding: 8, borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="muted small" style={{ marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
                What changes when you skip
              </div>
              <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                <li><strong>Every day:</strong> fatigue recovers (1.5–5.5 / day, scales with endurance); morale drifts toward 12</li>
                <li><strong>Every 7-day chunk:</strong> training tick — attribute gains for young players, occasional regressions</li>
                <li><strong>Loans + sponsors:</strong> auto-settle if their due date falls in the skip window</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <DailyQuestsPanel />

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
          <div className="table-scroll">
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
                <th className="num" title="Ranked duels left on this contract before the player walks to free agency">Contract</th>
                <th>Goals</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p, rosterIdx) => {
                const myGoals = goals.filter((g) => g.playerId === p.id);
                const duelsLeft = p.contract?.duelsRemaining;
                const isStarter = rosterIdx < 5;
                const renewCost = p.contract ? Math.max(1000, Math.round(p.contract.wage * CONTRACT_RENEWAL_WAGE_MULT)) : 0;
                const lowContract = typeof duelsLeft === 'number' && duelsLeft <= CONTRACT_DUELS_WARN_AT;
                return (
                  <tr key={p.id}>
                    <td><PlayerName playerId={p.id} label={p.nickname} /> <span className="muted small">{p.firstName} {p.lastName}</span></td>
                    <td>{p.role}</td>
                    <td className="muted">{p.nationality}</td>
                    <td>{p.age.toFixed(2)}</td>
                    <td className="num">{p.currentAbility}</td>
                    <td className="num">{p.potentialAbility}</td>
                    <td className="num">{p.form.toFixed(1)}</td>
                    <td
                      className={`num ${p.morale >= 14 ? 'text-win' : p.morale <= 7 ? 'text-loss' : ''}`}
                      title={moraleTooltip(p)}
                      style={{ cursor: 'help' }}
                    >{p.morale.toFixed(1)}</td>
                    <td
                      className={`num ${p.fatigue >= 60 ? 'text-loss' : p.fatigue <= 25 ? 'text-win' : ''}`}
                      title={fatigueTooltip(p)}
                      style={{ cursor: 'help' }}
                    >{p.fatigue.toFixed(0)}%</td>
                    <td
                      className={`num ${typeof duelsLeft !== 'number' ? 'muted' : lowContract ? 'text-loss' : ''}`}
                      title={
                        typeof duelsLeft !== 'number'
                          ? 'No contract counter (legacy player — will get one on next renewal).'
                          : `${duelsLeft} ranked duel${duelsLeft === 1 ? '' : 's'} until ${p.nickname} walks. Only starters consume duels. Renew for $${renewCost.toLocaleString()} → +${CONTRACT_RENEWAL_DUELS} duels.`
                      }
                    >
                      {typeof duelsLeft === 'number' ? duelsLeft : '—'}
                      {isStarter && typeof duelsLeft === 'number' && (
                        <span className="muted small" style={{ marginLeft: 4, fontSize: 9 }}>★</span>
                      )}
                    </td>
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
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button className="btn btn-tiny" onClick={() => setGoalPlayer(p)}>+ Goal</button>
                      <button
                        className="btn btn-tiny"
                        title="Loan this player out for N days"
                        disabled={roster.length <= 5}
                        onClick={() => setLoanPlayer(p)}
                      >Loan</button>
                      {p.contract && (
                        <button
                          className={`btn btn-tiny ${lowContract ? 'btn-accent' : ''}`}
                          title={`Renew contract: -$${renewCost.toLocaleString()} for +${CONTRACT_RENEWAL_DUELS} duels`}
                          disabled={!team || team.money < renewCost}
                          onClick={() => {
                            if (window.confirm(`Renew ${p.nickname}'s contract for $${renewCost.toLocaleString()}? (+${CONTRACT_RENEWAL_DUELS} duels)`)) {
                              renewContract(p.id);
                            }
                          }}
                        >Renew · ${renewCost.toLocaleString()}</button>
                      )}
                      {/* Release: terminate the contract early + send the
                          player to FA. Free — no cash changes hands.
                          Roster must stay ≥ 6 (one above duel-min 5). */}
                      {(() => {
                        const canRelease = roster.length > 5;
                        return (
                          <button
                            className="btn btn-tiny btn-danger"
                            disabled={!canRelease}
                            title={
                              !canRelease ? 'Need 6+ players to release one (duels need 5 minimum)' :
                              `Release ${p.nickname} to free agency. No cost.`
                            }
                            onClick={() => {
                              if (window.confirm(`Release ${p.nickname} to free agency? No cash changes hands.`)) {
                                releasePlayer(p.id);
                              }
                            }}
                          >Release</button>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
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
      <FabDock />
      <ToastStack />
    </div>
  );
}

function StatCard({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat-card" title={title}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

interface DuelCapChipProps {
  used: number;
  refillsUsed: number;
  money: number;
  onRefill: () => void;
}

function DuelCapChip({ used, refillsUsed, money, onRefill }: DuelCapChipProps): React.ReactElement {
  const remaining = Math.max(0, DAILY_DUEL_CAP - used);
  const refillsLeft = Math.max(0, MAX_REFILLS_PER_DAY - refillsUsed);
  const chipClass =
    remaining === 0 ? 'duel-cap-chip-out' :
    remaining <= 3 ? 'duel-cap-chip-low' : '';
  const refillCost = Math.max(MIN_REFILL_COST, used * REFILL_COST_PER_DUEL);
  const canRefill = refillsLeft > 0 && used > 0 && money >= refillCost;
  const refillDisabledTitle =
    refillsLeft <= 0 ? `No refills left this in-game day (cap ${MAX_REFILLS_PER_DAY}).` :
    used <= 0 ? 'Already full.' :
    money < refillCost ? `Need $${refillCost.toLocaleString()} to refill ${used} duel${used === 1 ? '' : 's'}.` :
    '';
  return (
    <>
      <span
        className={`duel-cap-chip ${chipClass}`}
        title={`${remaining}/${DAILY_DUEL_CAP} duels left this in-game day · ${refillsLeft}/${MAX_REFILLS_PER_DAY} refills left · resets when the day ticks (~every 4 real hours)`}
      >
        ⚔ {remaining}/{DAILY_DUEL_CAP} left
      </span>
      <button
        className="duel-cap-buy"
        onClick={() => {
          if (!canRefill) return;
          if (window.confirm(`Refill ${used} missing duel${used === 1 ? '' : 's'} for $${refillCost.toLocaleString()}?`)) {
            onRefill();
          }
        }}
        disabled={!canRefill}
        title={canRefill ? `Refill ${used} duel${used === 1 ? '' : 's'} for $${refillCost.toLocaleString()} (${refillsLeft} refills left)` : refillDisabledTitle}
      >
        ↻ Refill · ${refillCost.toLocaleString()} ({refillsLeft})
      </button>
    </>
  );
}
