// Booster pack gacha + active-boost roster view. Cards live in inventory
// until applied to a player; once applied they bump combat attributes for
// N ranked duels (server-validated), then auto-expire.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  BOOST_CARD_LIBRARY,
  BOOST_PACK_COST,
  BOOST_PACK_ODDS,
  BOOST_RARITY_META,
  BOOST_SELL_VALUE,
  type BoostCard,
  type BoostRarity,
} from '../protocol';
import type { Player } from '../../types';
import ToastStack from './ToastStack';
import Icon from '../../ui/Icon';

const RARITY_ORDER: BoostRarity[] = ['legendary', 'epic', 'rare', 'common'];

/** Compact attr-target list — collapses the all-round 5-stat set into "All-round". */
function attrTargetSummary(targets: readonly string[]): string {
  const ALL_ROUND = ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'];
  if (targets.length === 5 && ALL_ROUND.every((a) => targets.includes(a))) return 'All-round';
  return targets.join(' · ');
}

export default function OnlineBoostersScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const playersMap = useOnline((s) => s.players);
  const boosts = useOnline((s) => s.boosts);
  const activeBoosts = useOnline((s) => s.activeBoosts);
  const boostReveal = useOnline((s) => s.boostReveal);
  const listBoosts = useOnline((s) => s.listBoosts);
  const buyBoostPack = useOnline((s) => s.buyBoostPack);
  const applyBoost = useOnline((s) => s.applyBoost);
  const discardBoost = useOnline((s) => s.discardBoost);
  const sellBoost = useOnline((s) => s.sellBoost);
  const quickSellBoostsByRarity = useOnline((s) => s.quickSellBoostsByRarity);
  const dismissBoostReveal = useOnline((s) => s.dismissBoostReveal);
  const go = useOnline((s) => s.go);

  const [pickCardId, setPickCardId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);

  // Pre-grouped library for the "What can drop?" toggle.
  const libraryByRarity = useMemo(() => {
    const out: Record<BoostRarity, typeof BOOST_CARD_LIBRARY> = { common: [], rare: [], epic: [], legendary: [] };
    for (const t of BOOST_CARD_LIBRARY) out[t.rarity].push(t);
    return out;
  }, []);

  useEffect(() => {
    listBoosts();
  }, [listBoosts]);

  if (!team) return null;
  const roster: Player[] = team.playerIds.map((id) => playersMap[id]).filter((p): p is Player => !!p);
  const canBuy = team.money >= BOOST_PACK_COST;
  const pickCard = pickCardId ? boosts.find((c) => c.id === pickCardId) : null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="zap" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Booster Packs</h2>
            <div className="hero-sub">
              Gacha cards that bump combat attributes for a few duels. Apply to any roster player.
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

      {/* ===== Pack purchase ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Open a pack</div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-accent"
            disabled={!canBuy}
            onClick={buyBoostPack}
            title={canBuy ? '' : `Need $${BOOST_PACK_COST.toLocaleString()}`}
            style={{ padding: '10px 18px', fontSize: 14 }}
          >
            🎴 Open pack · ${BOOST_PACK_COST.toLocaleString()}
          </button>
          <div className="muted small" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {RARITY_ORDER.map((r) => {
              const meta = BOOST_RARITY_META[r];
              return (
                <span key={r} style={{ color: meta.color }}>
                  <strong>{(BOOST_PACK_ODDS[r] * 100).toFixed(BOOST_PACK_ODDS[r] < 0.05 ? 1 : 0)}%</strong> {meta.label} ({libraryByRarity[r].length} card{libraryByRarity[r].length === 1 ? '' : 's'})
                </span>
              );
            })}
            <button className="link-btn" onClick={() => setShowLibrary((s) => !s)} style={{ fontSize: 11 }}>
              {showLibrary ? 'hide' : 'show'} all cards
            </button>
          </div>
        </div>

        {showLibrary && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {RARITY_ORDER.flatMap((r) => libraryByRarity[r]).map((t) => {
              const meta = BOOST_RARITY_META[t.rarity];
              return (
                <div
                  key={t.id}
                  style={{
                    border: `1px solid ${meta.color}55`,
                    borderLeft: `3px solid ${meta.color}`,
                    borderRadius: 6,
                    padding: 8,
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong style={{ color: meta.color, fontSize: 12 }}>{t.name}</strong>
                    <span className="muted small" style={{ fontSize: 10 }}>+{t.attrBonus} · {t.duels}d</span>
                  </div>
                  <div className="muted small" style={{ fontSize: 10, marginTop: 2 }}>{attrTargetSummary(t.attrTargets)}</div>
                  <div className="muted small" style={{ fontSize: 10, marginTop: 4, fontStyle: 'italic', opacity: 0.7 }}>{t.flavor}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== Inventory (grouped by rarity, per-rarity quick sell) ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">
          Card inventory <span className="muted small">{boosts.length} card{boosts.length === 1 ? '' : 's'}</span>
        </div>
        {boosts.length === 0 ? (
          <div className="muted small">No unapplied cards. Pull a pack above.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
            {RARITY_ORDER.map((rarity) => {
              const group = boosts.filter((c) => c.rarity === rarity);
              if (group.length === 0) return null;
              const meta = BOOST_RARITY_META[rarity];
              const per = BOOST_SELL_VALUE[rarity];
              const total = per * group.length;
              return (
                <div key={rarity}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    padding: '6px 10px', marginBottom: 8, borderRadius: 6,
                    background: `${meta.color}15`,
                    borderLeft: `3px solid ${meta.color}`,
                  }}>
                    <strong style={{ color: meta.color, textTransform: 'uppercase', letterSpacing: 1, fontSize: 12 }}>
                      {meta.label}
                    </strong>
                    <span className="muted small">{group.length} card{group.length === 1 ? '' : 's'} · ${per.toLocaleString()} each</span>
                    <button
                      className="btn btn-tiny"
                      onClick={() => {
                        if (window.confirm(`Quick-sell ALL ${group.length} ${meta.label} card${group.length === 1 ? '' : 's'} for $${total.toLocaleString()}?`)) {
                          quickSellBoostsByRarity(rarity);
                        }
                      }}
                      style={{
                        marginLeft: 'auto', fontWeight: 700,
                        background: `${meta.color}30`, border: `1px solid ${meta.color}80`, color: meta.color,
                      }}
                      title={`Sell every ${meta.label} card in one click`}
                    >
                      💰 Quick Sell All · ${total.toLocaleString()}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                    {group.map((c) => (
                      <CardTile
                        key={c.id}
                        card={c}
                        onApply={() => setPickCardId(c.id)}
                        onSell={() => {
                          if (window.confirm(`Sell "${c.name}" for $${BOOST_SELL_VALUE[c.rarity].toLocaleString()}?`)) {
                            sellBoost(c.id);
                          }
                        }}
                        onDiscard={() => discardBoost(c.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== Active boosts on roster ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Active boosts</div>
        {Object.keys(activeBoosts).length === 0 ? (
          <div className="muted small">No active boosts on the roster.</div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th>
                <th>Boost</th>
                <th>Attr bonus</th>
                <th className="num">Duels left</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(activeBoosts).map(([pid, b]) => {
                const player = playersMap[pid];
                return (
                  <tr key={pid}>
                    <td><strong>{player?.nickname ?? pid}</strong></td>
                    <td style={{ color: BOOST_RARITY_META[b.rarity].color }}>{b.name}</td>
                    <td>+{b.attrBonus} <span className="muted small">{attrTargetSummary(b.attrTargets)}</span></td>
                    <td className="num">{b.duelsLeft}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== Apply-to-player modal ===== */}
      {pickCard && (
        <div className="modal-backdrop" onClick={() => setPickCardId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <h3>
                Apply <span style={{ color: BOOST_RARITY_META[pickCard.rarity].color }}>{pickCard.name}</span>
              </h3>
              <button className="link-btn" onClick={() => setPickCardId(null)}>close ✕</button>
            </div>
            <div className="modal-body">
              <div className="muted small" style={{ marginBottom: 10 }}>
                +{pickCard.attrBonus} to <strong>{attrTargetSummary(pickCard.attrTargets)}</strong> for {pickCard.duels} ranked duel{pickCard.duels === 1 ? '' : 's'}.
                Scrims don't consume duels.
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {roster.map((p) => {
                  const blocked = !!activeBoosts[p.id];
                  return (
                    <button
                      key={p.id}
                      className="btn"
                      disabled={blocked}
                      onClick={() => { applyBoost(pickCard.id, p.id); setPickCardId(null); }}
                      title={blocked ? `Already boosted (${activeBoosts[p.id].duelsLeft} duel${activeBoosts[p.id].duelsLeft === 1 ? '' : 's'} left)` : ''}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}
                    >
                      <span><strong>{p.nickname}</strong> <span className="muted small">{p.role}</span></span>
                      <span className="muted small">
                        {blocked ? `boosted · ${activeBoosts[p.id].duelsLeft} left` : `CA ${p.currentAbility}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Pack reveal modal ===== */}
      {boostReveal && (
        <div className="modal-backdrop" onClick={dismissBoostReveal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, padding: 18 }}>
            <div style={{ textAlign: 'center' }}>
              <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                You pulled
              </div>
              <div
                style={{
                  border: `3px solid ${BOOST_RARITY_META[boostReveal.rarity].color}`,
                  borderRadius: 12,
                  padding: 18,
                  background: `linear-gradient(135deg, ${BOOST_RARITY_META[boostReveal.rarity].color}22, transparent)`,
                  boxShadow: `0 0 24px ${BOOST_RARITY_META[boostReveal.rarity].color}44`,
                }}
              >
                <div style={{ fontSize: 11, color: BOOST_RARITY_META[boostReveal.rarity].color, textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700 }}>
                  {boostReveal.rarity}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{boostReveal.name}</div>
                <div className="muted small" style={{ marginTop: 8 }}>
                  +{boostReveal.attrBonus} to <strong>{attrTargetSummary(boostReveal.attrTargets)}</strong>
                </div>
                <div className="muted small">
                  Lasts {boostReveal.duels} ranked duel{boostReveal.duels === 1 ? '' : 's'}
                </div>
                {boostReveal.flavor && (
                  <div className="muted small" style={{ marginTop: 8, fontStyle: 'italic', opacity: 0.75 }}>
                    "{boostReveal.flavor}"
                  </div>
                )}
              </div>
              <button className="btn btn-accent" onClick={dismissBoostReveal} style={{ marginTop: 14 }}>
                Add to inventory
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastStack />
    </div>
  );
}

function CardTile({ card, onApply, onSell, onDiscard }: { card: BoostCard; onApply: () => void; onSell: () => void; onDiscard: () => void }): React.ReactElement {
  const meta = BOOST_RARITY_META[card.rarity];
  const price = BOOST_SELL_VALUE[card.rarity];
  return (
    <div
      style={{
        border: `2px solid ${meta.color}`,
        borderRadius: 10,
        padding: 12,
        background: `linear-gradient(135deg, ${meta.color}15, rgba(255,255,255,0.02))`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ color: meta.color }}>{card.name}</strong>
        <span className="muted small" style={{ textTransform: 'uppercase' }}>{card.rarity}</span>
      </div>
      <div className="muted small">+{card.attrBonus} · {card.duels} duel{card.duels === 1 ? '' : 's'}</div>
      <div className="muted small" style={{ fontSize: 10, opacity: 0.75 }}>{attrTargetSummary(card.attrTargets)}</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button className="btn btn-tiny btn-accent" style={{ flex: 1 }} onClick={onApply}>Apply</button>
        <button
          className="btn btn-tiny"
          onClick={onSell}
          title={`Sell for $${price.toLocaleString()}`}
          style={{ fontWeight: 700 }}
        >💰 ${(price / 1000).toFixed(0)}k</button>
        <button className="btn btn-tiny" onClick={onDiscard} title="Throw away (no refund)">🗑</button>
      </div>
    </div>
  );
}
