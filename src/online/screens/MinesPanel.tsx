// Mines — Stake-style risk-management grid. 5×5 board, user chooses how
// many mines to hide (1–24) + bet amount. Click safe tiles to grow the
// multiplier; one mine ends the round with the entire bet lost. Cash out
// at any time after at least one safe reveal.
//
// Server is sole authority on tile contents — the client only ever sees
// tiles it has already picked, plus the full mine layout once the round
// ends (for visual closure).

import { useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  MINES_GRID_SIZE,
  MINES_MAX_BET,
  MINES_MAX_MINES,
  MINES_MIN_BET,
  MINES_MIN_MINES,
  minesMultiplier,
} from '../protocol';

const PRESET_BETS = [500, 1000, 5000, 10000, 25000, 50000];
const PRESET_MINES = [1, 3, 5, 10, 24];

export default function MinesPanel(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const active = useOnline((s) => s.minesActive);
  const last = useOnline((s) => s.minesLast);
  const session = useOnline((s) => s.minesSession);
  const start = useOnline((s) => s.startMines);
  const pick = useOnline((s) => s.pickMineTile);
  const cashout = useOnline((s) => s.cashoutMines);

  const [bet, setBet] = useState(1000);
  const [mineCount, setMineCount] = useState(3);

  if (!team) return null;

  const canStart = !active && team.money >= bet && bet >= MINES_MIN_BET && mineCount >= MINES_MIN_MINES && mineCount <= MINES_MAX_MINES;
  const startDisabledReason =
    active ? 'Round in progress — pick tiles or cash out.' :
    team.money < bet ? `Need $${bet.toLocaleString()} on hand.` :
    bet < MINES_MIN_BET ? `Bet must be at least $${MINES_MIN_BET.toLocaleString()}.` :
    '';

  // Multiplier preview for the bet picker: what the FIRST safe pick will pay.
  const nextMultiplierPreview = minesMultiplier(mineCount, 1);

  // Tile state map for rendering. Live round: server-confirmed safe tiles
  // glow green, everything else is clickable. Last round: full reveal.
  const revealedSafe = new Set<number>(active?.revealedSafe ?? []);
  const lastMines = new Set<number>(last?.mineIndices ?? []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14 }}>
        <div className="muted small">
          <strong>💣 Mines</strong> · 5×5 grid with N hidden mines. Reveal a safe tile to grow the multiplier
          ({nextMultiplierPreview.toFixed(2)}× after the first safe pick on {mineCount}-mine board).
          {' '}<span style={{ color: '#6ed09a' }}>Cash out</span> anytime; hit a mine and the bet is gone.
        </div>
      </div>

      {/* ===== Bet + mine count picker (locked during a round) ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Setup</div>
        <div style={{ marginTop: 8 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>Bet</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESET_BETS.map((b) => (
              <button
                key={b}
                className={`btn ${bet === b ? 'btn-accent' : ''}`}
                onClick={() => setBet(b)}
                disabled={!!active || b > MINES_MAX_BET}
              >${b.toLocaleString()}</button>
            ))}
          </div>
          <input
            type="range"
            min={MINES_MIN_BET}
            max={MINES_MAX_BET}
            step={500}
            value={bet}
            onChange={(e) => setBet(Number(e.target.value))}
            disabled={!!active}
            style={{ marginTop: 6, width: '100%' }}
          />
          <div className="muted small">${bet.toLocaleString()}</div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>Mines (more = bigger payouts, faster busts)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESET_MINES.map((m) => (
              <button
                key={m}
                className={`btn ${mineCount === m ? 'btn-accent' : ''}`}
                onClick={() => setMineCount(m)}
                disabled={!!active}
              >{m}</button>
            ))}
          </div>
          <input
            type="range"
            min={MINES_MIN_MINES}
            max={MINES_MAX_MINES}
            step={1}
            value={mineCount}
            onChange={(e) => setMineCount(Number(e.target.value))}
            disabled={!!active}
            style={{ marginTop: 6, width: '100%' }}
          />
          <div className="muted small">{mineCount} mines · first safe pick = {nextMultiplierPreview.toFixed(2)}×</div>
        </div>
        <button
          className="btn btn-accent"
          disabled={!canStart}
          onClick={() => start(bet, mineCount)}
          title={startDisabledReason || `Plant ${mineCount} mines · risk $${bet.toLocaleString()}`}
          style={{ marginTop: 12, padding: '10px 16px', fontSize: 14 }}
        >
          💣 Plant mines · risk ${bet.toLocaleString()}
        </button>
      </div>

      {/* ===== Live grid (during round OR post-round reveal) ===== */}
      {(active || last) && (
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <div className="panel-title">{active ? `Live · ${active.mineCount} mines` : `Last round · ${last!.outcome === 'cashout' ? 'cashed out' : 'busted'}`}</div>
            {active && (
              <div className="muted small">
                Multiplier <strong style={{ color: '#6ed09a' }}>{active.multiplier.toFixed(2)}×</strong>
                {' '}· payout <strong>${Math.round(active.bet * active.multiplier).toLocaleString()}</strong>
              </div>
            )}
            {!active && last && (
              <div className="muted small">
                Locked at <strong>{last.multiplier.toFixed(2)}×</strong>
                {' '}· {last.delta >= 0 ? <span style={{ color: '#6ed09a' }}>+${last.delta.toLocaleString()}</span> : <span style={{ color: '#e25555' }}>−${Math.abs(last.delta).toLocaleString()}</span>}
              </div>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 6,
              marginTop: 12,
              maxWidth: 380,
              marginInline: 'auto',
            }}
          >
            {Array.from({ length: MINES_GRID_SIZE }, (_, i) => {
              const isSafeRevealed = active ? revealedSafe.has(i) : false;
              const isMineRevealed = !active && last ? lastMines.has(i) : false;
              const isBustTile = !active && last?.bustTileIndex === i;
              const clickable = !!active && !isSafeRevealed;
              return (
                <Tile
                  key={i}
                  index={i}
                  onClick={() => clickable && pick(i)}
                  state={
                    isBustTile ? 'bust' :
                    isMineRevealed ? 'mine' :
                    isSafeRevealed ? 'safe' :
                    !active && last ? 'unrevealed-end' :
                    'hidden'
                  }
                  clickable={clickable}
                />
              );
            })}
          </div>

          {active && active.revealedSafe.length > 0 && (
            <button
              className="btn btn-accent"
              onClick={cashout}
              style={{
                marginTop: 14, padding: '12px 22px', fontSize: 15, fontWeight: 700,
                background: '#1a7c4a', borderColor: '#2da66a', display: 'block', marginInline: 'auto',
              }}
            >
              💰 Cash Out · ${Math.round(active.bet * active.multiplier).toLocaleString()}
            </button>
          )}
        </div>
      )}

      {/* ===== Session tally ===== */}
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

