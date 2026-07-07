// Card Duel — Splinterlands-style auto-battle screen.
//
// One screen, three phases:
//   1. Deck builder — pick 5 of your 12 roster players; slot order
//      matters (mirror match: your slot i vs opponent slot i).
//   2. Queue — waiting for an opponent. Cancel returns to phase 1.
//   3. Battle — animated playback of the server-computed battle,
//      followed by a result banner. Concede clears cardDuel and
//      the client goes back to phase 1.
//
// The animation is a client-only loop that walks the server's
// pre-computed `turns[]` array with two timers: one for turn ticks,
// one for strike ticks within a turn. HP bars are driven from
// `targetHpAfter` numbers in the strike records.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  CARD_DUEL_STAKE, CARD_DUEL_STRIKE_MS, CARD_DUEL_TURN_MS,
  type CardDuelBattle, type CardDuelCard, type CardDuelSituationId,
  type CardDuelStrike,
} from '../protocol';
import ToastStack from './ToastStack';
import Icon from '../../ui/Icon';
import { moneyCompact } from '../../ui/util';

// ---------------------------------------------------------------------
// Situation-card flavour (12 templates matching server SITUATION_DECK)
// ---------------------------------------------------------------------

// Blurbs describe what the ENGINE actually does — no more implying an
// effect is asymmetric when it applies to every card that swings on the
// turn. Kept short so the situation banner reads as a subtitle chip.
const SITUATION_META: Record<CardDuelSituationId, { title: string; blurb: string; color: string }> = {
  eco:            { title: 'Eco Round',        blurb: 'Everyone plays cheap — all damage cut by 50%.',                          color: '#9aa0aa' },
  force_buy:      { title: 'Force Buy',        blurb: 'All attacks +30% damage · all defence reduced 20%.',                     color: '#f04b6a' },
  bomb_plant:     { title: 'Bomb Plant',       blurb: 'Every strike this turn deals +40% damage.',                              color: '#ff8a00' },
  bomb_defuse:    { title: 'Bomb Defuse',      blurb: 'Everyone braces — defence +40% for this turn.',                          color: '#4b8cd9' },
  clutch_time:    { title: 'Clutch Time',      blurb: 'Any side down to its last card deals +100% damage.',                     color: '#ffd166' },
  awp_pick:       { title: 'AWP Pick',         blurb: 'Fastest card on each side deals 2× damage this turn.',                   color: '#6ba0f5' },
  smoke_wall:     { title: 'Smoke Wall',       blurb: 'Role advantage disabled — no counter-pick bonus.',                        color: '#8390ad' },
  flashbang:      { title: 'Flashbang',        blurb: 'One random card per side is flashed — deals 0 damage.',                   color: '#ffd700' },
  utility_execute:{ title: 'Utility Execute',  blurb: 'Every card swings +20% damage this turn.',                                color: '#4dd4b0' },
  crossfire:      { title: 'Crossfire',        blurb: 'Every strike splashes to the next living target for half damage.',       color: '#b47ef7' },
  rush_b:         { title: 'Rush B',           blurb: 'Everyone rushes — attack +40%, defence -20%.',                           color: '#f04b6a' },
  save_round:     { title: 'Save Round',       blurb: 'Everyone saves — attack halved.',                                        color: '#9aa0aa' },
};

// ---------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------

export default function CardDuelScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const players = useOnline((s) => s.players);
  const cardDuel = useOnline((s) => s.cardDuel);
  const queueCardDuel = useOnline((s) => s.queueCardDuel);
  const cancelQueue = useOnline((s) => s.cancelCardDuelQueue);
  const dismiss = useOnline((s) => s.dismissCardDuel);
  const go = useOnline((s) => s.go);

  if (!team) return null;

  // Phase 3 — battle playback (also handles result modal at end).
  if (cardDuel?.battle) {
    return (
      <BattlePhase
        battle={cardDuel.battle}
        mySide={cardDuel.mySide ?? 'A'}
        onDismiss={dismiss}
      />
    );
  }

  // Phase 2 — queueing.
  if (cardDuel?.queued) {
    return <QueuePhase position={cardDuel.queued.position} onCancel={cancelQueue} />;
  }

  // Phase 1 — deck builder.
  const roster = team.playerIds.map((id) => players[id]).filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <DeckPhase
      roster={roster}
      teamMoney={team.money}
      onQueue={queueCardDuel}
      onBack={() => go('home')}
    />
  );
}

