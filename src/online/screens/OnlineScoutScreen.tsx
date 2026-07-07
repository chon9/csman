// Scout pack — one button, one cost, rarity rolled server-side. Opens
// like an FC pack: idle pack shimmers → click to crack → light burst in
// the rolled rarity colour → player card slides up → stats reveal in
// staggered order, with PA flashing LAST as the big payoff.
//
// The cost is intentionally flat ($15k). Pulling a Gold / Rare Gold /
// ICON is rare on purpose — the dopamine spike of the rarity flash is
// the whole hook.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  SCOUT_CONTRACT_DUELS,
  SCOUT_COST,
  SCOUT_RARITY_META,
  SCOUT_RARITY_WEIGHTS,
  findTrait,
  type ScoutRarity,
} from '../protocol';
import type { Player } from '../../types';
import { play } from '../../sound/soundManager';
import ToastStack from './ToastStack';
import Icon from '../../ui/Icon';

export default function OnlineScoutScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const scout = useOnline((s) => s.mintFreeAgent);
  const reveal = useOnline((s) => s.scoutReveal);
  const dismissReveal = useOnline((s) => s.dismissScoutReveal);
  const go = useOnline((s) => s.go);

  if (!team) return null;
  const afford = team.money >= SCOUT_COST;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="scout" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Scout Pack</h2>
            <div className="hero-sub">
              One pack, one player. Rarity is rolled when the pack cracks — Bronze through ICON. Contract = {SCOUT_CONTRACT_DUELS} ranked duels.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="cash" size={13} /> ${team.money.toLocaleString()}
          </span>
          <button className="btn" onClick={() => go('home')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="chevron-left" size={13} /> Back
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <PackTile />
        <button
          className="btn btn-accent"
          disabled={!afford || !!reveal}
          onClick={() => { play('case-tick'); scout(); }}
          style={{ fontSize: 16, padding: '10px 24px', fontWeight: 800, minWidth: 220 }}
          title={afford ? `Open a pack for $${SCOUT_COST.toLocaleString()}` : `Need $${SCOUT_COST.toLocaleString()}`}
        >
          {reveal ? 'Opening…' : `🎁 Open Pack — $${SCOUT_COST.toLocaleString()}`}
        </button>

        {/* Drop rates so people understand what they're rolling against. */}
        <DropRateTable />
      </div>

      {reveal && (
        <PackOpenReveal
          rarity={reveal.rarity}
          player={reveal.player}
          onClose={dismissReveal}
        />
      )}

      <ToastStack />
    </div>
  );
}

/** The idle pack — pulsing card with a sweeping shimmer across the front. */
function PackTile(): React.ReactElement {
  return (
    <div
      style={{
        width: 200,
        height: 280,
        borderRadius: 14,
        background: 'linear-gradient(135deg, #1d3b5c 0%, #2a1b4a 60%, #5c1d4a 100%)',
        border: '2px solid rgba(255,255,255,0.18)',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 0 30px rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        animation: 'pack-pulse 2.4s ease-in-out infinite',
      }}
    >
      <div style={{ fontSize: 72, filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))' }}>🎁</div>
      <div style={{ fontSize: 12, letterSpacing: 4, color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>SCOUT PACK</div>
      <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(255,255,255,0.55)' }}>1 player · sealed</div>
      <Shimmer />
      <style>{`
        @keyframes pack-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
        @keyframes shimmer-sweep { 0% { transform: translateX(-150%) skewX(-20deg); } 100% { transform: translateX(250%) skewX(-20deg); } }
        @keyframes burst-out { 0% { transform: scale(0.4); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(2.4); opacity: 0; } }
        @keyframes card-rise { 0% { transform: translateY(50px) scale(0.85); opacity: 0; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
        @keyframes stat-pop { 0% { transform: scale(0.6); opacity: 0; } 70% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes pa-flash { 0% { transform: scale(0.4); opacity: 0; } 40% { transform: scale(1.4); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes legendary-glow { 0%, 100% { box-shadow: 0 0 28px var(--rarity-glow), 0 0 48px var(--rarity-glow); } 50% { box-shadow: 0 0 56px var(--rarity-glow), 0 0 96px var(--rarity-glow); } }
      `}</style>
    </div>
  );
}

function Shimmer(): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
        animation: 'shimmer-sweep 2.6s ease-in-out infinite',
        pointerEvents: 'none',
      }}
    />
  );
}

