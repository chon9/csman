// ============ Core domain types for CS2 Manager ============

export type PlayerRole = 'IGL' | 'AWPer' | 'Entry' | 'Lurker' | 'Support' | 'Rifler' | 'Anchor';

export type Region = 'Europe' | 'CIS' | 'Americas' | 'Asia';

export type MapName =
  | 'Mirage'
  | 'Inferno'
  | 'Nuke'
  | 'Ancient'
  | 'Anubis'
  | 'Vertigo'
  | 'Dust2';

export const ALL_MAPS: MapName[] = [
  'Mirage',
  'Inferno',
  'Nuke',
  'Ancient',
  'Anubis',
  'Vertigo',
  'Dust2',
];

// FM-style 1-20 attributes. Grouped into TECHNICAL, MENTAL, PHYSICAL for
// presentation in the Player Profile (mirrors FM26's split). Every attribute
// has an engine effect somewhere — none are cosmetic.
export interface PlayerAttributes {
  // ----- TECHNICAL -----
  aim: number;          // raw aim / crosshair placement
  reflexes: number;     // first-contact reaction speed
  positioning: number;  // angle holding, repositioning
  utility: number;      // grenade usage quality (lineups, timing)
  clutch: number;       // 1vX performance modifier
  // ----- MENTAL -----
  gameSense: number;    // reads, timing, info processing
  communication: number;// info sharing quality
  leadership: number;   // mid-round calling impact
  consistency: number;  // narrows day-variance band
  composure: number;    // pressure resistance (big stage)
  resilience: number;   // bouncing back from bad rounds / morale stability
  discipline: number;   // throw discipline, mistake avoidance, rotates on time
  aggression: number;   // tendency to take fights (style, not quality)
  teamwork: number;     // trades, set pieces, executes
  loyalty: number;      // resists rival transfer offers + contract demands
  // ----- PHYSICAL -----
  endurance: number;    // resists fatigue accumulation across long events
}

export type AttributeKey = keyof PlayerAttributes;

export const ATTRIBUTE_KEYS: AttributeKey[] = [
  'aim',
  'reflexes',
  'positioning',
  'utility',
  'clutch',
  'gameSense',
  'communication',
  'leadership',
  'consistency',
  'composure',
  'resilience',
  'discipline',
  'aggression',
  'teamwork',
  'loyalty',
  'endurance',
];

/** Visual grouping for the Player Profile (FM26-style sections). */
export const ATTRIBUTE_GROUPS: { label: string; keys: AttributeKey[] }[] = [
  { label: 'TECHNICAL', keys: ['aim', 'reflexes', 'positioning', 'utility', 'clutch'] },
  { label: 'MENTAL', keys: ['gameSense', 'leadership', 'communication', 'composure', 'resilience', 'discipline', 'consistency', 'aggression', 'teamwork', 'loyalty'] },
  { label: 'PHYSICAL', keys: ['endurance'] },
];

/** Reputation tier surfaced as a badge on the Player Profile. Drives sponsor money + transfer demand. */
export type ReputationTier = 'Superstar' | 'Star' | 'Established' | 'Hot Prospect' | 'Journeyman' | 'Unknown';

export interface Contract {
  wage: number; // monthly USD
  expires: string; // ISO date
  /** Release clause / buyout. Bidders meeting this auto-trigger sale. */
  buyout: number;
  /** Online-mode pacing field: ranked duels remaining on this contract.
   *  Decrements per duel for starters who played; player becomes a FA when
   *  it hits 0. Owner can renew before expiry for a fee. Optional for
   *  backward-compat — undefined = treated as unlimited (legacy contracts). */
  duelsRemaining?: number;
  /** Bonuses paid to the player (per event). Optional, only set when negotiated. */
  bonuses?: {
    /** One-time signing bonus paid at deal completion. */
    signing?: number;
    /** Paid each time the team wins an S-tier event (major). */
    perMajorWin?: number;
    /** Paid each time the team makes a top-3 finish in any tier. */
    perPodium?: number;
  };
  /** Sell-on percentage clause owed to the player's previous club on next sale. */
  sellOnPercent?: number;       // 0-30 typical
  /** Previous club id owed the sell-on cut. */
  sellOnBeneficiary?: string;
}

export interface PlayerSeasonStats {
  maps: number;
  kills: number;
  deaths: number;
  assists: number;
  rating: number; // running avg HLTV-like rating
  clutchesWon: number;
  openingKills: number;
  /** Cumulative utility damage across the season (HEs, mollies, flashes). */
  utilityDamage: number;
}

export type InjuryType =
  | 'wrist-strain'
  | 'rsi'
  | 'back-pain'
  | 'burnout'
  | 'illness'
  | 'wrist-surgery';

export type InjurySeverity = 'minor' | 'moderate' | 'major';

export interface Injury {
  type: InjuryType;
  severity: InjurySeverity;
  /** ISO date when injury started. */
  startedOn: string;
  /** ISO date when the player is cleared to play again. */
  returnDate: string;
  /** Short human-readable description shown on the Player Profile + inbox. */
  description: string;
}

/** Lifetime career honour appended at season rollover. */
export interface PlayerHonour {
  /** Mirror of AwardKind — kept inline so we can extend without circular imports. */
  kind:
    | 'player-of-year'
    | 'rookie-of-year'
    | 'top-fragger'
    | 'clutch-king'
    | 'major-mvp'
    | 'all-star-igl'
    | 'all-star-awper'
    | 'all-star-1'
    | 'all-star-2'
    | 'all-star-3';
  year: number;
  /** Optional stat blurb shown on the profile. */
  stat?: string;
}

