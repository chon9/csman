// Scout commission gacha. Three tiers, each rolls one player onto the
// owner's roster (no FA-pool middleman). PA window per tier is fixed;
// CA is a random fraction of the rolled PA. Contract is 30 ranked
// duels — short enough that the user has to decide whether to renew.
// Reveal uses a cs-cases-style scroll animation over a server-supplied
// strip.

import { useEffect, useRef, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  MINT_TIERS,
  SCOUT_CONTRACT_DUELS,
  type MintTier,
  type ScoutStripEntry,
} from '../protocol';
import type { Player } from '../../types';
import ToastStack from './ToastStack';

const TILE_WIDTH = 130;
const VIEWPORT_WIDTH = 760;
const ANIM_MS = 5200;

export default function OnlineScoutScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const scout = useOnline((s) => s.mintFreeAgent);
  const reveal = useOnline((s) => s.scoutReveal);
  const dismissReveal = useOnline((s) => s.dismissScoutReveal);
  const go = useOnline((s) => s.go);

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Scout</h2>
          <div className="muted small">
            Commission a scout to roll one player straight onto your roster. PA range fixed by tier, CA random within it, contract = {SCOUT_CONTRACT_DUELS} ranked duels.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="muted small">Cash: <strong>${team.money.toLocaleString()}</strong></span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Pick a tier</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 10 }}>
          {(Object.keys(MINT_TIERS) as MintTier[]).map((tier) => {
            const meta = MINT_TIERS[tier];
            const afford = team.money >= meta.cost;
            return (
              <div
                key={tier}
                className="panel"
                style={{
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  borderTop: `3px solid ${meta.color}`,
                  background: `linear-gradient(180deg, ${meta.color}11, rgba(255,255,255,0.02))`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <strong style={{ color: meta.color }}>{meta.label}</strong>
                  <span className="num">${meta.cost.toLocaleString()}</span>
                </div>
                <div className="muted small">PA {meta.paRange[0]}–{meta.paRange[1]} · age {meta.ageRange[0]}–{meta.ageRange[1]}</div>
                <div className="muted small" style={{ fontSize: 11 }}>{meta.hint}</div>
                <button
                  className="btn btn-accent"
                  disabled={!afford || !!reveal}
                  onClick={() => scout(tier)}
                  title={afford ? `Commission a ${meta.label}` : `Need $${meta.cost.toLocaleString()}`}
                  style={{ marginTop: 'auto' }}
                >
                  🔬 Scout
                </button>
              </div>
            );
          })}
        </div>
        <div className="muted small" style={{ marginTop: 10 }}>
          Player drops onto your roster the moment the pack opens. You'll see them on the home screen + can apply tactics / lineup straight away.
        </div>
      </div>

      {reveal && (
        <ScoutRevealModal
          tier={reveal.tier}
          player={reveal.player}
          strip={reveal.strip}
          winnerIndex={reveal.winnerIndex}
          onClose={dismissReveal}
        />
      )}

      <ToastStack />
    </div>
  );
}

interface RevealProps {
  tier: MintTier;
  player: Player;
  strip: ScoutStripEntry[];
  winnerIndex: number;
  onClose: () => void;
}

function ScoutRevealModal({ tier, player, strip, winnerIndex, onClose }: RevealProps): React.ReactElement {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);
  const tierColor = MINT_TIERS[tier].color;

  // Run animation exactly once per mount.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = 'translateX(0)';
    void el.offsetWidth;
    const liveViewport = el.parentElement?.clientWidth ?? VIEWPORT_WIDTH;
    const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.4);
    const target = winnerIndex * TILE_WIDTH - (liveViewport / 2 - TILE_WIDTH / 2) + jitter;
    el.style.transition = `transform ${ANIM_MS}ms cubic-bezier(0.05, 0.65, 0.15, 1)`;
    el.style.transform = `translateX(-${target}px)`;
    const t = window.setTimeout(() => setRevealed(true), ANIM_MS + 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onClick={revealed ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 840, padding: 16 }}>
        <div className="modal-head" style={{ marginBottom: 10 }}>
          <h3>{revealed ? `🎉 ${MINT_TIERS[tier].label} report in!` : 'Scouting…'}</h3>
          {revealed && <button className="link-btn" onClick={onClose}>close ✕</button>}
        </div>

        <div
          className="case-opener-viewport"
          style={{
            width: VIEWPORT_WIDTH,
            maxWidth: '100%',
            overflow: 'hidden',
            position: 'relative',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            margin: '0 auto',
            height: 130,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 2,
              background: tierColor,
              transform: 'translateX(-50%)',
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
          <div ref={stripRef} style={{ display: 'flex', willChange: 'transform' }}>
            {strip.map((s, i) => (
              <ScoutTile key={i} entry={s} accent={tierColor} />
            ))}
          </div>
        </div>

        {revealed && (
          <div
            style={{
              marginTop: 14,
              padding: 16,
              borderRadius: 10,
              border: `2px solid ${tierColor}`,
              background: `linear-gradient(135deg, ${tierColor}22, transparent)`,
              boxShadow: `0 0 24px ${tierColor}44`,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 11, color: tierColor, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}>
              {MINT_TIERS[tier].label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{player.nickname}</div>
            <div className="muted">{player.firstName} {player.lastName} · {player.nationality}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 8, marginTop: 14 }}>
              <Stat label="Role" value={player.role} />
              <Stat label="Age" value={player.age.toFixed(0)} />
              <Stat label="CA" value={String(player.currentAbility)} color="#9be29b" />
              <Stat label="PA" value={String(player.potentialAbility)} color={tierColor} />
              <Stat label="Contract" value={`${SCOUT_CONTRACT_DUELS}d`} />
            </div>
            <button className="btn btn-accent" onClick={onClose} style={{ marginTop: 14 }}>
              Add to roster
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoutTile({ entry, accent }: { entry: ScoutStripEntry; accent: string }): React.ReactElement {
  return (
    <div
      style={{
        width: TILE_WIDTH,
        flex: '0 0 auto',
        boxSizing: 'border-box',
        height: 130,
        borderRadius: 8,
        border: `2px solid ${accent}`,
        background: `linear-gradient(180deg, rgba(255,255,255,0.04) 0%, ${accent}1f 55%, ${accent}3f 100%)`,
        boxShadow: `inset 0 -3px 0 ${accent}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '6px 8px',
          textAlign: 'center',
          fontSize: 13,
          fontWeight: 700,
          color: '#f3f4f7',
          background: 'rgba(0,0,0,0.25)',
          textShadow: '0 1px 2px rgba(0,0,0,0.6)',
        }}
      >{entry.nick}</div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          padding: 4,
        }}
      >
        <div style={{ fontSize: 11, color: '#d4d8e1' }}>{entry.role}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{entry.pa}</div>
        <div className="muted small" style={{ fontSize: 9, letterSpacing: 1 }}>PA</div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }): React.ReactElement {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 8px', borderRadius: 6 }}>
      <div className="muted small" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? '#e8eaf0' }}>{value}</div>
    </div>
  );
}
