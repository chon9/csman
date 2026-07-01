// E-Wallet — peer-to-peer transfers to other teams by tag. Four tabs:
//   💰 Cash · 🎨 Skins · 👤 Players · 🏘 Real Estate
// Every transfer is free (no fee). Real-estate transfers move any
// residents on the lot to the recipient's roster automatically.
// Recipient looked up by team tag (case-insensitive) server-side.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import { APARTMENT_TIER_META, findCar, findLuxury } from '../protocol';
import type { Player } from '../../types';
import ToastStack from './ToastStack';

type Tab = 'cash' | 'skins' | 'players' | 'lots';

const RARITY_COLOR: Record<string, string> = {
  'mil-spec': '#4b69ff',
  'restricted': '#8847ff',
  'classified': '#d32ce6',
  'covert': '#eb4b4b',
  'rare-special': '#ffd700',
};

export default function EWalletScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const playersMap = useOnline((s) => s.players);
  const skins = useOnline((s) => s.skins);
  const myLots = useOnline((s) => s.myLots);
  const listSkins = useOnline((s) => s.listSkins);
  const fetchMyLots = useOnline((s) => s.fetchMyLots);
  const sendCash = useOnline((s) => s.sendCash);
  const sendSkin = useOnline((s) => s.sendSkin);
  const sendPlayer = useOnline((s) => s.sendPlayer);
  const sendLot = useOnline((s) => s.sendLot);
  const go = useOnline((s) => s.go);

  const [tab, setTab] = useState<Tab>('cash');
  const [toTag, setToTag] = useState('');

  useEffect(() => { listSkins(); fetchMyLots(); }, [listSkins, fetchMyLots]);

  const roster = useMemo(() => {
    if (!team) return [];
    return team.playerIds.map((id) => playersMap[id]).filter((p): p is Player => !!p);
  }, [team, playersMap]);

  if (!team) return null;
  const cleanTag = toTag.trim().toUpperCase();
  const validTag = cleanTag.length > 0 && cleanTag !== team.tag.toUpperCase();
  const tagError = cleanTag === team.tag.toUpperCase() ? "Can't send to your own team." : null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="panel" style={{
        padding: 18,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        background: 'linear-gradient(135deg, #142d4f 0%, #2a1b4a 60%, #4f1f3d 100%)',
        border: '1px solid rgba(255,255,255,0.14)',
      }}>
        <div>
          <h2 style={{ margin: '0 0 4px', letterSpacing: 1 }}>💳 E-WALLET</h2>
          <div className="muted small">Peer-to-peer transfers · zero fee · cash, skins, players and real estate</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.35)', fontSize: 12, fontWeight: 700 }}>
            💰 <strong>${team.money.toLocaleString()}</strong>
          </div>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* Recipient input */}
      <div className="panel" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="muted small" style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Recipient team tag</div>
          <input
            type="text"
            className="input"
            placeholder="e.g. TSF"
            value={toTag}
            onChange={(e) => setToTag(e.target.value)}
            maxLength={6}
            style={{ width: '100%', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1 }}
          />
          {tagError && <div style={{ color: '#e25555', fontSize: 11, marginTop: 4 }}>{tagError}</div>}
          {!tagError && cleanTag.length > 0 && (
            <div className="muted small" style={{ fontSize: 11, marginTop: 4 }}>Server validates on send — invalid tags show an error toast.</div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['cash', 'skins', 'players', 'lots'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`btn ${tab === t ? 'btn-accent' : ''}`}
            onClick={() => setTab(t)}
            style={{ fontWeight: tab === t ? 800 : 500, padding: '8px 16px' }}
          >{tabLabel(t)}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'cash' && (
        <CashTab team={team} recipient={cleanTag} valid={validTag} onSend={(amt) => sendCash(cleanTag, amt)} />
      )}
      {tab === 'skins' && (
        <SkinsTab skins={skins} recipient={cleanTag} valid={validTag} onSend={(id) => sendSkin(cleanTag, id)} />
      )}
      {tab === 'players' && (
        <PlayersTab roster={roster} recipient={cleanTag} valid={validTag} onSend={(id) => sendPlayer(cleanTag, id)} rosterSize={team.playerIds.length} />
      )}
      {tab === 'lots' && (
        <LotsTab myLots={myLots} recipient={cleanTag} valid={validTag} onSend={(id) => sendLot(cleanTag, id)} />
      )}

      <ToastStack />
    </div>
  );
}