export interface Player {
  id: string;
  nickname: string;
  firstName: string;
  lastName: string;
  nationality: string; // country code e.g. 'UA'
  age: number;
  role: PlayerRole;
  /** HLTV player id — drives lazy bodyshot loading from img-cdn.hltv.org/playerbodyshot/{id}.png */
  hltvId?: number;
  /** Mod-supplied custom photo (data URI or external URL). */
  customPhotoUrl?: string;
  /** Optional per-player training override (set by user on PlayerProfile). */
  individualFocus?: IndividualFocus;
  /**
   * Role the manager is developing this player toward — can differ from their
   * natural role. When set, monthly attribute growth weights toward that role's
   * key attributes (from ROLE_WEIGHTS) and the player accumulates extra role
   * experience for it (faster familiarity). Use to convert a Support into a
   * Lurker, an Entry into an AWPer, etc.
   */
  developmentTarget?: PlayerRole;
  /** Active injury — present means the player is unavailable for matches. */
  injury?: Injury;
  /** Lifetime career honours (awards won). Appended at season rollover. */
  honours?: PlayerHonour[];
  /** Teams played for over the career, oldest first. Appended on transfer/sign. */
  clubHistory?: { teamId: string; teamName: string; joinedOn: string }[];
  /**
   * Squad tier — drives match eligibility + UI grouping. Only 'first'-tier
   * players are selected for matches; reserves/youth still get monthly training
   * but stay out of the lineup. Defaults to 'first' for legacy saves.
   */
  squadTier?: 'first' | 'reserve' | 'youth';
  /**
   * Per-role experience points (0+). Drives FM-style positional familiarity:
   * 0=Awkward, 30=Unconvincing, 60=Competent, 100=Accomplished, 150=Natural.
   * The player's natural role starts at 150 (Natural). Other roles seed lower.
   * Increments by ~1 per match played at that role.
   */
  roleExperience?: Partial<Record<PlayerRole, number>>;
  attributes: PlayerAttributes;
  currentAbility: number; // 1-200 derived
  potentialAbility: number; // 1-200
  form: number; // 1-20 rolling
  morale: number; // 1-20
  fatigue: number; // 0-100
  contract: Contract | null;
  teamId: string | null; // null = free agent
  stats: PlayerSeasonStats;
  transferListed: boolean;
  askingPrice: number;
  /** Online-mode booster card applied to this player. Bumps the targeted
   *  attributes for a fixed number of ranked duels, then auto-removes.
   *  attrTargets is optional for backward-compat — pre-library cards
   *  default to {aim, reflexes, positioning, gameSense, clutch}. */
  activeBoost?: {
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
    name: string;
    attrTargets?: (keyof PlayerAttributes)[];
    attrBonus: number;
    duelsLeft: number;
    appliedAt: number;
  };
}

export interface MapPoolRating {
  map: MapName;
  proficiency: number; // 1-20 team comfort on this map
}

export interface Team {
  id: string;
  name: string;
  tag: string;
  region: Region;
  reputation: number; // 1-200, drives seeding & sponsors
  budget: number; // USD
  playerIds: string[]; // active 5 first, then bench
  /** Legacy fields kept for the match engine; synced from the Head Coach when one is hired. */
  coachName: string;
  coachSkill: number; // 1-20
  /** HLTV team id — drives lazy team logo loading from img-cdn.hltv.org/teamlogo/{id}.png */
  hltvId?: number;
  /** Mod-supplied custom logo (data URI or external URL). Overrides file-based lookup when set. */
  customLogoUrl?: string;
  /** Hired staff (FM-style: head coach + specialists). Engine reads coachSkill above. */
  staffIds?: string[];
  /** Active sponsorship deals (max ~3 + 1 title). */
  sponsorDeals?: SponsorDeal[];
  mapPool: MapPoolRating[];
  worldRanking: number;
  rankingPoints: number;
  isUser?: boolean;
  /** Org has folded — keep the record so historical match references resolve,
   *  but exclude from rankings, tournament invites, transfer destinations etc. */
  defunct?: boolean;
  /** Date the org folded (for inbox / news / Hall of Fame). */
  defunctOn?: string;
}

// ============ Staff ============

export type StaffRole =
  | 'HeadCoach'        // drives team coachSkill (engine match bonus)
  | 'AimCoach'         // multiplies aim/reflexes training gains
  | 'UtilityCoach'     // multiplies utility/positioning training gains
  | 'TacticsCoach'     // multiplies gameSense/teamplay training gains
  | 'PerformanceCoach' // composure/resilience monthly growth + reduces choke
  | 'Analyst'          // multiplies daily opponent scouting accuracy gains
  | 'Physio';          // boosts roster fatigue recovery

export interface Staff {
  id: string;
  name: string;
  nationality: string;
  age: number;
  role: StaffRole;
  skill: number; // 1-20
  reputation: number; // 1-100, drives wage demand + asking pool
  /** Monthly wage. */
  wage: number;
  /** Set when employed by a team. */
  contract: { wage: number; expires: string } | null;
  teamId: string | null;
}

export const STAFF_ROLES: StaffRole[] = [
  'HeadCoach',
  'AimCoach',
  'UtilityCoach',
  'TacticsCoach',
  'PerformanceCoach',
  'Analyst',
  'Physio',
];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  HeadCoach: 'Head Coach',
  AimCoach: 'Aim Coach',
  UtilityCoach: 'Utility Coach',
  TacticsCoach: 'Tactics Coach',
  PerformanceCoach: 'Performance Coach',
  Analyst: 'Analyst',
  Physio: 'Physio',
};

export const STAFF_ROLE_HINT: Record<StaffRole, string> = {
  HeadCoach: 'Drives match-day team coachSkill bonus + tactical reads',
  AimCoach: 'Boosts aim/reflexes training gains',
  UtilityCoach: 'Boosts utility/positioning training gains',
  TacticsCoach: 'Boosts game sense/teamplay training gains',
  PerformanceCoach: 'Grows composure/resilience + reduces big-stage choke',
  Analyst: 'Multiplies scouting accuracy on prepped opponents',
  Physio: 'Speeds fatigue recovery across the roster',
};

// ============ Tactics ============

export type TSidePlaystyle = 'default' | 'explosive' | 'slow-default' | 'mixed';
export type CTSidePlaystyle = 'standard' | 'aggressive-info' | 'passive-retake' | 'stacked-gambles';

export type TempoPreset = 'patient' | 'balanced' | 'aggressive';

/**
 * Per-map override. Any undefined field inherits from the global Tactics.
 * Lets the user play different identities on different maps (FM-style).
 */
