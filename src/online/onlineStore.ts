// Zustand store for the online (multiplayer) mode. Mirrors authoritative
// server state — never mutates locally, only after a server reply. Lives
// completely separate from the career-mode `useGame` store.

import { create } from 'zustand';
import type { MatchFormat, MatchResult, Player, Tactics } from '../types';
import type {
  Achievement,
  ChatMessage,
  CoachListing,
  DevChange,
  DuelOutcome,
  HoFEntry,
  LeaderboardRow,
  MyPvpStandings,
  PublicTeamProfile,
  PvpLeaderRow,
  QuestSnapshot,
  RankedLeaderRow,
  LiveFeedEntry,
  LoanOffer,
  ActiveBoostWire,
  AdminTeamEditFields,
  AdminUserRow,
  BoostCard,
  CaseSummary,
  CrashResult,
  DragonGateResult,
  MinesResult,
  StreamResult,
  MassageOutcome,
  MoraleGameResult,
  RpsChoice,
  ScoutRarity,
  MarketListing,
  MatchHistoryEntry,
  MyStandings,
  NewsItem,
  SkinInstanceWire,
  SkinListingWire,
  SkinStripEntry,
  OnlineTeam,
  PlayerGoal,
  PvpChallenge,
  SeasonInfo,
  ServerMessage,
  SponsorOffer,
  TacticsPreset,
  TeamDirectoryEntry,
  TeamProfileFields,
  TournamentDetail,
  TournamentSummary,
  AiMatchCardWire,
  AiBetTeamProfile,
  AiBetHistoryEntry,
  ApartmentTier,
  LotAuctionWire,
  LotDetailWire,
  LotLeaderboardEntry,
  LotMapPin,
} from './protocol';
import type { ConnectionStatus, OnlineClient } from './wsClient';
import { connect } from './wsClient';

export type OnlineScreen = 'connect' | 'create-team' | 'home' | 'squad' | 'market' | 'challenges' | 'history' | 'viewer' | 'tactics' | 'leaderboard' | 'tournaments' | 'replay' | 'admin' | 'cases' | 'boosters' | 'massage' | 'mini-games' | 'scout' | 'streaming' | 'ai-bets' | 'real-estate';

/** One-shot toast banner, used for time-skip + market success messages. */
export interface OnlineToast {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

interface OnlineState {
  // ----- connection -----
  client: OnlineClient | null;
  status: ConnectionStatus;
  serverUrl: string;
  nickname: string;
  sessionToken: string | null;
  /** True when the connected nickname matches the server's CSM_ADMIN_NICK env. */
  isAdmin: boolean;
  /** Admin-only: cached user list from admin-list-users. */
  adminUsers: AdminUserRow[];

  // ----- game state mirror -----
  team: OnlineTeam | null;
  players: Record<string, Player>;

  // ----- match state -----
  /** Latest duel outcome — shown as an overlay on the home screen until dismissed. */
  duelResult: DuelOutcome | null;
  /** True while a duel request is in flight (server is simulating). */
  duelPending: boolean;
  /** PvP duel outcome waiting for the synced replay to finish playing.
   *  While this is non-null the user is parked on the replay viewer in
   *  locked mode (no scrub controls, forced 4× speed). When the replay
   *  hits its final frame the viewer drains this into duelResult so the
   *  result modal pops at the same moment both teams see the last frame. */
  pendingDuelResult: DuelOutcome | null;
  /** True while a time-skip request is in flight. */
  skipPending: boolean;

  // ----- market state -----
  marketListings: MarketListing[];
  /** Player objects keyed by id — populated alongside listings so the
   *  market screen can render attrs without a second roundtrip. */
  marketPlayers: Record<string, Player>;
  /** Free-agent pool snapshot (refreshed via refreshFreeAgents). */
  freeAgents: Player[];
  /** Suggested wage for each free agent — keyed by player id. */
  freeAgentWages: Record<string, number>;

  // ----- challenges + history (Phase 3) -----
  openChallenges: PvpChallenge[];
  myChallenges: PvpChallenge[];
  history: MatchHistoryEntry[];
  /** The match currently being viewed in the replay screen — null when not viewing. */
  viewing: { matchId: string; result: MatchResult; teamATag: string; teamBTag: string } | null;

  // ----- leaderboard (Phase 4) -----
  leaderboardSeason: SeasonInfo | null;
  leaderboardRows: LeaderboardRow[];
  myStandings: MyStandings | null;
  /** PvP-only leaderboard (derived from match_history, AI excluded). */
  pvpLeaderRows: PvpLeaderRow[];
  myPvpStandings: MyPvpStandings | null;
  /** MMR-sorted ranked ladder — top 100 teams by competitive MMR. */
  rankedLeaderRows: RankedLeaderRow[];
  /** Pop-up team profile (any team — your own or an enemy's). Set by
   *  clicking a team tag anywhere in the app; cleared on dismiss. */
  viewingTeamProfile: PublicTeamProfile | null;
  /** True while a fetch-team-profile is in flight (so the click target
   *  can disable / show a spinner). */
  teamProfileLoading: string | null;
  /** Pop-up player profile. Holds the playerId; the modal reads the
   *  player record from `players` (own) or `viewingTeamProfile` (enemy). */
  viewingPlayerId: string | null;
  /** Today's daily-quest snapshot (3 quests + streak + all-done bonus
   *  state). Refreshed on every claim + on a list-quests roundtrip. */
  questSnapshot: QuestSnapshot | null;

  // ----- Phase 5: live replay, chat, tournaments, dev arcs -----
  /** Most recent dev-arc payload (used to drive the growth-report modal). */
  lastDevChanges: DevChange[];
  showDevReport: boolean;
  /** Latest live-replay frames cached server-side — null if expired. */
  liveReplay: { matchId: string; result: import('../types').MatchResult; teamATag: string; teamBTag: string; /** Spectator-mode anchor: explicit team A roster ids when neither team is the viewer's own (e.g. AI bet replays). */ teamARosterIds?: string[] } | null;
  /** Chat history (whole-server snapshot — clients filter per channel). */
  chatHistory: ChatMessage[];
  chatOpen: boolean;
  /** Channel the chat widget is currently viewing. Defaults to 'global'. */
  chatChannel: string;
  /** Tournament lobby + the one we're currently focused on. */
  tournaments: TournamentSummary[];
  activeTournament: TournamentDetail | null;
  /** Live spectator feed — server pushes one entry per resolved duel. */
  liveFeed: LiveFeedEntry[];
  liveFeedOpen: boolean;
  /** Player goals — open + completed, refreshed from server. */
  playerGoals: PlayerGoal[];

  // ----- Daily bonus + cases -----
  /** True if a daily-bonus claim hasn't been recorded for the current UTC day. */
  dailyBonusAvailable: boolean;
  /** Cached list of openable cases (no skin pool, server holds that). */
  cases: CaseSummary[];
  freeCaseId: string;
  freeCaseAvailable: boolean;
  /** Owned skin instances. */
  skins: SkinInstanceWire[];
  /** Set while a case-opening animation is in flight (modal active). */
  caseOpening: { caseId: string; strip: SkinStripEntry[]; winnerIndex: number; instance: SkinInstanceWire } | null;
  /** Peer market listings cache — refreshed on demand. */
  skinMarketListings: SkinListingWire[];
  /** Pops after a successful trade-up — shows the new mint result. */
  tradeUpReveal: { output: SkinInstanceWire; outputFloat: number } | null;

  // ----- Per-in-game-day duel cap -----
  /** Duels used this in-game day (resets every ~4 real hours / 1 game day). */
  duelsUsed: number;
  /** Pay-to-refill cycles used this in-game day. Max = MAX_REFILLS_PER_DAY. */
  duelsRefillsUsed: number;

  // ----- Wall-clock auto-advance -----
  /** UTC ms of the next 4-hour boundary, when team.day will auto-tick +1. */
  nextTickUtcMs: number;

  // ----- Scout (pay-to-mint with case-style reveal) -----
  /** Last scout outcome — pops the reveal modal when set, null after dismiss. */
  scoutReveal: { player: Player; rarity: ScoutRarity; cost: number } | null;

  // ----- Massage center -----
  /** Last massage outcome — pops a reveal modal when set, cleared on dismiss. */
  massageReveal: MassageOutcome | null;
  /** In-game day after which a new massage can be booked. */
  massageNextEligibleDay: number;

  // ----- Morale mini-game -----
  /** Plays USED this in-game day (resets when the team's game-day ticks). */
  moraleGamePlaysUsed: number;
  /** Last round result for the reveal panel — kept until next play. */
  moraleGameLast: MoraleGameResult | null;
  /** Rolling tally of today's session, cleared at next day. */
  moraleGameSession: { wins: number; ties: number; losses: number; totalMorale: number };

  // ----- Dragon Gate (in-between) -----
  /** Last round result for the reveal animation. */
  dragonGateLast: DragonGateResult | null;
  /** Running session totals (resets on reconnect — not persisted). */
  dragonGateSession: { rounds: number; wins: number; misses: number; tiangs: number; netCash: number };