/** Public drop-rate table — keeps the user informed so the pulls don't
 *  feel manipulative. */
function DropRateTable(): React.ReactElement {
  const total = Object.values(SCOUT_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  return (
    <div style={{ width: '100%', maxWidth: 520, marginTop: 4 }}>
      <div className="muted small" style={{ marginBottom: 4, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 }}>Drop rates</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        {(Object.keys(SCOUT_RARITY_WEIGHTS) as ScoutRarity[]).map((r) => {
          const meta = SCOUT_RARITY_META[r];
          const pct = ((SCOUT_RARITY_WEIGHTS[r] / total) * 100).toFixed(0);
          return (
            <div
              key={r}
              style={{
                padding: '6px 4px',
                borderRadius: 6,
                background: `${meta.color}15`,
                border: `1px solid ${meta.color}55`,
                textAlign: 'center',
              }}
              title={`PA ${meta.paRange[0]}-${meta.paRange[1]}`}
            >
              <div style={{ fontSize: 10, fontWeight: 800, color: meta.color, letterSpacing: 0.4 }}>{meta.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#d4d8e1' }}>{pct}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// Pack open reveal — sequenced animation
// =====================================================================

type RevealPhase = 'shake' | 'burst' | 'card' | 'stats' | 'pa' | 'done';

function PackOpenReveal({
  rarity, player, onClose,
}: {
  rarity: ScoutRarity;
  player: Player;
  onClose: () => void;
}): React.ReactElement {
  const meta = SCOUT_RARITY_META[rarity];
  const [phase, setPhase] = useState<RevealPhase>('shake');
  // Rare+ pull triggers a louder reveal — high-rarity audio cue.
  const isRare = rarity === 'gold' || rarity === 'rareGold' || rarity === 'icon';

  useEffect(() => {
    // Sequence: shake (700ms) → burst (700ms) → card slides up (600ms)
    // → stats stagger (1200ms total) → PA flash (700ms) → done.
    const timers: number[] = [];
    timers.push(window.setTimeout(() => { setPhase('burst'); play(isRare ? 'case-rare' : 'case-reveal'); }, 700));
    timers.push(window.setTimeout(() => setPhase('card'), 1400));
    timers.push(window.setTimeout(() => setPhase('stats'), 2000));
    timers.push(window.setTimeout(() => { setPhase('pa'); if (isRare) play('case-rare'); }, 3200));
    timers.push(window.setTimeout(() => setPhase('done'), 4000));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [isRare]);

  const cardVisible = phase === 'card' || phase === 'stats' || phase === 'pa' || phase === 'done';
  const statsVisible = phase === 'stats' || phase === 'pa' || phase === 'done';
  const paVisible = phase === 'pa' || phase === 'done';

  return (
    <div className="modal-backdrop" onClick={phase === 'done' ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, padding: 22, background: '#0a0d12', overflow: 'hidden' }}>
        {/* ===== Shake / burst stage ===== */}
        <div style={{ position: 'relative', height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Idle/shaking pack — disappears once burst lands. */}
          {(phase === 'shake' || phase === 'burst') && (
            <div
              style={{
                width: 180, height: 250, borderRadius: 14,
                background: 'linear-gradient(135deg, #1d3b5c 0%, #2a1b4a 60%, #5c1d4a 100%)',
                border: '2px solid rgba(255,255,255,0.18)',
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                animation: phase === 'shake' ? 'pack-pulse 0.18s ease-in-out infinite' : 'none',
                opacity: phase === 'burst' ? 0.3 : 1,
                transition: 'opacity 200ms ease-out',
              }}
            >
              <div style={{ fontSize: 64 }}>🎁</div>
              <Shimmer />
            </div>
          )}

          {/* Burst flare — color of rolled rarity. */}
          {(phase === 'burst' || phase === 'card') && (
            <div
              style={{
                position: 'absolute',
                width: 220, height: 220, borderRadius: '50%',
                background: `radial-gradient(circle, ${meta.color} 0%, ${meta.color}80 35%, transparent 70%)`,
                animation: 'burst-out 900ms ease-out forwards',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Player card — slides up after burst. */}
          {cardVisible && (
            <div
              style={{
                position: 'absolute',
                width: 240, height: 320,
                borderRadius: 12,
                background: `linear-gradient(180deg, ${meta.color}33 0%, #0a0d12 70%)`,
                border: `3px solid ${meta.color}`,
                boxShadow: `0 0 32px ${meta.glow}, inset 0 0 24px ${meta.color}22`,
                animation: rarity === 'icon'
                  ? 'card-rise 600ms ease-out forwards, legendary-glow 1.8s ease-in-out infinite 600ms'
                  : 'card-rise 600ms ease-out forwards',
                ['--rarity-glow' as string]: meta.glow,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '14px 12px',
                overflow: 'hidden',
              } as React.CSSProperties}
            >
              {/* Rarity ribbon */}
              <div style={{
                fontSize: 11, letterSpacing: 2.4, color: meta.color, fontWeight: 800, textShadow: `0 0 6px ${meta.glow}`,
              }}>{meta.label.toUpperCase()}</div>

              {/* Name + nation */}
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 8, textAlign: 'center' }}>
                {player.nickname}
              </div>
              <div className="muted small" style={{ fontSize: 11, textAlign: 'center' }}>
                {player.firstName} {player.lastName} · {player.nationality}
              </div>

              {/* Mini stat grid (Role / Age / CA) — reveals at stats phase. */}
              {statsVisible && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
                  marginTop: 14, width: '100%',
                }}>
                  <RevealStat label="Role" value={player.role} delay={0} />
                  <RevealStat label="Age" value={player.age.toFixed(0)} delay={200} />
                  <RevealStat label="CA" value={String(player.currentAbility)} color="#9be29b" delay={400} />
                </div>
              )}

              {/* The big PA flash. */}
              {paVisible && (
                <div style={{
                  marginTop: 14, padding: '10px 18px',
                  borderRadius: 8,
                  background: `linear-gradient(135deg, ${meta.color}, ${meta.color}aa)`,
                  color: '#0a0d12',
                  fontWeight: 900,
                  letterSpacing: 1,
                  fontSize: 24,
                  textShadow: 'none',
                  boxShadow: `0 0 24px ${meta.glow}`,
                  animation: 'pa-flash 700ms cubic-bezier(0.2, 0.8, 0.3, 1.2) forwards',
                }}>
                  PA {player.potentialAbility}
                </div>
              )}

              {/* Trait chips — same reveal beat as PA, capped at 3. */}
              {paVisible && player.traits && player.traits.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                  {player.traits.map((id) => {
                    const trait = findTrait(id);
                    if (!trait) return null;
                    const positive = trait.tone === 'positive';
                    return (
                      <span
                        key={id}
                        title={trait.description}
                        style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                          background: positive ? 'rgba(110,208,154,0.16)' : 'rgba(226,85,85,0.14)',
                          border: `1px solid ${positive ? 'rgba(110,208,154,0.6)' : 'rgba(226,85,85,0.6)'}`,
                          color: positive ? '#6ed09a' : '#e25555',
                        }}
                      >
                        {trait.icon} {trait.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {paVisible && (!player.traits || player.traits.length === 0) && (
                <div className="muted small" style={{ marginTop: 10, fontSize: 10, opacity: 0.6 }}>No traits</div>
              )}
            </div>
          )}
        </div>

        {/* Bottom-row CTA + summary. */}
        {phase === 'done' ? (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div className="muted small" style={{ textAlign: 'center' }}>
              {player.nickname} signed onto your roster · {SCOUT_CONTRACT_DUELS}-duel contract.
            </div>
            <button className="btn btn-accent" onClick={onClose} style={{ minWidth: 180 }}>
              Add to roster
            </button>
          </div>
        ) : (
          <div className="muted small" style={{ marginTop: 14, textAlign: 'center', letterSpacing: 2, textTransform: 'uppercase', fontSize: 10 }}>
            Opening pack…
          </div>
        )}
      </div>
    </div>
  );
}

/** Single stat cell with a staggered pop-in based on delay. */
function RevealStat({ label, value, color, delay }: { label: string; value: string; color?: string; delay: number }): React.ReactElement {
  const style = useMemo<React.CSSProperties>(() => ({
    background: 'rgba(255,255,255,0.04)',
    padding: '6px 4px',
    borderRadius: 6,
    textAlign: 'center',
    animation: `stat-pop 360ms ease-out ${delay}ms backwards`,
  }), [delay]);
  return (
    <div style={style}>
      <div className="muted small" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? '#e8eaf0' }}>{value}</div>
    </div>
  );
}