export interface MapTactics {
  tPlaystyle?: TSidePlaystyle;
  ctPlaystyle?: CTSidePlaystyle;
  aggression?: number;
  utilityUsage?: number;
  midRoundFlexibility?: number;
  ecoDiscipline?: number;
  forceBuyTendency?: number;
  /** Enabled strat names for this map. Empty/undefined = all enabled. */
  enabledStrats?: string[];
  /** Tempo preset — auto-toggles strats by tempo class. */
  tempoPreset?: TempoPreset;
}

/** How a player approaches their role — modulates duel aggression + setup positioning. */
export type RoleDuty = 'aggressive' | 'balanced' | 'passive';

/** One of five positional slots on the starting roster. */
export interface RoleSlot {
  role: PlayerRole;
  duty: RoleDuty;
  playerId: string | null;
}

/** Grenade type for a named utility lineup. Drives damage roll + flavor. */
export type UtilityKind = 'smoke' | 'flash' | 'molly' | 'he';

/** Persistent intel collected by scouting a rival team over time. */
export interface OpponentScoutReport {
  teamId: string;
  /** 0-1, ticks up while scouting hours are allocated to this team. */
  accuracy: number;
  /** ISO date of the last accuracy bump. */
  lastUpdated: string;
}

/** Pre-match scouting allocation against a specific opponent. */
export interface MatchPlan {
  pistols: number;   // 0-5
  defaults: number;  // 0-5
  executes: number;  // 0-5
  antiEcos: number;  // 0-5
}

/** One-shot tactical call applied to the next user map. Cleared after consumption. */
export type TacticalCall =
  | 'speed-up'    // bias strats faster
  | 'slow-down'   // bias strats slower
  | 'stack-a'     // CT setup biased to A
  | 'stack-b'     // CT setup biased to B
  | 'push'        // +aggression for the map
  | 'hold';       // -aggression for the map

export interface Tactics {
  tPlaystyle: TSidePlaystyle;
  ctPlaystyle: CTSidePlaystyle;
  aggression: number; // 1-20 slider
  utilityUsage: number; // 1-20: how much util dumped per execute
  midRoundFlexibility: number; // 1-20: weight on IGL adapting
  ecoDiscipline: number; // 1-20: how strictly economy rules followed
  forceBuyTendency: number; // 1-20
  mapVetoPriority: MapName[]; // ordered preference, best first
  /** Per-map overrides (sparse). Maps without an entry fully inherit the global tactics. */
  mapOverrides?: Partial<Record<MapName, MapTactics>>;
  /** 5 positional slots for the starting roster. Reorders & duty-assigns players. */
  roleSlots?: RoleSlot[];
  /** Pre-match prep allocations keyed by opponent team id. */
  matchPlans?: Record<string, MatchPlan>;
}

export const DEFAULT_TACTICS: Tactics = {
  tPlaystyle: 'default',
  ctPlaystyle: 'standard',
  aggression: 10,
  utilityUsage: 12,
  midRoundFlexibility: 10,
  ecoDiscipline: 12,
  forceBuyTendency: 8,
  mapVetoPriority: [...ALL_MAPS],
};

export const DEFAULT_MATCH_PLAN: MatchPlan = {
  pistols: 0,
  defaults: 0,
  executes: 0,
  antiEcos: 0,
};
/** Soft cap on the sum of prep points (raised by coach skill). */
export const MAX_PREP_POINTS = 10;

// ============ Competition ============

export type TournamentTier = 'S' | 'A' | 'B';
export type MatchFormat = 'BO1' | 'BO3' | 'BO5';

export type StageType = 'swiss' | 'group-gsl' | 'single-elim' | 'double-elim';

export interface TournamentStage {
  name: string;
  type: StageType;
  format: MatchFormat;
  finalFormat?: MatchFormat; // e.g. BO5 grand final
  advance: number; // how many advance from this stage
}

export interface Tournament {
  id: string;
  name: string;
  tier: TournamentTier;
  prizePool: number;
  prizeSpread: number[]; // fraction per placement [1st, 2nd, 3-4th...]
  startDate: string; // ISO
  endDate: string;
  teamCount: number;
  stages: TournamentStage[];
  invitedTeamIds: string[]; // resolved at season gen by ranking
  isMajor: boolean;
  rankingPoints: number; // points for winner, scaled down placements
  qualifierId?: string; // RMR tournament whose top 8 qualify for this Major
}

export type TournamentMatchStatus = 'scheduled' | 'live' | 'finished';

export interface ScheduledMatch {
  id: string;
  tournamentId: string;
  stageName: string;
  roundLabel: string; // e.g. "Swiss R1", "Quarterfinal"
  date: string; // ISO
  teamAId: string;
  teamBId: string;
  format: MatchFormat;
  status: TournamentMatchStatus;
  result?: MatchResult;
  /** If set, the day-tick resolves this fixture as a walkover with the named
   *  team winning (opponent disbanded / withdrew / failed to show). */
  walkoverWinnerId?: string;
}

export interface TournamentState {
  tournamentId: string;
  currentStageIdx: number;
  // swiss bookkeeping
  swissRecords: Record<string, { wins: number; losses: number }>;
  aliveTeamIds: string[];
  eliminatedTeamIds: string[];
  placements: Record<string, number>; // teamId -> final placement
  finished: boolean;
  bracketRound: number;
}

// ============ Match engine ============

export interface MapResult {
  map: MapName;
  scoreA: number;
  scoreB: number;
  rounds: RoundResult[];
  playerStats: Record<string, PlayerMatchStats>;
}

export interface MatchResult {
  matchId: string;
  teamAId: string;
  teamBId: string;
  mapsA: number;
  mapsB: number;
  winnerId: string;
  maps: MapResult[];
  vetoLog: string[];
}

export interface PlayerMatchStats {
  playerId: string;
  kills: number;
  deaths: number;
  assists: number;
  /** Total damage dealt this match (includes utility damage). */
  damage: number;
  /** Utility-only damage from grenades/mollies/HEs. Apex-style support carries shine here. */
  utilityDamage: number;
  rating: number;
  openingKills: number;
  clutchesWon: number;
  /** Role the player was slotted into for this map — drives role-familiarity gains. */
  assignedRole?: PlayerRole;
}

