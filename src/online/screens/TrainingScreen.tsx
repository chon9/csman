// Training Center — high-risk / high-return idle training for newgens.
//
// Three view states, mutually exclusive:
//   1. Idle (no session) → attribute picker + player picker + Start
//   2. In-progress (session != null) → countdown + Collect / Cancel
//   3. Result modal (trainingResult != null) → outcome card, dismissable
//
// Real-name (HLTV) players are ineligible; the picker filters them out.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import type { Player } from '../../types';
import type { PlayerAttributes } from '../../types';
import type { TrainingOutcome, TrainingRarity, TrainingSessionWire } from '../protocol';
import { TRAINING_DURATION_MS, TRAINING_ODDS, trainingRarityFor } from '../protocol';
import { ATTRIBUTE_KEYS } from '../../types';
import type { PlayerRole } from '../../types';
import ToastStack from './ToastStack';

type AttrKey = keyof PlayerAttributes;

const RARITY_META: Record<TrainingRarity, { label: string; color: string }> = {
  common:    { label: 'Common',    color: '#8b93a3' },
  rare:      { label: 'Rare',      color: '#4b69ff' },
  epic:      { label: 'Epic',      color: '#8847ff' },
  legendary: { label: 'Legendary', color: '#eb4b4b' },
};

/** Attribute groups + friendly labels, mirrored from types.ts ATTRIBUTE_GROUPS
 *  but keyed just at the display level. */
const ATTR_GROUPS: Array<{ label: string; keys: AttrKey[] }> = [
  { label: 'Technical', keys: ['aim', 'reflexes', 'positioning', 'utility', 'clutch'] },
  { label: 'Mental',    keys: ['gameSense', 'communication', 'leadership', 'consistency', 'composure', 'resilience', 'discipline', 'aggression', 'teamwork', 'loyalty'] },
  { label: 'Physical',  keys: ['endurance'] },
];

const ATTR_LABEL: Record<AttrKey, string> = {
  aim: 'Aim', reflexes: 'Reflexes', positioning: 'Positioning', utility: 'Utility', clutch: 'Clutch',
  gameSense: 'Game Sense', communication: 'Comms', leadership: 'Leadership', consistency: 'Consistency',
  composure: 'Composure', resilience: 'Resilience', discipline: 'Discipline', aggression: 'Aggression',
  teamwork: 'Teamwork', loyalty: 'Loyalty', endurance: 'Endurance',
};

/** Weights of each attribute in the match engine's effective-skill formula.
 *  Higher = bigger impact on duel outcomes. Anything at 0 has only
 *  situational/indirect effects (utility damage, clutch multiplier, etc.).
 *  Source: [src/engine/matchEngine.ts effectiveSkill()].
 *  This is the "generic" ranking used before a player is picked. Once a
 *  role is known, ROLE_WEIGHTS below takes precedence (e.g. Leadership
 *  jumps to S-tier for IGLs). */
const ATTR_CORE_WEIGHT: Record<AttrKey, number> = {
  aim: 0.28, reflexes: 0.20, positioning: 0.17, gameSense: 0.15,
  consistency: 0.10, composure: 0.10,
  // Below have indirect / situational effects — surfaced in the tooltip.
  utility: 0, clutch: 0, leadership: 0, teamwork: 0, resilience: 0,
  communication: 0, discipline: 0, aggression: 0, loyalty: 0, endurance: 0,
};

/** Per-role attribute weight tables. Kept in sync with ROLE_WEIGHTS in
 *  playerAnalytics.ts (that's the source of truth used by the engine's
 *  role-fit modifier). Duplicated here to avoid importing sim code from
 *  the online bundle. If you tune those weights, mirror them here. */
