// Wire protocol shared between the multiplayer server and the React client.
// JSON-over-WebSocket, one message per frame. Both sides import this file
// directly (server's tsconfig.json adds it to its include list) so the type
// system catches mismatched payloads at compile time.

import type { MatchFormat, MatchResult, Player, PlayerAttributes, PlayerRole, Region, Tactics } from '../types';

// ============ Server-authoritative view of a team ============

/** Slim team snapshot sent to the owning client. AI / opponent teams use a
 *  separate scrubbed shape (no money, no PIN, etc.) once we add public listings. */
export interface OnlineTeam {
  id: string;
  name: string;
  tag: string;
  region: Region;
  /** Owner's display nickname (read-only on the client). */
  ownerNick: string;
  /** Cash in USD. Used for transfers + duel entry fees + time-skip purchases. */
  money: number;
  /** This team's own day counter (per-team clock — duels resolve instantly). */
  day: number;
  /** UTC ms of team creation, for housekeeping. */
  createdAt: number;
  /** Player IDs in roster order — first 5 are the starting lineup. */
  playerIds: string[];
  /** Saved Tactics (sparse — only set fields override DEFAULT_TACTICS). */
  tactics: Partial<Tactics>;
  /** Profile customisation — bio, brand colour, socials. */
  bio?: string;
  primaryColor?: string;
  twitchUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
}

// ============ Phase 8: achievements + loans ============

export interface Achievement {
  teamId: string;
  /** Kind id from the ACHIEVEMENT_KINDS table. */
  kind: string;
  /** Optional numeric payload (e.g. 10 wins, $50k earned). */
  value?: number;
  achievedAt: number;
  /** Human-readable label — server populates on push, clients store. */
  label?: string;
}

export interface TeamProfileFields {
  bio?: string;
  primaryColor?: string;
  twitchUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
}

// ============ Daily bonus + case opening ============

/** Fixed daily login bonus credited to the team's money on claim. */
export const DAILY_BONUS_AMOUNT = 10_000;

// ============ Booster packs (gacha) ============

/** Card rarities — drives drop odds + per-rarity colour. Attribute deltas
 *  and duel counts now live on individual card templates, not the rarity. */
export type BoostRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Attribute keys a card can target. Subset of PlayerAttributes — keeps the
 *  card UI focused on stats players actually look at. */
export type BoostAttrKey = keyof PlayerAttributes;

export interface BoostCard {
  /** Unique instance id (one per pull). */
  id: string;
  /** Template id from BOOST_CARD_LIBRARY — e.g. 'coffee-buzz', 'awper-eye'. */
  templateId: string;
  rarity: BoostRarity;
  name: string;
  /** Which attributes the bonus applies to. */
  attrTargets: BoostAttrKey[];
  /** Bonus added to each targeted attr (caps at 25 in engine). */
  attrBonus: number;
  /** Ranked duels the card lasts once applied. Scrims don't tick. */
  duels: number;
  /** Short flavour blurb shown on the card tile + reveal modal. */
  flavor: string;
  acquiredAt: number;
}

/** Drop odds by rarity (must sum to 1). Inside a rarity, templates are
 *  picked uniformly. Tuned so most pulls feel meaningful but legendary
 *  stays a real moment. */
export const BOOST_PACK_ODDS: Record<BoostRarity, number> = {
  common: 0.70,
  rare: 0.20,
  epic: 0.09,
  legendary: 0.01,
};

/** Per-rarity display metadata. Card-specific stats live in the library. */
export const BOOST_RARITY_META: Record<BoostRarity, { label: string; color: string }> = {
  common: { label: 'Common', color: '#9aa0aa' },
  rare: { label: 'Rare', color: '#4b69ff' },
  epic: { label: 'Epic', color: '#d32ce6' },
  legendary: { label: 'Legendary', color: '#ffd700' },
};

/** Cost in $ to open one pack. One card per pack. */
export const BOOST_PACK_COST = 5_000;

export interface BoostCardTemplate {
  id: string;
  name: string;
  rarity: BoostRarity;
  attrTargets: BoostAttrKey[];
  attrBonus: number;
  duels: number;
  flavor: string;
}

/** All cards that can drop from a pack. Roll = pick rarity by odds, then
 *  pick a template uniformly within that rarity. */