export type RoundEndReason = 'elimination' | 'bomb' | 'defuse' | 'time';
export type BuyType = 'full' | 'force' | 'half' | 'eco' | 'pistol';

export interface KillEvent {
  tick: number;
  killerId: string;
  victimId: string;
  assistId?: string;
  weapon: string;
  headshot: boolean;
  zone: string; // map zone name where it happened
}

export interface RoundResult {
  roundNo: number;
  winnerSide: 'T' | 'CT';
  winnerTeamId: string;
  reason: RoundEndReason;
  kills: KillEvent[];
  buyA: BuyType;
  buyB: BuyType;
  bombPlanted: boolean;
  plantSite?: 'A' | 'B';
  clutch?: { playerId: string; vs: number; won: boolean };
  commentary: string[];
  // positional frames for the 2D viewer
  frames: RoundFrame[];
  moneyA: number;
  moneyB: number;
}

export interface PlayerDot {
  playerId: string;
  x: number; // 0-1 normalized map coords
  y: number;
  alive: boolean;
  side: 'T' | 'CT';
  hasBomb?: boolean;
}

export interface RoundFrame {
  tick: number;
  dots: PlayerDot[];
  bombPlanted: boolean;
  bombX?: number;
  bombY?: number;
}

// ============ Map geometry (for engine + renderer) ============

export interface MapZone {
  id: string;
  name: string; // "A Site", "Mid", "Banana"...
  x: number; // center, 0-1
  y: number;
  isSite?: 'A' | 'B';
  isSpawn?: 'T' | 'CT';
  neighbors: string[]; // zone ids
}

export interface MapLayout {
  name: MapName;
  zones: MapZone[];
  // simple wall rects for rendering flavor: [x,y,w,h] normalized (unused with radar backgrounds)
  walls: [number, number, number, number][];
  // corridor waypoints per graph edge so dot movement follows the playable area.
  // Key: `${idA}|${idB}` with ids sorted alphabetically; points listed in A->B direction.
  bends?: Record<string, [number, number][]>;
}

// ============ News feed (social-style) ============

export type NewsAuthorKind = 'press' | 'pro-player' | 'team-official' | 'fan' | 'analyst';

export interface NewsAuthor {
  id: string;
  name: string;
  handle: string;
  kind: NewsAuthorKind;
  verified?: boolean;
  teamId?: string;
  playerId?: string;
  avatarSeed?: string;     // drives the generated initials avatar background
}

export interface NewsComment {
  authorId: string;
  text: string;
}

export interface NewsPost {
  id: string;
  date: string;
  authorId: string;
  text: string;
  taggedTeamIds?: string[];
  taggedPlayerIds?: string[];
  likes: number;
  reposts: number;
  comments: NewsComment[];
  /** Affinity — used for filter chips. */
  category: 'match' | 'transfer' | 'sponsor' | 'rumor' | 'milestone' | 'banter' | 'press-release' | 'injury';
  /** Optional contextual link (future-use). */
  linkType?: 'tournament' | 'team' | 'player';
  linkId?: string;
}

// ============ Inbox / news ============

export type InboxCategory = 'match' | 'transfer' | 'finance' | 'board' | 'training' | 'tournament' | 'scouting';

export interface InboxMessage {
  id: string;
  date: string;
  category: InboxCategory;
  subject: string;
  body: string;
  read: boolean;
  /** Optional deep-link: when set, the inbox renders an actionable UI inline
   *  (e.g., "press" lets the user answer the conference without leaving inbox). */
  linkType?: 'press' | 'concern' | 'sponsor-offer' | 'tournament' | 'player';
  linkId?: string;
}

// ============ Finance ============

export interface FinanceRecord {
  month: string; // YYYY-MM
  prizeMoney: number;
  sponsorIncome: number;
  wages: number;
  transfersIn: number; // money received
  transfersOut: number; // money spent
}

// ============ Sponsorships ============

export type SponsorTier = 'title' | 'premium' | 'standard' | 'minor';
export type SponsorCategory = 'peripherals' | 'energy' | 'apparel' | 'tech' | 'gambling' | 'auto' | 'finance' | 'food';

export interface Sponsor {
  id: string;
  name: string;
  brand: string;             // short label for the chip
  category: SponsorCategory;
  tier: SponsorTier;
  /** Asking monthly value (USD) — actual paid value baked at signing in the SponsorDeal. */
  baseMonthly: number;
  /** Typical contract length offered (months). */
  baseLengthMonths: number;
  /** Required team rank to be eligible (smaller = higher rank). */
  minRank: number;
  /** Optional region preference — sponsors based in specific regions favour local teams. */
  preferredRegions?: Region[];
  /** Performance bonuses (USD) paid on top of monthly. */
  bonusPerMajor?: number;     // S-tier event win
  bonusPerPodium?: number;    // any top-3 finish
}

export interface SponsorDeal {
  sponsorId: string;
  startDate: string;
  expiresDate: string;
  /** Monthly value locked at signing (declining teams sign worse deals at renewal). */
  monthlyValue: number;
  bonusPerMajor: number;
  bonusPerPodium: number;
}

// ============ Board / Manager career ============

export type BoardObjectiveType =
  | 'win-major'         // win at least one S-tier event
  | 'finals'            // reach a tier-1 final
  | 'top-finish'        // finish season ranked <= target (e.g., top 4, top 8)
  | 'develop-youth'     // give X maps to under-22 players
  | 'profit'            // end season above target budget
  | 'avoid-bottom'      // stay out of bottom N world ranking
  | 'qualify-major';    // qualify for a Major via RMR

export interface BoardObjective {
  id: string;
  type: BoardObjectiveType;
  description: string;
  /** Target threshold — interpretation depends on type. */
  target: number;
  /** Current numeric progress (for type-dependent display). */
  progress: number;
  status: 'pending' | 'achieved' | 'failed';
  /** Confidence delta on completion (positive on achieve, negative if failed). */
  confidenceImpact: number;
}

