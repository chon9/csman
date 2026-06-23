import { create } from 'zustand';
import type {
  GameState,
  InboxMessage,
  MapName,
  MapTactics,
  MatchPlan,
  MatchResult,
  Player,
  PlayerRole,
  RoleDuty,
  RoleSlot,
  ScheduledMatch,
  TacticalCall,
  Tactics,
  Team,
  Tournament,
  TrainingSetup,
  TransferOffer,
} from '../types';
import { DEFAULT_TACTICS, DEFAULT_MATCH_PLAN, ALL_MAPS } from '../types';
import { buildInitialDatabase } from '../data/database';
import { generateFreeAgentPool } from '../data/faPool';
import { MAP_LAYOUTS } from '../data/maps';
import { generateSeasonTournaments, inviteByRanking, addDays } from '../sim/calendar';
import {
  initTournamentState,
  startTournament,
  progressTournament,
  prizeFor,
  pointsFor,
} from '../sim/competition';
import {
  applyMatchAftermath,
  dailyPlayerTick,
  applyWeeklyTraining,
  monthlyDevelopment,
  processMonthlyFinances,
  generateAiOffers,
  aiToAiTransfers,
  recomputeRankings,
} from '../sim/daily';
import { attemptRetirements, generateYouthIntake, pruneStaleState } from '../sim/rosterLifecycle';
import { computeSeasonAwards, isPlayerAward, AWARD_LABEL } from '../sim/awards';
import { generateInitialRelationships, refreshRelationships, applyMonthlyRelationshipEffects, mentorBoostFor } from '../sim/relationships';
import {
  listSlots,
  readSlot,
  writeSlot,
  makeSlotId,
  setActiveSlotId,
  getActiveSlotId,
  hasAnySave,
  mostRecentSlotId,
} from './saveStorage';
import type { SaveSlotMeta } from './saveStorage';
import { getOrCreateManager, saveManager } from './managerStorage';
import {
  generateMonthlyJobOffers,
  generateReboundOffer,
  shouldSack,
} from '../sim/jobMarket';
import { openCase as openCaseSim, openSouvenirPackage as openSouvenirSim, tradeUpContract } from '../sim/caseOpening';
import { CASES, DAILY_FREE_CASE_ID } from '../data/cs2Cases';
import { decimalOdds, isBettable } from '../sim/sportsbook';
import { aiFreeAgentScramble, aiRosterTurnover } from '../sim/aiManager';
import { simulateYouthMatch } from '../sim/youthMatches';
import { rollOrgBankruptcy } from '../sim/orgEvents';
import { rollCheatAllegation, processCheatScandals, isPlayerBanned } from '../sim/cheatScandal';
import { generateSeasonMandates, processMandates, adjustConfidence, driftConfidence } from '../sim/boardMandate';
import {
  applyManagerChampionship,
  applyManagerPostMatchBounceback,
  applyManagerSeasonReview,
  mentorBoostMult,
  scoutAccuracyMult,
} from '../sim/managerEffects';
import { buildInitialStaffPool, staffForRole } from '../data/staffPool';
import {
  seedInitialSponsors,
  processSponsorExpiry,
  payPerformanceBonus,
  rollSponsorOffer,
  applySponsorOffer,
} from '../sim/sponsorship';
import {
  initBoardState,
  evaluateObjectives,
  finaliseObjectives,
  bumpConfidence,
  generateSeasonObjectives,
} from '../sim/board';
import {
  maybeSchedulePreMatchPress,
  maybeSchedulePostMatchPress,
  applyPressAnswer,
  rollPlayerConcern,
  applyConcernResponse,
} from '../sim/pressAndConcerns';
import {
  agentFor,
  applySellOnPayout,
  clubValuation,
  evaluateClubFee,
  evaluatePersonalTerms,
  maybeRivalBid,
  playerWageDemand,
} from '../sim/negotiation';
import type { LoanDeal, PersonalTerms, Staff, StaffRole } from '../types';
import {
  simulateMatch,
  startSeries,
  playNextSeriesMap,
  resimulateMapFromRound,
  seriesDecided,
  seriesResult,
  type EngineTeam,
  type SeriesState,
} from '../engine/matchEngine';
import { RNG, hashSeed } from '../engine/rng';
import { play as playSound } from '../sound/soundManager';
import {
  seedNewsAuthors,
  ensureNewsAuthors,
  postsForMatch,
  postsForTransfer,
  postsForChampion,
  postsForSponsor,
  postsForRetirement,
  pushPostInjury,
  rollIdleRumor,
  rollSponsorAnnouncement,
} from '../sim/news';

const SEASON_START = '-01-05';
// Legacy single-key. Multi-slot saves use saveStorage. Kept as a constant for
// the LoadSaveScreen export/import fallback path during migration.
const SAVE_KEY = 'cs2manager-save';

// Module-scope tracker for the currently-active slot. Set on newGame + loadGame,
// read on saveGame so saves go to the right slot.
let activeSlotId: string | null = null;

export type Screen =
  | 'home'
  | 'squad'
  | 'tactics'
  | 'schedule'
  | 'rankings'
  | 'tournament'
  | 'transfers'
  | 'training'
  | 'staff'
  | 'finances'
  | 'scouting'
  | 'inbox'
  | 'matchday'
  | 'player'
  | 'history'
  | 'news'
  | 'manager'
  | 'halloffame'
  | 'cases'
  | 'sportsbook'
  | 'teamprofile'
  | 'mods';

interface UIState {
  screen: Screen;
  selectedPlayerId: string | null;
  selectedTournamentId: string | null;
  selectedTeamId: string | null;
  liveMatch: MatchResult | null; // full frames, for the viewer
  liveMatchScheduledId: string | null;
  liveMatchConfirmed: boolean;
}

interface Actions {
  newGame(
    userTeamId: string,
    saveName: string,
    manager?: { name: string; nationality: string; style: import('../types').ManagerStyle },
  ): void;
  saveGame(): void;
  /** Load a specific save slot. If no slotId is passed, loads the most recent. */
  loadGame(slotId?: string): boolean;
  hasSave(): boolean;
  /** List all available save slots, most recent first. */
  listSaves(): SaveSlotMeta[];
  // navigation
  go(screen: Screen): void;
  openPlayer(id: string): void;
  openTeam(id: string): void;
  openTournament(id: string): void;
  // core loop
  advanceDay(): void;
  userMatchToday(): ScheduledMatch | null;
  playUserMatch(): void;
  playNextMap(): void;
  seriesIsDecided(): boolean;
  confirmUserMatch(): void;
  interactPlayer(playerId: string, kind: 'praise' | 'criticize'): void;
  // management
  setTactics(t: Tactics): void;
  setMapOverride(map: MapName, override: Partial<MapTactics> | null): void;
  toggleStratEnabled(map: MapName, stratName: string, allStratNames: string[]): void;
  setRoleSlot(idx: number, patch: Partial<RoleSlot>): void;
  /** Override slot `idx`'s lineup player for the NEXT user match only. Pass
   *  null to revert that slot to the roleSlot default. Cleared after the
   *  match starts. */
  setPendingLineupSlot(idx: number, playerId: string | null): void;
  /** Deliver a pre-match dressing-room talk. Applies morale/form deltas to
   *  the starting 5 based on tone + squad composure. One-shot per matchday. */
  giveTeamTalk(tone: import('../types').TeamTalkTone): void;
  swapRoleSlotPlayers(idxA: number, idxB: number): void;
  setMatchPlan(opponentTeamId: string, patch: Partial<MatchPlan>): void;
  queueCall(call: TacticalCall): void;
  removeCall(call: TacticalCall): void;
  clearCalls(): void;
  setScoutHours(teamId: string, hours: number): void;
  suggestCounter(opponentTeamId: string): void;
  hireStaff(staffId: string): void;
  releaseStaff(staffId: string): void;
  acceptSponsorOffer(offerId: string): void;
  rejectSponsorOffer(offerId: string): void;
  answerPress(conferenceId: string, questionId: string, optionIndex: number): void;
  respondToConcern(concernId: string, optionIndex: number): void;
  scheduleScrimmage(opponentTeamId: string, map: MapName): void;
  setPlayerFocus(playerId: string, focus: import('../types').IndividualFocus): void;
  /** Set or clear the role the player is being developed toward. Null clears. */
  setPlayerDevelopmentTarget(playerId: string, target: import('../types').PlayerRole | null): void;
  setTraining(t: TrainingSetup): void;
  setActiveFive(ids: string[]): void;
  listPlayer(id: string, listed: boolean): void;
  respondOffer(offerId: string, accept: boolean): void;
  /** Counter an incoming offer at a higher fee — bidder AI accepts, counters back, or walks. */
  counterIncomingOffer(offerId: string, counterFee: number): void;
  bidForPlayer(playerId: string, fee: number): void;
  signFreeAgent(playerId: string, wage: number): void;
  // ----- FM-style two-stage negotiation -----
  submitBid(playerId: string, fee: number): void;
  acceptCounter(offerId: string): void;
  counterBack(offerId: string, newFee: number): void;
  submitPersonalTerms(offerId: string, terms: PersonalTerms): void;
  withdrawBid(offerId: string): void;
  triggerBuyout(playerId: string): void;
  matchRivalBid(offerId: string): void;
  // ----- Loans -----
  loanOut(playerId: string, toTeamId: string, months: number, wageContribution: number): void;
  recallLoan(loanId: string): void;
  releasePlayer(playerId: string): void;
  renewContract(playerId: string, wage: number, years: number): void;
  scoutPlayer(playerId: string): void;
  markInboxRead(id: string): void;
  markAllRead(): void;
  /** Mid-map tactical timeout: re-simulates remaining rounds with updated tactics + calls. */
  callTimeout(fromRoundIdx: number): { ok: boolean; remaining: number; error?: string };
  /** How many tactical timeouts the user has left on the current map. */
  timeoutsRemaining(): number;
  /** Manager critical-moment call — applies a small morale/form delta to all user-team players. */
  applyManagerCall(call: 'rally' | 'calm' | 'aggressive'): void;
  /** Move a squad player between first-team / reserve / youth tiers. */
  setPlayerSquadTier(playerId: string, tier: 'first' | 'reserve' | 'youth'): void;
  // ----- CS2 case opening (manager-side gambling minigame) -----
  /** Open a case if the manager can afford the key. Returns the rolled
   *  SkinInstance + animation strip data, or null if it couldn't open. */
  openCase(caseId: string): import('../sim/caseOpening').OpenResult | null;
  /** Open the once-per-day free case. Returns null if already claimed today. */
  openDailyFreeCase(): import('../sim/caseOpening').OpenResult | null;
  /** Trade in 10 same-rarity skins for 1 of the next rarity. */
  tradeUp(skinIds: string[]): import('../types').SkinInstance | null;
  /** Open a pending Souvenir Package (awarded from Major wins). */
  openSouvenirPackage(): import('../types').SkinInstance | null;
  /** Sell a skin from the inventory at its current market value. */
  sellSkin(instanceId: string): void;
  // ----- Sportsbook (Bc Gaming) -----
  /** Place a bet on a future scheduled match. Locks odds at placement time. */
  placeBet(matchId: string, pickedTeamId: string, stake: number): import('../types').SportsbookBet | null;
  /** Cancel a pending bet — refunds the stake (only allowed while match is still scheduled). */
  cancelBet(betId: string): void;
  // ----- Manager job market -----
  /** Accept a pending job offer. Closes the current stint and switches userTeamId. */
  acceptManagerJobOffer(offerId: string): void;
  /** Decline a pending job offer (removes it from the pool). */
  declineManagerJobOffer(offerId: string): void;
  /** Resign from the current job. Opens a 7-day window before the rebound offer drops. */
  resignFromJob(): void;
  // ----- Mod / database editing -----
  editTeam(teamId: string, patch: Partial<import('../types').Team>): void;
  editPlayer(playerId: string, patch: Partial<import('../types').Player>): void;
  addCustomPlayer(player: import('../types').Player): void;
  addCustomTeam(team: import('../types').Team): void;
  removeCustomPlayer(playerId: string): void;
  removeCustomTeam(teamId: string): void;
  addCustomSponsor(sponsor: import('../types').Sponsor): void;
  editCustomSponsor(sponsorId: string, patch: Partial<import('../types').Sponsor>): void;
  removeCustomSponsor(sponsorId: string): void;
  exportModPack(): string;
  importModPack(json: string): { ok: boolean; error?: string };
}

export interface Store extends UIState, Actions {
  game: GameState | null;
}

// live series kept outside zustand: holds an RNG instance (not serialisable) and is per-session only
let liveSeries: SeriesState | null = null;

let nextMsgId = 0;
let nextOfferId = 0;

