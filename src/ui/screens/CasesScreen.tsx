// CS2 case-opening minigame for the manager. The classic horizontal-scroll
// animation lands on the rolled skin; rare drops get a payout sting + inbox.
//
// Money model: separate `managerStash` from team budget. $50k starting,
// $25k/month stipend. Sold skins return value to stash. Cosmetic only — no
// real-money gambling here, just a flavour minigame.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { CASES, RARITY_ODDS } from '../../data/cs2Cases';
import { RARITY_COLOR, RARITY_LABEL, WINNER_INDEX, type OpenResult } from '../../sim/caseOpening';
import type { Skin, SkinInstance, SkinRarity } from '../../types';
import { money } from '../util';
import { play as playSound, unlockAudio } from '../../sound/soundManager';

const TILE_WIDTH = 120; // px — sync with .case-tile CSS
const VIEWPORT_WIDTH = 760; // px — sync with .case-opener-viewport
const ANIM_MS = 5500;

export default function CasesScreen() {
  const game = useGame((s) => s.game)!;
  const openCase = useGame((s) => s.openCase);
  const openDailyFreeCase = useGame((s) => s.openDailyFreeCase);
  const openSouvenirPackage = useGame((s) => s.openSouvenirPackage);
  const tradeUp = useGame((s) => s.tradeUp);
  const sellSkin = useGame((s) => s.sellSkin);

  const stash = game.managerStash ?? 0;
  const rawInventory = game.managerInventory ?? [];
  const pendingSouvenirs = game.pendingSouvenirs ?? 0;
  const freeCaseClaimed = game.lastFreeCaseDate === game.currentDate;

  const [selectedCaseId, setSelectedCaseId] = useState<string>(CASES[0].id);
  const selectedCase = CASES.find((c) => c.id === selectedCaseId)!;
  const [tradeUpSelected, setTradeUpSelected] = useState<Set<string>>(new Set());
  const [tradeUpResult, setTradeUpResult] = useState<SkinInstance | null>(null);

  // Opener animation state
  const [opening, setOpening] = useState(false);
  const [strip, setStrip] = useState<Skin[]>([]);
  const [result, setResult] = useState<OpenResult | null>(null);
  const [reveal, setReveal] = useState(false); // shows the reward card after animation
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Hide the freshly-rolled skin from the inventory display until the animation
  // reveal lands — otherwise the skin "spoilers" into the table mid-spin.
  const inventory = useMemo(() => {
    if (opening && result && !reveal) {
      return rawInventory.filter((s) => s.id !== result.instance.id);
    }
    return rawInventory;
  }, [rawInventory, opening, result, reveal]);

  /** Cancel any in-flight scheduled tick timers so a fresh roll doesn't double up. */
  const tickTimersRef = useRef<number[]>([]);
  function clearTickTimers() {
    for (const id of tickTimersRef.current) window.clearTimeout(id);
    tickTimersRef.current = [];
  }
  // Clear pending timers if the user navigates away mid-spin — otherwise
  // setReveal/playSound fire on an unmounted component (memory leak +
  // delayed audio). Ref-based, no deps so it only runs on unmount.
  useEffect(() => () => clearTickTimers(), []);

  function runAnimation(res: OpenResult) {
    setResult(res);
    setStrip(res.strip);
    setReveal(false);
    setOpening(true);
    // Audio: unlock first (some browsers gate audio behind user gesture)
    unlockAudio();
    requestAnimationFrame(() => {
      const el = stripRef.current;
      if (!el) return;
      el.style.transition = 'none';
      el.style.transform = 'translateX(0)';
      void el.offsetWidth;
      const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.45);
      const target = WINNER_INDEX * TILE_WIDTH - (VIEWPORT_WIDTH / 2 - TILE_WIDTH / 2) + jitter;
      el.style.transition = `transform ${ANIM_MS}ms cubic-bezier(0.05, 0.65, 0.15, 1)`;
      el.style.transform = `translateX(-${target}px)`;
    });

    // ===== Scroll ticks — decelerate to match the cubic-bezier easing =====
    // Hand-tuned cadence: fast at the start, sparse near the end. Total ~55 ticks
    // over 5.5s mirrors the visual tile pass-by.
    clearTickTimers();
    const tickTimes: number[] = [];
    let t = 0;
    while (t < ANIM_MS - 100) {
      tickTimes.push(t);
      // Delay grows from ~55ms to ~340ms following the easing curve.
      const progress = t / ANIM_MS;
      const eased = 55 + Math.pow(progress, 1.6) * 290;
      t += eased;
    }
    for (const at of tickTimes) {
      const id = window.setTimeout(() => playSound('case-tick'), at);
      tickTimersRef.current.push(id);
    }

    // Reveal stinger when the strip lands + extra fanfare for rare drops.
    const revealId = window.setTimeout(() => {
      setReveal(true);
      playSound('case-reveal');
      if (res.instance.rarity === 'covert' || res.instance.rarity === 'rare-special') {
        window.setTimeout(() => playSound('case-rare'), 250);
      }
    }, ANIM_MS + 200);
    tickTimersRef.current.push(revealId);
  }

  function startOpen() {
    if (opening || stash < selectedCase.keyPrice) return;
    const res = openCase(selectedCaseId);
    if (!res) return;
    runAnimation(res);
  }

  function startFreeOpen() {
    if (opening || freeCaseClaimed) return;
    const res = openDailyFreeCase();
    if (!res) return;
    runAnimation(res);
  }

  function openSouvenir() {
    if (opening || pendingSouvenirs <= 0) return;
    const skin = openSouvenirPackage();
    if (!skin) return;
    // Souvenir doesn't use the strip animation — just show the reveal directly.
    setResult({
      instance: skin,
      // synthesize a minimal Skin shape for compatibility
      skin: { id: skin.skinId, weapon: skin.weapon, name: skin.name, rarity: skin.rarity, basePrice: skin.marketValue },
      strip: [],
      winnerIndex: 0,
    });
    setReveal(true);
    setOpening(true);
  }

  function runTradeUp() {
    if (tradeUpSelected.size !== 10) return;
    const result = tradeUp(Array.from(tradeUpSelected));
    if (!result) return;
    setTradeUpSelected(new Set());
    setTradeUpResult(result);
  }

  function closeOpener() {
    clearTickTimers();
    setOpening(false);
    setReveal(false);
    setResult(null);
    setStrip([]);
  }

  const inventoryValue = inventory.reduce((s, x) => s + x.marketValue, 0);

  return (
    <div className="screen">
      <h2 className="screen-title">CS2 Cases</h2>

      <div className="cases-header panel">
        <div>
          <div className="muted small">Personal Stash</div>
          <div className="cases-stash">{money(stash)}</div>
          <div className="muted small" style={{ marginTop: 2 }}>
            Auto-credited $25k/month. Separate from team budget.
          </div>
        </div>
        <div>
          <div className="muted small">Inventory</div>
          <div className="cases-inv-value">
            {inventory.length} {inventory.length === 1 ? 'skin' : 'skins'} · {money(inventoryValue)}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Choose a Case</div>
        <div className="case-picker">
          {CASES.map((c) => (
            <button
              key={c.id}
              className={`case-card ${selectedCaseId === c.id ? 'selected' : ''}`}
              onClick={() => setSelectedCaseId(c.id)}
              style={{ borderTopColor: c.accent ?? '#999' }}
            >
              <div className="case-card-name">{c.name}</div>
              <div className="case-card-key">Key + Case · {money(c.keyPrice)}</div>
              <div className="case-card-poolsize muted small">{c.skins.length} possible skins</div>
            </button>
          ))}
        </div>

        <div className="case-odds-row">
          {(Object.keys(RARITY_ODDS) as SkinRarity[]).map((r) => (
            <div key={r} className="odds-pill" style={{ background: RARITY_COLOR[r] }}>
              {RARITY_LABEL[r]}: {(RARITY_ODDS[r] * 100).toFixed(2)}%
            </div>
          ))}
        </div>

        <div className="case-action-row">
          <button
            className="btn btn-primary case-open-btn"
            disabled={stash < selectedCase.keyPrice || opening}
            onClick={startOpen}
          >
            {stash < selectedCase.keyPrice ? `Need ${money(selectedCase.keyPrice)}` : `Open for ${money(selectedCase.keyPrice)}`}
          </button>
          <button
            className="btn case-action-secondary"
            disabled={freeCaseClaimed || opening}
            onClick={startFreeOpen}
            title="One free Recoil Case per game day"
          >
            🎁 {freeCaseClaimed ? 'Daily claimed' : 'Free Daily Case'}
          </button>
          {pendingSouvenirs > 0 && (
            <button
              className="btn case-action-souvenir"
              disabled={opening}
              onClick={openSouvenir}
              title="Awarded from Major wins"
            >
              🏆 Open Souvenir ({pendingSouvenirs})
            </button>
          )}
        </div>
      </div>

      {opening && (
        <div className="case-opener-modal" onClick={reveal ? closeOpener : undefined}>
          <div className="case-opener-inner" onClick={(e) => e.stopPropagation()}>
            <div className="case-opener-viewport">
              {/* Center marker */}
              <div className="case-opener-pointer" />
              <div className="case-opener-strip" ref={stripRef}>
                {strip.map((s, i) => (
                  <CaseTile key={i} skin={s} />
                ))}
              </div>
            </div>

            {reveal && result && (
              <div className={`case-result rarity-${result.instance.rarity}`}>
                <div className="case-result-title">
                  {result.instance.rarity === 'rare-special' ? '★ KNIFE DROP ★' : 'You unboxed:'}
                </div>
                <div className="case-result-name">
                  {result.instance.statTrak && <span className="stattrak-pill">StatTrak™</span>}{' '}
                  {result.instance.weapon} | {result.instance.name}
                </div>
                <div className="case-result-meta">
                  <span style={{ color: RARITY_COLOR[result.instance.rarity], fontWeight: 700 }}>
                    {RARITY_LABEL[result.instance.rarity]}
                  </span>
                  <span>·</span>
                  <span>{result.instance.wear}</span>
                  <span>·</span>
                  <strong>{money(result.instance.marketValue)}</strong>
                </div>
                <div className="case-result-actions">
                  <button
                    className="btn"
                    onClick={() => {
                      sellSkin(result.instance.id);
                      closeOpener();
                    }}
                  >
                    Sell for {money(result.instance.marketValue)}
                  </button>
                  <button className="btn btn-primary" onClick={closeOpener}>
                    Keep & Close
                  </button>
                  <button
                    className="btn"
                    disabled={stash < selectedCase.keyPrice}
                    onClick={() => {
                      // Reset the reveal panel + strip, then roll a fresh open
                      // directly (bypasses startOpen's stale `opening` closure check).
                      setReveal(false);
                      setResult(null);
                      setStrip([]);
                      window.setTimeout(() => {
                        const res = openCase(selectedCaseId);
                        if (!res) {
                          setOpening(false);
                          return;
                        }
                        runAnimation(res);
                      }, 80);
                    }}
                  >
                    Open Another
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <TradeUpPanel
        inventory={inventory}
        selected={tradeUpSelected}
        onToggle={(id) => {
          setTradeUpSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else if (next.size < 10) {
              // Only allow adding if rarity matches current selection (or first add).
              const skin = inventory.find((s) => s.id === id);
              if (!skin) return next;
              if (next.size === 0) {
                next.add(id);
              } else {
                const sample = inventory.find((s) => next.has(s.id));
                if (sample && sample.rarity === skin.rarity) next.add(id);
              }
            }
            return next;
          });
        }}
        onRun={runTradeUp}
        result={tradeUpResult}
        onDismissResult={() => setTradeUpResult(null)}
      />

      <div className="panel">
        <div className="panel-title">Inventory <span className="muted small">— sorted by value</span></div>
        {inventory.length === 0 ? (
          <div className="muted">No skins yet. Open a case to start a collection.</div>
        ) : (
          <InventoryTable inventory={inventory} onSell={sellSkin} />
        )}
      </div>
    </div>
  );
}

function TradeUpPanel({
  inventory,
  selected,
  onToggle,
  onRun,
  result,
  onDismissResult,
}: {
  inventory: SkinInstance[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onRun: () => void;
  result: SkinInstance | null;
  onDismissResult: () => void;
}) {
  // Group inventory by rarity for picking.
  const byRarity = useMemo(() => {
    const out: Record<SkinRarity, SkinInstance[]> = {
      'mil-spec': [], restricted: [], classified: [], covert: [], 'rare-special': [],
    };
    for (const s of inventory) out[s.rarity].push(s);
    return out;
  }, [inventory]);
  const totalValue = inventory.filter((s) => selected.has(s.id)).reduce((a, s) => a + s.marketValue, 0);
  const ready = selected.size === 10;
  const sampleRarity = selected.size > 0
    ? inventory.find((s) => selected.has(s.id))?.rarity
    : null;
  const nextRarity: SkinRarity | null = sampleRarity === 'mil-spec' ? 'restricted'
    : sampleRarity === 'restricted' ? 'classified'
    : sampleRarity === 'classified' ? 'covert'
    : sampleRarity === 'covert' ? 'rare-special'
    : null;

  return (
    <div className="panel">
      <div className="panel-title">
        📋 Trade-Up Contract
        <span className="muted small">— combine 10 same-rarity skins for 1 of the next tier</span>
      </div>
      <div className="tradeup-status">
        <div>
          Selected: <strong>{selected.size}</strong> / 10
          {sampleRarity && (
            <>
              {' '}· locked to <span style={{ color: RARITY_COLOR[sampleRarity], fontWeight: 700 }}>{RARITY_LABEL[sampleRarity]}</span>
            </>
          )}
          {nextRarity && (
            <>
              {' '}→ rolls into <span style={{ color: RARITY_COLOR[nextRarity], fontWeight: 700 }}>{RARITY_LABEL[nextRarity]}</span>
            </>
          )}
        </div>
        <div className="muted small">Input value: {totalValue.toLocaleString()}</div>
        <button className="btn btn-primary" disabled={!ready} onClick={onRun}>
          Trade Up{ready ? '' : ` (${10 - selected.size} more)`}
        </button>
      </div>

      {Object.entries(byRarity).map(([rarity, skins]) => {
        if (skins.length === 0) return null;
        if (rarity === 'rare-special') return null; // can't trade these up
        return (
          <div key={rarity} className="tradeup-tier">
            <div className="tradeup-tier-label" style={{ color: RARITY_COLOR[rarity as SkinRarity] }}>
              {RARITY_LABEL[rarity as SkinRarity]} ({skins.length})
            </div>
            <div className="tradeup-chip-row">
              {skins.map((s) => {
                const isSelected = selected.has(s.id);
                const sampleR = sampleRarity;
                const disabled = !isSelected && (selected.size >= 10 || (sampleR != null && sampleR !== s.rarity));
                return (
                  <button
                    key={s.id}
                    className={`tradeup-chip ${isSelected ? 'selected' : ''}`}
                    disabled={disabled}
                    style={{ borderColor: RARITY_COLOR[s.rarity] }}
                    onClick={() => onToggle(s.id)}
                    title={`$${s.marketValue.toLocaleString()} — ${s.wear}`}
                  >
                    {s.weapon} | {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {result && (
        <div className={`case-result rarity-${result.rarity}`} style={{ marginTop: 14 }}>
          <div className="case-result-title">Trade-up complete:</div>
          <div className="case-result-name">
            {result.statTrak && <span className="stattrak-pill">StatTrak™</span>}{' '}
            {result.weapon} | {result.name}
          </div>
          <div className="case-result-meta">
            <span style={{ color: RARITY_COLOR[result.rarity], fontWeight: 700 }}>
              {RARITY_LABEL[result.rarity]}
            </span>
            <span>·</span>
            <span>{result.wear}</span>
            <span>·</span>
            <strong>${result.marketValue.toLocaleString()}</strong>
          </div>
          <div className="case-result-actions">
            <button className="btn" onClick={onDismissResult}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CaseTile({ skin }: { skin: Skin }) {
  return (
    <div
      className="case-tile"
      style={{
        borderColor: RARITY_COLOR[skin.rarity],
        boxShadow: `inset 0 -4px 0 0 ${RARITY_COLOR[skin.rarity]}`,
      }}
    >
      <div className="case-tile-weapon">{skin.weapon}</div>
      <div className="case-tile-name">{skin.name}</div>
    </div>
  );
}

function InventoryTable({ inventory, onSell }: { inventory: SkinInstance[]; onSell: (id: string) => void }) {
  const sorted = useMemo(
    () => [...inventory].sort((a, b) => b.marketValue - a.marketValue),
    [inventory],
  );
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Skin</th>
          <th>Rarity</th>
          <th>Wear</th>
          <th>StatTrak</th>
          <th className="num">Value</th>
          <th>Acquired</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => (
          <tr key={s.id}>
            <td>
              {s.souvenir && <span className="souvenir-pill">🏆 Souvenir</span>}{' '}
              <strong>{s.weapon}</strong> | {s.name}
            </td>
            <td>
              <span style={{ color: RARITY_COLOR[s.rarity], fontWeight: 700, fontSize: 12 }}>
                {RARITY_LABEL[s.rarity]}
              </span>
            </td>
            <td className="muted small">{s.wear}</td>
            <td>{s.statTrak ? <span className="stattrak-pill">ST™</span> : <span className="muted small">—</span>}</td>
            <td className="num">{money(s.marketValue)}</td>
            <td className="muted small">{s.acquiredOn}</td>
            <td>
              <button className="btn" onClick={() => onSell(s.id)}>
                Sell
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