export interface BoardState {
  /** 0-100 confidence — drops below 15 = sack risk. */
  confidence: number;
  /** Active objectives for the current season. */
  objectives: BoardObjective[];
  /** ISO date of the most-recent confidence change (for inbox throttling). */
  lastUpdate?: string;
}

// ============ Press conferences ============

export type PressTone = 'calm' | 'confident' | 'aggressive' | 'humble';

export interface PressQuestion {
  id: string;
  question: string;
  /** Each tone offers an answer line + outcome modifiers. */
  options: {
    tone: PressTone;
    answer: string;
    moraleDelta: number;    // applied to user team players (per player)
    confidenceDelta: number;
    mediaTrustDelta: number;
  }[];
}

export interface PressConference {
  id: string;
  date: string;
  /** Pre-match (before a marquee match) or post-match (after a result). */
  kind: 'pre-match' | 'post-match';
  /** Optional scheduled match id for context (pre) or completed match id (post). */
  matchId?: string;
  /** Tournament context. */
  tournamentId?: string;
  /** Specific opponent or champion id for context. */
  contextTeamId?: string;
  questions: PressQuestion[];
  answered: boolean;
}

// ============ Player concerns ============

export type ConcernType =
  | 'wage-demand'        // wants raise
  | 'role-demotion'      // wants more playing time
  | 'transfer-request'   // wants to leave
  | 'happiness-low'      // unhappy at the club
  | 'unsettled-rival'    // upset a rival was signed/kept
  | 'admiring-offer';    // courted by another club

export interface PlayerConcern {
  id: string;
  playerId: string;
  date: string;
  type: ConcernType;
  /** Player-facing message (the conversation). */
  message: string;
  options: {
    label: string;
    description: string;
    /** Effects on the player: morale (+/-), loyalty, etc. */
    moraleDelta: number;
    loyaltyDelta: number;
    /** Wage rise % if relevant. */
    wageRisePct?: number;
    /** Confidence with the board. */
    confidenceDelta: number;
    /** If true, player goes on transfer list. */
    listsPlayer?: boolean;
  }[];
}

/** An inbound sponsor offer to the user. Either accepted (signs the deal) or rejected. */
export interface SponsorOffer {
  id: string;
  sponsorId: string;
  date: string;
  expiresOn: string;        // user must respond before this
  monthlyValue: number;
  lengthMonths: number;
  bonusPerMajor: number;
  bonusPerPodium: number;
  /** If the user has no free slot, accepting will bump the smallest existing deal. */
  replacesDealOfSponsorId?: string;
}

// ============ Transfers ============

/**
 * Negotiation state machine:
 *   pending        — bid sitting with selling club, awaiting their response
 *   club-counter   — selling club has issued a counter-fee, awaiting your response
 *   personal-terms — club agreed, now negotiating wage/length/bonuses with the player
 *   player-counter — player has demanded better terms, awaiting your response
 *   accepted       — deal closed (terminal, briefly visible before cleanup)
 *   rejected       — walked away or refused (terminal)
 *   withdrawn      — you pulled out (terminal)
 */
export type TransferStatus =
  | 'pending'
  | 'club-counter'
  | 'personal-terms'
  | 'player-counter'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'negotiating';

/** Squad role promised to the signing player. Drives morale + expectations. */
export type SquadStatusPromise = 'star' | 'first-team' | 'rotation' | 'backup' | 'prospect';

export interface PersonalTerms {
  wage: number;             // monthly
  contractYears: number;    // 1-4
  signingBonus?: number;    // one-time, paid at signing
  buyoutClause?: number;    // release clause set in the new contract
  sellOnPercent?: number;   // % of next sale going to your team (the player must accept this)
  perMajorBonus?: number;   // bonus per Major win
  perPodiumBonus?: number;  // bonus per podium finish at S-tier
  // ----- FM-style negotiation knobs -----
  /** Annual wage escalation (% raise each year of the contract). Strong agents push this. */
  wageRisePct?: number;
  /** Lump sum paid at end of contract if the player stays for the full term. */
  loyaltyBonus?: number;
  /** One-time fee paid to the agent at signing — softens their hard-bargain stance. */
  agentFee?: number;
  /** Squad role promised. Player has an expected status they won't accept below. */
  squadStatus?: SquadStatusPromise;
}

export interface TransferOffer {
  id: string;
  date: string;
  fromTeamId: string;
  playerId: string;
  fee: number;
  wage: number;
  direction: 'in' | 'out';
  status: TransferStatus;
  expiresOn: string;
  // ----- Rich negotiation fields (optional for backward-compat with legacy AI offers) -----
  /** Selling club's counter-fee, if any (set when status = 'club-counter'). */
  counterFee?: number;
  /** Selling club's rationale string for the counter (shown in UI). */
  counterReason?: string;
  /** Number of fee rounds exchanged so far (capped at 3). */
  feeRound?: number;
  /** Personal terms once stage 2 begins. */
  personalTerms?: PersonalTerms;
  /** Player's counter on personal terms (shown in UI). */
  playerCounterTerms?: PersonalTerms;
  playerCounterReason?: string;
  /** Negotiation history shown in the UI ledger. */
  log?: { date: string; line: string }[];
  /** Agent attached to this negotiation (player's representative). */
  agent?: { name: string; demandMultiplier: number };
  /** Rival bids that came in DURING this negotiation (drives "match or fold" drama). */
  rivalBid?: { teamId: string; fee: number; receivedOn: string };
}

/** Active loan deal — player goes out to another team for a finite period. */
export interface LoanDeal {
  id: string;
  playerId: string;
  /** Parent club retaining ownership (usually the user). */
  fromTeamId: string;
  /** Loan recipient. */
  toTeamId: string;
  startDate: string;
  endDate: string;
  /** Share of monthly wage covered by the LOAN-IN club (0-1). */
  wageContribution: number;
  /** Optional recall protection: if true the parent club cannot recall early. */
  recallProtected: boolean;
}

// ============ Training ============