/** Short date helper for inbox messages. */
function fmtDateShort(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Cap the inbox to N messages. Drops oldest READ messages first; if still
 * over cap, drops oldest unread too. Prevents perf hits on long careers.
 */
function pruneInbox(g: GameState, max: number): void {
  if (g.inbox.length <= max) return;
  // Sort by date ascending — oldest first
  g.inbox.sort((a, b) => a.date.localeCompare(b.date));
  // First pass: drop oldest read until at or under cap
  while (g.inbox.length > max) {
    const oldestReadIdx = g.inbox.findIndex((m) => m.read);
    if (oldestReadIdx === -1) break;
    g.inbox.splice(oldestReadIdx, 1);
  }
  // Still over? Drop oldest regardless of read state
  if (g.inbox.length > max) {
    g.inbox = g.inbox.slice(g.inbox.length - max);
  }
}

/** Settle any sportsbook bets whose matches have finished. Credits stash on
 *  win, posts an inbox blurb, and caps the bet history to the most recent 80. */
function settleSportsbookBets(g: GameState): void {
  const bets = g.sportsbookBets ?? [];
  if (bets.length === 0) return;
  for (const bet of bets) {
    if (bet.status !== 'pending') continue;
    const sched = g.schedule.find((m) => m.id === bet.matchId);
    if (!sched || !sched.result) {
      // Match was removed (e.g. tournament regenerated) → void & refund.
      if (sched == null) {
        bet.status = 'void';
        bet.settledOn = g.currentDate;
        bet.payout = bet.stake;
        g.managerStash = (g.managerStash ?? 0) + bet.stake;
      }
      continue;
    }
    if (sched.status !== 'finished') continue;
    bet.settledOn = g.currentDate;
    const won = sched.result.winnerId === bet.pickedTeamId;
    if (won) {
      bet.status = 'won';
      bet.payout = bet.potentialPayout;
      g.managerStash = (g.managerStash ?? 0) + bet.potentialPayout;
      g.inbox.push({
        id: `msg-bet-won-${bet.id}`,
        date: g.currentDate,
        category: 'finance',
        subject: `🎯 Bet won: ${bet.pickedTeamTag} ${bet.teamATag === bet.pickedTeamTag ? 'beat' : 'beat'} ${bet.teamATag === bet.pickedTeamTag ? bet.teamBTag : bet.teamATag}`,
        body:
          `Your ${bet.stake.toLocaleString()} bet at ${bet.odds.toFixed(2)} on ${bet.pickedTeamTag} paid out $${bet.potentialPayout.toLocaleString()}.\n\nProfit: $${(bet.potentialPayout - bet.stake).toLocaleString()}. New stash: $${(g.managerStash ?? 0).toLocaleString()}.`,
        read: false,
      });
    } else {
      bet.status = 'lost';
      bet.payout = 0;
      g.inbox.push({
        id: `msg-bet-lost-${bet.id}`,
        date: g.currentDate,
        category: 'finance',
        subject: `❌ Bet lost: ${bet.pickedTeamTag} ${bet.teamATag === bet.pickedTeamTag ? bet.teamBTag : bet.teamATag}`,
        body: `Your $${bet.stake.toLocaleString()} bet on ${bet.pickedTeamTag} at ${bet.odds.toFixed(2)} odds didn't land.`,
        read: false,
      });
    }
  }
  // Cap history at 80 most-recent entries (drop oldest settled first).
  if (bets.length > 80) {
    const pending = bets.filter((b) => b.status === 'pending');
    const settled = bets
      .filter((b) => b.status !== 'pending')
      .sort((a, b) => (a.settledOn ?? '').localeCompare(b.settledOn ?? ''));
    const keep = settled.slice(Math.max(0, settled.length - (80 - pending.length)));
    g.sportsbookBets = [...pending, ...keep];
  }
}

/** After an AI club sells a player to the user, immediately scan the FA pool
 *  for a like-for-like replacement so the team doesn't keep playing short.
 *  Picks the best-CA free agent (within budget), preferring a role match.
 *  Also posts a news/inbox blurb when a replacement is signed. */
function replenishAISquad(
  g: GameState,
  teamId: string,
  vacantRole: PlayerRole | undefined,
  rng: RNG,
  date: string,
): void {
  const team = g.teams[teamId];
  if (!team || team.isUser) return;
  if (team.playerIds.length >= 5) return; // not actually short
  // Candidate FAs: not on any team, healthy, contract null OK.
  const candidates = Object.values(g.players).filter((p) => !p.teamId && !p.injury);
  if (candidates.length === 0) return;
  // Score: prefer role match (+30), then CA, soft cap on wage by team budget tier.
  const scored = candidates
    .map((p) => ({
      p,
      score: p.currentAbility + (vacantRole && p.role === vacantRole ? 30 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  // Wage they'd ask — keep it modest for AI sims.
  for (const { p } of scored.slice(0, 10)) {
    const wage = Math.max(8000, Math.round((p.currentAbility * 250) / 500) * 500);
    if (team.budget < wage * 6) continue; // need ~6 months of runway
    p.teamId = team.id;
    p.squadTier = p.age <= 19 ? 'youth' : p.currentAbility >= 110 ? 'first' : 'reserve';
    p.contract = {
      wage,
      expires: addDays(date, 365),
      buyout: Math.max(p.askingPrice, p.currentAbility * 4000),
    };
    p.clubHistory ??= [];
    if (p.clubHistory[p.clubHistory.length - 1]?.teamId !== team.id) {
      p.clubHistory.push({ teamId: team.id, teamName: team.name, joinedOn: date });
    }
    team.playerIds.push(p.id);
    g.inbox.push(
      msg(
        date,
        'transfer',
        `${team.name} sign ${p.nickname}`,
        `Free agent ${p.nickname} joins ${team.name} on a 1-year deal at $${wage.toLocaleString()}/mo, filling the gap left by their recent departure.`,
      ),
    );
    void rng;
    return;
  }
}

/** Daily sanity check: every team needs at least 5 HEALTHY players for a match,
 *  otherwise the engine builds a short-handed lineup. Counts non-injured roster,
 *  signs emergency FAs to fill any deficit. Catches the common case where a
 *  team had exactly 5 and someone got injured between matches. */
function ensureMatchReady(g: GameState, date: string): void {
  const candidatesCache: Player[] = Object.values(g.players).filter((p) => !p.teamId && !p.injury);
  if (candidatesCache.length === 0) return;
  for (const team of Object.values(g.teams)) {
    // Count healthy players currently on the roster.
    let healthy = 0;
    for (const id of team.playerIds) {
      const p = g.players[id];
      if (p && !p.injury) healthy++;
    }
    while (healthy < 5) {
      // Pick the best-available healthy FA still in the pool.
      const candidateIdx = candidatesCache.findIndex((p) => !p.teamId);
      if (candidateIdx === -1) break;
      // Re-sort each iteration by CA (cheap — pool shrinks fast).
      candidatesCache.sort((a, b) => b.currentAbility - a.currentAbility);
      const pick = candidatesCache.shift();
      if (!pick) break;
      const wage = Math.max(8000, Math.round((pick.currentAbility * 220) / 500) * 500);
      pick.teamId = team.id;
      pick.squadTier = pick.age <= 19 ? 'youth' : pick.currentAbility >= 110 ? 'first' : 'reserve';
      pick.contract = {
        wage,
        expires: addDays(date, 365),
        buyout: Math.max(pick.askingPrice, pick.currentAbility * 4000),
      };
      pick.clubHistory ??= [];
      if (pick.clubHistory[pick.clubHistory.length - 1]?.teamId !== team.id) {
        pick.clubHistory.push({ teamId: team.id, teamName: team.name, joinedOn: date });
      }
      team.playerIds.push(pick.id);
      team.budget = Math.max(0, team.budget - wage);
      healthy++;
      // Only notify the user when their own club had to scramble.
      if (team.isUser) {
        g.inbox.push(
          msg(
            date,
            'transfer',
            `Emergency signing: ${pick.nickname}`,
            `With the squad short of 5 fit players, the board fast-tracked ${pick.nickname} on a 1-year deal at $${wage.toLocaleString()}/mo so you can field a team today.`,
          ),
        );
      }
    }
    // Make sure tactics slots reflect the change for the user team.
    if (team.isUser && healthy >= 5) {
      syncRoleSlotsWithFirstTeam(g);
    }
  }
}

/** Append a club to the player's career history when they join a new team.
 *  Deduplicates against the most recent entry so re-loans / recalls don't spam. */
function appendClubHistory(p: Player, teamId: string, teamName: string, date: string): void {
  p.clubHistory ??= [];
  const last = p.clubHistory[p.clubHistory.length - 1];
  if (last && last.teamId === teamId) return;
  p.clubHistory.push({ teamId, teamName, joinedOn: date });
}

/** Human-readable label for a board objective type (used in inbox subjects). */
function objLabel(type: string): string {
  switch (type) {
    case 'win-major': return 'Win a Major';
    case 'finals': return 'Reach an S-tier final';
    case 'top-finish': return 'Top finish';
    case 'develop-youth': return 'Develop youth';
    case 'profit': return 'Stay profitable';
    case 'avoid-bottom': return 'Avoid the drop';
    case 'qualify-major': return 'Qualify for Majors';
    default: return type;
  }
}
function msg(date: string, category: InboxMessage['category'], subject: string, body: string): InboxMessage {
  return { id: `msg-${++nextMsgId}-${Date.now().toString(36)}`, date, category, subject, body, read: false };
}

/**
 * Compress a finished MatchResult before persisting it to matchHistory.
 * The live viewer needs frames / kills / full commentary, but once the match
 * is over only the scoreline + per-player stats are surfaced anywhere (Team
 * Profile recent results, H2H lookups, awards). The raw round data dwarfs
 * everything else in the save file — a single match can be 100s of KB of
 * frame + kill JSON, multiplied by 200 history entries that's tens of MB.
 *
 * This drops everything not used outside the live viewer.
 */
function stripFrames(result: MatchResult): MatchResult {
  return {
    ...result,
    maps: result.maps.map((m) => ({
      ...m,
      rounds: m.rounds.map((r) => ({
        ...r,
        frames: [],
        kills: [],
        commentary: [],
      })),
    })),
  };
}

/** Apply stripFrames to every entry already in matchHistory. Cheap on small
 *  histories, idempotent (no-op if everything's already stripped). */
function compactMatchHistory(history: MatchResult[]): MatchResult[] {
  return history.map((mr) => {
    const dirty = mr.maps.some((m) =>
      m.rounds.some((r) => (r.frames?.length ?? 0) > 0 || (r.kills?.length ?? 0) > 0 || (r.commentary?.length ?? 0) > 0),
    );
    return dirty ? stripFrames(mr) : mr;
  });
}

/** Drop finished matches older than `keepDays` (relative to `today`). Scheduled
 *  matches are always kept regardless of date. */
function pruneFinishedSchedule(
  schedule: ScheduledMatch[],
  today: string,
  keepDays: number,
): ScheduledMatch[] {
  const cutoff = addDays(today, -keepDays);
  return schedule.filter((m) => m.status !== 'finished' || m.date >= cutoff);
}

function aiTacticsFor(team: Team): Tactics {
  const rng = new RNG(hashSeed(team.id));
  const prof = [...team.mapPool].sort((a, b) => b.proficiency - a.proficiency).map((m) => m.map);
  return {
    ...DEFAULT_TACTICS,
    tPlaystyle: rng.pick(['default', 'explosive', 'slow-default', 'mixed'] as const),
    ctPlaystyle: rng.pick(['standard', 'aggressive-info', 'passive-retake', 'stacked-gambles'] as const),
    aggression: rng.int(7, 14),
    utilityUsage: rng.int(8, 16),
    midRoundFlexibility: rng.int(6, 16),
    ecoDiscipline: rng.int(8, 16),
    forceBuyTendency: rng.int(5, 13),
    mapVetoPriority: prof as MapName[],
  };
}

/**
 * Daily scouting accuracy tick. For each opponent with allocated hours, add
 * hours/100 to that team's report accuracy (so 10 hours/week = 0.1/day = 100% in 10 days).
 * Posts an inbox heads-up when a report crosses 25/50/75/100% reveal thresholds.
 */
function tickScoutingProgress(g: GameState, today: string): void {
  const allocs = g.scoutAllocations ?? {};
  const reports = (g.opponentScouts ??= {});
  // Analyst staff multiplies daily accuracy gain. No analyst = 1.0× baseline.
  const analyst = staffForRole(g, g.userTeamId, 'Analyst');
  const analystMul = analyst ? Math.max(0.6, Math.min(1.8, 0.5 + analyst.skill / 12)) : 1.0;
  // Manager 'judging talent' attribute scales scouting accuracy gains too.
  const judgeMul = scoutAccuracyMult(g);
  for (const [teamId, hours] of Object.entries(allocs)) {
    if (!hours || hours <= 0) continue;
    const team = g.teams[teamId];
    if (!team) continue;
    const before = reports[teamId]?.accuracy ?? 0;
    const after = Math.min(1, before + (hours / 100) * analystMul * judgeMul);
    reports[teamId] = { teamId, accuracy: after, lastUpdated: today };
    // Fire an inbox blurb when a threshold is crossed.
    const thresholds: { at: number; label: string }[] = [
      { at: 0.25, label: 'Map pool intel' },
      { at: 0.5, label: 'Playstyle ranges' },
      { at: 0.75, label: 'Tactical profile' },
      { at: 1.0, label: 'Full dossier' },
    ];
    for (const t of thresholds) {
      if (before < t.at && after >= t.at) {
        g.inbox.push(
          msg(
            today,
            'scouting',
            `Scouting report — ${team.name}`,
            `Analysts cleared the next layer of intel on ${team.name}: ${t.label}. ` +
              `Tactics → Match Plans is now sharper for this fixture.`,
          ),
        );
      }
    }
  }
}

/** Build the 5 default role slots from a team's starting roster (called on new game / squad reorder). */
/** Sync tactics.roleSlots with the current first-team squad. Clears any slot
 *  whose player is no longer first-team (or no longer on the squad/injured-out
 *  doesn't apply — injury is a temporary state). Then fills any empty slots
 *  with available first-team players, preferring a natural-role match. */
/** When the user explicitly promotes a player to first-team, make sure they
 *  actually land in the starting lineup — bumping the weakest existing slot
 *  occupant out if necessary. `promotedId` is the player who just got moved
 *  to first-team; the rest of the sync is the normal clear+fill pass. */
function syncRoleSlotsWithFirstTeam(g: GameState, promotedId?: string): void {
  if (!g.tactics.roleSlots || g.tactics.roleSlots.length === 0) return;
  const user = g.teams[g.userTeamId];
  if (!user) return;
  const firstTeamIds = new Set(
    user.playerIds.filter((id) => {
      const p = g.players[id];
      return p && (p.squadTier ?? 'first') === 'first';
    }),
  );
  const slots = g.tactics.roleSlots.map((s) => ({ ...s }));
  const usedInSlots = new Set<string>();
  // Pass 1: clear stale assignments (player no longer in first team or no longer on squad).
  for (const slot of slots) {
    if (slot.playerId && !firstTeamIds.has(slot.playerId)) {
      slot.playerId = null;
    }
    if (slot.playerId) usedInSlots.add(slot.playerId);
  }
  // Pass 2: pool of first-team players not currently in any slot.
  const pool = [...firstTeamIds]
    .filter((id) => !usedInSlots.has(id))
    .map((id) => g.players[id])
    .filter((p): p is Player => !!p);
  // Pass 3: for each empty slot, pick the best-matching player (natural role first).
  for (const slot of slots) {
    if (slot.playerId) continue;
    if (pool.length === 0) break;
    const natural = pool.findIndex((p) => p.role === slot.role);
    const pick = natural >= 0 ? pool.splice(natural, 1)[0] : pool.shift();
    if (pick) slot.playerId = pick.id;
  }
  // Pass 4 (explicit promotion): the user clicked "↑ First" on `promotedId`
  // and expects them to play. If they're still not slotted (all 5 were full),
  // bump the weakest current slot occupant out — preferring a same-role swap
  // so the lineup keeps tactical shape. The bumped player drops to reserves.
  if (promotedId && firstTeamIds.has(promotedId)) {
    const promotedPlayer = g.players[promotedId];
    const promotedSlotted = slots.some((s) => s.playerId === promotedId);
    if (promotedPlayer && !promotedSlotted) {
      // Prefer swapping with a same-role occupant if they're weaker (true upgrade
      // signal). Otherwise pick the lowest-CA occupant across all slots.
      let bumpIdx = -1;
      const sameRole = slots
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.role === promotedPlayer.role && s.playerId);
      if (sameRole.length > 0) {
        sameRole.sort(
          (a, b) =>
            (g.players[a.s.playerId!]?.currentAbility ?? 999) -
            (g.players[b.s.playerId!]?.currentAbility ?? 999),
        );
        bumpIdx = sameRole[0].i;
      } else {
        // Lowest CA across all slots.
        const byCa = slots
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.playerId)
          .sort(
            (a, b) =>
              (g.players[a.s.playerId!]?.currentAbility ?? 999) -
              (g.players[b.s.playerId!]?.currentAbility ?? 999),
          );
        if (byCa.length > 0) bumpIdx = byCa[0].i;
      }
      if (bumpIdx >= 0) {
        const bumpedId = slots[bumpIdx].playerId!;
        const bumpedPlayer = g.players[bumpedId];
        if (bumpedPlayer) bumpedPlayer.squadTier = 'reserve';
        slots[bumpIdx].playerId = promotedId;
      }
    }
  }
  g.tactics = { ...g.tactics, roleSlots: slots };
}

function initialRoleSlots(starting: Player[]): RoleSlot[] {
  const roles: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support'];
  const used = new Set<string>();
  return roles.map((role) => {
    const natural = starting.find((p) => p.role === role && !used.has(p.id));
    const fallback = starting.find((p) => !used.has(p.id));
    const pid = (natural ?? fallback)?.id ?? null;
    if (pid) used.add(pid);
    return { role, duty: 'balanced' as RoleDuty, playerId: pid };
  });
}

/**
 * Bake one-shot tactical calls into an EngineTeam: speed-up / slow-down shift
 * tPlaystyle + aggression, stack-a/b sets forceStackSite, push/hold modulates
 * aggression. Returns a NEW EngineTeam so we don't mutate game state.
 */
function applyCallsToTeam(team: EngineTeam, calls?: TacticalCall[]): EngineTeam {
  if (!calls || calls.length === 0) return team;
  const tactics: Tactics = { ...team.tactics };
  let forceStackSite = team.forceStackSite;
  for (const call of calls) {
    switch (call) {
      case 'speed-up':
        tactics.tPlaystyle = 'explosive';
        tactics.aggression = Math.min(20, tactics.aggression + 3);
        break;
      case 'slow-down':
        tactics.tPlaystyle = 'slow-default';
        tactics.aggression = Math.max(1, tactics.aggression - 3);
        break;
      case 'stack-a':
        forceStackSite = 'A';
        break;
      case 'stack-b':
        forceStackSite = 'B';
        break;
      case 'push':
        tactics.aggression = Math.min(20, tactics.aggression + 5);
        tactics.ctPlaystyle = 'aggressive-info';
        break;
      case 'hold':
        tactics.aggression = Math.max(1, tactics.aggression - 5);
        tactics.ctPlaystyle = 'passive-retake';
        break;
    }
  }
  return { ...team, tactics, forceStackSite };
}

function engineTeam(
  game: GameState,
  teamId: string,
  opponentTeamId?: string,
  calls?: TacticalCall[],
): EngineTeam {
  const team = game.teams[teamId];
  // Match eligibility: first-team players first, then fall through to reserves to
  // make a full five if needed. Youth never play unless explicitly promoted.
  // Injured players are skipped entirely — the team plays with whoever is fit.
  // Players serving a competitive ban (VAC / cheat scandal) are also ineligible.
  const allPlayers = team.playerIds
    .map((id) => game.players[id])
    .filter(
      (p): p is import('../types').Player =>
        !!p && !p.injury && !isPlayerBanned(game, p.id, game.currentDate),
    );
  const tierRank = (p: import('../types').Player): number => {
    const t = p.squadTier ?? 'first';
    return t === 'first' ? 0 : t === 'reserve' ? 1 : 2;
  };
  let players: import('../types').Player[];
  if (team.isUser && game.tactics.roleSlots) {
    // Per-match override (set via the pre-match lineup picker) takes priority
    // over the saved roleSlots. Lets the user sub in a reserve for one match
    // without permanently rewriting their tactics.
    const sourceIds =
      game.pendingLineup && game.pendingLineup.length === 5
        ? game.pendingLineup
        : game.tactics.roleSlots.map((s) => s.playerId ?? null);
    const slotPlayers = sourceIds
      .map((id) => (id ? game.players[id] : null))
      .filter((p): p is import('../types').Player => !!p && !p.injury);
    const used = new Set(slotPlayers.map((p) => p.id));
    const filler = allPlayers
      .filter((p) => !used.has(p.id))
      .sort((a, b) => tierRank(a) - tierRank(b));
    players = [...slotPlayers, ...filler].slice(0, 5);
  } else {
    players = [...allPlayers].sort((a, b) => tierRank(a) - tierRank(b)).slice(0, 5);
  }
  const tactics = team.isUser ? game.tactics : aiTacticsFor(team);
  const avgComposure = players.reduce((s, p) => s + p.attributes.composure, 0) / Math.max(1, players.length);
  // Team chemistry from the actual lineup — drives ±8% engine multiplier.
  // Same formula as calcTeamChemistry but computed over the lineup that will
  // actually play (reserves filling for injured starters affect it).
  const lineupCount = Math.max(1, players.length);
  const avgTeamwork = players.reduce((s, p) => s + p.attributes.teamwork, 0) / lineupCount;
  const avgMorale = players.reduce((s, p) => s + p.morale, 0) / lineupCount;
  const avgLoyalty = players.reduce((s, p) => s + p.attributes.loyalty, 0) / lineupCount;
  const moraleVariance =
    players.reduce((s, p) => s + Math.abs(p.morale - avgMorale), 0) / lineupCount;
  const chemistry = Math.max(
    0,
    Math.min(100, avgTeamwork * 3 + avgMorale * 2 + avgLoyalty * 1.5 - moraleVariance * 3),
  );
  const matchPlan = team.isUser && opponentTeamId ? game.tactics.matchPlans?.[opponentTeamId] : undefined;
  const scoutAccuracy =
    team.isUser && opponentTeamId ? (game.opponentScouts?.[opponentTeamId]?.accuracy ?? 0) : 0;
  const base: EngineTeam = {
    team,
    players,
    tactics,
    pressureResistance: avgComposure,
    chemistry,
    matchPlan,
    scoutAccuracy,
  };
  return team.isUser ? applyCallsToTeam(base, calls) : base;
}

function pressureFor(game: GameState, m: ScheduledMatch): number {
  const t = game.tournaments[m.tournamentId];
  if (!t) return 0.2;
  const base = t.tier === 'S' ? 0.55 : t.tier === 'A' ? 0.35 : 0.2;
  const playoff = m.stageName === 'Playoffs' ? 0.3 : 0;
  const final = m.roundLabel === 'Grand Final' ? 0.15 : 0;
  return Math.min(1, base + playoff + final);
}

export const useGame = create<Store>((set, get) => ({
  game: null,
  screen: 'home',
  selectedPlayerId: null,
  selectedTeamId: null,
  selectedTournamentId: null,
  liveMatch: null,
  liveMatchScheduledId: null,
  liveMatchConfirmed: false,

  newGame(userTeamId, saveName, managerInput) {
    // Reset module-scope state from any prior career — otherwise the old live
    // match series (full frames + RNG) and viewer cursor would leak across
    // saves until garbage collected on next match start.
    liveSeries = null;
    activeSlotId = null;
    const year = 2026;
    const startDate = `${year}${SEASON_START}`;
    const { teams, players } = buildInitialDatabase(startDate);
    teams[userTeamId].isUser = true;
    // Seed each player's clubHistory with their starting club (for HOF lineage later).
    for (const p of Object.values(players)) {
      if (p.teamId && teams[p.teamId]) {
        p.clubHistory = [{ teamId: p.teamId, teamName: teams[p.teamId].name, joinedOn: startDate }];
      }
    }
    // Cross-career manager identity. Loads existing profile if the name matches a
    // past career; otherwise creates a fresh profile with style-based attributes.
    const managerName = managerInput?.name.trim() || '';
    const managerProfile = managerName
      ? getOrCreateManager(
          managerName,
          managerInput?.nationality?.trim() || 'XX',
          managerInput?.style ?? 'all-rounder',
        )
      : null;
    if (managerProfile) {
      // Open a new career stint for this club.
      managerProfile.career.push({
        teamId: userTeamId,
        teamName: teams[userTeamId].name,
        startDate,
        trophies: 0,
      });
    }
    const tournaments = generateSeasonTournaments(year, teams, userTeamId);
    const game: GameState = {
      saveName,
      managerName: managerName || undefined,
      manager: managerProfile ?? undefined,
      managerStash: 50_000,
      managerInventory: [],
      currentDate: startDate,
      seasonYear: year,
      userTeamId,
      teams,
      players,
      tournaments,
      tournamentStates: {},
      schedule: [],
      tactics: {
        ...DEFAULT_TACTICS,
        mapVetoPriority: [...teams[userTeamId].mapPool]
          .sort((a, b) => b.proficiency - a.proficiency)
          .map((m) => m.map) as MapName[],
        roleSlots: initialRoleSlots(
          teams[userTeamId].playerIds.slice(0, 5).map((id) => players[id]).filter(Boolean),
        ),
        mapOverrides: {},
        matchPlans: {},
      },
      pendingCalls: [],
      inbox: [
        msg(
          startDate,
          'board',
          `Welcome to ${teams[userTeamId].name}`,
          `The board welcomes you as the new manager of ${teams[userTeamId].name}. Your budget is $${teams[userTeamId].budget.toLocaleString()}. The season begins now — check the Schedule for upcoming tournaments. Good luck.`,
        ),
      ],
      finances: [],
      offers: [],
      training: { focus: 'aim', intensity: 2, mapPrep: null },
      scoutReports: {},
      matchHistory: [],
      processedDates: [],
    };
    // Populate initial staff pool — auto-hires top teams' coaches and seeds the free-agent market.
    buildInitialStaffPool(game, new RNG(hashSeed(startDate + '-staff')));
    // Seed sponsorship deals — each team gets 1-4 active sponsors at game start.
    seedInitialSponsors(game);
    // Board sets season objectives + initial confidence
    game.board = initBoardState(teams[userTeamId], year, startDate);
    game.mediaTrust = 50;
    game.pressConferences = [];
    game.playerConcerns = [];
    // Initial player social fabric (mentors / friend cliques / rivals)
    game.relationships = generateInitialRelationships(game, startDate);
    // News feed authors + initial welcome post
    seedNewsAuthors(game);
    {
      const rng = new RNG(hashSeed(`news-seed-${startDate}`));
      // Seed a couple of generic posts so the feed isn't empty on day 1
      const press = game.newsAuthors!['press-hltv'];
      const userTeam = game.teams[userTeamId];
      if (press && userTeam && game.news) {
        game.news.unshift({
          id: `news-seed-${nextMsgId++}`,
          date: startDate,
          authorId: 'press-hltv',
          text: `📢 The ${year} season is here. ${userTeam.name} kick off their campaign as world #${userTeam.worldRanking}.`,
          category: 'press-release',
          taggedTeamIds: [userTeam.id],
          likes: rng.int(1500, 5000),
          reposts: rng.int(100, 500),
          comments: [],
        });
      }
    }
    // Board confidence + season mandates — gives the new save an immediate
    // narrative arc (FM-style "hot seat" pressure).
    game.boardConfidence = 55;
    game.boardMandates = generateSeasonMandates(game, year, new RNG(hashSeed(`mandates-${startDate}`)));
    if (game.boardMandates.length > 0) {
      game.inbox.push(
        msg(
          startDate,
          'board',
          `Board sets ${game.boardMandates.length} objective${game.boardMandates.length === 1 ? '' : 's'} for the season`,
          `The board's expectations for ${year}:\n\n` +
            game.boardMandates.map((m) => `• ${m.label} — ${m.detail}`).join('\n\n') +
            `\n\nProgress is tracked from the Manager screen. Meet them to climb the confidence bar; miss them and the seat gets hot.`,
        ),
      );
    }
    set({ game, screen: 'inbox', liveMatch: null, liveMatchScheduledId: null, liveMatchConfirmed: false });
    // Fresh career → create a NEW slot, don't reuse the previously-loaded one.
    activeSlotId = null;
    get().saveGame();
    // Persist the cross-career manager profile (with the new stint appended).
    if (managerProfile) saveManager(managerProfile);
  },

  saveGame() {
    const { game } = get();
    if (!game) return;
    // No active slot? Create one from the save name (first save of a fresh career).
    if (!activeSlotId) {
      activeSlotId = makeSlotId(game.saveName);
      setActiveSlotId(activeSlotId);
    }
    writeSlot(activeSlotId, game.saveName, game);
  },

  loadGame(slotId) {
    // Reset the in-flight match series — loading a different save shouldn't
    // carry over the previous game's live frames + RNG instance.
    liveSeries = null;
    // Pick the slot: explicit arg → active → most recent → legacy fallback
    const targetId = slotId ?? getActiveSlotId() ?? mostRecentSlotId();
    let game: GameState | null = null;
    if (targetId) {
      game = readSlot(targetId);
    }
    // Legacy fallback: if nothing in slots, try the old single-key.
    if (!game) {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      try { game = JSON.parse(raw) as GameState; } catch { return false; }
    }
    if (!game) return false;
    // ----- Migrations (apply on every load so older saves get the latest fields) -----
    // 500-FA pool backfill
    const faCount = Object.values(game.players).filter((p) => p.teamId === null).length;
    if (faCount < 100) {
      const usedIds = new Set(Object.keys(game.players));
      const usedNicks = new Set(Object.values(game.players).map((p) => p.nickname.toLowerCase()));
      const pool = generateFreeAgentPool(game.currentDate, usedIds, usedNicks);
      for (const p of pool) game.players[p.id] = p;
    }
    // News authors backfill
    ensureNewsAuthors(game);
    // clubHistory backfill — every player gets their current team as the seed entry.
    for (const p of Object.values(game.players)) {
      if (!p.clubHistory && p.teamId && game.teams[p.teamId]) {
        p.clubHistory = [{
          teamId: p.teamId,
          teamName: game.teams[p.teamId].name,
          joinedOn: game.currentDate,
        }];
      }
    }
    // Relationships backfill
    if (!game.relationships || game.relationships.length === 0) {
      game.relationships = generateInitialRelationships(game, game.currentDate);
    }
    // Heal stale tactics.roleSlots on legacy saves — earlier versions didn't
    // auto-sync slots when players were demoted/loaned out/released, leaving
    // reserves shown as starters in the formation pitch. One pass on load
    // clears anyone no longer first-team and back-fills empty slots from
    // available first-team players (role-matched where possible).
    syncRoleSlotsWithFirstTeam(game);
    // Compact legacy match history: older versions kept full kills + commentary
    // arrays on every finished match, which is why some saves balloon to many MB.
    // Strip them on first load so subsequent saves are slim.
    game.matchHistory = compactMatchHistory(game.matchHistory);
    // Backfill board confidence + mandates on saves from before the system existed.
    if (typeof game.boardConfidence !== 'number') game.boardConfidence = 50;
    if (!game.boardMandates) {
      game.boardMandates = generateSeasonMandates(
        game,
        game.seasonYear,
        new RNG(hashSeed(`mandates-backfill-${game.currentDate}`)),
      );
    }
    // Drop ancient finished schedule entries that pile up between rollovers.
    game.schedule = pruneFinishedSchedule(game.schedule, game.currentDate, 120);
    // Hard caps on the rolling logs so a long-running save doesn't choke.
    if (game.inbox.length > 200) game.inbox = game.inbox.slice(-200);
    if (game.matchHistory.length > 200) game.matchHistory = game.matchHistory.slice(-200);
    // Track which slot we're in so subsequent saveGame() writes to the right key.
    activeSlotId = targetId ?? makeSlotId(game.saveName);
    setActiveSlotId(activeSlotId);
    set({ game, screen: 'home' });
    return true;
  },

  hasSave() {
    return hasAnySave() || localStorage.getItem(SAVE_KEY) !== null;
  },

  listSaves() {
    return listSlots();
  },

  go(screen) {
    set({ screen });
  },
  openPlayer(id) {
    set({ selectedPlayerId: id, screen: 'player' });
  },

  openTeam(id) {
    set({ selectedTeamId: id, screen: 'teamprofile' });
  },
  openTournament(id) {
    set({ selectedTournamentId: id, screen: 'tournament' });
  },

  userMatchToday() {
    const { game } = get();
    if (!game) return null;
    return (
      game.schedule.find(
        (m) =>
          m.date === game.currentDate &&
          m.status === 'scheduled' &&
          (m.teamAId === game.userTeamId || m.teamBId === game.userTeamId),
      ) ?? null
    );
  },

  advanceDay() {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const today = g.currentDate;
    const rng = new RNG(hashSeed(today + g.userTeamId));

    // 0. season rollover
    if (today >= `${g.seasonYear}-12-20`) {
      rolloverSeason(g);
      set({ game: g });
      get().saveGame();
      return;
    }

    // 1. start tournaments
    for (const t of Object.values(g.tournaments)) {
      if (t.startDate === today && !g.tournamentStates[t.id]) {
        // resolve invites from CURRENT standings (Majors: RMR top 8 + best-ranked fill)
        if (t.isMajor && t.qualifierId && g.tournamentStates[t.qualifierId]?.finished) {
          const rmr = g.tournamentStates[t.qualifierId];
          const qualified = Object.entries(rmr.placements)
            .filter(([, place]) => place <= 8)
            .sort((a, b) => a[1] - b[1])
            .map(([id]) => id);
          const fill = Object.values(g.teams)
            .sort((a, b) => a.worldRanking - b.worldRanking)
            .map((x) => x.id)
            .filter((id) => !qualified.includes(id));
          t.invitedTeamIds = [...qualified, ...fill].slice(0, t.teamCount);
          if (!t.invitedTeamIds.includes(g.userTeamId)) {
            g.inbox.push(
              msg(today, 'tournament', `Missed out on ${t.name}`, `${g.teams[g.userTeamId].name} failed to qualify for ${t.name}. A top-8 RMR finish or a high world ranking is required.`),
            );
          }
        } else {
          t.invitedTeamIds = inviteByRanking(t.tier, t.teamCount, g.teams, g.userTeamId);
        }
        const state = initTournamentState(t);
        g.tournamentStates[t.id] = state;
        const seeding = Object.fromEntries(t.invitedTeamIds.map((id) => [id, g.teams[id]?.worldRanking ?? 99]));
        const matches = startTournament(t, state, seeding);
        g.schedule.push(...matches);
        if (t.invitedTeamIds.includes(g.userTeamId)) {
          g.inbox.push(
            msg(today, 'tournament', `${t.name} begins`, `${t.name} (${t.tier}-tier, $${t.prizePool.toLocaleString()} prize pool) starts today. ${t.teamCount} teams compete. Check the Schedule for your matches.`),
          );
        }
      }
    }

    // 1c. Resolve walkover fixtures (opponent folded / withdrew). Done before
    // the user-match check so a scheduled match against a defunct org doesn't
    // route the user into matchday for an opponent that no longer exists.
    for (const m of g.schedule) {
      if (m.status !== 'scheduled' || m.date > today) continue;
      if (!m.walkoverWinnerId) continue;
      m.status = 'finished';
      m.result = undefined;
      const winnerName = g.teams[m.walkoverWinnerId]?.name ?? 'Walkover team';
      const loserId = m.teamAId === m.walkoverWinnerId ? m.teamBId : m.teamAId;
      const loserName = g.teams[loserId]?.name ?? 'the opponent';
      if (m.walkoverWinnerId === g.userTeamId) {
        g.inbox.push(
          msg(
            today,
            'tournament',
            `Walkover win vs ${loserName}`,
            `${loserName} failed to field a team for this fixture — ${winnerName} advance via walkover. Ranking points awarded; no live match.`,
          ),
        );
      }
    }

    // 1d. Cheat scandal verdicts + ban-lift housekeeping (daily).
    {
      const verdictRng = new RNG(hashSeed(`cheat-verdict-${today}`));
      const { resolved, banLifted } = processCheatScandals(g, today, verdictRng);
      for (const s of resolved) {
        const p = g.players[s.playerId];
        const team = p?.teamId ? g.teams[p.teamId] : null;
        const isUserPlayer = team?.isUser ?? false;
        g.inbox.push(
          msg(
            today,
            isUserPlayer ? 'board' : 'training',
            isUserPlayer && s.status === 'banned'
              ? `🚨 ${p?.nickname} banned`
              : isUserPlayer
                ? `✓ ${p?.nickname} cleared`
                : `Scene: ${s.headline}`,
            `${s.headline}.\n\n` +
              (s.status === 'banned' && s.banUntil
                ? `${p?.nickname ?? 'Player'} is ineligible for matches until ${s.banUntil}.${isUserPlayer ? ' Squad morale dropped, sponsors are leaning on the front office for $80k of bonus claw-backs.' : ''}`
                : `${p?.nickname ?? 'Player'} is fully eligible again.`),
          ),
        );
        // User-team confidence swings on verdicts involving their players.
        if (isUserPlayer) {
          adjustConfidence(g, s.status === 'cleared' ? +5 : -8, `Verdict: ${p?.nickname}`);
        }
      }
      for (const s of banLifted) {
        const p = g.players[s.playerId];
        if (p?.teamId === g.userTeamId) {
          g.inbox.push(
            msg(today, 'training', `${p.nickname} returns from ban`, `${p.nickname}'s competitive ban has ended. They're eligible for selection again.`),
          );
        }
      }
    }

    // 1e. Board mandate processing + confidence drift (daily).
    {
      const { judged, cashAwarded } = processMandates(g, today);
      for (const m of judged) {
        g.inbox.push(
          msg(
            today,
            'board',
            m.status === 'met' ? `✓ Mandate met: ${m.label}` : `✗ Mandate failed: ${m.label}`,
            `${m.detail}\n\nBoard confidence ${m.status === 'met' ? '+' : '-'}${Math.round(m.rewardConfidence * (m.status === 'met' ? 1 : 1.3))}.` +
              (m.status === 'met' && m.rewardCash ? `\nCash bonus: $${m.rewardCash.toLocaleString()}.` : ''),
          ),
        );
      }
      if (cashAwarded > 0) g.teams[g.userTeamId].budget += cashAwarded;
      // Daily gentle drift toward 50 so a single bad result isn't permanent.
      driftConfidence(g);
      // Sacking watch: only fire once per ~14 days, not on every dawn.
      const conf = g.boardConfidence ?? 50;
      const lastWarn = g.lastBoardWarning ?? '0000-01-01';
      const daysSinceWarn = (new Date(today + 'T00:00:00Z').getTime() - new Date(lastWarn + 'T00:00:00Z').getTime()) / 86400000;
      if (conf <= 10 && daysSinceWarn >= 7) {
        g.inbox.push(
          msg(today, 'board', `🚨 Board confidence critical (${Math.round(conf)}%)`, `The board is days away from terminating your contract. A run of results or a mandate met will pull you back from the brink.`),
        );
        g.lastBoardWarning = today;
      } else if (conf <= 20 && conf > 10 && daysSinceWarn >= 14) {
        g.inbox.push(
          msg(today, 'board', `Board confidence wavering (${Math.round(conf)}%)`, `The board are losing patience. Hitting an outstanding mandate or a quality run of results would help your standing.`),
        );
        g.lastBoardWarning = today;
      }
    }

    // 2. user match today? block until played
    // While between jobs the user doesn't manage their old club — let the
    // engine sim that match as an AI vs AI fixture instead of routing the
    // user into matchday for a team they no longer represent.
    const userMatch = g.managerUnattached
      ? undefined
      : g.schedule.find(
          (m) =>
            m.date === today &&
            m.status === 'scheduled' &&
            (m.teamAId === g.userTeamId || m.teamBId === g.userTeamId),
        );
    if (userMatch) {
      // CRITICAL: pressing Continue while this match is already underway must NOT
      // reset it — only clear state when this is a different (new) match.
      const { liveMatchScheduledId, liveMatchConfirmed } = get();
      const inProgress = liveMatchScheduledId === userMatch.id && !liveMatchConfirmed;
      if (inProgress) {
        set({ game: g, screen: 'matchday' });
      } else {
        liveSeries = null;
        set({ game: g, screen: 'matchday', liveMatch: null, liveMatchScheduledId: null, liveMatchConfirmed: false });
      }
      return;
    }

    // 3. simulate AI matches for today
    simAiMatchesForDate(g, today);

    // 4. periodic systems
    const dow = new Date(today + 'T00:00:00').getDay();
    if (dow === 1) {
      // ---- Mid-season prune: stop save/state bloat between yearly rollovers ----
      // Without this, schedule + inbox + matchHistory grow uncapped all season,
      // making loadGame (large JSON parse) and structuredClone slower every
      // week. Cheap to run weekly and idempotent.
      g.schedule = pruneFinishedSchedule(g.schedule, today, 120);
      if (g.inbox.length > 200) g.inbox = g.inbox.slice(-200);
      if (g.matchHistory.length > 200) g.matchHistory = g.matchHistory.slice(-200);
      if (g.processedDates.length > 800) g.processedDates = g.processedDates.slice(-800);

      // ---- AI teams also train weekly (was a bug — only user grew, AI stagnated). ----
      // Auto-rotate focus deterministically by week so different attrs progress.
      const weekIdx = Math.floor(new Date(today + 'T00:00:00').getTime() / (7 * 86400000));
      const AI_FOCUSES: TrainingSetup['focus'][] = ['aim', 'utility', 'tactics', 'teamplay'];
      for (const team of Object.values(g.teams)) {
        if (team.isUser) continue;
        const aiTraining: TrainingSetup = {
          focus: AI_FOCUSES[weekIdx % AI_FOCUSES.length],
          intensity: 2,
          mapPrep: null,
        };
        const aiRng = new RNG(hashSeed(`ai-train-${team.id}-${today}`));
        applyWeeklyTraining(team, g.players, aiTraining, aiRng);
      }
      // ---- Stale-focus tracking: bump streak if same focus, reset if changed ----
      if (g.training.focus === g.training.lastFocus) {
        g.training.focusStreak = (g.training.focusStreak ?? 1) + 1;
      } else {
        g.training.focusStreak = 1;
        g.training.lastFocus = g.training.focus;
      }
      // ---- User team weekly training with specialist coaches ----
      const result = applyWeeklyTraining(
        g.teams[g.userTeamId],
        g.players,
        g.training,
        rng,
        (focus) => {
          // Map training focus → relevant specialist coach role
          const map: Record<TrainingSetup['focus'], StaffRole | null> = {
            aim: 'AimCoach',
            utility: 'UtilityCoach',
            tactics: 'TacticsCoach',
            teamplay: 'TacticsCoach',
            rest: null,
            'map-prep': 'TacticsCoach',
          };
          const role = map[focus];
          if (!role) return null;
          const coach = staffForRole(g, g.userTeamId, role);
          return coach ? { skill: coach.skill } : null;
        },
      );
      // Persist a rolling weekly training log (last 8 weeks) so the UI can
      // show "what happened" without waiting for the monthly digest.
      g.trainingHistory = [
        {
          date: today,
          focus: g.training.focus,
          intensity: g.training.intensity,
          notes: result.notes,
          gains: result.gains,
          regressions: result.regressions,
        },
        ...(g.trainingHistory ?? []),
      ].slice(0, 8);
      if (result.notes.length) {
        const subject =
          result.regressions > 0
            ? `Weekly training report — ${result.regressions} regression${result.regressions === 1 ? '' : 's'}`
            : 'Weekly training report';
        g.inbox.push(msg(today, 'training', subject, result.notes.join('\n')));
      }
      // exhaustion warnings
      const tired = g.teams[g.userTeamId].playerIds
        .map((id) => g.players[id])
        .filter((p) => p && p.fatigue > 70);
      if (tired.length) {
        g.inbox.push(
          msg(
            today,
            'training',
            'Players at risk of burnout',
            `${tired.map((p) => `${p.nickname} (${Math.round(p.fatigue)}% fatigue)`).join(', ')} ${tired.length === 1 ? 'is' : 'are'} exhausted. Heavily fatigued players perform far below their level — consider a rest week.`,
          ),
        );
      }
    }
    // ---- Saturday: academy auto-match for the user team ----
    // FM-style "behind the scenes" youth game. Manager doesn't pick or watch;
    // they just get a weekly inbox brief with the score + standout youngster.
    if (dow === 6 && !g.managerUnattached) {
      const yRng = new RNG(hashSeed(`youth-match-${g.userTeamId}-${today}`));
      const record = simulateYouthMatch(g, yRng);
      if (record) {
        g.youthMatchHistory = [
          {
            date: record.date,
            oppName: record.oppName,
            oppRating: record.oppRating,
            userScore: record.userScore,
            oppScore: record.oppScore,
            won: record.won,
            lineup: record.lineup,
            standoutId: record.standoutId,
          },
          ...(g.youthMatchHistory ?? []),
        ].slice(0, 12);

        const verdict = record.won
          ? (record.userScore - record.oppScore >= 10 ? 'dominant academy win' : 'academy win')
          : (record.oppScore - record.userScore >= 10 ? 'heavy academy loss' : 'academy loss');
        const body =
          `${g.teams[g.userTeamId].tag} Academy ${record.userScore}–${record.oppScore} vs ${record.oppName}\n\n` +
          `${record.standoutLine}\n\n` +
          `Lineup performance:\n` +
          record.lineup
            .map((l) => `  ${l.nickname} (${l.age}yo ${l.role}) — ${l.kills}/${l.deaths}/${l.assists} · ${l.rating.toFixed(2)} rating`)
            .join('\n') +
          `\n\nThe academy plays every Saturday — promotion calls live on the player's profile.`;
        g.inbox.push(
          msg(today, 'training', `Academy: ${verdict} vs ${record.oppName} (${record.userScore}–${record.oppScore})`, body),
        );
      }
    }

    // contract expiry warnings on Nov 1
    if (today === `${g.seasonYear}-11-01`) {
      const expiring = g.teams[g.userTeamId].playerIds
        .map((id) => g.players[id])
        .filter((p) => p?.contract && p.contract.expires <= `${g.seasonYear + 1}-01-05`);
      if (expiring.length) {
        g.inbox.push(
          msg(
            today,
            'transfer',
            'Contracts expiring at season end',
            `The following players will leave as free agents unless renewed: ${expiring.map((p) => p.nickname).join(', ')}. Renew them from their player pages.`,
          ),
        );
      }
    }
    if (today.endsWith('-01') || today.slice(8) === '01') {
      const month = today.slice(0, 7);
      const perfCoach = staffForRole(g, g.userTeamId, 'PerformanceCoach');
      const trainingDeltas = monthlyDevelopment(
        g.players,
        today,
        rng,
        { userTeamId: g.userTeamId, skill: perfCoach?.skill ?? 0 },
        g.training?.faceitTier ?? 'none',
        (menteeId) => {
          // Manager 'youngsters' attribute amplifies mentor effect on user-team mentees.
          const base = mentorBoostFor(g, menteeId);
          const mentee = g.players[menteeId];
          if (mentee && mentee.teamId === g.userTeamId) {
            return 1 + (base - 1) * mentorBoostMult(g);
          }
          return base;
        },
      );
      // Monthly social drift from relationships (friend lifts / rival drag / mentor support)
      applyMonthlyRelationshipEffects(g);
      // Build a monthly training report. Always send one so the user has a paper trail —
      // months with no measurable deltas get a short "nothing to note" report.
      {
        const byPlayer = new Map<string, typeof trainingDeltas>();
        for (const d of trainingDeltas) {
          const arr = byPlayer.get(d.playerId) ?? [];
          arr.push(d);
          byPlayer.set(d.playerId, arr);
        }
        const sourceLabel: Record<typeof trainingDeltas[number]['source'], string> = {
          youth: 'developed',
          decline: 'regressed in',
          wisdom: 'matured in',
          'perf-coach': 'coached up in',
        };
        const lines: string[] = [`Monthly training report — ${month}`, ''];
        const focusLabel = g.training?.focus ?? 'mixed';
        const faceitLabel = g.training?.faceitTier ?? 'none';
        lines.push(`Focus: ${focusLabel} · Intensity: ${g.training?.intensity ?? 2} · Faceit: ${faceitLabel}`);
        lines.push('');
        if (trainingDeltas.length === 0) {
          lines.push('No measurable attribute changes this month — the squad held steady.');
          lines.push('Buy younger players or sign a Performance Coach to accelerate development.');
        } else {
          for (const [pid, ds] of byPlayer) {
            const p = g.players[pid];
            if (!p) continue;
            const totalCaDelta = ds.reduce((s, d) => s + (d.caAfter - d.caBefore), 0);
            const caSign = totalCaDelta >= 0 ? '+' : '';
            lines.push(`• ${p.nickname} (age ${p.age}, CA ${p.currentAbility}) ${caSign}${totalCaDelta}`);
            for (const d of ds) {
              const arrow = d.after > d.before ? '↑' : '↓';
              lines.push(`    ${arrow} ${String(d.attr)} ${d.before} → ${d.after} (${sourceLabel[d.source]})`);
            }
          }
        }
        const positives = trainingDeltas.filter((d) => d.after > d.before).length;
        const negatives = trainingDeltas.filter((d) => d.after < d.before).length;
        g.inbox.push(
          msg(
            today,
            'training',
            trainingDeltas.length === 0
              ? `Training report — quiet month (${month})`
              : `Training report — ${positives} gains, ${negatives} declines (${month})`,
            lines.join('\n'),
          ),
        );
      }
      // Loans where the user is the parent club still cost wages here
      // (recipient covers the contributed share; parent eats the rest).
      const userOutboundLoans = (g.loans ?? [])
        .filter((l) => l.fromTeamId === g.userTeamId)
        .map((l) => ({ playerId: l.playerId, wageContribution: l.wageContribution }));
      const fr = processMonthlyFinances(g.teams[g.userTeamId], g.players, month, 0, 0, 0, userOutboundLoans);
      // Faceit hub subscription cost (deducted on top of standard wages).
      const FACEIT_COST: Record<string, number> = { none: 0, basic: 5000, pro: 20000, premium: 60000 };
      const faceitTierActive = g.training?.faceitTier ?? 'none';
      const faceitCost = FACEIT_COST[faceitTierActive];
      if (faceitCost > 0) {
        g.teams[g.userTeamId].budget -= faceitCost;
      }
      g.finances.push(fr);
      const faceitLine = faceitCost > 0 ? `\nFaceit ${faceitTierActive} hub: $${faceitCost.toLocaleString()}` : '';
      g.inbox.push(
        msg(
          today,
          'finance',
          `Monthly finances — ${month}`,
          `Sponsor income: $${fr.sponsorIncome.toLocaleString()}\nWages paid: $${fr.wages.toLocaleString()}${faceitLine}\nCurrent balance: $${g.teams[g.userTeamId].budget.toLocaleString()}`,
        ),
      );
      // AI finances (simplified)
      for (const t of Object.values(g.teams)) {
        if (t.isUser) continue;
        const wages = t.playerIds.reduce((s, id) => s + (g.players[id]?.contract?.wage ?? 0), 0);
        t.budget += Math.round(t.reputation * 900) - wages + 20000;
      }
      // AI transfer market activity — loaned players aren't owned by the
      // recipient and so cannot be sold on (otherwise the parent club can
      // exploit recall to recover a sold player for free).
      const loanedIds = new Set((g.loans ?? []).map((l) => l.playerId));
      const { lines, events } = aiToAiTransfers(g.teams, g.players, g.userTeamId, today, rng, loanedIds);
      if (lines.length) {
        g.inbox.push(msg(today, 'transfer', 'Transfer market round-up', lines.join('\n')));
      }
      // Each AI transfer also lands on the news feed — keeps the scene feeling alive.
      for (const ev of events) {
        const newsRng = new RNG(hashSeed(`ai-trade-${ev.playerId}-${today}-${ev.fee}`));
        postsForTransfer(g, ev.playerId, ev.sellerId, ev.buyerId, ev.fee, newsRng);
      }
      // AI scrambles for hot free agents + monthly roster turnover so rival
      // clubs feel like they're actively managing themselves, not frozen.
      const faRng = new RNG(hashSeed(`ai-fa-${today}`));
      const turnoverRng = new RNG(hashSeed(`ai-turnover-${today}`));
      const faEvents = aiFreeAgentScramble(g, faRng, today);
      const turnoverEvents = aiRosterTurnover(g, turnoverRng, today);
      const aiActivityLines: string[] = [];
      for (const ev of faEvents) {
        aiActivityLines.push(`• ${ev.teamName} sign free agent ${ev.playerNick} at $${ev.wage.toLocaleString()}/mo.`);
      }
      for (const ev of turnoverEvents) {
        aiActivityLines.push(`• ${ev.teamName} release ${ev.releasedNick ?? 'a player'} and sign ${ev.playerNick} as replacement.`);
      }
      if (aiActivityLines.length > 0) {
        g.inbox.push(
          msg(today, 'transfer', `Rival club activity — ${aiActivityLines.length} ${aiActivityLines.length === 1 ? 'move' : 'moves'}`, aiActivityLines.join('\n')),
        );
      }
      // ----- Org bankruptcy event (monthly roll) -----
      // Once or twice per year, a real lower-table org folds — its roster
      // hits the FA market at a 50% discount. Schedule-aware so it doesn't
      // gut a team mid-deep-run at a major.
      const bankRng = new RNG(hashSeed(`org-bank-${today}`));
      const bankruptcy = rollOrgBankruptcy(g, today, bankRng);
      if (bankruptcy) {
        g.inbox.push(
          msg(
            today,
            'transfer',
            `🚨 ${bankruptcy.teamName} folds — ${bankruptcy.releasedPlayerIds.length} players hit free agency`,
            `${bankruptcy.teamName} have ceased operations effective today. Their entire roster is now free, with asking prices halved for the next 30 days. Released:\n\n` +
              bankruptcy.releasedPlayerIds
                .map((pid) => g.players[pid])
                .filter(Boolean)
                .map((p) => `  • ${p!.nickname} (${p!.age}yo ${p!.role}, CA ${p!.currentAbility}) — asking $${p!.askingPrice.toLocaleString()}`)
                .join('\n') +
              `\n\nFire-sale window closes ${addDays(today, 30)}. Check the Free Agents tab on the Transfers screen.`,
          ),
        );
      }

      // ----- VAC / cheat allegation arc (monthly roll for new allegations) -----
      const scandalRng = new RNG(hashSeed(`cheat-${today}`));
      const newScandal = rollCheatAllegation(g, today, scandalRng);
      if (newScandal) {
        g.cheatScandals = g.cheatScandals ?? [];
        g.cheatScandals.push(newScandal);
        const p = g.players[newScandal.playerId];
        const team = p?.teamId ? g.teams[p.teamId] : null;
        const isUserPlayer = team?.isUser ?? false;
        g.inbox.push(
          msg(
            today,
            isUserPlayer ? 'board' : 'training',
            isUserPlayer
              ? `🚨 ${p?.nickname ?? 'Player'} under investigation`
              : `Scene news: ${newScandal.headline}`,
            `${newScandal.headline}.\n\n${p?.nickname ?? 'The accused'} (${team?.name ?? 'unknown club'}) is being investigated by ESIC / anti-cheat. Verdict expected by ${newScandal.verdictOn}.\n\n` +
              (isUserPlayer
                ? `Squad morale has taken a hit — the dressing room won't settle until this is resolved. They remain match-eligible for now, but a guilty verdict means a competitive ban and a sponsor backlash.`
                : `Squad morale at ${team?.name ?? 'the club'} has been dented. Worth tracking — a guilty verdict opens roster-poaching opportunities.`),
          ),
        );
      }

      // Manager personal stash stipend — $25k/month auto-credited for the case-opening minigame.
      g.managerStash = (g.managerStash ?? 0) + 25_000;

      // Manager job market: rival clubs may approach the manager based on reputation.
      if (g.manager) {
        const jobRng = new RNG(hashSeed(`mgr-jobs-${today}`));
        const newOffers = generateMonthlyJobOffers(g, jobRng);
        for (const o of newOffers) {
          g.inbox.push(
            msg(
              today,
              'board',
              `${o.kind === 'head-hunt' ? '🎯 Head-hunt' : 'Job approach'}: ${o.teamName} (#${o.teamRank})`,
              `${o.pitch}\n\nSign-on bonus: $${o.signOnBonus.toLocaleString()}\nOffer expires ${o.expiresOn}.\n\nManage offers from the Manager screen.`,
            ),
          );
        }
        // Post-sack rebound: if unattached for 7+ days and no offers, generate one.
        if (g.managerUnattached && (g.managerJobOffers?.length ?? 0) === 0) {
          const lastStint = g.manager.career[g.manager.career.length - 1];
          const daysSinceSack = lastStint?.endDate
            ? (new Date(today + 'T00:00:00Z').getTime() -
                new Date(lastStint.endDate + 'T00:00:00Z').getTime()) /
              86_400_000
            : 0;
          if (daysSinceSack >= 7) {
            const rebound = generateReboundOffer(g, jobRng);
            if (rebound) {
              g.inbox.push(
                msg(
                  today,
                  'board',
                  `Rebound offer: ${rebound.teamName} (#${rebound.teamRank})`,
                  `${rebound.pitch}\n\nSign-on: $${rebound.signOnBonus.toLocaleString()}\nExpires ${rebound.expiresOn}.`,
                ),
              );
            }
          }
        }
      }
    }
    const physio = staffForRole(g, g.userTeamId, 'Physio');
    const injuryEvents = dailyPlayerTick(
      g.players,
      today,
      rng,
      physio ? { userTeamId: g.userTeamId, physioSkill: physio.skill } : null,
    );
    // Post-injury check: any team that's now short of 5 healthy players
    // (the most common cause is the only-just-injured starter on a thin
    // roster) signs an emergency FA so the engine never builds a 4-player lineup.
    ensureMatchReady(g, today);
    // Surface injuries: user-team gets inbox notices; high-profile (CA ≥ 150) gets a news post.
    for (const ev of injuryEvents) {
      const p = g.players[ev.playerId];
      if (!p) continue;
      const isUser = p.teamId === g.userTeamId;
      const isHighProfile = p.currentAbility >= 150;
      if (ev.recovered) {
        if (isUser) {
          g.inbox.push(
            msg(
              today,
              'training',
              `${p.nickname} fit to play`,
              `${p.nickname} has recovered from ${ev.injury.type.replace('-', ' ')} and is cleared for matches.`,
            ),
          );
        }
        continue;
      }
      const daysOut = Math.max(1, Math.round(
        (new Date(ev.injury.returnDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000,
      ));
      if (isUser) {
        g.inbox.push(
          msg(
            today,
            'training',
            `🚑 ${p.nickname} injured — ${ev.injury.severity} ${ev.injury.type.replace('-', ' ')}`,
            `${ev.injury.description}\n\nExpected back: ${ev.injury.returnDate} (~${daysOut} days). They cannot be selected for matches until then.`,
          ),
        );
      }
      if (isHighProfile && p.teamId) {
        const newsRng = new RNG(hashSeed(`news-injury-${p.id}-${today}`));
        const team = g.teams[p.teamId];
        pushPostInjury(g, today, p.id, p.nickname, team?.tag ?? '', ev.injury, daysOut, newsRng);
      }
    }
    tickScoutingProgress(g, today);

    // Idle news rumor for atmosphere (40% chance/day for a roll)
    {
      const rumorRng = new RNG(hashSeed(`news-rumor-${today}`));
      rollIdleRumor(g, today, rumorRng);
    }

    // Daily sponsor atmosphere news (keeps Sponsors tab alive between annual renewals)
    {
      const sponsorRng = new RNG(hashSeed(`news-sponsor-${today}`));
      rollSponsorAnnouncement(g, today, sponsorRng);
    }

    // Sponsor offer daily roll + expiry sweep
    g.sponsorOffers = g.sponsorOffers ?? [];
    // Drop expired offers (with inbox notice for any that lapse without a decision)
    const liveOffers = g.sponsorOffers.filter((o) => o.expiresOn >= today);
    if (liveOffers.length !== g.sponsorOffers.length) {
      const dropped = g.sponsorOffers.filter((o) => o.expiresOn < today);
      for (const o of dropped) {
        const sponsor = g.sponsors?.[o.sponsorId];
        g.inbox.push(
          msg(today, 'finance', `${sponsor?.brand ?? o.sponsorId} withdrew their sponsor offer`,
              `The deal lapsed without a response. They may reach out again later.`),
        );
      }
      g.sponsorOffers = liveOffers;
    }
    // Player concern roll (FM "walk-in" loop). Skipped while unattached.
    g.playerConcerns = g.playerConcerns ?? [];
    const concernRng = new RNG(hashSeed(`concern-${today}`));
    const newConcern = g.managerUnattached ? null : rollPlayerConcern(g, today, concernRng);
    if (newConcern) {
      g.playerConcerns.push(newConcern);
      const p = g.players[newConcern.playerId];
      g.inbox.push(
        msg(today, 'board', `${p?.nickname ?? 'A player'} wants to talk`, newConcern.message),
      );
      playSound('concern');
    }

    // Pre-match press conferences for upcoming user matches (1-2 days out)
    g.pressConferences = g.pressConferences ?? [];
    const upcomingUserMatch = g.schedule.find(
      (m) =>
        m.status === 'scheduled' &&
        m.date === addDays(today, 1) &&
        (m.teamAId === g.userTeamId || m.teamBId === g.userTeamId),
    );
    if (upcomingUserMatch && !g.managerUnattached) {
      const conf = maybeSchedulePreMatchPress(g, upcomingUserMatch);
      if (conf) {
        g.pressConferences.push(conf);
        const opp = g.teams[conf.contextTeamId ?? ''];
        g.inbox.push({
          id: `msg-${++nextMsgId}-${Date.now().toString(36)}`,
          date: today,
          category: 'board',
          subject: `Press conference scheduled — ahead of ${opp?.name ?? 'your next match'}`,
          body: `The media want to hear from you before tomorrow's match. Open this inbox message and answer below, or use the Press panel on the Home screen.`,
          read: false,
          linkType: 'press',
          linkId: conf.id,
        });
      }
    }

    // Roll for a new approach
    const sponsorRng = new RNG(hashSeed(`sponsor-offer-${today}`));
    const newOffer = rollSponsorOffer(g, today, sponsorRng);
    if (newOffer) {
      g.sponsorOffers.push(newOffer);
      const sponsor = g.sponsors?.[newOffer.sponsorId];
      const replacing = newOffer.replacesDealOfSponsorId
        ? g.sponsors?.[newOffer.replacesDealOfSponsorId]
        : null;
      g.inbox.push(
        msg(
          today,
          'finance',
          `${sponsor?.brand ?? newOffer.sponsorId} want to sponsor ${g.teams[g.userTeamId].name}`,
          `${sponsor?.name ?? 'A new sponsor'} (${sponsor?.tier} tier) are offering $${newOffer.monthlyValue.toLocaleString()}/month ` +
            `for ${newOffer.lengthMonths} months${newOffer.bonusPerMajor ? `, plus $${newOffer.bonusPerMajor.toLocaleString()} per major win` : ''}` +
            `${newOffer.bonusPerPodium ? ` and $${newOffer.bonusPerPodium.toLocaleString()} per podium finish` : ''}.\n` +
            (replacing ? `Accepting will end your existing deal with ${replacing.brand}. ` : '') +
            `Respond in Finances → Sponsor Offers before ${newOffer.expiresOn}.`,
        ),
      );
    }

    // 5. AI transfer offers for user players
    const newOffers = generateAiOffers(g.teams[g.userTeamId], g.teams, g.players, today, rng, g.offers);
    for (const o of newOffers) {
      g.offers.push(o);
      const p = g.players[o.playerId];
      g.inbox.push(
        msg(today, 'transfer', `Transfer offer for ${p.nickname}`, `${g.teams[o.fromTeamId].name} have offered $${o.fee.toLocaleString()} for ${p.nickname}. Respond in the Transfers screen before ${o.expiresOn}.`),
      );
    }

    // 5b. Rival bid drama on active user negotiations + offer auto-expiry
    for (const offer of g.offers) {
      if (offer.direction !== 'out') continue;
      if (offer.status === 'accepted' || offer.status === 'rejected' || offer.status === 'withdrawn') continue;
      const p = g.players[offer.playerId];
      if (!p) continue;
      // Auto-expire stale negotiations (no movement in 10 days)
      if (today > offer.expiresOn) {
        offer.status = 'withdrawn';
        offer.log = [...(offer.log ?? []), { date: today, line: 'Negotiation expired without a deal.' }];
        g.inbox.push(msg(today, 'transfer', `Negotiation for ${p.nickname} expired`, `Without progress, the talks have lapsed.`));
        continue;
      }
      // Rival bid roll (only during the fee-stage of an active negotiation)
      if ((offer.status === 'pending' || offer.status === 'club-counter') && !offer.rivalBid) {
        const rival = maybeRivalBid(p, offer, g.teams, today, rng);
        if (rival) {
          offer.rivalBid = rival;
          offer.log = [...(offer.log ?? []), { date: today, line: `Rival bid: ${g.teams[rival.teamId]?.name} offered $${rival.fee.toLocaleString()} for ${p.nickname}.` }];
          g.inbox.push(msg(today, 'transfer', `Rival bid for ${p.nickname}`, `${g.teams[rival.teamId]?.name} have offered $${rival.fee.toLocaleString()} — match it or fold from the Transfers screen.`));
        }
      }
    }

    // 5c. Loan auto-expiry — return players whose loans have run out
    if (g.loans && g.loans.length > 0) {
      const expired = g.loans.filter((l) => today >= l.endDate);
      for (const l of expired) {
        const p = g.players[l.playerId];
        if (!p) continue;
        const toTeam = g.teams[l.toTeamId];
        const fromTeam = g.teams[l.fromTeamId];
        // Safety guard: only restore ownership if the player is actually still
        // sitting at the loan recipient. If they've been transferred / released
        // during the loan, the deal is void — don't teleport them back (that
        // was the "free recall" exploit).
        const stillAtRecipient = p.teamId === l.toTeamId && toTeam?.playerIds.includes(l.playerId);
        if (stillAtRecipient) {
          if (toTeam) toTeam.playerIds = toTeam.playerIds.filter((x) => x !== l.playerId);
          if (fromTeam) fromTeam.playerIds.push(l.playerId);
          p.teamId = l.fromTeamId;
          if (fromTeam?.isUser) {
            g.inbox.push(msg(today, 'transfer', `${p.nickname} returns from loan`, `Loan complete. ${p.nickname} rejoins ${fromTeam.name} from ${toTeam?.name ?? 'the loan club'}.`));
          }
        } else if (fromTeam?.isUser) {
          g.inbox.push(
            msg(
              today,
              'transfer',
              `Loan voided — ${p.nickname} no longer at ${toTeam?.name ?? 'the loan club'}`,
              `${p.nickname}'s situation changed during the loan and they cannot be recalled. The deal lapses with no return.`,
            ),
          );
        }
      }
      g.loans = g.loans.filter((l) => today < l.endDate);
    }
    // expire old offers
    g.offers = g.offers.filter((o) => o.status === 'pending' && o.expiresOn >= today);

    // Sportsbook: settle any bets whose matches finished today.
    settleSportsbookBets(g);

    // Inbox cap — keep the most recent 120 messages. Drops oldest READ first;
    // if still over cap after dropping all read messages, oldest unread go too.
    pruneInbox(g, 120);

    // Manager sack check — board confidence sustained low enough triggers a sacking.
    if (shouldSack(g)) {
      const oldTeam = g.teams[g.userTeamId];
      g.inbox.push(
        msg(
          today,
          'board',
          `🚨 You have been sacked by ${oldTeam?.name ?? 'the board'}`,
          `The board has lost faith. Your contract has been terminated effective immediately.\n\nA rebound offer from another club should arrive within a week. Until then, you're between jobs — manage open offers from the Manager screen.`,
        ),
      );
      enterUnattachedState(g, 'sacked');
      if (g.manager) saveManager(g.manager);
    }

    // 6. advance the clock
    g.processedDates.push(today);
    g.currentDate = addDays(today, 1);
    set({ game: g });
    if (new Date(g.currentDate + 'T00:00:00').getDay() === 1) get().saveGame(); // autosave weekly
  },

  playUserMatch() {
    const { game } = get();
    if (!game) return;
    const m = get().userMatchToday();
    if (!m) return;
    const userIsA = game.teams[m.teamAId]?.isUser ?? false;
    const userIsB = game.teams[m.teamBId]?.isUser ?? false;
    const calls = game.pendingCalls;
    const a = engineTeam(game, m.teamAId, userIsA ? m.teamBId : undefined, userIsA ? calls : undefined);
    const b = engineTeam(game, m.teamBId, userIsB ? m.teamAId : undefined, userIsB ? calls : undefined);
    liveSeries = startSeries(m.id, a, b, m.format, MAP_LAYOUTS, pressureFor(game, m));
    playNextSeriesMap(liveSeries);
    // consume one-shot calls + the per-match lineup override now that they've
    // been baked into the first map's EngineTeam.
    if ((calls && calls.length) || game.pendingLineup || game.pendingTeamTalk) {
      const g = structuredClone(game);
      g.pendingCalls = [];
      g.pendingLineup = undefined;
      g.pendingTeamTalk = undefined;
      set({ game: g });
    }
    set({ liveMatch: seriesResult(liveSeries), liveMatchScheduledId: m.id, liveMatchConfirmed: false, screen: 'matchday' });
  },

  playNextMap() {
    const { game } = get();
    if (!game || !liveSeries) return;
    // apply any tactics changes made during the map break, including pending calls
    const calls = game.pendingCalls;
    if (liveSeries.a.team.isUser) {
      const refreshed = applyCallsToTeam({ ...liveSeries.a, tactics: game.tactics, forceStackSite: undefined }, calls);
      liveSeries.a = refreshed;
    }
    if (liveSeries.b.team.isUser) {
      const refreshed = applyCallsToTeam({ ...liveSeries.b, tactics: game.tactics, forceStackSite: undefined }, calls);
      liveSeries.b = refreshed;
    }
    playNextSeriesMap(liveSeries);
    if (calls && calls.length) {
      const g = structuredClone(game);
      g.pendingCalls = [];
      set({ game: g });
    }
    set({ liveMatch: seriesResult(liveSeries) });
  },

  seriesIsDecided() {
    return liveSeries ? seriesDecided(liveSeries) : true;
  },

  confirmUserMatch() {
    const { game, liveMatchScheduledId } = get();
    if (!game || !liveMatchScheduledId) return;
    // make sure the series is fully played out (e.g. Skip to Result mid-series)
    if (liveSeries && !seriesDecided(liveSeries)) {
      const calls = game.pendingCalls;
      if (liveSeries.a.team.isUser) {
        liveSeries.a = applyCallsToTeam(
          { ...liveSeries.a, tactics: game.tactics, forceStackSite: undefined },
          calls,
        );
      }
      if (liveSeries.b.team.isUser) {
        liveSeries.b = applyCallsToTeam(
          { ...liveSeries.b, tactics: game.tactics, forceStackSite: undefined },
          calls,
        );
      }
      while (!seriesDecided(liveSeries)) {
        if (!playNextSeriesMap(liveSeries)) break;
      }
      if (calls && calls.length) {
        const g = structuredClone(game);
        g.pendingCalls = [];
        set({ game: g });
      }
      set({ liveMatch: seriesResult(liveSeries) });
    }
    const liveMatch = liveSeries ? seriesResult(liveSeries) : get().liveMatch;
    if (!liveMatch) return;
    liveSeries = null;
    const g = structuredClone(game);
    const m = g.schedule.find((x) => x.id === liveMatchScheduledId);
    if (!m) return;
    const stripped = stripFrames(liveMatch);
    m.status = 'finished';
    m.result = stripped;
    applyMatchAftermath(g.players, stripped);
    // Manager 'motivating' attribute softens (or worsens) the morale hit on losses.
    applyManagerPostMatchBounceback(g, stripped);
    // Sportsbook: settle any pending bet on this match immediately.
    settleSportsbookBets(g);
    g.matchHistory.push(stripped);
    updateSwissRecord(g, m);

    const won = stripped.winnerId === g.userTeamId;
    const opp = stripped.winnerId === m.teamAId ? g.teams[m.teamBId] : g.teams[m.teamAId];
    const opponentTeam = m.teamAId === g.userTeamId ? g.teams[m.teamBId] : g.teams[m.teamAId];
    const score = `${stripped.mapsA}-${stripped.mapsB}`;
    // Board confidence swings on results — bigger swings vs higher-ranked
    // opponents. Caps at ±5 per match so a single game doesn't flip the
    // entire arc, but a run of bad form definitely will.
    const oppTier = (opp?.worldRanking ?? 50) <= 5 ? 5 : (opp?.worldRanking ?? 50) <= 15 ? 3 : 2;
    adjustConfidence(g, won ? oppTier : -oppTier, won ? `Beat ${opp?.tag}` : `Lost to ${opp?.tag}`);
    // Audio cue: win/loss fanfare. Major-tier S events get the extended fanfare.
    const tournament = g.tournaments[m.tournamentId];
    if (won) {
      playSound(tournament?.tier === 'S' && m.roundLabel?.toLowerCase().includes('grand final') ? 'major-win' : 'match-win');
    } else {
      playSound('match-loss');
    }
    g.inbox.push(
      msg(
        g.currentDate,
        'match',
        won ? `Victory vs ${opp.name} (${score})` : `Defeat — ${m.roundLabel}`,
        won
          ? `A ${score} win over ${opp.name} in the ${m.roundLabel} of ${g.tournaments[m.tournamentId]?.name ?? 'the event'}.`
          : `Lost the ${m.roundLabel} against ${stripped.winnerId === m.teamAId ? g.teams[m.teamAId].name : g.teams[m.teamBId].name} ${score}.`,
      ),
    );

    // News feed posts for the match
    {
      const newsRng = new RNG(hashSeed(`news-match-${m.id}`));
      postsForMatch(g, m, stripped, newsRng);
    }

    // Post-match press conference for marquee results (won/lost big, or upset)
    const upset = won
      ? opponentTeam.worldRanking < g.teams[g.userTeamId].worldRanking - 4
      : opponentTeam.worldRanking > g.teams[g.userTeamId].worldRanking + 4;
    const postConf = maybeSchedulePostMatchPress(g, m, won, upset);
    if (postConf) {
      g.pressConferences = g.pressConferences ?? [];
      g.pressConferences.push(postConf);
      g.inbox.push({
        id: `msg-${++nextMsgId}-${Date.now().toString(36)}`,
        date: g.currentDate,
        category: 'board',
        subject: `Post-match press conference — ${won ? 'after the win' : 'after the loss'}`,
        body: `The press want a few words. Open this message and answer below, or use the Press panel on the Home screen.`,
        read: false,
        linkType: 'press',
        linkId: postConf.id,
      });
    }

    // sim remaining AI matches today, then progress tournaments
    simAiMatchesForDate(g, g.currentDate);

    set({ game: g, liveMatchConfirmed: true });
    get().saveGame();
  },

  setTactics(t) {
    const { game } = get();
    if (!game) return;
    set({ game: { ...game, tactics: t } });
  },

  setMapOverride(map, override) {
    const { game } = get();
    if (!game) return;
    const overrides = { ...(game.tactics.mapOverrides ?? {}) };
    if (override === null) {
      delete overrides[map];
    } else {
      const current = overrides[map] ?? {};
      const merged: MapTactics = { ...current, ...override };
      // Strip undefined fields so "inherit" actually inherits
      for (const k of Object.keys(merged) as (keyof MapTactics)[]) {
        if (merged[k] === undefined) delete merged[k];
      }
      overrides[map] = merged;
    }
    set({ game: { ...game, tactics: { ...game.tactics, mapOverrides: overrides } } });
  },

  toggleStratEnabled(map, stratName, allStratNames) {
    const { game } = get();
    if (!game) return;
    const overrides = { ...(game.tactics.mapOverrides ?? {}) };
    const cur = overrides[map] ?? {};
    // If no enabledStrats is set, treat all as enabled — so first toggle removes one.
    const currentEnabled = cur.enabledStrats ?? [...allStratNames];
    const isEnabled = currentEnabled.includes(stratName);
    let next: string[];
    if (isEnabled) {
      next = currentEnabled.filter((s) => s !== stratName);
    } else {
      next = [...currentEnabled, stratName];
    }
    // If toggling brings us back to "all enabled", clear the field for cleanliness.
    if (next.length === allStratNames.length && allStratNames.every((s) => next.includes(s))) {
      const { enabledStrats: _drop, ...rest } = cur;
      void _drop;
      overrides[map] = rest;
    } else {
      overrides[map] = { ...cur, enabledStrats: next };
    }
    set({ game: { ...game, tactics: { ...game.tactics, mapOverrides: overrides } } });
  },

  setRoleSlot(idx, patch) {
    const { game } = get();
    if (!game) return;
    const slots = game.tactics.roleSlots
      ? game.tactics.roleSlots.map((s) => ({ ...s }))
      : initialRoleSlots(
          game.teams[game.userTeamId].playerIds
            .slice(0, 5)
            .map((id) => game.players[id])
            .filter(Boolean),
        );
    if (idx < 0 || idx >= slots.length) return;
    // If assigning a playerId already on another slot, swap them so we keep 5 unique players.
    if (patch.playerId !== undefined) {
      const otherIdx = slots.findIndex((s, i) => i !== idx && s.playerId === patch.playerId);
      if (otherIdx >= 0) slots[otherIdx] = { ...slots[otherIdx], playerId: slots[idx].playerId };
    }
    slots[idx] = { ...slots[idx], ...patch };
    set({ game: { ...game, tactics: { ...game.tactics, roleSlots: slots } } });
  },

  setPendingLineupSlot(idx, playerId) {
    const { game } = get();
    if (!game) return;
    if (idx < 0 || idx >= 5) return;
    // Initialise from the current roleSlots so the array is always length 5.
    const base = game.pendingLineup
      ? [...game.pendingLineup]
      : (game.tactics.roleSlots ?? []).map((s) => s.playerId ?? null);
    while (base.length < 5) base.push(null);
    // Same swap-protection as setRoleSlot: avoid duplicate occupants.
    if (playerId !== null) {
      const otherIdx = base.findIndex((id, i) => i !== idx && id === playerId);
      if (otherIdx >= 0) base[otherIdx] = base[idx];
    }
    base[idx] = playerId;
    set({ game: { ...game, pendingLineup: base } });
  },

  giveTeamTalk(tone) {
    const { game } = get();
    if (!game) return;
    // Find today's user match (need a matchId to scope the one-shot).
    const todayMatch = game.schedule.find(
      (m) =>
        m.date === game.currentDate &&
        m.status === 'scheduled' &&
        (m.teamAId === game.userTeamId || m.teamBId === game.userTeamId),
    );
    if (!todayMatch) return;
    // Already given for this match? Block double-talks.
    if (game.pendingTeamTalk && game.pendingTeamTalk.matchId === todayMatch.id) return;

    const g = structuredClone(game);
    const team = g.teams[g.userTeamId];
    // Resolve the actual starting 5 (mirrors engineTeam logic).
    const slotIds =
      g.pendingLineup && g.pendingLineup.length === 5
        ? g.pendingLineup
        : (g.tactics.roleSlots ?? []).map((s) => s.playerId ?? null);
    const starters = slotIds
      .map((id) => (id ? g.players[id] : null))
      .filter((p): p is Player => !!p && !p.injury);
    if (starters.length === 0) return;
    const avgComposure = starters.reduce((s, p) => s + p.attributes.composure, 0) / starters.length;
    const moraleBefore = starters.reduce((s, p) => s + p.morale, 0) / starters.length;
    let summary = '';
    const clamp01_20 = (v: number) => Math.max(1, Math.min(20, v));

    // ----- Apply tone effects -----
    switch (tone) {
      case 'relax': {
        // Settles a tense squad. Modest morale lift, slight form bump for tired players.
        for (const p of starters) {
          p.morale = clamp01_20(p.morale + 1.0);
          if (p.fatigue > 50) p.form = clamp01_20(p.form + 0.5);
        }
        summary = `Relaxed tone — tense squad eased into the match.`;
        break;
      }
      case 'encourage': {
        // Reliable confidence boost — works on any squad, modest magnitude.
        for (const p of starters) {
          p.morale = clamp01_20(p.morale + 1.5);
          p.form = clamp01_20(p.form + 0.3);
        }
        summary = `Encouraging tone — broad confidence boost across the five.`;
        break;
      }
      case 'demand-more': {
        // Sharpens composed players, rattles low-composure ones.
        let lifted = 0, rattled = 0;
        for (const p of starters) {
          if (p.attributes.composure >= 13) {
            p.morale = clamp01_20(p.morale + 0.6);
            p.form = clamp01_20(p.form + 1.0);
            lifted++;
          } else if (p.attributes.composure < 10) {
            p.morale = clamp01_20(p.morale - 1.2);
            rattled++;
          }
        }
        summary = `Demanded more — ${lifted} responded, ${rattled} took it badly.`;
        break;
      }
      case 'passionate': {
        // Big morale lift, slight composure drop (overhyped).
        for (const p of starters) {
          p.morale = clamp01_20(p.morale + 2.5);
        }
        summary = `Passionate speech — squad fired up, morale soaring.`;
        break;
      }
      case 'aggressive': {
        // Big gamble — pays off on a confident team, bombs on a fragile one.
        if (avgComposure >= 13) {
          for (const p of starters) {
            p.morale = clamp01_20(p.morale + 2.0);
            p.form = clamp01_20(p.form + 1.0);
          }
          summary = `Aggressive challenge — confident squad rose to it.`;
        } else {
          for (const p of starters) {
            p.morale = clamp01_20(p.morale - 1.8);
          }
          summary = `Aggressive challenge backfired — fragile squad shaken (avg composure ${avgComposure.toFixed(1)}).`;
        }
        break;
      }
    }

    const moraleAfter = starters.reduce((s, p) => s + p.morale, 0) / starters.length;
    const delta = moraleAfter - moraleBefore;
    const fullSummary = `${summary} Avg morale ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} (now ${moraleAfter.toFixed(1)}/20).`;

    g.pendingTeamTalk = { tone, matchId: todayMatch.id, summary: fullSummary };
    void team;
    set({ game: g });
  },

  swapRoleSlotPlayers(idxA, idxB) {
    const { game } = get();
    if (!game || !game.tactics.roleSlots) return;
    const slots = game.tactics.roleSlots.map((s) => ({ ...s }));
    if (idxA < 0 || idxB < 0 || idxA >= slots.length || idxB >= slots.length) return;
    const tmp = slots[idxA].playerId;
    slots[idxA].playerId = slots[idxB].playerId;
    slots[idxB].playerId = tmp;
    set({ game: { ...game, tactics: { ...game.tactics, roleSlots: slots } } });
  },

  setMatchPlan(opponentTeamId, patch) {
    const { game } = get();
    if (!game) return;
    const plans = { ...(game.tactics.matchPlans ?? {}) };
    const current: MatchPlan = plans[opponentTeamId] ?? { ...DEFAULT_MATCH_PLAN };
    const merged: MatchPlan = {
      pistols: Math.max(0, Math.min(5, patch.pistols ?? current.pistols)),
      defaults: Math.max(0, Math.min(5, patch.defaults ?? current.defaults)),
      executes: Math.max(0, Math.min(5, patch.executes ?? current.executes)),
      antiEcos: Math.max(0, Math.min(5, patch.antiEcos ?? current.antiEcos)),
    };
    plans[opponentTeamId] = merged;
    set({ game: { ...game, tactics: { ...game.tactics, matchPlans: plans } } });
  },

  queueCall(call) {
    const { game } = get();
    if (!game) return;
    const cur = game.pendingCalls ?? [];
    if (cur.includes(call)) return;
    // Calls cancel their opposite: queueing "push" removes "hold", etc.
    const opposite: Partial<Record<TacticalCall, TacticalCall>> = {
      'speed-up': 'slow-down',
      'slow-down': 'speed-up',
      'stack-a': 'stack-b',
      'stack-b': 'stack-a',
      push: 'hold',
      hold: 'push',
    };
    const next = cur.filter((c) => c !== opposite[call]).concat(call);
    set({ game: { ...game, pendingCalls: next } });
  },

  removeCall(call) {
    const { game } = get();
    if (!game) return;
    const next = (game.pendingCalls ?? []).filter((c) => c !== call);
    set({ game: { ...game, pendingCalls: next } });
  },

  clearCalls() {
    const { game } = get();
    if (!game) return;
    set({ game: { ...game, pendingCalls: [] } });
  },

  setScoutHours(teamId, hours) {
    const { game } = get();
    if (!game) return;
    const clamped = Math.max(0, Math.min(20, Math.round(hours)));
    const allocs = { ...(game.scoutAllocations ?? {}) };
    if (clamped === 0) delete allocs[teamId];
    else allocs[teamId] = clamped;
    set({ game: { ...game, scoutAllocations: allocs } });
  },

  suggestCounter(opponentTeamId) {
    const { game } = get();
    if (!game) return;
    const opp = game.teams[opponentTeamId];
    if (!opp) return;
    const accuracy = game.opponentScouts?.[opponentTeamId]?.accuracy ?? 0;
    if (accuracy < 0.5) return; // need at least playstyle reveal to suggest

    // Generate the AI's tactics deterministically (same seed used in engineTeam).
    const oppTactics = aiTacticsFor(opp);
    const userTeam = game.teams[game.userTeamId];
    const maxPoints = Math.round(10 + (userTeam.coachSkill - 10) * 0.5);

    // Allocate prep based on opp's tendencies.
    let pistols = 1;
    let defaults = 1;
    let executes = 1;
    let antiEcos = 1;
    // Explosive playstyles want more execute prep; slow-defaults want more default prep.
    if (oppTactics.tPlaystyle === 'explosive') executes += 3;
    else if (oppTactics.tPlaystyle === 'slow-default') defaults += 3;
    else if (oppTactics.tPlaystyle === 'mixed') { executes += 1; defaults += 1; }
    else defaults += 2; // default playstyle
    // Heavy force-buy teams = anti-eco prep matters less; eco-disciplined teams = anti-eco matters more.
    if (oppTactics.forceBuyTendency >= 11) executes += 1;
    else antiEcos += 1;
    // Pistols always have value at higher accuracy
    if (accuracy >= 0.75) pistols += 2;

    // Cap to maxPoints
    const total = () => pistols + defaults + executes + antiEcos;
    const fields = ['defaults', 'executes', 'antiEcos', 'pistols'] as const;
    const vals: Record<(typeof fields)[number], number> = {
      defaults,
      executes,
      antiEcos,
      pistols,
    };
    while (total() > maxPoints) {
      const biggest = fields.reduce((a, b) => (vals[b] > vals[a] ? b : a));
      vals[biggest]--;
    }
    // Clamp each to 0-5
    for (const k of fields) vals[k] = Math.max(0, Math.min(5, vals[k]));

    const plans = { ...(game.tactics.matchPlans ?? {}) };
    plans[opponentTeamId] = {
      pistols: vals.pistols,
      defaults: vals.defaults,
      executes: vals.executes,
      antiEcos: vals.antiEcos,
    };

    // Optional 1-shot call queue based on opp aggression.
    const calls: TacticalCall[] = [];
    if (accuracy >= 0.75) {
      if (oppTactics.aggression >= 13) calls.push('hold');
      else if (oppTactics.aggression <= 7) calls.push('push');
    }

    set({
      game: {
        ...game,
        tactics: { ...game.tactics, matchPlans: plans },
        pendingCalls: calls.length ? calls : (game.pendingCalls ?? []),
      },
    });
  },

  setTraining(t) {
    const { game } = get();
    if (!game) return;
    set({ game: { ...game, training: t } });
  },

  hireStaff(staffId) {
    const { game } = get();
    if (!game || !game.staff) return;
    const staff = game.staff[staffId];
    if (!staff || staff.teamId) return;
    const g = structuredClone(game);
    const userTeam = g.teams[g.userTeamId];
    g.staff = g.staff ?? {};
    const targetStaff = g.staff[staffId];
    if (!targetStaff) return;
    // Replace any existing hire in the same role slot
    userTeam.staffIds = userTeam.staffIds ?? [];
    const existingInRole = userTeam.staffIds
      .map((id) => g.staff![id])
      .filter((s): s is Staff => !!s)
      .find((s) => s.role === targetStaff.role);
    if (existingInRole) {
      // Fire the incumbent (mutual: they go back to the free agent pool with no contract)
      userTeam.staffIds = userTeam.staffIds.filter((id) => id !== existingInRole.id);
      existingInRole.teamId = null;
      existingInRole.contract = null;
    }
    // Negotiate: ask wage = +10% over their listed wage
    const wage = Math.round(targetStaff.wage * 1.1 / 500) * 500;
    const expires = `${parseInt(g.currentDate.slice(0, 4)) + 2}-01-05`;
    targetStaff.teamId = userTeam.id;
    targetStaff.contract = { wage, expires };
    userTeam.staffIds.push(targetStaff.id);
    // Sync Head Coach onto legacy fields so the match engine bonus updates immediately.
    if (targetStaff.role === 'HeadCoach') {
      userTeam.coachName = targetStaff.name;
      userTeam.coachSkill = targetStaff.skill;
    }
    g.inbox.push(
      msg(
        g.currentDate,
        'board',
        `${targetStaff.name} joins as ${targetStaff.role.replace(/Coach$/, ' Coach')}`,
        `${targetStaff.name} (skill ${targetStaff.skill}/20) has signed a deal worth $${wage.toLocaleString()}/mo. They'll start affecting development immediately.`,
      ),
    );
    set({ game: g });
  },

  releaseStaff(staffId) {
    const { game } = get();
    if (!game || !game.staff) return;
    const staff = game.staff[staffId];
    if (!staff || staff.teamId !== game.userTeamId) return;
    const g = structuredClone(game);
    const userTeam = g.teams[g.userTeamId];
    userTeam.staffIds = (userTeam.staffIds ?? []).filter((id) => id !== staffId);
    const released = g.staff![staffId];
    released.teamId = null;
    released.contract = null;
    if (released.role === 'HeadCoach') {
      // Engine still needs a coachSkill — fall back to a baseline 10 until rehired
      userTeam.coachName = '(vacant)';
      userTeam.coachSkill = 10;
    }
    set({ game: g });
  },

  acceptSponsorOffer(offerId) {
    const { game } = get();
    if (!game) return;
    const offer = (game.sponsorOffers ?? []).find((o) => o.id === offerId);
    if (!offer) return;
    const g = structuredClone(game);
    const applied = applySponsorOffer(g, offer);
    if (!applied) return;
    playSound('sponsor-signed');
    {
      const sponsor = g.sponsors?.[offer.sponsorId];
      if (sponsor) {
        const newsRng = new RNG(hashSeed(`news-sponsor-${offer.id}`));
        postsForSponsor(g, g.userTeamId, sponsor.name, newsRng);
      }
    }
    g.sponsorOffers = (g.sponsorOffers ?? []).filter((o) => o.id !== offerId);
    const sponsor = g.sponsors?.[offer.sponsorId];
    g.inbox.push(
      msg(
        g.currentDate,
        'finance',
        `${sponsor?.brand ?? offer.sponsorId} signed`,
        `${sponsor?.name} are now a ${sponsor?.tier} sponsor — $${offer.monthlyValue.toLocaleString()}/month for ${offer.lengthMonths} months.`,
      ),
    );
    set({ game: g });
  },

  rejectSponsorOffer(offerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    g.sponsorOffers = (g.sponsorOffers ?? []).filter((o) => o.id !== offerId);
    set({ game: g });
  },

  answerPress(conferenceId, questionId, optionIndex) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const conf = (g.pressConferences ?? []).find((c) => c.id === conferenceId);
    const question = conf?.questions.find((q) => q.id === questionId);
    const opt = question?.options[optionIndex];
    applyPressAnswer(g, conferenceId, questionId, optionIndex);
    // FM-style: also push an inbox echo so the user has a permanent record of what they said.
    if (conf && question && opt) {
      const opp = conf.contextTeamId ? g.teams[conf.contextTeamId]?.name : 'the match';
      const kindLabel = conf.kind === 'pre-match' ? 'Pre-match' : 'Post-match';
      const tonePill = opt.tone.charAt(0).toUpperCase() + opt.tone.slice(1);
      const lines: string[] = [
        `${kindLabel} press conference vs ${opp ?? 'opponent'} — your answer is now public.`,
        '',
        `Q: ${question.question}`,
        `Your answer (${tonePill} tone): "${opt.answer}"`,
        '',
        `Squad morale ${opt.moraleDelta >= 0 ? '+' : ''}${opt.moraleDelta} · ` +
          `Board confidence ${opt.confidenceDelta >= 0 ? '+' : ''}${opt.confidenceDelta} · ` +
          `Media trust ${opt.mediaTrustDelta >= 0 ? '+' : ''}${opt.mediaTrustDelta}`,
        '',
        `The quote will run in tomorrow's news.`,
      ];
      g.inbox.push({
        id: `msg-press-${conf.id}-${optionIndex}-${Date.now().toString(36)}`,
        date: g.currentDate,
        category: 'board',
        subject: `${kindLabel} presser: "${opt.answer.slice(0, 60)}${opt.answer.length > 60 ? '…' : ''}"`,
        body: lines.join('\n'),
        read: false,
      });
    }
    // Remove answered conferences from the pending list
    g.pressConferences = (g.pressConferences ?? []).filter((c) => !c.answered);
    set({ game: g });
  },

  respondToConcern(concernId, optionIndex) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const summary = applyConcernResponse(g, concernId, optionIndex);
    g.playerConcerns = (g.playerConcerns ?? []).filter((c) => c.id !== concernId);
    if (summary) {
      g.inbox.push(msg(g.currentDate, 'board', 'Concern resolved', summary));
    }
    set({ game: g });
  },

  setPlayerFocus(playerId, focus) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const p = g.players[playerId];
    if (!p) return;
    if (focus === 'auto') delete p.individualFocus;
    else p.individualFocus = focus;
    set({ game: g });
  },

  setPlayerDevelopmentTarget(playerId, target) {
    const { game } = get();
    if (!game) return;
    const p = game.players[playerId];
    if (!p || p.teamId !== game.userTeamId) return;
    const g = structuredClone(game);
    if (target === null) delete g.players[playerId].developmentTarget;
    else g.players[playerId].developmentTarget = target;
    set({ game: g });
  },

  scheduleScrimmage(opponentTeamId, map) {
    const { game } = get();
    if (!game) return;
    const opp = game.teams[opponentTeamId];
    if (!opp || opponentTeamId === game.userTeamId) return;
    // Build engine teams using existing helper (resolves tactics, role slots, etc.)
    const a = engineTeam(game, game.userTeamId);
    const b = engineTeam(game, opponentTeamId);
    // Sim a single map BO1 — minimal pressure since it's just a scrim
    const seed = hashSeed(`scrim-${game.currentDate}-${opponentTeamId}-${map}`);
    const result = simulateMatch(`scrim-${game.currentDate}-${opponentTeamId}`, a, b, 'BO1', MAP_LAYOUTS, 0.05, seed);
    const g = structuredClone(game);
    // Apply mild fatigue + form/morale effects (less than a real match)
    const won = result.winnerId === g.userTeamId;
    const userTeam = g.teams[g.userTeamId];
    for (const id of userTeam.playerIds.slice(0, 5)) {
      const p = g.players[id];
      if (!p) continue;
      p.fatigue = Math.min(100, p.fatigue + 3);
      p.form = Math.max(1, Math.min(20, p.form + (won ? 0.3 : -0.1)));
      p.morale = Math.max(1, Math.min(20, p.morale + (won ? 0.2 : -0.1)));
    }
    const mapRes = result.maps[0];
    const userIsA = result.teamAId === g.userTeamId;
    const userScore = userIsA ? mapRes.scoreA : mapRes.scoreB;
    const oppScore = userIsA ? mapRes.scoreB : mapRes.scoreA;
    g.inbox.push(
      msg(
        g.currentDate,
        'training',
        `Scrim ${won ? 'win' : 'loss'} vs ${opp.tag} on ${map}`,
        `Practice match result: ${userScore}-${oppScore} on ${map}.\nNo prize money or ranking points, but the squad got match reps and ${won ? 'a confidence boost' : 'a reminder there\'s work to do'}.`,
      ),
    );
    playSound(won ? 'round-win' : 'round-loss');
    set({ game: g });
  },

  setActiveFive(ids) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const team = g.teams[g.userTeamId];
    const rest = team.playerIds.filter((id) => !ids.includes(id));
    team.playerIds = [...ids, ...rest];
    set({ game: g });
  },
  listPlayer(id, listed) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    g.players[id].transferListed = listed;
    set({ game: g });
  },

  respondOffer(offerId, accept) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const offer = g.offers.find((o) => o.id === offerId);
    if (!offer || offer.status !== 'pending') return;
    const p = g.players[offer.playerId];
    const buyer = g.teams[offer.fromTeamId];
    const user = g.teams[g.userTeamId];
    if (accept) {
      offer.status = 'accepted';
      user.budget += offer.fee;
      buyer.budget -= offer.fee;
      user.playerIds = user.playerIds.filter((x) => x !== offer.playerId);
      buyer.playerIds.push(offer.playerId);
      p.teamId = buyer.id;
      appendClubHistory(p, buyer.id, buyer.name, g.currentDate);
      p.contract = { wage: offer.wage, expires: addDays(g.currentDate, 365 * 2), buyout: offer.fee * 1.2 };
      g.inbox.push(msg(g.currentDate, 'transfer', `${p.nickname} sold to ${buyer.name}`, `Transfer complete for $${offer.fee.toLocaleString()}. New balance: $${user.budget.toLocaleString()}.`));
      // squad morale dips slightly when a player is sold
      for (const id of user.playerIds) {
        const tp = g.players[id];
        if (tp) tp.morale = Math.max(1, tp.morale - 0.5);
      }
    } else {
      offer.status = 'rejected';
    }
    g.offers = g.offers.filter((o) => o.status === 'pending');
    set({ game: g });
    get().saveGame();
  },

  counterIncomingOffer(offerId, counterFee) {
    const { game } = get();
    if (!game || counterFee <= 0) return;
    const g = structuredClone(game);
    const offer = g.offers.find((o) => o.id === offerId);
    if (!offer || offer.direction !== 'in' || offer.status !== 'pending') return;
    const p = g.players[offer.playerId];
    const bidder = g.teams[offer.fromTeamId];
    const user = g.teams[g.userTeamId];
    if (!p || !bidder || !user) return;

    const round = (offer.feeRound ?? 1) + 1;
    offer.feeRound = round;
    offer.log = [
      ...(offer.log ?? [{ date: offer.date, line: `${bidder.name} bid $${offer.fee.toLocaleString()} for ${p.nickname}.` }]),
      { date: g.currentDate, line: `You countered with $${counterFee.toLocaleString()}.` },
    ];

    // Bidder's hard cap — what they're really willing to pay for this player.
    // Mirrors clubValuation from the user's negotiation flow.
    const valuation = clubValuation(p, user);
    // Aggressive bidders may go up to 15% over valuation; capped by their budget.
    const bidderCap = Math.min(bidder.budget, Math.round(valuation * 1.15));

    // Accept if counter is within 95% of their cap — they grumble but pay up.
    if (counterFee <= bidderCap * 0.95) {
      offer.fee = counterFee;
      offer.status = 'accepted';
      offer.log.push({ date: g.currentDate, line: `${bidder.name} accepted the counter — deal done!` });
      // Execute the sale, mirroring respondOffer's accept branch.
      user.budget += counterFee;
      bidder.budget -= counterFee;
      user.playerIds = user.playerIds.filter((x) => x !== p.id);
      bidder.playerIds.push(p.id);
      p.teamId = bidder.id;
      appendClubHistory(p, bidder.id, bidder.name, g.currentDate);
      p.contract = {
        wage: offer.wage,
        expires: addDays(g.currentDate, 365 * 2),
        buyout: counterFee * 1.2,
      };
      g.inbox.push(
        msg(
          g.currentDate,
          'transfer',
          `${p.nickname} sold to ${bidder.name} for $${counterFee.toLocaleString()}`,
          `Your counter of $${counterFee.toLocaleString()} was accepted. New balance: $${user.budget.toLocaleString()}.`,
        ),
      );
      // Squad morale dips when a player is sold.
      for (const id of user.playerIds) {
        const tp = g.players[id];
        if (tp) tp.morale = Math.max(1, tp.morale - 0.5);
      }
      // Empty their slot in tactics if they were starting.
      syncRoleSlotsWithFirstTeam(g);
      g.offers = g.offers.filter((o) => o.status === 'pending');
    } else if (round < 3 && counterFee <= bidderCap * 1.25) {
      // Bidder counters BACK at a meeting point between their original bid and your ask.
      const newBid = Math.round(((offer.fee + Math.min(counterFee, bidderCap)) / 2) / 5000) * 5000;
      offer.fee = newBid;
      offer.log.push({
        date: g.currentDate,
        line: `${bidder.name} counter at $${newBid.toLocaleString()} — that's their position.`,
      });
    } else {
      // Walk away.
      offer.status = 'rejected';
      offer.log.push({
        date: g.currentDate,
        line: `${bidder.name} walked away — your asking price is above their valuation of $${valuation.toLocaleString()}.`,
      });
      g.offers = g.offers.filter((o) => o.status === 'pending');
    }

    set({ game: g });
  },

  bidForPlayer(playerId, fee) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const p = g.players[playerId];
    const user = g.teams[g.userTeamId];
    if (!p.teamId || fee > user.budget) return;
    const seller = g.teams[p.teamId];
    // acceptance: fee vs asking price + whether listed
    const ratio = fee / Math.max(1, p.askingPrice);
    const acceptP = p.transferListed ? Math.min(0.95, ratio * 0.7) : Math.min(0.85, (ratio - 0.6) * 0.8);
    const rng = new RNG(hashSeed(playerId + g.currentDate + fee));
    if (rng.chance(Math.max(0, acceptP))) {
      user.budget -= fee;
      seller.budget += fee;
      seller.playerIds = seller.playerIds.filter((x) => x !== playerId);
      user.playerIds.push(playerId);
      p.teamId = user.id;
      appendClubHistory(p, user.id, user.name, g.currentDate);
      p.contract = {
        wage: Math.round((p.contract?.wage ?? 12000) * 1.15),
        expires: addDays(g.currentDate, 365 * 2),
        buyout: Math.round(fee * 1.3),
      };
      p.morale = Math.min(20, p.morale + 2);
      p.squadTier = p.age <= 19 ? 'youth' : 'reserve';
      g.inbox.push(msg(g.currentDate, 'transfer', `${p.nickname} signs!`, `${p.nickname} joins from ${seller.name} for $${fee.toLocaleString()}. Balance: $${user.budget.toLocaleString()}. Slotted into ${p.squadTier === 'youth' ? 'the academy' : 'reserves'} — promote when ready.`));
      {
        const newsRng = new RNG(hashSeed(`news-transfer-${p.id}-${g.currentDate}`));
        postsForTransfer(g, p.id, seller.id, user.id, fee, newsRng);
      }
      // Seller club immediately scans the FA pool for a replacement.
      replenishAISquad(g, seller.id, p.role, rng, g.currentDate);
    } else {
      g.inbox.push(msg(g.currentDate, 'transfer', `Bid rejected for ${p.nickname}`, `${seller.name} rejected your $${fee.toLocaleString()} bid. Their valuation is around $${p.askingPrice.toLocaleString()}.`));
    }
    set({ game: g });
    get().saveGame();
  },

  signFreeAgent(playerId, wage) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const p = g.players[playerId];
    if (p.teamId) return;
    const user = g.teams[g.userTeamId];
    const minWage = Math.round(80 * p.currentAbility);
    if (wage < minWage * 0.8) {
      g.inbox.push(msg(g.currentDate, 'transfer', `${p.nickname} declines`, `${p.nickname} wants at least $${minWage.toLocaleString()}/month.`));
    } else {
      p.teamId = user.id;
      appendClubHistory(p, user.id, user.name, g.currentDate);
      p.contract = { wage, expires: addDays(g.currentDate, 365 * 2), buyout: p.askingPrice };
      // New signings go to reserves by default — promote them from the Squad screen.
      p.squadTier = p.age <= 19 ? 'youth' : 'reserve';
      user.playerIds.push(playerId);
      g.inbox.push(msg(g.currentDate, 'transfer', `${p.nickname} joins on a free`, `${p.nickname} signed for $${wage.toLocaleString()}/month until ${p.contract.expires}. Currently in ${p.squadTier === 'youth' ? 'the academy' : 'reserves'} — promote from the Squad screen when ready.`));
    }
    set({ game: g });
    get().saveGame();
  },

  // ============ Two-stage negotiation ============

  submitBid(playerId, fee) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const p = g.players[playerId];
    const user = g.teams[g.userTeamId];
    if (!p || !p.teamId || p.teamId === user.id) return;
    if (fee > user.budget) return;
    const seller = g.teams[p.teamId];
    const rng = new RNG(hashSeed(`bid-${playerId}-${g.currentDate}-${fee}`));
    const resp = evaluateClubFee(p, fee, seller, 0, rng);

    const offer: TransferOffer = {
      id: `offer-${g.currentDate}-${nextOfferId++}`,
      date: g.currentDate,
      fromTeamId: user.id,
      playerId,
      fee,
      wage: 0,
      direction: 'out',
      status:
        resp.type === 'accept'
          ? 'personal-terms'
          : resp.type === 'counter'
            ? 'club-counter'
            : 'rejected',
      expiresOn: addDays(g.currentDate, 7),
      feeRound: 1,
      agent: agentFor(p),
      log: [{ date: g.currentDate, line: `You submitted a bid of $${fee.toLocaleString()} to ${seller.name}.` }],
    };
    if (resp.type === 'counter') {
      offer.counterFee = resp.counterFee;
      offer.counterReason = resp.reason;
      offer.log!.push({ date: g.currentDate, line: resp.reason });
    } else if (resp.type === 'accept') {
      offer.fee = fee;
      offer.log!.push({ date: g.currentDate, line: `${seller.name} accepted! Open personal terms with ${p.nickname}.` });
    } else if (resp.type === 'reject') {
      offer.log!.push({ date: g.currentDate, line: resp.reason });
      g.inbox.push(msg(g.currentDate, 'transfer', `${seller.name} reject $${fee.toLocaleString()} bid`, resp.reason));
    }
    g.offers.push(offer);
    set({ game: g });
  },

  acceptCounter(offerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const offer = g.offers.find((o) => o.id === offerId);
    if (!offer || offer.status !== 'club-counter' || !offer.counterFee) return;
    const user = g.teams[g.userTeamId];
    if (offer.counterFee > user.budget) return;
    offer.fee = offer.counterFee;
    offer.counterFee = undefined;
    offer.status = 'personal-terms';
    offer.log = [...(offer.log ?? []), { date: g.currentDate, line: `You accepted the counter at $${offer.fee.toLocaleString()}. Now personal terms.` }];
    set({ game: g });
  },

  counterBack(offerId, newFee) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const offer = g.offers.find((o) => o.id === offerId);
    if (!offer || offer.status !== 'club-counter') return;
    const user = g.teams[g.userTeamId];
    if (newFee > user.budget) return;
    const p = g.players[offer.playerId];
    const seller = p?.teamId ? g.teams[p.teamId] : undefined;
    const round = (offer.feeRound ?? 1) + 1;
    offer.fee = newFee;
    offer.feeRound = round;
    offer.log = [...(offer.log ?? []), { date: g.currentDate, line: `You countered with $${newFee.toLocaleString()}.` }];
    const rng = new RNG(hashSeed(`counter-${offerId}-${round}`));
    const resp = evaluateClubFee(p, newFee, seller, round, rng);
    if (resp.type === 'accept') {
      offer.status = 'personal-terms';
      offer.counterFee = undefined;
      offer.log.push({ date: g.currentDate, line: `${seller?.name} accepted! Now personal terms.` });
    } else if (resp.type === 'counter') {
      offer.status = 'club-counter';
      offer.counterFee = resp.counterFee;
      offer.counterReason = resp.reason;
      offer.log.push({ date: g.currentDate, line: resp.reason });
    } else {
      offer.status = 'rejected';
      offer.log.push({ date: g.currentDate, line: resp.reason });
    }
    set({ game: g });
  },

  submitPersonalTerms(offerId, terms) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const offer = g.offers.find((o) => o.id === offerId);
    if (!offer || (offer.status !== 'personal-terms' && offer.status !== 'player-counter')) return;
    const p = g.players[offer.playerId];
    if (!p) return;
    const user = g.teams[g.userTeamId];
    const rng = new RNG(hashSeed(`terms-${offerId}-${terms.wage}`));
    const round = (offer.feeRound ?? 1); // reuse round counter loosely
    const resp = evaluatePersonalTerms(p, terms, g.teams, user.id, round, offer.agent ?? agentFor(p), rng);
    offer.personalTerms = terms;
    offer.log = [...(offer.log ?? []), { date: g.currentDate, line: `Personal terms offered: $${terms.wage.toLocaleString()}/mo for ${terms.contractYears}yr${terms.signingBonus ? ` + $${terms.signingBonus.toLocaleString()} signing` : ''}.` }];
    if (resp.type === 'accept') {
      // Close the deal!
      if (user.budget < offer.fee + (terms.signingBonus ?? 0)) {
        offer.status = 'rejected';
        offer.log.push({ date: g.currentDate, line: `Couldn't complete — insufficient budget after fee + signing bonus.` });
        set({ game: g });
        return;
      }
      const seller = p.teamId ? g.teams[p.teamId] : null;
      // Pay sell-on to any beneficiary from previous deals.
      const sellOnPaid = applySellOnPayout(g, p, offer.fee);
      user.budget -= offer.fee + (terms.signingBonus ?? 0);
      if (seller) {
        seller.budget += offer.fee - sellOnPaid;
        seller.playerIds = seller.playerIds.filter((x) => x !== p.id);
      }
      user.playerIds.push(p.id);
      p.teamId = user.id;
      appendClubHistory(p, user.id, user.name, g.currentDate);
      const previousTeamId = seller?.id ?? null;
      p.contract = {
        wage: terms.wage,
        expires: addDays(g.currentDate, 365 * terms.contractYears),
        buyout: terms.buyoutClause ?? Math.round(offer.fee * 1.5),
        bonuses: {
          signing: terms.signingBonus,
          perMajorWin: terms.perMajorBonus,
          perPodium: terms.perPodiumBonus,
        },
        sellOnPercent: terms.sellOnPercent,
        sellOnBeneficiary: terms.sellOnPercent && previousTeamId ? previousTeamId : undefined,
      };
      p.morale = Math.min(20, p.morale + 2);
      p.squadTier = p.age <= 19 ? 'youth' : 'reserve';
      offer.status = 'accepted';
      offer.log.push({ date: g.currentDate, line: `🎉 ${p.nickname} signs!` });
      g.inbox.push(
        msg(
          g.currentDate,
          'transfer',
          `${p.nickname} signs for ${user.name}`,
          `Fee: $${offer.fee.toLocaleString()}. Wage: $${terms.wage.toLocaleString()}/mo on a ${terms.contractYears}-year deal.${terms.signingBonus ? ` Signing bonus $${terms.signingBonus.toLocaleString()}.` : ''}${sellOnPaid > 0 ? ` Sell-on of $${sellOnPaid.toLocaleString()} paid to previous club.` : ''}`,
        ),
      );
      // Seller club scans the FA pool for a replacement so they don't run short.
      if (seller) {
        replenishAISquad(g, seller.id, p.role, rng, g.currentDate);
      }
    } else if (resp.type === 'counter') {
      offer.status = 'player-counter';
      offer.playerCounterTerms = resp.demand;
      offer.playerCounterReason = resp.reason;
      offer.log.push({ date: g.currentDate, line: resp.reason });
    } else {
      offer.status = 'rejected';
      offer.log.push({ date: g.currentDate, line: resp.reason });
    }
    set({ game: g });
  },

  withdrawBid(offerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const offer = g.offers.find((o) => o.id === offerId);
    if (!offer || offer.direction !== 'out') return;
    offer.status = 'withdrawn';
    offer.log = [...(offer.log ?? []), { date: g.currentDate, line: 'You withdrew from the negotiation.' }];
    set({ game: g });
  },

  triggerBuyout(playerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const p = g.players[playerId];
    if (!p || !p.contract || !p.teamId) return;
    const user = g.teams[g.userTeamId];
    const buyout = p.contract.buyout;
    if (user.budget < buyout) {
      g.inbox.push(msg(g.currentDate, 'transfer', `Buyout failed`, `You can't afford the $${buyout.toLocaleString()} release clause for ${p.nickname}.`));
      set({ game: g });
      return;
    }
    // Triggering the buyout immediately puts the deal into Stage 2 personal terms.
    const offer: TransferOffer = {
      id: `offer-${g.currentDate}-${nextOfferId++}`,
      date: g.currentDate,
      fromTeamId: user.id,
      playerId,
      fee: buyout,
      wage: 0,
      direction: 'out',
      status: 'personal-terms',
      expiresOn: addDays(g.currentDate, 7),
      feeRound: 1,
      agent: agentFor(p),
      log: [
        { date: g.currentDate, line: `You triggered the $${buyout.toLocaleString()} release clause for ${p.nickname}.` },
        { date: g.currentDate, line: `Selling club must accept. Now open personal terms.` },
      ],
    };
    g.offers.push(offer);
    set({ game: g });
  },

  matchRivalBid(offerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const offer = g.offers.find((o) => o.id === offerId);
    if (!offer || !offer.rivalBid) return;
    const user = g.teams[g.userTeamId];
    if (offer.rivalBid.fee > user.budget) return;
    offer.fee = offer.rivalBid.fee;
    offer.log = [...(offer.log ?? []), { date: g.currentDate, line: `You matched the rival's $${offer.rivalBid.fee.toLocaleString()} bid.` }];
    const p = g.players[offer.playerId];
    const seller = p?.teamId ? g.teams[p.teamId] : undefined;
    const rng = new RNG(hashSeed(`match-${offerId}`));
    const resp = evaluateClubFee(p, offer.fee, seller, offer.feeRound ?? 1, rng);
    offer.rivalBid = undefined;
    if (resp.type === 'accept') {
      offer.status = 'personal-terms';
      offer.log.push({ date: g.currentDate, line: `${seller?.name} accepted. Now personal terms.` });
    } else if (resp.type === 'counter') {
      offer.status = 'club-counter';
      offer.counterFee = resp.counterFee;
      offer.counterReason = resp.reason;
      offer.log.push({ date: g.currentDate, line: resp.reason });
    } else {
      offer.status = 'rejected';
      offer.log.push({ date: g.currentDate, line: resp.reason });
    }
    set({ game: g });
  },

  // ============ Loans ============

  loanOut(playerId, toTeamId, months, wageContribution) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const p = g.players[playerId];
    const toTeam = g.teams[toTeamId];
    if (!p || p.teamId !== g.userTeamId || !toTeam) return;
    // Sanity: never loan to yourself, and never re-loan a player already on loan.
    if (toTeamId === g.userTeamId) return;
    if ((g.loans ?? []).some((l) => l.playerId === playerId)) {
      g.inbox.push(msg(g.currentDate, 'transfer', 'Loan blocked', `${p.nickname} is already out on loan.`));
      set({ game: g });
      return;
    }
    if (g.teams[g.userTeamId].playerIds.length <= 5) {
      g.inbox.push(msg(g.currentDate, 'transfer', 'Loan blocked', `You can't loan players out while at 5-man roster.`));
      set({ game: g });
      return;
    }
    // Cap the recipient's wage share at 70% — real-world loans rarely shift the
    // full wage. Stops "loan with 100% contribution" from being a free wage
    // dump on expensive stars.
    const cappedContribution = Math.max(0, Math.min(0.7, wageContribution));
    const monthsClamped = Math.max(1, Math.min(12, Math.round(months)));
    // One-time loan admin fee — small but enough to discourage spam-loaning
    // a star out and back for tactical wage savings. Scales with wage so
    // dumping a $50K/month star isn't trivial.
    const wage = p.contract?.wage ?? 10000;
    const adminFee = Math.max(5_000, Math.round(wage * monthsClamped * 0.05));
    const user = g.teams[g.userTeamId];
    if (user.budget < adminFee) {
      g.inbox.push(msg(g.currentDate, 'transfer', 'Loan blocked', `You can't cover the $${adminFee.toLocaleString()} admin fee for this loan.`));
      set({ game: g });
      return;
    }
    user.budget -= adminFee;
    g.loans = g.loans ?? [];
    const loan: LoanDeal = {
      id: `loan-${g.currentDate}-${nextOfferId++}`,
      playerId,
      fromTeamId: g.userTeamId,
      toTeamId,
      startDate: g.currentDate,
      endDate: addDays(g.currentDate, monthsClamped * 30),
      wageContribution: cappedContribution,
      recallProtected: false,
    };
    g.loans.push(loan);
    // Move player from user squad to the loan-recipient squad (temporarily).
    user.playerIds = user.playerIds.filter((x) => x !== playerId);
    toTeam.playerIds.push(playerId);
    p.teamId = toTeam.id;
    g.inbox.push(
      msg(
        g.currentDate,
        'transfer',
        `${p.nickname} loaned to ${toTeam.name}`,
        `Loan runs until ${fmtDateShort(loan.endDate)}.\n` +
          `${toTeam.name} covers ${Math.round(loan.wageContribution * 100)}% of his $${wage.toLocaleString()}/mo wage — you pay the remaining ${Math.round((1 - loan.wageContribution) * 100)}%.\n` +
          `Admin fee charged: $${adminFee.toLocaleString()}.`,
      ),
    );
    syncRoleSlotsWithFirstTeam(g);
    set({ game: g });
  },

  recallLoan(loanId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const loan = g.loans?.find((l) => l.id === loanId);
    if (!loan || loan.recallProtected) return;
    // Recall is only valid for the user's own loans (and only when initiated
    // from the user side). Silently bail otherwise — no UI path triggers this
    // but it closes the door on console / save-edit shenanigans.
    if (loan.fromTeamId !== g.userTeamId) return;
    const p = g.players[loan.playerId];
    if (!p) return;
    const toTeam = g.teams[loan.toTeamId];
    const fromTeam = g.teams[loan.fromTeamId];
    // Player must still be at the loan recipient. If they've been transferred
    // or released during the loan the deal is void — drop the record without
    // teleporting the player back (that was the exploit).
    const stillAtRecipient = p.teamId === loan.toTeamId && toTeam?.playerIds.includes(loan.playerId);
    if (!stillAtRecipient) {
      g.loans = (g.loans ?? []).filter((l) => l.id !== loanId);
      g.inbox.push(
        msg(
          g.currentDate,
          'transfer',
          `Recall failed — ${p.nickname} no longer at ${toTeam?.name ?? 'the loan club'}`,
          `${p.nickname}'s situation changed during the loan and they cannot be brought back. The loan deal has lapsed.`,
        ),
      );
      set({ game: g });
      return;
    }
    if (toTeam) toTeam.playerIds = toTeam.playerIds.filter((x) => x !== loan.playerId);
    if (fromTeam) fromTeam.playerIds.push(loan.playerId);
    p.teamId = loan.fromTeamId;
    g.loans = (g.loans ?? []).filter((l) => l.id !== loanId);
    g.inbox.push(msg(g.currentDate, 'transfer', `${p.nickname} recalled from loan`, `Loan terminated early. ${p.nickname} is back at ${fromTeam?.name ?? 'the parent club'}.`));
    set({ game: g });
  },

  releasePlayer(playerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const user = g.teams[g.userTeamId];
    if (user.playerIds.length <= 5) return; // can't go below a full roster
    user.playerIds = user.playerIds.filter((x) => x !== playerId);
    const p = g.players[playerId];
    p.teamId = null;
    const payoff = Math.round((p.contract?.wage ?? 0) * 2);
    user.budget -= payoff;
    p.contract = null;
    g.inbox.push(msg(g.currentDate, 'transfer', `${p.nickname} released`, `Contract terminated with a $${payoff.toLocaleString()} settlement.`));
    syncRoleSlotsWithFirstTeam(g);
    set({ game: g });
    get().saveGame();
  },

  renewContract(playerId, wage, years) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const p = g.players[playerId];
    const expected = Math.round(80 * p.currentAbility);
    if (wage < expected * 0.85) {
      g.inbox.push(msg(g.currentDate, 'transfer', `${p.nickname} rejects terms`, `${p.nickname} expects around $${expected.toLocaleString()}/month.`));
    } else {
      p.contract = { wage, expires: addDays(g.currentDate, 365 * years), buyout: p.askingPrice * 1.2 };
      p.morale = Math.min(20, p.morale + 1.5);
      g.inbox.push(msg(g.currentDate, 'transfer', `${p.nickname} extends`, `New deal: $${wage.toLocaleString()}/month for ${years} year(s).`));
    }
    set({ game: g });
    get().saveGame();
  },

  scoutPlayer(playerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const cost = 15000;
    const user = g.teams[g.userTeamId];
    if (user.budget < cost) return;
    user.budget -= cost;
    g.scoutReports[playerId] = { playerId, date: g.currentDate, accuracy: 1 };
    const p = g.players[playerId];
    g.inbox.push(msg(g.currentDate, 'scouting', `Scout report: ${p.nickname}`, `Full report on ${p.nickname} (${p.role}, ${p.age}) is available. Current ability ${p.currentAbility}, potential ${p.potentialAbility}.`));
    set({ game: g });
  },

  interactPlayer(playerId, kind) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    g.interactions = g.interactions ?? {};
    const last = g.interactions[playerId];
    if (last && addDays(last, 7) > g.currentDate) return; // once a week per player
    const p = g.players[playerId];
    if (!p || p.teamId !== g.userTeamId) return;
    g.interactions[playerId] = g.currentDate;
    const rng = new RNG(hashSeed(playerId + g.currentDate + kind));
    let reaction: string;
    if (kind === 'praise') {
      if (p.form >= 11 || rng.chance(0.3)) {
        p.morale = Math.min(20, p.morale + 1.5);
        reaction = `${p.nickname} appreciated the praise and looks motivated.`;
      } else {
        p.morale = Math.max(1, p.morale - 0.5);
        reaction = `${p.nickname} feels the praise was hollow given recent form.`;
      }
    } else {
      // criticism: composed/low-form players respond, fragile ones crumble
      if (p.form < 10 && (p.attributes.composure >= 12 || rng.chance(0.4))) {
        p.form = Math.min(20, p.form + 1);
        p.morale = Math.max(1, p.morale - 0.3);
        reaction = `${p.nickname} accepted the criticism and is determined to prove you wrong.`;
      } else {
        p.morale = Math.max(1, p.morale - 1.5);
        reaction = `${p.nickname} reacted badly to the criticism.`;
      }
    }
    g.inbox.push(msg(g.currentDate, 'board', `Talk with ${p.nickname}`, reaction));
    set({ game: g });
  },

  markInboxRead(id) {
    const { game } = get();
    if (!game) return;
    const g = { ...game, inbox: game.inbox.map((m) => (m.id === id ? { ...m, read: true } : m)) };
    set({ game: g });
  },
  markAllRead() {
    const { game } = get();
    if (!game) return;
    set({ game: { ...game, inbox: game.inbox.map((m) => ({ ...m, read: true })) } });
  },

  setPlayerSquadTier(playerId, tier) {
    const { game } = get();
    if (!game) return;
    const p = game.players[playerId];
    if (!p || p.teamId !== game.userTeamId) return;
    const g = structuredClone(game);
    g.players[playerId].squadTier = tier;
    // Reorder team.playerIds so first-tier comes first, then reserve, then youth.
    const team = g.teams[g.userTeamId];
    const tierRank = (id: string): number => {
      const t = g.players[id]?.squadTier ?? 'first';
      return t === 'first' ? 0 : t === 'reserve' ? 1 : 2;
    };
    team.playerIds.sort((a, b) => tierRank(a) - tierRank(b));
    // Auto-sync the tactical role slots so a player promoted to first-team
    // actually appears in the match lineup. When the user explicitly promotes
    // (tier === 'first') we pass the player id so the sync will bump the
    // weakest current slot occupant out to reserves if all 5 slots are full —
    // otherwise the new player would float in first-team without ever playing.
    syncRoleSlotsWithFirstTeam(g, tier === 'first' ? playerId : undefined);
    set({ game: g });
  },

  openCase(caseId) {
    const { game } = get();
    if (!game) return null;
    const caseDef = CASES.find((c) => c.id === caseId);
    if (!caseDef) return null;
    const stash = game.managerStash ?? 0;
    if (stash < caseDef.keyPrice) return null;
    const g = structuredClone(game);
    g.managerStash = (g.managerStash ?? 0) - caseDef.keyPrice;
    g.managerInventory ??= [];
    const rng = new RNG(hashSeed(`case-${caseId}-${g.currentDate}-${nextOfferId++}`));
    const result = openCaseSim(
      caseDef,
      rng,
      g.currentDate,
      () => `skin-${Date.now().toString(36)}-${nextOfferId++}`,
    );
    g.managerInventory.push(result.instance);
    // Rare drops get an inbox blurb so users notice big hits even if they
    // skip the animation.
    if (result.instance.rarity === 'rare-special' || result.instance.rarity === 'covert') {
      g.inbox.push(
        msg(
          g.currentDate,
          'finance',
          `🎰 ${result.instance.rarity === 'rare-special' ? 'KNIFE DROP' : 'COVERT DROP'}: ${result.instance.weapon} | ${result.instance.name}`,
          `You unboxed a ${result.instance.statTrak ? 'StatTrak™ ' : ''}${result.instance.weapon} | ${result.instance.name} (${result.instance.wear}) from a ${caseDef.name}.\n\nMarket value: $${result.instance.marketValue.toLocaleString()}\n\nSell it from the Cases screen or keep it as a trophy.`,
        ),
      );
    }
    set({ game: g });
    return result;
  },

  openDailyFreeCase() {
    const { game } = get();
    if (!game) return null;
    if (game.lastFreeCaseDate === game.currentDate) return null; // already claimed today
    const caseDef = CASES.find((c) => c.id === DAILY_FREE_CASE_ID);
    if (!caseDef) return null;
    const g = structuredClone(game);
    g.managerInventory ??= [];
    g.lastFreeCaseDate = g.currentDate;
    const rng = new RNG(hashSeed(`free-case-${g.currentDate}-${nextOfferId++}`));
    const result = openCaseSim(
      caseDef,
      rng,
      g.currentDate,
      () => `skin-${Date.now().toString(36)}-${nextOfferId++}`,
    );
    g.managerInventory.push(result.instance);
    if (result.instance.rarity === 'rare-special' || result.instance.rarity === 'covert') {
      g.inbox.push(
        msg(
          g.currentDate,
          'finance',
          `🎁 Free daily case → ${result.instance.rarity === 'rare-special' ? 'KNIFE' : 'COVERT'}!`,
          `Your daily case dropped a ${result.instance.statTrak ? 'StatTrak™ ' : ''}${result.instance.weapon} | ${result.instance.name} (${result.instance.wear}) worth $${result.instance.marketValue.toLocaleString()}.`,
        ),
      );
    }
    set({ game: g });
    return result;
  },

  tradeUp(skinIds) {
    const { game } = get();
    if (!game) return null;
    const inv = game.managerInventory ?? [];
    const inputs = skinIds.map((id) => inv.find((s) => s.id === id)).filter(Boolean) as import('../types').SkinInstance[];
    if (inputs.length !== 10) return null;
    const g = structuredClone(game);
    const rng = new RNG(hashSeed(`tradeup-${g.currentDate}-${skinIds.join('|')}-${nextOfferId++}`));
    const result = tradeUpContract(
      inputs,
      rng,
      g.currentDate,
      () => `skin-${Date.now().toString(36)}-${nextOfferId++}`,
    );
    if (!result) return null;
    // Remove the 10 consumed inputs from inventory.
    const idSet = new Set(skinIds);
    g.managerInventory = (g.managerInventory ?? []).filter((s) => !idSet.has(s.id));
    g.managerInventory.push(result);
    g.inbox.push(
      msg(
        g.currentDate,
        'finance',
        `📋 Trade-up: ${result.weapon} | ${result.name}`,
        `Your 10-piece trade-up contract yielded a ${result.statTrak ? 'StatTrak™ ' : ''}${result.weapon} | ${result.name} (${result.wear}). Market value: $${result.marketValue.toLocaleString()}.`,
      ),
    );
    set({ game: g });
    return result;
  },

  openSouvenirPackage() {
    const { game } = get();
    if (!game) return null;
    if ((game.pendingSouvenirs ?? 0) <= 0) return null;
    const g = structuredClone(game);
    g.pendingSouvenirs = (g.pendingSouvenirs ?? 0) - 1;
    g.managerInventory ??= [];
    const rng = new RNG(hashSeed(`souvenir-${g.currentDate}-${nextOfferId++}`));
    const skin = openSouvenirSim(rng, g.currentDate, () => `skin-${Date.now().toString(36)}-${nextOfferId++}`);
    g.managerInventory.push(skin);
    set({ game: g });
    return skin;
  },

  sellSkin(instanceId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const inv = g.managerInventory ?? [];
    const idx = inv.findIndex((s) => s.id === instanceId);
    if (idx === -1) return;
    const skin = inv[idx];
    g.managerStash = (g.managerStash ?? 0) + skin.marketValue;
    inv.splice(idx, 1);
    g.managerInventory = inv;
    set({ game: g });
  },

  placeBet(matchId, pickedTeamId, stake) {
    const { game } = get();
    if (!game || stake <= 0) return null;
    const stash = game.managerStash ?? 0;
    if (stake > stash) return null;
    const sched = game.schedule.find((m) => m.id === matchId);
    if (!sched || !isBettable(sched, game.currentDate)) return null;
    if (pickedTeamId !== sched.teamAId && pickedTeamId !== sched.teamBId) return null;
    // Don't allow double-betting on the same match.
    if ((game.sportsbookBets ?? []).some((b) => b.matchId === matchId && b.status === 'pending')) {
      return null;
    }
    const teamA = game.teams[sched.teamAId];
    const teamB = game.teams[sched.teamBId];
    if (!teamA || !teamB) return null;
    const odds = decimalOdds(game, teamA, teamB);
    const pickedOdds = pickedTeamId === sched.teamAId ? odds.oddsA : odds.oddsB;
    const tournament = game.tournaments[sched.tournamentId];
    const bet: import('../types').SportsbookBet = {
      id: `bet-${++nextOfferId}-${Date.now().toString(36)}`,
      matchId,
      placedOn: game.currentDate,
      tournamentName: tournament?.name ?? sched.tournamentId,
      roundLabel: sched.roundLabel,
      teamAId: sched.teamAId,
      teamBId: sched.teamBId,
      teamATag: teamA.tag,
      teamBTag: teamB.tag,
      pickedTeamId,
      pickedTeamTag: pickedTeamId === sched.teamAId ? teamA.tag : teamB.tag,
      stake,
      odds: pickedOdds,
      potentialPayout: Math.round(stake * pickedOdds),
      status: 'pending',
    };
    const g = structuredClone(game);
    g.managerStash = (g.managerStash ?? 0) - stake;
    g.sportsbookBets = [...(g.sportsbookBets ?? []), bet];
    set({ game: g });
    return bet;
  },

  cancelBet(betId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const bets = g.sportsbookBets ?? [];
    const idx = bets.findIndex((b) => b.id === betId);
    if (idx === -1) return;
    const bet = bets[idx];
    if (bet.status !== 'pending') return;
    // Refund only if match hasn't started.
    const sched = g.schedule.find((m) => m.id === bet.matchId);
    if (sched && !isBettable(sched, g.currentDate)) return;
    g.managerStash = (g.managerStash ?? 0) + bet.stake;
    bets.splice(idx, 1);
    g.sportsbookBets = bets;
    set({ game: g });
  },

  acceptManagerJobOffer(offerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const offer = (g.managerJobOffers ?? []).find((o) => o.id === offerId);
    if (!offer || !g.manager) return;
    transitionToNewClub(g, offer.teamId, 'left-for-better-job');
    // Sign-on bonus + clear all pending offers (new club, fresh slate).
    const newTeam = g.teams[g.userTeamId];
    if (newTeam) newTeam.budget += offer.signOnBonus;
    g.managerJobOffers = [];
    g.inbox.push(
      msg(
        g.currentDate,
        'board',
        `Welcome to ${newTeam?.name}`,
        `You've accepted the ${offer.teamName} job. A $${offer.signOnBonus.toLocaleString()} sign-on bonus has been added to the club budget. The board will set new season objectives shortly.`,
      ),
    );
    if (g.manager) saveManager(g.manager);
    set({ game: g });
  },

  declineManagerJobOffer(offerId) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    g.managerJobOffers = (g.managerJobOffers ?? []).filter((o) => o.id !== offerId);
    set({ game: g });
  },

  resignFromJob() {
    const { game } = get();
    if (!game || !game.manager) return;
    const g = structuredClone(game);
    enterUnattachedState(g, 'resigned');
    g.inbox.push(
      msg(
        g.currentDate,
        'board',
        `You've resigned from ${g.teams[game.userTeamId]?.name}`,
        `You stepped down as head coach. Expect rebound offers from interested clubs within the next few weeks.`,
      ),
    );
    if (g.manager) saveManager(g.manager);
    set({ game: g });
  },

  applyManagerCall(call) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    const team = g.teams[g.userTeamId];
    if (!team) return;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    for (const id of team.playerIds.slice(0, 5)) {
      const p = g.players[id];
      if (!p) continue;
      switch (call) {
        case 'rally':
          // Big morale boost, small form bump — for clutch losses / behind on score
          p.morale = clamp(p.morale + 1.2, 1, 20);
          p.form = clamp(p.form + 0.4, 1, 20);
          break;
        case 'calm':
          // Composure-based steadying — drops fatigue/anxiety, slight form recovery
          p.morale = clamp(p.morale + 0.5, 1, 20);
          p.fatigue = clamp(p.fatigue - 4, 0, 100);
          break;
        case 'aggressive':
          // High-risk: form spike but morale tax if you're already up
          p.form = clamp(p.form + 1.0, 1, 20);
          p.morale = clamp(p.morale - 0.3, 1, 20);
          break;
      }
    }
    set({ game: g });
  },

  timeoutsRemaining() {
    if (!liveSeries) return 0;
    const userIsA = liveSeries.a.team.isUser;
    const userIsB = liveSeries.b.team.isUser;
    if (!userIsA && !userIsB) return 0;
    const remaining = liveSeries.timeoutsRemaining ?? { a: 2, b: 2 };
    return userIsA ? remaining.a : remaining.b;
  },

  callTimeout(fromRoundIdx) {
    const { game } = get();
    if (!game) return { ok: false, remaining: 0, error: 'No game.' };
    if (!liveSeries) return { ok: false, remaining: 0, error: 'No live match.' };
    const userIsA = liveSeries.a.team.isUser;
    const userIsB = liveSeries.b.team.isUser;
    if (!userIsA && !userIsB) return { ok: false, remaining: 0, error: 'User not playing.' };
    const remaining = liveSeries.timeoutsRemaining ?? { a: 2, b: 2 };
    const userKey: 'a' | 'b' = userIsA ? 'a' : 'b';
    if (remaining[userKey] <= 0) {
      return { ok: false, remaining: 0, error: 'No timeouts remaining on this map.' };
    }
    // Re-build engine teams with the user's CURRENT tactics + pendingCalls baked in
    const opponentId = userIsA ? liveSeries.b.team.id : liveSeries.a.team.id;
    const calls = game.pendingCalls;
    const refreshedUser = engineTeam(game, userIsA ? liveSeries.a.team.id : liveSeries.b.team.id, opponentId, calls);
    if (userIsA) liveSeries.a = refreshedUser;
    else liveSeries.b = refreshedUser;
    // The current (last simulated) map is the one we adjust mid-flight
    const mapIdx = liveSeries.maps.length - 1;
    if (mapIdx < 0) return { ok: false, remaining: remaining[userKey], error: 'No map yet.' };
    const original = liveSeries.maps[mapIdx];
    const layout = liveSeries.layouts[original.map];
    const clampedFrom = Math.max(0, Math.min(original.rounds.length - 1, fromRoundIdx));
    const updated = resimulateMapFromRound(
      original,
      clampedFrom,
      liveSeries.a,
      liveSeries.b,
      layout,
      liveSeries.pressure,
      hashSeed(`${liveSeries.matchId}-timeout-${mapIdx}-${remaining[userKey]}`),
    );
    liveSeries.maps[mapIdx] = updated;
    liveSeries.timeoutsRemaining = { ...remaining, [userKey]: remaining[userKey] - 1 };
    // Consume any pending calls used in the refresh
    if (calls && calls.length) {
      const g = structuredClone(game);
      g.pendingCalls = [];
      set({ game: g, liveMatch: seriesResult(liveSeries) });
    } else {
      set({ liveMatch: seriesResult(liveSeries) });
    }
    return { ok: true, remaining: remaining[userKey] - 1 };
  },

  // ============ Mod / database editing ============
  editTeam(teamId, patch) {
    const { game } = get();
    if (!game || !game.teams[teamId]) return;
    const g = structuredClone(game);
    g.teams[teamId] = { ...g.teams[teamId], ...patch, id: teamId };
    set({ game: g });
  },

  editPlayer(playerId, patch) {
    const { game } = get();
    if (!game || !game.players[playerId]) return;
    const g = structuredClone(game);
    const old = g.players[playerId];
    const next = { ...old, ...patch, id: playerId };
    // If teamId changed, rewire team rosters
    if (patch.teamId !== undefined && patch.teamId !== old.teamId) {
      if (old.teamId && g.teams[old.teamId]) {
        g.teams[old.teamId].playerIds = g.teams[old.teamId].playerIds.filter((id) => id !== playerId);
      }
      if (patch.teamId && g.teams[patch.teamId]) {
        if (!g.teams[patch.teamId].playerIds.includes(playerId)) {
          g.teams[patch.teamId].playerIds.push(playerId);
        }
      }
    }
    g.players[playerId] = next;
    set({ game: g });
  },

  addCustomPlayer(player) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    if (g.players[player.id]) return; // id collision — caller must pick a unique id
    g.players[player.id] = player;
    if (player.teamId && g.teams[player.teamId]) {
      if (!g.teams[player.teamId].playerIds.includes(player.id)) {
        g.teams[player.teamId].playerIds.push(player.id);
      }
    }
    set({ game: g });
  },

  addCustomTeam(team) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    if (g.teams[team.id]) return;
    // Ensure required mapPool exists — fall back to a generic average pool
    if (!team.mapPool || team.mapPool.length === 0) {
      team.mapPool = (['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Vertigo', 'Dust2'] as const).map(
        (map) => ({ map, proficiency: 10 }),
      );
    }
    if (!team.playerIds) team.playerIds = [];
    if (team.worldRanking === undefined) team.worldRanking = Object.keys(g.teams).length + 1;
    if (team.rankingPoints === undefined) team.rankingPoints = 0;
    g.teams[team.id] = team;
    set({ game: g });
  },

  removeCustomPlayer(playerId) {
    const { game } = get();
    if (!game || !game.players[playerId]) return;
    // Block deleting your own players — would corrupt the user save
    if (game.players[playerId].teamId === game.userTeamId) return;
    const g = structuredClone(game);
    const p = g.players[playerId];
    if (p.teamId && g.teams[p.teamId]) {
      g.teams[p.teamId].playerIds = g.teams[p.teamId].playerIds.filter((id) => id !== playerId);
    }
    delete g.players[playerId];
    set({ game: g });
  },

  removeCustomTeam(teamId) {
    const { game } = get();
    if (!game || !game.teams[teamId]) return;
    if (teamId === game.userTeamId) return; // never delete user's own team
    const g = structuredClone(game);
    // Release players to free agency
    for (const pid of g.teams[teamId].playerIds) {
      if (g.players[pid]) {
        g.players[pid].teamId = null;
        g.players[pid].contract = null;
      }
    }
    delete g.teams[teamId];
    set({ game: g });
  },

  addCustomSponsor(sponsor) {
    const { game } = get();
    if (!game) return;
    const g = structuredClone(game);
    if (!g.sponsors) g.sponsors = {};
    if (g.sponsors[sponsor.id]) return;
    g.sponsors[sponsor.id] = sponsor;
    set({ game: g });
  },

  editCustomSponsor(sponsorId, patch) {
    const { game } = get();
    if (!game || !game.sponsors?.[sponsorId]) return;
    const g = structuredClone(game);
    g.sponsors![sponsorId] = { ...g.sponsors![sponsorId], ...patch, id: sponsorId };
    set({ game: g });
  },

  removeCustomSponsor(sponsorId) {
    const { game } = get();
    if (!game || !game.sponsors?.[sponsorId]) return;
    const g = structuredClone(game);
    delete g.sponsors![sponsorId];
    // Drop any active deals on this sponsor
    for (const team of Object.values(g.teams)) {
      if (team.sponsorDeals) {
        team.sponsorDeals = team.sponsorDeals.filter((d) => d.sponsorId !== sponsorId);
      }
    }
    set({ game: g });
  },

  exportModPack() {
    const { game } = get();
    if (!game) return '{}';
    const pack = {
      version: 1,
      exportedAt: new Date().toISOString(),
      teams: game.teams,
      players: game.players,
      sponsors: game.sponsors ?? {},
    };
    return JSON.stringify(pack, null, 2);
  },

  importModPack(json) {
    const { game } = get();
    if (!game) return { ok: false, error: 'No active game.' };
    let pack: { teams?: Record<string, import('../types').Team>; players?: Record<string, import('../types').Player>; sponsors?: Record<string, import('../types').Sponsor> };
    try {
      pack = JSON.parse(json);
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
    }
    if (!pack || typeof pack !== 'object') return { ok: false, error: 'Pack must be an object.' };
    const g = structuredClone(game);
    // Mod packs MERGE — they don't blow away the user's career save.
    if (pack.teams) {
      for (const [id, t] of Object.entries(pack.teams)) {
        if (id === g.userTeamId) continue; // never overwrite the user's own team
        g.teams[id] = { ...t, id };
      }
    }
    if (pack.players) {
      for (const [id, p] of Object.entries(pack.players)) {
        if (g.players[id]?.teamId === g.userTeamId) continue; // never overwrite the user's own players
        g.players[id] = { ...p, id };
      }
    }
    if (pack.sponsors) {
      if (!g.sponsors) g.sponsors = {};
      for (const [id, s] of Object.entries(pack.sponsors)) {
        g.sponsors[id] = { ...s, id };
      }
    }
    // Re-sync team rosters from player.teamId — guards against orphan entries in the pack
    for (const team of Object.values(g.teams)) team.playerIds = [];
    for (const p of Object.values(g.players)) {
      if (p.teamId && g.teams[p.teamId]) g.teams[p.teamId].playerIds.push(p.id);
    }
    set({ game: g });
    return { ok: true };
  },
}));

