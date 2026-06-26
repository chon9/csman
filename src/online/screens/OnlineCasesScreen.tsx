// Online case-opening screen — port of the single-player CasesScreen,
// minus trade-ups and souvenirs (initial release). Server rolls the skin
// and returns the strip; client just plays the cubic-bezier scroll.
// Sold skins credit team.money directly — no separate manager stash.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from '../onlineStore';
import { RARITY_COLOR, RARITY_LABEL } from '../../sim/caseOpening';
import { play as playSound, unlockAudio } from '../../sound/soundManager';
import {
  SKIN_MARKET_COMMISSION,
  SKIN_MARKET_MAX_PRICE,
  SKIN_MARKET_MIN_PRICE,
  TRADE_UP_INPUT_COUNT,
  type SkinInstanceWire,
  type SkinStripEntry,
} from '../protocol';
import ToastStack from './ToastStack';

/** Short float string for table cells — 4 dp. Returns dash for legacy skins
 *  minted before the float system. */
function fmtFloat(f: number | undefined): string {
  return typeof f === 'number' ? f.toFixed(4) : '—';
}
/** Pretty serial label e.g. "#0042" — empty string for legacy mints. */
function fmtSerial(s: number | undefined): string {
  return typeof s === 'number' ? `#${String(s).padStart(4, '0')}` : '';
}

const TILE_WIDTH = 120;
const VIEWPORT_WIDTH = 760;
const ANIM_MS = 5500;

type Tab = 'open' | 'market' | 'tradeup';

