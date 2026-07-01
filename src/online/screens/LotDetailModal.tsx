// Lot detail modal — opens when a lot pin is clicked on the map (or via
// the "My Lots" quick-jump grid). Always read-only for non-owners
// (identity strip + roster of cars/luxury for flexing). Owners get the
// full management surface: apartment upgrade, garage, vault, residents,
// luxury showcase.

import { useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  APARTMENT_TIER_META,
  APARTMENT_TIER_ORDER,
  CAR_CATALOG,
  LOT_VAULT_INTEREST_MAX_DAYS,
  LOT_VAULT_INTEREST_MIN_CLAIM,
  LOT_VAULT_INTEREST_PER_DAY,
  LUXURY_CATALOG,
  PLACEMENT_MATCHES,
  findCar,
  findLuxury,
  rankForMmr,
  type LotDetailWire,
} from '../protocol';

type Tab = 'apartment' | 'garage' | 'vault' | 'residents' | 'luxury';

export default function LotDetailModal(): React.ReactElement | null {
  const lot = useOnline((s) => s.viewingLot);
  const team = useOnline((s) => s.team);
  const dismiss = useOnline((s) => s.dismissLotDetail);
  const [tab, setTab] = useState<Tab>('apartment');

  if (!lot || !team) return null;
  const isOwner = lot.ownerTeamId === team.id;
  const meta = APARTMENT_TIER_META[lot.apartmentTier];

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, padding: 18, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-head" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Lot ({lot.x},{lot.y})</h3>
          <button className="link-btn" onClick={dismiss}>close ✕</button>
        </div>

        {/* ===== Identity strip ===== */}
        <div style={{
          padding: 14,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${lot.ownerColor}33, transparent 70%)`,
          border: `2px solid ${lot.ownerColor}`,
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 12,
            background: `linear-gradient(135deg, ${lot.ownerColor}, ${lot.ownerColor}88)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, color: '#0a0d12',
          }}>
            {lot.ownerLogoId || lot.ownerTag.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: lot.ownerColor }}>{lot.ownerTag}</div>
            <div className="muted small">{lot.ownerName}</div>
            <div className="muted small" style={{ marginTop: 4 }}>
              Apartment: <strong style={{ color: meta.color }}>{meta.label}</strong>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>MMR</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{lot.ownerMmr}</div>
            <div className="muted small" style={{ fontSize: 10 }}>
              {lot.ownerPlacementPlayed < PLACEMENT_MATCHES ? `Placement (${lot.ownerPlacementPlayed}/${PLACEMENT_MATCHES})` : rankForMmr(lot.ownerMmr).name}
            </div>
          </div>
        </div>

        {/* ===== Tabs ===== */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['apartment', 'garage', 'vault', 'residents', 'luxury'] as Tab[]).map((t) => (
            <button
              key={t}
              className="btn btn-tiny"
              onClick={() => setTab(t)}
              style={{
                fontWeight: tab === t ? 700 : 500,
                background: tab === t ? 'var(--accent)' : undefined,
                color: tab === t ? '#0a0d12' : undefined,
              }}
            >{tabLabel(t, lot)}</button>
          ))}
        </div>

        {tab === 'apartment'  && <ApartmentTab lot={lot} isOwner={isOwner} />}
        {tab === 'garage'     && <GarageTab    lot={lot} isOwner={isOwner} />}
        {tab === 'vault'      && <VaultTab     lot={lot} isOwner={isOwner} />}
        {tab === 'residents'  && <ResidentsTab lot={lot} isOwner={isOwner} />}
        {tab === 'luxury'     && <LuxuryTab    lot={lot} isOwner={isOwner} />}

        {/* ===== Bid history footer ===== */}
        {lot.bidHistory.length > 0 && (
          <div style={{ marginTop: 16, padding: 10, borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
              Purchase history ({lot.bidHistory.length} bids)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }} className="muted">
              {lot.bidHistory.slice(0, 8).map((b, i) => (
                <div key={i}>{b.bidderTag} · ${b.amount.toLocaleString()}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function tabLabel(t: Tab, lot: LotDetailWire): string {
  const meta = APARTMENT_TIER_META[lot.apartmentTier];
  switch (t) {
    case 'apartment': return `🏢 Apartment`;
    case 'garage':    return `🚗 Garage (${lot.cars.length}/${meta.carSlots})`;
    case 'vault':     return `💰 Vault`;
    case 'residents': return `🛏 Residents (${lot.residents.length}/${meta.residentSlots})`;
    case 'luxury':    return `💎 Luxury (${lot.luxuries.length}/${meta.luxurySlots})`;
  }
}

// ---------------------------------------------------------------------
// Apartment tab — show current tier + upgrade buttons
// ---------------------------------------------------------------------

function ApartmentTab({ lot, isOwner }: { lot: LotDetailWire; isOwner: boolean }): React.ReactElement {
  const team = useOnline((s) => s.team);
  const upgrade = useOnline((s) => s.upgradeLotApartment);
  const currentMeta = APARTMENT_TIER_META[lot.apartmentTier];
  const currentIdx = APARTMENT_TIER_ORDER.indexOf(lot.apartmentTier);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        padding: 12, borderRadius: 8,
        background: `linear-gradient(135deg, ${currentMeta.color}22, transparent)`,
        border: `1px solid ${currentMeta.color}55`,
      }}>
        <div style={{ fontSize: 11, color: currentMeta.color, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>Current tier</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{currentMeta.label}</div>
        <div className="muted small">{currentMeta.hint}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 10 }}>
          <Mini label="Cars"      value={`${currentMeta.carSlots}`} />
          <Mini label="Residents" value={`${currentMeta.residentSlots}`} />
          <Mini label="Luxury"    value={`${currentMeta.luxurySlots}`} />
          <Mini label="Vault cap" value={currentMeta.vaultCap === -1 ? '∞' : `$${currentMeta.vaultCap.toLocaleString()}`} />
        </div>
      </div>

      {APARTMENT_TIER_ORDER.slice(currentIdx + 1).map((tier) => {
        const m = APARTMENT_TIER_META[tier];
        const afford = (team?.money ?? 0) >= m.upgradeCost;
        return (
          <div key={tier} style={{
            padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.label}</div>
              <div className="muted small">{m.carSlots} cars · {m.residentSlots} beds · {m.luxurySlots} luxury · vault {m.vaultCap === -1 ? '∞' : `$${m.vaultCap.toLocaleString()}`}</div>
              <div className="muted small" style={{ fontSize: 11, marginTop: 2 }}>{m.hint}</div>
            </div>
            {isOwner && (
              <button
                className="btn btn-accent btn-tiny"
                disabled={!afford}
                onClick={() => upgrade(lot.id, tier)}
                title={afford ? `Upgrade for $${m.upgradeCost.toLocaleString()}` : `Need $${m.upgradeCost.toLocaleString()}`}
              >
                Upgrade ${m.upgradeCost.toLocaleString()}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Garage tab — owned cars + catalog to buy
// ---------------------------------------------------------------------

function GarageTab({ lot, isOwner }: { lot: LotDetailWire; isOwner: boolean }): React.ReactElement {
  const team = useOnline((s) => s.team);
  const buy = useOnline((s) => s.buyLotCar);
  const sell = useOnline((s) => s.sellLotCar);
  const meta = APARTMENT_TIER_META[lot.apartmentTier];
  const garageFull = lot.cars.length >= meta.carSlots;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Owned cars */}
      <div>
        <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          In garage ({lot.cars.length}/{meta.carSlots})
        </div>
        {lot.cars.length === 0 ? (
          <div className="muted small">Empty garage. {isOwner ? 'Buy a car below.' : 'No cars owned.'}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            {lot.cars.map((c) => {
              const car = findCar(c.carId);
              if (!car) return null;
              return (
                <div key={c.id} style={{
                  padding: 10, borderRadius: 6,
                  background: `linear-gradient(135deg, ${car.color}22, transparent)`,
                  border: `1px solid ${car.color}55`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 22 }}>{car.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{car.brand}</div>
                      <div className="muted small" style={{ fontSize: 11 }}>{car.model}</div>
                    </div>
                  </div>
                  <div className="muted small" style={{ marginTop: 4 }}>${car.price.toLocaleString()}</div>
                  {isOwner && (
                    <button className="btn btn-tiny" onClick={() => sell(lot.id, c.id)} style={{ marginTop: 6, fontSize: 10, width: '100%' }} title={`Sell for $${Math.round(car.price * 0.6).toLocaleString()}`}>
                      Sell ${Math.round(car.price * 0.6).toLocaleString()}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Catalogue */}
      {isOwner && (
        <div>
          <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Catalogue
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
            {CAR_CATALOG.map((car) => {
              const afford = (team?.money ?? 0) >= car.price;
              return (
                <button
                  key={car.id}
                  className="btn"
                  disabled={!afford || garageFull}
                  onClick={() => buy(lot.id, car.id)}
                  title={garageFull ? 'Garage full — upgrade apartment' : afford ? `Buy for $${car.price.toLocaleString()}` : `Need $${car.price.toLocaleString()}`}
                  style={{
                    padding: 8, fontSize: 11, textAlign: 'left',
                    background: `linear-gradient(135deg, ${car.color}22, transparent)`,
                    border: `1px solid ${car.color}55`,
                    opacity: (!afford || garageFull) ? 0.55 : 1,
                  }}
                >
                  <div style={{ fontSize: 18 }}>{car.icon}</div>
                  <div style={{ fontWeight: 700 }}>{car.brand}</div>
                  <div className="muted" style={{ fontSize: 10 }}>{car.model}</div>
                  <div style={{ marginTop: 2, fontWeight: 700, color: car.color }}>${(car.price / 1000).toFixed(0)}k</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Vault tab — deposit / withdraw cash
// ---------------------------------------------------------------------

function VaultTab({ lot, isOwner }: { lot: LotDetailWire; isOwner: boolean }): React.ReactElement {
  const team = useOnline((s) => s.team);
  const deposit = useOnline((s) => s.lotVaultDeposit);
  const withdraw = useOnline((s) => s.lotVaultWithdraw);
  const collectInterest = useOnline((s) => s.collectLotInterest);
  const meta = APARTMENT_TIER_META[lot.apartmentTier];
  const [amount, setAmount] = useState<number>(10_000);
  const capLabel = meta.vaultCap === -1 ? 'Unlimited' : `$${meta.vaultCap.toLocaleString()}`;
  const headroom = meta.vaultCap === -1 ? Infinity : Math.max(0, meta.vaultCap - lot.vaultBalance);
  const canClaim = lot.pendingInterest >= LOT_VAULT_INTEREST_MIN_CLAIM && (meta.vaultCap === -1 || headroom > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        padding: 16, borderRadius: 8,
        background: 'linear-gradient(135deg, rgba(110,208,154,0.10), transparent)',
        border: '1px solid rgba(110,208,154,0.30)',
        textAlign: 'center',
      }}>
        <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 2 }}>Vault balance</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#6ed09a', marginTop: 4 }}>
          ${lot.vaultBalance.toLocaleString()}
        </div>
        <div className="muted small">cap {capLabel}</div>
      </div>

      {/* ===== Daily interest banner ===== */}
      <div style={{
        padding: 12, borderRadius: 8,
        background: canClaim
          ? 'linear-gradient(135deg, rgba(242,196,67,0.20), rgba(242,196,67,0.05))'
          : 'rgba(255,255,255,0.03)',
        border: `1px solid ${canClaim ? 'rgba(242,196,67,0.55)' : 'rgba(255,255,255,0.08)'}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ fontSize: 28 }}>💰</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="muted small" style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }}>Daily interest</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: canClaim ? '#f2c443' : '#8b93a3' }}>
            +${lot.pendingInterest.toLocaleString()}
          </div>
          <div className="muted small" style={{ fontSize: 10 }}>
            {lot.interestDaysAccrued} of {LOT_VAULT_INTEREST_MAX_DAYS} days accrued · rate {(LOT_VAULT_INTEREST_PER_DAY * 100).toFixed(1)}% / day
          </div>
        </div>
        {isOwner && (
          <button
            className="btn btn-accent"
            disabled={!canClaim}
            onClick={() => collectInterest(lot.id)}
            title={
              lot.pendingInterest < LOT_VAULT_INTEREST_MIN_CLAIM ? `Min claim $${LOT_VAULT_INTEREST_MIN_CLAIM.toLocaleString()} — deposit more or wait.` :
              headroom === 0 ? 'Vault at cap — withdraw or upgrade first.' :
              `Collect $${lot.pendingInterest.toLocaleString()} into the vault`
            }
            style={{ fontWeight: 700, padding: '10px 16px', background: canClaim ? '#f2c443' : undefined, color: canClaim ? '#0a0d12' : undefined, border: 'none' }}
          >
            🎁 Collect
          </button>
        )}
      </div>

      {isOwner && (
        <div>
          <div className="muted small">Cash on hand: ${team?.money.toLocaleString() ?? 0}</div>
          <input
            type="number"
            className="input"
            min={1000}
            step={10_000}
            value={amount}
            onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))}
            style={{ marginTop: 6 }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              className="btn btn-accent"
              onClick={() => deposit(lot.id, amount)}
              disabled={amount <= 0 || amount > (team?.money ?? 0) || amount > headroom}
              style={{ flex: 1 }}
              title={amount > headroom ? `Only $${Math.max(0, headroom).toLocaleString()} headroom under cap` : ''}
            >
              ⬇ Deposit ${amount.toLocaleString()}
            </button>
            <button
              className="btn"
              onClick={() => withdraw(lot.id, amount)}
              disabled={amount <= 0 || amount > lot.vaultBalance}
              style={{ flex: 1 }}
            >
              ⬆ Withdraw ${amount.toLocaleString()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Residents tab — assign players from the team roster
// ---------------------------------------------------------------------

function ResidentsTab({ lot, isOwner }: { lot: LotDetailWire; isOwner: boolean }): React.ReactElement {
  const team = useOnline((s) => s.team);
  const playersMap = useOnline((s) => s.players);
  const assign = useOnline((s) => s.assignLotResident);
  const evict = useOnline((s) => s.evictLotResident);
  const meta = APARTMENT_TIER_META[lot.apartmentTier];
  const full = lot.residents.length >= meta.residentSlots;

  const residentIds = new Set(lot.residents.map((r) => r.playerId));
  const rosterPlayers = useMemo(() => {
    if (!team) return [];
    return team.playerIds.map((id) => playersMap[id]).filter((p): p is NonNullable<typeof p> => !!p);
  }, [team, playersMap]);
  const housedElsewhere = (id: string): boolean => {
    // We don't know about other lots client-side; the server will reject if so.
    return false;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Living here ({lot.residents.length}/{meta.residentSlots})
        </div>
        {lot.residents.length === 0 ? (
          <div className="muted small">No residents yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {lot.residents.map((r) => {
              const p = playersMap[r.playerId];
              return (
                <div key={r.playerId} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)',
                }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{p?.nickname ?? r.playerId}</strong>{' '}
                    {p && <span className="muted small">{p.role} · CA {p.currentAbility}</span>}
                  </div>
                  {isOwner && (
                    <button className="btn btn-tiny" onClick={() => evict(lot.id, r.playerId)}>Evict</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isOwner && (
        <div>
          <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Roster — assign new resident
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 }}>
            {rosterPlayers.map((p) => {
              const alreadyHere = residentIds.has(p.id);
              const elsewhere = housedElsewhere(p.id);
              return (
                <button
                  key={p.id}
                  className="btn"
                  disabled={alreadyHere || elsewhere || full}
                  onClick={() => assign(lot.id, p.id)}
                  style={{ padding: 8, fontSize: 11, textAlign: 'left', opacity: alreadyHere ? 0.45 : 1 }}
                  title={alreadyHere ? 'Already living here' : full ? 'No beds left — upgrade' : `Move ${p.nickname} in`}
                >
                  <div style={{ fontWeight: 700 }}>{p.nickname}</div>
                  <div className="muted" style={{ fontSize: 10 }}>{p.role} · CA {p.currentAbility}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Luxury tab — purchased showcase items
// ---------------------------------------------------------------------

function LuxuryTab({ lot, isOwner }: { lot: LotDetailWire; isOwner: boolean }): React.ReactElement {
  const team = useOnline((s) => s.team);
  const buy = useOnline((s) => s.buyLotLuxury);
  const sell = useOnline((s) => s.sellLotLuxury);
  const meta = APARTMENT_TIER_META[lot.apartmentTier];
  const full = lot.luxuries.length >= meta.luxurySlots;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Showcase ({lot.luxuries.length}/{meta.luxurySlots})
        </div>
        {lot.luxuries.length === 0 ? (
          <div className="muted small">Empty showcase.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {lot.luxuries.map((l) => {
              const item = findLuxury(l.itemId);
              if (!item) return null;
              return (
                <div key={l.id} style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: `linear-gradient(135deg, ${item.color}22, transparent)`,
                  border: `1px solid ${item.color}55`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  minWidth: 100,
                }}>
                  <div style={{ fontSize: 26 }}>{item.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, textAlign: 'center' }}>{item.label}</div>
                  <div className="muted small" style={{ fontSize: 10 }}>${(item.price / 1000).toFixed(0)}k</div>
                  {isOwner && (
                    <button className="btn btn-tiny" onClick={() => sell(lot.id, l.id)} style={{ fontSize: 9 }}>Sell ${Math.round(item.price * 0.6).toLocaleString()}</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isOwner && (
        <div>
          <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Boutique
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6 }}>
            {LUXURY_CATALOG.map((item) => {
              const afford = (team?.money ?? 0) >= item.price;
              return (
                <button
                  key={item.id}
                  className="btn"
                  disabled={!afford || full}
                  onClick={() => buy(lot.id, item.id)}
                  title={full ? 'Showcase full — upgrade' : afford ? `Buy for $${item.price.toLocaleString()}` : `Need $${item.price.toLocaleString()}`}
                  style={{
                    padding: 8, fontSize: 11, textAlign: 'center',
                    background: `linear-gradient(135deg, ${item.color}22, transparent)`,
                    border: `1px solid ${item.color}55`,
                    opacity: (!afford || full) ? 0.55 : 1,
                  }}
                >
                  <div style={{ fontSize: 22 }}>{item.icon}</div>
                  <div style={{ fontWeight: 700 }}>{item.label}</div>
                  <div className="muted" style={{ fontSize: 10, color: item.color }}>${(item.price / 1000).toFixed(0)}k</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ padding: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 4, textAlign: 'center' }}>
      <div className="muted small" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