// ============ helpers operating on draft state ============

/** Close the manager's current career stint with a reason + final stats. */
function closeCurrentStint(
  g: GameState,
  reason: 'sacked' | 'resigned' | 'retired' | 'left-for-better-job',
): void {
  if (!g.manager || g.manager.career.length === 0) return;
  const stint = g.manager.career[g.manager.career.length - 1];
  if (stint.endDate) return;
  stint.endDate = g.currentDate;
  stint.reason = reason;
  const rank = g.teams[g.userTeamId]?.worldRanking;
  if (rank && (stint.bestRank == null || rank < stint.bestRank)) {
    stint.bestRank = rank;
  }
}

/** Switch the manager to a new club. Closes current stint, flips userTeamId,
 *  rebuilds tactics from the new team's roster, sets fresh board objectives. */
function transitionToNewClub(
  g: GameState,
  newTeamId: string,
  reason: 'sacked' | 'resigned' | 'left-for-better-job',
): void {
  if (!g.manager) return;
  const oldUserId = g.userTeamId;
  closeCurrentStint(g, reason);
  // Flip isUser flags.
  if (g.teams[oldUserId]) g.teams[oldUserId].isUser = false;
  if (g.teams[newTeamId]) g.teams[newTeamId].isUser = true;
  g.userTeamId = newTeamId;
  g.managerUnattached = false;
  // Open new stint.
  g.manager.career.push({
    teamId: newTeamId,
    teamName: g.teams[newTeamId]?.name ?? newTeamId,
    startDate: g.currentDate,
    trophies: 0,
  });
  // Reset tactics + board for the new club.
  const newTeam = g.teams[newTeamId];
  if (newTeam) {
    g.tactics = {
      ...DEFAULT_TACTICS,
      mapVetoPriority: [...newTeam.mapPool]
        .sort((a, b) => b.proficiency - a.proficiency)
        .map((m) => m.map) as MapName[],
      roleSlots: initialRoleSlots(
        newTeam.playerIds.slice(0, 5).map((id) => g.players[id]).filter(Boolean),
      ),
      mapOverrides: {},
      matchPlans: {},
    };
    g.board = initBoardState(newTeam, g.seasonYear, g.currentDate);
  }
  // Reset per-stint scratch state.
  g.pendingCalls = [];
  g.scoutAllocations = {};
  g.pressConferences = [];
  g.playerConcerns = [];
}

