// Virtual real-estate market.
//
// 1000×1000 sparse grid. Any unowned (x,y) can be bid on at $1M+. First
// bid spawns a 4-hour auction; subsequent bids must clear the current
// high by ≥10% AND reset the countdown (anti-snipe). Bid money is
// ESCROWED at bid time (deducted from team.money) and refunded when
// outbid. Winner gets the lot; losing bidders had already been refunded
// when outbid, so close is a clean transfer.
//
// Lots carry: apartment tier (storage caps), garage of cars, vault
// balance, resident roster, luxury showcase. Everything is purchased
// from the owner's team.money — no separate currency.

import { randomBytes } from 'node:crypto';
import {
  APARTMENT_TIER_META,
  APARTMENT_TIER_ORDER,
  CAR_CATALOG,
  LOT_AUCTION_DURATION_MS,
  LOT_BID_INCREMENT,
  LOT_MIN_OPENING_BID,
  LOT_VAULT_INTEREST_MAX_DAYS,
  LOT_VAULT_INTEREST_MIN_CLAIM,
  LOT_VAULT_INTEREST_PER_DAY,
  LUXURY_CATALOG,
  MAP_SIZE,
  findCar,
  findLuxury,
  type ApartmentTier,
  type LotAuctionWire,
  type LotDetailWire,
  type LotLeaderboardEntry,
  type LotMapPin,
} from '../../src/online/protocol.ts';
import type { DB } from './db.ts';
import type { Broadcast, NotifyTeam } from './handlers.ts';

// ---------------------------------------------------------------------
// Validation + math helpers
// ---------------------------------------------------------------------

export function isValidCoord(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && x < MAP_SIZE && y >= 0 && y < MAP_SIZE;
}

/** Minimum amount the next bid must exceed (current bid × (1 + increment)). */
export function minNextBidFor(currentBid: number): number {
  if (currentBid <= 0) return LOT_MIN_OPENING_BID;
  return Math.ceil(currentBid * (1 + LOT_BID_INCREMENT));
}

// ---------------------------------------------------------------------
// Wire conversion
// ---------------------------------------------------------------------

function auctionToWire(db: DB, row: ReturnType<DB['loadAuction']> & object, forTeamId: string | null): LotAuctionWire {
  const bidderTag = row.current_bidder_team_id
    ? db.loadTeam(row.current_bidder_team_id)?.tag ?? null
    : null;
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    currentBid: row.current_bid,
    currentBidderTag: bidderTag,
    currentBidderTeamId: row.current_bidder_team_id,
    iAmHighBidder: forTeamId !== null && row.current_bidder_team_id === forTeamId,
    minNextBid: minNextBidFor(row.current_bid),
  };
}