export type TrainingFocus = 'aim' | 'utility' | 'tactics' | 'teamplay' | 'rest' | 'map-prep';

export interface TrainingSetup {
  focus: TrainingFocus;
  intensity: number; // 1-3
  mapPrep: MapName | null;
  /**
   * Faceit hub subscription tier — paid monthly. Drives extra youth-development chance
   * for all squad players (first-team, reserves, and youth alike). 'none' = no Faceit.
   * Cost scales with tier: basic $5k/mo, pro $20k/mo, premium $60k/mo (paid in monthly finances).
   */
  faceitTier?: 'none' | 'basic' | 'pro' | 'premium';
  /** Consecutive weeks the same focus has run — drives diminishing returns past week 2. */
  focusStreak?: number;
  /** Previous week's focus (for streak detection). */
  lastFocus?: TrainingFocus;
}

/** Pre-match team talk tone. Each affects morale/form differently based on
 *  the squad's composure profile — passionate works on a tight squad, but
 *  aggressive can backfire on a fragile one. */
export type TeamTalkTone = 'relax' | 'encourage' | 'demand-more' | 'passionate' | 'aggressive';

// ============ Scene events ============

/** Multi-stage VAC / cheat allegation arc — investigation → cleared OR banned. */
export interface CheatScandal {
  id: string;
  playerId: string;
  /** Date the allegation went public. */
  allegedOn: string;
  /** Date the verdict is delivered (investigation closes). */
  verdictOn: string;
  status: 'investigating' | 'cleared' | 'banned';
  /** Only set when status === 'banned'. */
  banUntil?: string;
  /** Plain-English flavour line used in the inbox / news feed. */
  headline: string;
}

/** A seasonal objective set by the board — meet by the deadline or lose
 *  confidence; over-deliver and pick up a bonus / confidence swing. */
export interface BoardMandate {
  id: string;
  kind: 'rank' | 'trophy' | 'develop-youth' | 'sign-from' | 'wage-bill';
  /** Short label rendered in the UI ("Top 8 by Jul 1"). */
  label: string;
  /** Long-form description shown on hover / Manager screen. */
  detail: string;
  /** ISO date the mandate is judged. */
  deadline: string;
  /** Numeric target (rank ceiling, trophies, % wage reduction, etc.). */
  target: number;
  /** Numeric parameter (region code for sign-from, etc.). */
  param?: string;
  status: 'open' | 'met' | 'failed';
  /** Confidence swing applied when judged. +20 met, -25 failed (varies). */
  rewardConfidence: number;
  /** One-time cash bonus when met (USD). */
  rewardCash?: number;
}

/** Per-player line from an auto-played academy match. */
export interface YouthMatchPlayerLine {
  playerId: string;
  nickname: string;
  age: number;
  role: string;
  kills: number;
  deaths: number;
  assists: number;
  rating: number;
}

/** One academy fixture result, persisted for the Youth screen / scouting history. */
export interface YouthMatchHistoryEntry {
  date: string;
  oppName: string;
  oppRating: number;
  userScore: number;
  oppScore: number;
  won: boolean;
  lineup: YouthMatchPlayerLine[];
  standoutId: string | null;
}

/** One week's training outcome — preserved so the UI can show "what happened
 *  last week" rather than waiting for the monthly summary. Capped at 8 weeks. */
export interface TrainingWeekReport {
  date: string;
  focus: TrainingFocus;
  intensity: number;
  /** Aggregated narrative lines (gains, regressions, fatigue, warnings). */
  notes: string[];
  /** Number of attribute gains across the squad. */
  gains: number;
  /** Number of attribute regressions (overtraining bad). */
  regressions: number;
}

/**
 * Per-player training focus override. When set, this player's individual
 * development tilts toward the chosen attribute group regardless of team focus.
 * Use 'auto' (or absence of entry) to let the team training dictate growth.
 */
export type IndividualFocus = 'auto' | 'aim' | 'utility' | 'tactics' | 'teamplay' | 'composure';

// ============ Scouting ============

export interface ScoutReport {
  playerId: string;
  date: string;
  accuracy: number; // 0-1 — how revealed the attributes are
}

// ============ Game state root ============

export interface CalendarEvent {
  date: string;
  type: 'match' | 'tournament-start' | 'tournament-end' | 'training' | 'none';
  refId?: string;
  label: string;
}

/** A directed or undirected social tie between two players.
 *  - mentor:  vet → rookie (asymmetric, fromId mentors toId)
 *  - rival:   two players, mutual hostility (order doesn't matter)
 *  - friend:  two players, mutual friendship (order doesn't matter)
 *  Source explains why the relationship exists (drives flavour text). */
export type RelationKind = 'mentor' | 'rival' | 'friend';
export type RelationSource = 'nationality' | 'age-gap' | 'role-rivalry' | 'history' | 'random';

export interface PlayerRelation {
  fromId: string;
  toId: string;
  kind: RelationKind;
  source: RelationSource;
  /** ISO date the relationship was established. */
  startedOn: string;
}

// ============ Sportsbook (manager bets on upcoming matches) ============

export type BetStatus = 'pending' | 'won' | 'lost' | 'void';

export interface SportsbookBet {
  id: string;
  matchId: string;
  /** ISO date the bet was placed. */
  placedOn: string;
  /** Tournament + round snapshot (for display once the schedule item is gone). */
  tournamentName: string;
  roundLabel: string;
  teamAId: string;
  teamBId: string;
  teamATag: string;
  teamBTag: string;
  /** Team id the manager backed. */
  pickedTeamId: string;
  /** Tag of the picked team (cached for display). */
  pickedTeamTag: string;
  stake: number;
  /** Decimal odds locked at placement time. */
  odds: number;
  /** Stake × odds = total payout on win (includes stake back). */
  potentialPayout: number;
  status: BetStatus;
  settledOn?: string;
  /** Amount credited back to stash on settle (0 if lost). */
  payout?: number;
}

// ============ CS2 case opening (manager-side gambling minigame) ============

export type SkinRarity = 'mil-spec' | 'restricted' | 'classified' | 'covert' | 'rare-special';
export type WearLevel = 'Factory New' | 'Minimal Wear' | 'Field-Tested' | 'Well-Worn' | 'Battle-Scarred';