const ROLE_WEIGHTS: Record<PlayerRole, Partial<Record<AttrKey, number>>> = {
  IGL:     { leadership: 0.28, gameSense: 0.22, communication: 0.18, composure: 0.10, teamwork: 0.07, aim: 0.05, reflexes: 0.05, positioning: 0.05 },
  AWPer:   { aim: 0.26, reflexes: 0.20, positioning: 0.18, composure: 0.12, clutch: 0.08, gameSense: 0.08, consistency: 0.08 },
  Entry:   { reflexes: 0.22, aim: 0.20, aggression: 0.18, teamwork: 0.12, positioning: 0.08, composure: 0.08, gameSense: 0.06, consistency: 0.06 },
  Lurker:  { positioning: 0.22, gameSense: 0.22, clutch: 0.18, composure: 0.12, aim: 0.12, consistency: 0.08, reflexes: 0.06 },
  Support: { utility: 0.28, teamwork: 0.20, communication: 0.14, gameSense: 0.14, aim: 0.10, positioning: 0.08, composure: 0.06 },
  Rifler:  { aim: 0.18, reflexes: 0.15, positioning: 0.15, gameSense: 0.12, consistency: 0.10, teamwork: 0.10, composure: 0.10, clutch: 0.10 },
  Anchor:  { positioning: 0.24, composure: 0.18, clutch: 0.15, aim: 0.12, gameSense: 0.12, utility: 0.10, consistency: 0.09 },
};

/** Non-core attributes still have real effects; describe them in one
 *  line so the user doesn't dismiss them as useless. */
const ATTR_HINT: Partial<Record<AttrKey, string>> = {
  utility:      'Drives grenade damage (molotovs, HE).',
  clutch:       '±12% in 1vX situations.',
  leadership:   'IGL call quality (mid-round decisions).',
  teamwork:     'Trade-frag success rate (up to +50%).',
  resilience:   'Pairs with composure to resist big-stage choke.',
  communication:'Info sharing quality — helps team-level plays.',
  discipline:   'Throw discipline, avoids mistakes, rotates on time.',
  aggression:   'Style modifier (not raw quality).',
  loyalty:      'Resists rival transfer offers.',
  endurance:    'Slower fatigue accumulation across long events.',
};

/** Impact tier for the ⭐ badge. S = single biggest lever for the target
 *  role (or duel-generic weight, if no role provided). Empty = situational.
 *  Once a player is picked, callers pass their role so IGLs correctly
 *  see Leadership at S-tier, Supports see Utility at S-tier, etc. */
function impactTier(k: AttrKey, role?: PlayerRole): 'S' | 'A' | 'B' | '' {
  const w = role ? (ROLE_WEIGHTS[role][k] ?? 0) : ATTR_CORE_WEIGHT[k];
  if (w >= 0.25) return 'S';
  if (w >= 0.15) return 'A';
  if (w >= 0.10) return 'B';
  return '';
}

/** Numeric weight for a role — used by the smart-nudge suggester. */
function weightFor(k: AttrKey, role?: PlayerRole): number {
  return role ? (ROLE_WEIGHTS[role][k] ?? 0) : ATTR_CORE_WEIGHT[k];
}
function impactColor(tier: 'S' | 'A' | 'B' | ''): string {
  return tier === 'S' ? 'var(--accent)' : tier === 'A' ? 'var(--win)' : tier === 'B' ? 'var(--info)' : 'transparent';
}

/** Color the numeric attribute value FM-style: dim below 8, neutral 8-13,
 *  green 14-16, gold 17-20. */
function attrValueColor(v: number): string {
  if (v >= 17) return 'var(--accent)';
  if (v >= 14) return 'var(--win)';
  if (v >= 8)  return 'var(--text)';
  return 'var(--muted)';
}

export default function TrainingScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const playersMap = useOnline((s) => s.players);
  const session = useOnline((s) => s.trainingSession);
  const result = useOnline((s) => s.trainingResult);
  const refresh = useOnline((s) => s.refreshTraining);
  const start = useOnline((s) => s.startTraining);
  const collect = useOnline((s) => s.collectTraining);
  const cancel = useOnline((s) => s.cancelTraining);
  const dismissResult = useOnline((s) => s.dismissTrainingResult);
  const go = useOnline((s) => s.go);

  const [pickedPlayer, setPickedPlayer] = useState<string | null>(null);
  const [pickedAttr, setPickedAttr] = useState<AttrKey>('aim');

  useEffect(() => { refresh(); }, [refresh]);

  const roster = useMemo(() => {
    if (!team) return [];
    return team.playerIds
      .map((id) => playersMap[id])
      .filter((p): p is Player => !!p);
  }, [team, playersMap]);

  const trainable = useMemo(
    () => roster.filter((p) => !p.isRealName && !p.retired),
    [roster],
  );

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="hero-panel">
        <div>
          <h2>🎯 Training Center</h2>
          <div className="hero-sub">
            5-minute idle training · high-risk, high-return · newgens only · real-name legends are evergreen
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* Warning strip */}
      <div className="panel panel-accent" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span className="section-title" style={{ margin: 0, flex: 'none' }}>What can happen</span>
        <span className="pill pill-accent">🌟 Jackpot · +PA break</span>
        <span className="pill pill-win">✓ Success · +1 attribute</span>
        <span className="pill pill-loss">↓ Setback · −1 attribute</span>
        <span className="pill pill-loss">💀 Career-ending · retired forever</span>
      </div>

      {session ? (
        <ActiveSession
          session={session}
          onCollect={collect}
          onCancel={cancel}
        />
      ) : (
        <Idle
          trainable={trainable}
          pickedPlayer={pickedPlayer}
          setPickedPlayer={setPickedPlayer}
          pickedAttr={pickedAttr}
          setPickedAttr={setPickedAttr}
          onStart={() => pickedPlayer && start(pickedPlayer, pickedAttr)}
          canStart={team.playerIds.length > 5}
        />
      )}

      {result && <ResultModal outcome={result} onDismiss={dismissResult} />}
      <ToastStack />
    </div>
  );
}