function lotToMapPin(db: DB, row: ReturnType<DB['loadLot']> & object): LotMapPin | null {
  const owner = db.loadTeam(row.owner_team_id);
  if (!owner) return null;
  return {
    x: row.x,
    y: row.y,
    ownerTeamId: owner.id,
    ownerTag: owner.tag,
    ownerLogoId: owner.logoId || '',
    ownerColor: owner.primaryColor || '#de9b35',
    ownerMmr: owner.mmr,
    apartmentTier: row.apartment_tier as ApartmentTier,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Pending vault interest for a lot — floor((now - lastInterestAt) / 24h)
 *  days, capped by LOT_VAULT_INTEREST_MAX_DAYS, times current balance
 *  times daily rate. Returns 0 for empty vaults. */
function computePendingInterest(row: { vault_balance: number; last_interest_at: number; created_at: number }): { amount: number; days: number } {
  if (row.vault_balance <= 0) return { amount: 0, days: 0 };
  const anchor = row.last_interest_at > 0 ? row.last_interest_at : row.created_at;
  const rawDays = Math.floor((Date.now() - anchor) / MS_PER_DAY);
  const days = Math.max(0, Math.min(LOT_VAULT_INTEREST_MAX_DAYS, rawDays));
  if (days <= 0) return { amount: 0, days: 0 };
  const amount = Math.floor(row.vault_balance * LOT_VAULT_INTEREST_PER_DAY * days);
  return { amount, days };
}

export function loadLotDetailWire(db: DB, lotId: string): LotDetailWire | null {
  const row = db.loadLot(lotId);
  if (!row) return null;
  const owner = db.loadTeam(row.owner_team_id);
  if (!owner) return null;
  const cars = db.loadLotCars(lotId).map((c) => ({ id: c.id, carId: c.car_id, boughtAt: c.bought_at }));
  const luxuries = db.loadLotLuxuries(lotId).map((l) => ({ id: l.id, itemId: l.item_id, boughtAt: l.bought_at }));
  const residents = db.loadLotResidents(lotId).map((r) => ({ playerId: r.player_id, movedInAt: r.moved_in_at }));
  // Bid history from the auction that won this lot (if any).
  const bids = row.won_auction_id ? db.loadLotBids(row.won_auction_id) : [];
  const pending = computePendingInterest(row);
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    ownerTeamId: owner.id,
    ownerTag: owner.tag,
    ownerName: owner.name,
    ownerLogoId: owner.logoId || '',
    ownerColor: owner.primaryColor || '#de9b35',
    ownerMmr: owner.mmr,
    ownerPeakMmr: owner.peakMmr,
    ownerPlacementPlayed: owner.placementMatchesPlayed,
    apartmentTier: row.apartment_tier as ApartmentTier,
    vaultBalance: row.vault_balance,
    pendingInterest: pending.amount,
    interestDaysAccrued: pending.days,
    lastInterestAt: row.last_interest_at > 0 ? row.last_interest_at : row.created_at,
    cars,
    luxuries,
    residents,
    createdAt: row.created_at,
    bidHistory: bids.map((b) => ({ bidderTag: b.bidder_tag, amount: b.amount, placedAt: b.placed_at })),
  };
}

/** Owner-only: collect the pending interest into the vault balance
 *  (subject to the vault cap for the current tier). Resets the interest
 *  clock so the next accrual starts from now. */
export function collectVaultInterest(db: DB, teamId: string, lotId: string): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  const pending = computePendingInterest(own.lot);
  if (pending.amount < LOT_VAULT_INTEREST_MIN_CLAIM) {
    return { ok: false, code: 'no-interest', message: `Interest not ready yet — accrues at ${(LOT_VAULT_INTEREST_PER_DAY * 100).toFixed(1)}%/day on the current balance.` };
  }
  const cap = APARTMENT_TIER_META[own.lot.apartment_tier as ApartmentTier].vaultCap;
  const room = cap === -1 ? pending.amount : Math.max(0, cap - own.lot.vault_balance);
  const credit = Math.min(pending.amount, room);
  if (credit <= 0) {
    return { ok: false, code: 'vault-cap', message: `Vault is at its cap ($${cap.toLocaleString()}) — withdraw or upgrade before collecting.` };
  }
  db.setLotVault(lotId, own.lot.vault_balance + credit);
  db.setLotInterestAt(lotId, Date.now());
  return { ok: true, newMoney: own.team.money };
}

/** Top-N richest lots by total flex — vault + garage catalog value + luxury
 *  catalog value. Cars/luxuries are valued at full catalog price (not the
 *  60% resale), so upgrading actually shows on the board. */
