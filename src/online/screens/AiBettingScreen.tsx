// AI vs AI betting market. Server generates fresh synthetic matchups every
// few minutes; players bet on either side during the countdown; sim runs
// at kickoff; winners are paid stake × odds. Re-uses the live-replay
// viewer (locked-mode w/o the duel-result drain) to watch the resolved
// match for ~10 minutes.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  AI_BET_LOCK_LEAD_MS,
  AI_BET_MAX_STAKE,
  AI_BET_MIN_STAKE,
  findTrait,
  type AiBetTeamProfile,
  type AiMatchCardWire,
} from '../protocol';
import ToastStack from './ToastStack';

export default function AiBettingScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const cards = useOnline((s) => s.aiBetCards);
  const refresh = useOnline((s) => s.refreshAiBets);
  const refreshHistory = useOnline((s) => s.refreshAiBetHistory);
  const myHistory = useOnline((s) => s.aiBetMyHistory);
  const fetchReplay = useOnline((s) => s.fetchAiBetReplay);
  const fetchTeamView = useOnline((s) => s.fetchAiBetTeam);
  const teamView = useOnline((s) => s.aiBetTeamView);
  const dismissTeamView = useOnline((s) => s.dismissAiBetTeam);
  const go = useOnline((s) => s.go);

  // 1Hz heartbeat for countdown displays.
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Initial load + refresh every 30s as a safety net (broadcast pushes do
  // most of the live-update work).
  useEffect(() => {
    refresh();
    refreshHistory();
    const id = setInterval(() => refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh, refreshHistory]);

  // Modal state — the card the user is actively placing a bet on.
  const [betFor, setBetFor] = useState<{ card: AiMatchCardWire; side: 'A' | 'B' } | null>(null);

  // Sort: open + closing first (soonest kickoff), then live, then resolved (most recent).
  const sorted = useMemo(() => {
    const rank: Record<AiMatchCardWire['status'], number> = { closing: 0, open: 1, live: 2, resolved: 3 };
    return [...cards].sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if (a.status === 'resolved') return b.scheduledStartAt - a.scheduledStartAt;
      return a.scheduledStartAt - b.scheduledStartAt;
    });
  }, [cards]);

  const myBets = sorted.filter((c) => c.myBet);

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ===== Header ===== */}
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>🎰 AI Betting Market</h2>
          <div className="muted small">
            Synthetic AI vs AI matches every ~8 minutes. Bet on either side · 5% house edge · payout = stake × odds. Bets lock {Math.round(AI_BET_LOCK_LEAD_MS / 1000)}s before kickoff.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="muted small">Cash: <strong>${team.money.toLocaleString()}</strong></span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* ===== My bets ===== */}
      {myBets.length > 0 && (
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">My Open & Recent Bets</div>
          <table className="table table-dense" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Match</th>
                <th>Side</th>
                <th className="num">Stake</th>
                <th className="num">Odds</th>
                <th className="num">To win</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {myBets.map((c) => {
                const bet = c.myBet!;
                const sideTeam = bet.side === 'A' ? c.teamA : c.teamB;
                const toWin = Math.round(bet.stake * bet.oddsAtBet);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.teamA.tag}</strong> <span className="muted">vs</span> <strong>{c.teamB.tag}</strong>
                    </td>
                    <td>
                      <span style={{ color: sideTeam.primaryColor, fontWeight: 700 }}>{sideTeam.tag}</span>
                    </td>
                    <td className="num">${bet.stake.toLocaleString()}</td>
                    <td className="num">{bet.oddsAtBet.toFixed(2)}×</td>
                    <td className="num">${toWin.toLocaleString()}</td>
                    <td>
                      {bet.status === 'pending' && <span className="muted small">⏳ pending</span>}
                      {bet.status === 'won' && <span style={{ color: '#6ed09a', fontWeight: 700 }}>✅ won ${(bet.payout ?? 0).toLocaleString()}</span>}
                      {bet.status === 'lost' && <span style={{ color: '#e25555' }}>❌ lost</span>}
                    </td>
                    <td>
                      {c.matchHistoryId && bet.status !== 'pending' && (
                        <button className="btn btn-tiny" onClick={() => fetchReplay(c.id)}>▶ Replay</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== Last 10 resolved bets ===== */}
      {myHistory.length > 0 && (
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Last {Math.min(10, myHistory.length)} Resolved Bets</div>
          <table className="table table-dense" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Match</th>
                <th>My Pick</th>
                <th className="num">Stake</th>
                <th className="num">Odds</th>
                <th>Result</th>
                <th className="num">P/L</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {myHistory.map((h) => {
                const pickedTag = h.side === 'A' ? h.teamATag : h.teamBTag;
                const pickedColor = h.side === 'A' ? h.teamAColor : h.teamBColor;
                const winnerTag = h.winnerSide === 'A' ? h.teamATag : h.teamBTag;
                const pnl = h.status === 'won' ? h.payout - h.stake : -h.stake;
                return (
                  <tr key={`${h.cardId}-${h.settledAt}`}>
                    <td>
                      <span style={{ color: h.teamAColor, fontWeight: 700 }}>{h.teamATag}</span>
                      <span className="muted"> {h.mapsA}-{h.mapsB} </span>
                      <span style={{ color: h.teamBColor, fontWeight: 700 }}>{h.teamBTag}</span>
                    </td>
                    <td><span style={{ color: pickedColor, fontWeight: 700 }}>{pickedTag}</span></td>
                    <td className="num">${h.stake.toLocaleString()}</td>
                    <td className="num">{h.oddsAtBet.toFixed(2)}×</td>
                    <td>
                      {h.status === 'won' ? (
                        <span style={{ color: '#6ed09a', fontWeight: 700 }}>✅ won</span>
                      ) : (
                        <span style={{ color: '#e25555' }}>❌ {winnerTag} won</span>
                      )}
                    </td>
                    <td className="num" style={{ color: pnl >= 0 ? '#6ed09a' : '#e25555', fontWeight: 700 }}>
                      {pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}
                    </td>
                    <td className="muted small">{formatHistoryTime(h.settledAt, clock)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== Card grid ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
        {sorted.map((c) => (
          <BetCard
            key={c.id}
            card={c}
            now={clock}
            onBet={(side) => setBetFor({ card: c, side })}
            onReplay={() => fetchReplay(c.id)}
            onTeamClick={(side) => fetchTeamView(c.id, side)}
          />
        ))}
        {sorted.length === 0 && (
          <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
            <div className="muted">Loading betting cards…</div>
          </div>
        )}
      </div>

      {betFor && (
        <PlaceBetModal
          card={betFor.card}
          side={betFor.side}
          onClose={() => setBetFor(null)}
        />
      )}

      {teamView && (
        <AiTeamProfileModal profile={teamView.profile} onClose={dismissTeamView} />
      )}

      <ToastStack />
    </div>
  );
}

function BetCard({
  card, now, onBet, onReplay, onTeamClick,
}: {
  card: AiMatchCardWire;
  now: number;
  onBet: (side: 'A' | 'B') => void;
  onReplay: () => void;
  onTeamClick: (side: 'A' | 'B') => void;
}): React.ReactElement {
  const msToStart = card.scheduledStartAt - now;
  const lockMs = msToStart - AI_BET_LOCK_LEAD_MS;
  const locked = card.status !== 'open' || lockMs <= 0;
  const isResolved = card.status === 'resolved';
  const isLive = card.status === 'live';
  const myBet = card.myBet ?? null;

  const totalPool = (card.poolA ?? 0) + (card.poolB ?? 0);

  return (
    <div className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderColor: isLive ? '#f2c443' : isResolved ? 'rgba(110,208,154,0.4)' : undefined }}>
      {/* Status pill */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <StatusPill status={card.status} msToStart={msToStart} />
        {totalPool > 0 && (
          <div className="muted small">Pool: <strong>${totalPool.toLocaleString()}</strong></div>
        )}
      </div>

      {/* Teams */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'stretch', gap: 8 }}>
        <SidePanel
          card={card}
          side="A"
          locked={locked}
          isResolved={isResolved}
          myBet={myBet}
          onBet={() => onBet('A')}
          onTeamClick={() => onTeamClick('A')}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9fb4e4', fontWeight: 700, padding: '0 4px' }}>vs</div>
        <SidePanel
          card={card}
          side="B"
          locked={locked}
          isResolved={isResolved}
          myBet={myBet}
          onBet={() => onBet('B')}
          onTeamClick={() => onTeamClick('B')}
        />
      </div>

      {/* Resolved banner / Replay button */}
      {isResolved && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: 'rgba(110,208,154,0.08)', border: '1px solid rgba(110,208,154,0.3)' }}>
          <div style={{ fontSize: 13 }}>
            Winner: <strong style={{ color: card.winnerSide === 'A' ? card.teamA.primaryColor : card.teamB.primaryColor }}>
              {card.winnerSide === 'A' ? card.teamA.tag : card.teamB.tag}
            </strong>
          </div>
          {card.matchHistoryId && (
            <button className="btn btn-tiny" onClick={onReplay}>▶ Watch replay</button>
          )}
        </div>
      )}
    </div>
  );
}

function SidePanel({
  card, side, locked, isResolved, myBet, onBet, onTeamClick,
}: {
  card: AiMatchCardWire;
  side: 'A' | 'B';
  locked: boolean;
  isResolved: boolean;
  myBet: AiMatchCardWire['myBet'];
  onBet: () => void;
  onTeamClick: () => void;
}): React.ReactElement {
  const team = side === 'A' ? card.teamA : card.teamB;
  const odds = side === 'A' ? card.oddsA : card.oddsB;
  const pool = side === 'A' ? card.poolA ?? 0 : card.poolB ?? 0;
  const isWinner = isResolved && card.winnerSide === side;
  const isLoser = isResolved && card.winnerSide && card.winnerSide !== side;
  const myBetHere = myBet && myBet.side === side ? myBet : null;

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        border: `2px solid ${isWinner ? '#6ed09a' : isLoser ? 'rgba(226,85,85,0.5)' : 'rgba(255,255,255,0.06)'}`,
        background: `linear-gradient(135deg, ${team.primaryColor}22, transparent 70%)`,
        opacity: isLoser ? 0.55 : 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <button
        onClick={onTeamClick}
        title={`View ${team.name} roster`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          color: 'inherit', textAlign: 'left', font: 'inherit',
        }}
      >
        <span style={{ fontSize: 22 }}>{team.logoId}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, color: '#fff', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline dotted rgba(255,255,255,0.25)', textUnderlineOffset: 3 }}>
            {team.tag}
          </div>
          <div className="muted small" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</div>
        </div>
      </button>
      <div style={{ display: 'flex', gap: 8, fontSize: 11 }} className="muted">
        <span>CA <strong style={{ color: '#d4d8e1' }}>{team.totalCA}</strong></span>
        <span>Syn <strong style={{ color: team.synergy >= 1 ? '#6ed09a' : '#e25555' }}>{team.synergy.toFixed(2)}×</strong></span>
        {pool > 0 && <span>Pool <strong style={{ color: '#d4d8e1' }}>${pool.toLocaleString()}</strong></span>}
      </div>
      <button
        className="btn"
        onClick={onBet}
        disabled={locked || !!myBet}
        title={myBet ? `Already bet on ${myBet.side === side ? 'this side' : 'the other side'}.` : locked ? 'Bets closed' : `Bet on ${team.tag} at ${odds.toFixed(2)}×`}
        style={{
          marginTop: 4,
          fontWeight: 700,
          fontSize: 14,
          background: locked || myBet ? undefined : team.primaryColor,
          color: locked || myBet ? undefined : '#0a0d12',
          border: 'none',
        }}
      >
        {myBetHere ? `✓ Bet $${myBetHere.stake.toLocaleString()} @ ${myBetHere.oddsAtBet.toFixed(2)}×` : `${odds.toFixed(2)}×`}
      </button>
    </div>
  );
}

function StatusPill({ status, msToStart }: { status: AiMatchCardWire['status']; msToStart: number }): React.ReactElement {
  let label: string;
  let color: string;
  if (status === 'resolved') {
    label = 'RESOLVED';
    color = '#6ed09a';
  } else if (status === 'live') {
    label = '🔴 LIVE';
    color = '#f2c443';
  } else if (status === 'closing' || msToStart <= AI_BET_LOCK_LEAD_MS) {
    label = `LOCKED · kickoff ${formatCountdown(Math.max(0, msToStart))}`;
    color = '#e25555';
  } else {
    label = `OPEN · ${formatCountdown(Math.max(0, msToStart))}`;
    color = '#9fb4e4';
  }
  return (
    <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color, fontWeight: 700 }}>
      {label}
    </div>
  );
}

function PlaceBetModal({
  card, side, onClose,
}: {
  card: AiMatchCardWire;
  side: 'A' | 'B';
  onClose: () => void;
}): React.ReactElement {
  const team = useOnline((s) => s.team);
  const placeBet = useOnline((s) => s.placeAiBet);
  const [stake, setStake] = useState<number>(AI_BET_MIN_STAKE);
  const odds = side === 'A' ? card.oddsA : card.oddsB;
  const sideTeam = side === 'A' ? card.teamA : card.teamB;
  const toWin = Math.round(stake * odds);
  const cash = team?.money ?? 0;
  const cantAfford = stake > cash;
  const invalid = stake < AI_BET_MIN_STAKE || stake > AI_BET_MAX_STAKE;

  function submit(): void {
    if (cantAfford || invalid) return;
    placeBet(card.id, side, stake);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, padding: 18 }}>
        <div className="modal-head" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Bet on {sideTeam.tag}</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>

        <div style={{ padding: 12, borderRadius: 8, background: `linear-gradient(135deg, ${sideTeam.primaryColor}22, transparent 80%)`, border: '1px solid rgba(255,255,255,0.08)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 28 }}>{sideTeam.logoId}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#fff' }}>{sideTeam.name}</div>
              <div className="muted small">vs {(side === 'A' ? card.teamB : card.teamA).name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Odds</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: sideTeam.primaryColor }}>{odds.toFixed(2)}×</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="muted small" htmlFor="ai-bet-stake">Stake (cash on hand: ${cash.toLocaleString()})</label>
          <input
            id="ai-bet-stake"
            type="number"
            className="input"
            min={AI_BET_MIN_STAKE}
            max={AI_BET_MAX_STAKE}
            step={500}
            value={stake}
            onChange={(e) => setStake(Math.round(Number(e.target.value) || 0))}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {[1_000, 5_000, 10_000, 25_000].map((amt) => (
              <button
                key={amt}
                className="btn btn-tiny"
                disabled={amt > cash || amt > AI_BET_MAX_STAKE}
                onClick={() => setStake(amt)}
              >
                ${(amt / 1000).toFixed(0)}k
              </button>
            ))}
            <button
              className="btn btn-tiny"
              disabled={cash < AI_BET_MIN_STAKE}
              onClick={() => setStake(Math.min(AI_BET_MAX_STAKE, Math.max(AI_BET_MIN_STAKE, cash)))}
            >Max</button>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: 'rgba(110,208,154,0.08)', border: '1px solid rgba(110,208,154,0.3)', textAlign: 'center' }}>
          <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Payout if {sideTeam.tag} wins</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#6ed09a' }}>${toWin.toLocaleString()}</div>
          <div className="muted small">Net: +${(toWin - stake).toLocaleString()}</div>
        </div>

        {cantAfford && <div style={{ color: '#e25555', marginTop: 8, fontSize: 12 }}>Not enough cash.</div>}
        {invalid && !cantAfford && (
          <div style={{ color: '#e25555', marginTop: 8, fontSize: 12 }}>
            Stake must be ${AI_BET_MIN_STAKE.toLocaleString()}–${AI_BET_MAX_STAKE.toLocaleString()}.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button
            className="btn btn-accent"
            onClick={submit}
            disabled={cantAfford || invalid}
            style={{ flex: 2, fontWeight: 700 }}
          >
            Place ${stake.toLocaleString()} bet
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Relative time string for the history table. `now` is threaded through
 *  so the cell re-renders with the 1Hz heartbeat. */
function formatHistoryTime(settledAt: number, now: number): string {
  const diff = Math.max(0, now - settledAt);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/** Read-only profile modal for a synthetic AI bet team. Roster comes from
 *  the card payload — these teams are NEVER persisted to the teams table,
 *  so the in-app modal is the only surface for inspecting them. */
function AiTeamProfileModal({
  profile, onClose,
}: {
  profile: AiBetTeamProfile;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, padding: 18 }}>
        <div className="modal-head" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 36 }}>{profile.logoId}</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: profile.primaryColor }}>{profile.tag}</div>
              <div className="muted small">{profile.name}</div>
            </div>
          </div>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 12 }} className="muted">
          <span>Total CA <strong style={{ color: '#d4d8e1' }}>{profile.totalCA}</strong></span>
          <span>Synergy <strong style={{ color: profile.synergy >= 1 ? '#6ed09a' : '#e25555' }}>{profile.synergy.toFixed(2)}×</strong></span>
          <span style={{ marginLeft: 'auto', fontStyle: 'italic', opacity: 0.7 }}>Synthetic team · betting-only</span>
        </div>

        <table className="table table-dense" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Player</th>
              <th>Role</th>
              <th>Nat</th>
              <th className="num">Age</th>
              <th className="num">CA</th>
              <th className="num">PA</th>
              <th>Traits</th>
            </tr>
          </thead>
          <tbody>
            {profile.players.map((p, i) => (
              <tr key={i}>
                <td><strong>{p.nickname}</strong> <span className="muted small">{p.firstName} {p.lastName}</span></td>
                <td>{p.role}</td>
                <td>{p.nationality}</td>
                <td className="num">{Math.floor(p.age)}</td>
                <td className="num">{p.ca}</td>
                <td className="num">{p.pa}</td>
                <td>
                  {p.traits.length === 0 ? <span className="muted small">—</span> :
                    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                      {p.traits.map((id) => {
                        const t = findTrait(id);
                        if (!t) return null;
                        const positive = t.tone === 'positive';
                        return (
                          <span
                            key={id}
                            title={t.description}
                            style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
                              background: positive ? 'rgba(110,208,154,0.16)' : 'rgba(226,85,85,0.14)',
                              border: `1px solid ${positive ? 'rgba(110,208,154,0.6)' : 'rgba(226,85,85,0.6)'}`,
                              color: positive ? '#6ed09a' : '#e25555',
                            }}
                          >
                            {t.icon}
                          </span>
                        );
                      })}
                    </span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