export default function OnlineCasesScreen() {
  const team = useOnline((s) => s.team);
  const cases = useOnline((s) => s.cases);
  const freeCaseId = useOnline((s) => s.freeCaseId);
  const freeCaseAvailable = useOnline((s) => s.freeCaseAvailable);
  const skins = useOnline((s) => s.skins);
  const caseOpening = useOnline((s) => s.caseOpening);
  const listings = useOnline((s) => s.skinMarketListings);
  const tradeUpReveal = useOnline((s) => s.tradeUpReveal);
  const listCases = useOnline((s) => s.listCases);
  const listSkins = useOnline((s) => s.listSkins);
  const openCase = useOnline((s) => s.openCase);
  const openFreeCase = useOnline((s) => s.openFreeCase);
  const sellSkin = useOnline((s) => s.sellSkin);
  const dismissCaseOpening = useOnline((s) => s.dismissCaseOpening);
  const refreshSkinMarket = useOnline((s) => s.refreshSkinMarket);
  const listSkinForSale = useOnline((s) => s.listSkinForSale);
  const unlistSkin = useOnline((s) => s.unlistSkin);
  const buySkinListing = useOnline((s) => s.buySkinListing);
  const tradeUpSkins = useOnline((s) => s.tradeUpSkins);
  const dismissTradeUpReveal = useOnline((s) => s.dismissTradeUpReveal);
  const go = useOnline((s) => s.go);

  const [tab, setTab] = useState<Tab>('open');
  const [tradeUpSelection, setTradeUpSelection] = useState<Set<string>>(new Set());
  // Per-skin asking-price drafts for the "List" inline form.
  const [listingDrafts, setListingDrafts] = useState<Record<string, number>>({});

  useEffect(() => {
    listCases();
    listSkins();
    refreshSkinMarket();
  }, [listCases, listSkins, refreshSkinMarket]);

  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  useEffect(() => {
    if (cases.length > 0 && !selectedCaseId) setSelectedCaseId(cases[0].id);
  }, [cases, selectedCaseId]);
  const selectedCase = cases.find((c) => c.id === selectedCaseId);

  // Hide the freshly rolled skin from the inventory while the reel spins —
  // otherwise it spoilers into the table before the animation lands.
  const [reveal, setReveal] = useState(false);
  const inventory = useMemo(() => {
    if (caseOpening && !reveal) {
      return skins.filter((s) => s.id !== caseOpening.instance.id);
    }
    return skins;
  }, [skins, caseOpening, reveal]);

  // Selected skins for trade-up — derive rarity check + enabled state.
  const selectedSkins = useMemo(
    () => skins.filter((s) => tradeUpSelection.has(s.id)),
    [skins, tradeUpSelection],
  );
  const tradeUpRarity = selectedSkins[0]?.rarity;
  const tradeUpUniform = selectedSkins.every((s) => s.rarity === tradeUpRarity);
  const tradeUpReady = selectedSkins.length === TRADE_UP_INPUT_COUNT && tradeUpUniform && tradeUpRarity !== 'rare-special';

  function toggleTradeUp(skinId: string): void {
    setTradeUpSelection((prev) => {
      const next = new Set(prev);
      if (next.has(skinId)) next.delete(skinId);
      else if (next.size < TRADE_UP_INPUT_COUNT) next.add(skinId);
      return next;
    });
  }

  if (!team) return null;
  const canAffordSelected = selectedCase ? team.money >= selectedCase.keyPrice : false;
  const myListings = listings.filter((l) => l.sellerTeamId === team.id);
  const otherListings = listings.filter((l) => l.sellerTeamId !== team.id);

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Cases</h2>
          <div className="muted small">
            Open cases, sell skins, fund your team. Daily free case from the {cases.find((c) => c.id === freeCaseId)?.name ?? 'starter'} pool.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="muted small">Cash: <strong>${team.money.toLocaleString()}</strong></span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* ===== Tab strip ===== */}
      <div className="panel" style={{ padding: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button
          className={`btn ${tab === 'open' ? 'btn-accent' : ''}`}
          onClick={() => setTab('open')}
          style={{ flex: '1 1 160px', padding: '10px 14px' }}
        >📦 Open & Inventory</button>
        <button
          className={`btn ${tab === 'market' ? 'btn-accent' : ''}`}
          onClick={() => { setTab('market'); refreshSkinMarket(); }}
          style={{ flex: '1 1 160px', padding: '10px 14px' }}
        >🔄 Skin Market <span className="muted small">{listings.length}</span></button>
        <button
          className={`btn ${tab === 'tradeup' ? 'btn-accent' : ''}`}
          onClick={() => setTab('tradeup')}
          style={{ flex: '1 1 160px', padding: '10px 14px' }}
        >⬆ Trade-Up <span className="muted small">{tradeUpSelection.size}/{TRADE_UP_INPUT_COUNT}</span></button>
      </div>

      {tab === 'open' && <>
      {/* ===== Case picker ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Choose a case</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 8 }}>
          {cases.map((c) => {
            const isSel = c.id === selectedCaseId;
            return (
              <button
                key={c.id}
                className={`panel case-card ${isSel ? 'case-card-active' : ''}`}
                onClick={() => setSelectedCaseId(c.id)}
                style={{
                  padding: 12,
                  border: isSel ? `2px solid ${c.accent ?? '#de9b35'}` : '1px solid rgba(255,255,255,0.08)',
                  background: isSel ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <strong style={{ color: c.accent ?? '#de9b35' }}>{c.name}</strong>
                <div className="muted small">{c.skinCount} skins · ${c.keyPrice.toLocaleString()} key</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            className="btn btn-accent"
            disabled={!selectedCase || !canAffordSelected || !!caseOpening}
            onClick={() => selectedCase && openCase(selectedCase.id)}
            title={!canAffordSelected ? 'Insufficient funds' : ''}
          >
            Open {selectedCase?.name ?? 'case'} · ${selectedCase?.keyPrice.toLocaleString() ?? '—'}
          </button>
          <button
            className="btn"
            disabled={!freeCaseAvailable || !!caseOpening}
            onClick={openFreeCase}
            title={freeCaseAvailable ? '' : 'Already claimed today — back at 00:00 UTC'}
          >
            🎁 Free daily case {freeCaseAvailable ? '· available' : '· claimed'}
          </button>
        </div>
      </div>

      {/* ===== Inventory ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">
          Inventory <span className="muted small">{inventory.length} skin{inventory.length === 1 ? '' : 's'}</span>
        </div>
        {inventory.length === 0 ? (
          <div className="muted small">No skins yet — open a case to drop your first.</div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Weapon</th>
                <th>Skin</th>
                <th>Rarity</th>
                <th>Wear</th>
                <th className="num">Float</th>
                <th>Serial</th>
                <th>StatTrak</th>
                <th className="num">Value</th>
                <th>List for…</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((s) => {
                const color = RARITY_COLOR[s.rarity];
                const listedHere = listings.some((l) => l.skinInstanceId === s.id);
                const draft = listingDrafts[s.id] ?? Math.max(SKIN_MARKET_MIN_PRICE, Math.round(s.marketValue * 1.1));
                return (
                  <tr key={s.id} style={{ boxShadow: `inset 4px 0 0 ${color}` }}>
                    <td style={{ paddingLeft: 12 }}><strong>{s.weapon}</strong></td>
                    <td>{s.name}</td>
                    <td><RarityBadge rarity={s.rarity} /></td>
                    <td className="muted">{s.wear}</td>
                    <td className="num" style={{ color: typeof s.float === 'number' && s.float < 0.05 ? '#ffd700' : undefined }}>{fmtFloat(s.float)}</td>
                    <td className="muted small">{fmtSerial(s.serial)}</td>
                    <td>{s.statTrak ? <span style={{ color: '#ff8a00' }}>StatTrak™</span> : <span className="muted">—</span>}</td>
                    <td className="num">${s.marketValue.toLocaleString()}</td>
                    <td>
                      {listedHere ? (
                        <span className="muted small">on market</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            type="number"
                            className="input"
                            value={draft}
                            min={SKIN_MARKET_MIN_PRICE}
                            max={SKIN_MARKET_MAX_PRICE}
                            step={100}
                            onChange={(e) => setListingDrafts({ ...listingDrafts, [s.id]: Math.max(SKIN_MARKET_MIN_PRICE, Number(e.target.value)) })}
                            style={{ width: 100, padding: '2px 6px', fontSize: 11 }}
                          />
                          <button className="btn btn-tiny" onClick={() => listSkinForSale(s.id, draft)}>List</button>
                        </div>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-tiny" onClick={() => sellSkin(s.id)} disabled={listedHere} title={listedHere ? 'Unlist before selling back' : 'Quick-sell for market value'}>Sell back</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </>}

      {tab === 'market' && (
        <SkinMarketPanel
          listings={otherListings}
          myListings={myListings}
          myMoney={team.money}
          myTeamId={team.id}
          onBuy={(id) => { unlockAudio(); playSound('sponsor-signed'); buySkinListing(id); }}
          onUnlist={unlistSkin}
          onRefresh={refreshSkinMarket}
        />
      )}

      {tab === 'tradeup' && (
        <TradeUpPanel
          inventory={inventory}
          selection={tradeUpSelection}
          onToggle={toggleTradeUp}
          onClearSelection={() => setTradeUpSelection(new Set())}
          tradeUpReady={tradeUpReady}
          selectedRarity={tradeUpRarity}
          onTradeUp={() => {
            tradeUpSkins([...tradeUpSelection]);
            setTradeUpSelection(new Set());
          }}
        />
      )}

      {tradeUpReveal && (
        <TradeUpRevealModal onClose={dismissTradeUpReveal} />
      )}

      {caseOpening && (
        <CaseOpenModal
          strip={caseOpening.strip}
          winnerIndex={caseOpening.winnerIndex}
          instance={caseOpening.instance}
          onReveal={() => setReveal(true)}
          onClose={() => { setReveal(false); dismissCaseOpening(); }}
        />
      )}

      <ToastStack />
    </div>
  );
}

// ============ Skin market panel (peer-to-peer trading) ============

function SkinMarketPanel({
  listings, myListings, myMoney, myTeamId, onBuy, onUnlist, onRefresh,
}: {
  listings: import('../protocol').SkinListingWire[];
  myListings: import('../protocol').SkinListingWire[];
  myMoney: number;
  myTeamId: string;
  onBuy: (listingId: string) => void;
  onUnlist: (listingId: string) => void;
  onRefresh: () => void;
}): React.ReactElement {
  type SortKey = 'price-asc' | 'price-desc' | 'rarity' | 'float';
  const [sort, setSort] = useState<SortKey>('price-asc');
  const sorted = useMemo(() => {
    const arr = [...listings];
    const rarityOrder: Record<string, number> = { 'rare-special': 0, covert: 1, classified: 2, restricted: 3, 'mil-spec': 4 };
    arr.sort((a, b) => {
      switch (sort) {
        case 'price-asc': return a.askingPrice - b.askingPrice;
        case 'price-desc': return b.askingPrice - a.askingPrice;
        case 'rarity': return (rarityOrder[a.skin.rarity] ?? 9) - (rarityOrder[b.skin.rarity] ?? 9);
        case 'float': return (a.skin.float ?? 1) - (b.skin.float ?? 1);
      }
    });
    return arr;
  }, [listings, sort]);

  return (
    <>
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="panel-title">Peer Skin Market</div>
            <div className="muted small">
              Buy direct from other teams. Server takes a {Math.round(SKIN_MARKET_COMMISSION * 100)}% commission on every trade — keep that in mind when pricing yours.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="muted small" style={{ alignSelf: 'center' }}>Sort:</span>
            {(['price-asc', 'price-desc', 'rarity', 'float'] as SortKey[]).map((k) => (
              <button key={k} className={`btn btn-tiny ${sort === k ? 'btn-accent' : ''}`} onClick={() => setSort(k)}>
                {k === 'price-asc' ? '$ ↑' : k === 'price-desc' ? '$ ↓' : k === 'rarity' ? 'Rarity' : 'Float ↑'}
              </button>
            ))}
            <button className="btn btn-tiny" onClick={onRefresh}>Refresh</button>
          </div>
        </div>
      </div>

      {myListings.length > 0 && (
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">Your Listings <span className="muted small">{myListings.length}</span></div>
          <table className="table table-dense" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Skin</th>
                <th>Rarity</th>
                <th>Wear</th>
                <th className="num">Float</th>
                <th>Serial</th>
                <th className="num">Asking</th>
                <th className="num">You'd net</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {myListings.map((l) => {
                const color = RARITY_COLOR[l.skin.rarity];
                const net = Math.round(l.askingPrice * (1 - SKIN_MARKET_COMMISSION));
                return (
                  <tr key={l.id} style={{ boxShadow: `inset 4px 0 0 ${color}` }}>
                    <td style={{ paddingLeft: 12 }}><strong>{l.skin.weapon}</strong> <span className="muted">{l.skin.name}</span></td>
                    <td><RarityBadge rarity={l.skin.rarity} /></td>
                    <td className="muted">{l.skin.wear}</td>
                    <td className="num">{fmtFloat(l.skin.float)}</td>
                    <td className="muted small">{fmtSerial(l.skin.serial)}</td>
                    <td className="num">${l.askingPrice.toLocaleString()}</td>
                    <td className="num" style={{ color: '#9be29b' }}>${net.toLocaleString()}</td>
                    <td><button className="btn btn-tiny btn-danger" onClick={() => onUnlist(l.id)}>Unlist</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Active Listings <span className="muted small">{sorted.length}</span></div>
        {sorted.length === 0 ? (
          <div className="muted small">No skins for sale right now. List one of yours to be the first.</div>
        ) : (
          <table className="table table-dense" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Seller</th>
                <th>Skin</th>
                <th>Rarity</th>
                <th>Wear</th>
                <th className="num">Float</th>
                <th>Serial</th>
                <th>StatTrak</th>
                <th className="num">Asking</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const color = RARITY_COLOR[l.skin.rarity];
                const canAfford = myMoney >= l.askingPrice;
                return (
                  <tr key={l.id} style={{ boxShadow: `inset 4px 0 0 ${color}` }}>
                    <td className="muted">{l.sellerTeamTag}</td>
                    <td style={{ paddingLeft: 4 }}><strong>{l.skin.weapon}</strong> <span className="muted">{l.skin.name}</span></td>
                    <td><RarityBadge rarity={l.skin.rarity} /></td>
                    <td className="muted">{l.skin.wear}</td>
                    <td className="num" style={{ color: typeof l.skin.float === 'number' && l.skin.float < 0.05 ? '#ffd700' : undefined }}>{fmtFloat(l.skin.float)}</td>
                    <td className="muted small">{fmtSerial(l.skin.serial)}</td>
                    <td>{l.skin.statTrak ? <span style={{ color: '#ff8a00' }}>StatTrak™</span> : <span className="muted">—</span>}</td>
                    <td className="num">${l.askingPrice.toLocaleString()}</td>
                    <td>
                      <button
                        className="btn btn-tiny btn-accent"
                        disabled={!canAfford || l.sellerTeamId === myTeamId}
                        onClick={() => onBuy(l.id)}
                        title={!canAfford ? 'Insufficient funds' : 'Buy at asking price'}
                      >Buy</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ============ Trade-up panel (10 same-rarity → 1 next-rarity) ============

function TradeUpPanel({
  inventory, selection, onToggle, onClearSelection, tradeUpReady, selectedRarity, onTradeUp,
}: {
  inventory: SkinInstanceWire[];
  selection: Set<string>;
  onToggle: (skinId: string) => void;
  onClearSelection: () => void;
  tradeUpReady: boolean;
  selectedRarity: SkinInstanceWire['rarity'] | undefined;
  onTradeUp: () => void;
}): React.ReactElement {
  const eligible = useMemo(() => {
    if (!selectedRarity) return inventory.filter((s) => s.rarity !== 'rare-special');
    // Once a rarity is picked, only show that rarity to make selection sane.
    return inventory.filter((s) => s.rarity === selectedRarity);
  }, [inventory, selectedRarity]);

  const avgFloat = useMemo(() => {
    if (selection.size === 0) return 0;
    const floats = inventory.filter((s) => selection.has(s.id)).map((s) => s.float ?? 0.25);
    return floats.reduce((a, b) => a + b, 0) / floats.length;
  }, [inventory, selection]);

  return (
    <>
      <div
        className="panel"
        style={{
          padding: 16,
          background: 'linear-gradient(135deg, rgba(255,215,0,0.10), rgba(75,105,255,0.10))',
          border: '1px solid rgba(255,215,0,0.30)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>⬆ Trade-Up Contract</div>
            <div className="muted small" style={{ marginTop: 4 }}>
              Pick {TRADE_UP_INPUT_COUNT} skins of the SAME rarity → roll 1 skin of the NEXT tier. Output float = average of inputs, so stockpile low-floats for the white-float chase.
            </div>
            <div className="muted small" style={{ marginTop: 4, color: '#f2c443' }}>
              Selected: <strong>{selection.size}/{TRADE_UP_INPUT_COUNT}</strong>
              {selectedRarity && <> · all {RARITY_LABEL[selectedRarity]} · avg float <strong>{avgFloat.toFixed(4)}</strong></>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" disabled={selection.size === 0} onClick={onClearSelection}>Clear</button>
            <button
              className="btn btn-accent"
              disabled={!tradeUpReady}
              onClick={onTradeUp}
              title={
                selection.size < TRADE_UP_INPUT_COUNT ? `Need ${TRADE_UP_INPUT_COUNT - selection.size} more` :
                selectedRarity === 'rare-special' ? 'Rare Special cannot trade up' :
                'Roll the contract'
              }
              style={{ padding: '8px 18px' }}
            >⬆ Trade Up</button>
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Pick your inputs</div>
        {eligible.length === 0 ? (
          <div className="muted small">No eligible skins for trade-up at this rarity tier.</div>
        ) : (
          <table className="table table-dense" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th></th>
                <th>Weapon</th>
                <th>Skin</th>
                <th>Rarity</th>
                <th>Wear</th>
                <th className="num">Float</th>
                <th>Serial</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {eligible.map((s) => {
                const color = RARITY_COLOR[s.rarity];
                const isPicked = selection.has(s.id);
                return (
                  <tr
                    key={s.id}
                    style={{
                      boxShadow: `inset 4px 0 0 ${color}`,
                      background: isPicked ? 'rgba(255,215,0,0.08)' : undefined,
                      cursor: 'pointer',
                    }}
                    onClick={() => onToggle(s.id)}
                  >
                    <td style={{ paddingLeft: 12 }}>
                      <input type="checkbox" checked={isPicked} onChange={() => onToggle(s.id)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td><strong>{s.weapon}</strong></td>
                    <td>{s.name}</td>
                    <td><RarityBadge rarity={s.rarity} /></td>
                    <td className="muted">{s.wear}</td>
                    <td className="num">{fmtFloat(s.float)}</td>
                    <td className="muted small">{fmtSerial(s.serial)}</td>
                    <td className="num">${s.marketValue.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ============ Trade-up reveal modal ============

function TradeUpRevealModal({ onClose }: { onClose: () => void }): React.ReactElement | null {
  const reveal = useOnline((s) => s.tradeUpReveal);
  // Stinger on mount — the trade-up doesn't have a spin animation, just
  // a result reveal, so we play the bell immediately and stack the rare
  // fanfare on top for high-rarity outputs.
  useEffect(() => {
    unlockAudio();
    playSound('case-reveal');
    if (reveal && (reveal.output.rarity === 'covert' || reveal.output.rarity === 'rare-special')) {
      const t = window.setTimeout(() => playSound('case-rare'), 250);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!reveal) return null;
  const { output, outputFloat } = reveal;
  const color = RARITY_COLOR[output.rarity];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, padding: 20 }}>
        <div className="modal-head" style={{ marginBottom: 10 }}>
          <h3>⬆ Trade-up complete!</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>
        <div
          style={{
            padding: 18,
            borderRadius: 10,
            border: `2px solid ${color}`,
            background: `linear-gradient(135deg, ${color}22, transparent)`,
            boxShadow: `0 0 24px ${color}44`,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 11, color, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}>
            {RARITY_LABEL[output.rarity]}{output.statTrak ? ' · StatTrak™' : ''}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{output.weapon}</div>
          <div className="muted">{output.name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginTop: 14 }}>
            <SmallStat label="Wear" value={output.wear} />
            <SmallStat label="Float" value={outputFloat.toFixed(4)} color={outputFloat < 0.05 ? '#ffd700' : undefined} />
            <SmallStat label="Serial" value={fmtSerial(output.serial)} />
            <SmallStat label="Value" value={`$${output.marketValue.toLocaleString()}`} color="#9be29b" />
          </div>
        </div>
        <button className="btn btn-accent" onClick={onClose} style={{ marginTop: 14, width: '100%' }}>
          Add to inventory
        </button>
      </div>
    </div>
  );
}

function SmallStat({ label, value, color }: { label: string; value: string; color?: string }): React.ReactElement {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 8px', borderRadius: 6 }}>
      <div className="muted small" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? '#e8eaf0' }}>{value}</div>
    </div>
  );
}

interface CaseOpenModalProps {
  strip: SkinStripEntry[];
  winnerIndex: number;
  instance: SkinInstanceWire;
  onReveal: () => void;
  onClose: () => void;
}

function CaseOpenModal({ strip, winnerIndex, instance, onReveal, onClose }: CaseOpenModalProps): React.ReactElement {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);
  // Latest onReveal stays accessible without putting it in the effect deps —
  // otherwise the parent recreating its callback re-fires the animation.
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  // Empty deps: run the spin animation exactly once per modal mount.
  // Re-renders from the parent (e.g. when the new skin lands in inventory)
  // would otherwise reset the strip transform and retrigger the reel.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = 'translateX(0)';
    void el.offsetWidth;
    // Measure the actual viewport width at runtime so the reel lands
    // centered on phones (where CSS clamps the viewport to the screen).
    const liveViewport = el.parentElement?.clientWidth ?? VIEWPORT_WIDTH;
    const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.45);
    const target = winnerIndex * TILE_WIDTH - (liveViewport / 2 - TILE_WIDTH / 2) + jitter;
    el.style.transition = `transform ${ANIM_MS}ms cubic-bezier(0.05, 0.65, 0.15, 1)`;
    el.style.transform = `translateX(-${target}px)`;

    // Audio: unlock context (browsers gate audio behind user gesture, and
    // the open-case click counts) then schedule the tick cadence + final
    // reveal stinger. Matches the single-player CasesScreen pattern.
    unlockAudio();
    const tickTimers: number[] = [];
    let t = 0;
    while (t < ANIM_MS - 100) {
      const at = t;
      tickTimers.push(window.setTimeout(() => playSound('case-tick'), at));
      const progress = t / ANIM_MS;
      const eased = 55 + Math.pow(progress, 1.6) * 290;
      t += eased;
    }

    const revealTimer = window.setTimeout(() => {
      setRevealed(true);
      onRevealRef.current();
      playSound('case-reveal');
      if (instance.rarity === 'covert' || instance.rarity === 'rare-special') {
        window.setTimeout(() => playSound('case-rare'), 250);
      }
    }, ANIM_MS + 200);
    tickTimers.push(revealTimer);
    return () => { for (const id of tickTimers) window.clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onClick={revealed ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820, padding: 16 }}>
        <div className="modal-head" style={{ marginBottom: 10 }}>
          <h3>{revealed ? 'Unboxed!' : 'Opening…'}</h3>
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
          }}
        >
          {/* Centre pointer */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 2,
              background: 'var(--accent, #de9b35)',
              transform: 'translateX(-50%)',
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
          <div
            ref={stripRef}
            style={{
              display: 'flex',
              willChange: 'transform',
            }}
          >
            {strip.map((s, i) => <ReelTile key={i} weapon={s.weapon} name={s.name} rarity={s.rarity} />)}
          </div>
        </div>

        {revealed && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 8,
              border: `2px solid ${RARITY_COLOR[instance.rarity]}`,
              background: 'rgba(255,255,255,0.03)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 12, color: RARITY_COLOR[instance.rarity], marginBottom: 4 }}>
              {RARITY_LABEL[instance.rarity]}{instance.statTrak ? ' · StatTrak™' : ''}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{instance.weapon}</div>
            <div className="muted">{instance.name}</div>
            <div className="muted small" style={{ marginTop: 6 }}>{instance.wear}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 6, marginTop: 10 }}>
              <SmallStat label="Float" value={fmtFloat(instance.float)} color={typeof instance.float === 'number' && instance.float < 0.05 ? '#ffd700' : undefined} />
              <SmallStat label="Serial" value={fmtSerial(instance.serial) || '—'} />
              <SmallStat label="Value" value={`$${instance.marketValue.toLocaleString()}`} color="#9be29b" />
            </div>
            <button className="btn btn-accent" onClick={onClose} style={{ marginTop: 12 }}>
              Add to inventory
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Single skin tile on the spinning reel. CS:GO-style: full border in
 *  the rarity colour + bottom rarity bar + tinted background gradient,
 *  so the rarity is unmistakable from any angle of the strip. */
function ReelTile({ weapon, name, rarity }: { weapon: string; name: string; rarity: SkinInstanceWire['rarity'] }): React.ReactElement {
  const color = RARITY_COLOR[rarity];
  return (
    <div
      style={{
        // No outer margin — TILE_WIDTH must match exact tile pitch or the
        // animation's translateX math (winnerIndex * TILE_WIDTH) lands on
        // the wrong tile and the reveal won't sync with the strip.
        width: TILE_WIDTH,
        flex: '0 0 auto',
        boxSizing: 'border-box',
        height: 120,
        borderRadius: 8,
        border: `2px solid ${color}`,
        background: `linear-gradient(180deg, rgba(255,255,255,0.04) 0%, ${color}1f 55%, ${color}3f 100%)`,
        boxShadow: `inset 0 -3px 0 ${color}, 0 0 12px ${color}33`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Top stripe — slight darker band so the weapon text reads well. */}
      <div
        style={{
          padding: '6px 8px',
          textAlign: 'center',
          fontSize: 12,
          fontWeight: 700,
          color: '#f3f4f7',
          background: 'rgba(0,0,0,0.25)',
          textShadow: '0 1px 2px rgba(0,0,0,0.6)',
          letterSpacing: 0.2,
        }}
      >{weapon}</div>
      {/* Skin name — wraps if long, centred. */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 8px',
          fontSize: 11,
          textAlign: 'center',
          color: '#d4d8e1',
          lineHeight: 1.25,
        }}
      >{name}</div>
      {/* Bottom rarity strip — the unmistakable colour signal. */}
      <div
        style={{
          height: 18,
          background: color,
          color: '#0a0d12',
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1,
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >{RARITY_LABEL[rarity]}</div>
    </div>
  );
}

/** Rarity badge for the inventory + market tables. */
export function RarityBadge({ rarity }: { rarity: SkinInstanceWire['rarity'] }): React.ReactElement {
  const color = RARITY_COLOR[rarity];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        background: `${color}22`,
        border: `1px solid ${color}66`,
        color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >{RARITY_LABEL[rarity]}</span>
  );
}
