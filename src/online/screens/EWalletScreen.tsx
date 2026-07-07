// E-Wallet — peer-to-peer transfers to other teams by Wallet ID
// (BTC-style handle, CSM-XXXX-XXXX-XXXX). Four tabs:
//   💰 Cash · 🎨 Skins · 👤 Players · 🏘 Real Estate
// Every transfer is free (no fee). Real-estate transfers move any
// residents on the lot to the recipient's roster automatically.
// Recipient looked up by Wallet ID server-side.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import { APARTMENT_TIER_META, findCar, findLuxury } from '../protocol';
import type { Player } from '../../types';
import ToastStack from './ToastStack';
import { moneyCompact } from '../../ui/util';
import Icon from '../../ui/Icon';

type Tab = 'cash' | 'skins' | 'players' | 'lots';

const RARITY_COLOR: Record<string, string> = {
  'mil-spec': '#4b69ff',
  'restricted': '#8847ff',
  'classified': '#d32ce6',
  'covert': '#eb4b4b',
  'rare-special': '#ffd700',
};

// Wallet ID canonical shape: `CSM-XXXX-XXXX-XXXX` (12 uppercase hex chars
// grouped in 4s). Accept lowercase + missing hyphens on input and normalise.
const WALLET_ID_RE = /^CSM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

/** Take arbitrary user input and coerce toward the canonical shape:
 *  - uppercase
 *  - strip whitespace
 *  - strip any character that isn't [A-Z0-9]
 *  - re-inject hyphens after the CSM prefix and every 4 hex chars.
 *  Returns a partially-typed string that the input can display live. */