export function loadLeaderboard(db: DB, limit = 10): LotLeaderboardEntry[] {
  const scored = db.loadAllLots().map((row) => {
    const cars = db.loadLotCars(row.id);
    const luxuries = db.loadLotLuxuries(row.id);
    const carsValue = cars.reduce((s, c) => s + (findCar(c.car_id)?.price ?? 0), 0);
    const luxuriesValue = luxuries.reduce((s, l) => s + (findLuxury(l.item_id)?.price ?? 0), 0);
    const residentCount = db.countLotResidentsFor(row.id);
    return { row, carsValue, luxuriesValue, carCount: cars.length, luxuryCount: luxuries.length, residentCount };
  });
  scored.sort((a, b) => (b.row.vault_balance + b.carsValue + b.luxuriesValue) - (a.row.vault_balance + a.carsValue + a.luxuriesValue));
  const out: LotLeaderboardEntry[] = [];
  for (let i = 0; i < Math.min(limit, scored.length); i++) {
    const s = scored[i]!;
    const owner = db.loadTeam(s.row.owner_team_id);
    if (!owner) continue;
    out.push({
      rank: i + 1,
      lotId: s.row.id,
      x: s.row.x,
      y: s.row.y,
      ownerTeamId: owner.id,
      ownerTag: owner.tag,
      ownerName: owner.name,
      ownerLogoId: owner.logoId || '',
      ownerColor: owner.primaryColor || '#de9b35',
      apartmentTier: s.row.apartment_tier as ApartmentTier,
      vaultBalance: s.row.vault_balance,
      carsValue: s.carsValue,
      luxuriesValue: s.luxuriesValue,
      totalWorth: s.row.vault_balance + s.carsValue + s.luxuriesValue,
      carCount: s.carCount,
      luxuryCount: s.luxuryCount,
      residentCount: s.residentCount,
    });
  }
  return out;
}

/** Build the auctions list. forTeamId is the requesting team — drives the
 *  `iAmHighBidder` flag client-side. */
export function loadAllAuctionsWire(db: DB, forTeamId: string | null): LotAuctionWire[] {
  return db.loadAllOpenAuctions().map((row) => auctionToWire(db, row, forTeamId));
}

export function loadMapPins(db: DB, x0: number, y0: number, x1: number, y1: number): LotMapPin[] {
  return db.loadLotsInBox(x0, y0, x1, y1).map((r) => lotToMapPin(db, r)).filter((p): p is LotMapPin => p !== null);
}

export function loadMyLots(db: DB, teamId: string): LotMapPin[] {
  return db.loadLotsForOwner(teamId).map((r) => lotToMapPin(db, r)).filter((p): p is LotMapPin => p !== null);
}

// ---------------------------------------------------------------------
// Auction lifecycle
// ---------------------------------------------------------------------

export type BidResult =
  | { ok: true; auction: LotAuctionWire; newMoney: number; refundToPrevBidder?: { teamId: string; amount: number } }
  | { ok: false; code: string; message: string };

