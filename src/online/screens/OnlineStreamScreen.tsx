// Streaming hub — pick a roster player to grind a Faceit pickup game.
// Costs fatigue + one contract duel per session; pays out based on the
// streamer's CA/PA and the team's total fan count. Random chance per
// stream of a +1 gameplay attribute tick (slow-drip training perk).
//
// No daily cap — fatigue (≥75 = locked) + contract duels are the natural
// limits. Top players grind multiple streams per real day but burn
// through their contracts faster.

import { useMemo } from 'react';
import { useOnline } from '../onlineStore';
import {
  STREAM_CONTRACT_COST,
  STREAM_FATIGUE_COST,
  STREAM_MAX_FATIGUE,
  fansForPlayer,
  fansForRoster,
} from '../protocol';
import ToastStack from './ToastStack';

const ATTR_LABELS: Record<string, string> = {
  aim: 'Aim',
  reflexes: 'Reflexes',
  positioning: 'Positioning',
  gameSense: 'Game Sense',
  clutch: 'Clutch',
};

export default function OnlineStreamScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const playersMap = useOnline((s) => s.players);
  const reveal = useOnline((s) => s.streamReveal);
  const session = useOnline((s) => s.streamSession);
  const streamPlayer = useOnline((s) => s.streamPlayer);
  const dismissReveal = useOnline((s) => s.dismissStreamReveal);
  const go = useOnline((s) => s.go);

  const roster = useMemo(() => {
    if (!team) return [];
    return team.playerIds.map((id) => playersMap[id]).filter((p): p is NonNullable<typeof p> => !!p);
  }, [team, playersMap]);

  const teamFans = useMemo(() => fansForRoster(roster), [roster]);

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>📺 Streaming</h2>
          <div className="muted small">
            Pick a player to grind a Faceit pickup. They gain {STREAM_FATIGUE_COST} fatigue and burn {STREAM_CONTRACT_COST} contract duel · payout scales with team fans + player ability · 50% chance of +1 attribute (slow training).
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="muted small">Cash: <strong>${team.money.toLocaleString()}</strong></span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* ===== Fan banner ===== */}
      <div
        className="panel"
        style={{
          padding: 18,
          background: 'linear-gradient(135deg, #1d3b5c 0%, #5c1d4a 100%)',
          border: '1px solid rgba(255,255,255,0.10)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div className="muted small" style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>Team fans</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginTop: 2 }}>{teamFans.toLocaleString()}</div>
          <div className="muted small" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Drives every streamer's payout. Sign higher-CA / higher-PA players to grow the brand.
          </div>
        </div>
        {session.streams > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, minWidth: 280 }}>
            <Stat label="Streams" value={String(session.streams)} color="#d4d8e1" />
            <Stat label="Earned" value={`$${session.totalEarned.toLocaleString()}`} color="#6ed09a" big />
            <Stat label="Trained" value={String(session.trainingHits)} color="#f2c443" />
          </div>
        )}
      </div>

      {/* ===== Roster picker ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Roster</div>
        {roster.length === 0 ? (
          <div className="muted small" style={{ marginTop: 8 }}>
            No players on the roster — sign at least one player before streaming.
          </div>
        ) : (
          <table className="table table-dense" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th className="num">CA</th>
                <th className="num">PA</th>
                <th className="num">Solo fans</th>
                <th className="num">Fatigue</th>
                <th className="num">Contract</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => {
                const tooTired = p.fatigue >= STREAM_MAX_FATIGUE;
                const duelsLeft = p.contract?.duelsRemaining;
                const noContract = typeof duelsLeft === 'number' && duelsLeft < STREAM_CONTRACT_COST;
                const disabled = tooTired || noContract;
                const reason =
                  tooTired ? `Fatigue ${Math.round(p.fatigue)} ≥ ${STREAM_MAX_FATIGUE} — needs rest` :
                  noContract ? 'Contract expired — renew first' :
                  `Stream — +${STREAM_FATIGUE_COST} fatigue · -1 contract duel`;
                return (
                  <tr key={p.id}>
                    <td><strong>{p.nickname}</strong> <span className="muted small">{p.firstName} {p.lastName}</span></td>
                    <td>{p.role}</td>
                    <td className="num">{p.currentAbility}</td>
                    <td className="num">{p.potentialAbility}</td>
                    <td className="num">{fansForPlayer(p).toLocaleString()}</td>
                    <td className="num" style={{ color: p.fatigue >= 60 ? '#f2c443' : tooTired ? '#e25555' : undefined }}>
                      {Math.round(p.fatigue)}%
                    </td>
                    <td className="num" style={{ color: typeof duelsLeft === 'number' && duelsLeft <= 5 ? '#e25555' : undefined }}>
                      {typeof duelsLeft === 'number' ? duelsLeft : '∞'}
                    </td>
                    <td>
                      <button
                        className="btn btn-tiny btn-accent"
                        disabled={disabled}
                        onClick={() => streamPlayer(p.id)}
                        title={reason}
                      >
                        📺 Stream
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {reveal && (
        <StreamRevealModal onClose={dismissReveal} />
      )}

      <ToastStack />
    </div>
  );
}

function StreamRevealModal({ onClose }: { onClose: () => void }): React.ReactElement | null {
  const reveal = useOnline((s) => s.streamReveal);
  const playersMap = useOnline((s) => s.players);
  if (!reveal) return null;
  const player = playersMap[reveal.playerId];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, padding: 20 }}>
        <div className="modal-head" style={{ marginBottom: 10 }}>
          <h3>📺 Stream wrapped!</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'linear-gradient(135deg, rgba(110,208,154,0.10), rgba(75,105,255,0.10))',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#9fb4e4' }}>{player?.nickname ?? 'Streamer'}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginTop: 4 }}>
            +${reveal.payout.toLocaleString()}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {reveal.viewers.toLocaleString()} viewers · {reveal.teamFans.toLocaleString()} team fans
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 8, marginTop: 14 }}>
            <Stat label="Fatigue" value={`+${reveal.fatigueDelta}`} color="#f28a43" />
            <Stat label="Morale" value={`+${reveal.moraleDelta}`} color="#6ed09a" />
            <Stat label="Contract" value={`${reveal.duelsRemaining}d left`} color={reveal.duelsRemaining <= 5 ? '#e25555' : '#d4d8e1'} />
          </div>
          {reveal.trainingGained && (
            <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: 'rgba(242,196,67,0.10)', border: '1px solid rgba(242,196,67,0.35)' }}>
              <div style={{ fontSize: 12, color: '#f2c443', fontWeight: 700, letterSpacing: 0.5 }}>
                🎯 +1 {ATTR_LABELS[reveal.trainingGained.attr] ?? reveal.trainingGained.attr} → {reveal.trainingGained.newValue}
              </div>
              <div className="muted small">Solo training rep from the pickup game.</div>
            </div>
          )}
        </div>
        <button className="btn btn-accent" onClick={onClose} style={{ marginTop: 14, width: '100%' }}>
          End stream
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }): React.ReactElement {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
      <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: big ? 20 : 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