function formatWalletIdInput(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Strip an accidental leading CSM to normalise on the pure hex tail
  // (we'll re-prefix below).
  const hex = upper.startsWith('CSM') ? upper.slice(3) : upper;
  // Only hex chars allowed in the tail.
  const cleanHex = hex.replace(/[^0-9A-F]/g, '').slice(0, 12);
  if (cleanHex.length === 0) return '';
  const groups: string[] = [];
  for (let i = 0; i < cleanHex.length; i += 4) groups.push(cleanHex.slice(i, i + 4));
  return `CSM-${groups.join('-')}`;
}

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
  const [toWallet, setToWallet] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { listSkins(); fetchMyLots(); }, [listSkins, fetchMyLots]);

  const roster = useMemo(() => {
    if (!team) return [];
    return team.playerIds.map((id) => playersMap[id]).filter((p): p is Player => !!p);
  }, [team, playersMap]);

  if (!team) return null;

  const myWalletId = team.walletId ?? '';
  const isValid = WALLET_ID_RE.test(toWallet);
  const isSelf = isValid && toWallet === myWalletId;
  const valid = isValid && !isSelf;
  const walletError = isSelf
    ? "Can't send to your own wallet."
    : (toWallet.length > 0 && !isValid ? 'Wallet ID must look like CSM-XXXX-XXXX-XXXX.' : null);

  async function copyMyWalletId(): Promise<void> {
    if (!myWalletId) return;
    try {
      await navigator.clipboard.writeText(myWalletId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select-and-highlight isn't worth adding a hidden textarea
      // for; browsers without clipboard API just show the ID for manual copy.
    }
  }

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="wallet" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>E-Wallet</h2>
            <div className="hero-sub">Peer-to-peer transfers · zero fee · cash, skins, players and real estate</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span
            className="pill pill-accent"
            style={{ fontSize: 'var(--text-md)', padding: '5px 12px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title={`$${team.money.toLocaleString()}`}
          >
            <Icon name="cash" size={13} /> {moneyCompact(team.money)}
          </span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* Your Wallet ID — the number you share with senders. */}
      <div className="panel panel-accent">
        <div className="section-title" style={{ margin: '0 0 var(--space-3)' }}>🔑 Your Wallet ID</div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <code style={{
            fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: 2,
            padding: '10px 16px', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-elev)', border: '1px solid var(--border-strong)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--accent-hi)',
            userSelect: 'all',
          }}>{myWalletId || '— assigning… reconnect —'}</code>
          <button
            className="btn btn-accent"
            disabled={!myWalletId}
            onClick={copyMyWalletId}
          >{copied ? '✓ Copied' : '📋 Copy'}</button>
        </div>
        <div className="muted small" style={{ marginTop: 'var(--space-2)' }}>
          Share this ID (not your team tag) with anyone who wants to send you cash, skins, players or real estate.
        </div>
      </div>

      {/* Recipient Wallet ID input */}
      <div className="panel">
        <div className="section-title" style={{ margin: '0 0 var(--space-2)' }}>Recipient Wallet ID</div>
        <input
          type="text"
          className="input"
          placeholder="CSM-XXXX-XXXX-XXXX"
          value={toWallet}
          onChange={(e) => setToWallet(formatWalletIdInput(e.target.value))}
          maxLength={19}
          spellCheck={false}
          autoCapitalize="characters"
          autoCorrect="off"
          style={{
            width: '100%',
            textTransform: 'uppercase',
            fontWeight: 700,
            letterSpacing: 2,
            fontFamily: 'var(--font-mono)',
          }}
        />
        {walletError && <div style={{ color: 'var(--loss)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>{walletError}</div>}
        {!walletError && valid && (
          <div className="small" style={{ marginTop: 'var(--space-1)', color: 'var(--win)' }}>
            ✓ Format looks good — server confirms on send.
          </div>
        )}
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
        <CashTab team={team} recipient={toWallet} valid={valid} onSend={(amt) => sendCash(toWallet, amt)} />
      )}
      {tab === 'skins' && (
        <SkinsTab skins={skins} recipient={toWallet} valid={valid} onSend={(id) => sendSkin(toWallet, id)} />
      )}
      {tab === 'players' && (
        <PlayersTab roster={roster} recipient={toWallet} valid={valid} onSend={(id) => sendPlayer(toWallet, id)} rosterSize={team.playerIds.length} />
      )}
      {tab === 'lots' && (
        <LotsTab myLots={myLots} recipient={toWallet} valid={valid} onSend={(id) => sendLot(toWallet, id)} />
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

// Recipient wallet id shown in the confirmation prompt — trimmed for
// readability (last 4 hex chars are enough for a human to visually
// verify they copied the right handle).
function shortWallet(w: string): string {
  return w ? w.slice(-4) : '???';
}

// ---------------------------------------------------------------------
// Cash tab
// ---------------------------------------------------------------------

function CashTab({ team, recipient, valid, onSend }: { team: { money: number; walletId?: string }; recipient: string; valid: boolean; onSend: (amt: number) => void }): React.ReactElement {
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
          if (window.confirm(`Send $${amount.toLocaleString()} to wallet ${recipient}? This can't be reversed.`)) onSend(amount);
        }}
        style={{ marginTop: 14, padding: '10px 18px', fontWeight: 800 }}
      >
        📤 Send ${amount.toLocaleString()} → …{shortWallet(recipient)}
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
                {s.nametag && (
                  <div style={{ fontSize: 11, color: '#d9b344', fontStyle: 'italic' }}>🏷 "{s.nametag}"</div>
                )}
                <div className="muted small" style={{ fontSize: 11 }}>
                  {s.serial ? `#${String(s.serial).padStart(4, '0')} · ` : ''}{s.wear} · float {floatStr}
                </div>
                <button
                  className="btn btn-tiny btn-accent"
                  disabled={!valid}
                  onClick={() => {
                    if (window.confirm(`Send "${label}" to wallet ${recipient}? Can't be reversed.`)) onSend(s.id);
                  }}
                  style={{ marginTop: 6, width: '100%' }}
                >📤 Send → …{shortWallet(recipient)}</button>
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
                if (window.confirm(`Send ${p.nickname} to wallet ${recipient}? Player instantly joins their roster. Can't be reversed.`)) onSend(p.id);
              }}
              style={{ marginTop: 6, width: '100%' }}
            >📤 Send → …{shortWallet(recipient)}</button>
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
                    if (window.confirm(`Send lot (${l.x},${l.y}) — including ALL cars, luxury items, vault balance, and any residents — to wallet ${recipient}? Can't be reversed.`)) onSend(l.id);
                  }}
                  style={{ marginTop: 6, width: '100%' }}
                >📤 Send lot → …{shortWallet(recipient)}</button>
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