/** Manager becomes unattached after a sack/resign. Fresh objectives + tactics
 *  are wiped; the user is gated to inbox/manager/jobs until they accept a club. */
function enterUnattachedState(
  g: GameState,
  reason: 'sacked' | 'resigned',
): void {
  if (!g.manager) return;
  closeCurrentStint(g, reason);
  if (g.teams[g.userTeamId]) g.teams[g.userTeamId].isUser = false;
  g.managerUnattached = true;
  // Clear board so the home screen doesn't show stale objectives.
  g.board = undefined;
  g.pressConferences = [];
  g.playerConcerns = [];
}

function rolloverSeason(g: GameState): void {
  const oldYear = g.seasonYear;
  const newYear = oldYear + 1;
  const newStart = `${newYear}-01-05`;
  const user = g.teams[g.userTeamId];

  // ===== archive the season before anything resets =====
  const events = Object.values(g.tournaments)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((t) => {
      const state = g.tournamentStates[t.id];
      const championId = state ? Object.entries(state.placements).find(([, p]) => p === 1)?.[0] : undefined;
      const userPlace = state?.placements[g.userTeamId];
      return {
        tournamentName: t.name,
        tier: t.tier,
        championTeamId: championId ?? '',
        championName: championId ? g.teams[championId]?.name ?? '?' : '—',
        userPlacement: userPlace ?? null,
        userPrize: userPlace ? prizeFor(t, userPlace) : 0,
      };
    });
  const ratedPlayers = Object.values(g.players).filter((p) => p.stats.maps >= 20);
  const hltv1 = [...ratedPlayers].sort((a, b) => b.stats.rating - a.stats.rating)[0];
  const userRated = user.playerIds
    .map((id) => g.players[id])
    .filter((p) => p && p.stats.maps > 0)
    .sort((a, b) => b.stats.rating - a.stats.rating)[0];
  const top3 = Object.values(g.teams)
    .sort((a, b) => a.worldRanking - b.worldRanking)
    .slice(0, 3)
    .map((t) => ({ teamId: t.id, name: t.name }));
  g.seasonHistory = [
    ...(g.seasonHistory ?? []),
    {
      year: oldYear,
      userTeamId: g.userTeamId,
      userRank: user.worldRanking,
      worldTop3: top3,
      events,
      playerOfSeason: hltv1
        ? {
            playerId: hltv1.id,
            nickname: hltv1.nickname,
            teamName: hltv1.teamId ? g.teams[hltv1.teamId]?.name ?? 'Free agent' : 'Free agent',
            rating: hltv1.stats.rating,
            maps: hltv1.stats.maps,
          }
        : null,
      userBestPlayer: userRated
        ? { playerId: userRated.id, nickname: userRated.nickname, rating: userRated.stats.rating, maps: userRated.stats.maps }
        : null,
    },
  ];
  // ===== End-of-season awards ceremony =====
  const awards = computeSeasonAwards(g, oldYear);
  if (awards.length > 0) {
    // Attach to the just-archived season record
    const lastRec = g.seasonHistory![g.seasonHistory!.length - 1];
    if (lastRec) lastRec.awards = awards;
    // Append to each player's lifetime honours list
    for (const a of awards) {
      if (!isPlayerAward(a.kind)) continue;
      const p = g.players[a.recipientId];
      if (!p) continue;
      if (!p.honours) p.honours = [];
      p.honours.push({ kind: a.kind as Exclude<typeof a.kind, 'coach-of-year'>, year: a.year, stat: a.stat });
    }
    // Inbox: ceremonial letter to manager
    const lines: string[] = [`The ${oldYear} CS awards ceremony has wrapped. Recipients:`, ''];
    for (const a of awards) {
      const team = a.teamName ? ` (${a.teamName})` : '';
      lines.push(`🏆 ${AWARD_LABEL[a.kind]}: ${a.recipientName}${team}${a.stat ? ` — ${a.stat}` : ''}`);
    }
    // Highlight any user-team winners
    const userWins = awards.filter((a) => a.teamId === g.userTeamId);
    if (userWins.length > 0) {
      lines.push('', `Congratulations to ${user.name} for ${userWins.length} award${userWins.length === 1 ? '' : 's'} this season.`);
    }
    g.inbox.push({
      id: `msg-awards-${oldYear}`,
      date: g.currentDate,
      category: 'tournament',
      subject: `🏆 ${oldYear} Season Awards Ceremony`,
      body: lines.join('\n'),
      read: false,
    });
    // News posts — one ceremony-style post per major award (cap-limited by category)
    const newsRng = new RNG(hashSeed(`news-awards-${oldYear}`));
    for (const a of awards) {
      const text = `🏆 ${oldYear} ${AWARD_LABEL[a.kind]}: ${a.recipientName}${a.teamName ? ` (${a.teamName})` : ''}${a.stat ? ` — ${a.stat}.` : '.'}`;
      g.news?.unshift({
        id: `news-award-${oldYear}-${a.kind}-${a.recipientId}`,
        date: g.currentDate,
        authorId: 'press-hltv',
        text,
        category: 'milestone',
        taggedTeamIds: a.teamId ? [a.teamId] : undefined,
        taggedPlayerIds: isPlayerAward(a.kind) ? [a.recipientId] : undefined,
        likes: newsRng.int(2000, 12000),
        reposts: newsRng.int(300, 2000),
        comments: [],
      });
    }
  }

  if (hltv1) {
    g.inbox.push({
      id: `msg-hltv1-${oldYear}`,
      date: g.currentDate,
      category: 'tournament',
      subject: `${hltv1.nickname} named ${oldYear} Player of the Year`,
      body: `${hltv1.nickname} (${hltv1.teamId ? g.teams[hltv1.teamId]?.name : 'Free agent'}) takes the award with a ${hltv1.stats.rating.toFixed(2)} rating over ${hltv1.stats.maps} maps.`,
      read: false,
    });
  }

  // season review
  const squadBest = user.playerIds
    .map((id) => g.players[id])
    .filter((p) => p && p.stats.maps > 0)
    .sort((a, b) => b.stats.rating - a.stats.rating)[0];
  g.inbox.push({
    id: `msg-season-${oldYear}`,
    date: g.currentDate,
    category: 'board',
    subject: `${oldYear} season review`,
    body:
      `${user.name} end the ${oldYear} season ranked #${user.worldRanking} in the world.\n` +
      (squadBest
        ? `Player of the season: ${squadBest.nickname} (${squadBest.stats.rating.toFixed(2)} rating over ${squadBest.stats.maps} maps).\n`
        : '') +
      `Budget: $${user.budget.toLocaleString()}.\nThe ${newYear} circuit begins on January 5.`,
    read: false,
  });

  // players: age, reset season stats, recover
  for (const p of Object.values(g.players)) {
    p.age++;
    p.stats = { maps: 0, kills: 0, deaths: 0, assists: 0, rating: 1.0, clutchesWon: 0, openingKills: 0, utilityDamage: 0 };
    p.fatigue = 0;
    p.form = 10;
  }

  // ===== retirement (after aging, before contract expiry handling) =====
  // Snapshot star retirees BEFORE deletion so we can post retirement news.
  const lifecycleRng = new RNG(hashSeed(`lifecycle-${newYear}-${g.userTeamId}`));
  const preRetireSnapshots = Object.values(g.players)
    .filter((p) => p.age >= 28)
    .map((p) => ({ id: p.id, snapshot: structuredClone(p) }));
  const retireEvents = attemptRetirements(g, g.currentDate, lifecycleRng);
  if (retireEvents.length > 0) {
    g.inbox.push({
      id: `msg-retire-class-${oldYear}`,
      date: g.currentDate,
      category: 'tournament',
      subject: `${retireEvents.length} players retire from competitive play`,
      body: `End of the ${oldYear} season — ${retireEvents.length} veterans hang up the mouse. The free agent pool is open and a new academy class arrives shortly.`,
      read: false,
    });
    const newsRng = new RNG(hashSeed(`news-retire-${newYear}`));
    for (const ev of retireEvents) {
      const snap = preRetireSnapshots.find((s) => s.id === ev.playerId)?.snapshot;
      // Rich farewell inbox letter — user-team retirees + stars only.
      if (snap && (ev.wasOnUserTeam || ev.wasStar)) {
        const clubsLine =
          ev.hof.clubs.length > 0 ? ev.hof.clubs.map((c) => c.teamName).join(' → ') : 'free agent';
        const honoursCount = ev.hof.honours.length;
        const honoursLine =
          honoursCount > 0
            ? `${honoursCount} career ${honoursCount === 1 ? 'honour' : 'honours'} won.`
            : 'No major honours — but a respected pro nonetheless.';
        // Find a teammate quote (use a friend or mentor if one exists).
        let teammateQuote = '';
        const rels = (g.relationships ?? []).filter(
          (r) =>
            (r.kind === 'friend' || r.kind === 'mentor') &&
            (r.fromId === ev.playerId || r.toId === ev.playerId),
        );
        if (rels.length > 0) {
          const r = rels[0];
          const matePid = r.fromId === ev.playerId ? r.toId : r.fromId;
          const mate = g.players[matePid];
          if (mate) {
            const quotes = [
              `"Honoured to have shared a server with ${ev.nickname}. A pro's pro."`,
              `"Going to miss ${ev.nickname} in the team house. One of the greats."`,
              `"${ev.nickname} taught me what it means to grind. Legend."`,
            ];
            teammateQuote = `\n\n— ${mate.nickname} (former teammate): ${quotes[(ev.playerId.length + matePid.length) % quotes.length]}`;
          }
        }
        const subject = ev.wasOnUserTeam
          ? `Farewell to ${ev.nickname} — retires from your roster`
          : `${ev.nickname} retires from competitive play`;
        g.inbox.push({
          id: `msg-retire-${ev.playerId}-${g.currentDate}`,
          date: g.currentDate,
          category: ev.wasOnUserTeam ? 'transfer' : 'tournament',
          subject,
          body:
            `${ev.hof.fullName} "${ev.nickname}" (age ${ev.hof.retiredAge}, ${ev.hof.role}) is stepping away from competitive play.\n\n` +
            `Career: ${clubsLine}\n` +
            `${ev.hof.careerMaps} maps · ${ev.hof.careerRating.toFixed(2)} avg rating · HOF score ${ev.hof.hofScore}\n` +
            `${honoursLine}` +
            teammateQuote +
            `\n\nHis full Hall of Fame entry is now archived.`,
          read: false,
        });
      }
      // News posts for star retirees only.
      if (snap && ev.wasStar) {
        g.players[ev.playerId] = snap;
        postsForRetirement(g, ev.playerId, newsRng);
        delete g.players[ev.playerId];
      }
      // Wonderkid Whisperer achievement: if a user-team retiree with strong HOF score (developed under your watch).
      if (ev.wasOnUserTeam && ev.hof.hofScore >= 200 && g.manager) {
        if (!g.manager.achievements.some((a) => a.id === 'wonderkid-whisperer')) {
          g.manager.achievements.push({
            id: 'wonderkid-whisperer',
            unlockedOn: g.currentDate,
            context: `${ev.nickname} (HOF ${ev.hof.hofScore})`,
          });
          g.manager.reputation = Math.max(0, Math.min(100, g.manager.reputation + 3));
          g.inbox.push({
            id: `msg-mgr-whisperer-${ev.playerId}`,
            date: g.currentDate,
            category: 'board',
            subject: `Achievement unlocked: Wonderkid Whisperer`,
            body: `Your stewardship of ${ev.nickname} through to a Hall of Fame retirement has been recognised. Your manager reputation rises.`,
            read: false,
          });
        }
      }
    }
  }

  // Re-loop for contract expiry (skipping anyone we just retired)
  for (const p of Object.values(g.players)) {
    // expiring contracts
    if (p.contract && p.contract.expires <= newStart) {
      const team = p.teamId ? g.teams[p.teamId] : null;
      const rng = new RNG(hashSeed(p.id + newYear));
      const aiRenews = team && !team.isUser && (team.playerIds.length <= 5 || rng.chance(0.6));
      if (aiRenews && team) {
        p.contract = {
          wage: Math.round((p.contract.wage * rng.range(1.0, 1.2)) / 500) * 500,
          expires: `${newYear + 1 + rng.int(0, 1)}-01-05`,
          buyout: p.contract.buyout,
        };
      } else {
        if (team) {
          team.playerIds = team.playerIds.filter((x) => x !== p.id);
          if (team.isUser) {
            g.inbox.push({
              id: `msg-expire-${p.id}-${newYear}`,
              date: g.currentDate,
              category: 'transfer',
              subject: `${p.nickname}'s contract has expired`,
              body: `${p.nickname} leaves ${team.name} as a free agent. Re-sign him from the free agent market if you want him back.`,
              read: false,
            });
          }
        }
        p.teamId = null;
        p.contract = null;
      }
    }
  }

  // board safety net: user team must field five — emergency-sign best free agents
  if (user.playerIds.length < 5) {
    const signed: string[] = [];
    while (user.playerIds.length < 5) {
      const fa = Object.values(g.players)
        .filter((p) => !p.teamId)
        .sort((a, b) => b.currentAbility - a.currentAbility)[0];
      if (!fa) break;
      fa.teamId = user.id;
      fa.contract = { wage: Math.max(8000, Math.round((fa.currentAbility * 300 - 20000) / 500) * 500), expires: `${newYear + 1}-01-05`, buyout: fa.askingPrice };
      user.playerIds.push(fa.id);
      signed.push(fa.nickname);
    }
    if (signed.length) {
      g.inbox.push({
        id: `msg-emergency-${newYear}`,
        date: g.currentDate,
        category: 'board',
        subject: 'Board signs emergency replacements',
        body: `With the roster short of five players, the board stepped in and signed: ${signed.join(', ')} on one-year deals. Manage your contracts to avoid this.`,
        read: false,
      });
    }
  }

  // AI teams below 5 players sign best available free agents
  for (const team of Object.values(g.teams)) {
    if (team.isUser) continue;
    while (team.playerIds.length < 5) {
      const fa = Object.values(g.players)
        .filter((p) => !p.teamId)
        .sort((a, b) => b.currentAbility - a.currentAbility)[0];
      if (!fa) break;
      fa.teamId = team.id;
      fa.contract = { wage: Math.max(8000, Math.round((fa.currentAbility * 300 - 20000) / 500) * 500), expires: `${newYear + 2}-01-05`, buyout: fa.askingPrice };
      team.playerIds.push(fa.id);
    }
  }

  // ranking points decay, fresh circuit
  for (const t of Object.values(g.teams)) t.rankingPoints = Math.round(t.rankingPoints / 2);
  recomputeRankings(g.teams);

  g.seasonYear = newYear;
  g.currentDate = newStart;
  g.tournaments = generateSeasonTournaments(newYear, g.teams, g.userTeamId);
  g.tournamentStates = {};
  g.schedule = [];
  g.offers = [];

  // Fresh season board mandates — gives the new year its own narrative.
  if (!g.managerUnattached) {
    g.boardMandates = generateSeasonMandates(g, newYear, new RNG(hashSeed(`mandates-${newStart}`)));
    if ((g.boardMandates?.length ?? 0) > 0) {
      g.inbox.push(
        msg(
          newStart,
          'board',
          `Board sets ${g.boardMandates!.length} objective${g.boardMandates!.length === 1 ? '' : 's'} for ${newYear}`,
          `The board's expectations for ${newYear}:\n\n` +
            g.boardMandates!.map((m) => `• ${m.label} — ${m.detail}`).join('\n\n'),
        ),
      );
    }
  }

  // ===== staff contract expiry =====
  // Coaches with expired contracts: AI teams auto-renew their valuable staff;
  // user team coaches leave (with an inbox notice) if not renewed manually.
  if (g.staff) {
    for (const staff of Object.values(g.staff)) {
      if (!staff.contract || !staff.teamId) continue;
      if (staff.contract.expires > newStart) continue;
      const team = g.teams[staff.teamId];
      if (!team) continue;
      const aiRenews = !team.isUser && lifecycleRng.chance(0.75);
      if (aiRenews) {
        staff.contract = {
          wage: Math.round(staff.contract.wage * lifecycleRng.range(1.0, 1.15) / 500) * 500,
          expires: `${newYear + 1 + lifecycleRng.int(0, 1)}-01-05`,
        };
      } else {
        team.staffIds = (team.staffIds ?? []).filter((id) => id !== staff.id);
        if (team.isUser) {
          g.inbox.push({
            id: `msg-staff-expire-${staff.id}-${newYear}`,
            date: g.currentDate,
            category: 'board',
            subject: `${staff.name}'s deal has expired`,
            body: `${staff.name} (${staff.role}) is no longer under contract. Rehire them from the Staff market or sign a replacement.`,
            read: false,
          });
          if (staff.role === 'HeadCoach') {
            team.coachName = '(vacant)';
            team.coachSkill = 10;
          }
        }
        staff.teamId = null;
        staff.contract = null;
      }
    }
  }

  // ===== youth intake: 24 newgens enter the free agent pool =====
  generateYouthIntake(g, newYear, lifecycleRng);

  // Refresh social fabric — drop relationships for retired/released players + add a
  // few new vet→rookie mentor ties for the academy class.
  refreshRelationships(g, newStart);

  // ===== sponsor expiry + renewals =====
  // Any deal whose expiresDate has passed gets dropped. Up to max slots refilled
  // with current-rank-appropriate sponsors. New deals reflect new ranking.
  const sponsorSweep = processSponsorExpiry(g, newStart);
  if (sponsorSweep.signed + sponsorSweep.renewed + sponsorSweep.lost > 0) {
    const userDeals = g.teams[g.userTeamId].sponsorDeals ?? [];
    const totalMonthly = userDeals.reduce((s, d) => s + d.monthlyValue, 0);
    g.inbox.push({
      id: `msg-sponsor-${newYear}`,
      date: g.currentDate,
      category: 'finance',
      subject: `Sponsor portfolio refresh — ${newYear}`,
      body:
        `Sponsor sweep complete: ${sponsorSweep.renewed} renewed, ${sponsorSweep.signed} new signings, ${sponsorSweep.lost} not renewed.\n` +
        `Your active deals (${userDeals.length}): $${totalMonthly.toLocaleString()}/month total.\n` +
        `Higher rank = better deals at renewal. Check Finances → Sponsors for details.`,
      read: false,
    });
  }

  // ===== Board finalisation + new objectives =====
  // Settle any pending objectives (top-finish / profit / avoid-bottom), tally
  // confidence shifts, then set up a fresh slate for the new season.
  if (g.board) {
    const finalised = finaliseObjectives(g, user);
    let netDelta = 0;
    for (const obj of finalised) {
      const delta = obj.status === 'achieved' ? obj.confidenceImpact : -Math.abs(obj.confidenceImpact);
      bumpConfidence(g.board, delta);
      netDelta += delta;
    }
    const achievedCount = finalised.filter((o) => o.status === 'achieved').length;
    const failedCount = finalised.filter((o) => o.status === 'failed').length;
    // Manager profile: reputation drift from board review + end-of-season achievement checks.
    if (g.manager) {
      applyManagerSeasonReview(g, achievedCount, failedCount);
      saveManager(g.manager);
    }
    if (finalised.length > 0) {
      g.inbox.push({
        id: `msg-board-review-${oldYear}`,
        date: g.currentDate,
        category: 'board',
        subject: `Board season review — ${oldYear}`,
        body:
          `Objectives reviewed: ${achievedCount} achieved, ${failedCount} missed.\n` +
          finalised
            .map(
              (o) =>
                `${o.status === 'achieved' ? '✓' : '✗'} ${o.description} (${o.status === 'achieved' ? '+' : ''}${
                  o.status === 'achieved' ? o.confidenceImpact : -Math.abs(o.confidenceImpact)
                })`,
            )
            .join('\n') +
          `\n\nNet confidence change: ${netDelta >= 0 ? '+' : ''}${netDelta}. Now at ${g.board.confidence.toFixed(0)}/100.` +
          (g.board.confidence < 15
            ? `\n⚠ The board has lost faith. A turnaround next season is essential.`
            : ''),
        read: false,
      });
    }
    // Reset objectives for the new season
    const objRng = new RNG(hashSeed(`board-${user.id}-${newYear}`));
    g.board.objectives = generateSeasonObjectives(user, newYear, objRng);
    g.board.lastUpdate = newStart;
    g.inbox.push({
      id: `msg-board-objectives-${newYear}`,
      date: newStart,
      category: 'board',
      subject: `${newYear} season objectives`,
      body:
        `The board has set ${g.board.objectives.length} objectives for ${newYear}:\n` +
        g.board.objectives.map((o) => `• ${o.description}`).join('\n'),
      read: false,
    });
  }

  // ===== state pruning so the save doesn't bloat indefinitely =====
  g.matchHistory = g.matchHistory.slice(-30);
  g.processedDates = [];
  pruneStaleState(g, newStart);
}