function tabLabel(t: Tab): string {
  return t === 'cash' ? '💰 Cash'
    : t === 'skins' ? '🎨 Skins'
    : t === 'players' ? '👤 Players'
    : '🏘 Real Estate';
}

// ---------------------------------------------------------------------
// Cash tab
// ---------------------------------------------------------------------

function CashTab({ team, recipient, valid, onSend }: { team: { money: number; tag: string }; recipient: string; valid: boolean; onSend: (amt: number) => void }): React.ReactElement {
  const [amount, setAmount] = useState<number>(10_000);
  const cantAfford = amount > team.money;
  const tooLow = amount < 1000;
  const disabled = !valid || cantAfford || tooLow;

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>Send cash</div>
      <div className="muted small" style={{ marginBottom: 10 }}>Min $1,000 per transfer. No fee. Instant.</div>
      <input
        type="number"
        className="input"
        min={1000}
        step={1000}
        value={amount}
        onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))}
        style={{ width: '100%', maxWidth: 300 }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {[10_000, 100_000, 1_000_000].map((amt) => (
          <button key={amt} className="btn btn-tiny" disabled={amt > team.money} onClick={() => setAmount(amt)}>
            ${(amt / 1000).toLocaleString()}k
          </button>
        ))}
        <button className="btn btn-tiny" disabled={team.money < 1000} onClick={() => setAmount(team.money)}>
          Max ${team.money.toLocaleString()}
        </button>
      </div>
      {cantAfford && <div style={{ color: '#e25555', marginTop: 8, fontSize: 12 }}>Not enough cash on hand.</div>}
      {tooLow && !cantAfford && <div style={{ color: '#e25555', marginTop: 8, fontSize: 12 }}>Below $1,000 minimum.</div>}
      <button
        className="btn btn-accent"
        disabled={disabled}
        onClick={() => {
          if (window.confirm(`Send $${amount.toLocaleString()} to ${recipient}? This can't be reversed.`)) onSend(amount);
        }}
        style={{ marginTop: 14, padding: '10px 18px', fontWeight: 800 }}
      >
        📤 Send ${amount.toLocaleString()} → {recipient || '???'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Skins tab
// ---------------------------------------------------------------------

function SkinsTab({ skins, recipient, valid, onSend }: { skins: import('../protocol').SkinInstanceWire[]; recipient: string; valid: boolean; onSend: (id: string) => void }): React.ReactElement {
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>Send a skin</div>
      {skins.length === 0 ? (
        <div className="muted small">No skins in your inventory. Open some cases first.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {skins.map((s) => {
            const rarityColor = RARITY_COLOR[s.rarity] ?? '#8b93a3';
            const floatStr = typeof s.float === 'number' ? s.float.toFixed(3) : '?';
            const label = `${s.weapon} | ${s.name}`;
            return (
              <div key={s.id} style={{
                padding: 10, borderRadius: 8,
                background: `linear-gradient(135deg, ${rarityColor}22, transparent)`,
                border: `1px solid ${rarityColor}55`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
                <div className="muted small" style={{ fontSize: 11 }}>
                  {s.serial ? `#${String(s.serial).padStart(4, '0')} · ` : ''}{s.wear} · float {floatStr}
                </div>
                <button
                  className="btn btn-tiny btn-accent"
                  disabled={!valid}
                  onClick={() => {
                    if (window.confirm(`Send "${label}" to ${recipient}? Can't be reversed.`)) onSend(s.id);
                  }}
                  style={{ marginTop: 6, width: '100%' }}
                >📤 Send → {recipient || '???'}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Players tab
// ---------------------------------------------------------------------

function PlayersTab({ roster, recipient, valid, onSend, rosterSize }: { roster: Player[]; recipient: string; valid: boolean; onSend: (id: string) => void; rosterSize: number }): React.ReactElement {
  const canSendOne = rosterSize > 5;
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>Send a player</div>
      <div className="muted small" style={{ marginBottom: 10 }}>
        Roster must stay at 5+ after sending. No cost. Player instantly joins the recipient's roster.
      </div>
      {!canSendOne && (
        <div style={{ color: '#e25555', marginBottom: 10, fontSize: 12 }}>
          Roster at minimum ({rosterSize}) — sign someone before sending.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
        {roster.map((p) => (
          <div key={p.id} style={{
            padding: 10, borderRadius: 8,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{p.nickname}</strong>
              <span className="muted small">{p.role}</span>
            </div>
            <div className="muted small" style={{ fontSize: 11 }}>
              {p.firstName} {p.lastName} · CA {p.currentAbility} · PA {p.potentialAbility}
            </div>
            <button
              className="btn btn-tiny btn-accent"
              disabled={!valid || !canSendOne}
              onClick={() => {
                if (window.confirm(`Send ${p.nickname} to ${recipient}? Player instantly joins their roster. Can't be reversed.`)) onSend(p.id);
              }}
              style={{ marginTop: 6, width: '100%' }}
            >📤 Send → {recipient || '???'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Real-estate lots tab
// ---------------------------------------------------------------------

function LotsTab({ myLots, recipient, valid, onSend }: { myLots: import('../protocol').LotMapPin[]; recipient: string; valid: boolean; onSend: (id: string) => void }): React.ReactElement {
  const viewingLot = useOnline((s) => s.viewingLot);
  const fetchLotDetail = useOnline((s) => s.fetchLotDetail);

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>Send a real-estate lot</div>
      <div className="muted small" style={{ marginBottom: 10 }}>
        The entire lot transfers — apartment tier, vault balance, cars, luxury showcase, AND any residents (players living there move to the recipient's roster).
      </div>
      {myLots.length === 0 ? (
        <div className="muted small">You don't own any lots yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {myLots.map((l) => {
            const meta = APARTMENT_TIER_META[l.apartmentTier];
            return (
              <div key={`${l.x},${l.y}`} style={{
                padding: 12, borderRadius: 8,
                background: `linear-gradient(135deg, ${l.ownerColor}22, ${meta.color}15 60%, transparent)`,
                border: `1px solid ${meta.color}55`,
                borderTop: `3px solid ${meta.color}`,
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>({l.x},{l.y})</strong>
                    <div className="muted small" style={{ color: meta.color, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{meta.label}</div>
                  </div>
                  <button
                    className="btn btn-tiny"
                    onClick={() => fetchLotDetail(l.x, l.y)}
                    title="Peek at this lot's residents/cars before sending"
                  >Peek</button>
                </div>
                <button
                  className="btn btn-tiny btn-accent"
                  disabled={!valid}
                  onClick={() => {
                    if (window.confirm(`Send lot (${l.x},${l.y}) — including ALL cars, luxury items, vault balance, and any residents — to ${recipient}? Can't be reversed.`)) onSend(l.id);
                  }}
                  style={{ marginTop: 6, width: '100%' }}
                >📤 Send lot → {recipient || '???'}</button>
              </div>
            );
          })}
        </div>
      )}
      {/* Peek modal re-uses the existing lot detail store — nothing else to do here. */}
      {viewingLot && (
        <div className="muted small" style={{ marginTop: 8, fontStyle: 'italic' }}>
          Viewing {viewingLot.x},{viewingLot.y} · vault ${viewingLot.vaultBalance.toLocaleString()} · {viewingLot.cars.length} cars · {viewingLot.luxuries.length} luxury · {viewingLot.residents.length} resident{viewingLot.residents.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

// Unused imports guard — silences the linter on TS files where a helper
// might not be referenced (we import findCar/findLuxury for symmetry
// with LotDetailModal but only reference LotMapPin here).
void findCar; void findLuxury;
