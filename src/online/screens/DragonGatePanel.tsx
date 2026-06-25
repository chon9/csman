// 射龍門 — Malaysian / Chinese in-between card game. Two gate cards
// shown, player bets, third card flipped. Strictly between = win 1×,
// matches a gate ("tiang") = -2× double penalty, outside = -1×.
//
// Unlimited rounds — wallet is the only cap. Server validates that the
// team can cover a tiang (2× bet) before accepting the bet so a single
// bad round can't drive money negative.

import { useEffect, useRef, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  DRAGON_GATE_MAX_BET,
  DRAGON_GATE_MIN_BET,
  type CardRank,
  type DragonGateResult,
} from '../protocol';

const PRESET_BETS = [500, 1000, 5000, 10000, 25000, 50000];

export default function DragonGatePanel(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const last = useOnline((s) => s.dragonGateLast);
  const session = useOnline((s) => s.dragonGateSession);
  const play = useOnline((s) => s.playDragonGate);

  const [bet, setBet] = useState(1000);
  // Reveal animation: when a new `last` arrives we hide the third card,
  // pause, then reveal it for the suspense beat.
  const [revealed, setRevealed] = useState(true);
  // Track whether the user has dealt SINCE this panel mounted. If they
  // navigate away and come back, `last` may still hold a previous result
  // from the store — but we don't want to flash it (looks like the game
  // auto-played a round on tab switch). Show the hand only after a real
  // play happens in this session.
  const [playedThisSession, setPlayedThisSession] = useState(false);
  // Seed the ref to the CURRENT last on mount so the effect's diff check
  // sees no change. Without this, the first effect run on a hot-mounted
  // panel would clear `revealed` and re-run the suspense animation on
  // stale data.
  const lastSeenId = useRef<DragonGateResult | null>(last);
  useEffect(() => {
    if (!last || last === lastSeenId.current) return;
    lastSeenId.current = last;
    setPlayedThisSession(true);
    setRevealed(false);
    const t = window.setTimeout(() => setRevealed(true), 900);
    return () => window.clearTimeout(t);
  }, [last]);

  if (!team) return null;
  const worstCase = bet * 2;
  const canBet = team.money >= worstCase && bet >= DRAGON_GATE_MIN_BET;
  const disabledReason =
    team.money < worstCase ? `Need $${worstCase.toLocaleString()} on hand (2× bet to cover a tiang)` :
    bet < DRAGON_GATE_MIN_BET ? `Bet must be at least $${DRAGON_GATE_MIN_BET.toLocaleString()}` :
    '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14 }}>
        <div className="muted small">
          <strong>射龍門</strong> · Two gate cards open first. Bet, then the middle card flips.
          {' '}<span style={{ color: '#6ed09a' }}>Strictly between</span> = +1× bet,
          {' '}<span style={{ color: '#f2c443' }}>outside</span> = −1× bet,
          {' '}<span style={{ color: '#e25555' }}>hits a gate (tiang)</span> = <strong>−2× bet</strong>.
          Cash on hand must cover the tiang downside.
        </div>
      </div>

      {/* ===== Bet picker ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Place your bet</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {PRESET_BETS.map((b) => (
            <button
              key={b}
              className={`btn ${bet === b ? 'btn-accent' : ''}`}
              onClick={() => setBet(b)}
              disabled={b > DRAGON_GATE_MAX_BET}
            >${b.toLocaleString()}</button>
          ))}
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="field-label">Or custom — ${bet.toLocaleString()} <span className="muted small">(max ${DRAGON_GATE_MAX_BET.toLocaleString()})</span></span>
          <input
            type="range"
            min={DRAGON_GATE_MIN_BET}
            max={DRAGON_GATE_MAX_BET}
            step={500}
            value={bet}
            onChange={(e) => setBet(Number(e.target.value))}
          />
        </label>
        <div className="muted small" style={{ marginTop: 4 }}>
          Tiang downside: <strong style={{ color: '#e25555' }}>−${(bet * 2).toLocaleString()}</strong> · Win upside: <strong style={{ color: '#6ed09a' }}>+${bet.toLocaleString()}</strong>
        </div>
        <button
          className="btn btn-accent"
          disabled={!canBet}
          onClick={() => play(bet)}
          title={disabledReason || `Deal — risk $${bet.toLocaleString()}`}
          style={{ marginTop: 12, padding: '10px 16px', fontSize: 14 }}
        >
          🐉 Deal
        </button>
      </div>

      {/* ===== Last round ===== */}
      {/* Only render after the user has actually dealt in this session —
          stops a stale `last` from the store flashing on tab switch. */}
      {playedThisSession && last && (
        <div className="panel" style={{ padding: 16 }}>
          <div className="panel-title">Last hand</div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
            <PlayingCard rank={last.gates[0]} accent="#6aa7ec" />
            <CenterCard rank={last.thirdCard} outcome={last.outcome} revealed={revealed} />
            <PlayingCard rank={last.gates[1]} accent="#6aa7ec" />
          </div>
          {revealed && (
            <div style={{ textAlign: 'center', marginTop: 14, fontWeight: 700 }}>
              <div style={{ fontSize: 18, color: outcomeColor(last.outcome) }}>{outcomeLabel(last.outcome)}</div>
              <div style={{ fontSize: 14, marginTop: 4, color: last.delta >= 0 ? '#6ed09a' : '#e25555' }}>
                {last.delta >= 0 ? `+$${last.delta.toLocaleString()}` : `-$${Math.abs(last.delta).toLocaleString()}`}
                <span className="muted small" style={{ marginLeft: 8 }}>balance ${last.newMoney.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Session ===== */}
      {session.rounds > 0 && (
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Session</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 8, marginTop: 8 }}>
            <Stat label="Rounds" value={String(session.rounds)} color="#d4d8e1" />
            <Stat label="Wins" value={String(session.wins)} color="#6ed09a" />
            <Stat label="Misses" value={String(session.misses)} color="#f2c443" />
            <Stat label="Tiangs" value={String(session.tiangs)} color="#e25555" />
            <Stat label="Net" value={session.netCash >= 0 ? `+$${session.netCash.toLocaleString()}` : `-$${Math.abs(session.netCash).toLocaleString()}`} color={session.netCash >= 0 ? '#6ed09a' : '#e25555'} big />
          </div>
        </div>
      )}
    </div>
  );
}

function PlayingCard({ rank, accent }: { rank: CardRank; accent: string }): React.ReactElement {
  return (
    <div
      style={{
        width: 80,
        height: 112,
        borderRadius: 10,
        background: 'linear-gradient(160deg, #1c2230, #0f1419)',
        border: `2px solid ${accent}`,
        boxShadow: `0 0 16px ${accent}33`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        position: 'relative',
      }}
    >
      <div style={{ fontSize: 32, fontWeight: 800, color: '#e8eaf0' }}>{rankLabel(rank)}</div>
      <div className="muted small" style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' }}>
        Gate
      </div>
    </div>
  );
}

function CenterCard({ rank, outcome, revealed }: { rank: CardRank; outcome: 'win' | 'tiang' | 'miss'; revealed: boolean }): React.ReactElement {
  const accent = outcomeColor(outcome);
  if (!revealed) {
    return (
      <div
        style={{
          width: 80,
          height: 112,
          borderRadius: 10,
          background: 'repeating-linear-gradient(45deg, #2a2f3a, #2a2f3a 6px, #1c2230 6px, #1c2230 12px)',
          border: '2px solid rgba(255,255,255,0.10)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
        }}
      >🐉</div>
    );
  }
  return (
    <div
      style={{
        width: 80,
        height: 112,
        borderRadius: 10,
        background: `linear-gradient(160deg, ${accent}30, #0f1419)`,
        border: `2px solid ${accent}`,
        boxShadow: `0 0 22px ${accent}66`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>{rankLabel(rank)}</div>
      <div className="muted small" style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: accent }}>
        {outcome}
      </div>
    </div>
  );
}

function Stat({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }): React.ReactElement {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
      <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: big ? 18 : 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function rankLabel(r: CardRank): string {
  return r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
}
function outcomeLabel(o: 'win' | 'tiang' | 'miss'): string {
  return o === 'win' ? '🎉 IN BETWEEN — Win!' : o === 'tiang' ? '💥 TIANG — double loss' : '🐢 OUTSIDE — Loss';
}
function outcomeColor(o: 'win' | 'tiang' | 'miss'): string {
  return o === 'win' ? '#6ed09a' : o === 'tiang' ? '#e25555' : '#f2c443';
}