function simAiMatchesForDate(g: GameState, date: string): void {
  // repeat until no scheduled AI matches remain on this date (progression may add same-day rounds)
  for (let guard = 0; guard < 10; guard++) {
    const todays = g.schedule.filter(
      (m) => m.date === date && m.status === 'scheduled' && m.teamAId !== g.userTeamId && m.teamBId !== g.userTeamId,
    );
    if (todays.length === 0) break;
    for (const m of todays) {
      const a = engineTeam(g, m.teamAId);
      const b = engineTeam(g, m.teamBId);
      const result = stripFrames(simulateMatch(m.id, a, b, m.format, MAP_LAYOUTS, pressureFor(g, m)));
      m.status = 'finished';
      m.result = result;
      applyMatchAftermath(g.players, result);
      updateSwissRecord(g, m);

      // AI matches post to the news feed when notable so the scene stays alive
      // even when the user isn't playing. "Notable" =
      //   - both teams in top 12
      //   - playoff round at an S/A tier event
      //   - upset (lower-ranked beat higher-ranked by 6+ spots)
      const teamA = g.teams[m.teamAId];
      const teamB = g.teams[m.teamBId];
      const tournament = g.tournaments[m.tournamentId];
      const inTop12 = teamA && teamB && teamA.worldRanking <= 12 && teamB.worldRanking <= 12;
      const isPlayoff = (m.stageName ?? '').toLowerCase().includes('playoff')
        || (m.roundLabel ?? '').toLowerCase().includes('final')
        || (m.roundLabel ?? '').toLowerCase().includes('semi')
        || (m.roundLabel ?? '').toLowerCase().includes('quarter');
      const bigEvent = tournament?.tier === 'S' || tournament?.tier === 'A';
      const upsetGap = teamA && teamB
        ? (result.winnerId === m.teamAId ? teamB.worldRanking - teamA.worldRanking : teamA.worldRanking - teamB.worldRanking)
        : 0;
      // Winner is lower-ranked (higher number) by 6+ → upset
      const isUpset = upsetGap <= -6;
      if (inTop12 || (isPlayoff && bigEvent) || isUpset) {
        const newsRng = new RNG(hashSeed(`news-ai-match-${m.id}`));
        postsForMatch(g, m, result, newsRng);
      }
    }
    progressAllTournaments(g, date);
  }
  progressAllTournaments(g, date);
}

