// Booster pack gacha + active-boost roster view. Cards live in inventory
// until applied to a player; once applied they bump combat attributes for
// N ranked duels (server-validated), then auto-expire.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  BOOST_PACK_COST,
  BOOST_PACK_ODDS,
  BOOST_RARITY_META,
  type BoostCard,
  type BoostRarity,
} from '../protocol';
import type { Player } from '../../types';
import ToastStack from './ToastStack';

const RARITY_ORDER: BoostRarity[] = ['legendary', 'epic', 'rare', 'common'];

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
  const dismissBoostReveal = useOnline((s) => s.dismissBoostReveal);
  const go = useOnline((s) => s.go);

  const [pickCardId, setPickCardId] = useState<string | null>(null);

  useEffect(() => {
    listBoosts();
  }, [listBoosts]);

  if (!team) return null;
  const roster: Player[] = team.playerIds.map((id) => playersMap[id]).filter((p): p is Player => !!p);
  const canBuy = team.money >= BOOST_PACK_COST;
  const pickCard = pickCardId ? boosts.find((c) => c.id === pickCardId) : null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Booster Packs</h2>
          <div className="muted small">
            Gacha cards that bump combat attributes for a few duels. Apply to any roster player.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="muted small">Cash: <strong>${team.money.toLocaleString()}</strong></span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
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
          <div className="muted small" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {RARITY_ORDER.map((r) => {
              const meta = BOOST_RARITY_META[r];
              return (
                <span key={r} style={{ color: meta.color }}>
                  <strong>{(BOOST_PACK_ODDS[r] * 100).toFixed(BOOST_PACK_ODDS[r] < 0.05 ? 1 : 0)}%</strong> {meta.name} (+{meta.attrBonus}, {meta.duels}d)
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== Inventory ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">
          Card inventory <span className="muted small">{boosts.length} card{boosts.length === 1 ? '' : 's'}</span>
        </div>
        {boosts.length === 0 ? (
          <div className="muted small">No unapplied cards. Pull a pack above.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginTop: 8 }}>
            {boosts.map((c) => <CardTile key={c.id} card={c} onApply={() => setPickCardId(c.id)} onDiscard={() => discardBoost(c.id)} />)}
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
                    <td>+{b.attrBonus} aim/reflexes/positioning/gameSense/clutch</td>
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
                +{pickCard.attrBonus} to aim, reflexes, positioning, gameSense, clutch for {pickCard.duels} ranked duel{pickCard.duels === 1 ? '' : 's'}.
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
                  +{boostReveal.attrBonus} to aim · reflexes · positioning · gameSense · clutch
                </div>
                <div className="muted small">
                  Lasts {boostReveal.duels} ranked duel{boostReveal.duels === 1 ? '' : 's'}
                </div>
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

function CardTile({ card, onApply, onDiscard }: { card: BoostCard; onApply: () => void; onDiscard: () => void }): React.ReactElement {
  const meta = BOOST_RARITY_META[card.rarity];
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
      <div className="muted small">+{card.attrBonus} attr · {card.duels} duel{card.duels === 1 ? '' : 's'}</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button className="btn btn-tiny btn-accent" style={{ flex: 1 }} onClick={onApply}>Apply</button>
        <button className="btn btn-tiny" onClick={onDiscard} title="Throw away (no refund)">🗑</button>
      </div>
    </div>
  );
}
