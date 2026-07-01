// Virtual real-estate screen — game-y version.
//
// v2 replaces the pannable SVG map (too fiddly at 1000×1000) with:
//   - Direct (x, y) coordinate input at the top → jump straight in
//   - "Feeling Lucky" empty-lot randomiser button
//   - Rich Top 10 richest-lots podium (server-wide leaderboard)
//   - Live-auction gallery with countdown pills
//   - My Lots trophy grid
//
// Every card gets rarity-tinted borders + hover lift + emoji "art" so
// the screen reads more like a metaverse browser than a spreadsheet.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  APARTMENT_TIER_META,
  LOT_MIN_OPENING_BID,
  LOT_VAULT_INTEREST_MAX_DAYS,
  LOT_VAULT_INTEREST_PER_DAY,
  MAP_SIZE,
  type LotAuctionWire,
  type LotLeaderboardEntry,
} from '../protocol';
import LotDetailModal from './LotDetailModal';
import ToastStack from './ToastStack';

const RANDOM_RETRY = 20; // tries before giving up on a fresh empty pick

export default function RealEstateScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const fetchAuctions = useOnline((s) => s.fetchLotAuctions);
  const fetchMine = useOnline((s) => s.fetchMyLots);
  const fetchLotDetail = useOnline((s) => s.fetchLotDetail);
  const fetchLeaderboard = useOnline((s) => s.fetchLotLeaderboard);
  const auctions = useOnline((s) => s.lotAuctions);
  const myLots = useOnline((s) => s.myLots);
  const leaderboard = useOnline((s) => s.lotLeaderboard);
  const go = useOnline((s) => s.go);

  const [xInput, setXInput] = useState<string>('500');
  const [yInput, setYInput] = useState<string>('500');
  const [bidForm, setBidForm] = useState<{ x: number; y: number } | null>(null);

  // 1Hz for auction countdowns.
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchAuctions();
    fetchMine();
    fetchLeaderboard();
    const id = setInterval(() => { fetchAuctions(); fetchLeaderboard(); }, 45_000);
    return () => clearInterval(id);
  }, [fetchAuctions, fetchMine, fetchLeaderboard]);

  function jumpTo(): void {
    const x = clampCoord(Number(xInput));
    const y = clampCoord(Number(yInput));
    setXInput(String(x)); setYInput(String(y));
    // If the coord is owned, open detail; if there's an open auction on
    // it, jump into the bid form; otherwise open a fresh-bid form.
    const owned = myLots.find((l) => l.x === x && l.y === y);
    if (owned) { fetchLotDetail(x, y); return; }
    setBidForm({ x, y });
  }

  function randomEmpty(): void {
    // Try random coords; skip any we already know are owned (my lots +
    // leaderboard cover the visible chunk). Server-side collision check
    // still runs on bid, so a false-positive here is harmless.
    const knownOccupied = new Set<string>([
      ...myLots.map((l) => `${l.x},${l.y}`),
      ...leaderboard.map((l) => `${l.x},${l.y}`),
      ...auctions.map((a) => `${a.x},${a.y}`),
    ]);
    for (let i = 0; i < RANDOM_RETRY; i++) {
      const x = Math.floor(Math.random() * MAP_SIZE);
      const y = Math.floor(Math.random() * MAP_SIZE);
      if (!knownOccupied.has(`${x},${y}`)) {
        setXInput(String(x)); setYInput(String(y));
        setBidForm({ x, y });
        return;
      }
    }
    // Fallback: just pick anything.
    const x = Math.floor(Math.random() * MAP_SIZE);
    const y = Math.floor(Math.random() * MAP_SIZE);
    setXInput(String(x)); setYInput(String(y));
    setBidForm({ x, y });
  }

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ===== Header ===== */}
      <div className="panel" style={{
        padding: 18,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        background: 'linear-gradient(135deg, #1d3b5c 0%, #2a1b4a 60%, #5c1d4a 100%)',
        border: '1px solid rgba(255,255,255,0.14)',
      }}>
        <div>
          <h2 style={{ margin: '0 0 4px', letterSpacing: 1 }}>🏘 REAL ESTATE</h2>
          <div className="muted small">
            {MAP_SIZE}×{MAP_SIZE} grid · pick any coord and bid ≥ ${LOT_MIN_OPENING_BID.toLocaleString()} · vault earns {(LOT_VAULT_INTEREST_PER_DAY * 100).toFixed(1)}%/day interest
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.35)', fontSize: 12, fontWeight: 700 }}>
            💰 <strong>${team.money.toLocaleString()}</strong>
          </div>
          <div style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.35)', fontSize: 12, fontWeight: 700 }}>
            🏠 <strong>{myLots.length}</strong> {myLots.length === 1 ? 'lot' : 'lots'}
          </div>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* ===== Coord picker ===== */}
      <div className="panel" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div className="muted small" style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Jump to coord</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label className="muted small">X</label>
            <input
              type="number"
              className="input"
              min={0}
              max={MAP_SIZE - 1}
              value={xInput}
              onChange={(e) => setXInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') jumpTo(); }}
              style={{ width: 90 }}
            />
            <label className="muted small">Y</label>
            <input
              type="number"
              className="input"
              min={0}
              max={MAP_SIZE - 1}
              value={yInput}
              onChange={(e) => setYInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') jumpTo(); }}
              style={{ width: 90 }}
            />
            <button className="btn btn-accent" onClick={jumpTo} style={{ fontWeight: 700 }}>Go →</button>
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            className="btn"
            onClick={randomEmpty}
            title="Pick a random empty (x,y) and jump to a bid form"
            style={{ padding: '8px 14px', fontWeight: 700, background: 'rgba(242,196,67,0.12)', border: '1px solid rgba(242,196,67,0.4)', color: '#f2c443' }}
          >
            🎲 Feeling Lucky
          </button>
        </div>
      </div>

      {/* ===== Two-column: leaderboard + auctions ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'flex-start' }}>
        <LeaderboardPanel entries={leaderboard} onOpen={(l) => fetchLotDetail(l.x, l.y)} />
        <AuctionsPanel auctions={auctions} clock={clock} myTeamTag={team.tag} onBid={(a) => setBidForm({ x: a.x, y: a.y })} />
      </div>

      {/* ===== My lots ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title" style={{ marginBottom: 10 }}>🏠 My Lots ({myLots.length})</div>
        {myLots.length === 0 ? (
          <div className="muted small">No lots yet — pick a coord above and win an auction to claim one.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {myLots.map((l) => {
              const meta = APARTMENT_TIER_META[l.apartmentTier];
              return (
                <button
                  key={`${l.x},${l.y}`}
                  className="btn"
                  onClick={() => { setXInput(String(l.x)); setYInput(String(l.y)); fetchLotDetail(l.x, l.y); }}
                  style={{
                    padding: 12,
                    background: `linear-gradient(135deg, ${l.ownerColor}22, ${meta.color}15 60%, transparent)`,
                    border: `1px solid ${meta.color}55`,
                    borderTop: `3px solid ${meta.color}`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontSize: 26 }}>{l.ownerLogoId || '🏠'}</div>
                  <div style={{ fontWeight: 800 }}>({l.x},{l.y})</div>
                  <div style={{ color: meta.color, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>{meta.label}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {bidForm && (
        <BidFormModal
          x={bidForm.x}
          y={bidForm.y}
          existing={auctions.find((a) => a.x === bidForm.x && a.y === bidForm.y) ?? null}
          onClose={() => setBidForm(null)}
        />
      )}

      <LotDetailModal />
      <ToastStack />
    </div>
  );
}

function clampCoord(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(n)));
}

// =====================================================================
// Leaderboard — top-3 podium + 4-10 row list
// =====================================================================

function LeaderboardPanel({ entries, onOpen }: { entries: LotLeaderboardEntry[]; onOpen: (l: LotLeaderboardEntry) => void }): React.ReactElement {
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 10);
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>🏆 Top 10 Richest Lots</div>
      {entries.length === 0 && (
        <div className="muted small">No owned lots yet — win an auction to appear here.</div>
      )}
      {top3.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          {top3.map((e) => <PodiumCard key={e.lotId} entry={e} onClick={() => onOpen(e)} />)}
        </div>
      )}
      {rest.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rest.map((e) => (
            <button
              key={e.lotId}
              onClick={() => onOpen(e)}
              className="btn"
              style={{
                padding: '6px 10px', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center',
                fontSize: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span className="muted" style={{ width: 22, textAlign: 'right' }}>{e.rank}</span>
              <span style={{ fontSize: 18 }}>{e.ownerLogoId || '🏠'}</span>
              <span style={{ color: e.ownerColor, fontWeight: 700 }}>{e.ownerTag}</span>
              <span className="muted small">({e.x},{e.y}) · {APARTMENT_TIER_META[e.apartmentTier].label}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 800 }}>${(e.totalWorth / 1000).toFixed(1)}k</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PodiumCard({ entry, onClick }: { entry: LotLeaderboardEntry; onClick: () => void }): React.ReactElement {
  const meta = APARTMENT_TIER_META[entry.apartmentTier];
  const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉';
  const glow = entry.rank === 1 ? '#f2c443' : entry.rank === 2 ? '#bcc3cd' : '#c98a5c';
  return (
    <button
      onClick={onClick}
      style={{
        padding: 10,
        borderRadius: 10,
        border: `2px solid ${glow}`,
        background: `linear-gradient(180deg, ${glow}22 0%, ${entry.ownerColor}15 50%, transparent)`,
        boxShadow: `0 0 18px ${glow}44`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        cursor: 'pointer', color: 'inherit', font: 'inherit',
      }}
    >
      <div style={{ fontSize: 22 }}>{medal}</div>
      <div style={{ fontSize: 26 }}>{entry.ownerLogoId || '🏠'}</div>
      <div style={{ fontWeight: 800, fontSize: 13, color: entry.ownerColor }}>{entry.ownerTag}</div>
      <div className="muted small" style={{ fontSize: 10 }}>({entry.x},{entry.y}) · {meta.label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: glow, textShadow: `0 0 8px ${glow}66` }}>
        ${entry.totalWorth.toLocaleString()}
      </div>
      <div className="muted small" style={{ fontSize: 9, display: 'flex', gap: 6 }}>
        <span>💰 ${(entry.vaultBalance / 1000).toFixed(0)}k</span>
        <span>🚗 {entry.carCount}</span>
        <span>💎 {entry.luxuryCount}</span>
      </div>
    </button>
  );
}

// =====================================================================
// Auctions panel
// =====================================================================

function AuctionsPanel({
  auctions, clock, myTeamTag, onBid,
}: {
  auctions: LotAuctionWire[];
  clock: number;
  myTeamTag: string;
  onBid: (a: LotAuctionWire) => void;
}): React.ReactElement {
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title" style={{ marginBottom: 10 }}>🔨 Live Auctions ({auctions.length})</div>
      {auctions.length === 0 ? (
        <div className="muted small">No live auctions — start one by picking any coord above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
          {auctions.map((a) => {
            const remaining = Math.max(0, a.endsAt - clock);
            const closing = remaining < 5 * 60 * 1000;
            const iLead = a.currentBidderTag === myTeamTag;
            return (
              <div key={a.id} style={{
                padding: 10, borderRadius: 8,
                background: iLead
                  ? 'linear-gradient(90deg, rgba(110,208,154,0.15), transparent)'
                  : 'rgba(255,255,255,0.03)',
                border: `1px solid ${iLead ? 'rgba(110,208,154,0.5)' : 'rgba(255,255,255,0.08)'}`,
                borderLeft: `4px solid ${iLead ? '#6ed09a' : closing ? '#e25555' : '#4b8eff'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                  <strong style={{ fontSize: 14 }}>({a.x},{a.y})</strong>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: closing ? '#e25555' : '#9fb4e4' }}>
                    ⏱ {formatCountdown(remaining)}
                  </span>
                </div>
                <div style={{ marginTop: 4, fontSize: 13 }}>
                  <strong>${a.currentBid.toLocaleString()}</strong>{' '}
                  {a.currentBidderTag && (
                    <span className="muted small">
                      by {a.currentBidderTag}{iLead ? ' (you 🏆)' : ''}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                  <button className="btn btn-tiny btn-accent" onClick={() => onBid(a)} disabled={iLead}
                    title={iLead ? "You're leading" : `Bid $${a.minNextBid.toLocaleString()}+`}
                    style={{ flex: 1, fontWeight: 700 }}>
                    {iLead ? '✓ Leading' : `↑ Bid $${a.minNextBid.toLocaleString()}+`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Bid form
// =====================================================================

function BidFormModal({
  x, y, existing, onClose,
}: {
  x: number;
  y: number;
  existing: LotAuctionWire | null;
  onClose: () => void;
}): React.ReactElement {
  const team = useOnline((s) => s.team);
  const placeBid = useOnline((s) => s.placeLotBid);
  const [amount, setAmount] = useState<number>(existing?.minNextBid ?? LOT_MIN_OPENING_BID);
  const cash = team?.money ?? 0;
  const minRequired = existing?.minNextBid ?? LOT_MIN_OPENING_BID;
  const cantAfford = amount > cash;
  const tooLow = amount < minRequired;

  function submit(): void {
    if (cantAfford || tooLow) return;
    placeBid(x, y, amount);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, padding: 18 }}>
        <div className="modal-head" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{existing ? `Bid on (${x},${y})` : `Open auction at (${x},${y})`}</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>

        {existing ? (
          <div className="muted small" style={{ marginBottom: 10 }}>
            Current high: <strong style={{ color: '#d4d8e1' }}>${existing.currentBid.toLocaleString()}</strong>
            {existing.currentBidderTag && <> by <strong>{existing.currentBidderTag}</strong></>}
            <br />
            Min next bid: <strong style={{ color: '#d4d8e1' }}>${existing.minNextBid.toLocaleString()}</strong>
          </div>
        ) : (
          <div className="muted small" style={{ marginBottom: 10 }}>
            Empty lot — your bid opens the auction. Min: <strong style={{ color: '#d4d8e1' }}>${LOT_MIN_OPENING_BID.toLocaleString()}</strong>.
            <br />
            4-hour countdown begins; resets to 4h on every new bid.
          </div>
        )}

        <label className="muted small" htmlFor="bid-amount">Your bid (cash: ${cash.toLocaleString()})</label>
        <input
          id="bid-amount"
          type="number"
          className="input"
          min={minRequired}
          step={100_000}
          value={amount}
          onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))}
        />

        <div className="muted small" style={{ marginTop: 8, fontSize: 11 }}>
          Funds escrowed at bid time. Refunded automatically if you get outbid. Once you win, the vault earns {(LOT_VAULT_INTEREST_PER_DAY * 100).toFixed(1)}% interest/day (cap {LOT_VAULT_INTEREST_MAX_DAYS} days).
        </div>

        {cantAfford && <div style={{ color: '#e25555', marginTop: 8, fontSize: 12 }}>Not enough cash to escrow.</div>}
        {tooLow && !cantAfford && <div style={{ color: '#e25555', marginTop: 8, fontSize: 12 }}>Below minimum bid.</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-accent" onClick={submit} disabled={cantAfford || tooLow} style={{ flex: 2, fontWeight: 700 }}>
            {existing ? `Bid $${amount.toLocaleString()}` : `Open at $${amount.toLocaleString()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