function updateSwissRecord(g: GameState, m: ScheduledMatch): void {
  const state = g.tournamentStates[m.tournamentId];
  if (!state || !m.result) return;
  if (m.stageName === 'Swiss Stage') {
    const winner = m.result.winnerId;
    const loser = winner === m.teamAId ? m.teamBId : m.teamAId;
    state.swissRecords[winner].wins++;
    state.swissRecords[loser].losses++;
  }
}

export function progressAllTournaments(g: GameState, date: string): void {
  for (const t of Object.values(g.tournaments)) {
    const state = g.tournamentStates[t.id];
    if (!state || state.finished) continue;
    const res = progressTournament(t, state, g.schedule, date);
    g.schedule.push(...res.newMatches);
    // payouts for placements decided now
    for (const [teamId, place] of Object.entries(res.newPlacements)) {
      const prize = prizeFor(t, place);
      const pts = pointsFor(t, place);
      const team = g.teams[teamId];
      if (!team) continue;
      team.budget += prize;
      team.rankingPoints += pts;
      team.reputation = Math.min(200, team.reputation + Math.round(pts / 50));
      // Sponsor performance bonuses kick in for top-3 finishes + major wins
      const sponsorBonus = payPerformanceBonus(g, team, t, place);
      // Board confidence reacts to user team placements
      if (teamId === g.userTeamId && g.board) {
        if (t.tier === 'S') {
          if (place === 1) bumpConfidence(g.board, +15);
          else if (place <= 4) bumpConfidence(g.board, +5);
          else if (place > 12) bumpConfidence(g.board, -5);
        } else if (t.tier === 'A') {
          if (place === 1) bumpConfidence(g.board, +8);
          else if (place <= 4) bumpConfidence(g.board, +3);
          else if (place > 12) bumpConfidence(g.board, -3);
        }
        // Re-evaluate objectives after the tournament resolves
        const changed = evaluateObjectives(g, team);
        for (const obj of changed) {
          if (obj.status === 'achieved') {
            bumpConfidence(g.board, obj.confidenceImpact);
            g.inbox.push(
              msg(date, 'board', `Board objective achieved: ${objLabel(obj.type)}`,
                  `${obj.description}\nBoard confidence +${obj.confidenceImpact}. Now at ${g.board.confidence.toFixed(0)}/100.`),
            );
          }
        }
      }
      if (teamId === g.userTeamId) {
        g.inbox.push({
          id: `msg-place-${t.id}-${teamId}`,
          date,
          category: 'tournament',
          subject: `${t.name}: finished #${place}`,
          body:
            `${team.name} placed #${place} at ${t.name}.\n` +
            `Prize money: $${prize.toLocaleString()}\n` +
            (sponsorBonus > 0 ? `Sponsor performance bonus: $${sponsorBonus.toLocaleString()}\n` : '') +
            `Ranking points: +${pts}`,
          read: false,
        });
        // morale boost/hit
        for (const id of team.playerIds) {
          const p = g.players[id];
          if (p) p.morale = Math.max(1, Math.min(20, p.morale + (place <= 4 ? 1.5 : place <= 8 ? 0 : -1)));
        }
      }
    }
    if (res.finishedNow) {
      recomputeRankings(g.teams);
      const champion = Object.entries(state.placements).find(([, p]) => p === 1)?.[0];
      if (champion) {
        g.inbox.push({
          id: `msg-champ-${t.id}`,
          date,
          category: 'tournament',
          subject: `${t.name} — ${g.teams[champion]?.name} are champions`,
          body: `${g.teams[champion]?.name} win ${t.name}, taking home $${prizeFor(t, 1).toLocaleString()}.`,
          read: false,
        });
        // Manager profile: reputation + trophy count + achievement checks (user wins only)
        if (champion === g.userTeamId && g.manager) {
          // Major wins also drop a free Souvenir Package — open from the Cases screen.
          if (t.isMajor) {
            g.pendingSouvenirs = (g.pendingSouvenirs ?? 0) + 1;
            g.inbox.push(
              msg(
                date,
                'finance',
                `🏆 Souvenir Package awarded — ${t.name}`,
                `Winning ${t.name} unlocked a Souvenir Package. Open it from the CS2 Cases screen for a guaranteed bonus drop biased toward higher rarities.`,
              ),
            );
          }
          const unlocked = applyManagerChampionship(g, t, champion);
          if (unlocked.length > 0) {
            const lines = unlocked.map((a) => `🏆 ${a.id.replace(/-/g, ' ')}${a.context ? ` — ${a.context}` : ''}`);
            g.inbox.push({
              id: `msg-mgr-ach-${t.id}`,
              date,
              category: 'board',
              subject: `Achievement unlocked: ${unlocked.length === 1 ? unlocked[0].id.replace(/-/g, ' ') : `${unlocked.length} new`}`,
              body: `Your manager career has crossed new milestones:\n\n${lines.join('\n')}`,
              read: false,
            });
          }
          saveManager(g.manager);
        }
        // News feed: champion celebration
        const newsRng = new RNG(hashSeed(`news-champ-${t.id}`));
        postsForChampion(g, champion, t.name, newsRng);
        // Mid-season sponsor signing — tier-S champions (especially Majors) attract new brand deals.
        // Fire 60% of the time on Majors, 35% on other S-tier wins. Posts to news only — doesn't
        // create a real deal in storage (that happens at season rollover via processSponsorExpiry).
        const sponsorChance = t.isMajor ? 0.6 : (t.tier === 'S' ? 0.35 : 0);
        if (sponsorChance > 0 && newsRng.chance(sponsorChance)) {
          const championTeam = g.teams[champion];
          const candidateSponsors = Object.values(g.sponsors ?? {})
            .filter((s) => s.tier === 'title' || s.tier === 'premium');
          if (championTeam && candidateSponsors.length > 0) {
            const sponsor = candidateSponsors[newsRng.int(0, candidateSponsors.length - 1)];
            postsForSponsor(g, championTeam.id, sponsor.name, newsRng);
            // Inbox echo only if it's the user team
            if (championTeam.id === g.userTeamId) {
              g.inbox.push({
                id: `msg-postchamp-sponsor-${t.id}-${sponsor.id}`,
                date,
                category: 'finance',
                subject: `${sponsor.name} reportedly courting ${championTeam.tag} after ${t.name} win`,
                body: `Industry chatter: ${sponsor.name} are in early talks with ${championTeam.name} following the ${t.name} championship. Expect a formal announcement at the next renewal window.`,
                read: false,
              });
            }
          }
        }
      }
    }
  }
}