/** Place a bid on (x,y). If no open auction exists, this starts one. */
export function placeBid(
  db: DB,
  bidderTeamId: string,
  x: number,
  y: number,
  amount: number,
): BidResult {
  if (!isValidCoord(x, y)) return { ok: false, code: 'bad-coord', message: 'Coordinate out of bounds.' };
  amount = Math.floor(amount);
  if (amount < LOT_MIN_OPENING_BID) {
    return { ok: false, code: 'bid-too-low', message: `Opening bid must be at least $${LOT_MIN_OPENING_BID.toLocaleString()}.` };
  }
  const owned = db.loadLotByCoord(x, y);
  if (owned) return { ok: false, code: 'already-owned', message: `(${x},${y}) is already owned by ${db.loadTeam(owned.owner_team_id)?.tag ?? '?'}.` };
  const bidder = db.loadTeam(bidderTeamId);
  if (!bidder) return { ok: false, code: 'no-team', message: 'Team missing.' };
  if (bidder.money < amount) {
    return { ok: false, code: 'insufficient-funds', message: `Need $${amount.toLocaleString()} on hand to escrow this bid (you have $${bidder.money.toLocaleString()}).` };
  }

  let auction = db.loadOpenAuctionAtCoord(x, y);
  if (!auction) {
    // Start a brand new auction. Opening bid sets the floor.
    const id = `lot-auc-${randomBytes(6).toString('hex')}`;
    const now = Date.now();
    db.createLotAuction({ id, x, y, startedAt: now, endsAt: now + LOT_AUCTION_DURATION_MS, openingBid: amount, bidderTeamId });
    // Escrow the opening bid.
    bidder.money -= amount;
    db.setTeamMoneyDay(bidder.id, bidder.money, bidder.day);
    db.recordLotBid({ auctionId: id, bidderTeamId, bidderTag: bidder.tag, amount });
    const fresh = db.loadAuction(id);
    if (!fresh) return { ok: false, code: 'server-error', message: 'Auction vanished.' };
    return { ok: true, auction: auctionToWire(db, fresh, bidderTeamId), newMoney: bidder.money };
  }

  // Existing auction — must beat the current high by at least the increment.
  const minNext = minNextBidFor(auction.current_bid);
  if (amount < minNext) {
    return { ok: false, code: 'bid-too-low', message: `Min next bid is $${minNext.toLocaleString()} (current $${auction.current_bid.toLocaleString()} + ${Math.round(LOT_BID_INCREMENT * 100)}%).` };
  }
  if (auction.current_bidder_team_id === bidderTeamId) {
    return { ok: false, code: 'already-leading', message: `You're already the high bidder.` };
  }

  // Refund the previous high bidder (their escrow row gets cleared).
  let refundToPrev: { teamId: string; amount: number } | undefined;
  if (auction.current_bidder_team_id) {
    const prevTeamId = auction.current_bidder_team_id;
    const prev = db.loadTeam(prevTeamId);
    if (prev) {
      const escrowRows = db.loadUnrefundedBidsForBidder(auction.id, prevTeamId);
      // Sum unrefunded escrow for this bidder (should be exactly the
      // current_bid, but be defensive about partials).
      let refund = 0;
      for (const r of escrowRows) {
        refund += r.amount;
        db.markLotBidRefunded(r.id);
      }
      prev.money += refund;
      db.setTeamMoneyDay(prev.id, prev.money, prev.day);
      refundToPrev = { teamId: prevTeamId, amount: refund };
    }
  }

  // Escrow the new high bid.
  bidder.money -= amount;
  db.setTeamMoneyDay(bidder.id, bidder.money, bidder.day);
  db.recordLotBid({ auctionId: auction.id, bidderTeamId, bidderTag: bidder.tag, amount });

  // Anti-snipe: reset the countdown to the full duration on every new bid.
  const newEndsAt = Date.now() + LOT_AUCTION_DURATION_MS;
  db.updateLotAuctionBid(auction.id, amount, bidderTeamId, newEndsAt);
  const fresh = db.loadAuction(auction.id);
  if (!fresh) return { ok: false, code: 'server-error', message: 'Auction vanished after bid.' };
  return { ok: true, auction: auctionToWire(db, fresh, bidderTeamId), newMoney: bidder.money, refundToPrevBidder: refundToPrev };
}

/** Close every auction whose ends_at has passed. */
export function closeDueAuctions(db: DB, notifyTeam: NotifyTeam, broadcast: Broadcast, log: (s: string) => void): void {
  const due = db.loadDueLotAuctions(Date.now());
  for (const row of due) {
    try { closeOneAuction(db, row, notifyTeam, broadcast, log); }
    catch (err) { log(`lot-auction close error on ${row.id}: ${String(err)}`); }
  }
}

function closeOneAuction(
  db: DB,
  row: { id: string; x: number; y: number; current_bid: number; current_bidder_team_id: string | null },
  notifyTeam: NotifyTeam,
  broadcast: Broadcast,
  log: (s: string) => void,
): void {
  if (!row.current_bidder_team_id) {
    // No bidder somehow — void it.
    db.voidLotAuction(row.id);
    return;
  }
  const winnerId = row.current_bidder_team_id;
  // Winner's escrow stays consumed (they paid at bid time). Just mark
  // the bid as already-applied so refund pass doesn't double-credit.
  for (const r of db.loadUnrefundedBidsForBidder(row.id, winnerId)) {
    db.markLotBidRefunded(r.id);
  }
  // Create the lot.
  const lotId = `lot-${randomBytes(6).toString('hex')}`;
  db.createLot({ id: lotId, x: row.x, y: row.y, ownerTeamId: winnerId, wonAuctionId: row.id });
  db.closeLotAuction(row.id, winnerId);
  log(`lot-auction won: (${row.x},${row.y}) → ${db.loadTeam(winnerId)?.tag ?? '?'} for $${row.current_bid}`);

  const lot = loadLotDetailWire(db, lotId);
  const winnerMoney = db.loadTeam(winnerId)?.money ?? 0;
  if (lot) notifyTeam(winnerId, { kind: 'lot-auction-won', lot, newMoney: winnerMoney });
  // Broadcast updated auctions list trigger — clients re-pull their view.
  broadcast({
    kind: 'lot-auction-update',
    auction: { ...auctionToWire(db, db.loadAuction(row.id)!, null), endsAt: 0 },
  });
}

