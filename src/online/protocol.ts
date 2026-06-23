// Wire protocol shared between the multiplayer server and the React client.
// JSON-over-WebSocket, one message per frame. Both sides import this file
// directly (server's tsconfig.json adds it to its include list) so the type
// system catches mismatched payloads at compile time.

import type { MatchFormat, MatchResult, Player, PlayerRole, Region, Tactics } from '../types';

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
  // ----- Case opening (skins → team.money on resale) -----
  | { kind: 'list-cases' }
  | { kind: 'open-case'; caseId: string }
  | { kind: 'open-free-case' }
  | { kind: 'list-skins' }
  | { kind: 'sell-skin'; skinId: string }
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
  | { kind: 'state'; team: OnlineTeam; players: Player[]; dailyBonusAvailable: boolean; freeCaseAvailable: boolean }
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
  | { kind: 'case-list'; cases: CaseSummary[]; freeCaseId: string; freeCaseAvailable: boolean }
  | { kind: 'case-opened'; instance: SkinInstanceWire; caseId: string; cost: number; newMoney: number; freeCase?: boolean; strip: SkinStripEntry[]; winnerIndex: number }
  | { kind: 'skin-inventory'; skins: SkinInstanceWire[] }
  | { kind: 'skin-sold'; skinId: string; payout: number; newMoney: number }
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
export const PROTOCOL_VERSION = 12;
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
