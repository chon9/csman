// Rock-paper-scissors team-building round. Lives inside OnlineMiniGamesScreen
// as one of the tabs — no header, no back button. Free, capped per in-game
// day. Outcome adjusts morale of the 5 starters.

import { useOnline } from '../onlineStore';
import {
  MORALE_GAME_DELTAS,
  MORALE_GAME_PLAYS_PER_DAY,
  type RpsChoice,
} from '../protocol';

const CHOICES: { id: RpsChoice; emoji: string; label: string }[] = [
  { id: 'rock', emoji: '🪨', label: 'Rock' },
  { id: 'paper', emoji: '📄', label: 'Paper' },
  { id: 'scissors', emoji: '✂️', label: 'Scissors' },
];

export default function MoraleGamePanel(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const playsUsed = useOnline((s) => s.moraleGamePlaysUsed);
  const last = useOnline((s) => s.moraleGameLast);
  const session = useOnline((s) => s.moraleGameSession);
  const play = useOnline((s) => s.playMoraleGame);

  if (!team) return null;
  const playsLeft = Math.max(0, MORALE_GAME_PLAYS_PER_DAY - playsUsed);
  const canPlay = playsLeft > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14 }}>
        <div className="muted small">
          Play rock-paper-scissors with the squad. Free, {MORALE_GAME_PLAYS_PER_DAY} rounds per in-game day.
          Win <strong style={{ color: '#6ed09a' }}>+{MORALE_GAME_DELTAS.win}</strong>,
          tie <strong style={{ color: '#f2c443' }}>+{MORALE_GAME_DELTAS.tie}</strong>,
          loss <strong style={{ color: '#8b93a3' }}>{MORALE_GAME_DELTAS.loss > 0 ? `+${MORALE_GAME_DELTAS.loss}` : MORALE_GAME_DELTAS.loss}</strong>
          {' '}morale to each of the 5 starters.
        </div>
      </div>

      <div className="panel" style={{ padding: 18 }}>
        <div className="panel-title">
          Your pick <span className="muted small">{playsLeft}/{MORALE_GAME_PLAYS_PER_DAY} rounds left this game-day</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
          {CHOICES.map((c) => (
            <button
              key={c.id}
              onClick={() => canPlay && play(c.id)}
              disabled={!canPlay}
              title={!canPlay ? `Out of plays — wait for the next in-game day tick.` : `Play ${c.label}`}
              style={{
                padding: '20px 12px',
                borderRadius: 12,
                border: '2px solid rgba(255,255,255,0.10)',
                background: canPlay ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                color: canPlay ? '#e8eaf0' : '#5d6678',
                cursor: canPlay ? 'pointer' : 'not-allowed',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                transition: 'transform 0.1s ease, background 0.1s ease',
              }}
              onMouseEnter={(e) => { if (canPlay) e.currentTarget.style.background = 'rgba(222,155,53,0.12)'; }}
              onMouseLeave={(e) => { if (canPlay) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
            >
              <div style={{ fontSize: 44 }}>{c.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</div>
            </button>
          ))}
        </div>
      </div>

      {last && (
        <div className="panel" style={{ padding: 16 }}>
          <div className="panel-title">Last round</div>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            <RpsCard who="You" pick={last.yourPick} winner={last.outcome === 'win'} />
            <div style={{ fontSize: 22, fontWeight: 800, color: outcomeColor(last.outcome), textAlign: 'center' }}>
              <div>{outcomeLabel(last.outcome)}</div>
              <div style={{ fontSize: 14, color: last.moraleDelta > 0 ? '#6ed09a' : '#8b93a3', marginTop: 4 }}>
                Morale {last.moraleDelta > 0 ? `+${last.moraleDelta}` : last.moraleDelta} to starters
              </div>
            </div>
            <RpsCard who="Squad" pick={last.aiPick} winner={last.outcome === 'loss'} />
          </div>
        </div>
      )}

      {(session.wins + session.ties + session.losses) > 0 && (
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Today's session</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginTop: 8 }}>
            <Stat label="Wins" value={String(session.wins)} color="#6ed09a" />
            <Stat label="Ties" value={String(session.ties)} color="#f2c443" />
            <Stat label="Losses" value={String(session.losses)} color="#e25555" />
            <Stat label="Total morale" value={`+${session.totalMorale}`} color="#9be29b" big />
          </div>
        </div>
      )}
    </div>
  );
}

function RpsCard({ who, pick, winner }: { who: string; pick: RpsChoice; winner: boolean }): React.ReactElement {
  const meta = CHOICES.find((c) => c.id === pick)!;
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        background: 'rgba(255,255,255,0.03)',
        border: `2px solid ${winner ? '#6ed09a' : 'rgba(255,255,255,0.08)'}`,
        textAlign: 'center',
        minWidth: 110,
        boxShadow: winner ? '0 0 16px rgba(110, 208, 154, 0.30)' : undefined,
      }}
    >
      <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 }}>{who}</div>
      <div style={{ fontSize: 40, margin: '6px 0 2px' }}>{meta.emoji}</div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{meta.label}</div>
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

function outcomeLabel(o: 'win' | 'tie' | 'loss'): string {
  return o === 'win' ? '🎉 Win!' : o === 'tie' ? '🤝 Draw' : '😅 Loss';
}
function outcomeColor(o: 'win' | 'tie' | 'loss'): string {
  return o === 'win' ? '#6ed09a' : o === 'tie' ? '#f2c443' : '#e25555';
}