export const BOOST_CARD_LIBRARY: BoostCardTemplate[] = [
  // ----- Common (70% combined) -----
  { id: 'coffee-buzz', name: 'Coffee Buzz', rarity: 'common', attrTargets: ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'], attrBonus: 1, duels: 1, flavor: 'A solid jolt. Carries the whole kit, just barely.' },
  { id: 'quick-sip', name: 'Quick Sip', rarity: 'common', attrTargets: ['aim', 'reflexes'], attrBonus: 2, duels: 1, flavor: 'Sharper first shots. Nothing else moved.' },
  { id: 'light-stretch', name: 'Light Stretch', rarity: 'common', attrTargets: ['positioning', 'endurance'], attrBonus: 2, duels: 1, flavor: 'Loosened up. Reads the angle a touch better.' },
  { id: 'comms-tune', name: 'Comms Tune', rarity: 'common', attrTargets: ['communication', 'teamwork'], attrBonus: 2, duels: 1, flavor: 'Cleaner callouts. Trades land.' },

  // ----- Rare (20% combined) -----
  { id: 'adrenaline-rush', name: 'Adrenaline Rush', rarity: 'rare', attrTargets: ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'], attrBonus: 2, duels: 2, flavor: 'All-round edge for a couple of maps.' },
  { id: 'tactical-brief', name: 'Tactical Brief', rarity: 'rare', attrTargets: ['gameSense', 'leadership', 'communication'], attrBonus: 3, duels: 2, flavor: 'Coach pulled out the whiteboard. IGL is dialed in.' },
  { id: 'sharpshooter', name: 'Sharpshooter', rarity: 'rare', attrTargets: ['aim', 'reflexes'], attrBonus: 3, duels: 2, flavor: 'Heads pop. Refrags arrive on time.' },
  { id: 'marathon-runner', name: 'Marathon Runner', rarity: 'rare', attrTargets: ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'], attrBonus: 1, duels: 4, flavor: 'Small edge, but it lasts the whole event.' },

  // ----- Epic (9% combined) -----
  { id: 'in-the-zone', name: 'In The Zone', rarity: 'epic', attrTargets: ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'], attrBonus: 3, duels: 3, flavor: 'Everything clicks. Three maps of locked-in play.' },
  { id: 'aim-lock', name: 'Aim Lock', rarity: 'epic', attrTargets: ['aim', 'reflexes', 'positioning'], attrBonus: 5, duels: 2, flavor: 'Crosshair feels stitched to the head model.' },
  { id: 'clutch-master', name: 'Clutch Master', rarity: 'epic', attrTargets: ['clutch', 'composure', 'resilience'], attrBonus: 6, duels: 3, flavor: 'Built different in the 1vX. Doesn\'t flinch.' },
  { id: 'popflash-god', name: 'Pop-Flash God', rarity: 'epic', attrTargets: ['utility', 'teamwork'], attrBonus: 5, duels: 3, flavor: 'Every flash blinds. Every execute lands.' },

  // ----- Legendary (1% combined) -----
  { id: 'god-mode', name: 'God Mode', rarity: 'legendary', attrTargets: ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'], attrBonus: 5, duels: 3, flavor: 'Above their PA. Pure, transcendent. Three maps of cinema.' },
  { id: 'anchor', name: 'Anchor of the World', rarity: 'legendary', attrTargets: ['positioning', 'clutch', 'composure', 'discipline'], attrBonus: 8, duels: 3, flavor: 'Holds the site against the apocalypse. Three rounds of solo D.' },
  { id: 'awper-eye', name: 'AWPer\'s Eye', rarity: 'legendary', attrTargets: ['aim', 'reflexes'], attrBonus: 10, duels: 2, flavor: 'Sees through smokes. Wins every peek. Two maps.' },
  { id: 'game-changer', name: 'Game-Changer', rarity: 'legendary', attrTargets: ['aim', 'reflexes', 'positioning', 'gameSense', 'clutch'], attrBonus: 3, duels: 5, flavor: 'Solid edge across five duels. Run a tournament with it.' },
];

export interface ActiveBoostWire {
  rarity: BoostRarity;
  name: string;
  attrTargets: BoostAttrKey[];
  attrBonus: number;
  duelsLeft: number;
  appliedAt: number;
}

// ============ Morale mini-game (rock-paper-scissors team building) ============

export type RpsChoice = 'rock' | 'paper' | 'scissors';
export type RpsOutcome = 'win' | 'tie' | 'loss';

/** Free plays per in-game day. Cap = 5 (max +10 morale from perfect play). */
export const MORALE_GAME_PLAYS_PER_DAY = 5;
/** Morale delta applied to each of the 5 starters per outcome. */
export const MORALE_GAME_DELTAS: Record<RpsOutcome, number> = {
  win: 2,
  tie: 1,
  loss: 0, // generous — losses cost nothing so the game stays a real recovery tool
};

export interface MoraleGameResult {
  yourPick: RpsChoice;
  aiPick: RpsChoice;
  outcome: RpsOutcome;
  /** Morale change applied to each starter. */
  moraleDelta: number;
  /** Plays remaining this in-game day after this one. */
  playsLeft: number;
}

// ============ Massage center (gacha-style spa visit) ============

/** Cost per spa visit. Random class 1-10 masseuse, always reduces fatigue;
 *  morale swings ±depending on class. One visit per in-game day. */
export const MASSAGE_COST = 10_000;
/** Min real game-days that must pass between visits (1 = once per day). */
export const MASSAGE_COOLDOWN_GAME_DAYS = 1;

/** Class 1-10. Higher = nicer experience. */
export interface MassageMasseuse {
  /** Display name pulled from a per-class-tier pool. */
  name: string;
  /** 1-10. Drives the morale + fatigue formulas in massageEffects(). */
  rating: number;
  /** Single emoji used as a placeholder portrait. */
  emoji: string;
  /** Short flavour blurb the modal renders under the card. */
  flavor: string;
}

export interface MassageOutcome {
  masseuse: MassageMasseuse;
  /** Negative (always — even the worst class still gives some recovery). */
  fatigueDelta: number;
  /** Negative for class 1-5, positive for 6-10. */
  moraleDelta: number;
  /** Starter IDs the effects landed on. */
  affectedPlayerIds: string[];
}

/** Closed-form effects per class. Caller scales by … nothing (team-wide flat). */
export function massageEffects(rating: number): { fatigueDelta: number; moraleDelta: number } {
  const r = Math.max(1, Math.min(10, Math.round(rating)));
  // Fatigue: -10 at class 1 → -35 at class 10. Higher class = better recovery.
  const fatigueDelta = -(10 + Math.round((r - 1) * (25 / 9)));
  // Morale: -3 at class 1 → +3 at class 10, linear through zero around 5/6.
  const moraleDelta = Math.round(((r - 5.5) / 4.5) * 3);
  return { fatigueDelta, moraleDelta };
}

// ============ Player contract pacing ============

/** Initial duels remaining when a newgen is spawned for a newly created team. */
export const CONTRACT_DUELS_INITIAL_SPAWN = 60;
/** Initial duels for free-agent signs + mints (older players, shorter deal). */
export const CONTRACT_DUELS_INITIAL_FA = 40;
/** Initial duels for transfer-market buys (fresh contract on transfer). */
export const CONTRACT_DUELS_INITIAL_BUY = 30;
/** Duels added per renewal click. */
export const CONTRACT_RENEWAL_DUELS = 30;
/** Cost multiplier on top of monthly wage to renew. (4× wage = $40k for a $10k/mo player.) */
export const CONTRACT_RENEWAL_WAGE_MULT = 4;
/** Threshold at which the UI starts warning the user a contract is running out. */
export const CONTRACT_DUELS_WARN_AT = 8;

/** Base duel cap per in-game day (PvP + AI). One in-game day = 4 real
 *  hours, so this resets six times per real day. Scrims don't count. */
export const DAILY_DUEL_CAP = 15;
/** Cash cost per missing duel restored when the user clicks Refill.
 *  Full refill of 15 missing duels = 15 × cost. */
export const REFILL_COST_PER_DUEL = 1_500;
/** Minimum charge on any refill (so 0-used refills aren't free). */
export const MIN_REFILL_COST = 1_500;
/** How many times a team can refill within one in-game day.
 *  2 refills × 15 duels = 30 extra duels max (matches the old cap). */
export const MAX_REFILLS_PER_DAY = 2;

/** Slim case-card data sent to clients to render the case picker. The skin
 *  pool itself isn't sent — clients receive the opened skin in `case-opened`. */
export interface CaseSummary {
  id: string;
  name: string;
  keyPrice: number;
  /** Total skins in the pool (UI hint only). */
  skinCount: number;
  /** Optional accent colour from CaseDef. */
  accent?: string;
}

/** SkinInstance shape on the wire — matches src/types SkinInstance but
 *  redeclared here so the protocol stays self-contained. */
export interface SkinInstanceWire {
  id: string;
  skinId: string;
  weapon: string;
  name: string;
  rarity: 'mil-spec' | 'restricted' | 'classified' | 'covert' | 'rare-special';
  wear: 'Factory New' | 'Minimal Wear' | 'Field-Tested' | 'Well-Worn' | 'Battle-Scarred';
  marketValue: number;
  statTrak: boolean;
  acquiredOn: string;
  caseId: string;
  souvenir?: boolean;
}

/** One tile on the case-opening animation reel — slim render-only payload. */
export interface SkinStripEntry {
  weapon: string;
  name: string;
  rarity: SkinInstanceWire['rarity'];
}

// ============ Admin operations ============

/** Slim view of an owner row for the admin user-list screen. */
export interface AdminUserRow {
  nickname: string;
  teamId: string | null;
  teamTag: string | null;
  teamName: string | null;
  region: Region | null;
  money: number | null;
  rosterSize: number;
  createdAt: number;
}

/** Fields the admin can rewrite on any team. Mirrors create-team plus name. */
export interface AdminTeamEditFields {
  name?: string;
  tag?: string;
  region?: Region;
}

// ============ Phase 9: HoF + coaches + sponsors ============

export interface HoFEntry {
  playerId: string;
  nickname: string;
  role: string;
  nationality: string;
  lastAge: number;
  peakCA: number;
  careerWins: number;
  careerLosses: number;
  lastTeamId?: string;
  lastTeamTag?: string;
  retiredAt: number;
}

export interface CoachListing {
  id: string;
  name: string;
  nationality: string;
  skill: number; // 1-20, drives training tick boost
  monthlyWage: number;
  hiredByTeamId?: string;
  hiredAt?: number;
}

export interface SponsorOffer {
  id: string;
  teamId: string;
  sponsorName: string;
  monthlyAmount: number;
  status: 'pending' | 'active' | 'declined';
  offeredAt: number;
  lastPaidAt?: number;
}

export type LoanStatus = 'pending' | 'active' | 'returned' | 'declined';

export interface LoanOffer {
  id: string;
  fromTeamId: string;
  fromTeamTag: string;
  toTeamId: string;
  toTeamTag: string;
  playerId: string;
  playerNickname: string;
  fee: number;
  days: number;
  offeredAt: number;
  /** Set once accepted — when this date passes, auto-return fires on tick. */
  endsAt?: number;
  status: LoanStatus;
}

// ============ Public market listing ============

/** A player offered for sale by some team. Sticks around until bought,
 *  unlisted, or the seller deletes their team. */
export interface MarketListing {
  id: string;
  playerId: string;
  sellerTeamId: string;
  sellerTeamTag: string;
  /** Asking price in USD — instant buy at this number. */
  askingPrice: number;
  listedAt: number;
}

// ============ PvP challenges (Phase 3) ============

/** A team's open invitation for any other team to duel. Resolves into a
 *  match the moment another team accepts. */
export interface PvpChallenge {
  id: string;
  challengerTeamId: string;
  challengerTag: string;
  challengerNick: string;
  stake: number;
  format: MatchFormat;
  /** Optional smack-talk shown in the lobby. */
  message?: string;
  createdAt: number;
}

// ============ Persistent match history (Phase 3) ============

// ============ Phase 5: chat + tournaments ============

export interface ChatMessage {
  id: number;
  /** Channel this message belongs to. 'global' is the default firehose;
   *  per-tournament channels use `tourn:<id>` so registered teams can
   *  trash-talk a specific bracket without spamming the whole server. */
  channel: string;
  from: string; // owner nickname
  teamTag?: string;
  text: string;
  at: number;
}

export type TournamentStatus = 'open' | 'in-progress' | 'finished';

/** Compact tournament summary for the lobby list. */
export interface TournamentSummary {
  id: string;
  name: string;
  size: 4 | 8;
  entryFee: number;
  prizePool: number;
  registered: number;
  status: TournamentStatus;
  createdAt: number;
  /** True iff the requesting team is already registered. */
  iAmIn: boolean;
}

/** One match slot in a single-elim bracket. */
export interface BracketMatch {
  /** 0-indexed round (0 = first round). */
  round: number;
  /** Position within the round. */
  slot: number;
  teamAId: string | null;
  teamBId: string | null;
  teamATag?: string;
  teamBTag?: string;
  /** Set after the match resolves. */
  winnerId?: string;
  mapsA?: number;
  mapsB?: number;
  /** Match-history id — clients can fetch the stripped result for review. */
  matchHistoryId?: string;
}

export interface TournamentDetail extends TournamentSummary {
  bracket: BracketMatch[];
  /** Final placements once finished — 1st, 2nd, semis. */
  prizes?: { teamId: string; teamTag: string; placement: number; cash: number }[];
}

/** One entry in the live match feed — broadcast to all sockets when any duel
 *  resolves, regardless of whether the receiver was involved. Replays remain
 *  watchable for ~5 minutes after `at`. */
export interface LiveFeedEntry {
  matchId: string;
  kind: 'ai' | 'pvp' | 'tournament';
  teamATag: string;
  teamBTag: string;
  mapsA: number;
  mapsB: number;
  /** Optional context label (e.g. "Daily Open · Quarterfinal"). */
  context?: string;
  at: number;
}

// ============ Season + leaderboard (Phase 4) ============

export interface SeasonInfo {
  seasonNo: number;
  startedAt: number;
  endsAt: number;
  prizePool: number;
}

export interface LeaderboardRow {
  rank: number;
  teamId: string;
  teamTag: string;
  teamName: string;
  wins: number;
  losses: number;
  netMoney: number;
  /** Positive = win streak (e.g. +3); negative = losing streak (e.g. -2). */
  streak: number;
}

export interface MyStandings {
  wins: number;
  losses: number;
  netMoney: number;
  streak: number;
}

/** Per-player change captured during a time-skip, used for the dev-arc
 *  growth report toast. Only players who actually moved are reported. */
export interface DevChange {
  playerId: string;
  nickname: string;
  caBefore: number;
  caAfter: number;
}

// ============ Phase 7: presets, news, directory ============

export interface TacticsPreset {
  id: string;
  ownerNick: string;
  name: string;
  tactics: Partial<Tactics>;
  createdAt: number;
}

export interface NewsItem {
  id: number;
  kind: string;
  body: string;
  at: number;
}

/** Compact entry for the team directory — used by the DM picker so users
 *  can find another team to message without typing a UUID. */
export interface TeamDirectoryEntry {
  id: string;
  tag: string;
  name: string;
  ownerNick: string;
  region: string;
}

/** Manager-set development goal for one of their players. */
export interface PlayerGoal {
  playerId: string;
  /** PlayerAttributes key the player is grinding (e.g. 'aim', 'utility'). */
  attr: string;
  /** Target value to hit (1-20). */
  target: number;
  setAt: number;
  /** When the player hit the target. Undefined while still open. */
  reachedAt?: number;
}

/** Stripped summary of a resolved duel — frames, kills, commentary are
 *  trimmed before persistence. Used by the History panel. The full
 *  replayable MatchResult is only fetched on demand via fetch-match. */
export interface MatchHistoryEntry {
  id: string;
  teamAId: string;
  teamBId: string | null; // null when opponent was an AI
  teamATag: string;
  teamBTag: string;
  winnerId: string;
  mapsA: number;
  mapsB: number;
  stake: number;
  kind: 'ai' | 'pvp';
  playedAt: number;
}

// ============ Duel + result ============

/** Outcome of a single duel. Sent back to the initiating client. */
export interface DuelOutcome {
  /** Full match result including frames so the client can show a replay /
   *  scoreboard. Frames are stripped before persistence. */
  result: MatchResult;
  /** Opponent label for the result screen — synthetic AI team OR live team tag. */
  opponentName: string;
  opponentTag: string;
  /** +stake on win, −stake on loss. */
  moneyDelta: number;
  newMoney: number;
  /** Plain-English flavour line for the inbox / toast. */
  summary: string;
  /** Player IDs the USER'S team fielded for this duel, snapshotted BEFORE
   *  the contract tick. Without this, the result modal can't tell who was
   *  on our side once expired players have been removed from team.playerIds. */
  userLineupIds: string[];
  /** Optional post-match analysis the client renders to help the user
   *  understand WHY they won/lost. Avg CA delta = baseline strength gap;
   *  fatigue/form/morale snapshots capture condition-induced losses. */
  diagnostics?: DuelDiagnostics;
}

export interface DuelDiagnostics {
  /** Average current ability of the user's starting 5 (pre-boost). */
  userAvgCA: number;
  /** Average CA of the opponent's starting 5. */
  oppAvgCA: number;
  /** User-side mean form (1-20). Anything < 8 hurts. */
  userAvgForm: number;
  /** User-side mean morale (1-20). 12 is neutral. */
  userAvgMorale: number;
  /** User-side mean fatigue (0-100). >50 is a real drag. */
  userAvgFatigue: number;
  /** Plain-language warnings about condition issues. Empty = nothing flagged. */
  warnings: string[];
}

// ============ Client → Server messages ============

export type ClientMessage =
  | { kind: 'hello'; nickname: string; pin: string }
  | { kind: 'create-team'; name: string; tag: string; region: Region }
  | { kind: 'spawn-initial-players'; roles?: PlayerRole[] } // first-time roster bootstrap
  | { kind: 'refresh-state' }
  | { kind: 'ping' }
  // ----- Phase 2: the actual game loop -----
  | { kind: 'register-ai-duel'; stake: number; format: MatchFormat }
  | { kind: 'time-skip'; days: number }
  | { kind: 'list-market' }
  | { kind: 'list-player'; playerId: string; askingPrice: number }
  | { kind: 'unlist-player'; listingId: string }
  | { kind: 'buy-listed-player'; listingId: string }
  // ----- Phase 3: PvP + FA + history -----
  | { kind: 'post-challenge'; stake: number; format: MatchFormat; message?: string }
  | { kind: 'cancel-challenge'; challengeId: string }
  | { kind: 'list-challenges' }
  | { kind: 'accept-challenge'; challengeId: string }
  | { kind: 'list-free-agents' }
  | { kind: 'sign-free-agent'; playerId: string; wage: number }
  | { kind: 'list-history' }
  | { kind: 'fetch-match'; matchId: string }
  // ----- Phase 4: tactics, lineup, seasons -----
  | { kind: 'set-tactics'; tactics: Partial<Tactics> }
  | { kind: 'reorder-lineup'; playerIds: string[] } // first 5 = starters
  | { kind: 'list-leaderboard' }
  // ----- Phase 5: live replay, chat, tournaments -----
  | { kind: 'fetch-live-replay'; matchId: string }
  | { kind: 'send-chat'; text: string; channel?: string }
  | { kind: 'fetch-chat-history'; channel?: string }
  | { kind: 'list-tournaments' }
  | { kind: 'register-tournament'; tournamentId: string }
  | { kind: 'fetch-tournament-detail'; tournamentId: string }
  | { kind: 'create-tournament'; size: 4 | 8; entryFee: number }
  // ----- Phase 6: goals + team logos -----
  | { kind: 'set-player-goal'; playerId: string; attr: string; target: number }
  | { kind: 'clear-player-goal'; playerId: string; attr: string }
  | { kind: 'list-player-goals' }
  // ----- Phase 7: presets, news, DM, export/import -----
  | { kind: 'save-tactics-preset'; name: string }
  | { kind: 'list-tactics-presets' }
  | { kind: 'apply-tactics-preset'; presetId: string }
  | { kind: 'delete-tactics-preset'; presetId: string }
  | { kind: 'fetch-news' }
  | { kind: 'list-online-teams' }
  | { kind: 'export-team' }
  | { kind: 'import-team'; payload: string }
  // ----- Phase 8: achievements, profile, loans, themed events -----
  | { kind: 'list-achievements' }
  | { kind: 'update-profile'; fields: TeamProfileFields }
  | { kind: 'offer-loan'; toTeamId: string; playerId: string; fee: number; days: number }
  | { kind: 'list-loan-offers' }
  | { kind: 'accept-loan'; loanId: string }
  | { kind: 'decline-loan'; loanId: string }
  | { kind: 'recall-loan'; loanId: string }
  // ----- Phase 9: HoF + coaches + sponsors -----
  | { kind: 'list-hof' }
  | { kind: 'list-coaches' }
  | { kind: 'hire-coach'; coachId: string }
  | { kind: 'fire-coach' }
  | { kind: 'list-sponsors' }
  | { kind: 'respond-sponsor'; sponsorId: string; accept: boolean }
  // ----- Mint: scout a fresh wonderkid into the FA pool -----
  | { kind: 'mint-free-agent'; tier: MintTier }
  // ----- Daily login bonus -----
  | { kind: 'claim-daily-bonus' }
  // ----- Duel cap: refill ALL missing duels for today (capped per day) -----
  | { kind: 'refill-duels' }
  // ----- Massage center: book a random-class spa session for the starters -----
  | { kind: 'book-massage' }
  // ----- Morale mini-game: play one round of rock-paper-scissors -----
  | { kind: 'play-morale-game'; choice: RpsChoice }
  // ----- Contract renewal: extend a starter's duels-remaining -----
  | { kind: 'renew-contract'; playerId: string }
  // ----- Case opening (skins → team.money on resale) -----
  | { kind: 'list-cases' }
  | { kind: 'open-case'; caseId: string }
  | { kind: 'open-free-case' }
  | { kind: 'list-skins' }
  | { kind: 'sell-skin'; skinId: string }
  // ----- Booster packs (gacha) -----
  | { kind: 'list-boosts' }
  | { kind: 'buy-boost-pack' }
  | { kind: 'apply-boost'; cardId: string; playerId: string }
  | { kind: 'discard-boost'; cardId: string }
  // ----- Admin (gated server-side by CSM_ADMIN_NICK env var) -----
  | { kind: 'admin-list-users' }
  | { kind: 'admin-reset-pin'; nickname: string; newPin: string }
  | { kind: 'admin-edit-team'; teamId: string; fields: AdminTeamEditFields }
  | { kind: 'admin-adjust-money'; teamId: string; delta: number; note?: string }
  | { kind: 'admin-delete-team'; teamId: string };

// ============ Server → Client messages ============

export type ServerMessage =
  | { kind: 'hello-ok'; sessionToken: string; hasTeam: boolean; isAdmin: boolean }
  | { kind: 'hello-bad-pin' }
  | { kind: 'state'; team: OnlineTeam; players: Player[]; dailyBonusAvailable: boolean; freeCaseAvailable: boolean; duelsUsed: number; duelsRefillsUsed: number; moraleGamePlaysUsed: number; nextTickUtcMs: number }
  | { kind: 'team-created'; team: OnlineTeam }
  | { kind: 'players-spawned'; players: Player[] }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'pong' }
  // ----- Phase 2 -----
  | { kind: 'duel-result'; outcome: DuelOutcome }
  | { kind: 'time-skipped'; newDay: number; daysAdvanced: number; trainingNotes: string[]; cost: number; devChanges: DevChange[] }
  | { kind: 'market'; listings: MarketListing[]; players: Player[] }
  | { kind: 'market-listed'; listing: MarketListing }
  | { kind: 'market-unlisted'; listingId: string }
  | { kind: 'market-bought'; listingId: string; player: Player; cost: number }
  // ----- Phase 3 -----
  | { kind: 'challenges'; open: PvpChallenge[]; mine: PvpChallenge[] }
  | { kind: 'challenge-posted'; challenge: PvpChallenge }
  | { kind: 'challenge-cancelled'; challengeId: string }
  | { kind: 'free-agents'; players: Player[]; suggestedWageById: Record<string, number> }
  | { kind: 'free-agent-signed'; player: Player; wage: number }
  | { kind: 'history'; matches: MatchHistoryEntry[] }
  | { kind: 'match-detail'; matchId: string; result: MatchResult }
  // ----- Phase 4 -----
  | { kind: 'tactics-saved'; tactics: Partial<Tactics> }
  | { kind: 'lineup-saved'; playerIds: string[] }
  | { kind: 'leaderboard'; season: SeasonInfo; rows: LeaderboardRow[]; me: MyStandings }
  // ----- Phase 5 -----
  | { kind: 'live-replay'; matchId: string; result: MatchResult }
  | { kind: 'live-replay-expired'; matchId: string }
  | { kind: 'chat-history'; messages: ChatMessage[] }
  | { kind: 'chat-message'; message: ChatMessage }
  | { kind: 'tournaments'; list: TournamentSummary[] }
  | { kind: 'tournament-detail'; tournament: TournamentDetail }
  | { kind: 'tournament-update'; tournament: TournamentDetail }
  /** Broadcast to every connected socket whenever a duel (AI or PvP) just
   *  resolved. Surfaces in the live feed widget — anyone can hit "Watch"
   *  to pull the cached replay (within the 5-min TTL). */
  | { kind: 'live-match-feed'; entry: LiveFeedEntry }
  // ----- Phase 6 -----
  | { kind: 'player-goals'; goals: PlayerGoal[] }
  | { kind: 'goal-reached'; playerId: string; nickname: string; attr: string; target: number }
  // ----- Phase 7 -----
  | { kind: 'tactics-presets'; presets: TacticsPreset[] }
  | { kind: 'news-history'; items: NewsItem[] }
  | { kind: 'news-item'; item: NewsItem }
  | { kind: 'online-teams'; teams: TeamDirectoryEntry[] }
  | { kind: 'team-export'; payload: string }
  | { kind: 'team-imported'; team: OnlineTeam }
  // ----- Phase 8 -----
  | { kind: 'achievements'; entries: Achievement[] }
  | { kind: 'achievement-unlocked'; achievement: Achievement }
  | { kind: 'profile-updated'; team: OnlineTeam }
  | { kind: 'loan-offers'; incoming: LoanOffer[]; outgoing: LoanOffer[] }
  | { kind: 'loan-event'; loan: LoanOffer }
  // ----- Phase 9 -----
  | { kind: 'presence'; onlineTeams: number }
  | { kind: 'hof'; entries: HoFEntry[] }
  | { kind: 'player-retired'; playerId: string; nickname: string; lastAge: number }
  | { kind: 'coach-pool'; openCoaches: CoachListing[]; myCoach: CoachListing | null }
  | { kind: 'coach-hired'; coach: CoachListing }
  | { kind: 'sponsors'; offers: SponsorOffer[]; paid: { sponsorId: string; amount: number }[] }
  | { kind: 'free-agent-minted'; player: Player; cost: number; tier: MintTier }
  // ----- Daily bonus + cases -----
  | { kind: 'daily-bonus-claimed'; amount: number; newMoney: number; nextClaimUtc: string }
  | { kind: 'duel-stats'; used: number; refillsUsed: number; cap: number; remaining: number }
  | { kind: 'duels-refilled'; cost: number; newMoney: number; refillsUsed: number; refillsLeft: number }
  | { kind: 'contract-renewed'; playerId: string; cost: number; newMoney: number; duelsRemaining: number }
  | { kind: 'player-expired'; playerId: string; nickname: string }
  | { kind: 'massage-booked'; outcome: MassageOutcome; cost: number; newMoney: number; nextEligibleGameDay: number }
  | { kind: 'morale-game-result'; result: MoraleGameResult }
  | { kind: 'case-list'; cases: CaseSummary[]; freeCaseId: string; freeCaseAvailable: boolean }
  | { kind: 'case-opened'; instance: SkinInstanceWire; caseId: string; cost: number; newMoney: number; freeCase?: boolean; strip: SkinStripEntry[]; winnerIndex: number }
  | { kind: 'skin-inventory'; skins: SkinInstanceWire[] }
  | { kind: 'skin-sold'; skinId: string; payout: number; newMoney: number }
  // ----- Booster packs -----
  | { kind: 'boost-inventory'; cards: BoostCard[]; activeByPlayer: Record<string, ActiveBoostWire> }
  | { kind: 'boost-pack-opened'; card: BoostCard; cost: number; newMoney: number }
  | { kind: 'boost-applied'; cardId: string; playerId: string; active: ActiveBoostWire }
  | { kind: 'boost-discarded'; cardId: string }
  | { kind: 'boost-expired'; playerId: string }
  // ----- Admin -----
  | { kind: 'admin-users'; rows: AdminUserRow[] }
  | { kind: 'admin-pin-reset'; nickname: string; newPin: string }
  | { kind: 'admin-team-edited'; teamId: string }
  | { kind: 'admin-team-deleted'; teamId: string }
  // Pushed by the server to the AFFECTED team when admin touched their data.
  | { kind: 'team-money-updated'; teamId: string; money: number }
  | { kind: 'team-deleted-by-admin'; teamId: string };

// ============ Constants the client/server both reference ============

/** Starting cash awarded to every freshly created team. */
export const STARTING_MONEY = 100_000;
/** Number of newgen players auto-spawned on first roster bootstrap. */
export const INITIAL_ROSTER_SIZE = 5;
/** Wire-protocol version — bump when message shapes change in a breaking way. */
export const PROTOCOL_VERSION = 22;

/** Length of one in-game day in real-world ms. The wall-clock auto-tick
 *  advances every team's day by 1 at each multiple of this duration past
 *  the UTC epoch — i.e. at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC. */
export const AUTO_TICK_MS = 4 * 3600 * 1000;
/** Age past which players have a non-zero chance to retire each time-skip week. */
export const RETIREMENT_AGE_THRESHOLD = 32;
/** Sponsor payment cadence — auto-credit once per 30 real days while active. */
export const SPONSOR_PAYMENT_INTERVAL_MS = 30 * 24 * 3600 * 1000;

// ============ Mint tiers (pay-to-scout a fresh wonderkid) ============

/** Tiers the user can mint into the free-agent pool. */
export type MintTier = 'standard' | 'premium' | 'elite';

/** Per-tier metadata — cost + label + flavour line + engine inputs. */
export const MINT_TIERS: Record<MintTier, {
  label: string;
  cost: number;
  baseTier: 1 | 2 | 3 | 4 | 5; // passed to dbBuild
  ageRange: [number, number];
  paBonusRange: [number, number];
  hint: string;
}> = {
  standard: {
    label: 'Standard Scout',
    cost: 2_500,
    baseTier: 4,
    ageRange: [18, 22],
    paBonusRange: [10, 25],
    hint: 'A regional talent — solid attributes, modest ceiling.',
  },
  premium: {
    label: 'Premium Scout',
    cost: 10_000,
    baseTier: 3,
    ageRange: [16, 19],
    paBonusRange: [25, 45],
    hint: 'A real wonderkid — high PA, takes a season to develop.',
  },
  elite: {
    label: 'Elite Scout',
    cost: 35_000,
    baseTier: 2,
    ageRange: [16, 18],
    paBonusRange: [40, 65],
    hint: 'The next superstar. PA cap pushes 190+. Worth the price tag.',
  },
};
/** Hard cap on per-team loan offer duration. */
export const MAX_LOAN_DAYS = 21;
/** Penalty multiplier when the lender recalls an ACTIVE loan early — the
 *  lender pays the borrower fee × (1 + this) to break the agreement.
 *  0.5 → fee × 1.5 (50% on top of the original fee). */
export const LOAN_RECALL_PENALTY_MULT = 0.5;
/** Achievement kinds with human-readable labels. Server passes the label
 *  in the unlock event so the client can show the toast without a lookup. */
export const ACHIEVEMENT_LABELS: Record<string, string> = {
  first_blood: '🩸 First Blood — won your first duel',
  ten_wins: '🔟 Veteran — 10 career duel wins',
  fifty_wins: '5️⃣0️⃣ Dynasty — 50 career duel wins',
  first_tournament: '🏆 Trophy Cabinet — won your first tournament',
  first_fa_sign: '💼 Player Agent — signed your first free agent',
  first_market_sale: '💰 Trader — closed your first market sale',
  first_goal_reached: '🎯 Coach — first development goal hit',
  bankroll_100k: '💵 First $100k Profit — net duel earnings crossed $100,000',
  underdog_win: '😱 Cinderella — beat a team with a higher avg CA in a PvP',
};
/** Cap on saved tactics presets per owner. */
export const MAX_TACTICS_PRESETS = 10;
/** Channel-string prefix that marks a private team-to-team DM. */
export const DM_CHANNEL_PREFIX = 'dm:';
/** Build the canonical DM channel string between two team IDs — sorted so
 *  both sides resolve to the same channel regardless of who initiated. */
export function dmChannelFor(teamA: string, teamB: string): string {
  return DM_CHANNEL_PREFIX + [teamA, teamB].sort().join(':');
}
/** True iff `channel` is a DM and the supplied teamId is one of the parties. */
export function isDmParticipant(channel: string, teamId: string): boolean {
  if (!channel.startsWith(DM_CHANNEL_PREFIX)) return false;
  const ids = channel.slice(DM_CHANNEL_PREFIX.length).split(':');
  return ids.includes(teamId);
}
/** Live replays stay in server memory for this long after the duel ends.
 *  After that, only the stripped match (no frames) is available via fetch-match. */
export const LIVE_REPLAY_TTL_MS = 5 * 60 * 1000;
/** Cap on chat history kept server-side. */
export const CHAT_HISTORY_CAP = 100;
/** Max simultaneously-open development goals per team. */
export const MAX_OPEN_GOALS = 5;
/** Tournament prize-pool split by placement (4-team uses first 3 entries). */
export const TOURNAMENT_PRIZE_SPLIT = [0.6, 0.25, 0.075, 0.075];
/** Default size of the free-agent pool shown in the market. Server refills
 *  the underlying pool on demand. */
export const FREE_AGENT_POOL_SIZE = 60;
/** Scrim mode entry point — duels at stake = 0 cost nothing, pay nothing,
 *  don't touch the leaderboard, and apply a lighter aftermath
 *  (form/fatigue/morale half-weight). */
export const SCRIM_STAKE = 0;
/** Duel stake bounds — keeps a fresh team from blowing its bankroll in one go. */
export const MIN_DUEL_STAKE = 1_000;
export const MAX_DUEL_STAKE = 50_000;
/** Cost per simulated day in time-skip ($/day). Pays for facility hire,
 *  scrim partners, and coaching hours during the fast-forward. */
export const TIME_SKIP_COST_PER_DAY = 500;
/** Hard cap on a single time-skip — keeps the request bounded so the server
 *  isn't iterating thousands of days in one go. */
export const MAX_TIME_SKIP_DAYS = 30;

// ============ Small client-side helpers ============

/** Type-narrow guard for a parsed inbound message. Throws on shape mismatch. */
export function isServerMessage(v: unknown): v is ServerMessage {
  return !!v && typeof v === 'object' && 'kind' in (v as Record<string, unknown>);
}

export function isClientMessage(v: unknown): v is ClientMessage {
  return !!v && typeof v === 'object' && 'kind' in (v as Record<string, unknown>);
}