  // ----- Crash / Rocket -----
  /** Active round — null while idle. Client uses `startedAt` to drive the
   *  local RAF multiplier curve; server is authoritative on resolution. */
  crashActive: { sessionId: string; bet: number; startedAt: number; clockOffsetMs: number } | null;
  /** Last resolved round — drives the "Last round" panel. */
  crashLast: CrashResult | null;
  /** Running session tally for the user's current sitting. */
  crashSession: { rounds: number; cashouts: number; busts: number; netCash: number };

  // ----- Mines -----
  /** Active round — null while idle. Server holds the real mine layout;
   *  client only knows which tiles it has already revealed + the current
   *  locked-in multiplier. */
  minesActive: {
    sessionId: string;
    bet: number;
    mineCount: number;
    revealedSafe: number[];
    multiplier: number;
  } | null;
  /** Last resolved round — drives the post-game reveal grid. */
  minesLast: MinesResult | null;
  /** Running session tally. */
  minesSession: { rounds: number; cashouts: number; busts: number; netCash: number };

  // ----- Streaming -----
  /** Pops a reveal modal when set, cleared on dismiss. */
  streamReveal: StreamResult | null;
  /** Running tally for the current session. */
  streamSession: { streams: number; totalEarned: number; trainingHits: number };

  // ----- Boosters -----
  /** Unapplied booster cards in inventory. */
  boosts: BoostCard[];
  /** Active boosts keyed by playerId — refreshed by every list-boosts call. */
  activeBoosts: Record<string, ActiveBoostWire>;
  /** Holds the last opened pack card for the reveal modal. Null after dismiss. */
  boostReveal: BoostCard | null;

  // ----- Phase 7 -----
  tacticsPresets: TacticsPreset[];
  news: NewsItem[];
  directory: TeamDirectoryEntry[];

  // ----- Phase 8 -----
  achievements: Achievement[];
  loansIncoming: LoanOffer[];
  loansOutgoing: LoanOffer[];

  // ----- Phase 9 -----
  onlineTeams: number;
  hof: HoFEntry[];
  coachPool: CoachListing[];
  myCoach: CoachListing | null;
  sponsors: SponsorOffer[];

  // ----- AI vs AI betting market -----
  aiBetCards: AiMatchCardWire[];
  /** Last ~10 settled bets the user has placed. Pulled from
   *  ai_bet_history (survives card cleanup). */
  aiBetMyHistory: AiBetHistoryEntry[];
  /** Currently-viewed synthetic team profile (modal). Null = dismissed. */
  aiBetTeamView: { cardId: string; side: 'A' | 'B'; profile: AiBetTeamProfile } | null;
  /** True while we're sitting inside a server-pushed AI bet synced
   *  replay (countdown ended → server pushed full frames → we auto-
   *  routed to the replay viewer). The viewer reads this to force 4×
   *  speed + hide the scrub controls, and routes back to 'ai-bets'
   *  when the last frame plays. */
  aiBetReplayLocked: boolean;

  // ----- Virtual real estate -----
  lotMapPins: LotMapPin[];
  lotAuctions: LotAuctionWire[];
  myLots: LotMapPin[];
  /** Currently-open lot detail modal (or null). */
  viewingLot: LotDetailWire | null;
  /** Top 10 richest lots server-wide (refreshes on the real-estate screen). */
  lotLeaderboard: LotLeaderboardEntry[];

  // ----- UI -----
  screen: OnlineScreen;
  errorBanner: string | null;
  toasts: OnlineToast[];
  log: string[];

  // ----- actions -----
  connectTo: (url: string, nickname: string, pin: string) => void;
  disconnect: () => void;
  createTeam: (name: string, tag: string, region: OnlineTeam['region']) => void;
  spawnInitialRoster: () => void;
  refreshState: () => void;
  clearError: () => void;
  go: (screen: OnlineScreen) => void;
  // Daily bonus + cases.
  claimDailyBonus: () => void;
  refillDuels: () => void;
  renewContract: (playerId: string) => void;
  releasePlayer: (playerId: string) => void;
  bookMassage: () => void;
  dismissMassageReveal: () => void;
  playMoraleGame: (choice: RpsChoice) => void;
  playDragonGate: (bet: number) => void;
  startCrash: (bet: number) => void;
  cashoutCrash: () => void;
  startMines: (bet: number, mineCount: number) => void;
  pickMineTile: (tileIndex: number) => void;
  cashoutMines: () => void;
  streamPlayer: (playerId: string) => void;
  dismissStreamReveal: () => void;
  listCases: () => void;
  openCase: (caseId: string) => void;
  openFreeCase: () => void;
  listSkins: () => void;
  sellSkin: (skinId: string) => void;
  dismissCaseOpening: () => void;
  // Peer skin market
  refreshSkinMarket: () => void;
  listSkinForSale: (skinInstanceId: string, askingPrice: number) => void;
  unlistSkin: (listingId: string) => void;
  buySkinListing: (listingId: string) => void;
  // Trade-up contract
  tradeUpSkins: (skinInstanceIds: string[]) => void;
  dismissTradeUpReveal: () => void;
  // Boosters
  listBoosts: () => void;
  buyBoostPack: () => void;
  applyBoost: (cardId: string, playerId: string) => void;
  discardBoost: (cardId: string) => void;
  dismissBoostReveal: () => void;
  // Admin actions (no-op for non-admins; server still validates).
  adminListUsers: () => void;
  adminResetPin: (nickname: string, newPin: string) => void;
  adminEditTeam: (teamId: string, fields: AdminTeamEditFields) => void;
  adminAdjustMoney: (teamId: string, delta: number, note?: string) => void;
  adminDeleteTeam: (teamId: string) => void;

  // Phase 2 actions
  registerAiDuel: (stake: number, format: MatchFormat) => void;
  dismissDuelResult: () => void;
  timeSkip: (days: number) => void;
  refreshMarket: () => void;
  listPlayer: (playerId: string, askingPrice: number) => void;
  unlistPlayer: (listingId: string) => void;
  buyListedPlayer: (listingId: string) => void;
  dismissToast: (id: number) => void;
  // Phase 3 actions
  refreshFreeAgents: () => void;
  signFreeAgent: (playerId: string, wage: number) => void;
  mintFreeAgent: () => void;
  dismissScoutReveal: () => void;
  refreshChallenges: () => void;
  postChallenge: (stake: number, format: MatchFormat, message?: string) => void;
  findAsyncMatch: (stake: number) => void;
  fetchTeamProfile: (teamId: string) => void;
  dismissTeamProfile: () => void;
  viewPlayer: (playerId: string) => void;
  dismissPlayer: () => void;
  refreshQuests: () => void;
  claimQuest: (questId: string) => void;
  claimAllDoneBonus: () => void;
  /** Called by the replay viewer when a locked-mode PvP replay finishes:
   *  drain the pending duel result into duelResult + return the user to
   *  the home screen so the result modal pops. */
  drainPendingDuelResult: () => void;
  cancelChallenge: (challengeId: string) => void;
  acceptChallenge: (challengeId: string) => void;
  refreshHistory: () => void;
  watchMatch: (matchId: string) => void;
  closeViewer: () => void;

  // Phase 4 actions
  setTactics: (tactics: Partial<Tactics>) => void;
  reorderLineup: (playerIds: string[]) => void;
  refreshLeaderboard: () => void;
  refreshRankedLeaderboard: () => void;

