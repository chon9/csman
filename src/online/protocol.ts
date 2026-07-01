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
  /** Chosen logo emoji from LOGO_PACK (e.g. "🐉"). Empty = default
   *  initials-on-color brand mark. */
  logoId?: string;
  /** Competitive MMR (PvP only). 1000 = Silver Elite Master. */
  mmr?: number;
  /** All-time peak MMR. Used as a "best rank" trophy stat. */
  peakMmr?: number;
  /** PvP duels played — drives placement-match status. */
  placementMatchesPlayed?: number;
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
  /** Cash bonus paid (or pending) for unlocking this. Surfaced in the
   *  unlock toast + the achievements panel so users see the payout. */
  rewardCash?: number;
}

export interface TeamProfileFields {
  bio?: string;
  primaryColor?: string;
  twitchUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
  logoId?: string;
}

/** Public-roster snapshot of one player — scrubbed for the click-to-view
 *  enemy team profile. No attributes / contract / condition fields:
 *  scouting another team should reveal HEADLINE stats, not let you read
 *  their full sheet. */
export interface PublicPlayer {
  id: string;
  nickname: string;
  firstName: string;
  lastName: string;
  role: string;
  nationality: string;
  age: number;
  currentAbility: number;
  potentialAbility: number;
}

/** Scrubbed snapshot of any team — what a manager sees when they click
 *  on an enemy team's tag anywhere in the app. Includes profile fluff,
 *  roster headlines, and recent season standings + PvP record. */
