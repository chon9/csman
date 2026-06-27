// Virtual real-estate screen — the 1000×1000 grid view.
//
// Three regions:
//   1. Sidebar: live auctions list + bid form, my-lots quick-jump grid
//   2. Map viewport: pannable/zoomable SVG with dots for every owned lot,
//      coloured by owner's team accent + ringed by MMR tier
//   3. Inspect: click a pin → open LotDetailModal; click empty cell →
//      open "start bid" form prefilled with that (x,y)

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from '../onlineStore';
import {
  APARTMENT_TIER_META,
  LOT_MIN_OPENING_BID,
  MAP_SIZE,
  type LotAuctionWire,
  type LotMapPin,
} from '../protocol';
import LotDetailModal from './LotDetailModal';
import ToastStack from './ToastStack';

const VIEWPORT_PX = 560;       // square viewport in CSS px

export default function RealEstateScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const fetchMap = useOnline((s) => s.fetchLotMap);
  const fetchAuctions = useOnline((s) => s.fetchLotAuctions);
  const fetchMine = useOnline((s) => s.fetchMyLots);
  const fetchLotDetail = useOnline((s) => s.fetchLotDetail);
  const pins = useOnline((s) => s.lotMapPins);
  const auctions = useOnline((s) => s.lotAuctions);
  const myLots = useOnline((s) => s.myLots);
  const go = useOnline((s) => s.go);

  // Viewport: centre + zoom. Zoom = cells per viewport edge.
  const [centerX, setCenterX] = useState(500);
  const [centerY, setCenterY] = useState(500);
  const [zoomCells, setZoomCells] = useState(200); // show 200×200 cells

  // 1Hz clock for auction countdowns.
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Initial fetches + periodic auction refresh.
  useEffect(() => {
    fetchAuctions();
    fetchMine();
    const id = setInterval(() => fetchAuctions(), 30_000);
    return () => clearInterval(id);
  }, [fetchAuctions, fetchMine]);

  // Map fetch whenever viewport changes.
  useEffect(() => {
    const half = Math.floor(zoomCells / 2);
    const x0 = Math.max(0, centerX - half);
    const y0 = Math.max(0, centerY - half);
    const x1 = Math.min(MAP_SIZE - 1, centerX + half);
    const y1 = Math.min(MAP_SIZE - 1, centerY + half);
    fetchMap(x0, y0, x1, y1);
  }, [centerX, centerY, zoomCells, fetchMap]);

  // Click handlers
  const [bidForm, setBidForm] = useState<{ x: number; y: number; amount: number } | null>(null);

  function onCellClick(x: number, y: number): void {
    // If a pin exists at this exact cell, open the detail.
    const pin = pins.find((p) => p.x === x && p.y === y);
    if (pin) {
      fetchLotDetail(x, y);
      return;
    }
    // Otherwise, see if there's an open auction at this cell.
    const auc = auctions.find((a) => a.x === x && a.y === y);
    if (auc) {
      setBidForm({ x, y, amount: auc.minNextBid });
    } else {
      setBidForm({ x, y, amount: LOT_MIN_OPENING_BID });
    }
  }

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>🏘 Real Estate</h2>
          <div className="muted small">
            {MAP_SIZE}×{MAP_SIZE} virtual grid. Bid on any unowned (x,y) at min ${LOT_MIN_OPENING_BID.toLocaleString()}. Anti-snipe: 4-hour countdown resets on every new bid.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="muted small">Cash: <strong>${team.money.toLocaleString()}</strong></span>
          <span className="muted small">My lots: <strong>{myLots.length}</strong></span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, alignItems: 'flex-start' }}>
        {/* ===== Map viewport ===== */}
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div className="panel-title" style={{ margin: 0 }}>Map · viewport ({centerX - Math.floor(zoomCells / 2)},{centerY - Math.floor(zoomCells / 2)}) – ({centerX + Math.floor(zoomCells / 2)},{centerY + Math.floor(zoomCells / 2)})</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn btn-tiny" onClick={() => setZoomCells((z) => Math.min(800, z * 2))} title="Zoom out">−</button>
              <button className="btn btn-tiny" onClick={() => setZoomCells((z) => Math.max(20, Math.floor(z / 2)))} title="Zoom in">+</button>
              <button className="btn btn-tiny" onClick={() => { setCenterX(500); setCenterY(500); setZoomCells(200); }} title="Centre map">⌖</button>
            </div>
          </div>
          <MapViewport
            pins={pins}
            auctions={auctions}
            centerX={centerX}
            centerY={centerY}
            zoomCells={zoomCells}
            onPan={(dx, dy) => {
              setCenterX((x) => Math.max(0, Math.min(MAP_SIZE - 1, x + dx)));
              setCenterY((y) => Math.max(0, Math.min(MAP_SIZE - 1, y + dy)));
            }}
            onCellClick={onCellClick}
            myTeamId={team.id}
          />
          <div className="muted small" style={{ marginTop: 8 }}>
            Drag to pan · click a coloured pin to view lot · click empty cell to bid · zoom shows {zoomCells}×{zoomCells} cells.
          </div>
        </div>

        {/* ===== Sidebar: auctions + my lots ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel" style={{ padding: 14 }}>
            <div className="panel-title">Live Auctions ({auctions.length})</div>
            {auctions.length === 0 && <div className="muted small" style={{ marginTop: 6 }}>No active auctions — click any empty cell to start one.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
              {auctions.map((a) => (
                <AuctionRow
                  key={a.id}
                  auc={a}
                  now={clock}
                  myTeamTag={team.tag}
                  onBid={() => setBidForm({ x: a.x, y: a.y, amount: a.minNextBid })}
                  onJump={() => { setCenterX(a.x); setCenterY(a.y); setZoomCells(40); }}
                />
              ))}
            </div>
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div className="panel-title">My Lots ({myLots.length})</div>
            {myLots.length === 0 && <div className="muted small" style={{ marginTop: 6 }}>You don't own any lots yet — win an auction to claim one.</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6, marginTop: 8 }}>
              {myLots.map((l) => {
                const meta = APARTMENT_TIER_META[l.apartmentTier];
                return (
                  <button
                    key={`${l.x},${l.y}`}
                    className="btn"
                    onClick={() => { setCenterX(l.x); setCenterY(l.y); setZoomCells(20); fetchLotDetail(l.x, l.y); }}
                    style={{
                      padding: '8px 6px',
                      background: `linear-gradient(135deg, ${l.ownerColor}33, transparent)`,
                      border: `1px solid ${meta.color}55`,
                      fontSize: 11,
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 16 }}>{l.ownerLogoId || '🏠'}</div>
                    <div style={{ fontWeight: 700 }}>({l.x},{l.y})</div>
                    <div className="muted" style={{ fontSize: 10, color: meta.color }}>{meta.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {bidForm && (
        <BidFormModal
          x={bidForm.x}
          y={bidForm.y}
          initialAmount={bidForm.amount}
          existing={auctions.find((a) => a.x === bidForm.x && a.y === bidForm.y) ?? null}
          onClose={() => setBidForm(null)}
        />
      )}

      <LotDetailModal />

      <ToastStack />
    </div>
  );
}

// =====================================================================
// Map viewport — SVG with pan + click
// =====================================================================

function MapViewport({
  pins, auctions, centerX, centerY, zoomCells, onPan, onCellClick, myTeamId,
}: {
  pins: LotMapPin[];
  auctions: LotAuctionWire[];
  centerX: number;
  centerY: number;
  zoomCells: number;
  onPan: (dx: number, dy: number) => void;
  onCellClick: (x: number, y: number) => void;
  myTeamId: string;
}): React.ReactElement {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<{ startX: number; startY: number; lastDx: number; lastDy: number } | null>(null);

  const cellPx = VIEWPORT_PX / zoomCells;
  const half = Math.floor(zoomCells / 2);

  function toCell(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const cx = Math.floor(localX / cellPx) - half + centerX;
    const cy = Math.floor(localY / cellPx) - half + centerY;
    if (cx < 0 || cx >= MAP_SIZE || cy < 0 || cy >= MAP_SIZE) return null;
    return { x: cx, y: cy };
  }

  function onMouseDown(e: React.MouseEvent): void {
    setDragging({ startX: e.clientX, startY: e.clientY, lastDx: 0, lastDy: 0 });
  }
  function onMouseMove(e: React.MouseEvent): void {
    if (!dragging) return;
    const cellDx = -Math.round((e.clientX - dragging.startX) / cellPx);
    const cellDy = -Math.round((e.clientY - dragging.startY) / cellPx);
    if (cellDx !== dragging.lastDx || cellDy !== dragging.lastDy) {
      onPan(cellDx - dragging.lastDx, cellDy - dragging.lastDy);
      setDragging({ ...dragging, lastDx: cellDx, lastDy: cellDy });
    }
  }
  function onMouseUp(e: React.MouseEvent): void {
    const wasDrag = dragging && (Math.abs(e.clientX - dragging.startX) > 4 || Math.abs(e.clientY - dragging.startY) > 4);
    setDragging(null);
    if (!wasDrag) {
      const cell = toCell(e.clientX, e.clientY);
      if (cell) onCellClick(cell.x, cell.y);
    }
  }

  // Render pins + auctions visible in the viewport.
  const visiblePins = useMemo(() => pins.filter((p) =>
    p.x >= centerX - half && p.x <= centerX + half &&
    p.y >= centerY - half && p.y <= centerY + half), [pins, centerX, centerY, half]);
  const visibleAuctions = useMemo(() => auctions.filter((a) =>
    a.x >= centerX - half && a.x <= centerX + half &&
    a.y >= centerY - half && a.y <= centerY + half), [auctions, centerX, centerY, half]);

  return (
    <div
      style={{
        position: 'relative',
        width: VIEWPORT_PX,
        height: VIEWPORT_PX,
        maxWidth: '100%',
        background: 'linear-gradient(135deg, #0c1018 0%, #11161f 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        userSelect: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        overflow: 'hidden',
      }}
    >
      <svg
        ref={svgRef}
        width={VIEWPORT_PX}
        height={VIEWPORT_PX}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => setDragging(null)}
      >
        {/* Subtle grid lines every 10 cells. */}
        {zoomCells <= 100 && (
          <g stroke="rgba(255,255,255,0.04)" strokeWidth="0.5">
            {Array.from({ length: zoomCells / 10 + 1 }, (_, i) => i * 10 * cellPx).map((p, i) => (
              <line key={`v${i}`} x1={p} y1={0} x2={p} y2={VIEWPORT_PX} />
            ))}
            {Array.from({ length: zoomCells / 10 + 1 }, (_, i) => i * 10 * cellPx).map((p, i) => (
              <line key={`h${i}`} x1={0} y1={p} x2={VIEWPORT_PX} y2={p} />
            ))}
          </g>
        )}

        {/* Open auctions — orange pulse */}
        {visibleAuctions.map((a) => {
          const cx = (a.x - centerX + half + 0.5) * cellPx;
          const cy = (a.y - centerY + half + 0.5) * cellPx;
          const r = Math.max(3, cellPx * 0.35);
          return (
            <g key={a.id}>
              <circle cx={cx} cy={cy} r={r * 2.5} fill="#de9b35" opacity={0.18}>
                <animate attributeName="r" values={`${r * 2};${r * 3.5};${r * 2}`} dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.18;0.05;0.18" dur="1.8s" repeatCount="indefinite" />
              </circle>
              <circle cx={cx} cy={cy} r={r} fill="#de9b35" stroke="#fff" strokeWidth="1" />
            </g>
          );
        })}

        {/* Owned lot pins */}
        {visiblePins.map((p) => {
          const cx = (p.x - centerX + half + 0.5) * cellPx;
          const cy = (p.y - centerY + half + 0.5) * cellPx;
          const r = Math.max(2, cellPx * 0.40);
          const isMine = p.ownerTeamId === myTeamId;
          return (
            <g key={`${p.x}-${p.y}`}>
              <circle cx={cx} cy={cy} r={r} fill={p.ownerColor} stroke={isMine ? '#ffeb3b' : '#0a0d12'} strokeWidth={isMine ? 1.5 : 0.5} />
              {/* Logo emoji label if cells are big enough */}
              {cellPx >= 18 && p.ownerLogoId && (
                <text x={cx} y={cy + r * 0.7} fontSize={r * 1.2} textAnchor="middle" pointerEvents="none">{p.ownerLogoId}</text>
              )}
            </g>
          );
        })}

        {/* Centre crosshair */}
        <g stroke="rgba(255,255,255,0.18)" strokeWidth="1">
          <line x1={VIEWPORT_PX / 2 - 5} y1={VIEWPORT_PX / 2} x2={VIEWPORT_PX / 2 + 5} y2={VIEWPORT_PX / 2} />
          <line x1={VIEWPORT_PX / 2} y1={VIEWPORT_PX / 2 - 5} x2={VIEWPORT_PX / 2} y2={VIEWPORT_PX / 2 + 5} />
        </g>
      </svg>
    </div>
  );
}

