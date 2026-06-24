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
  LiveFeedEntry,
  LoanOffer,
  ActiveBoostWire,
  AdminTeamEditFields,
  AdminUserRow,
  BoostCard,
  CaseSummary,
  MarketListing,
  MatchHistoryEntry,
  MintTier,
  MyStandings,
  NewsItem,
  SkinInstanceWire,
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
} from './protocol';
import type { ConnectionStatus, OnlineClient } from './wsClient';
import { connect } from './wsClient';

export type OnlineScreen = 'connect' | 'create-team' | 'home' | 'squad' | 'market' | 'challenges' | 'history' | 'viewer' | 'tactics' | 'leaderboard' | 'tournaments' | 'replay' | 'admin' | 'cases' | 'boosters';

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
  viewing: { matchId: string; result: MatchResult } | null;

  // ----- leaderboard (Phase 4) -----
  leaderboardSeason: SeasonInfo | null;
  leaderboardRows: LeaderboardRow[];
  myStandings: MyStandings | null;

  // ----- Phase 5: live replay, chat, tournaments, dev arcs -----
  /** Most recent dev-arc payload (used to drive the growth-report modal). */
  lastDevChanges: DevChange[];
  showDevReport: boolean;
  /** Latest live-replay frames cached server-side — null if expired. */
  liveReplay: { matchId: string; result: import('../types').MatchResult } | null;
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

  // ----- Daily duel cap -----
  /** Duels used today (resets at 00:00 UTC). */
  duelsUsed: number;
  /** Extra slots purchased today. Total cap = DAILY_DUEL_CAP + duelsExtra. */
  duelsExtra: number;

  // ----- Wall-clock auto-advance -----
  /** UTC ms of the next 4-hour boundary, when team.day will auto-tick +1. */
  nextTickUtcMs: number;

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
  buyExtraDuel: () => void;
  listCases: () => void;
  openCase: (caseId: string) => void;
  openFreeCase: () => void;
  listSkins: () => void;
  sellSkin: (skinId: string) => void;
  dismissCaseOpening: () => void;
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
  mintFreeAgent: (tier: MintTier) => void;
  refreshChallenges: () => void;
  postChallenge: (stake: number, format: MatchFormat, message?: string) => void;
  cancelChallenge: (challengeId: string) => void;
  acceptChallenge: (challengeId: string) => void;
  refreshHistory: () => void;
  watchMatch: (matchId: string) => void;
  closeViewer: () => void;

  // Phase 4 actions
  setTactics: (tactics: Partial<Tactics>) => void;
  reorderLineup: (playerIds: string[]) => void;
  refreshLeaderboard: () => void;

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
  // Phase 9 actions
  listHof: () => void;
  listCoaches: () => void;
  hireCoach: (coachId: string) => void;
  fireCoach: () => void;
  listSponsors: () => void;
  respondSponsor: (sponsorId: string, accept: boolean) => void;
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
  duelsUsed: 0,
  duelsExtra: 0,
  nextTickUtcMs: 0,
  boosts: [],
  activeBoosts: {},
  boostReveal: null,
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
    });
    set({ client });

    // Send hello as soon as the socket opens — wsClient buffers messages
    // queued before that point, so this is safe to call immediately.
    client.send({ kind: 'hello', nickname, pin });

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
          set({
            team: msg.team,
            players,
            dailyBonusAvailable: msg.dailyBonusAvailable,
            freeCaseAvailable: msg.freeCaseAvailable,
            duelsUsed: msg.duelsUsed,
            duelsExtra: msg.duelsExtra,
            nextTickUtcMs: msg.nextTickUtcMs,
          });
          break;
        }
        case 'duel-result': {
          // Apply money delta optimistically and stash the result for the modal.
          const team = get().team;
          set({
            duelResult: msg.outcome,
            duelPending: false,
            team: team ? { ...team, money: msg.outcome.newMoney } : team,
          });
          pushToast(
            msg.outcome.moneyDelta > 0 ? 'success' : 'warn',
            msg.outcome.summary,
          );
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
        case 'free-agent-minted': {
          pushToast(
            'success',
            `Scout report in — ${msg.player.nickname} (PA ${msg.player.potentialAbility}) joined the market for $${msg.cost.toLocaleString()}.`,
          );
          client.send({ kind: 'refresh-state' });
          client.send({ kind: 'list-free-agents' });
          break;
        }
        case 'history': {
          set({ history: msg.matches });
          break;
        }
        case 'match-detail': {
          set({ viewing: { matchId: msg.matchId, result: msg.result }, screen: 'viewer' });
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
          });
          break;
        }
        case 'live-replay': {
          set({ liveReplay: { matchId: msg.matchId, result: msg.result }, screen: 'replay' });
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
          pushToast('success', msg.achievement.label ?? `🏅 Achievement: ${msg.achievement.kind}`);
          set({ achievements: [...get().achievements.filter((a) => a.kind !== msg.achievement.kind), msg.achievement] });
          break;
        }
        case 'profile-updated': {
          set({ team: msg.team });
          pushToast('success', 'Profile saved.');
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
        case 'extra-duel-purchased': {
          const t = get().team;
          set({
            team: t ? { ...t, money: msg.newMoney } : t,
            duelsExtra: msg.extra,
          });
          pushToast('success', `Bought an extra duel slot ($${msg.cost.toLocaleString()}). ${msg.remaining} duel${msg.remaining === 1 ? '' : 's'} left today.`);
          break;
        }
        case 'duel-stats': {
          set({ duelsUsed: msg.used, duelsExtra: msg.extra });
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
          pushToast('info', `Admin adjusted your cash → $${msg.money.toLocaleString()}.`);
          break;
        }
        case 'team-deleted-by-admin': {
          pushToast('warn', 'Your team was removed by an admin.');
          set({ team: null, players: {}, screen: 'create-team' });
          break;
        }
        case 'error':
          set({ errorBanner: msg.message, duelPending: false, skipPending: false });
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
  buyExtraDuel() {
    get().client?.send({ kind: 'buy-extra-duel' });
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

  mintFreeAgent(tier) {
    get().client?.send({ kind: 'mint-free-agent', tier });
  },

  refreshChallenges() {
    get().client?.send({ kind: 'list-challenges' });
  },

  postChallenge(stake, format, message) {
    get().client?.send({ kind: 'post-challenge', stake, format, message });
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
}));