export interface PublicTeamProfile {
  id: string;
  name: string;
  tag: string;
  region: Region;
  ownerNick: string;
  /** Branding fields the owner has set on their profile editor. */
  bio?: string;
  primaryColor?: string;
  twitchUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
  logoId?: string;
  /** Total fans (derived from full-roster CA + PA via fansForRoster). */
  fans: number;
  starters: PublicPlayer[];
  reserves: PublicPlayer[];
  /** Total starter CA — handy for matchmaking decisions. */
  totalStarterCA: number;
  /** Current-season win/loss + PvP-only win/loss. */
  seasonWins: number;
  seasonLosses: number;
  pvpWins: number;
  pvpLosses: number;
  /** Achievements unlocked (counts only — don't dump full payload). */
  achievementsUnlocked: number;
  /** Days since team creation. Aesthetic flavor for the profile header. */
  ageInDays: number;
  /** Competitive MMR + peak — same fields as OnlineTeam, shown public. */
  mmr?: number;
  peakMmr?: number;
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

/** Sell-back value per card by rarity. Common lands ~20% of pack cost;
 *  rare ~80%; epic + legendary comfortably pay back the pack. Tuned so
 *  opening packs to farm cash is a losing proposition on average, but
 *  clearing out clutter never feels punishing. */
export const BOOST_SELL_VALUE: Record<BoostRarity, number> = {
  common: 1_000,
  rare: 4_000,
  epic: 12_000,
  legendary: 40_000,
};

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

// ============ Dragon Gate (射龍門 / In-Between) ============

/** Min/max bet on a single round. Unlimited rounds — the cap on plays
 *  comes from the user's wallet, not a daily limit. */
export const DRAGON_GATE_MIN_BET = 500;
export const DRAGON_GATE_MAX_BET = 50_000;

/** Card rank 1-13 (A=1, J=11, Q=12, K=13). Suits aren't simulated — they're
 *  cosmetic if the client wants to show them, but the math only needs rank. */
export type CardRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export type DragonGateOutcome = 'win' | 'tiang' | 'miss';

export interface DragonGateResult {
  /** Two gates — already sorted low→high. */
  gates: [CardRank, CardRank];
  /** The reveal card. */
  thirdCard: CardRank;
  outcome: DragonGateOutcome;
  /** Bet amount entered by the player. */
  bet: number;
  /** Net money change. win: +bet, miss: -bet, tiang: -2×bet. */
  delta: number;
  newMoney: number;
}

// ============ Async PvP matchmaking ("Quick Match") ============

/** Primary CA-delta window for matchmaking. Opponent's total starter
 *  CA must differ from yours by at most this much. ±100 is a meaningful
 *  but still-fightable gap. */
export const APVP_PRIMARY_DELTA = 100;
/** Fallback window if the primary band yields zero candidates. ±200
 *  keeps the matchmaker alive on a small server before giving up. */
export const APVP_FALLBACK_DELTA = 200;
/** Maps duelled in an async match — fixed BO1, fast turnaround. */
export const APVP_FORMAT = 'BO1' as const;
/** Stake bounds for async — slightly tighter than full PvP so the
 *  matchmaker is always paying out something meaningful. */
export const APVP_MIN_STAKE = 1_000;
export const APVP_MAX_STAKE = 50_000;
/** Defender (the random opponent who didn't opt in) only ever wins this
 *  fraction of the stake. They pay nothing on a loss — Quick Match is
 *  fully risk-free for the defender, which avoids draining unwitting
 *  teams while still rewarding them for winning the surprise duel. */
export const APVP_DEFENDER_WIN_SHARE = 0.1;

// ============ Streaming (Faceit pickup grind for cash) ============

/** Fans contributed per CA point per player. CA dominates (proven ability
 *  pulls eyeballs); PA gives a smaller "hype/wonderkid" bump. Both sides
 *  use this formula so the client can render the fans counter without a
 *  server roundtrip. */
export const STREAM_FANS_PER_CA = 50;
export const STREAM_FANS_PER_PA = 25;

/** Fatigue added to the streaming player per session. Slightly less than
 *  a duel — streaming is sit-down play, not full LAN performance. */
export const STREAM_FATIGUE_COST = 12;
/** Player fatigue ceiling — at/above this they're too burnt to stream.
 *  Forces rotation across the roster instead of grinding a single ace. */
export const STREAM_MAX_FATIGUE = 75;
/** Contract duels burned per stream. Streaming counts as match reps —
 *  treat the duels-remaining cost the same as a real duel so a heavy
 *  streamer still has to renew. */
export const STREAM_CONTRACT_COST = 1;
/** Base payout multiplier on (CA + PA). Tuned so a top player on a
 *  100k-fan team earns ~$10-18k per stream after variance. */
export const STREAM_PAYOUT_PER_ABILITY = 30;
/** Fraction of the team's fan count added to the payout per stream. */
export const STREAM_PAYOUT_PER_FAN = 0.05;
/** Variance band on the final payout — ±20% randomness keeps each stream
 *  from feeling deterministic. */
export const STREAM_PAYOUT_JITTER = 0.2;
/** Morale bump per stream — players love being in front of fans. */
export const STREAM_MORALE_DELTA = 1;
/** Chance any given stream upgrades one of the streamer's gameplay
 *  attributes by +1 (capped at PA-derived ceiling). Makes streaming a
 *  viable slow-drip training method on top of being income. */
export const STREAM_TRAINING_CHANCE = 0.5;

/** Fans contributed by one player — pure function, both sides compute. */
export function fansForPlayer(p: { currentAbility: number; potentialAbility: number }): number {
  return Math.round(p.currentAbility * STREAM_FANS_PER_CA + p.potentialAbility * STREAM_FANS_PER_PA);
}

/** Total team fan count = sum of per-player fans across the whole roster.
 *  Bench contributes too — fans care about the brand, not just starters. */
export function fansForRoster(players: { currentAbility: number; potentialAbility: number }[]): number {
  let total = 0;
  for (const p of players) total += fansForPlayer(p);
  return total;
}

export interface StreamResult {
  playerId: string;
  /** Stream viewers — flavor number for the reveal modal, derived from
   *  the player's solo fan contribution × variance. */
  viewers: number;
  /** Net money change (always positive — streaming is paid work). */
  payout: number;
  /** Fatigue added to the player (positive). */
  fatigueDelta: number;
  /** Morale change (positive — fan love). */
  moraleDelta: number;
  /** Duels remaining on the player's contract AFTER this stream. */
  duelsRemaining: number;
  newMoney: number;
  /** If a training tick fired, the attribute key and new value; else null. */
  trainingGained: { attr: string; newValue: number } | null;
  /** Snapshot of total team fans at stream time, for the reveal banner. */
  teamFans: number;
}

// ============ Mines (Stake-style risk-management grid) ============

/** Fixed grid size — 5×5 = 25 tiles. */
export const MINES_GRID_SIZE = 25;
export const MINES_MIN_BET = 500;
export const MINES_MAX_BET = 50_000;
/** Bounds on how many mines the user can place. At 24 mines there's a
 *  single safe tile (4% chance) — the multiplier hits ~24×. */
export const MINES_MIN_MINES = 1;
export const MINES_MAX_MINES = 24;
/** House edge baked into the multiplier formula (≈1% expected loss/round). */
export const MINES_HOUSE_EDGE = 0.01;

/** Compute the locked-in multiplier after `safePicks` successful reveals
 *  on a `mineCount`-mine grid. Pure function — both sides compute it the
 *  same way so the UI can preview the next reveal's multiplier without
 *  a server roundtrip. Returns 1.0 for 0 safe picks. */
export function minesMultiplier(mineCount: number, safePicks: number): number {
  if (safePicks <= 0) return 1.0;
  const safeTotal = MINES_GRID_SIZE - mineCount;
  if (safePicks > safeTotal) return 0; // impossible — guard
  // P(all picks safe) = product (safeTotal - i) / (gridSize - i) for i=0..safePicks-1.
  let prob = 1.0;
  for (let i = 0; i < safePicks; i++) {
    prob *= (safeTotal - i) / (MINES_GRID_SIZE - i);
  }
  return Math.round(((1 - MINES_HOUSE_EDGE) / prob) * 100) / 100;
}

export interface MinesResult {
  sessionId: string;
  outcome: 'cashout' | 'bust';
  /** Multiplier locked in (cashout) or 0 (bust = lost everything). */
  multiplier: number;
  bet: number;
  /** Net change. cashout: +bet × (multiplier − 1); bust: −bet. */
  delta: number;
  newMoney: number;
  /** Every mine position revealed at round end so the user can see what
   *  they avoided / where the rest were hiding. */
  mineIndices: number[];
  /** Tile that ended the round (the mine they hit). Undefined on cashout. */
  bustTileIndex?: number;
  /** How many safe tiles the user revealed before the round ended. */
  safePicks: number;
}

// ============ Player traits ============
//
// Per-player flavour modifiers that the match engine actually reads.
// Three families today: map specialist (boosts), map weakness (penalty),
// and pressure traits (high-stake matches). Every trait has a numeric
// engine effect — none are cosmetic. Generated probabilistically at
// player creation (see freeAgents/spawn).

export type TraitEffectKind =
  | 'map_specialist'   // +mult on a specific map
  | 'map_weak'         // -mult on a specific map
  | 'big_game'         // +mult under high pressure
  | 'stage_fright';    // -mult under high pressure

export interface TraitDef {
  id: string;
  label: string;
  icon: string;
  /** One-line summary the player profile renders. */
  description: string;
  effect: TraitEffectKind;
  /** Multiplier applied when the trait's condition is met. 1.10 = +10%. */
  mult: number;
  /** Map id this trait keys off — only for map_specialist / map_weak. */
  map?: string;
  /** Spawn weight in TRAIT_GENERATION_POOL — controls how rare the trait is. */
  weight: number;
  /** Visual tone: positive (green chip) or negative (red chip). */
  tone: 'positive' | 'negative';
}

export const TRAIT_LIBRARY: TraitDef[] = [
  // ===== Map specialists (+12% on that map) =====
  { id: 'mirage_spec',   label: 'Mirage Specialist',  icon: '🌅', description: '+12% effective skill on Mirage.',          effect: 'map_specialist', mult: 1.12, map: 'Mirage',  weight: 5, tone: 'positive' },
  { id: 'inferno_spec',  label: 'Inferno Specialist', icon: '🔥', description: '+12% effective skill on Inferno.',         effect: 'map_specialist', mult: 1.12, map: 'Inferno', weight: 5, tone: 'positive' },
  { id: 'dust2_spec',    label: 'Dust 2 Specialist',  icon: '🏜', description: '+12% effective skill on Dust 2.',          effect: 'map_specialist', mult: 1.12, map: 'Dust2',   weight: 5, tone: 'positive' },
  { id: 'nuke_spec',     label: 'Nuke Specialist',    icon: '☢', description: '+12% effective skill on Nuke.',            effect: 'map_specialist', mult: 1.12, map: 'Nuke',    weight: 4, tone: 'positive' },
  { id: 'ancient_spec',  label: 'Ancient Specialist', icon: '🗿', description: '+12% effective skill on Ancient.',         effect: 'map_specialist', mult: 1.12, map: 'Ancient', weight: 4, tone: 'positive' },
  { id: 'vertigo_spec',  label: 'Vertigo Specialist', icon: '🏗', description: '+12% effective skill on Vertigo.',         effect: 'map_specialist', mult: 1.12, map: 'Vertigo', weight: 4, tone: 'positive' },

  // ===== Map weaknesses (-10% on that map) =====
  { id: 'mirage_weak',   label: 'Mirage Weak',  icon: '🌅', description: '−10% effective skill on Mirage. Avoid the pick.', effect: 'map_weak', mult: 0.90, map: 'Mirage',  weight: 2, tone: 'negative' },
  { id: 'nuke_weak',     label: 'Nuke Weak',    icon: '☢', description: '−10% effective skill on Nuke. Loses verticality.', effect: 'map_weak', mult: 0.90, map: 'Nuke',    weight: 2, tone: 'negative' },
  { id: 'ancient_weak',  label: 'Ancient Weak', icon: '🗿', description: '−10% effective skill on Ancient.',                effect: 'map_weak', mult: 0.90, map: 'Ancient', weight: 2, tone: 'negative' },

  // ===== Pressure traits (+/− under high-stake matches) =====
  { id: 'big_game',      label: 'Big Game Player', icon: '⭐', description: '+10% under high pressure (big matches, tournament finals).', effect: 'big_game',     mult: 1.10, weight: 3, tone: 'positive' },
  { id: 'stage_fright',  label: 'Stage Fright',    icon: '😰', description: '−10% under high pressure. Chokes on the big stage.',        effect: 'stage_fright', mult: 0.90, weight: 2, tone: 'negative' },
];

/** Probabilities controlling trait generation per player. */
export const TRAIT_GEN_CHANCE = {
  /** Probability the player gets ANY trait at all. */
  hasAnyTrait: 0.55,
  /** Probability they get a SECOND trait (rolled only if first hit). */
  hasSecondTrait: 0.25,
  /** Probability the SECOND trait is a negative weakness. */
  secondTraitIsNegative: 0.45,
};

export function findTrait(id: string): TraitDef | null {
  return TRAIT_LIBRARY.find((t) => t.id === id) ?? null;
}

// ============ MMR rank ladder ============
//
// CS:GO-style competitive rank tiers driven by hidden MMR. Every PvP
// duel adjusts both sides' MMR Elo-style based on the opponent's MMR
// (AI duels do NOT touch MMR — the ladder is purely competitive). New
// teams start at MMR 1000 (Silver Elite Master) with PLACEMENT_MATCHES
// of doubled-K games to sort them quickly into a real bucket.

/** Starting MMR for a fresh team. Roughly mid-table. */
export const STARTING_MMR = 1000;
/** Number of PvP duels with doubled K-factor so new teams sort quickly. */
export const PLACEMENT_MATCHES = 5;
/** Elo K-factor for established players. Doubled during placement. */
export const ELO_K = 32;

export interface RankTier {
  name: string;
  /** Lower MMR bound (inclusive). Ordered ascending. */
  minMmr: number;
  color: string;
  /** Short label used on the badge chip. */
  short: string;
}

/** Visible rank ladder. Mirrors CS2's classic ranks — 18 tiers from
 *  Silver I (open) to Global Elite (1900+ MMR). */
export const RANK_LADDER: RankTier[] = [
  { name: 'Silver I',                    short: 'S1',   minMmr: 0,    color: '#9aa0aa' },
  { name: 'Silver II',                   short: 'S2',   minMmr: 800,  color: '#9aa0aa' },
  { name: 'Silver III',                  short: 'S3',   minMmr: 860,  color: '#9aa0aa' },
  { name: 'Silver IV',                   short: 'S4',   minMmr: 920,  color: '#9aa0aa' },
  { name: 'Silver Elite',                short: 'SE',   minMmr: 980,  color: '#b8c4d6' },
  { name: 'Silver Elite Master',         short: 'SEM',  minMmr: 1040, color: '#b8c4d6' },
  { name: 'Gold Nova I',                 short: 'GN1',  minMmr: 1100, color: '#d8a14b' },
  { name: 'Gold Nova II',                short: 'GN2',  minMmr: 1160, color: '#d8a14b' },
  { name: 'Gold Nova III',               short: 'GN3',  minMmr: 1220, color: '#d8a14b' },
  { name: 'Gold Nova Master',            short: 'GNM',  minMmr: 1280, color: '#f4c970' },
  { name: 'Master Guardian I',           short: 'MG1',  minMmr: 1340, color: '#4b69ff' },
  { name: 'Master Guardian II',          short: 'MG2',  minMmr: 1400, color: '#4b69ff' },
  { name: 'Master Guardian Elite',       short: 'MGE',  minMmr: 1460, color: '#3b7be0' },
  { name: 'Distinguished Master Guardian', short: 'DMG',minMmr: 1520, color: '#8847ff' },
  { name: 'Legendary Eagle',             short: 'LE',   minMmr: 1600, color: '#d32ce6' },
  { name: 'Legendary Eagle Master',      short: 'LEM',  minMmr: 1680, color: '#d32ce6' },
  { name: 'Supreme Master First Class',  short: 'SMFC', minMmr: 1780, color: '#eb4b4b' },
  { name: 'Global Elite',                short: 'GE',   minMmr: 1900, color: '#ffd700' },
];

/** Resolve an MMR value to its current rank tier. Returns the LAST tier
 *  whose minMmr the value clears. */
export function rankForMmr(mmr: number): RankTier {
  let current = RANK_LADDER[0]!;
  for (const tier of RANK_LADDER) {
    if (mmr >= tier.minMmr) current = tier;
    else break;
  }
  return current;
}

/** Distance (in MMR) from the current rank's floor to the next rank's
 *  floor — drives the progress bar under the badge. */
export function nextRankProgress(mmr: number): { current: RankTier; next: RankTier | null; pct: number; mmrToNext: number } {
  const current = rankForMmr(mmr);
  const idx = RANK_LADDER.findIndex((t) => t === current);
  const next = idx < RANK_LADDER.length - 1 ? RANK_LADDER[idx + 1]! : null;
  if (!next) return { current, next: null, pct: 100, mmrToNext: 0 };
  const span = next.minMmr - current.minMmr;
  const into = Math.max(0, mmr - current.minMmr);
  const pct = Math.max(0, Math.min(100, Math.round((into / span) * 100)));
  return { current, next, pct, mmrToNext: Math.max(0, next.minMmr - mmr) };
}

/** Elo-style MMR delta for the winner against an opponent. Caller flips
 *  the sign for the loser side. Doubled K during placement. */
export function eloDelta(myMmr: number, oppMmr: number, isWin: boolean, inPlacement: boolean): number {
  const expected = 1 / (1 + Math.pow(10, (oppMmr - myMmr) / 400));
  const k = inPlacement ? ELO_K * 2 : ELO_K;
  const delta = k * ((isWin ? 1 : 0) - expected);
  return Math.round(delta);
}

// ============ AI vs AI betting market ============
//
// Server keeps a rolling set of synthetic AI match cards open at all
// times. Each card has two fully-generated teams (random names, logos,
// 5-player rosters), a scheduled start time, and decimal odds derived
// from CA + role synergy + per-team random "form" + tactical advantage
// rolls. Users place bets up to ~30 seconds before kickoff. At
// scheduled start time the sim runs, the bets settle, the replay
// becomes watchable for ~10 minutes.

/** How many open cards the server tries to maintain at any moment. */
export const AI_BET_ACTIVE_CARDS = 4;
/** Countdown duration for newly-spawned cards. */
export const AI_BET_COUNTDOWN_MS = 8 * 60 * 1000;
/** Stop accepting new bets this many ms before kickoff. */
export const AI_BET_LOCK_LEAD_MS = 20 * 1000;
/** Card stays viewable post-resolve for replay watching. */
export const AI_BET_REPLAY_WINDOW_MS = 10 * 60 * 1000;
/** Bookmaker margin baked into the odds line. 0.05 = 5% house edge. */
export const AI_BET_HOUSE_EDGE = 0.05;
/** Stake bounds. */
export const AI_BET_MIN_STAKE = 500;
export const AI_BET_MAX_STAKE = 50_000;

/** Slim team summary for the betting card UI. */
export interface AiMatchTeamSummary {
  name: string;
  tag: string;
  logoId: string;
  primaryColor: string;
  /** Sum of the 5 starters' CA — main strength indicator for the user. */
  totalCA: number;
  /** Pre-computed role synergy multiplier (1.0 = neutral). Surfaced so the
   *  user can spot a 2-AWPer roster about to get punished. */
  synergy: number;
}

/** One open or resolved bet card. */
export interface AiMatchCardWire {
  id: string;
  teamA: AiMatchTeamSummary;
  teamB: AiMatchTeamSummary;
  oddsA: number;
  oddsB: number;
  scheduledStartAt: number;
  status: 'open' | 'closing' | 'live' | 'resolved';
  winnerSide?: 'A' | 'B' | null;
  /** Total stake on each side — drives the "X/Y/Z teams have bet" feel. */
  poolA?: number;
  poolB?: number;
  /** This user's bet on the card, if any. */
  myBet?: AiBetSummary | null;
  /** Match-history id once resolved — client can fetch the replay. */
  matchHistoryId?: string;
}

export interface AiBetSummary {
  side: 'A' | 'B';
  stake: number;
  oddsAtBet: number;
  status: 'pending' | 'won' | 'lost';
  payout?: number;
  placedAt: number;
}

/** One player on an AI bet team — slimmed-down player shape so the
 *  reveal modal can show roster headlines without dumping the full
 *  Player JSON over the wire. */
export interface AiBetTeamPlayerWire {
  nickname: string;
  firstName: string;
  lastName: string;
  nationality: string;
  role: string;
  age: number;
  ca: number;
  pa: number;
  traits: string[];
}

/** One settled-bet row in the user's permanent AI bet history. Stored
 *  in ai_bet_history server-side (survives the card cleanup pass that
 *  cascades the live bet rows out after the replay window). */
export interface AiBetHistoryEntry {
  cardId: string;
  teamATag: string;
  teamBTag: string;
  teamALogo: string;
  teamBLogo: string;
  teamAColor: string;
  teamBColor: string;
  side: 'A' | 'B';
  stake: number;
  oddsAtBet: number;
  status: 'won' | 'lost';
  payout: number;
  winnerSide: 'A' | 'B';
  mapsA: number;
  mapsB: number;
  settledAt: number;
}

/** Per-card team detail shown in the AI bet "view team" modal. Lives
 *  ENTIRELY in the card payload server-side — never persisted as a real
 *  team row, so the DB stays clean. */
export interface AiBetTeamProfile {
  name: string;
  tag: string;
  logoId: string;
  primaryColor: string;
  totalCA: number;
  synergy: number;
  players: AiBetTeamPlayerWire[];
}

// ============ Daily quests + login streak ============

// ============ Virtual real estate ============
//
// 1000×1000 grid of (x, y) plots. Any unowned cell can be bid on at a
// $1M minimum; first bid spawns an auction with a 4-hour anti-snipe
// countdown. Bid amount is escrowed at bid time and refunded when
// outbid. Winner gets the lot.
//
// Owned lots act as a "trophy" surface — the owner can upgrade the
// apartment tier (unlocks higher caps), park cars, deposit cash into a
// vault, house players, and display luxury items. The lot's identity
// strip carries the team logo + tag + MMR rank, making the map a live
// flex board for everyone browsing.

export const MAP_SIZE = 1000;
export const LOT_MIN_OPENING_BID = 1_000_000;
/** Min increment over current high bid (multiplicative). */
export const LOT_BID_INCREMENT = 0.10;
/** Anti-snipe countdown — each bid resets this. */
export const LOT_AUCTION_DURATION_MS = 4 * 60 * 60 * 1000;

export type ApartmentTier = 'studio' | 'loft' | 'penthouse' | 'mansion' | 'compound';

export interface ApartmentTierMeta {
  label: string;
  /** Cost to UPGRADE INTO this tier (cumulative). Studio is the free default. */
  upgradeCost: number;
  carSlots: number;
  residentSlots: number;
  luxurySlots: number;
  /** Cap on vault balance. -1 = unlimited. */
  vaultCap: number;
  color: string;
  hint: string;
}

export const APARTMENT_TIER_META: Record<ApartmentTier, ApartmentTierMeta> = {
  studio:    { label: 'Studio',     upgradeCost: 0,           carSlots: 1,  residentSlots: 1,  luxurySlots: 2,  vaultCap: 100_000,     color: '#8b93a3', hint: 'Default starter apartment included with every lot.' },
  loft:      { label: 'Loft',       upgradeCost: 500_000,     carSlots: 3,  residentSlots: 2,  luxurySlots: 5,  vaultCap: 1_000_000,   color: '#6aa7ec', hint: 'Mid-tier — more garage, more wall space for trophies.' },
  penthouse: { label: 'Penthouse',  upgradeCost: 2_000_000,   carSlots: 6,  residentSlots: 4,  luxurySlots: 10, vaultCap: 5_000_000,   color: '#9be29b', hint: 'Skyline view. Cars on display, players paid well.' },
  mansion:   { label: 'Mansion',    upgradeCost: 10_000_000,  carSlots: 12, residentSlots: 8,  luxurySlots: 20, vaultCap: 25_000_000,  color: '#f2c443', hint: 'Estate-grade. Garage doubles as a showroom.' },
  compound:  { label: 'Compound',   upgradeCost: 50_000_000,  carSlots: 25, residentSlots: 15, luxurySlots: 50, vaultCap: -1,          color: '#ff5fb0', hint: 'Top floor of the metaverse. Unlimited vault.' },
};

export const APARTMENT_TIER_ORDER: ApartmentTier[] = ['studio', 'loft', 'penthouse', 'mansion', 'compound'];

/** Vault interest rate per day (fraction of current balance). 0.005 = 0.5%. */
export const LOT_VAULT_INTEREST_PER_DAY = 0.005;
/** Cap on how many days of unclaimed interest can accrue at once — keeps
 *  the vault "checked in on daily" rather than a hoard-forever tap. */
export const LOT_VAULT_INTEREST_MAX_DAYS = 30;
/** Minimum interest amount required to enable the Collect button. */
export const LOT_VAULT_INTEREST_MIN_CLAIM = 100;

/** Residents earn this much extra morale per day while housed (capped via existing player morale ceiling). */
export const RESIDENT_DAILY_MORALE = 1;

// ----- Car catalogue -----

export type CarTier = 't1' | 't2' | 't3' | 't4';

export interface CarCatalogEntry {
  id: string;
  brand: string;
  model: string;
  tier: CarTier;
  price: number;
  icon: string; // emoji
  color: string;
}

export const CAR_CATALOG: CarCatalogEntry[] = [
  // Tier 1 — daily-driver tier
  { id: 'honda-civic',    brand: 'Honda',    model: 'Civic Type R',  tier: 't1', price: 80_000,    icon: '🚗', color: '#bcc3cd' },
  { id: 'toyota-supra',   brand: 'Toyota',   model: 'Supra',         tier: 't1', price: 95_000,    icon: '🚗', color: '#bcc3cd' },
  { id: 'mazda-mx5',      brand: 'Mazda',    model: 'MX-5 Miata',    tier: 't1', price: 70_000,    icon: '🚗', color: '#bcc3cd' },
  // Tier 2 — premium sedan
  { id: 'bmw-3',          brand: 'BMW',      model: '3 Series',      tier: 't2', price: 180_000,   icon: '🚙', color: '#6aa7ec' },
  { id: 'audi-a4',        brand: 'Audi',     model: 'A4',            tier: 't2', price: 170_000,   icon: '🚙', color: '#6aa7ec' },
  { id: 'mercedes-c',     brand: 'Mercedes', model: 'C-Class',       tier: 't2', price: 175_000,   icon: '🚙', color: '#6aa7ec' },
  // Tier 3 — sports / EV
  { id: 'tesla-s-plaid',  brand: 'Tesla',    model: 'Model S Plaid', tier: 't3', price: 250_000,   icon: '🏎', color: '#9be29b' },
  { id: 'porsche-911',    brand: 'Porsche',  model: '911 GT3',       tier: 't3', price: 350_000,   icon: '🏎', color: '#9be29b' },
  { id: 'bmw-m3',         brand: 'BMW',      model: 'M3 Competition',tier: 't3', price: 280_000,   icon: '🏎', color: '#9be29b' },
  // Tier 4 — hypercar
  { id: 'lambo-huracan',  brand: 'Lamborghini', model: 'Huracán',    tier: 't4', price: 800_000,   icon: '🏁', color: '#f2c443' },
  { id: 'ferrari-488',    brand: 'Ferrari',  model: '488 GTB',       tier: 't4', price: 900_000,   icon: '🏁', color: '#f2c443' },
  { id: 'bugatti-chiron', brand: 'Bugatti',  model: 'Chiron',        tier: 't4', price: 3_000_000, icon: '🏁', color: '#ff5fb0' },
];

export function findCar(id: string): CarCatalogEntry | null {
  return CAR_CATALOG.find((c) => c.id === id) ?? null;
}

// ----- Luxury catalogue -----

export type LuxuryTier = 'l1' | 'l2' | 'l3';

export interface LuxuryCatalogEntry {
  id: string;
  label: string;
  tier: LuxuryTier;
  price: number;
  icon: string;
  color: string;
}

export const LUXURY_CATALOG: LuxuryCatalogEntry[] = [
  { id: 'hennessy',       label: 'Hennessy Cognac',  tier: 'l1', price: 50_000,    icon: '🥃', color: '#bcc3cd' },
  { id: 'gold-chain',     label: 'Gold Chain',       tier: 'l1', price: 75_000,    icon: '📿', color: '#bcc3cd' },
  { id: 'gold-bar',       label: 'Gold Bar',         tier: 'l1', price: 100_000,   icon: '🟨', color: '#bcc3cd' },
  { id: 'rolex',          label: 'Rolex Daytona',    tier: 'l2', price: 150_000,   icon: '⌚', color: '#6aa7ec' },
  { id: 'vintage-wine',   label: 'Vintage Wine',     tier: 'l2', price: 200_000,   icon: '🍷', color: '#6aa7ec' },
  { id: 'diamond-ring',   label: 'Diamond Ring',     tier: 'l2', price: 250_000,   icon: '💍', color: '#6aa7ec' },
  { id: 'patek',          label: 'Patek Philippe',   tier: 'l3', price: 500_000,   icon: '⌚', color: '#9be29b' },
  { id: 'diamond-necklace', label: 'Diamond Necklace', tier: 'l3', price: 1_000_000, icon: '💎', color: '#f2c443' },
  { id: 'art-painting',   label: 'Modern Art',       tier: 'l3', price: 2_000_000, icon: '🖼', color: '#f2c443' },
  { id: 'crown-jewel',    label: 'Crown Jewel',      tier: 'l3', price: 5_000_000, icon: '👑', color: '#ff5fb0' },
];

export function findLuxury(id: string): LuxuryCatalogEntry | null {
  return LUXURY_CATALOG.find((l) => l.id === id) ?? null;
}

// ----- Wire types -----

export interface LotAuctionWire {
  id: string;
  x: number;
  y: number;
  startedAt: number;
  endsAt: number;
  currentBid: number;
  /** Tag of the current high bidder (or null if no bids yet — happens when
   *  the first bidder's payment fails / on stale state). */
  currentBidderTag: string | null;
  currentBidderTeamId: string | null;
  /** Convenience: true if `forTeamId` is the current high bidder. */
  iAmHighBidder: boolean;
  /** Minimum amount the next bid must exceed. */
  minNextBid: number;
}

/** Slim wire-shape for the map view — list of owned-lot pins. */
export interface LotMapPin {
  id: string;
  x: number;
  y: number;
  ownerTeamId: string;
  ownerTag: string;
  ownerLogoId: string;
  ownerColor: string;
  /** Owner's MMR — drives the badge ring colour on the map. */
  ownerMmr: number;
  apartmentTier: ApartmentTier;
}

export interface LotCarWire {
  id: number;
  carId: string;
  boughtAt: number;
}

export interface LotLuxuryWire {
  id: number;
  itemId: string;
  boughtAt: number;
}

export interface LotResidentWire {
  playerId: string;
  movedInAt: number;
}

/** Full lot detail returned when the user opens a lot's modal. */
export interface LotDetailWire {
  id: string;
  x: number;
  y: number;
  ownerTeamId: string;
  ownerTag: string;
  ownerName: string;
  ownerLogoId: string;
  ownerColor: string;
  ownerMmr: number;
  ownerPeakMmr: number;
  ownerPlacementPlayed: number;
  apartmentTier: ApartmentTier;
  vaultBalance: number;
  /** Pending vault interest ready to collect (capped by
   *  LOT_VAULT_INTEREST_MAX_DAYS × current balance × daily rate). */
  pendingInterest: number;
  /** How many days of interest are queued up (capped). */
  interestDaysAccrued: number;
  /** UTC ms of the last interest collection — client renders the countdown. */
  lastInterestAt: number;
  cars: LotCarWire[];
  luxuries: LotLuxuryWire[];
  residents: LotResidentWire[];
  createdAt: number;
  /** Bids placed historically on the auction that won this lot — small log
   *  for the "purchase history" footer. Up to 20 entries. */
  bidHistory: { bidderTag: string; amount: number; placedAt: number }[];
}

/** One row of the Top 10 richest lots leaderboard — sums vault balance
 *  + garage + luxury showcase into a single net-worth figure so the
 *  ranking reflects total flex, not just cash. */
export interface LotLeaderboardEntry {
  rank: number;
  lotId: string;
  x: number;
  y: number;
  ownerTeamId: string;
  ownerTag: string;
  ownerName: string;
  ownerLogoId: string;
  ownerColor: string;
  apartmentTier: ApartmentTier;
  vaultBalance: number;
  carsValue: number;
  luxuriesValue: number;
  totalWorth: number;
  carCount: number;
  luxuryCount: number;
  residentCount: number;
}

/** Quest difficulty drives both the target threshold and the cash payout. */
export type QuestDifficulty = 'easy' | 'medium' | 'hard';

/** Cash payout per quest difficulty, BEFORE the streak multiplier. */
export const QUEST_REWARD: Record<QuestDifficulty, number> = {
  easy: 3_000,
  medium: 10_000,
  hard: 25_000,
};

/** Cash bonus for completing every single quest on a given day. */
export const QUEST_ALL_DONE_BONUS = 20_000;

/** Days at peak streak before the multiplier caps. After this, more login
 *  days don't push it higher — keeps the curve from going parabolic. */
export const QUEST_STREAK_CAP_DAYS = 14;
/** Multiplier at peak streak. Streak 0 → 1.0, streak 14+ → 2.0, linear. */
export const QUEST_STREAK_MAX_MULT = 2.0;

/** Compute the streak multiplier (1.0 → 2.0) from a streak day count. */
export function questStreakMultiplier(streak: number): number {
  const clamped = Math.max(0, Math.min(QUEST_STREAK_CAP_DAYS, streak));
  return 1.0 + (clamped / QUEST_STREAK_CAP_DAYS) * (QUEST_STREAK_MAX_MULT - 1.0);
}

/** One quest a team is currently tracking. Progress is server-authoritative
 *  and updates on every relevant in-game action. */
export interface DailyQuest {
  id: string;
  /** Quest template kind — same as the action key the server bumps. */
  kind: string;
  /** Human label rendered in the UI (already formatted with target). */
  label: string;
  difficulty: QuestDifficulty;
  target: number;
  progress: number;
  /** Cash reward after streak multiplier is applied. */
  reward: number;
  /** When claimed (ms epoch). Null = not yet claimed. */
  claimedAt: number | null;
}

/** Quest pool summary returned to the client every time it asks. Includes
 *  the team's current streak so the UI can show the multiplier banner. */
export interface QuestSnapshot {
  utcDate: string;
  quests: DailyQuest[];
  loginStreak: number;
  streakMult: number;
  /** True iff every quest in `quests` is claimed AND the all-done bonus
   *  has also been paid out today. */
  allDoneBonusClaimed: boolean;
  /** Reward of the all-done bonus (after streak multiplier). */
  allDoneBonus: number;
}

// ============ Crash / Rocket (gambling — rising multiplier) ============

/** Min/max bet on a single Crash round. Same band as Dragon Gate so the
 *  hub feels consistent. */
export const CRASH_MIN_BET = 500;
export const CRASH_MAX_BET = 50_000;
/** Multiplier growth: e^(rate * elapsed_ms). At 2× every 10 s the curve
 *  feels punchy without making >10× a routine event. */
export const CRASH_GROWTH_RATE_PER_MS = Math.log(2) / 10_000;
/** Chance the round insta-crashes at 1.0× — visible loss vibe to nudge
 *  conservative cash-outs. */
export const CRASH_INSTANT_BUST_CHANCE = 0.01;
/** Provable-fair-style house edge on the long-tail distribution (1% =
 *  E[payout] ≈ 0.99 × bet across all rounds). */
export const CRASH_HOUSE_EDGE = 0.01;

/** Outcome shape returned when a Crash round resolves (either user cashed
 *  out before the bust point or rode it past). */
export interface CrashResult {
  sessionId: string;
  outcome: 'cashout' | 'bust';
  /** Multiplier locked in. For 'cashout' this is what we paid out at;
   *  for 'bust' it's the secret crash point (revealed post-bust). */
  multiplier: number;
  /** The hidden crash point — revealed regardless of outcome so the
   *  player can see how far they could've gone. */
  crashAt: number;
  bet: number;
  /** Net change. cashout: +bet × (multiplier − 1); bust: −bet. */
  delta: number;
  newMoney: number;
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
/** Severance multiplier when releasing a player early. The owner pays
 *  the player this many months of wages to terminate the deal — keeps
 *  release from being a free way to dump unwanted contracts. */
export const RELEASE_WAGE_MULT = 2;
/** Floor so nominal-wage players still cost something to drop. */
export const MIN_RELEASE_FEE = 1_000;
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
  /** Float 0.00–1.00 — determines wear bucket + within-bucket multiplier. */
  float?: number;
  /** Serial number per skinId (e.g. "Howl #0042"). Provenance label. */
  serial?: number;
  /** Owner history snapshot (capped at last 10 entries). */
  history?: { teamId: string; teamTag: string; at: number }[];
}

// ============ Skin market (peer-to-peer trading) ============

/** Server commission on every peer skin sale — buyer pays full asking
 *  price; seller receives (1 − commission) × price. The diff disappears
 *  as a money sink, helps fight case-grind inflation. */
export const SKIN_MARKET_COMMISSION = 0.05;
/** Minimum/maximum asking price for a peer listing. */
export const SKIN_MARKET_MIN_PRICE = 100;
export const SKIN_MARKET_MAX_PRICE = 10_000_000;

/** Wire shape for one open peer listing. */
export interface SkinListingWire {
  id: string;
  skinInstanceId: string;
  sellerTeamId: string;
  sellerTeamTag: string;
  askingPrice: number;
  listedAt: number;
  /** Snapshot of the skin at list time — saves a second roundtrip. */
  skin: SkinInstanceWire;
}

// ============ Trade-up contract (10 same-rarity → 1 next-rarity) ============

/** Number of input skins required for a trade-up contract. */
export const TRADE_UP_INPUT_COUNT = 10;
/** Float buckets in canonical CS2 order. Float < threshold[i] → that bucket. */
export const WEAR_BUCKETS: ReadonlyArray<{ wear: SkinInstanceWire['wear']; max: number }> = [
  { wear: 'Factory New', max: 0.07 },
  { wear: 'Minimal Wear', max: 0.15 },
  { wear: 'Field-Tested', max: 0.38 },
  { wear: 'Well-Worn', max: 0.45 },
  { wear: 'Battle-Scarred', max: 1.0 },
];

/** Map a float (0..1) to its wear bucket label. */
export function wearForFloat(f: number): SkinInstanceWire['wear'] {
  const clamped = Math.max(0, Math.min(1, f));
  for (const b of WEAR_BUCKETS) {
    if (clamped < b.max) return b.wear;
  }
  return 'Battle-Scarred';
}

/** Within-bucket multiplier so lower float = higher market value. Ranges
 *  from ×1.30 (0.00 float in any bucket) to ×0.80 (top of bucket).
 *  Stacks on top of the bucket's base multiplier. */
export function floatPriceMultiplier(f: number): number {
  const clamped = Math.max(0, Math.min(1, f));
  // Linear ramp: float 0 → 1.30, float 1 → 0.80.
  return Math.round((1.30 - clamped * 0.50) * 1000) / 1000;
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

// ============ Team logo pack ============
//
// Curated emoji set the user picks from in the profile editor. Stored
// as a single string code (the emoji itself) on the team row so any
// future expansion just adds rows to the pack — no asset hosting, no
// DB migration. The sidebar / team profile / leaderboard all read the
// same field and render at whatever size they want.

export interface TeamLogoOption {
  id: string;      // the emoji itself, used as the stable code
  label: string;   // friendly tooltip label
  category: string;
}

export const LOGO_PACK: TeamLogoOption[] = [
  { id: '🐉', label: 'Dragon',    category: 'Beasts' },
  { id: '🦁', label: 'Lion',      category: 'Beasts' },
  { id: '🐺', label: 'Wolf',      category: 'Beasts' },
  { id: '🐍', label: 'Snake',     category: 'Beasts' },
  { id: '🦅', label: 'Eagle',     category: 'Beasts' },
  { id: '🦈', label: 'Shark',     category: 'Beasts' },
  { id: '🐯', label: 'Tiger',     category: 'Beasts' },
  { id: '🐻', label: 'Bear',      category: 'Beasts' },
  { id: '🦂', label: 'Scorpion',  category: 'Beasts' },
  { id: '🦇', label: 'Bat',       category: 'Beasts' },

  { id: '🔥', label: 'Fire',      category: 'Elements' },
  { id: '⚡', label: 'Bolt',      category: 'Elements' },
  { id: '☄',  label: 'Comet',     category: 'Elements' },
  { id: '🌟', label: 'Star',      category: 'Elements' },
  { id: '🌊', label: 'Wave',      category: 'Elements' },
  { id: '🌌', label: 'Galaxy',    category: 'Elements' },

  { id: '🛡', label: 'Shield',    category: 'Combat' },
  { id: '⚔',  label: 'Swords',    category: 'Combat' },
  { id: '🎯', label: 'Bullseye',  category: 'Combat' },
  { id: '🔱', label: 'Trident',   category: 'Combat' },
  { id: '💎', label: 'Diamond',   category: 'Symbols' },
  { id: '👑', label: 'Crown',     category: 'Symbols' },
  { id: '🏆', label: 'Trophy',    category: 'Symbols' },
  { id: '🧠', label: 'Mastermind',category: 'Symbols' },
];

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

export type SponsorStatus = 'pending' | 'active' | 'ready' | 'claimed' | 'declined';

/** Objective-based sponsorship. Each sponsor demands a specific number
 *  of wins to unlock the (one-shot) reward. Progress is computed as
 *  team's current career wins minus wins_at_start snapshotted at
 *  acceptance. Cancellable at any time. */
export interface SponsorOffer {
  id: string;
  teamId: string;
  sponsorName: string;
  /** One-shot reward paid on Claim. */
  rewardAmount: number;
  /** Total wins required after acceptance to unlock the reward. */
  winsRequired: number;
  /** Wins credited so far under this sponsorship (server-computed). */
  winsProgress: number;
  status: SponsorStatus;
  offeredAt: number;
  activatedAt?: number;
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
  /** Team A is always a real team (the duel initiator). */
  teamAId: string;
  /** Team B is null when the opponent was an AI (no clickable profile). */
  teamBId: string | null;
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

/** PvP-only leaderboard row — derived from match_history this season,
 *  AI duels excluded. Encourages players to fight each other rather
 *  than grinding AI for the standings. */
export interface PvpLeaderRow {
  rank: number;
  teamId: string;
  teamTag: string;
  teamName: string;
  pvpWins: number;
  pvpLosses: number;
  /** Net stake won/lost across PvP matches this season. */
  pvpNetStake: number;
  /** Trailing PvP streak: + for current W-streak, − for L-streak. */
  pvpStreak: number;
}

export interface MyPvpStandings {
  pvpWins: number;
  pvpLosses: number;
  pvpNetStake: number;
  pvpStreak: number;
}

export interface RankedLeaderRow {
  rank: number;
  teamId: string;
  teamTag: string;
  teamName: string;
  mmr: number;
  peakMmr: number;
  placementMatchesPlayed: number;
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
  /** Opponent team id when they're a real team (PvP / Quick Match);
   *  null when it was a synthetic AI opponent (no clickable profile). */
  opponentTeamId?: string | null;
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
  /** When true, the client should NOT show the result modal immediately.
   *  Instead it routes both teams into the synced replay viewer locked at
   *  4× speed with no scrub controls; the modal pops only after the last
   *  frame plays out. Used for PvP so both sides share the spectator
   *  experience, can't accidentally read the score before the other side. */
  lockedReplay?: boolean;
  /** MMR change this PvP earned. Negative = lost MMR. Undefined for AI
   *  duels (MMR is PvP-only). */
  mmrDelta?: number;
  /** New MMR after the change. Pairs with mmrDelta for the result banner. */
  newMmr?: number;
  /** True iff this match was inside the placement window. UI uses this
   *  to label the K-factor as doubled. */
  wasPlacement?: boolean;
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
  /** Role composition multiplier the engine applied to the user side this
   *  match (1.00 = neutral). Mirrors what real CS punishes / rewards:
   *  no IGL = bad, 2+ AWPers = bad, balanced 5-role squad = +2% bonus. */
  userRoleSynergy?: number;
  /** Same multiplier for the opponent side. */
  oppRoleSynergy?: number;
  /** Plain-language breakdown of the user-side synergy decisions. */
  userSynergyNotes?: string[];
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
  | { kind: 'claim-sponsor'; sponsorId: string }
  | { kind: 'cancel-sponsor'; sponsorId: string }
  // ----- E-Wallet peer transfers -----
  | { kind: 'ewallet-send-cash'; toTeamTag: string; amount: number }
  | { kind: 'ewallet-send-skin'; toTeamTag: string; skinInstanceId: string }
  | { kind: 'ewallet-send-player'; toTeamTag: string; playerId: string }
  | { kind: 'ewallet-send-lot'; toTeamTag: string; lotId: string }
  // ----- Mint: scout a fresh wonderkid (rarity rolled server-side) -----
  | { kind: 'mint-free-agent' }
  // ----- Daily login bonus -----
  | { kind: 'claim-daily-bonus' }
  // ----- Duel cap: refill ALL missing duels for today (capped per day) -----
  | { kind: 'refill-duels' }
  // ----- Massage center: book a random-class spa session for the starters -----
  | { kind: 'book-massage' }
  // ----- Morale mini-game: play one round of rock-paper-scissors -----
  | { kind: 'play-morale-game'; choice: RpsChoice }
  // ----- Dragon Gate (in-between): single bet, server rolls 3 cards -----
  | { kind: 'play-dragon-gate'; bet: number }
  // ----- Crash / Rocket: server picks bust point, client cashes out live -----
  | { kind: 'start-crash'; bet: number }
  | { kind: 'cashout-crash'; sessionId: string }
  // ----- Mines: server hides N mines on a 5×5 grid, client reveals tiles -----
  | { kind: 'start-mines'; bet: number; mineCount: number }
  | { kind: 'pick-mine-tile'; sessionId: string; tileIndex: number }
  | { kind: 'cashout-mines'; sessionId: string }
  // ----- Streaming: player runs a Faceit pickup, earns money from fans -----
  | { kind: 'stream-player'; playerId: string }
  // ----- Quick Match: pick a stake, server finds a CA-balanced opponent -----
  | { kind: 'find-async-match'; stake: number }
  // ----- Click-to-view enemy team profile (scrubbed roster + standings) -----
  | { kind: 'fetch-team-profile'; teamId: string }
  // ----- Daily quests + login streak -----
  | { kind: 'list-quests' }
  | { kind: 'claim-quest'; questId: string }
  | { kind: 'claim-all-done-bonus' }
  // ----- AI vs AI betting -----
  | { kind: 'list-ai-bets' }
  | { kind: 'place-ai-bet'; cardId: string; side: 'A' | 'B'; stake: number }
  | { kind: 'fetch-ai-bet-replay'; cardId: string }
  | { kind: 'fetch-ai-bet-team'; cardId: string; side: 'A' | 'B' }
  | { kind: 'list-my-ai-bet-history' }
  // ----- Virtual real estate -----
  | { kind: 'list-lot-map'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'list-lot-auctions' }
  | { kind: 'list-my-lots' }
  | { kind: 'fetch-lot-detail'; x: number; y: number }
  | { kind: 'place-lot-bid'; x: number; y: number; amount: number }
  | { kind: 'upgrade-lot-apartment'; lotId: string; toTier: ApartmentTier }
  | { kind: 'buy-lot-car'; lotId: string; carId: string }
  | { kind: 'sell-lot-car'; lotId: string; lotCarId: number }
  | { kind: 'buy-lot-luxury'; lotId: string; itemId: string }
  | { kind: 'sell-lot-luxury'; lotId: string; lotLuxuryId: number }
  | { kind: 'lot-vault-deposit'; lotId: string; amount: number }
  | { kind: 'lot-vault-withdraw'; lotId: string; amount: number }
  | { kind: 'lot-assign-resident'; lotId: string; playerId: string }
  | { kind: 'lot-evict-resident'; lotId: string; playerId: string }
  | { kind: 'list-lot-leaderboard' }
  | { kind: 'collect-lot-interest'; lotId: string }
  // ----- MMR rank leaderboard -----
  | { kind: 'list-ranked-leaderboard' }
  // ----- Contract renewal: extend a starter's duels-remaining -----
  | { kind: 'renew-contract'; playerId: string }
  // ----- Release a player to free agency (pays severance) -----
  | { kind: 'release-player'; playerId: string }
  // ----- Case opening (skins → team.money on resale) -----
  | { kind: 'list-cases' }
  | { kind: 'open-case'; caseId: string }
  | { kind: 'open-free-case' }
  | { kind: 'list-skins' }
  | { kind: 'sell-skin'; skinId: string }
  // ----- Peer skin market -----
  | { kind: 'list-skin-market' }
  | { kind: 'list-skin'; skinInstanceId: string; askingPrice: number }
  | { kind: 'unlist-skin'; listingId: string }
  | { kind: 'buy-skin-listing'; listingId: string }
  // ----- Trade-up contract: combine 10 same-rarity → 1 next-rarity -----
  | { kind: 'trade-up-skins'; skinInstanceIds: string[] }
  // ----- Booster packs (gacha) -----
  | { kind: 'list-boosts' }
  | { kind: 'buy-boost-pack' }
  | { kind: 'apply-boost'; cardId: string; playerId: string }
  | { kind: 'discard-boost'; cardId: string }
  | { kind: 'sell-boost'; cardId: string }
  | { kind: 'quick-sell-boosts-by-rarity'; rarity: BoostRarity }
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
  | { kind: 'match-detail'; matchId: string; result: MatchResult; teamATag: string; teamBTag: string }
  // ----- Phase 4 -----
  | { kind: 'tactics-saved'; tactics: Partial<Tactics> }
  | { kind: 'lineup-saved'; playerIds: string[] }
  | { kind: 'leaderboard'; season: SeasonInfo; rows: LeaderboardRow[]; me: MyStandings; pvpRows: PvpLeaderRow[]; myPvp: MyPvpStandings }
  // ----- Phase 5 -----
  | { kind: 'live-replay'; matchId: string; result: MatchResult; teamATag: string; teamBTag: string; /** Optional team A roster anchor for spectator-mode replays (AI bet "Watch replay" path) — lets the viewer split the scoreboard correctly when neither team is the user's. */ teamARosterIds?: string[] }
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
  | { kind: 'team-profile'; profile: PublicTeamProfile }
  | { kind: 'quest-snapshot'; snapshot: QuestSnapshot }
  | { kind: 'quest-claimed'; questId: string; cashEarned: number; newMoney: number; snapshot: QuestSnapshot }
  | { kind: 'all-done-bonus-claimed'; cashEarned: number; newMoney: number; snapshot: QuestSnapshot }
  | { kind: 'ai-bet-list'; cards: AiMatchCardWire[] }
  | { kind: 'ai-bet-placed'; cardId: string; newMoney: number }
  | { kind: 'ai-bet-settled'; cardId: string; bet: AiBetSummary; newMoney: number }
  | { kind: 'ai-bet-card-update'; card: AiMatchCardWire }
  | { kind: 'ai-bet-team'; cardId: string; side: 'A' | 'B'; profile: AiBetTeamProfile }
  | { kind: 'ai-bet-my-history'; entries: AiBetHistoryEntry[] }
  // Pushed to EVERY bettor on a card the instant its countdown ends and
  // the sim runs. The client auto-routes to the replay viewer in locked
  // mode (4× speed, no scrub) so every bettor watches the same match at
  // the same beat — the AI bet equivalent of the synced PvP replay.
  | { kind: 'ai-bet-replay-starting'; cardId: string; matchId: string; result: MatchResult; teamATag: string; teamBTag: string; teamARosterIds: string[] }
  // ----- Real estate -----
  | { kind: 'lot-map'; pins: LotMapPin[] }
  | { kind: 'lot-auctions'; auctions: LotAuctionWire[] }
  | { kind: 'my-lots'; lots: LotMapPin[] }
  | { kind: 'lot-detail'; lot: LotDetailWire }
  | { kind: 'lot-bid-placed'; auction: LotAuctionWire; newMoney: number }
  | { kind: 'lot-outbid'; x: number; y: number; refund: number; newMoney: number }
  | { kind: 'lot-auction-won'; lot: LotDetailWire; newMoney: number }
  | { kind: 'lot-auction-lost'; x: number; y: number; refund: number; newMoney: number }
  | { kind: 'lot-auction-update'; auction: LotAuctionWire }
  | { kind: 'lot-updated'; lot: LotDetailWire; newMoney: number }
  | { kind: 'lot-leaderboard'; entries: LotLeaderboardEntry[] }
  | { kind: 'ranked-leaderboard'; rows: RankedLeaderRow[] }
  | { kind: 'loan-offers'; incoming: LoanOffer[]; outgoing: LoanOffer[] }
  | { kind: 'loan-event'; loan: LoanOffer }
  // ----- Phase 9 -----
  | { kind: 'presence'; onlineTeams: number }
  | { kind: 'hof'; entries: HoFEntry[] }
  | { kind: 'player-retired'; playerId: string; nickname: string; lastAge: number }
  | { kind: 'coach-pool'; openCoaches: CoachListing[]; myCoach: CoachListing | null }
  | { kind: 'coach-hired'; coach: CoachListing }
  | { kind: 'sponsors'; offers: SponsorOffer[]; paid: { sponsorId: string; amount: number }[] }
  | { kind: 'sponsor-claimed'; sponsorId: string; amount: number; newMoney: number }
  | { kind: 'ewallet-sent'; assetKind: 'cash' | 'skin' | 'player' | 'lot'; toTeamTag: string; description: string; newMoney: number }
  | { kind: 'ewallet-received'; assetKind: 'cash' | 'skin' | 'player' | 'lot'; fromTeamTag: string; description: string; newMoney: number }
  | { kind: 'player-scouted'; player: Player; cost: number; rarity: ScoutRarity; newMoney: number }
  // ----- Daily bonus + cases -----
  | { kind: 'daily-bonus-claimed'; amount: number; newMoney: number; nextClaimUtc: string }
  | { kind: 'duel-stats'; used: number; refillsUsed: number; cap: number; remaining: number }
  | { kind: 'duels-refilled'; cost: number; newMoney: number; refillsUsed: number; refillsLeft: number }
  | { kind: 'contract-renewed'; playerId: string; cost: number; newMoney: number; duelsRemaining: number }
  | { kind: 'player-expired'; playerId: string; nickname: string }
  | { kind: 'player-released'; playerId: string; nickname: string; cost: number; newMoney: number }
  | { kind: 'massage-booked'; outcome: MassageOutcome; cost: number; newMoney: number; nextEligibleGameDay: number }
  | { kind: 'morale-game-result'; result: MoraleGameResult }
  | { kind: 'dragon-gate-result'; result: DragonGateResult }
  | { kind: 'crash-started'; sessionId: string; bet: number; startedAt: number; serverNowMs: number; newMoney: number }
  | { kind: 'crash-result'; result: CrashResult }
  | { kind: 'mines-started'; sessionId: string; bet: number; mineCount: number; newMoney: number }
  /** Sent per safe reveal — round continues, user may pick again or cash out. */
  | { kind: 'mines-tile-revealed'; sessionId: string; tileIndex: number; multiplier: number; safePicks: number }
  | { kind: 'mines-result'; result: MinesResult }
  | { kind: 'stream-result'; result: StreamResult }
  | { kind: 'case-list'; cases: CaseSummary[]; freeCaseId: string; freeCaseAvailable: boolean }
  | { kind: 'case-opened'; instance: SkinInstanceWire; caseId: string; cost: number; newMoney: number; freeCase?: boolean; strip: SkinStripEntry[]; winnerIndex: number }
  | { kind: 'skin-inventory'; skins: SkinInstanceWire[] }
  | { kind: 'skin-sold'; skinId: string; payout: number; newMoney: number }
  | { kind: 'skin-market'; listings: SkinListingWire[] }
  | { kind: 'skin-listed'; listing: SkinListingWire }
  | { kind: 'skin-unlisted'; listingId: string }
  | { kind: 'skin-bought'; listingId: string; skin: SkinInstanceWire; cost: number; newMoney: number }
  | { kind: 'skin-trade-up'; output: SkinInstanceWire; consumedIds: string[]; outputFloat: number }
  // ----- Booster packs -----
  | { kind: 'boost-inventory'; cards: BoostCard[]; activeByPlayer: Record<string, ActiveBoostWire> }
  | { kind: 'boost-pack-opened'; card: BoostCard; cost: number; newMoney: number }
  | { kind: 'boost-applied'; cardId: string; playerId: string; active: ActiveBoostWire }
  | { kind: 'boost-discarded'; cardId: string }
  | { kind: 'boosts-sold'; cardIds: string[]; totalCash: number; newMoney: number }
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
export const PROTOCOL_VERSION = 47;

/** Length of one in-game day in real-world ms. The wall-clock auto-tick
 *  advances every team's day by 1 at each multiple of this duration past
 *  the UTC epoch — i.e. at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC. */
export const AUTO_TICK_MS = 4 * 3600 * 1000;
/** Age past which players have a non-zero chance to retire each time-skip week. */
export const RETIREMENT_AGE_THRESHOLD = 32;
/** Sponsor payment cadence — auto-credit once per 30 real days while active. */
export const SPONSOR_PAYMENT_INTERVAL_MS = 30 * 24 * 3600 * 1000;

// ============ Scout tiers (pay-to-scout, direct-sign with case animation) ============

/** Gacha tiers — each scout commission rolls one player and signs them
 *  directly to the caller's team on a 30-day contract. */
/** Rarity tiers for scout drops. FC-pack style — most rolls are Bronze /
 *  Silver, with Gold a real treat and ICON a once-in-a-blue-moon drop.
 *  The user can NOT pick the tier — it's rolled when the pack opens. */
export type ScoutRarity = 'bronze' | 'silver' | 'gold' | 'rareGold' | 'icon';

/** Flat cost per scout pack. Tuned to be expensive enough that you can't
 *  spam-roll for a legendary, but cheap enough to grind a few per session. */
export const SCOUT_COST = 15_000;

/** Spawn weights — sum = 100, so these read as straight percentages. */
export const SCOUT_RARITY_WEIGHTS: Record<ScoutRarity, number> = {
  bronze: 45,
  silver: 28,
  gold: 18,
  rareGold: 7,
  icon: 2,
};

/** Per-rarity meta: PA window (hard), age window (younger = more growth),
 *  CA fraction of PA, # of trait rolls, glow color, label. */
export const SCOUT_RARITY_META: Record<ScoutRarity, {
  label: string;
  shortLabel: string;
  color: string;
  glow: string;
  paRange: [number, number];
  ageRange: [number, number];
  caFraction: [number, number];
  /** Probability distribution for trait count. Sum must = 1. */
  traitCounts: { p0: number; p1: number; p2: number; p3: number };
}> = {
  bronze: {
    label: 'Bronze',
    shortLabel: 'B',
    color: '#a8743a',
    glow: 'rgba(168,116,58,0.55)',
    paRange: [70, 105],
    ageRange: [19, 27],
    caFraction: [0.70, 0.90],
    traitCounts: { p0: 0.60, p1: 0.35, p2: 0.05, p3: 0 },
  },
  silver: {
    label: 'Silver',
    shortLabel: 'S',
    color: '#bcc3cd',
    glow: 'rgba(188,195,205,0.55)',
    paRange: [100, 130],
    ageRange: [17, 24],
    caFraction: [0.62, 0.85],
    traitCounts: { p0: 0.45, p1: 0.45, p2: 0.10, p3: 0 },
  },
  gold: {
    label: 'Gold',
    shortLabel: 'G',
    color: '#f2c443',
    glow: 'rgba(242,196,67,0.60)',
    paRange: [125, 155],
    ageRange: [16, 21],
    caFraction: [0.55, 0.80],
    traitCounts: { p0: 0.25, p1: 0.55, p2: 0.20, p3: 0 },
  },
  rareGold: {
    label: 'Rare Gold',
    shortLabel: 'RG',
    color: '#ff9a3c',
    glow: 'rgba(255,154,60,0.70)',
    paRange: [150, 175],
    ageRange: [16, 20],
    caFraction: [0.50, 0.75],
    traitCounts: { p0: 0.10, p1: 0.50, p2: 0.35, p3: 0.05 },
  },
  icon: {
    label: 'ICON',
    shortLabel: 'ICON',
    color: '#ff5fb0',
    glow: 'rgba(255,95,176,0.75)',
    paRange: [175, 198],
    ageRange: [16, 19],
    caFraction: [0.48, 0.72],
    traitCounts: { p0: 0, p1: 0.20, p2: 0.50, p3: 0.30 },
  },
};

/** Initial contract length (in duels) for a scouted player — short by
 *  design so the user has to decide whether to renew. */
export const SCOUT_CONTRACT_DUELS = 30;
/** Hard cap on per-team loan offer duration. */
export const MAX_LOAN_DAYS = 21;
/** Fatigue restored to each BENCH player every time the team plays a duel
 *  (rotation reward — bench rests while starters play). Both AI duels +
 *  PvP qualify; scrims too, since they still use the starting 5. */
export const BENCH_FATIGUE_RECOVERY_PER_DUEL = 8;
/** Penalty multiplier when the lender recalls an ACTIVE loan early — the
 *  lender pays the borrower fee × (1 + this) to break the agreement.
 *  0.5 → fee × 1.5 (50% on top of the original fee). */
export const LOAN_RECALL_PENALTY_MULT = 0.5;
/** Achievement kinds with human-readable labels. Server passes the label
 *  in the unlock event so the client can show the toast without a lookup. */
export const ACHIEVEMENT_LABELS: Record<string, string> = {
  // ===== Combat ladder (career duel wins) =====
  first_blood: '🩸 First Blood — won your first duel',
  ten_wins: '🔟 Veteran — 10 career duel wins',
  fifty_wins: '5️⃣0️⃣ Dynasty — 50 career duel wins',
  hundred_wins: '💯 Centurion — 100 career duel wins',
  two_fifty_wins: '🏛️ Legend — 250 career duel wins',
  five_hundred_wins: '👑 Immortal — 500 career duel wins',

  // ===== PvP-only ladder =====
  pvp_first_blood: '⚔️ Live Opener — first PvP duel win against a real manager',
  pvp_ten_wins: '⚔️ Brawler — 10 PvP wins',
  pvp_fifty_wins: '⚔️ Gladiator — 50 PvP wins',
  pvp_hundred_wins: '⚔️ Warlord — 100 PvP wins',

  // ===== Streaks & domination =====
  streak_5: '🔥 Heater — 5-duel win streak',
  streak_10: '🔥 Untouchable — 10-duel win streak',
  perfect_map: '🎯 16-0 — swept a map without dropping a round',
  giant_slayer: '😱 Giant Slayer — beat a team with 40+ higher avg CA in PvP',
  underdog_win: '😱 Cinderella — beat a team with a higher avg CA in PvP',

  // ===== Tournament =====
  first_tournament: '🏆 Trophy Cabinet — won your first tournament',
  five_tournaments: '🏆🏆 Serial Winner — won 5 tournaments',
  twenty_tournaments: '🏆🏆🏆 Dynastic — won 20 tournaments',

  // ===== Economy =====
  bankroll_100k: '💵 First $100k Profit — net duel earnings crossed $100,000',
  bankroll_500k: '💵 Half-Mil — net duel earnings crossed $500,000',
  millionaire: '💰 Millionaire — held $1M on hand',
  big_money: '💰 Big Money — held $5M on hand',
  mogul: '💰 Mogul — held $10M on hand',

  // ===== Roster / management =====
  first_fa_sign: '💼 Player Agent — signed your first free agent',
  full_roster: '🧑‍🤝‍🧑 Full Squad — held 12+ players at once',
  first_goal_reached: '🎯 Coach — first development goal hit',
  first_retire: '👴 End of an Era — first player retired into the HoF',
  coached_up: '🎓 Headhunter — hired your first coach',
  first_sponsor: '📣 Endorsed — signed your first sponsor',
  first_loan: '🤝 Loaner — first loan accepted (either direction)',
  first_market_sale: '💰 Trader — closed your first market sale',

  // ===== Cases / skins (NFT loop) =====
  case_opener: '📦 Case Opener — opened 100 cases',
  case_addict: '📦📦 Case Addict — opened 500 cases',
  covert_drop: '🔴 Covert! — first covert (red) skin dropped',
  rare_special_drop: '🟡 Gold Knife — first rare-special drop',
  white_float_drop: '✨ White Float — pulled a skin with float below 0.01',
  first_trade_up: '⬆️ Trade-Up Artist — completed your first trade-up',
  skin_seller_5: '🔄 Skin Flipper — closed 5 peer skin sales',

  // ===== Streaming =====
  first_stream: '📺 Live On Air — streamed your first session',
  streamer_50: '📺 Influencer — streamed 50 times',
  famous: '🌟 Famous — crossed 100k team fans',

  // ===== Mini-games =====
  crash_cashout_10x: '🚀 To The Moon — cashed out Crash at 10×+',
  mines_perfect: '💎 Sweeper — cleared every safe tile in Mines',
  dragon_in_between: '🐉 Dragon Slayer — first Dragon Gate win',

  // ===== Social =====
  first_profile_edit: '🎨 Branded — customised your team profile',
  first_dm: '💬 Whisper — sent your first direct message',

  // ===== Meta collector =====
  collector_5: '🎖️ Hoarder — unlocked 5 achievements',
  collector_15: '🎖️🎖️ Completionist-in-Training — unlocked 15 achievements',
  collector_30: '🎖️🎖️🎖️ True Completionist — unlocked 30 achievements',
};

/** Cash reward paid when an achievement first unlocks. Tier from light
 *  ($5k starter) → mythic ($250k career-defining). Auto-credited at
 *  unlock time. Unknown kinds default to $5k so future achievements
 *  always pay SOMETHING even before they're listed here. */
export const ACHIEVEMENT_REWARDS: Record<string, number> = {
  // ===== Easy / first-time ($5k) =====
  first_blood: 5000, first_tournament: 5000, first_fa_sign: 5000,
  first_market_sale: 5000, first_goal_reached: 5000, pvp_first_blood: 5000,
  first_retire: 5000, coached_up: 5000, first_sponsor: 5000, first_loan: 5000,
  first_stream: 5000, first_profile_edit: 5000, first_dm: 5000,
  dragon_in_between: 5000, first_trade_up: 5000, covert_drop: 5000,

  // ===== Medium ($15k) =====
  ten_wins: 15000, fifty_wins: 15000, pvp_ten_wins: 15000, streak_5: 15000,
  bankroll_100k: 15000, full_roster: 15000, five_tournaments: 15000,
  streamer_50: 15000, case_opener: 15000, skin_seller_5: 15000,
  crash_cashout_10x: 15000, mines_perfect: 15000, collector_5: 15000,

  // ===== Hard ($50k) =====
  hundred_wins: 50000, pvp_fifty_wins: 50000, streak_10: 50000,
  perfect_map: 50000, underdog_win: 50000,
  bankroll_500k: 50000, millionaire: 50000,
  famous: 50000, case_addict: 50000, collector_15: 50000,

  // ===== Legendary ($100k) =====
  two_fifty_wins: 100000, pvp_hundred_wins: 100000,
  twenty_tournaments: 100000,
  giant_slayer: 100000, rare_special_drop: 100000, white_float_drop: 100000,
  big_money: 100000,

  // ===== Mythic ($250k) =====
  five_hundred_wins: 250000, mogul: 250000, collector_30: 250000,
};

/** Look up the cash reward for a kind. Unknown kind → $5k floor. */
export function achievementReward(kind: string): number {
  return ACHIEVEMENT_REWARDS[kind] ?? 5000;
}
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