// ---------------------------------------------------------------------
// Phase 1 — Deck builder
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Card rarity — 5 tiers derived from CA (Bronze / Silver / Gold /
// Platinum / Legendary). Every player card has a stable rarity so the
// deck builder reads like a real TCG collection.
// ---------------------------------------------------------------------

type Rarity = 'bronze' | 'silver' | 'gold' | 'platinum' | 'legendary';
interface RarityMeta {
  label: string; color: string; gradient: string; textColor: string; glow: string;
}
const RARITY_META: Record<Rarity, RarityMeta> = {
  bronze:     { label: 'BRONZE',     color: '#cd7f32', gradient: 'linear-gradient(160deg, #6b4a24 0%, #3a281a 100%)', textColor: '#e8c39a', glow: 'rgba(205, 127, 50, 0.5)' },
  silver:     { label: 'SILVER',     color: '#d0d5db', gradient: 'linear-gradient(160deg, #7d848f 0%, #2f3540 100%)', textColor: '#f5f7fb', glow: 'rgba(208, 213, 219, 0.55)' },
  gold:       { label: 'GOLD',       color: '#ffd166', gradient: 'linear-gradient(160deg, #b58b1a 0%, #4a3712 100%)', textColor: '#fff2c9', glow: 'rgba(255, 209, 102, 0.65)' },
  platinum:   { label: 'PLATINUM',   color: '#4dd4b0', gradient: 'linear-gradient(160deg, #1c6957 0%, #0d2a26 100%)', textColor: '#c7f7e8', glow: 'rgba(77, 212, 176, 0.65)' },
  legendary:  { label: 'LEGENDARY',  color: '#b47ef7', gradient: 'linear-gradient(160deg, #4a1e78 0%, #1a0d33 100%)', textColor: '#e8d4ff', glow: 'rgba(180, 126, 247, 0.75)' },
};

function rarityForCa(ca: number): Rarity {
  if (ca >= 185) return 'legendary';
  if (ca >= 170) return 'platinum';
  if (ca >= 150) return 'gold';
  if (ca >= 130) return 'silver';
  return 'bronze';
}

// Derived stats (must match server/src/cardDuel.ts cardFromPlayer).
function cardStats(p: import('../../types').Player): { hp: number; atk: number; def: number; spd: number } {
  const a = p.attributes;
  return {
    hp: Math.round((a.endurance ?? 10) * 4 + 20),
    atk: Math.round((a.aim + a.reflexes) / 2),
    def: Math.round((a.positioning + a.composure) / 2),
    spd: Math.round(a.reflexes),
  };
}

// Simple 2-letter country → flag emoji. Not exhaustive; returns empty
// string if the code isn't a 2-letter ISO region.
function flagFor(nat: string | undefined): string {
  if (!nat || nat.length !== 2) return '';
  const base = 0x1F1E6;
  const a = nat.toUpperCase().charCodeAt(0);
  const b = nat.toUpperCase().charCodeAt(1);
  if (a < 65 || a > 90 || b < 65 || b > 90) return '';
  return String.fromCodePoint(base + (a - 65), base + (b - 65));
}

// ---------------------------------------------------------------------
// Player Card — reusable component. Renders like a FIFA / Ultimate Team
// card: big rating on the left, role + rarity ribbon, four stat rows.
// ---------------------------------------------------------------------

function PlayerCard({
  player, size = 'md', highlighted, dragProps, onClick, actionSlot,
}: {
  player: import('../../types').Player;
  size?: 'sm' | 'md';
  highlighted?: boolean;
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  onClick?: () => void;
  actionSlot?: React.ReactElement;
}): React.ReactElement {
  const rarity = rarityForCa(player.currentAbility);
  const meta = RARITY_META[rarity];
  const stats = cardStats(player);
  const flag = flagFor(player.nationality);
  const heightPx = size === 'sm' ? 128 : 168;
  const ratingSize = size === 'sm' ? 26 : 34;

  return (
    <div
      {...dragProps}
      onClick={onClick}
      title={onClick ? `Click to move · ${player.nickname}` : player.nickname}
      style={{
        position: 'relative',
        height: heightPx,
        borderRadius: 8,
        background: meta.gradient,
        border: `1.5px solid ${meta.color}`,
        boxShadow: highlighted
          ? `0 0 0 2px ${meta.color}, 0 0 18px ${meta.glow}, 0 4px 12px rgba(0, 0, 0, 0.6)`
          : `0 4px 12px rgba(0, 0, 0, 0.5)`,
        color: meta.textColor,
        cursor: onClick || dragProps?.draggable ? 'grab' : 'default',
        overflow: 'hidden',
        userSelect: 'none',
        display: 'flex', flexDirection: 'column',
        transition: 'transform 120ms ease, box-shadow 140ms ease',
        ...dragProps?.style,
      }}
    >
      {/* Diagonal shine */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 45%)',
      }} />
      {/* Rarity ribbon at top */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '4px 8px',
        background: `linear-gradient(90deg, ${meta.color}55, transparent)`,
        borderBottom: `1px solid ${meta.color}66`,
      }}>
        <span style={{
          fontSize: 8.5, fontWeight: 800, letterSpacing: '0.14em',
          color: meta.color,
        }}>{meta.label}</span>
        {flag && <span style={{ fontSize: size === 'sm' ? 11 : 13 }}>{flag}</span>}
      </div>
      {/* Main body */}
      <div style={{ display: 'flex', flex: 1, padding: size === 'sm' ? '8px' : '10px 12px', gap: 10 }}>
        {/* Left: rating + role */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: ratingSize + 6 }}>
          <div style={{
            fontSize: ratingSize, fontWeight: 900, lineHeight: 1,
            color: meta.color,
            textShadow: '0 1px 2px rgba(0, 0, 0, 0.7)',
            fontVariantNumeric: 'tabular-nums',
          }}>{player.currentAbility}</div>
          <div style={{
            marginTop: 2, fontSize: 8.5, fontWeight: 800,
            letterSpacing: '0.12em', color: meta.textColor, opacity: 0.85,
          }}>{player.role.toUpperCase()}</div>
        </div>
        {/* Right: name + stats */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{
            fontWeight: 700, fontSize: size === 'sm' ? 12 : 14,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            color: meta.textColor,
            letterSpacing: '-0.005em',
          }}>{player.nickname}</div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px',
            fontSize: size === 'sm' ? 9.5 : 10.5,
            fontVariantNumeric: 'tabular-nums',
            color: meta.textColor, opacity: 0.9,
          }}>
            <span>HP <b style={{ color: meta.color }}>{stats.hp}</b></span>
            <span>ATK <b style={{ color: meta.color }}>{stats.atk}</b></span>
            <span>DEF <b style={{ color: meta.color }}>{stats.def}</b></span>
            <span>SPD <b style={{ color: meta.color }}>{stats.spd}</b></span>
          </div>
        </div>
      </div>
      {actionSlot && (
        <div style={{
          position: 'absolute', bottom: 4, right: 4,
          display: 'flex', gap: 2,
        }}>
          {actionSlot}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Deck Phase — real TCG-style deck builder with drag-and-drop.
// ---------------------------------------------------------------------

interface DragState {
  playerId: string;
  source: 'deck' | 'bench';
  sourceSlot?: number;
}

function DeckPhase({
  roster, teamMoney, onQueue, onBack,
}: {
  roster: import('../../types').Player[];
  teamMoney: number;
  onQueue: (deck: string[]) => void;
  onBack: () => void;
}): React.ReactElement {
  const [deck, setDeck] = useState<(string | null)[]>(() => {
    const initial: (string | null)[] = [null, null, null, null, null];
    roster.slice(0, 5).forEach((p, i) => { initial[i] = p.id; });
    return initial;
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | 'bench' | null>(null);

  const deckIds = deck.filter((id): id is string => !!id);
  const bench = roster.filter((p) => !deckIds.includes(p.id));
  const canQueue = deckIds.length === 5 && teamMoney >= CARD_DUEL_STAKE;
  const deckOK = deckIds.length === 5;

  // Move a player into a deck slot. If the target slot is occupied,
  // swap the occupant back to bench (or back to source if it came from
  // the deck).
  const placeInSlot = (playerId: string, targetSlot: number, source: DragState) => {
    setDeck((prev) => {
      const next = [...prev];
      const displaced = next[targetSlot];
      next[targetSlot] = playerId;
      if (source.source === 'deck' && source.sourceSlot != null && source.sourceSlot !== targetSlot) {
        next[source.sourceSlot] = displaced ?? null;
      }
      return next;
    });
  };
  const removeFromSlot = (slot: number) => {
    setDeck((prev) => { const next = [...prev]; next[slot] = null; return next; });
  };
  const addToFirstOpenSlot = (playerId: string) => {
    setDeck((prev) => {
      const openIdx = prev.findIndex((s) => !s);
      if (openIdx === -1) return prev;
      const next = [...prev]; next[openIdx] = playerId; return next;
    });
  };
  const dropOnBench = (source: DragState) => {
    if (source.source === 'deck' && source.sourceSlot != null) removeFromSlot(source.sourceSlot);
  };

  const dragStart = (state: DragState) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.playerId);
    setDrag(state);
  };
  const dragEnd = () => { setDrag(null); setDragOverSlot(null); };
  const dragOver = (target: number | 'bench') => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverSlot !== target) setDragOverSlot(target);
  };
  const dragLeave = () => setDragOverSlot(null);
  const dropOnSlot = (slot: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!drag) return;
    placeInSlot(drag.playerId, slot, drag);
    dragEnd();
  };
  const dropOnBenchZone = (e: React.DragEvent) => {
    e.preventDefault();
    if (!drag) return;
    dropOnBench(drag);
    dragEnd();
  };

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="cases" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Card Duel</h2>
            <div className="hero-sub">
              5-card lineup · slot order = mirror matchup · ${CARD_DUEL_STAKE.toLocaleString()} entry · winner takes the pot
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="cash" size={13} /> {moneyCompact(teamMoney)}
          </span>
          <button className="btn" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="chevron-left" size={13} /> Back
          </button>
        </div>
      </div>

      {/* Deck slots */}
      <div className="panel" style={{ padding: 16 }}>
        <div className="panel-title">
          Battle Deck
          <span className="muted small" style={{ marginLeft: 6 }}>
            — drag cards between slots · {deckIds.length}/5 filled
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {deck.map((id, slot) => {
            const p = id ? roster.find((r) => r.id === id) : null;
            const isOver = dragOverSlot === slot;
            return (
              <div
                key={slot}
                onDragOver={dragOver(slot)}
                onDragLeave={dragLeave}
                onDrop={dropOnSlot(slot)}
                style={{ position: 'relative' }}
              >
                {/* Slot number tag above */}
                <div style={{
                  fontSize: 9, fontWeight: 800,
                  letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
                  color: isOver ? 'var(--accent)' : 'var(--muted)',
                  marginBottom: 4, textAlign: 'center',
                }}>
                  Slot {slot + 1}
                </div>
                {p ? (
                  <PlayerCard
                    player={p}
                    highlighted={isOver}
                    dragProps={{
                      draggable: true,
                      onDragStart: dragStart({ playerId: p.id, source: 'deck', sourceSlot: slot }),
                      onDragEnd: dragEnd,
                    }}
                    actionSlot={
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromSlot(slot); }}
                        title="Remove from deck"
                        style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: 'rgba(0, 0, 0, 0.55)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          color: '#fff', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    }
                  />
                ) : (
                  <div
                    style={{
                      height: 168, borderRadius: 8,
                      background: isOver ? 'var(--accent-soft)' : 'var(--bg-elev)',
                      border: `2px dashed ${isOver ? 'var(--accent)' : 'var(--border)'}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      color: isOver ? 'var(--accent)' : 'var(--text-faint)',
                      gap: 6,
                      transition: 'background 140ms, border-color 140ms',
                    }}
                  >
                    <Icon name="plus" size={22} />
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                    }}>Drop card here</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bench / roster pool */}
      <div
        className="panel"
        onDragOver={dragOver('bench')}
        onDragLeave={dragLeave}
        onDrop={dropOnBenchZone}
        style={{
          padding: 16,
          background: dragOverSlot === 'bench' ? 'var(--panel-2)' : undefined,
          borderColor: dragOverSlot === 'bench' && drag?.source === 'deck' ? 'var(--accent)' : undefined,
        }}
      >
        <div className="panel-title">
          Roster
          <span className="muted small" style={{ marginLeft: 6 }}>
            — drag onto a slot · click to auto-slot
          </span>
        </div>
        {bench.length === 0 ? (
          <div className="muted small" style={{ textAlign: 'center', padding: 24 }}>
            Every roster player is in your deck.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {bench.map((p) => (
              <PlayerCard
                key={p.id}
                player={p}
                size="sm"
                dragProps={{
                  draggable: true,
                  onDragStart: dragStart({ playerId: p.id, source: 'bench' }),
                  onDragEnd: dragEnd,
                }}
                onClick={() => addToFirstOpenSlot(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div className="muted small">
          {deckOK
            ? 'Deck locked in — click Queue to search for an opponent.'
            : `Fill ${5 - deckIds.length} more ${5 - deckIds.length === 1 ? 'slot' : 'slots'} to enter matchmaking.`}
        </div>
        <button
          className="btn btn-accent"
          disabled={!canQueue}
          onClick={() => onQueue(deckIds)}
          style={{ padding: '10px 24px', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          title={
            teamMoney < CARD_DUEL_STAKE ? 'Insufficient funds'
              : !deckOK ? 'Deck must have 5 cards'
              : 'Enter matchmaking'
          }
        >
          <Icon name="crosshair" size={14} />
          Queue for Duel · ${CARD_DUEL_STAKE.toLocaleString()}
        </button>
      </div>

      <ToastStack />
    </div>
  );
}

// ---------------------------------------------------------------------
// Phase 2 — Queue
// ---------------------------------------------------------------------

function QueuePhase({ position, onCancel }: { position: number; onCancel: () => void }): React.ReactElement {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="crosshair" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Card Duel</h2>
            <div className="hero-sub">Searching for opponent…</div>
          </div>
        </div>
      </div>
      <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>
          <Icon name="crosshair" size={40} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>
          Queued · Position #{position}
        </div>
        <div className="muted small" style={{ marginBottom: 20 }}>
          Elapsed {seconds}s — auto-cancels after 60s.
        </div>
        <button className="btn" onClick={onCancel} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="x" size={13} /> Cancel Queue
        </button>
      </div>
      <ToastStack />
    </div>
  );
}

// ---------------------------------------------------------------------
// Phase 3 — Battle playback
// ---------------------------------------------------------------------

function BattlePhase({
  battle, mySide, onDismiss,
}: {
  battle: CardDuelBattle;
  mySide: 'A' | 'B';
  onDismiss: () => void;
}): React.ReactElement {
  // Playback cursor. `turnIndex` = -1 means intro (no turns played yet).
  // Reach turnIndex === battle.turns.length → all done, show result.
  const [turnIndex, setTurnIndex] = useState(-1);
  const [strikeIndex, setStrikeIndex] = useState(-1);
  const [finished, setFinished] = useState(battle.turns.length === 0);

  // Advance strikes then turns with two staggered timers.
  useEffect(() => {
    if (finished) return;
    if (turnIndex === -1) {
      const t = setTimeout(() => { setTurnIndex(0); setStrikeIndex(-1); }, 700);
      return () => clearTimeout(t);
    }
    const turn = battle.turns[turnIndex];
    if (!turn) return;
    if (strikeIndex + 1 < turn.strikes.length) {
      const t = setTimeout(() => setStrikeIndex(strikeIndex + 1), CARD_DUEL_STRIKE_MS);
      return () => clearTimeout(t);
    }
    // Move to next turn.
    const t = setTimeout(() => {
      if (turnIndex + 1 >= battle.turns.length) {
        setFinished(true);
      } else {
        setTurnIndex(turnIndex + 1);
        setStrikeIndex(-1);
      }
    }, CARD_DUEL_TURN_MS);
    return () => clearTimeout(t);
  }, [turnIndex, strikeIndex, finished, battle.turns]);

  // Compute live HP by walking every applied strike up to (turnIndex, strikeIndex).
  const { aHp, bHp } = useMemo(() => {
    const aHp = battle.aCards.map((c) => c.maxHp);
    const bHp = battle.bCards.map((c) => c.maxHp);
    for (let ti = 0; ti < battle.turns.length; ti++) {
      const turn = battle.turns[ti]!;
      for (let si = 0; si < turn.strikes.length; si++) {
        if (ti > turnIndex) break;
        if (ti === turnIndex && si > strikeIndex) break;
        const s = turn.strikes[si]!;
        if (s.attackerSide === 'A') bHp[s.targetSlot] = s.targetHpAfter;
        else aHp[s.targetSlot] = s.targetHpAfter;
      }
      if (ti === turnIndex) break;
    }
    return { aHp, bHp };
  }, [battle, turnIndex, strikeIndex]);

  const currentTurn = turnIndex >= 0 && turnIndex < battle.turns.length ? battle.turns[turnIndex] : null;
  const currentStrike = currentTurn && strikeIndex >= 0 && strikeIndex < currentTurn.strikes.length
    ? currentTurn.strikes[strikeIndex]
    : null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="crosshair" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>{battle.aTeamTag} vs {battle.bTeamTag}</h2>
            <div className="hero-sub">
              Turn {Math.max(1, turnIndex + 1)} of {battle.turns.length} · Winner takes ${(battle.stake * 2).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Situation banner */}
      <div className="panel" style={{ padding: 14, textAlign: 'center' }}>
        {currentTurn ? (
          <SituationBanner id={currentTurn.situation.id} turnNumber={currentTurn.turnNumber} />
        ) : finished ? (
          <div className="muted">Battle complete.</div>
        ) : (
          <div className="muted">Preparing round 1…</div>
        )}
      </div>

      {/* Both sides' HP rows */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title" style={{
          color: mySide === 'A' ? 'var(--accent)' : 'var(--text-dim)',
        }}>
          {battle.aTeamTag} {mySide === 'A' && '(You)'}
        </div>
        <SideRow
          cards={battle.aCards}
          hp={aHp}
          isAttacker={currentStrike?.attackerSide === 'A' && currentStrike?.attackerSlot != null}
          attackerSlot={currentStrike?.attackerSide === 'A' ? currentStrike.attackerSlot : null}
          currentStrike={currentStrike?.attackerSide === 'B' ? currentStrike : null}
          side="A"
        />
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title" style={{
          color: mySide === 'B' ? 'var(--accent)' : 'var(--text-dim)',
        }}>
          {battle.bTeamTag} {mySide === 'B' && '(You)'}
        </div>
        <SideRow
          cards={battle.bCards}
          hp={bHp}
          isAttacker={currentStrike?.attackerSide === 'B'}
          attackerSlot={currentStrike?.attackerSide === 'B' ? currentStrike.attackerSlot : null}
          currentStrike={currentStrike?.attackerSide === 'A' ? currentStrike : null}
          side="B"
        />
      </div>

      {/* Result overlay */}
      {finished && <ResultBanner battle={battle} mySide={mySide} onDismiss={onDismiss} />}

      <ToastStack />
    </div>
  );
}

function SituationBanner({ id, turnNumber }: { id: CardDuelSituationId; turnNumber: number }): React.ReactElement {
  const meta = SITUATION_META[id];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
      <div style={{
        padding: '2px 8px', borderRadius: 3,
        background: `${meta.color}22`, border: `1px solid ${meta.color}66`,
        color: meta.color, fontWeight: 700, fontSize: 10,
        letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
        fontVariantNumeric: 'tabular-nums',
      }}>
        Turn {turnNumber}
      </div>
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, color: meta.color, letterSpacing: '-0.005em' }}>
          {meta.title}
        </div>
        <div className="muted small">{meta.blurb}</div>
      </div>
    </div>
  );
}

function SideRow({
  cards, hp, isAttacker, attackerSlot, currentStrike, side,
}: {
  cards: CardDuelCard[];
  hp: number[];
  isAttacker: boolean;
  attackerSlot: number | null;
  currentStrike: CardDuelStrike | null;
  side: 'A' | 'B';
}): React.ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
      {cards.map((card, i) => {
        const currentHp = hp[i]!;
        const dead = currentHp <= 0;
        const pctHp = Math.max(0, Math.min(1, currentHp / card.maxHp));
        const hurtNow = currentStrike?.targetSlot === i;
        const attackerNow = attackerSlot === i && isAttacker;
        const rarity = rarityForCa(card.ca);
        const meta = RARITY_META[rarity];
        const barColor = pctHp > 0.6 ? '#4dd4b0' : pctHp > 0.3 ? '#ffd166' : '#f04b6a';
        const flag = flagFor(card.nationality);
        return (
          <div
            key={card.playerId}
            style={{
              position: 'relative',
              borderRadius: 8, overflow: 'hidden',
              background: meta.gradient,
              border: `1.5px solid ${meta.color}`,
              color: meta.textColor,
              // Attacker: teal accent ring around the card.
              boxShadow: attackerNow
                ? `0 0 0 2px var(--accent), 0 0 22px var(--accent-soft), 0 4px 12px rgba(0, 0, 0, 0.6)`
                : hurtNow
                ? `0 0 0 2px #f04b6a, 0 0 18px rgba(240, 75, 106, 0.55), 0 4px 12px rgba(0, 0, 0, 0.5)`
                : `0 4px 10px rgba(0, 0, 0, 0.55)`,
              opacity: dead ? 0.38 : 1,
              filter: dead ? 'grayscale(0.9)' : 'none',
              transition: 'box-shadow 140ms, opacity 200ms, filter 200ms',
              minHeight: 148,
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Diagonal shine */}
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 45%)',
            }} />
            {/* Rarity ribbon */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '3px 8px',
              background: `linear-gradient(90deg, ${meta.color}55, transparent)`,
              borderBottom: `1px solid ${meta.color}66`,
              fontSize: 8.5, fontWeight: 800,
              letterSpacing: '0.14em',
              color: meta.color,
              zIndex: 1,
            }}>
              <span>{meta.label}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {flag && <span style={{ fontSize: 11 }}>{flag}</span>}
                <span style={{ color: meta.textColor, opacity: 0.75 }}>{side}{card.slot + 1}</span>
              </span>
            </div>
            {/* Body */}
            <div style={{
              flex: 1, display: 'flex', gap: 8,
              padding: '8px 10px 6px',
              zIndex: 1,
            }}>
              {/* Left: CA rating + role */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
                <div style={{
                  fontSize: 24, fontWeight: 900, lineHeight: 1,
                  color: meta.color,
                  textShadow: '0 1px 2px rgba(0, 0, 0, 0.7)',
                  fontVariantNumeric: 'tabular-nums',
                }}>{card.ca}</div>
                <div style={{
                  marginTop: 2, fontSize: 8, fontWeight: 800,
                  letterSpacing: '0.1em', color: meta.textColor, opacity: 0.85,
                }}>{card.role.toUpperCase()}</div>
              </div>
              {/* Right: name + stats */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{
                  fontWeight: 700, fontSize: 12,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  color: meta.textColor,
                  letterSpacing: '-0.005em',
                }}>{card.nickname}</div>
                <div style={{
                  fontSize: 9.5,
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0px 6px',
                  fontVariantNumeric: 'tabular-nums',
                  color: meta.textColor, opacity: 0.85,
                }}>
                  <span>ATK <b style={{ color: meta.color }}>{Math.round(card.attack)}</b></span>
                  <span>DEF <b style={{ color: meta.color }}>{Math.round(card.defense)}</b></span>
                  <span>SPD <b style={{ color: meta.color }}>{Math.round(card.speed)}</b></span>
                </div>
              </div>
            </div>
            {/* HP block — bottom third */}
            <div style={{
              padding: '4px 10px 8px',
              background: 'rgba(0, 0, 0, 0.35)',
              zIndex: 1,
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 9, fontWeight: 700,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                color: meta.textColor, opacity: 0.85,
                marginBottom: 3,
                fontVariantNumeric: 'tabular-nums',
              }}>
                <span>HP</span>
                <span>{Math.max(0, Math.ceil(currentHp))} / {card.maxHp}</span>
              </div>
              <div style={{
                position: 'relative', height: 6, borderRadius: 999,
                background: 'rgba(0, 0, 0, 0.55)',
                border: '1px solid rgba(0, 0, 0, 0.4)',
                overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', inset: 0, width: `${pctHp * 100}%`,
                  background: barColor, borderRadius: 999,
                  boxShadow: `0 0 6px ${barColor}88`,
                  transition: 'width 200ms ease',
                }} />
              </div>
            </div>
            {/* Attacker chevron */}
            {attackerNow && (
              <div style={{
                position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
                width: 0, height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderBottom: '8px solid var(--accent)',
                zIndex: 2,
              }} />
            )}
            {/* Floating damage number */}
            {hurtNow && currentStrike && !currentStrike.skipped && (
              <div
                key={`${currentStrike.attackerSlot}-${currentStrike.targetSlot}-${currentStrike.damage}`}
                style={{
                  position: 'absolute', top: 8, right: 10,
                  fontWeight: 900, fontSize: 18, color: '#ff6b7f',
                  textShadow: '0 2px 3px rgba(0,0,0,0.85)',
                  animation: 'card-duel-hit 550ms ease-out',
                  zIndex: 3,
                }}
              >
                −{currentStrike.damage}
                {currentStrike.advantage && <span style={{
                  marginLeft: 4, fontSize: 9,
                  background: 'var(--accent)', color: '#06121c',
                  padding: '1px 4px', borderRadius: 3,
                  letterSpacing: '0.06em',
                }}>ADV</span>}
              </div>
            )}
            {hurtNow && currentStrike?.skipped && (
              <div style={{
                position: 'absolute', top: 8, right: 10,
                fontWeight: 800, fontSize: 11,
                color: '#ffd700',
                background: 'rgba(0, 0, 0, 0.6)',
                padding: '2px 6px', borderRadius: 3,
                letterSpacing: '0.06em',
                zIndex: 3,
              }}>FLASHED</div>
            )}
            {dead && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, color: '#ff6b7f',
                letterSpacing: '0.14em', textTransform: 'uppercase',
                background: 'rgba(0, 0, 0, 0.55)',
                zIndex: 2,
              }}>Eliminated</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResultBanner({
  battle, mySide, onDismiss,
}: {
  battle: CardDuelBattle;
  mySide: 'A' | 'B';
  onDismiss: () => void;
}): React.ReactElement {
  const won = battle.winner === mySide;
  const oppTag = mySide === 'A' ? battle.bTeamTag : battle.aTeamTag;
  const pot = battle.stake * 2;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div className="panel" style={{
        width: 'min(440px, 92vw)', padding: 24,
        border: `1px solid ${won ? 'rgba(77, 212, 176, 0.55)' : 'rgba(240, 75, 106, 0.55)'}`,
      }}>
        <div style={{
          fontSize: 12, letterSpacing: 'var(--tracking-caps)',
          textTransform: 'uppercase', color: 'var(--text-dim)',
        }}>
          Card Duel {battle.quit ? '· Concede' : 'Complete'}
        </div>
        <h2 style={{ margin: '6px 0 12px', fontSize: 26, color: won ? 'var(--win)' : 'var(--loss)' }}>
          {won ? 'Victory' : 'Defeat'}
        </h2>
        <p className="muted small" style={{ marginBottom: 16 }}>
          {won
            ? `You beat ${oppTag} — took the ${pot.toLocaleString()} pot.`
            : `${oppTag} took the win — pot of ${pot.toLocaleString()} to them.`}
        </p>
        <button
          className="btn btn-accent"
          onClick={onDismiss}
          style={{ width: '100%', padding: '10px 14px' }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