type TileState = 'hidden' | 'safe' | 'mine' | 'bust' | 'unrevealed-end';

function Tile({ index, onClick, state, clickable }: { index: number; onClick: () => void; state: TileState; clickable: boolean }): React.ReactElement {
  const styles: Record<TileState, React.CSSProperties> = {
    hidden: {
      background: 'linear-gradient(145deg, #2a2f3a, #1c2230)',
      border: '1px solid rgba(255,255,255,0.10)',
      color: 'transparent',
    },
    safe: {
      background: 'linear-gradient(145deg, #2d6b46, #1a4a30)',
      border: '2px solid #6ed09a',
      boxShadow: '0 0 12px rgba(110,208,154,0.35)',
      color: '#a8efbf',
    },
    mine: {
      background: 'linear-gradient(145deg, #4a2533, #2a1320)',
      border: '2px solid #e25555',
      color: '#ffb0b0',
    },
    bust: {
      background: 'linear-gradient(145deg, #8a1f1f, #4a1010)',
      border: '2px solid #ff5e5e',
      boxShadow: '0 0 18px rgba(255,94,94,0.6)',
      color: '#fff',
    },
    'unrevealed-end': {
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.05)',
      color: 'transparent',
    },
  };
  const glyph = state === 'safe' ? '💎' : state === 'mine' ? '💣' : state === 'bust' ? '💥' : '';
  return (
    <button
      aria-label={`tile ${index}`}
      onClick={onClick}
      disabled={!clickable}
      style={{
        aspectRatio: '1 / 1',
        borderRadius: 8,
        fontSize: 24,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 100ms ease, box-shadow 200ms ease',
        ...styles[state],
      }}
      onMouseDown={(e) => { if (clickable) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.94)'; }}
      onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = ''; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = ''; }}
    >
      {glyph}
    </button>
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