// ---------------------------------------------------------------------
// Owner-only mutations
// ---------------------------------------------------------------------

export type OwnerActionResult = { ok: true; newMoney: number } | { ok: false; code: string; message: string };

function ensureOwner(db: DB, lotId: string, teamId: string) {
  const lot = db.loadLot(lotId);
  if (!lot) return { ok: false as const, code: 'no-lot', message: 'Lot not found.' };
  if (lot.owner_team_id !== teamId) return { ok: false as const, code: 'not-owner', message: 'You do not own this lot.' };
  const team = db.loadTeam(teamId);
  if (!team) return { ok: false as const, code: 'no-team', message: 'Team missing.' };
  return { ok: true as const, lot, team };
}

export function upgradeApartment(db: DB, teamId: string, lotId: string, toTier: ApartmentTier): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  const fromIdx = APARTMENT_TIER_ORDER.indexOf(own.lot.apartment_tier as ApartmentTier);
  const toIdx = APARTMENT_TIER_ORDER.indexOf(toTier);
  if (toIdx < 0) return { ok: false, code: 'bad-tier', message: 'Unknown apartment tier.' };
  if (toIdx <= fromIdx) return { ok: false, code: 'no-downgrade', message: 'Upgrades only — pick a higher tier.' };
  const cost = APARTMENT_TIER_META[toTier].upgradeCost;
  if (own.team.money < cost) {
    return { ok: false, code: 'insufficient-funds', message: `Need $${cost.toLocaleString()} for ${APARTMENT_TIER_META[toTier].label}.` };
  }
  own.team.money -= cost;
  db.setTeamMoneyDay(own.team.id, own.team.money, own.team.day);
  db.setLotApartmentTier(lotId, toTier);
  return { ok: true, newMoney: own.team.money };
}

export function buyCar(db: DB, teamId: string, lotId: string, carId: string): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  const car = findCar(carId);
  if (!car) return { ok: false, code: 'no-car', message: 'Unknown car.' };
  const tierMeta = APARTMENT_TIER_META[own.lot.apartment_tier as ApartmentTier];
  if (db.countLotCarsFor(lotId) >= tierMeta.carSlots) {
    return { ok: false, code: 'garage-full', message: `Garage full (${tierMeta.carSlots} slots) — upgrade the apartment.` };
  }
  if (own.team.money < car.price) {
    return { ok: false, code: 'insufficient-funds', message: `Need $${car.price.toLocaleString()} for the ${car.brand} ${car.model}.` };
  }
  own.team.money -= car.price;
  db.setTeamMoneyDay(own.team.id, own.team.money, own.team.day);
  db.addLotCar(lotId, carId);
  return { ok: true, newMoney: own.team.money };
}

/** Sell a car back for 60% of catalogue price — never want a flip-loop be profitable. */
export function sellCar(db: DB, teamId: string, lotId: string, lotCarId: number): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  const row = db.loadLotCar(lotId, lotCarId);
  if (!row) return { ok: false, code: 'no-car', message: 'Car not in this garage.' };
  const car = findCar(row.car_id);
  const refund = car ? Math.round(car.price * 0.60) : 0;
  db.removeLotCar(lotCarId);
  own.team.money += refund;
  db.setTeamMoneyDay(own.team.id, own.team.money, own.team.day);
  return { ok: true, newMoney: own.team.money };
}

