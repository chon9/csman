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

const SITUATION_META: Record<CardDuelSituationId, { title: string; blurb: string; color: string }> = {
  eco:            { title: 'Eco Round',        blurb: 'Both sides play cheap — damage halved.',        color: '#9aa0aa' },
  force_buy:      { title: 'Force Buy',        blurb: 'Attackers rush better guns, defence dips.',       color: '#f04b6a' },
  bomb_plant:     { title: 'Bomb Plant',       blurb: 'Attackers get the play — +40% damage.',           color: '#ff8a00' },
  bomb_defuse:    { title: 'Bomb Defuse',      blurb: 'Defenders lock down — 40% harder to shift.',      color: '#4b8cd9' },
  clutch_time:    { title: 'Clutch Time',      blurb: 'Last unit standing gets +100% damage.',            color: '#ffd166' },
  awp_pick:       { title: 'AWP Pick',         blurb: 'Fastest unit on each side deals 2× damage.',       color: '#6ba0f5' },
  smoke_wall:     { title: 'Smoke Wall',       blurb: 'Role advantage muted this turn.',                  color: '#8390ad' },
  flashbang:      { title: 'Flashbang',        blurb: 'One unit per side is blinded — no damage.',        color: '#ffd700' },
  utility_execute:{ title: 'Utility Execute',  blurb: 'Coordinated push — attackers +20% damage.',        color: '#4dd4b0' },
  crossfire:      { title: 'Crossfire',        blurb: 'Every strike splashes to the next target.',        color: '#b47ef7' },
  rush_b:         { title: 'Rush B',           blurb: 'Massive attack surge, weaker defence.',            color: '#f04b6a' },
  save_round:     { title: 'Save Round',       blurb: 'Both sides save — damage cut in half.',            color: '#9aa0aa' },
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

function DeckPhase({
  roster, teamMoney, onQueue, onBack,
}: {
  roster: import('../../types').Player[];
  teamMoney: number;
  onQueue: (deck: string[]) => void;
  onBack: () => void;
}): React.ReactElement {
  const [deck, setDeck] = useState<string[]>(() => roster.slice(0, 5).map((p) => p.id));
  const bench = roster.filter((p) => !deck.includes(p.id));
  const canQueue = deck.length === 5 && teamMoney >= CARD_DUEL_STAKE;

  const toggle = (id: string, targetSlot?: number) => {
    if (deck.includes(id)) {
      setDeck(deck.filter((d) => d !== id));
      return;
    }
    if (deck.length >= 5) return;
    if (targetSlot != null && targetSlot < 5) {
      const next = [...deck];
      next[targetSlot] = id;
      setDeck(next.filter(Boolean).slice(0, 5));
    } else {
      setDeck([...deck, id]);
    }
  };

  const moveSlot = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= deck.length) return;
    const next = [...deck];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setDeck(next);
  };

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="cases" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Card Duel</h2>
            <div className="hero-sub">
              Pick 5 of 12 · Slot order = mirror matchup · Splinterlands-style auto-battle · ${CARD_DUEL_STAKE.toLocaleString()} entry · winner-takes-all
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

      {/* Selected deck slots */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Your Deck <span className="muted small">— slot order matters</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {Array.from({ length: 5 }).map((_, slot) => {
            const id = deck[slot];
            const p = id ? roster.find((r) => r.id === id) : null;
            return (
              <div
                key={slot}
                style={{
                  padding: 10, borderRadius: 6,
                  background: p ? 'var(--panel-2)' : 'var(--bg-elev)',
                  border: `1px dashed ${p ? 'var(--border-accent)' : 'var(--border)'}`,
                  minHeight: 100,
                  display: 'flex', flexDirection: 'column', gap: 6,
                  position: 'relative',
                }}
              >
                <div className="muted" style={{ fontSize: 10, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' }}>
                  Slot {slot + 1}
                </div>
                {p ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{p.nickname}</div>
                    <div className="muted small">{p.role} · CA {p.currentAbility}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 'auto' }}>
                      <button className="btn btn-tiny" onClick={() => moveSlot(slot, -1)} disabled={slot === 0} title="Move left">◀</button>
                      <button className="btn btn-tiny" onClick={() => moveSlot(slot, 1)} disabled={slot >= deck.length - 1} title="Move right">▶</button>
                      <button className="btn btn-tiny" onClick={() => toggle(p.id)} title="Remove">×</button>
                    </div>
                  </>
                ) : (
                  <div className="muted small" style={{ margin: 'auto' }}>Empty</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bench */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Roster <span className="muted small">— tap to add</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {bench.map((p) => (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              disabled={deck.length >= 5}
              style={{
                padding: 10, borderRadius: 6, textAlign: 'left',
                background: 'var(--panel-2)', border: '1px solid var(--border)',
                color: 'var(--text)', cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>{p.nickname}</div>
              <div className="muted small">{p.role} · CA {p.currentAbility}</div>
              <div className="muted small" style={{ marginTop: 4, fontSize: 10 }}>
                HP {Math.round((p.attributes.endurance ?? 10) * 4 + 20)} · ATK {Math.round((p.attributes.aim + p.attributes.reflexes) / 2)} · DEF {Math.round((p.attributes.positioning + p.attributes.composure) / 2)}
              </div>
            </button>
          ))}
        </div>
        {bench.length === 0 && (
          <div className="muted small" style={{ textAlign: 'center', padding: 20 }}>
            Every roster player is in your deck.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          className="btn btn-accent"
          disabled={!canQueue}
          onClick={() => onQueue(deck)}
          style={{ padding: '10px 24px', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          title={
            teamMoney < CARD_DUEL_STAKE ? 'Insufficient funds'
              : deck.length !== 5 ? 'Deck must have 5 cards'
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
      {cards.map((card, i) => {
        const currentHp = hp[i]!;
        const dead = currentHp <= 0;
        const pctHp = Math.max(0, Math.min(1, currentHp / card.maxHp));
        const hurtNow = currentStrike?.targetSlot === i;
        const attackerNow = attackerSlot === i && isAttacker;
        const barColor = pctHp > 0.6 ? '#4dd4b0' : pctHp > 0.3 ? '#ffd166' : '#f04b6a';
        return (
          <div
            key={card.playerId}
            style={{
              padding: 10, borderRadius: 6, position: 'relative',
              background: dead ? 'var(--bg-elev)' : attackerNow ? 'var(--accent-soft)' : 'var(--panel-2)',
              border: `1px solid ${attackerNow ? 'var(--accent)' : dead ? 'var(--border-soft)' : 'var(--border)'}`,
              opacity: dead ? 0.42 : 1,
              boxShadow: hurtNow ? `0 0 0 2px #f04b6a` : 'none',
              transition: 'background 140ms, box-shadow 140ms, opacity 140ms',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {card.nickname}
            </div>
            <div className="muted" style={{ fontSize: 10, letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase' }}>
              {card.role}
            </div>
            {/* HP bar */}
            <div style={{
              marginTop: 6,
              position: 'relative', height: 5, borderRadius: 999,
              background: 'var(--bg)', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', inset: 0, width: `${pctHp * 100}%`,
                background: barColor, borderRadius: 999,
                transition: 'width 200ms ease',
              }} />
            </div>
            <div style={{
              marginTop: 4, fontSize: 10,
              display: 'flex', justifyContent: 'space-between',
              fontVariantNumeric: 'tabular-nums',
              color: dead ? 'var(--text-faint)' : 'var(--text-dim)',
            }}>
              <span>{Math.max(0, Math.ceil(currentHp))}/{card.maxHp}</span>
              <span>ATK {Math.round(card.attack)}</span>
            </div>
            {/* Strike overlay: floating damage number */}
            {hurtNow && currentStrike && (
              <div
                key={`${currentStrike.attackerSlot}-${currentStrike.targetSlot}-${currentStrike.damage}`}
                style={{
                  position: 'absolute', top: -8, right: 6,
                  fontWeight: 800, fontSize: 14, color: '#f04b6a',
                  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                  animation: 'card-duel-hit 500ms ease-out',
                }}
              >
                −{currentStrike.damage}
                {currentStrike.advantage && <span style={{ marginLeft: 3, fontSize: 8, color: 'var(--accent-hi)' }}>ADV</span>}
              </div>
            )}
            {dead && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 11, fontWeight: 700, color: 'var(--loss)',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>ELIMINATED</div>
            )}
            {/* Slot number badge */}
            <div style={{
              position: 'absolute', top: 4, right: 6,
              fontSize: 9, color: 'var(--muted)', fontWeight: 700,
            }}>{side}{card.slot + 1}</div>
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