export interface Skin {
  /** Stable id like 'ak47-ice-coaled'. */
  id: string;
  /** Weapon prefix — 'AK-47', 'AWP', '★ Karambit', etc. */
  weapon: string;
  /** Skin/pattern name — 'Ice Coaled', 'Doppler'. */
  name: string;
  rarity: SkinRarity;
  /** Base $ value at Field-Tested wear (real CS market price scaled ×1000). */
  basePrice: number;
}

export interface CaseDef {
  id: string;
  name: string;
  /** Combined case+key cost in scaled dollars. */
  keyPrice: number;
  /** Skin pool for this case. */
  skins: Skin[];
  /** Optional artwork colour hint for the card. */
  accent?: string;
}

export interface SkinInstance {
  /** Unique inventory id. */
  id: string;
  skinId: string;
  /** Snapshot fields for legacy lookups even if case definitions change. */
  weapon: string;
  name: string;
  rarity: SkinRarity;
  wear: WearLevel;
  /** Resale market value at acquisition (already wear+stattrak adjusted). */
  marketValue: number;
  statTrak: boolean;
  /** When it dropped. */
  acquiredOn: string;
  /** Case it came from (id). */
  caseId: string;
  /** Souvenir from a Major win — bonus prestige, +20% market value. */
  souvenir?: boolean;
  /** Float value 0.00–1.00. Determines wear bucket + within-bucket pricing.
   *  Optional only for backwards-compat with skins minted before the float
   *  system; new mints always set it. */
  float?: number;
  /** Sequential serial number per skinId — "Howl #0042" provenance label.
   *  Allocated by the server at mint time, never collides. */
  serial?: number;
  /** Per-skin owner provenance trail. Each entry = a team that previously
   *  owned this exact instance. Updated on every successful trade. Capped
   *  at the last 10 owners to keep JSON small. */
  history?: { teamId: string; teamTag: string; at: number }[];
}

// ============ Hall of Fame (retired players) ============

export interface HallOfFameEntry {
  playerId: string;
  nickname: string;
  fullName: string;
  nationality: string;
  role: PlayerRole;
  /** Year the player retired. */
  retiredYear: number;
  retiredAge: number;
  /** Lifetime career rating. */
  careerRating: number;
  /** Lifetime maps played. */
  careerMaps: number;
  /** Snapshot of lifetime honours at retirement. */
  honours: PlayerHonour[];
  /** Teams they ever played for (most recent last). */
  clubs: { teamId: string; teamName: string }[];
  /** Composite HOF score — drives default sort. */
  hofScore: number;
  /** True if the player retired on the user's team during this career. */
  retiredOnUserTeam: boolean;
}

// ============ Manager profile (cross-career persistent identity) ============

export interface ManagerAttributes {
  /** Influence on team morale recovery + post-loss bounceback. 1-20. */
  motivating: number;
  /** Boosts mentor effect + youth development pacing on user team. 1-20. */
  youngsters: number;
  /** Lifts media-trust drift + reduces tone backlash from press answers. 1-20. */
  press: number;
  /** Tightens scout report accuracy for unscouted players. 1-20. */
  judgingTalent: number;
}

export type ManagerStyle = 'tactician' | 'motivator' | 'youth-specialist' | 'all-rounder';

export type AchievementId =
  | 'first-major'
  | 'major-winner'
  | 'wonderkid-whisperer'
  | 'untouchable'
  | 'globetrotter'
  | 'serial-winner'
  | 'underdog-king'
  | 'hall-of-fame';

export interface Achievement {
  id: AchievementId;
  unlockedOn: string; // ISO date
  /** Optional contextual blurb (e.g., "Won Cologne with NAVI"). */
  context?: string;
}

export interface CareerStint {
  teamId: string;
  teamName: string;
  /** ISO start date of the tenure. */
  startDate: string;
  /** ISO end date (when the manager left or was sacked). null = current. */
  endDate?: string;
  /** Final ranking achieved during the stint (lowest = best). */
  bestRank?: number;
  /** Total trophies won during the stint. */
  trophies: number;
  /** Reason the stint ended. */
  reason?: 'sacked' | 'resigned' | 'retired' | 'left-for-better-job';
}

// ============ Manager job market ============

export interface ManagerJobOffer {
  id: string;
  /** ISO date the offer was extended. Expires after `expiresOn`. */
  offeredOn: string;
  expiresOn: string;
  /** Hiring team id. */
  teamId: string;
  /** Snapshot at offer time (rank/budget — for display even after team changes). */
  teamName: string;
  teamRank: number;
  /** One-line pitch from the hiring club, generated from the team's tier. */
  pitch: string;
  /** Sign-on bonus added to the team budget on accept. */
  signOnBonus: number;
  /** Type — direct approach, head-hunt, or post-sack rebound. */
  kind: 'approach' | 'head-hunt' | 'rebound';
}

export interface ManagerProfile {
  /** Stable id — same id across careers (slug of name). */
  id: string;
  name: string;
  nationality: string;
  /** Initials cached for the avatar render. */
  initials: string;
  /** Starting style (drives initial attribute distribution). */
  style: ManagerStyle;
  /** Lifetime manager attributes (1-20). Drift up/down with performance. */
  attributes: ManagerAttributes;
  /** Lifetime reputation (1-100). Drives AI club approaches over time. */
  reputation: number;
  /** Career stints in chronological order; last entry is the current job. */
  career: CareerStint[];
  /** Total trophies won across all stints. */
  trophiesTotal: number;
  /** Lifetime achievements list. */
  achievements: Achievement[];
}