  // Phase 5 actions
  fetchLiveReplay: (matchId: string) => void;
  closeReplay: () => void;
  dismissDevReport: () => void;
  toggleChat: () => void;
  fetchChatHistory: (channel?: string) => void;
  sendChat: (text: string) => void;
  setChatChannel: (channel: string) => void;
  refreshTournaments: () => void;
  createTournament: (size: 4 | 8, entryFee: number) => void;
  registerTournament: (tournamentId: string) => void;
  fetchTournamentDetail: (tournamentId: string) => void;
  toggleLiveFeed: () => void;
  // Phase 6 actions
  setPlayerGoal: (playerId: string, attr: string, target: number) => void;
  clearPlayerGoal: (playerId: string, attr: string) => void;
  refreshGoals: () => void;
  // Phase 7 actions
  saveTacticsPreset: (name: string) => void;
  listTacticsPresets: () => void;
  applyTacticsPreset: (presetId: string) => void;
  deleteTacticsPreset: (presetId: string) => void;
  fetchNews: () => void;
  listOnlineTeams: () => void;
  exportTeam: () => void;
  importTeam: (payload: string) => void;
  // Phase 8 actions
  listAchievements: () => void;
  updateProfile: (fields: TeamProfileFields) => void;
  offerLoan: (toTeamId: string, playerId: string, fee: number, days: number) => void;
  listLoanOffers: () => void;
  acceptLoan: (loanId: string) => void;
  declineLoan: (loanId: string) => void;
  recallLoan: (loanId: string) => void;
  // Phase 9 actions
  listHof: () => void;
  listCoaches: () => void;
  hireCoach: (coachId: string) => void;
  fireCoach: () => void;
  listSponsors: () => void;
  respondSponsor: (sponsorId: string, accept: boolean) => void;
  // AI vs AI betting market
  refreshAiBets: () => void;
  refreshAiBetHistory: () => void;
  placeAiBet: (cardId: string, side: 'A' | 'B', stake: number) => void;
  fetchAiBetReplay: (cardId: string) => void;
  fetchAiBetTeam: (cardId: string, side: 'A' | 'B') => void;
  dismissAiBetTeam: () => void;
  /** Called by OnlineLiveReplayScreen when an AI bet synced replay
   *  finishes — drops the locked flag + the cached replay + routes
   *  back to the AI Betting screen. */
  endAiBetReplay: () => void;
  // Real estate
  fetchLotMap: (x0: number, y0: number, x1: number, y1: number) => void;
  fetchLotAuctions: () => void;
  fetchMyLots: () => void;
  fetchLotDetail: (x: number, y: number) => void;
  dismissLotDetail: () => void;
  placeLotBid: (x: number, y: number, amount: number) => void;
  upgradeLotApartment: (lotId: string, toTier: ApartmentTier) => void;
  buyLotCar: (lotId: string, carId: string) => void;
  sellLotCar: (lotId: string, lotCarId: number) => void;
  buyLotLuxury: (lotId: string, itemId: string) => void;
  sellLotLuxury: (lotId: string, lotLuxuryId: number) => void;
  lotVaultDeposit: (lotId: string, amount: number) => void;
  lotVaultWithdraw: (lotId: string, amount: number) => void;
  assignLotResident: (lotId: string, playerId: string) => void;
  evictLotResident: (lotId: string, playerId: string) => void;
  fetchLotLeaderboard: () => void;
  collectLotInterest: (lotId: string) => void;
}

let nextToastId = 1;

export const useOnline = create<OnlineState>((set, get) => ({
  client: null,
  status: 'idle',
  serverUrl: '',
  nickname: '',
  sessionToken: null,
  isAdmin: false,
  adminUsers: [],
  team: null,
  players: {},
  duelResult: null,
  duelPending: false,
  pendingDuelResult: null,
  skipPending: false,
  marketListings: [],
  marketPlayers: {},
  freeAgents: [],
  freeAgentWages: {},
  openChallenges: [],
  myChallenges: [],
  history: [],
  viewing: null,
  leaderboardSeason: null,
  leaderboardRows: [],
  myStandings: null,
  pvpLeaderRows: [],
  myPvpStandings: null,
  rankedLeaderRows: [],
  viewingTeamProfile: null,
  teamProfileLoading: null,
  viewingPlayerId: null,
  questSnapshot: null,
  lastDevChanges: [],
  showDevReport: false,
  liveReplay: null,
  chatHistory: [],
  chatOpen: false,
  chatChannel: 'global',
  tournaments: [],
  activeTournament: null,
  liveFeed: [],
  liveFeedOpen: false,
  playerGoals: [],
  dailyBonusAvailable: false,
  cases: [],
  freeCaseId: '',
  freeCaseAvailable: false,
  skins: [],
  caseOpening: null,
  skinMarketListings: [],
  tradeUpReveal: null,
  duelsUsed: 0,
  duelsRefillsUsed: 0,
  nextTickUtcMs: 0,
  boosts: [],
  activeBoosts: {},
  boostReveal: null,
  scoutReveal: null,
  massageReveal: null,
  massageNextEligibleDay: 0,
  moraleGamePlaysUsed: 0,
  moraleGameLast: null,
  moraleGameSession: { wins: 0, ties: 0, losses: 0, totalMorale: 0 },
  dragonGateLast: null,
  dragonGateSession: { rounds: 0, wins: 0, misses: 0, tiangs: 0, netCash: 0 },
  crashActive: null,
  crashLast: null,
  crashSession: { rounds: 0, cashouts: 0, busts: 0, netCash: 0 },
  minesActive: null,
  minesLast: null,
  minesSession: { rounds: 0, cashouts: 0, busts: 0, netCash: 0 },
  streamReveal: null,
  streamSession: { streams: 0, totalEarned: 0, trainingHits: 0 },
  tacticsPresets: [],
  news: [],
  directory: [],
  achievements: [],
  loansIncoming: [],
  loansOutgoing: [],
  onlineTeams: 0,
  hof: [],
  coachPool: [],
  myCoach: null,
  sponsors: [],
  aiBetCards: [],
  aiBetMyHistory: [],
  aiBetTeamView: null,
  aiBetReplayLocked: false,
  lotMapPins: [],
  lotAuctions: [],
  myLots: [],
  viewingLot: null,
  lotLeaderboard: [],
  screen: 'connect',
  errorBanner: null,
  toasts: [],
  log: [],

  connectTo(url, nickname, pin) {
    // Drop any previous connection so reconnecting with new creds is clean.
    get().client?.close();
    set({
      serverUrl: url,
      nickname,
      team: null,
      players: {},
      errorBanner: null,
      log: [`Connecting to ${url}...`],
    });

    const client = connect(url, {
      onStatus(s) {
        set({ status: s });
      },
      onLog(line) {
        // Keep the last ~30 log lines for the Connect screen status panel.
        const log = [...get().log, line];
        if (log.length > 30) log.shift();
        set({ log });
      },
      onMessage(msg) {
        handleMessage(msg);
      },
      onReopen(send) {
        // Fires on EVERY socket open (initial connect AND every reconnect
        // after a network blip). Re-authenticating here is what prevents
        // the silent "auto sign-out" — without this re-send, the server
        // has no session on the new socket and every subsequent message
        // toasts a no-team / no-session error.
        send({ kind: 'hello', nickname, pin });
        // If we already had a team mid-session, refresh state to re-hydrate
        // anything that changed during the disconnected window.
        if (get().team) send({ kind: 'refresh-state' });
      },
    });
    set({ client });

    function handleMessage(msg: ServerMessage): void {
      switch (msg.kind) {
        case 'hello-ok': {
          set({ sessionToken: msg.sessionToken, isAdmin: !!msg.isAdmin });
          if (msg.hasTeam) {
            client.send({ kind: 'refresh-state' });
            set({ screen: 'home' });
          } else {
            set({ screen: 'create-team' });
          }
          break;
        }
        case 'hello-bad-pin':
          set({ errorBanner: 'PIN does not match the registered nickname.', screen: 'connect' });
          client.close();
          break;
        case 'team-created': {
          set({ team: msg.team, players: {}, screen: 'create-team' });
          // Immediately request the initial roster.
          client.send({ kind: 'spawn-initial-players' });
          break;
        }
        case 'players-spawned': {
          const players: Record<string, Player> = { ...get().players };
          for (const p of msg.players) players[p.id] = p;
          set({ players });
          // Re-fetch state so playerIds + money are authoritative.
          client.send({ kind: 'refresh-state' });
          set({ screen: 'home' });
          break;
        }
        case 'state': {
          const players: Record<string, Player> = {};
          for (const p of msg.players) players[p.id] = p;
          // Reset the local morale-game tally when the server tells us the
          // play counter rolled over (new in-game day).
          const moraleSessionReset = msg.moraleGamePlaysUsed < get().moraleGamePlaysUsed;
          set({
            team: msg.team,
            players,
            dailyBonusAvailable: msg.dailyBonusAvailable,
            freeCaseAvailable: msg.freeCaseAvailable,
            duelsUsed: msg.duelsUsed,
            duelsRefillsUsed: msg.duelsRefillsUsed,
            moraleGamePlaysUsed: msg.moraleGamePlaysUsed,
            ...(moraleSessionReset ? {
              moraleGameLast: null,
              moraleGameSession: { wins: 0, ties: 0, losses: 0, totalMorale: 0 },
            } : {}),
            nextTickUtcMs: msg.nextTickUtcMs,
          });
          break;
        }
        case 'duel-result': {
          // Apply money delta optimistically. PvP outcomes carry
          // lockedReplay=true → both teams get routed into the synced
          // replay viewer first; the result modal pops only when the
          // last frame plays out (no scrub controls, forced 4× speed).
          // AI outcomes go straight to the modal as before.
          const team = get().team;
          const moneyPatch = team ? { ...team, money: msg.outcome.newMoney } : team;
          if (msg.outcome.lockedReplay) {
            set({
              duelPending: false,
              team: moneyPatch,
              // Locked PvP path: derive tags from our team + the
              // server-supplied opponent tag in the outcome.
              liveReplay: {
                matchId: msg.outcome.result.matchId,
                result: msg.outcome.result,
                teamATag: team && msg.outcome.result.teamAId === team.id
                  ? team.tag
                  : (msg.outcome.opponentTag ?? '?'),
                teamBTag: team && msg.outcome.result.teamBId === team.id
                  ? team.tag
                  : (msg.outcome.opponentTag ?? '?'),
              },
              pendingDuelResult: msg.outcome,
              screen: 'replay',
            });
          } else {
            set({
              duelResult: msg.outcome,
              duelPending: false,
              team: moneyPatch,
            });
            pushToast(
              msg.outcome.moneyDelta > 0 ? 'success' : 'warn',
              msg.outcome.summary,
            );
          }
          // Refresh state to pull in mutated player stats (form/morale/fatigue).
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'time-skipped': {
          set({
            skipPending: false,
            lastDevChanges: msg.devChanges,
            // Auto-open the growth modal whenever the skip moved at least one player.
            showDevReport: msg.devChanges.length > 0,
          });
          pushToast(
            'success',
            `+${msg.daysAdvanced} days · -$${msg.cost.toLocaleString()}.` +
              (msg.devChanges.length > 0 ? ` ${msg.devChanges.length} player${msg.devChanges.length === 1 ? '' : 's'} developed.` : ''),
          );
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'market': {
          const players: Record<string, Player> = {};
          for (const p of msg.players) players[p.id] = p;
          set({ marketListings: msg.listings, marketPlayers: players });
          break;
        }
        case 'market-listed': {
          set({ marketListings: [msg.listing, ...get().marketListings] });
          pushToast('info', `Listed for $${msg.listing.askingPrice.toLocaleString()}.`);
          break;
        }
        case 'market-unlisted': {
          set({ marketListings: get().marketListings.filter((l) => l.id !== msg.listingId) });
          pushToast('info', 'Listing removed.');
          break;
        }
        case 'market-bought': {
          // Player joins our roster — strip the listing locally and refresh.
          set({ marketListings: get().marketListings.filter((l) => l.id !== msg.listingId) });
          pushToast('success', `Signed ${msg.player.nickname} for $${msg.cost.toLocaleString()}.`);
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'challenges': {
          set({ openChallenges: msg.open, myChallenges: msg.mine });
          break;
        }
        case 'challenge-posted': {
          set({ myChallenges: [msg.challenge, ...get().myChallenges] });
          pushToast('info', `Challenge posted: $${msg.challenge.stake.toLocaleString()} ${msg.challenge.format}.`);
          break;
        }
        case 'challenge-cancelled': {
          set({
            myChallenges: get().myChallenges.filter((c) => c.id !== msg.challengeId),
            openChallenges: get().openChallenges.filter((c) => c.id !== msg.challengeId),
          });
          break;
        }
        case 'free-agents': {
          set({ freeAgents: msg.players, freeAgentWages: msg.suggestedWageById });
          break;
        }
        case 'free-agent-signed': {
          pushToast('success', `Signed FA ${msg.player.nickname} at $${msg.wage.toLocaleString()}/mo.`);
          set({
            // Drop from local FA snapshot immediately for snappy UX.
            freeAgents: get().freeAgents.filter((p) => p.id !== msg.player.id),
          });
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'player-scouted': {
          const t = get().team;
          // Optimistic state: deduct money + add to roster + cache the new
          // player record. The pack-opening reveal animates over the rarity
          // + player payload; a refresh-state follows to re-sync canonical
          // fields once the user has dismissed the reveal.
          set({
            team: t ? { ...t, money: msg.newMoney, playerIds: [...t.playerIds, msg.player.id] } : t,
            players: { ...get().players, [msg.player.id]: msg.player },
            scoutReveal: { player: msg.player, rarity: msg.rarity, cost: msg.cost },
          });
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'history': {
          set({ history: msg.matches });
          break;
        }
        case 'match-detail': {
          set({
            viewing: { matchId: msg.matchId, result: msg.result, teamATag: msg.teamATag, teamBTag: msg.teamBTag },
            screen: 'viewer',
          });
          break;
        }
        case 'tactics-saved': {
          const team = get().team;
          if (team) set({ team: { ...team, tactics: msg.tactics } });
          pushToast('success', 'Tactics saved.');
          break;
        }
        case 'lineup-saved': {
          const team = get().team;
          if (team) set({ team: { ...team, playerIds: msg.playerIds } });
          pushToast('success', 'Lineup updated.');
          break;
        }
        case 'leaderboard': {
          set({
            leaderboardSeason: msg.season,
            leaderboardRows: msg.rows,
            myStandings: msg.me,
            pvpLeaderRows: msg.pvpRows,
            myPvpStandings: msg.myPvp,
          });
          break;
        }
        case 'ranked-leaderboard': {
          set({ rankedLeaderRows: msg.rows });
          break;
        }
        case 'live-replay': {
          set({
            liveReplay: {
              matchId: msg.matchId,
              result: msg.result,
              teamATag: msg.teamATag,
              teamBTag: msg.teamBTag,
              // Carries roster anchor for AI bet "Watch replay" path
              // so spectator-mode scoreboard splits correctly.
              teamARosterIds: msg.teamARosterIds,
            },
            screen: 'replay',
          });
          break;
        }
        case 'live-replay-expired': {
          pushToast('warn', 'Live replay expired — only the stats view is available now.');
          break;
        }
        case 'chat-history': {
          set({ chatHistory: msg.messages });
          break;
        }
        case 'chat-message': {
          // Only append to the local pane if this message belongs to the
          // channel we're currently viewing. Other channels' messages are
          // ignored — when the user switches, fetchChatHistory pulls fresh.
          if (msg.message.channel !== get().chatChannel) break;
          const next = [...get().chatHistory, msg.message];
          if (next.length > 100) next.shift();
          set({ chatHistory: next });
          break;
        }
        case 'tournaments': {
          set({ tournaments: msg.list });
          break;
        }
        case 'tournament-detail': {
          set({ activeTournament: msg.tournament });
          break;
        }
        case 'player-goals': {
          set({ playerGoals: msg.goals });
          break;
        }
        case 'goal-reached': {
          pushToast('success', `🎯 ${msg.nickname} hit ${msg.attr} ${msg.target}!`);
          client.send({ kind: 'list-player-goals' });
          break;
        }
        case 'tactics-presets': {
          set({ tacticsPresets: msg.presets });
          break;
        }
        case 'news-history': {
          set({ news: msg.items });
          break;
        }
        case 'news-item': {
          const next = [...get().news, msg.item].slice(-100);
          set({ news: next });
          break;
        }
        case 'online-teams': {
          set({ directory: msg.teams });
          break;
        }
        case 'team-export': {
          // Trigger a browser download of the JSON blob.
          try {
            const team = get().team;
            const tag = team?.tag ?? 'team';
            const blob = new Blob([msg.payload], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${tag}-export-${Date.now()}.csm.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            pushToast('success', `Exported ${tag}.`);
          } catch (err) {
            pushToast('error', `Export failed: ${String(err)}`);
          }
          break;
        }
        case 'team-imported': {
          set({ team: msg.team });
          client.send({ kind: 'refresh-state' });
          pushToast('success', `${msg.team.tag} imported successfully.`);
          break;
        }
        case 'achievements': {
          set({ achievements: msg.entries });
          break;
        }
        case 'achievement-unlocked': {
          const label = msg.achievement.label ?? `🏅 Achievement: ${msg.achievement.kind}`;
          const cash = msg.achievement.rewardCash;
          const text = typeof cash === 'number' && cash > 0
            ? `${label} · +$${cash.toLocaleString()}`
            : label;
          pushToast('success', text);
          set({ achievements: [...get().achievements.filter((a) => a.kind !== msg.achievement.kind), msg.achievement] });
          break;
        }
        case 'profile-updated': {
          set({ team: msg.team });
          pushToast('success', 'Profile saved.');
          break;
        }
        case 'team-profile': {
          set({ viewingTeamProfile: msg.profile, teamProfileLoading: null });
          break;
        }
        case 'quest-snapshot': {
          set({ questSnapshot: msg.snapshot });
          break;
        }
        case 'quest-claimed': {
          const t = get().team;
          set({
            questSnapshot: msg.snapshot,
            team: t ? { ...t, money: msg.newMoney } : t,
          });
          pushToast('success', `Quest claimed: +$${msg.cashEarned.toLocaleString()}.`);
          break;
        }
        case 'all-done-bonus-claimed': {
          const t = get().team;
          set({
            questSnapshot: msg.snapshot,
            team: t ? { ...t, money: msg.newMoney } : t,
          });
          pushToast('success', `🎉 All quests done! Bonus +$${msg.cashEarned.toLocaleString()}.`);
          break;
        }
        case 'loan-offers': {
          set({ loansIncoming: msg.incoming, loansOutgoing: msg.outgoing });
          break;
        }
        case 'presence': {
          set({ onlineTeams: msg.onlineTeams });
          break;
        }
        case 'hof': {
          set({ hof: msg.entries });
          break;
        }
        case 'player-retired': {
          pushToast('info', `👋 ${msg.nickname} retires at age ${msg.lastAge} — inducted into the Hall of Fame.`);
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'coach-pool': {
          set({ coachPool: msg.openCoaches, myCoach: msg.myCoach });
          break;
        }
        case 'coach-hired': {
          set({ myCoach: msg.coach });
          pushToast('success', `Hired ${msg.coach.name} (skill ${msg.coach.skill}).`);
          client.send({ kind: 'list-coaches' });
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'sponsors': {
          set({ sponsors: msg.offers });
          for (const p of msg.paid) {
            pushToast('success', `💰 Sponsor payout: +$${p.amount.toLocaleString()}.`);
          }
          if (msg.paid.length > 0) client.send({ kind: 'refresh-state' });
          // Pending offer hint.
          const pending = msg.offers.find((s) => s.status === 'pending');
          if (pending) pushToast('info', `📨 New sponsor offer: ${pending.sponsorName} at $${pending.monthlyAmount.toLocaleString()}/mo.`);
          break;
        }
        case 'loan-event': {
          // Refresh the loans list when anything changes.
          client.send({ kind: 'list-loan-offers' });
          if (msg.loan.status === 'pending') {
            pushToast('info', `📨 Loan offer: ${msg.loan.fromTeamTag} → ${msg.loan.toTeamTag} (${msg.loan.playerNickname})`);
          } else if (msg.loan.status === 'active') {
            pushToast('success', `Loan active: ${msg.loan.playerNickname} now at ${msg.loan.toTeamTag} for ${msg.loan.days}d`);
            client.send({ kind: 'refresh-state' });
          } else if (msg.loan.status === 'returned') {
            pushToast('info', `${msg.loan.playerNickname} returned from loan.`);
            client.send({ kind: 'refresh-state' });
          } else if (msg.loan.status === 'declined') {
            pushToast('warn', `Loan declined.`);
          }
          break;
        }
        case 'live-match-feed': {
          // Prepend so newest is first, cap at 30 entries client-side.
          const feed = [msg.entry, ...get().liveFeed].slice(0, 30);
          set({ liveFeed: feed });
          break;
        }
        case 'tournament-update': {
          // Update or insert in lobby list + replace activeTournament if same id.
          const list = get().tournaments;
          const idx = list.findIndex((t) => t.id === msg.tournament.id);
          const updatedRow: TournamentSummary = {
            id: msg.tournament.id,
            name: msg.tournament.name,
            size: msg.tournament.size,
            entryFee: msg.tournament.entryFee,
            prizePool: msg.tournament.prizePool,
            registered: msg.tournament.registered,
            status: msg.tournament.status,
            createdAt: msg.tournament.createdAt,
            iAmIn: msg.tournament.iAmIn,
          };
          const nextList = idx >= 0
            ? list.map((t, i) => (i === idx ? updatedRow : t))
            : [updatedRow, ...list];
          set({
            tournaments: nextList,
            activeTournament:
              get().activeTournament?.id === msg.tournament.id ? msg.tournament : get().activeTournament,
          });
          // Surface finished tournaments as toasts so registered players see the result.
          if (msg.tournament.status === 'finished' && msg.tournament.prizes) {
            const team = get().team;
            const myPrize = team ? msg.tournament.prizes.find((p) => p.teamId === team.id) : undefined;
            if (myPrize) {
              const place =
                myPrize.placement === 1 ? '🏆 Champion' :
                myPrize.placement === 2 ? '🥈 Runner-up' :
                myPrize.placement === 3 ? '🥉 Semi-finalist' : `${myPrize.placement}th`;
              pushToast('success', `${msg.tournament.name}: ${place} · +$${myPrize.cash.toLocaleString()}.`);
              client.send({ kind: 'refresh-state' });
            } else if (team && msg.tournament.bracket.some((b) => b.teamAId === team.id || b.teamBId === team.id)) {
              pushToast('info', `${msg.tournament.name} concluded — see the bracket for results.`);
            }
          }
          break;
        }
        case 'daily-bonus-claimed': {
          const t = get().team;
          set({
            dailyBonusAvailable: false,
            team: t ? { ...t, money: msg.newMoney } : t,
          });
          pushToast('success', `Daily bonus: +$${msg.amount.toLocaleString()}.`);
          break;
        }
        case 'duels-refilled': {
          const t = get().team;
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            duelsUsed: 0,
            duelsRefillsUsed: msg.refillsUsed,
          });
          pushToast(
            'success',
            `Duels refilled (-$${msg.cost.toLocaleString()}). ${msg.refillsLeft} refill${msg.refillsLeft === 1 ? '' : 's'} left this in-game day.`,
          );
          break;
        }
        case 'dragon-gate-result': {
          const t = get().team;
          const cur = get().dragonGateSession;
          const next = {
            rounds: cur.rounds + 1,
            wins: cur.wins + (msg.result.outcome === 'win' ? 1 : 0),
            misses: cur.misses + (msg.result.outcome === 'miss' ? 1 : 0),
            tiangs: cur.tiangs + (msg.result.outcome === 'tiang' ? 1 : 0),
            netCash: cur.netCash + msg.result.delta,
          };
          set({
            team: t ? { ...t, money: msg.result.newMoney } : t,
            dragonGateLast: msg.result,
            dragonGateSession: next,
          });
          break;
        }
        case 'crash-started': {
          const t = get().team;
          // clockOffsetMs: positive = server clock is ahead of ours. Use it
          // to render a multiplier curve that lines up with what the server
          // computes at cashout, so the UI doesn't lock in a number that
          // visually differs from the payout.
          const clockOffsetMs = msg.serverNowMs - Date.now();
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            crashActive: {
              sessionId: msg.sessionId,
              bet: msg.bet,
              startedAt: msg.startedAt,
              clockOffsetMs,
            },
            // Clear the prior result while a new round is active.
            crashLast: null,
          });
          break;
        }
        case 'crash-result': {
          const t = get().team;
          const cur = get().crashSession;
          const next = {
            rounds: cur.rounds + 1,
            cashouts: cur.cashouts + (msg.result.outcome === 'cashout' ? 1 : 0),
            busts: cur.busts + (msg.result.outcome === 'bust' ? 1 : 0),
            netCash: cur.netCash + msg.result.delta,
          };
          set({
            team: t ? { ...t, money: msg.result.newMoney } : t,
            crashActive: null,
            crashLast: msg.result,
            crashSession: next,
          });
          break;
        }
        case 'mines-started': {
          const t = get().team;
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            minesActive: {
              sessionId: msg.sessionId,
              bet: msg.bet,
              mineCount: msg.mineCount,
              revealedSafe: [],
              multiplier: 1.0,
            },
            // Clear prior round when a new one starts.
            minesLast: null,
          });
          break;
        }
        case 'mines-tile-revealed': {
          const cur = get().minesActive;
          if (!cur || cur.sessionId !== msg.sessionId) break;
          set({
            minesActive: {
              ...cur,
              revealedSafe: [...cur.revealedSafe, msg.tileIndex],
              multiplier: msg.multiplier,
            },
          });
          break;
        }
        case 'mines-result': {
          const t = get().team;
          const cur = get().minesSession;
          const next = {
            rounds: cur.rounds + 1,
            cashouts: cur.cashouts + (msg.result.outcome === 'cashout' ? 1 : 0),
            busts: cur.busts + (msg.result.outcome === 'bust' ? 1 : 0),
            netCash: cur.netCash + msg.result.delta,
          };
          set({
            team: t ? { ...t, money: msg.result.newMoney } : t,
            minesActive: null,
            minesLast: msg.result,
            minesSession: next,
          });
          break;
        }
        case 'stream-result': {
          const t = get().team;
          const cur = get().streamSession;
          set({
            team: t ? { ...t, money: msg.result.newMoney } : t,
            streamReveal: msg.result,
            streamSession: {
              streams: cur.streams + 1,
              totalEarned: cur.totalEarned + msg.result.payout,
              trainingHits: cur.trainingHits + (msg.result.trainingGained ? 1 : 0),
            },
          });
          // Refresh state so the roster table shows the new fatigue/morale
          // values + decremented contract counter.
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'morale-game-result': {
          const cur = get().moraleGameSession;
          const next = {
            wins: cur.wins + (msg.result.outcome === 'win' ? 1 : 0),
            ties: cur.ties + (msg.result.outcome === 'tie' ? 1 : 0),
            losses: cur.losses + (msg.result.outcome === 'loss' ? 1 : 0),
            totalMorale: cur.totalMorale + msg.result.moraleDelta,
          };
          set({
            moraleGameLast: msg.result,
            moraleGameSession: next,
            // playsLeft = cap - used → used = cap - playsLeft. Hardcode 5
            // here too so a stale constant on the client doesn't desync.
            moraleGamePlaysUsed: 5 - msg.result.playsLeft,
          });
          // Refresh state so roster table picks up the new morale values.
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'massage-booked': {
          const t = get().team;
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            massageReveal: msg.outcome,
            massageNextEligibleDay: msg.nextEligibleGameDay,
          });
          // Refresh so the roster table shows the new fatigue/morale values.
          client.send({ kind: 'refresh-state' });
          break;
        }
        case 'contract-renewed': {
          const t = get().team;
          const ps = { ...get().players };
          const p = ps[msg.playerId];
          if (p && p.contract) {
            ps[msg.playerId] = { ...p, contract: { ...p.contract, duelsRemaining: msg.duelsRemaining } };
          }
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            players: ps,
          });
          pushToast('success', `Renewed ${p?.nickname ?? 'player'} (+30 duels) for $${msg.cost.toLocaleString()}.`);
          break;
        }
        case 'player-expired': {
          // Drop from local team + players cache immediately; refresh-state
          // will re-confirm but the UI shouldn't show a stale starter.
          const t = get().team;
          const ps = { ...get().players };
          delete ps[msg.playerId];
          set({
            team: t ? { ...t, playerIds: t.playerIds.filter((id) => id !== msg.playerId) } : t,
            players: ps,
          });
          pushToast('warn', `${msg.nickname}'s contract expired — now a free agent.`);
          break;
        }
        case 'player-released': {
          const t = get().team;
          const ps = { ...get().players };
          delete ps[msg.playerId];
          set({
            team: t ? { ...t, money: msg.newMoney, playerIds: t.playerIds.filter((id) => id !== msg.playerId) } : t,
            players: ps,
          });
          pushToast('info', `Released ${msg.nickname} to free agency.`);
          break;
        }
        case 'duel-stats': {
          set({ duelsUsed: msg.used, duelsRefillsUsed: msg.refillsUsed });
          break;
        }
        case 'case-list': {
          set({ cases: msg.cases, freeCaseId: msg.freeCaseId, freeCaseAvailable: msg.freeCaseAvailable });
          break;
        }
        case 'case-opened': {
          const t = get().team;
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            // Modal animation runs client-side from this payload.
            caseOpening: {
              caseId: msg.caseId,
              strip: msg.strip,
              winnerIndex: msg.winnerIndex,
              instance: msg.instance,
            },
            // Optimistically prepend to inventory so the count updates.
            skins: [msg.instance, ...get().skins],
            freeCaseAvailable: msg.freeCase ? false : get().freeCaseAvailable,
          });
          break;
        }
        case 'skin-inventory': {
          set({ skins: msg.skins });
          break;
        }
        case 'skin-sold': {
          const t = get().team;
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            skins: get().skins.filter((s) => s.id !== msg.skinId),
          });
          pushToast('success', `Skin sold: +$${msg.payout.toLocaleString()}.`);
          break;
        }
        case 'skin-market': {
          set({ skinMarketListings: msg.listings });
          break;
        }
        case 'skin-listed': {
          set({ skinMarketListings: [msg.listing, ...get().skinMarketListings] });
          pushToast('info', `Listed for $${msg.listing.askingPrice.toLocaleString()}.`);
          break;
        }
        case 'skin-unlisted': {
          set({ skinMarketListings: get().skinMarketListings.filter((l) => l.id !== msg.listingId) });
          break;
        }
        case 'skin-bought': {
          const t = get().team;
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            // The new skin lands in OUR inventory; drop the listing locally.
            skins: [msg.skin, ...get().skins],
            skinMarketListings: get().skinMarketListings.filter((l) => l.id !== msg.listingId),
          });
          pushToast('success', `Bought ${msg.skin.weapon} ${msg.skin.name} for $${msg.cost.toLocaleString()}.`);
          break;
        }
        case 'skin-trade-up': {
          // Burn the inputs locally; add the output.
          const consumed = new Set(msg.consumedIds);
          set({
            skins: [msg.output, ...get().skins.filter((s) => !consumed.has(s.id))],
            tradeUpReveal: { output: msg.output, outputFloat: msg.outputFloat },
          });
          pushToast('success', `Trade-up: ${msg.output.weapon} ${msg.output.name} (float ${msg.outputFloat.toFixed(4)}).`);
          break;
        }
        case 'boost-inventory': {
          set({ boosts: msg.cards, activeBoosts: msg.activeByPlayer });
          break;
        }
        case 'boost-pack-opened': {
          const t = get().team;
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            boosts: [msg.card, ...get().boosts],
            boostReveal: msg.card,
          });
          break;
        }
        case 'boost-applied': {
          set({
            boosts: get().boosts.filter((c) => c.id !== msg.cardId),
            activeBoosts: { ...get().activeBoosts, [msg.playerId]: msg.active },
          });
          pushToast('success', `Applied ${msg.active.name} (+${msg.active.attrBonus}, ${msg.active.duelsLeft} duel${msg.active.duelsLeft === 1 ? '' : 's'}).`);
          break;
        }
        case 'boost-discarded': {
          set({ boosts: get().boosts.filter((c) => c.id !== msg.cardId) });
          break;
        }
        case 'boost-expired': {
          const cur = { ...get().activeBoosts };
          const name = cur[msg.playerId]?.name;
          delete cur[msg.playerId];
          set({ activeBoosts: cur });
          if (name) pushToast('info', `${name} boost expired.`);
          break;
        }
        case 'admin-users': {
          set({ adminUsers: msg.rows });
          break;
        }
        case 'admin-pin-reset': {
          pushToast('success', `PIN reset for ${msg.nickname} → ${msg.newPin}`);
          client.send({ kind: 'admin-list-users' });
          break;
        }
        case 'admin-team-edited': {
          pushToast('success', `Team ${msg.teamId} updated.`);
          client.send({ kind: 'admin-list-users' });
          break;
        }
        case 'admin-team-deleted': {
          pushToast('success', `Team ${msg.teamId} deleted.`);
          client.send({ kind: 'admin-list-users' });
          break;
        }
        case 'team-money-updated': {
          const t = get().team;
          if (t && t.id === msg.teamId) set({ team: { ...t, money: msg.money } });
          // No toast here — this also fires after AI bet placement / settlement,
          // and the betting flow surfaces its own dedicated toast.
          break;
        }
        case 'ai-bet-list': {
          set({ aiBetCards: msg.cards });
          break;
        }
        case 'ai-bet-placed': {
          const t = get().team;
          if (t) set({ team: { ...t, money: msg.newMoney } });
          pushToast('success', `Bet placed — good luck.`);
          break;
        }
        case 'ai-bet-settled': {
          const t = get().team;
          if (t) set({ team: { ...t, money: msg.newMoney } });
          if (msg.bet.status === 'won') {
            pushToast('success', `Bet WON — payout $${(msg.bet.payout ?? 0).toLocaleString()}.`);
          } else {
            pushToast('warn', `Bet lost — $${msg.bet.stake.toLocaleString()} gone.`);
          }
          // Refresh the card list so the bet shows as settled with a payout,
          // and pull the now-extended history so the new row appears at top.
          client.send({ kind: 'list-ai-bets' });
          client.send({ kind: 'list-my-ai-bet-history' });
          break;
        }
        case 'ai-bet-card-update': {
          const existing = get().aiBetCards;
          const idx = existing.findIndex((c) => c.id === msg.card.id);
          if (idx >= 0) {
            const next = existing.slice();
            next[idx] = msg.card;
            set({ aiBetCards: next });
          } else {
            set({ aiBetCards: [...existing, msg.card] });
          }
          break;
        }
        case 'ai-bet-team': {
          set({ aiBetTeamView: { cardId: msg.cardId, side: msg.side, profile: msg.profile } });
          break;
        }
        case 'ai-bet-my-history': {
          set({ aiBetMyHistory: msg.entries });
          break;
        }
        case 'ai-bet-replay-starting': {
          // Server pushed the full match frames for a card we bet on.
          // Route into the locked replay viewer so every bettor on this
          // card sees the same match at the same beat (synced playback).
          // teamARosterIds drives the spectator-mode team membership
          // resolution — neither team is the viewer's own here.
          set({
            liveReplay: {
              matchId: msg.matchId,
              result: msg.result,
              teamATag: msg.teamATag,
              teamBTag: msg.teamBTag,
              teamARosterIds: msg.teamARosterIds,
            },
            aiBetReplayLocked: true,
            screen: 'replay',
          });
          break;
        }
        case 'lot-map': {
          set({ lotMapPins: msg.pins });
          break;
        }
        case 'lot-auctions': {
          set({ lotAuctions: msg.auctions });
          break;
        }
        case 'my-lots': {
          set({ myLots: msg.lots });
          break;
        }
        case 'lot-detail': {
          set({ viewingLot: msg.lot });
          break;
        }
        case 'lot-bid-placed': {
          const t = get().team;
          if (t) set({ team: { ...t, money: msg.newMoney } });
          pushToast('success', `Bid placed at (${msg.auction.x},${msg.auction.y}) — escrow $${msg.auction.currentBid.toLocaleString()}.`);
          // Refresh the auctions list so the new state lands cleanly.
          client.send({ kind: 'list-lot-auctions' });
          break;
        }
        case 'lot-outbid': {
          const t = get().team;
          if (t) set({ team: { ...t, money: msg.newMoney } });
          pushToast('warn', `Outbid at (${msg.x},${msg.y}) — escrow refunded $${msg.refund.toLocaleString()}.`);
          client.send({ kind: 'list-lot-auctions' });
          break;
        }
        case 'lot-auction-won': {
          const t = get().team;
          if (t) set({ team: { ...t, money: msg.newMoney } });
          pushToast('success', `🏆 You won lot (${msg.lot.x},${msg.lot.y})!`);
          client.send({ kind: 'list-lot-auctions' });
          client.send({ kind: 'list-my-lots' });
          break;
        }
        case 'lot-auction-lost': {
          const t = get().team;
          if (t) set({ team: { ...t, money: msg.newMoney } });
          pushToast('warn', `Auction at (${msg.x},${msg.y}) ended — escrow refunded $${msg.refund.toLocaleString()}.`);
          client.send({ kind: 'list-lot-auctions' });
          break;
        }
        case 'lot-auction-update': {
          // Patch in place if we have it.
          const existing = get().lotAuctions;
          const idx = existing.findIndex((a) => a.id === msg.auction.id);
          if (idx >= 0) {
            // endsAt=0 means "this auction closed" — drop it.
            if (msg.auction.endsAt === 0) {
              set({ lotAuctions: existing.filter((_, i) => i !== idx) });
            } else {
              const next = existing.slice();
              next[idx] = msg.auction;
              set({ lotAuctions: next });
            }
          } else if (msg.auction.endsAt > 0) {
            set({ lotAuctions: [...existing, msg.auction] });
          }
          break;
        }
        case 'lot-updated': {
          const t = get().team;
          if (t) set({ team: { ...t, money: msg.newMoney } });
          // If the modal is currently viewing this lot, refresh it.
          if (get().viewingLot?.id === msg.lot.id) set({ viewingLot: msg.lot });
          // My-lots list might need a tier color refresh.
          client.send({ kind: 'list-my-lots' });
          break;
        }
        case 'lot-leaderboard': {
          set({ lotLeaderboard: msg.entries });
          break;
        }
        case 'team-deleted-by-admin': {
          pushToast('warn', 'Your team was removed by an admin.');
          set({ team: null, players: {}, screen: 'create-team' });
          break;
        }
        case 'error':
          // errorBanner is only rendered on the connect / create-team screens.
          // For in-app errors (duel cap, refill cap, insufficient funds, etc.)
          // also push a toast so the user actually sees what went wrong.
          set({ errorBanner: msg.message, duelPending: false, skipPending: false });
          if (get().screen !== 'connect' && get().screen !== 'create-team') {
            pushToast('error', msg.message);
          }
          break;
        case 'pong':
          break;
      }
    }

    function pushToast(kind: OnlineToast['kind'], text: string): void {
      const toast: OnlineToast = { id: nextToastId++, kind, text };
      set({ toasts: [...get().toasts, toast] });
      // Auto-dismiss after 5s.
      setTimeout(() => {
        set({ toasts: get().toasts.filter((t) => t.id !== toast.id) });
      }, 5000);
    }
  },

  disconnect() {
    get().client?.close();
    set({
      client: null,
      status: 'closed',
      team: null,
      players: {},
      sessionToken: null,
      isAdmin: false,
      adminUsers: [],
      screen: 'connect',
      errorBanner: null,
    });
  },

  createTeam(name, tag, region) {
    get().client?.send({ kind: 'create-team', name, tag, region });
  },

  // ----- Daily bonus + cases -----
  claimDailyBonus() {
    get().client?.send({ kind: 'claim-daily-bonus' });
  },
  refillDuels() {
    get().client?.send({ kind: 'refill-duels' });
  },
  renewContract(playerId) {
    get().client?.send({ kind: 'renew-contract', playerId });
  },
  releasePlayer(playerId) {
    get().client?.send({ kind: 'release-player', playerId });
  },
  bookMassage() {
    get().client?.send({ kind: 'book-massage' });
  },
  dismissMassageReveal() {
    set({ massageReveal: null });
  },
  playMoraleGame(choice) {
    get().client?.send({ kind: 'play-morale-game', choice });
  },
  playDragonGate(bet) {
    get().client?.send({ kind: 'play-dragon-gate', bet });
  },
  startCrash(bet) {
    get().client?.send({ kind: 'start-crash', bet });
  },
  cashoutCrash() {
    const active = get().crashActive;
    if (!active) return;
    get().client?.send({ kind: 'cashout-crash', sessionId: active.sessionId });
  },
  startMines(bet, mineCount) {
    get().client?.send({ kind: 'start-mines', bet, mineCount });
  },
  pickMineTile(tileIndex) {
    const active = get().minesActive;
    if (!active) return;
    get().client?.send({ kind: 'pick-mine-tile', sessionId: active.sessionId, tileIndex });
  },
  cashoutMines() {
    const active = get().minesActive;
    if (!active) return;
    get().client?.send({ kind: 'cashout-mines', sessionId: active.sessionId });
  },
  streamPlayer(playerId) {
    get().client?.send({ kind: 'stream-player', playerId });
  },
  dismissStreamReveal() {
    set({ streamReveal: null });
  },
  listCases() {
    get().client?.send({ kind: 'list-cases' });
  },
  openCase(caseId) {
    get().client?.send({ kind: 'open-case', caseId });
  },
  openFreeCase() {
    get().client?.send({ kind: 'open-free-case' });
  },
  listSkins() {
    get().client?.send({ kind: 'list-skins' });
  },
  sellSkin(skinId) {
    get().client?.send({ kind: 'sell-skin', skinId });
  },
  dismissCaseOpening() {
    set({ caseOpening: null });
  },
  refreshSkinMarket() {
    get().client?.send({ kind: 'list-skin-market' });
  },
  listSkinForSale(skinInstanceId, askingPrice) {
    get().client?.send({ kind: 'list-skin', skinInstanceId, askingPrice });
  },
  unlistSkin(listingId) {
    get().client?.send({ kind: 'unlist-skin', listingId });
  },
  buySkinListing(listingId) {
    get().client?.send({ kind: 'buy-skin-listing', listingId });
  },
  tradeUpSkins(skinInstanceIds) {
    get().client?.send({ kind: 'trade-up-skins', skinInstanceIds });
  },
  dismissTradeUpReveal() {
    set({ tradeUpReveal: null });
  },

  // ----- Boosters -----
  listBoosts() {
    get().client?.send({ kind: 'list-boosts' });
  },
  buyBoostPack() {
    get().client?.send({ kind: 'buy-boost-pack' });
  },
  applyBoost(cardId, playerId) {
    get().client?.send({ kind: 'apply-boost', cardId, playerId });
  },
  discardBoost(cardId) {
    get().client?.send({ kind: 'discard-boost', cardId });
  },
  dismissBoostReveal() {
    set({ boostReveal: null });
  },

  // ----- Admin actions -----
  adminListUsers() {
    get().client?.send({ kind: 'admin-list-users' });
  },
  adminResetPin(nickname, newPin) {
    get().client?.send({ kind: 'admin-reset-pin', nickname, newPin });
  },
  adminEditTeam(teamId, fields) {
    get().client?.send({ kind: 'admin-edit-team', teamId, fields });
  },
  adminAdjustMoney(teamId, delta, note) {
    get().client?.send({ kind: 'admin-adjust-money', teamId, delta, note });
  },
  adminDeleteTeam(teamId) {
    get().client?.send({ kind: 'admin-delete-team', teamId });
  },

  spawnInitialRoster() {
    get().client?.send({ kind: 'spawn-initial-players' });
  },

  refreshState() {
    get().client?.send({ kind: 'refresh-state' });
  },

  clearError() {
    set({ errorBanner: null });
  },

  go(screen) {
    set({ screen });
  },

  registerAiDuel(stake, format) {
    if (get().duelPending) return;
    set({ duelPending: true, errorBanner: null });
    get().client?.send({ kind: 'register-ai-duel', stake, format });
  },

  dismissDuelResult() {
    set({ duelResult: null });
  },

  timeSkip(days) {
    if (get().skipPending) return;
    set({ skipPending: true, errorBanner: null });
    get().client?.send({ kind: 'time-skip', days });
  },

  refreshMarket() {
    get().client?.send({ kind: 'list-market' });
  },

  listPlayer(playerId, askingPrice) {
    get().client?.send({ kind: 'list-player', playerId, askingPrice });
  },

  unlistPlayer(listingId) {
    get().client?.send({ kind: 'unlist-player', listingId });
  },

  buyListedPlayer(listingId) {
    get().client?.send({ kind: 'buy-listed-player', listingId });
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  refreshFreeAgents() {
    get().client?.send({ kind: 'list-free-agents' });
  },

  signFreeAgent(playerId, wage) {
    get().client?.send({ kind: 'sign-free-agent', playerId, wage });
  },

  mintFreeAgent() {
    get().client?.send({ kind: 'mint-free-agent' });
  },
  dismissScoutReveal() {
    set({ scoutReveal: null });
  },

  refreshChallenges() {
    get().client?.send({ kind: 'list-challenges' });
  },

  postChallenge(stake, format, message) {
    get().client?.send({ kind: 'post-challenge', stake, format, message });
  },

  findAsyncMatch(stake) {
    set({ duelPending: true, errorBanner: null });
    get().client?.send({ kind: 'find-async-match', stake });
  },
  fetchTeamProfile(teamId) {
    set({ teamProfileLoading: teamId });
    get().client?.send({ kind: 'fetch-team-profile', teamId });
  },
  dismissTeamProfile() {
    set({ viewingTeamProfile: null });
  },
  viewPlayer(playerId) {
    set({ viewingPlayerId: playerId });
  },
  dismissPlayer() {
    set({ viewingPlayerId: null });
  },
  refreshQuests() {
    get().client?.send({ kind: 'list-quests' });
  },
  claimQuest(questId) {
    get().client?.send({ kind: 'claim-quest', questId });
  },
  claimAllDoneBonus() {
    get().client?.send({ kind: 'claim-all-done-bonus' });
  },
  drainPendingDuelResult() {
    const pending = get().pendingDuelResult;
    if (!pending) return;
    set({
      duelResult: pending,
      pendingDuelResult: null,
      liveReplay: null,
      screen: 'home',
    });
  },

  cancelChallenge(challengeId) {
    get().client?.send({ kind: 'cancel-challenge', challengeId });
  },

  acceptChallenge(challengeId) {
    set({ duelPending: true, errorBanner: null });
    get().client?.send({ kind: 'accept-challenge', challengeId });
  },

  refreshHistory() {
    get().client?.send({ kind: 'list-history' });
  },

  watchMatch(matchId) {
    get().client?.send({ kind: 'fetch-match', matchId });
  },

  closeViewer() {
    set({ viewing: null, screen: 'history' });
  },

  setTactics(tactics) {
    get().client?.send({ kind: 'set-tactics', tactics });
  },

  reorderLineup(playerIds) {
    get().client?.send({ kind: 'reorder-lineup', playerIds });
  },

  refreshLeaderboard() {
    get().client?.send({ kind: 'list-leaderboard' });
  },

  refreshRankedLeaderboard() {
    get().client?.send({ kind: 'list-ranked-leaderboard' });
  },

  fetchLiveReplay(matchId) {
    get().client?.send({ kind: 'fetch-live-replay', matchId });
  },

  closeReplay() {
    set({ liveReplay: null, screen: 'home' });
  },

  dismissDevReport() {
    set({ showDevReport: false });
  },

  toggleChat() {
    const isOpen = !get().chatOpen;
    set({ chatOpen: isOpen });
    if (isOpen) get().client?.send({ kind: 'fetch-chat-history', channel: get().chatChannel });
  },

  fetchChatHistory(channel) {
    get().client?.send({ kind: 'fetch-chat-history', channel: channel ?? get().chatChannel });
  },

  sendChat(text) {
    if (!text.trim()) return;
    get().client?.send({ kind: 'send-chat', text, channel: get().chatChannel });
  },

  setChatChannel(channel) {
    set({ chatChannel: channel, chatHistory: [] });
    get().client?.send({ kind: 'fetch-chat-history', channel });
  },

  refreshTournaments() {
    get().client?.send({ kind: 'list-tournaments' });
  },

  createTournament(size, entryFee) {
    get().client?.send({ kind: 'create-tournament', size, entryFee });
  },

  registerTournament(tournamentId) {
    get().client?.send({ kind: 'register-tournament', tournamentId });
  },

  fetchTournamentDetail(tournamentId) {
    get().client?.send({ kind: 'fetch-tournament-detail', tournamentId });
  },

  toggleLiveFeed() {
    set({ liveFeedOpen: !get().liveFeedOpen });
  },

  setPlayerGoal(playerId, attr, target) {
    get().client?.send({ kind: 'set-player-goal', playerId, attr, target });
  },

  clearPlayerGoal(playerId, attr) {
    get().client?.send({ kind: 'clear-player-goal', playerId, attr });
  },

  refreshGoals() {
    get().client?.send({ kind: 'list-player-goals' });
  },

  saveTacticsPreset(name) {
    get().client?.send({ kind: 'save-tactics-preset', name });
  },

  listTacticsPresets() {
    get().client?.send({ kind: 'list-tactics-presets' });
  },

  applyTacticsPreset(presetId) {
    get().client?.send({ kind: 'apply-tactics-preset', presetId });
  },

  deleteTacticsPreset(presetId) {
    get().client?.send({ kind: 'delete-tactics-preset', presetId });
  },

  fetchNews() {
    get().client?.send({ kind: 'fetch-news' });
  },

  listOnlineTeams() {
    get().client?.send({ kind: 'list-online-teams' });
  },

  exportTeam() {
    get().client?.send({ kind: 'export-team' });
  },

  importTeam(payload) {
    get().client?.send({ kind: 'import-team', payload });
  },

  listAchievements() {
    get().client?.send({ kind: 'list-achievements' });
  },

  updateProfile(fields) {
    get().client?.send({ kind: 'update-profile', fields });
  },

  offerLoan(toTeamId, playerId, fee, days) {
    get().client?.send({ kind: 'offer-loan', toTeamId, playerId, fee, days });
  },

  listLoanOffers() {
    get().client?.send({ kind: 'list-loan-offers' });
  },

  acceptLoan(loanId) {
    get().client?.send({ kind: 'accept-loan', loanId });
  },

  declineLoan(loanId) {
    get().client?.send({ kind: 'decline-loan', loanId });
  },

  recallLoan(loanId) {
    get().client?.send({ kind: 'recall-loan', loanId });
  },

  listHof() {
    get().client?.send({ kind: 'list-hof' });
  },

  listCoaches() {
    get().client?.send({ kind: 'list-coaches' });
  },

  hireCoach(coachId) {
    get().client?.send({ kind: 'hire-coach', coachId });
  },

  fireCoach() {
    get().client?.send({ kind: 'fire-coach' });
  },

  listSponsors() {
    get().client?.send({ kind: 'list-sponsors' });
  },

  respondSponsor(sponsorId, accept) {
    get().client?.send({ kind: 'respond-sponsor', sponsorId, accept });
  },

  refreshAiBets() {
    get().client?.send({ kind: 'list-ai-bets' });
  },

  refreshAiBetHistory() {
    get().client?.send({ kind: 'list-my-ai-bet-history' });
  },

  placeAiBet(cardId, side, stake) {
    get().client?.send({ kind: 'place-ai-bet', cardId, side, stake });
  },

  fetchAiBetReplay(cardId) {
    get().client?.send({ kind: 'fetch-ai-bet-replay', cardId });
  },

  fetchAiBetTeam(cardId, side) {
    get().client?.send({ kind: 'fetch-ai-bet-team', cardId, side });
  },
  dismissAiBetTeam() {
    set({ aiBetTeamView: null });
  },
  endAiBetReplay() {
    set({ aiBetReplayLocked: false, liveReplay: null, screen: 'ai-bets' });
  },

  // Real estate
  fetchLotMap(x0, y0, x1, y1) {
    get().client?.send({ kind: 'list-lot-map', x0, y0, x1, y1 });
  },
  fetchLotAuctions() {
    get().client?.send({ kind: 'list-lot-auctions' });
  },
  fetchMyLots() {
    get().client?.send({ kind: 'list-my-lots' });
  },
  fetchLotDetail(x, y) {
    get().client?.send({ kind: 'fetch-lot-detail', x, y });
  },
  dismissLotDetail() {
    set({ viewingLot: null });
  },
  placeLotBid(x, y, amount) {
    get().client?.send({ kind: 'place-lot-bid', x, y, amount });
  },
  upgradeLotApartment(lotId, toTier) {
    get().client?.send({ kind: 'upgrade-lot-apartment', lotId, toTier });
  },
  buyLotCar(lotId, carId) {
    get().client?.send({ kind: 'buy-lot-car', lotId, carId });
  },
  sellLotCar(lotId, lotCarId) {
    get().client?.send({ kind: 'sell-lot-car', lotId, lotCarId });
  },
  buyLotLuxury(lotId, itemId) {
    get().client?.send({ kind: 'buy-lot-luxury', lotId, itemId });
  },
  sellLotLuxury(lotId, lotLuxuryId) {
    get().client?.send({ kind: 'sell-lot-luxury', lotId, lotLuxuryId });
  },
  lotVaultDeposit(lotId, amount) {
    get().client?.send({ kind: 'lot-vault-deposit', lotId, amount });
  },
  lotVaultWithdraw(lotId, amount) {
    get().client?.send({ kind: 'lot-vault-withdraw', lotId, amount });
  },
  assignLotResident(lotId, playerId) {
    get().client?.send({ kind: 'lot-assign-resident', lotId, playerId });
  },
  evictLotResident(lotId, playerId) {
    get().client?.send({ kind: 'lot-evict-resident', lotId, playerId });
  },
  fetchLotLeaderboard() {
    get().client?.send({ kind: 'list-lot-leaderboard' });
  },
  collectLotInterest(lotId) {
    get().client?.send({ kind: 'collect-lot-interest', lotId });
  },
}));