// =====================================================================
// Auction list row
// =====================================================================

function AuctionRow({
  auc, now, myTeamTag, onBid, onJump,
}: {
  auc: LotAuctionWire;
  now: number;
  myTeamTag: string;
  onBid: () => void;
  onJump: () => void;
}): React.ReactElement {
  const remaining = Math.max(0, auc.endsAt - now);
  const closing = remaining < 5 * 60 * 1000;
  const iLead = auc.currentBidderTag === myTeamTag;
  return (
    <div style={{
      padding: 10, borderRadius: 6,
      background: iLead ? 'rgba(110,208,154,0.10)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${iLead ? 'rgba(110,208,154,0.4)' : 'rgba(255,255,255,0.08)'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <button onClick={onJump} className="link-btn" style={{ padding: 0, fontWeight: 700 }}>
          ({auc.x},{auc.y}) 🔍
        </button>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: closing ? '#e25555' : '#9fb4e4' }}>
          {formatCountdown(remaining)}
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 13 }}>
        <strong>${auc.currentBid.toLocaleString()}</strong>{' '}
        {auc.currentBidderTag && <span className="muted small">by {auc.currentBidderTag}{iLead ? ' (you)' : ''}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button className="btn btn-tiny btn-accent" onClick={onBid} disabled={iLead} title={iLead ? "You're already leading" : `Bid at least $${auc.minNextBid.toLocaleString()}`}>
          {iLead ? 'Leading' : `Bid $${auc.minNextBid.toLocaleString()}+`}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Bid form modal
// =====================================================================

function BidFormModal({
  x, y, initialAmount, existing, onClose,
}: {
  x: number;
  y: number;
  initialAmount: number;
  existing: LotAuctionWire | null;
  onClose: () => void;
}): React.ReactElement {
  const team = useOnline((s) => s.team);
  const placeBid = useOnline((s) => s.placeLotBid);
  const [amount, setAmount] = useState<number>(initialAmount);

  const cash = team?.money ?? 0;
  const cantAfford = amount > cash;
  const tooLow = amount < (existing?.minNextBid ?? LOT_MIN_OPENING_BID);

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
            4-hour countdown begins; resets to 4h on every subsequent bid.
          </div>
        )}

        <label className="muted small" htmlFor="bid-amount">Your bid (cash: ${cash.toLocaleString()})</label>
        <input
          id="bid-amount"
          type="number"
          className="input"
          min={existing?.minNextBid ?? LOT_MIN_OPENING_BID}
          step={100_000}
          value={amount}
          onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))}
        />

        <div className="muted small" style={{ marginTop: 8, fontSize: 11 }}>
          Funds are escrowed at bid time. If outbid, you're refunded automatically.
        </div>

        {cantAfford && <div style={{ color: '#e25555', marginTop: 8, fontSize: 12 }}>Not enough cash to escrow.</div>}
        {tooLow && !cantAfford && <div style={{ color: '#e25555', marginTop: 8, fontSize: 12 }}>Below minimum next bid.</div>}

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