export interface GameState {
  saveName: string;
  currentDate: string; // ISO
  seasonYear: number;
  userTeamId: string;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  tournaments: Record<string, Tournament>;
  tournamentStates: Record<string, TournamentState>;
  schedule: ScheduledMatch[];
  tactics: Tactics; // user team tactics
  inbox: InboxMessage[];
  finances: FinanceRecord[];
  offers: TransferOffer[];
  training: TrainingSetup;
  scoutReports: Record<string, ScoutReport>;
  matchHistory: MatchResult[];
  processedDates: string[];
  // playerId -> last interaction date (praise/criticize cooldown)
  interactions?: Record<string, string>;
  seasonHistory?: SeasonRecord[];
  /** One-shot calls to apply to the next user map. Cleared by the engine on consumption. */
  pendingCalls?: TacticalCall[];
  /** Scouting reports keyed by opponent team id (progress accumulates daily). */
  opponentScouts?: Record<string, OpponentScoutReport>;
  /** Hours/week allocated to scouting each opponent. Capped by coach skill at the screen level. */
  scoutAllocations?: Record<string, number>;
  /** Staff pool — hired staff are linked back via Team.staffIds. */
  staff?: Record<string, Staff>;
  /** Active loan deals (player on temporary transfer). */
  loans?: LoanDeal[];
  /** Sponsor pool — Team.sponsorDeals reference sponsors by id. */
  sponsors?: Record<string, Sponsor>;
  /** Pending sponsorship offers awaiting user decision. */
  sponsorOffers?: SponsorOffer[];
  // ----- Board / Press / Concerns (FM identity pack) -----
  board?: BoardState;
  pressConferences?: PressConference[];
  playerConcerns?: PlayerConcern[];
  /** Manager profile (set during new game). */
  managerName?: string;
  /** Full manager identity (attributes, reputation, career). Set during new game. */
  manager?: ManagerProfile;
  /** Pending manager job offers from rival clubs. */
  managerJobOffers?: ManagerJobOffer[];
  /** Per-match lineup override — 5 player IDs (in role-slot order) to use for
   *  the NEXT user match. Cleared after the match starts. Lets the user swap
   *  in subs (e.g. when a starter is injured) without permanently changing
   *  tactics.roleSlots. */
  pendingLineup?: (string | null)[];
  /** Dressing-room talk given for the current matchday — locks the choice +
   *  drives the pre-match panel's "✓ Talk given" state. Cleared by playUserMatch. */
  pendingTeamTalk?: {
    tone: TeamTalkTone;
    matchId: string;
    /** Summary line for the UI/inbox (e.g. "Squad lifted: +1.8 avg morale"). */
    summary: string;
  };
  /** Rolling log of weekly training outcomes — most recent first, capped to 8 entries. */
  trainingHistory?: TrainingWeekReport[];
  /** Last ~12 weeks of academy match results (auto-played, no manager input). */
  youthMatchHistory?: YouthMatchHistoryEntry[];
  /** Active VAC / cheat investigations + completed verdicts (capped). */
  cheatScandals?: CheatScandal[];
  /** Live board-mandate objectives for this season + their progress. */
  boardMandates?: BoardMandate[];
  /** Manager's standing with the board, 0-100. Below 20 = warning; below 10 = sacking watch. */
  boardConfidence?: number;
  /** Date of the last board-confidence event log entry. Used to throttle "warning" inboxes. */
  lastBoardWarning?: string;
  /** True while the manager is between jobs (post-sack/resign — limited actions). */
  managerUnattached?: boolean;
  /** Hall of Fame — historical retirees with snapshots of their careers. */
  hallOfFame?: HallOfFameEntry[];
  /** Manager's personal cash stash — used for buying CS2 cases. Funded by monthly stipend + skin sales. Separate from team budget. */
  managerStash?: number;
  /** Manager's CS2 skin inventory from opened cases. */
  managerInventory?: SkinInstance[];
  /** ISO date the daily free case was last opened. One free open per game day. */
  lastFreeCaseDate?: string;
  /** Pending souvenir packages awarded from major wins — opened from the Cases screen. */
  pendingSouvenirs?: number;
  /** Manager sportsbook bets — pending + settled history (cap retained internally). */
  sportsbookBets?: SportsbookBet[];
  /** Manager-trust score with the press (0-100). Drives question tone. */
  mediaTrust?: number;
  /** Social news feed — capped to last ~200 posts. */
  news?: NewsPost[];
  /** Authors pool — referenced by NewsPost.authorId. */
  newsAuthors?: Record<string, NewsAuthor>;
  /** Social fabric: mentors, rivals, friend cliques across the player pool. */
  relationships?: PlayerRelation[];
}

export interface SeasonEventRecord {
  tournamentName: string;
  tier: TournamentTier;
  championTeamId: string;
  championName: string;
  userPlacement: number | null; // null = not invited
  userPrize: number;
}

/** End-of-season individual awards. */
export type AwardKind =
  | 'player-of-year'   // single best player overall
  | 'rookie-of-year'   // best ≤21 yo with significant maps
  | 'top-fragger'      // most kills
  | 'clutch-king'      // most clutches won
  | 'major-mvp'        // best rating across Major tournaments
  | 'all-star-igl'     // All-Star Five — IGL slot
  | 'all-star-awper'   // All-Star Five — AWPer slot
  | 'all-star-1'       // All-Star Five — fragger slot 1
  | 'all-star-2'       // All-Star Five — fragger slot 2
  | 'all-star-3'       // All-Star Five — fragger slot 3
  | 'coach-of-year';   // best overachieving manager (vs preseason rank)

export interface SeasonAward {
  kind: AwardKind;
  year: number;
  /** Player id (or team id for coach-of-year). */
  recipientId: string;
  /** Cached display name at the time of award. */
  recipientName: string;
  /** Cached team id at the time of award. */
  teamId?: string;
  teamName?: string;
  /** Short numeric blurb shown next to the badge (e.g., "Rating 1.42", "412 kills"). */
  stat?: string;
}

export interface SeasonRecord {
  year: number;
  userTeamId: string;
  userRank: number;
  worldTop3: { teamId: string; name: string }[];
  events: SeasonEventRecord[];
  playerOfSeason: { playerId: string; nickname: string; teamName: string; rating: number; maps: number } | null;
  userBestPlayer: { playerId: string; nickname: string; rating: number; maps: number } | null;
  /** End-of-season awards roster: PotY, Rookie, All-Star Five, Coach of Year, etc. */
  awards?: SeasonAward[];
}