// ---------------------------------------------------------------------
// Idle: attribute picker + player picker + Start
// ---------------------------------------------------------------------

function Idle({
  trainable, pickedPlayer, setPickedPlayer, pickedAttr, setPickedAttr, onStart, canStart,
}: {
  trainable: Player[];
  pickedPlayer: string | null;
  setPickedPlayer: (id: string) => void;
  pickedAttr: AttrKey;
  setPickedAttr: (a: AttrKey) => void;
  onStart: () => void;
  canStart: boolean;
}): React.ReactElement {
  const target = trainable.find((p) => p.id === pickedPlayer) ?? null;
  const targetRarity = target ? trainingRarityFor(target.potentialAbility) : null;

  return (
    <>
      {/* Attribute picker */}
      <div className="panel">
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>1. Pick an attribute to train</span>
          <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            {target ? (
              <>Ranked for <strong style={{ color: 'var(--accent-hi)' }}>{target.role}</strong>: </>
            ) : (
              <>Generic duel weight: </>
            )}
            <span style={{ color: 'var(--accent)' }}>★</span> S &nbsp;·&nbsp;
            <span style={{ color: 'var(--win)' }}>★</span> A &nbsp;·&nbsp;
            <span style={{ color: 'var(--info)' }}>★</span> B &nbsp;·&nbsp; rest = situational
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {ATTR_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="section-title" style={{ margin: '0 0 var(--space-2)' }}>{group.label}</div>
              <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                {group.keys.filter((k) => ATTRIBUTE_KEYS.includes(k)).map((k) => {
                  const tier = impactTier(k, target?.role);
                  const weight = weightFor(k, target?.role);
                  const hint = ATTR_HINT[k];
                  const roleLabel = target ? target.role : 'duel skill';
                  return (
                    <button
                      key={k}
                      className={`btn ${pickedAttr === k ? 'btn-accent' : ''}`}
                      onClick={() => setPickedAttr(k)}
                      title={
                        tier
                          ? `${tier}-tier · ${(weight * 100).toFixed(0)}% weight for ${roleLabel}`
                          : hint ?? 'Situational effect only.'
                      }
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      {tier && <span style={{ color: impactColor(tier), fontSize: 14, lineHeight: 1 }}>★</span>}
                      {ATTR_LABEL[k]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Player picker */}
      <div className="panel">
        <div className="panel-title">2. Pick a newgen</div>
        {trainable.length === 0 ? (
          <div className="muted small">
            No newgens on your roster. Scout for young talent — real-name legends can't be trained here.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-2)' }}>
            {trainable.map((p) => {
              const rarity = trainingRarityFor(p.potentialAbility);
              const meta = RARITY_META[rarity];
              const isSel = p.id === pickedPlayer;
              return (
                <button
                  key={p.id}
                  onClick={() => setPickedPlayer(p.id)}
                  className="panel"
                  style={{
                    marginBottom: 0, textAlign: 'left', cursor: 'pointer',
                    padding: 'var(--space-3)',
                    borderColor: isSel ? meta.color : 'var(--border)',
                    background: isSel ? `${meta.color}18` : 'var(--panel)',
                    borderLeft: `3px solid ${isSel ? meta.color : 'transparent'}`,
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <strong style={{ color: isSel ? '#fff' : 'var(--text)' }}>{p.nickname}</strong>
                    <span className="pill" style={{ background: `${meta.color}22`, borderColor: `${meta.color}55`, color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="muted small" style={{ marginTop: 4 }}>
                    {p.role} · CA {p.currentAbility} · PA {p.potentialAbility} · Age {Math.floor(p.age)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Current attributes of the selected newgen — so you can see
       *  whether the picked attribute is worth training up right now. */}
      {target && (
        <AttributesPanel target={target} pickedAttr={pickedAttr} />
      )}

      {/* Odds preview + Start */}
      {target && targetRarity && (
        <OddsPanel target={target} attr={pickedAttr} rarity={targetRarity} />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <button
          className="btn btn-accent"
          disabled={!target || !canStart}
          onClick={onStart}
          style={{ padding: '10px 24px', fontSize: 'var(--text-lg)', fontWeight: 700 }}
          title={
            !target ? 'Pick a newgen first'
            : !canStart ? 'Sign a backup — roster at 5 puts you below minimum if training retires'
            : 'Start training — 5 real minutes'
          }
        >
          {target ? `▶ Start Training · ${target.nickname} → ${ATTR_LABEL[pickedAttr]} (5 min)` : '▶ Start Training'}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Attribute grid — current stats of the selected newgen, FM-style
// ---------------------------------------------------------------------

function AttributesPanel({ target, pickedAttr }: { target: Player; pickedAttr: AttrKey }): React.ReactElement {
  const role = target.role;
  const pickedTier = impactTier(pickedAttr, role);
  const pickedWeight = weightFor(pickedAttr, role);
  const suggestion = suggestBetter(target, pickedAttr);
  return (
    <div className="panel">
      <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>{target.nickname}'s current attributes <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, marginLeft: 6 }}>· ranked for {role}</span></span>
        <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
          Values 1–20 · <span style={{ color: 'var(--accent)' }}>gold</span> = 17+ ·
          <span style={{ color: 'var(--win)' }}> green</span> = 14–16
        </span>
      </div>
      {suggestion && (
        <div style={{
          padding: '8px 12px', marginBottom: 'var(--space-3)',
          background: 'var(--info-soft)', border: '1px solid rgba(90,164,230,0.35)',
          borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)',
        }}>
          💡 <strong>{suggestion.reason}</strong>&nbsp;
          <span className="muted">Consider {ATTR_LABEL[suggestion.attr]} ({target.attributes[suggestion.attr]}/20) instead.</span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {ATTR_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="section-title" style={{ margin: '0 0 var(--space-2)' }}>{group.label}</div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 'var(--space-1)',
            }}>
              {group.keys.filter((k) => ATTRIBUTE_KEYS.includes(k)).map((k) => {
                const v = target.attributes[k];
                const tier = impactTier(k, role);
                const isPicked = k === pickedAttr;
                return (
                  <div
                    key={k}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                      background: isPicked ? 'var(--accent-soft)' : 'var(--bg-elev)',
                      border: isPicked ? '1px solid var(--border-accent)' : '1px solid var(--border-soft)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-sm)' }}>
                      {tier && <span style={{ color: impactColor(tier), fontSize: 11 }}>★</span>}
                      <span style={{ color: isPicked ? 'var(--accent-hi)' : 'var(--text-dim)' }}>{ATTR_LABEL[k]}</span>
                    </span>
                    <strong style={{
                      color: attrValueColor(v),
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 'var(--text-lg)',
                    }}>{v}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 'var(--space-3)' }}>
        You picked <strong style={{ color: 'var(--accent-hi)' }}>{ATTR_LABEL[pickedAttr]} ({target.attributes[pickedAttr]}/20)</strong>
        {pickedTier
          ? ` — ${pickedTier}-tier for ${role} (${(pickedWeight * 100).toFixed(0)}% of role fit).`
          : ATTR_HINT[pickedAttr]
            ? ` — ${ATTR_HINT[pickedAttr]}`
            : ` — situational for ${role}.`}
      </div>
    </div>
  );
}

/** Suggest a smarter attribute pick using the target's ROLE weights.
 *  Fires in two cases:
 *   1. Picked attribute is already at 20 → suggest the lowest S/A-tier
 *      the role cares about that still has room.
 *   2. Picked attribute is non-core for this role AND at least one
 *      S-tier role-key stat is still under 15. Nudge to that stat. */
function suggestBetter(target: Player, pickedAttr: AttrKey): { attr: AttrKey; reason: string } | null {
  const attrs = target.attributes;
  const role = target.role;
  const pickedValue = attrs[pickedAttr];
  // Ordered role-key attrs (S then A tier by weight).
  const roleKeys = (Object.entries(ROLE_WEIGHTS[role]) as [AttrKey, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  const sTierKeys = roleKeys.filter((k) => (ROLE_WEIGHTS[role][k] ?? 0) >= 0.25);

  if (pickedValue >= 20) {
    const growable = roleKeys.filter((k) => attrs[k] < 20)[0];
    if (growable) return { attr: growable, reason: `${ATTR_LABEL[pickedAttr]} is already maxed for ${role}.` };
  }
  const pickedTier = impactTier(pickedAttr, role);
  if (!pickedTier) {
    // Prefer an S-tier role stat that's still low.
    const belowThreshold = sTierKeys.find((k) => attrs[k] < 15);
    if (belowThreshold) {
      return {
        attr: belowThreshold,
        reason: `${ATTR_LABEL[belowThreshold]} (${attrs[belowThreshold]}) is a top ${role} stat and still has room.`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Odds preview panel — shows base + adjusted odds for the picked target
// ---------------------------------------------------------------------

function OddsPanel({ target, attr, rarity }: { target: Player; attr: AttrKey; rarity: TrainingRarity }): React.ReactElement {
  const [retire, reduce, success, jackpot] = TRAINING_ODDS[rarity];
  const cr = Math.max(0, Math.min(40, (target.attributes.composure ?? 10) + (target.attributes.resilience ?? 10)));
  const shift = (cr / 40) * 0.5;
  const adj = {
    retire:  retire  * (1 - shift),
    reduce:  reduce  * (1 - shift),
    jackpot,
    success: success + (retire + reduce) - (retire * (1 - shift) + reduce * (1 - shift)),
  };
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const meta = RARITY_META[rarity];

  return (
    <div className="panel">
      <div className="panel-title">Odds for {target.nickname} → {ATTR_LABEL[attr]}</div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <span className="pill" style={{ background: `${meta.color}22`, borderColor: `${meta.color}55`, color: meta.color }}>
          {meta.label} tier
        </span>
        <span className="muted small">
          Composure {target.attributes.composure ?? 10} + Resilience {target.attributes.resilience ?? 10} = {cr}
          {shift > 0 && ` → cuts bad outcomes by ${Math.round(shift * 100)}%`}
        </span>
      </div>
      <OddsBar
        segments={[
          { label: 'Jackpot',      value: adj.jackpot, color: 'var(--accent)' },
          { label: 'Success (+1)', value: adj.success, color: 'var(--win)' },
          { label: 'Setback (-1)', value: adj.reduce,  color: '#f59e0b' },
          { label: 'Retire',       value: adj.retire,  color: 'var(--loss)' },
        ]}
        pct={pct}
      />
    </div>
  );
}

function OddsBar({ segments, pct }: {
  segments: Array<{ label: string; value: number; color: string }>;
  pct: (n: number) => string;
}): React.ReactElement {
  return (
    <div>
      <div style={{
        display: 'flex', height: 12, borderRadius: 'var(--radius-sm)',
        overflow: 'hidden', border: '1px solid var(--border)',
        marginBottom: 'var(--space-2)',
      }}>
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${s.value * 100}%`, background: s.color }} title={`${s.label}: ${pct(s.value)}`} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: 'inline-block' }} />
            <strong style={{ color: s.color }}>{pct(s.value)}</strong>
            <span className="muted">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Active session: countdown + Collect / Cancel
// ---------------------------------------------------------------------

function ActiveSession({
  session, onCollect, onCancel,
}: {
  session: TrainingSessionWire;
  onCollect: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const remaining = Math.max(0, session.readyAt - now);
  const elapsed = TRAINING_DURATION_MS - remaining;
  const pct = Math.min(100, (elapsed / TRAINING_DURATION_MS) * 100);
  const ready = remaining === 0;
  const s = Math.ceil(remaining / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const meta = RARITY_META[session.rarity];

  return (
    <div className="panel" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>
      <div className="section-title" style={{ justifyContent: 'center' }}>In progress</div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
        {session.playerNickname}
      </div>
      <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
        training <strong style={{ color: 'var(--accent)' }}>{ATTR_LABEL[session.attribute]}</strong>
        <span className="pill" style={{ marginLeft: 'var(--space-2)', background: `${meta.color}22`, borderColor: `${meta.color}55`, color: meta.color }}>
          {meta.label}
        </span>
      </div>

      <div style={{
        fontSize: '48px', fontWeight: 800, letterSpacing: 2,
        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
        color: ready ? 'var(--accent-hi)' : 'var(--text)',
        marginBottom: 'var(--space-3)',
      }}>
        {ready ? '✓ READY' : `${mm}:${ss.toString().padStart(2, '0')}`}
      </div>

      <div style={{
        width: '100%', height: 8, borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-elev)', border: '1px solid var(--border)',
        overflow: 'hidden', marginBottom: 'var(--space-4)',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: ready ? 'var(--accent)' : 'var(--info)',
          transition: 'width 250ms linear',
        }} />
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
        <button
          className="btn btn-accent"
          disabled={!ready}
          onClick={onCollect}
          style={{ padding: '10px 24px', fontSize: 'var(--text-lg)', fontWeight: 700 }}
        >{ready ? '🎁 Collect' : `Wait ${mm}:${ss.toString().padStart(2, '0')}`}</button>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('Cancel training? The timer resets — you can start fresh with anyone.')) onCancel();
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Result modal — outcome card, dismissable
// ---------------------------------------------------------------------

function ResultModal({ outcome, onDismiss }: { outcome: TrainingOutcome; onDismiss: () => void }): React.ReactElement {
  const meta = OUTCOME_META[outcome.kind];
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      padding: 20,
    }} onClick={onDismiss}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--panel)',
          border: `2px solid ${meta.color}`,
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6)',
          maxWidth: 480, width: '100%',
          textAlign: 'center',
          boxShadow: 'var(--elev-3)',
        }}
      >
        <div style={{ fontSize: '64px', marginBottom: 'var(--space-3)' }}>{meta.emoji}</div>
        <h2 style={{ margin: 0, color: meta.color, letterSpacing: 1 }}>{meta.title}</h2>
        <div className="muted" style={{ marginTop: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>{meta.subtitle}</div>
        <div style={{
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
        }}>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{outcome.playerNickname}</div>
          <div className="muted small">on {ATTR_LABEL[outcome.attribute]}</div>
          <hr className="divider" />
          {outcome.kind === 'retire' && (
            <div style={{ color: 'var(--loss)', fontWeight: 600 }}>
              Career-ending injury. Player is gone forever.
            </div>
          )}
          {outcome.kind === 'reduce' && (
            <div>
              <strong style={{ color: 'var(--loss)' }}>−1</strong> {ATTR_LABEL[outcome.attribute]} → {outcome.newAttrValue}
            </div>
          )}
          {outcome.kind === 'success' && (
            <div>
              <strong style={{ color: 'var(--win)' }}>+1</strong> {ATTR_LABEL[outcome.attribute]} → {outcome.newAttrValue}
            </div>
          )}
          {outcome.kind === 'jackpot' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <strong style={{ color: 'var(--accent)' }}>+{outcome.paDelta}</strong> Potential Ability → {outcome.newPA}
              </div>
              <div>
                <strong style={{ color: 'var(--win)' }}>+1</strong> {ATTR_LABEL[outcome.attribute]} → {outcome.newAttrValue}
              </div>
            </div>
          )}
        </div>
        <button className="btn btn-accent" onClick={onDismiss} style={{ padding: '8px 24px' }}>
          Continue
        </button>
      </div>
    </div>
  );
}

const OUTCOME_META: Record<TrainingOutcome['kind'], { emoji: string; title: string; subtitle: string; color: string }> = {
  jackpot: { emoji: '🌟', title: 'JACKPOT', subtitle: 'Breakthrough moment — the ceiling broke.', color: 'var(--accent)' },
  success: { emoji: '✓',  title: 'Success',  subtitle: 'Solid progress in training.', color: 'var(--win)' },
  reduce:  { emoji: '↓',  title: 'Setback',  subtitle: 'A rough session — regression in the target attribute.', color: '#f59e0b' },
  retire:  { emoji: '💀', title: 'Career-Ending Injury', subtitle: 'The player will not recover.', color: 'var(--loss)' },
};