export function buyLuxury(db: DB, teamId: string, lotId: string, itemId: string): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  const item = findLuxury(itemId);
  if (!item) return { ok: false, code: 'no-item', message: 'Unknown item.' };
  const tierMeta = APARTMENT_TIER_META[own.lot.apartment_tier as ApartmentTier];
  if (db.countLotLuxuriesFor(lotId) >= tierMeta.luxurySlots) {
    return { ok: false, code: 'showcase-full', message: `Showcase full (${tierMeta.luxurySlots} slots) — upgrade the apartment.` };
  }
  if (own.team.money < item.price) {
    return { ok: false, code: 'insufficient-funds', message: `Need $${item.price.toLocaleString()} for the ${item.label}.` };
  }
  own.team.money -= item.price;
  db.setTeamMoneyDay(own.team.id, own.team.money, own.team.day);
  db.addLotLuxury(lotId, itemId);
  return { ok: true, newMoney: own.team.money };
}

export function sellLuxury(db: DB, teamId: string, lotId: string, lotLuxuryId: number): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  const row = db.loadLotLuxury(lotId, lotLuxuryId);
  if (!row) return { ok: false, code: 'no-item', message: 'Item not in this showcase.' };
  const item = findLuxury(row.item_id);
  const refund = item ? Math.round(item.price * 0.60) : 0;
  db.removeLotLuxury(lotLuxuryId);
  own.team.money += refund;
  db.setTeamMoneyDay(own.team.id, own.team.money, own.team.day);
  return { ok: true, newMoney: own.team.money };
}

export function depositVault(db: DB, teamId: string, lotId: string, amount: number): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  amount = Math.floor(amount);
  if (amount <= 0) return { ok: false, code: 'bad-amount', message: 'Deposit must be positive.' };
  if (own.team.money < amount) return { ok: false, code: 'insufficient-funds', message: 'Not enough cash on hand.' };
  const cap = APARTMENT_TIER_META[own.lot.apartment_tier as ApartmentTier].vaultCap;
  if (cap !== -1 && own.lot.vault_balance + amount > cap) {
    return { ok: false, code: 'vault-cap', message: `Vault cap is $${cap.toLocaleString()} — can only accept $${Math.max(0, cap - own.lot.vault_balance).toLocaleString()} more.` };
  }
  own.team.money -= amount;
  db.setTeamMoneyDay(own.team.id, own.team.money, own.team.day);
  db.setLotVault(lotId, own.lot.vault_balance + amount);
  return { ok: true, newMoney: own.team.money };
}

export function withdrawVault(db: DB, teamId: string, lotId: string, amount: number): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  amount = Math.floor(amount);
  if (amount <= 0) return { ok: false, code: 'bad-amount', message: 'Withdrawal must be positive.' };
  if (amount > own.lot.vault_balance) return { ok: false, code: 'insufficient-vault', message: `Vault only has $${own.lot.vault_balance.toLocaleString()}.` };
  own.team.money += amount;
  db.setTeamMoneyDay(own.team.id, own.team.money, own.team.day);
  db.setLotVault(lotId, own.lot.vault_balance - amount);
  return { ok: true, newMoney: own.team.money };
}

export function assignResident(db: DB, teamId: string, lotId: string, playerId: string): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  const player = db.loadPlayer(playerId);
  if (!player || player.teamId !== teamId) return { ok: false, code: 'not-your-player', message: 'Player not on your roster.' };
  if (db.residencyOf(playerId)) return { ok: false, code: 'already-housed', message: `${player.nickname} already lives in one of your lots.` };
  const tierMeta = APARTMENT_TIER_META[own.lot.apartment_tier as ApartmentTier];
  if (db.countLotResidentsFor(lotId) >= tierMeta.residentSlots) {
    return { ok: false, code: 'full', message: `Apartment full (${tierMeta.residentSlots} beds) — upgrade.` };
  }
  db.addLotResident(lotId, playerId);
  return { ok: true, newMoney: own.team.money };
}

export function evictResident(db: DB, teamId: string, lotId: string, playerId: string): OwnerActionResult {
  const own = ensureOwner(db, lotId, teamId);
  if (!own.ok) return own;
  db.removeLotResident(lotId, playerId);
  return { ok: true, newMoney: own.team.money };
}

// Re-export catalogues for convenience.
export { CAR_CATALOG, LUXURY_CATALOG };
