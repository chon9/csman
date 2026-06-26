// Crash / Rocket — pick a bet, hit Launch, watch the multiplier rise.
// Cash out before the rocket explodes to lock in bet × current multiplier;
// ride too long and the entire bet is gone. Server picks the secret crash
// point at start time using a fair distribution with a ~1% house edge, so
// the curve grows the same way for everyone but each round busts at a
// different multiplier.

import { useEffect, useRef, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  CRASH_GROWTH_RATE_PER_MS,
  CRASH_MAX_BET,
  CRASH_MIN_BET,
  type CrashResult,
} from '../protocol';

const PRESET_BETS = [500, 1000, 5000, 10000, 25000, 50000];

/** Multiplier from elapsed real-time using the same exponential curve the
 *  server uses. Identical formula → client display matches server-locked
 *  payout to within sub-millisecond precision. */
function multiplierAt(startedAt: number, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - startedAt);
  const m = Math.exp(CRASH_GROWTH_RATE_PER_MS * elapsed);
  return Math.max(1.0, m);
}

export default function CrashPanel(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const active = useOnline((s) => s.crashActive);
  const last = useOnline((s) => s.crashLast);
  const session = useOnline((s) => s.crashSession);
  const start = useOnline((s) => s.startCrash);
  const cashout = useOnline((s) => s.cashoutCrash);

  const [bet, setBet] = useState(1000);
  // Animated multiplier — driven by RAF loop while a round is active.
  const [displayMultiplier, setDisplayMultiplier] = useState(1.0);
  // True once the user has actually played in this panel mount. Avoids
  // flashing the previous round's "Last round" panel on tab switch.
  const [playedThisSession, setPlayedThisSession] = useState(false);
  // Tracks the last-seen `last` object so we know when a fresh resolution
  // arrived — used to flip the "played this session" flag without flashing
  // on stale results loaded from a prior visit.
  const lastSeenRef = useRef<CrashResult | null>(last);

  // RAF loop: while a round is active, update the displayed multiplier
  // ~60×/s using the same curve the server will use to compute payout.
  useEffect(() => {
    if (!active) {
      setDisplayMultiplier(1.0);
      return;
    }
    let raf = 0;
    const tick = (): void => {
      const serverNow = Date.now() + active.clockOffsetMs;
      setDisplayMultiplier(multiplierAt(active.startedAt, serverNow));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // Mark "played this session" when a NEW result lands.
  useEffect(() => {
    if (!last || last === lastSeenRef.current) return;
    lastSeenRef.current = last;
    setPlayedThisSession(true);
  }, [last]);

  if (!team) return null;

  const canStart = !active && team.money >= bet && bet >= CRASH_MIN_BET;
  const disabledReason =
    active ? 'Round in progress — cash out or wait for the bust.' :
    team.money < bet ? `Need $${bet.toLocaleString()} on hand.` :
    bet < CRASH_MIN_BET ? `Bet must be at least $${CRASH_MIN_BET.toLocaleString()}.` :
    '';

  const potentialPayout = active ? Math.round(active.bet * displayMultiplier) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14 }}>
        <div className="muted small">
          <strong>🚀 Crash</strong> · Multiplier starts at 1.00× and climbs the longer you wait.
          {' '}<span style={{ color: '#6ed09a' }}>Cash out</span> any time to lock in
          {' '}<strong>bet × current multiplier</strong>. Wait too long and the rocket
          {' '}<span style={{ color: '#e25555' }}>explodes</span> — entire bet is lost.
          Bust point is decided the moment you Launch.
        </div>
      </div>

      {/* ===== Rocket display ===== */}
      <div className="panel" style={{ padding: 22, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        {active && (
          // Soft background gradient that brightens with the multiplier so
          // late-game feels visibly tense without an extra DOM tree.
          <div
            style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: `radial-gradient(circle at 50% 60%, ${tensionColor(displayMultiplier)}22 0%, transparent 65%)`,
              transition: 'background 200ms linear',
            }}
          />
        )}
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: active ? tensionColor(displayMultiplier) : '#8a8f9a',
            fontFamily: 'monospace',
            letterSpacing: 2,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {active ? `${displayMultiplier.toFixed(2)}×` : last ? `${last.multiplier.toFixed(2)}×` : '1.00×'}
        </div>
        <div className="muted small" style={{ marginTop: 4, position: 'relative', zIndex: 1 }}>
          {active ? (
            <>Live · cashing out now → <strong style={{ color: '#6ed09a' }}>+${(potentialPayout - active.bet).toLocaleString()}</strong></>
          ) : last ? (
            <>{last.outcome === 'bust' ? '💥 BUSTED' : '💰 Cashed out'} · rocket would have exploded at <strong>{last.crashAt.toFixed(2)}×</strong></>
          ) : (
            'Idle · pick a bet and launch'
          )}
        </div>
        {active && (
          <button
            className="btn btn-accent"
            onClick={cashout}
            style={{
              marginTop: 16, padding: '14px 28px', fontSize: 18, fontWeight: 700,
              background: '#1a7c4a', borderColor: '#2da66a',
            }}
          >
            💰 Cash Out · ${potentialPayout.toLocaleString()}
          </button>
        )}
      </div>

      {/* ===== Bet picker (locked while round in flight) ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Place your bet</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {PRESET_BETS.map((b) => (
            <button
              key={b}
              className={`btn ${bet === b ? 'btn-accent' : ''}`}
              onClick={() => setBet(b)}
              disabled={!!active || b > CRASH_MAX_BET}
            >${b.toLocaleString()}</button>
          ))}
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="field-label">Or custom — ${bet.toLocaleString()} <span className="muted small">(max ${CRASH_MAX_BET.toLocaleString()})</span></span>
          <input
            type="range"
            min={CRASH_MIN_BET}
            max={CRASH_MAX_BET}
            step={500}
            value={bet}
            onChange={(e) => setBet(Number(e.target.value))}
            disabled={!!active}
          />
        </label>
        <button
          className="btn btn-accent"
          disabled={!canStart}
          onClick={() => start(bet)}
          title={disabledReason || `Launch — risk $${bet.toLocaleString()}`}
          style={{ marginTop: 12, padding: '10px 16px', fontSize: 14 }}
        >
          🚀 Launch
        </button>
      </div>

      {/* ===== Last round ===== */}
      {playedThisSession && last && !active && (
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Last round</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 8, marginTop: 8 }}>
            <Stat label="Outcome" value={last.outcome === 'cashout' ? '💰 Cashed' : '💥 Busted'} color={last.outcome === 'cashout' ? '#6ed09a' : '#e25555'} />
            <Stat label="Locked at" value={`${last.multiplier.toFixed(2)}×`} color="#d4d8e1" />
            <Stat label="Crashed at" value={`${last.crashAt.toFixed(2)}×`} color="#f2c443" />
            <Stat label="Bet" value={`$${last.bet.toLocaleString()}`} color="#d4d8e1" />
            <Stat
              label="Delta"
              value={last.delta >= 0 ? `+$${last.delta.toLocaleString()}` : `-$${Math.abs(last.delta).toLocaleString()}`}
              color={last.delta >= 0 ? '#6ed09a' : '#e25555'}
              big
            />
          </div>
        </div>
      )}

      {/* ===== Running session ===== */}
      {session.rounds > 0 && (
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Session</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 8, marginTop: 8 }}>
            <Stat label="Rounds" value={String(session.rounds)} color="#d4d8e1" />
            <Stat label="Cashouts" value={String(session.cashouts)} color="#6ed09a" />
            <Stat label="Busts" value={String(session.busts)} color="#e25555" />
            <Stat
              label="Net"
              value={session.netCash >= 0 ? `+$${session.netCash.toLocaleString()}` : `-$${Math.abs(session.netCash).toLocaleString()}`}
              color={session.netCash >= 0 ? '#6ed09a' : '#e25555'}
              big
            />
          </div>
        </div>
      )}
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

/** Colour ramp keyed off multiplier — green low, yellow mid, red high.
 *  Visually signals tension as the rocket climbs. */
function tensionColor(m: number): string {
  if (m < 1.5) return '#6ed09a';
  if (m < 3) return '#a8d96e';
  if (m < 5) return '#f2c443';
  if (m < 10) return '#f28a43';
  return '#e25555';
}
