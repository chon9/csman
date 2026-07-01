// SQLite schema + small query helpers. One file = one DB; survives restarts.
// Players are stored as JSON blobs (the Player shape is big and evolves
// frequently; querying by inner fields isn't needed for Phase 1-2).

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { Player, Region, Tactics } from '../../src/types.ts';

export interface TeamRow {
  id: string;
  name: string;
  tag: string;
  region: Region;
  ownerNick: string;
  money: number;
  day: number;
  createdAt: number;
  playerIds: string[];
  /** Persisted Tactics object — empty `{}` until the owner first edits. */
  tactics: Partial<Tactics>;
  /** Free-form bio shown on the public team profile page. */
  bio: string;
  /** Primary team color (CSS hex) — drives accents on the profile page. */
  primaryColor: string;
  twitchUrl: string;
  twitterUrl: string;
  youtubeUrl: string;
  /** Chosen emoji logo id from LOGO_PACK. Empty = no custom logo set. */
  logoId: string;
  /** Competitive PvP MMR. Seeded at 1000 on first load. */
  mmr: number;
  peakMmr: number;
  placementMatchesPlayed: number;
  /** Opaque BTC-style handle used as the E-Wallet recipient. Format:
   *  `CSM-XXXX-XXXX-XXXX`. Empty string only for teams created before
   *  the wallet-id migration ran; the boot backfill fills those in. */
  walletId: string;
}

/** Generate a fresh Wallet ID. 12 hex chars grouped in 4s with a `CSM-`
 *  prefix; uppercased. Collisions are handled by the caller (UNIQUE
 *  index retry loop). */
export function generateWalletId(): string {
  const raw = randomBytes(6).toString('hex').toUpperCase();
  return `CSM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Profile fields editable on the home customisation modal. */
export interface TeamProfileFields {
  bio?: string;
  primaryColor?: string;
  twitchUrl?: string;
  twitterUrl?: string;
  youtubeUrl?: string;
}

export interface SessionRow {
  token: string;
  teamId: string;
  lastSeen: number;
}

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // Durability + perf tuning.
  //   WAL: concurrent readers don't block writers; survives crashes.
  //   synchronous=NORMAL: fsync less often than FULL (safe under WAL); ~2-4× faster writes.
  //   cache_size=-65536: 64 MB page cache (default is 2 MB — way too small for this workload).
  //   mmap_size=268435456: 256 MB read-side memory map; cheaper random reads on big DBs.
  //   temp_store=MEMORY: keep B-tree sorts / temp tables off disk.
  //   busy_timeout=5000: wait up to 5s for a contended lock before throwing.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -65536');
  db.pragma('mmap_size = 268435456');
  db.pragma('temp_store = MEMORY');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS owners (
      nickname TEXT PRIMARY KEY COLLATE NOCASE,
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      team_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tag TEXT NOT NULL,
      region TEXT NOT NULL,
      owner_nick TEXT NOT NULL,
      money INTEGER NOT NULL,
      day INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      player_ids TEXT NOT NULL DEFAULT '[]',
      tactics_json TEXT NOT NULL DEFAULT '{}',
      wallet_id TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (owner_nick) REFERENCES owners(nickname)
    );
    -- NOTE: the UNIQUE index on wallet_id is created AFTER the tryAddColumn
    -- migration further below. Creating it here would crash on pre-migration
    -- DBs where the CREATE TABLE IF NOT EXISTS is a no-op and the wallet_id
    -- column doesn't exist yet.

    -- Single-row table tracking the current weekly season + a rolling
    -- standings counter per team. Season rolls over every 7 real days.
    CREATE TABLE IF NOT EXISTS seasons (
      season_no INTEGER PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      prize_pool INTEGER NOT NULL DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS season_standings (
      season_no INTEGER NOT NULL,
      team_id TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      net_money INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (season_no, team_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_standings_season ON season_standings(season_no, wins DESC);

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      json TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS market_listings (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL UNIQUE,
      seller_team_id TEXT NOT NULL,
      seller_team_tag TEXT NOT NULL,
      asking_price INTEGER NOT NULL,
      listed_at INTEGER NOT NULL,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (seller_team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_listings_team ON market_listings(seller_team_id);

    -- PvP challenges. Sits in 'open' until accepted (and resolved in the
    -- same handler call) or cancelled. Resolved matches drop their row and
    -- write into match_history.
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      challenger_team_id TEXT NOT NULL,
      challenger_tag TEXT NOT NULL,
      challenger_nick TEXT NOT NULL,
      stake INTEGER NOT NULL,
      format TEXT NOT NULL,
      message TEXT,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      FOREIGN KEY (challenger_team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);

    -- Match history. Persisted summary of every resolved duel (AI + PvP).
    -- Frames are stripped before insert, so each row stays small.
    CREATE TABLE IF NOT EXISTS match_history (
      id TEXT PRIMARY KEY,
      team_a_id TEXT NOT NULL,
      team_b_id TEXT,                -- nullable for AI opponents
      team_a_tag TEXT NOT NULL,
      team_b_tag TEXT NOT NULL,
      winner_id TEXT NOT NULL,
      maps_a INTEGER NOT NULL,
      maps_b INTEGER NOT NULL,
      stake INTEGER NOT NULL,
      kind TEXT NOT NULL,            -- 'ai' | 'pvp'
      played_at INTEGER NOT NULL,
      result_json TEXT NOT NULL      -- stripped MatchResult for replay
    );
    CREATE INDEX IF NOT EXISTS idx_history_team_a ON match_history(team_a_id, played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_team_b ON match_history(team_b_id, played_at DESC);
    -- Stats / leaderboard scans pull "all PvP matches in time window" — needs an index by kind.
    CREATE INDEX IF NOT EXISTS idx_history_kind_played ON match_history(kind, played_at DESC);

    -- Named tactics presets, scoped to an owner nickname.
    CREATE TABLE IF NOT EXISTS tactics_presets (
      id TEXT PRIMARY KEY,
      owner_nick TEXT NOT NULL,
      name TEXT NOT NULL,
      tactics_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presets_owner ON tactics_presets(owner_nick, created_at DESC);

    -- Achievement unlocks per team. PK on (team_id, kind) keeps each
    -- unlockable to exactly one row even if the unlock check fires twice.
    CREATE TABLE IF NOT EXISTS achievements (
      team_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value INTEGER,
      achieved_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, kind),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    -- Player loans (online). Lifecycle: pending → active → returned, or
    -- pending → declined. Auto-return fires when ends_at passes (checked
    -- on every relevant handler call — no separate scheduler).
    CREATE TABLE IF NOT EXISTS player_loans (
      id TEXT PRIMARY KEY,
      from_team_id TEXT NOT NULL,
      to_team_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      fee INTEGER NOT NULL,
      days INTEGER NOT NULL,
      offered_at INTEGER NOT NULL,
      ends_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (from_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (to_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_loans_status ON player_loans(status, ends_at);
    CREATE INDEX IF NOT EXISTS idx_loans_to ON player_loans(to_team_id, status);
    CREATE INDEX IF NOT EXISTS idx_loans_from ON player_loans(from_team_id, status);
    -- Pre-offer guard + release-time check both look up by player_id only.
    CREATE INDEX IF NOT EXISTS idx_loans_player ON player_loans(player_id, status);

    -- Permanent honour list of retired players. Snapshot at retirement
    -- time — independent of the players table (rows may eventually be
    -- pruned to keep that table slim).
    CREATE TABLE IF NOT EXISTS hall_of_fame (
      player_id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      role TEXT NOT NULL,
      nationality TEXT NOT NULL,
      last_age INTEGER NOT NULL,
      peak_ca INTEGER NOT NULL,
      career_wins INTEGER NOT NULL DEFAULT 0,
      career_losses INTEGER NOT NULL DEFAULT 0,
      last_team_id TEXT,
      last_team_tag TEXT,
      retired_at INTEGER NOT NULL
    );

    -- NPC coach pool. Rotates server-wide; each coach can be hired by one
    -- team at a time. When hired, gives the buyer's training tick a flat
    -- boost during time-skip.
    CREATE TABLE IF NOT EXISTS coaches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nationality TEXT NOT NULL,
      skill INTEGER NOT NULL,         -- 1-20, multiplies training tick
      monthly_wage INTEGER NOT NULL,
      hired_by_team_id TEXT,          -- null when in the open pool
      hired_at INTEGER,
      generated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coaches_hired ON coaches(hired_by_team_id);

    -- Sponsor deals. Server generates pending offers; team accepts; the
    -- monthly amount auto-credits on each refresh-state when at least
    -- 30 days have elapsed since last payout (simple cadence).
    CREATE TABLE IF NOT EXISTS sponsors (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      sponsor_name TEXT NOT NULL,
      monthly_amount INTEGER NOT NULL,           -- historical column name; now the one-shot reward
      status TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'active' | 'ready' | 'claimed' | 'declined'
      offered_at INTEGER NOT NULL,
      last_paid_at INTEGER,                      -- unused in objective model; kept for legacy rows
      wins_required INTEGER NOT NULL DEFAULT 0,  -- 0 = legacy row (marked declined on boot)
      wins_at_start INTEGER NOT NULL DEFAULT 0,  -- career-wins snapshot at activation
      activated_at INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sponsors_team ON sponsors(team_id, status);

    -- Auto-generated news ticker items — capped via post-insert trim.
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,         -- 'transfer' | 'tournament' | 'goal' | 'duel' | 'other'
      body TEXT NOT NULL,
      at INTEGER NOT NULL
    );

    -- Player development goals: manager-set attribute targets. Cleared on
    -- success (reached_at set) so they stay on the player profile as
    -- a "completed" badge. Limit ~5 per team enforced at the handler.
    CREATE TABLE IF NOT EXISTS player_goals (
      player_id TEXT NOT NULL,
      attr TEXT NOT NULL,
      target INTEGER NOT NULL,
      set_at INTEGER NOT NULL,
      reached_at INTEGER,
      PRIMARY KEY (player_id, attr),
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_goals_player ON player_goals(player_id);

    -- Persistent chat messages. Trimmed via post-insert delete to keep the
    -- table tiny — no per-channel auth, treat as semi-public.
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'global',
      author_nick TEXT NOT NULL,
      team_tag TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel, id DESC);

    -- Tournaments: lobby + bracket state. Bracket is JSON because it's
    -- only ever read in full and the size is small (4/8 team brackets).
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      entry_fee INTEGER NOT NULL,
      prize_pool INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      bracket_json TEXT NOT NULL DEFAULT '[]',
      prizes_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tournament_registrations (
      tournament_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      seed INTEGER NOT NULL,
      PRIMARY KEY (tournament_id, team_id),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    -- Generic key/value store for one-shot migration canaries, feature
    -- flags, and similar bookkeeping. Cheap, explicit, and self-documenting
    -- compared to overloading existing tables.
    CREATE TABLE IF NOT EXISTS meta_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Public Facebook-style comments on /team/:id pages. Anonymous —
    -- author_nick is whatever name the commenter typed into the form,
    -- escaped server-side on render. ip is used only for the
    -- per-IP rate limit and never displayed.
    CREATE TABLE IF NOT EXISTS team_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      author_nick TEXT NOT NULL,
      text TEXT NOT NULL,
      posted_at INTEGER NOT NULL,
      ip TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_team_comments_team ON team_comments(team_id, posted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_team_comments_ip_time ON team_comments(ip, posted_at DESC);
  `);

  // ----- Lightweight schema migrations -----
  //
  // CREATE TABLE IF NOT EXISTS skips adding columns to a pre-existing table.
  // Add them defensively here; ignore "duplicate column" errors so reruns are
  // idempotent.
  const tryAddColumn = (table: string, col: string, type: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type} NOT NULL DEFAULT ${def}`); }
    catch { /* column already present */ }
  };
  tryAddColumn('teams', 'tactics_json', 'TEXT', "'{}'");
  tryAddColumn('teams', 'logo_data', 'TEXT', "''");
  // Pre-curated emoji logo chosen from LOGO_PACK. Empty = default 2-char
  // initials-on-color mark. Persisted via update-profile, surfaced in
  // OnlineSidebar + TeamProfileModal + TeamTag tooltip.
  tryAddColumn('teams', 'logo_id', 'TEXT', "''");
  tryAddColumn('teams', 'bio', 'TEXT', "''");
  tryAddColumn('teams', 'primary_color', 'TEXT', "'#de9b35'");
  tryAddColumn('teams', 'twitch_url', 'TEXT', "''");
  tryAddColumn('teams', 'twitter_url', 'TEXT', "''");
  tryAddColumn('teams', 'youtube_url', 'TEXT', "''");
  // ISO date (YYYY-MM-DD) of the team's last daily-login bonus claim.
  tryAddColumn('teams', 'last_daily_claim', 'TEXT', "''");
  // ISO date of the last free case claim — daily, mirrors the SP perk.
  tryAddColumn('teams', 'last_free_case', 'TEXT', "''");
  // Daily duel cap tracking. duels_date is the UTC date the counters
  // belong to; if it doesn't match today, the server treats both as 0.
  tryAddColumn('teams', 'duels_date', 'TEXT', "''");
  tryAddColumn('teams', 'duels_used', 'INTEGER', '0');
  tryAddColumn('teams', 'duels_extra', 'INTEGER', '0');
  // UTC ms of the last wall-clock auto-advance tick applied. 0 = never;
  // the first auto-tick call after migration uses 'now' as the anchor so
  // existing teams don't fast-forward retroactively.
  tryAddColumn('teams', 'last_auto_tick_at', 'INTEGER', '0');
  // In-game day of the most recent massage. 0 = never booked.
  tryAddColumn('teams', 'last_massage_day', 'INTEGER', '0');
  // Morale mini-game plays this in-game day (reset when day changes).
  tryAddColumn('teams', 'morale_game_day', 'INTEGER', '0');
  tryAddColumn('teams', 'morale_game_plays', 'INTEGER', '0');
  // Lifetime counters used to drive the harder achievement tiers — never
  // reset, monotonically increasing. Added defensively so the achievement
  // unlocks can compare against a real running total even after season
  // rollovers reset season_standings.
  tryAddColumn('teams', 'lifetime_cases_opened', 'INTEGER', '0');
  tryAddColumn('teams', 'lifetime_streams', 'INTEGER', '0');
  tryAddColumn('teams', 'lifetime_tournaments_won', 'INTEGER', '0');
  // Login streak — drives the daily-quest reward multiplier. Resets to
  // 1 when the gap between claim days is > 1 UTC day, increments
  // otherwise. last_streak_date is the YYYY-MM-DD of the most recent
  // streak tick (only changes on first quest claim of the day).
  tryAddColumn('teams', 'login_streak', 'INTEGER', '0');
  tryAddColumn('teams', 'last_streak_date', 'TEXT', "''");
  // All-done bonus paid out for which UTC date — claim-all-done-bonus is
  // gated to once per day per team.
  tryAddColumn('teams', 'all_done_bonus_date', 'TEXT', "''");
  // Per-team E-Wallet address (like a BTC-style handle). Populated at
  // create-team time; existing rows get one via boot-time backfill.
  // The UNIQUE partial index MUST be created AFTER the column exists
  // (on pre-migration DBs the CREATE TABLE IF NOT EXISTS above is a
  // no-op, so the column is only present once tryAddColumn has run).
  tryAddColumn('teams', 'wallet_id', 'TEXT', "''");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_wallet_id
           ON teams(wallet_id) WHERE wallet_id != '';`);
  // Real-estate vault interest tracking. UTC ms of the last-collected
  // interest tick per lot. 0 = never collected (accrual starts at
  // creation time — see helper). Cap of 30 days accrual enforced at
  // collection time to prevent forever-storing.
  tryAddColumn('lots', 'last_interest_at', 'INTEGER', '0');
  // Objective-based sponsors — replaces monthly auto-payouts.
  //   wins_required = 0 for legacy rows (backfill-marked declined on boot)
  //   activated_at = 0 = never activated
  tryAddColumn('sponsors', 'wins_required', 'INTEGER', '0');
  tryAddColumn('sponsors', 'wins_at_start', 'INTEGER', '0');
  tryAddColumn('sponsors', 'activated_at', 'INTEGER', '0');
  // Competitive MMR ladder. mmr seeds at the protocol's STARTING_MMR
  // value (1000 = Silver Elite Master). peak_mmr is the highest mmr the
  // team has ever held (trophy stat that survives any future reset).
  // placement_matches_played increments on every PvP duel and doubles
  // the K-factor while < PLACEMENT_MATCHES.
  tryAddColumn('teams', 'mmr', 'INTEGER', '1000');
  tryAddColumn('teams', 'peak_mmr', 'INTEGER', '1000');
  tryAddColumn('teams', 'placement_matches_played', 'INTEGER', '0');
  // Cash reward bookkeeping for achievements — set to 1 after the cash
  // payout has been credited so we don't double-pay on retry. Pre-
  // existing achievements row in upgrade systems default to 0; the
  // server back-pays them on first hello after deploy.
  tryAddColumn('achievements', 'reward_paid', 'INTEGER', '0');

  // Daily quests table — one row per (team, utcDate, quest). Generation
  // is deterministic (seeded by team+date) so rolling lazily on demand
  // gives every team a stable set per day.
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_quests (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      utc_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      target INTEGER NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      reward INTEGER NOT NULL,
      claimed_at INTEGER,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_daily_quest_team_date ON daily_quests(team_id, utc_date);

    -- AI vs AI betting cards. Each row carries the full synthetic match
    -- (teams + players + odds + scheduled time) in payload_json. Status
    -- ratchets open → closing → live → resolved. The cleanup pass deletes
    -- resolved cards past the replay-window.
    CREATE TABLE IF NOT EXISTS ai_match_cards (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      scheduled_start_at INTEGER NOT NULL,
      resolved_at INTEGER,
      match_history_id TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_card_status ON ai_match_cards(status, scheduled_start_at);

    -- Bets placed on the above cards. PK on (card_id, bettor_team_id)
    -- because each team can only have ONE active bet per card.
    CREATE TABLE IF NOT EXISTS ai_match_bets (
      card_id TEXT NOT NULL,
      bettor_team_id TEXT NOT NULL,
      side TEXT NOT NULL,
      stake INTEGER NOT NULL,
      odds_at_bet REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      placed_at INTEGER NOT NULL,
      settled_at INTEGER,
      payout INTEGER,
      PRIMARY KEY (card_id, bettor_team_id),
      FOREIGN KEY (card_id) REFERENCES ai_match_cards(id) ON DELETE CASCADE,
      FOREIGN KEY (bettor_team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_bet_team ON ai_match_bets(bettor_team_id);

    -- Permanent settlement log for AI bets. Snapshot of the resolved
    -- matchup + bet outcome — survives the card-cleanup pass (which
    -- cascades the original ai_match_bets row out of existence after the
    -- 10-min replay window). Trimmed to the most recent 100 entries per
    -- team on each insert.
    CREATE TABLE IF NOT EXISTS ai_bet_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bettor_team_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      team_a_tag TEXT NOT NULL,
      team_b_tag TEXT NOT NULL,
      team_a_logo TEXT NOT NULL,
      team_b_logo TEXT NOT NULL,
      team_a_color TEXT NOT NULL,
      team_b_color TEXT NOT NULL,
      side TEXT NOT NULL,
      stake INTEGER NOT NULL,
      odds_at_bet REAL NOT NULL,
      status TEXT NOT NULL,
      payout INTEGER NOT NULL DEFAULT 0,
      winner_side TEXT NOT NULL,
      maps_a INTEGER NOT NULL,
      maps_b INTEGER NOT NULL,
      settled_at INTEGER NOT NULL,
      FOREIGN KEY (bettor_team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_bet_hist_team ON ai_bet_history(bettor_team_id, settled_at DESC);

    -- ===== Virtual real estate =====
    --
    -- 1000×1000 sparse grid. Only owned + actively-auctioned cells get
    -- rows; everything else is implicitly empty. (x,y) is the natural
    -- primary key for collision detection.

    CREATE TABLE IF NOT EXISTS lots (
      id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      owner_team_id TEXT NOT NULL,
      apartment_tier TEXT NOT NULL DEFAULT 'studio',
      vault_balance INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      won_auction_id TEXT,
      last_interest_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (owner_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      UNIQUE (x, y)
    );
    CREATE INDEX IF NOT EXISTS idx_lots_owner ON lots(owner_team_id);

    -- Active + closed lot auctions. Status: open | closed | void.
    CREATE TABLE IF NOT EXISTS lot_auctions (
      id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      current_bid INTEGER NOT NULL DEFAULT 0,
      current_bidder_team_id TEXT,
      winner_team_id TEXT,
      FOREIGN KEY (current_bidder_team_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (winner_team_id) REFERENCES teams(id) ON DELETE SET NULL
    );
    -- Prevent two parallel auctions on the same coord. Composite unique
    -- partial index: only enforce against open auctions.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lot_auction_open_coord
      ON lot_auctions(x, y) WHERE status = 'open';
    CREATE INDEX IF NOT EXISTS idx_lot_auction_ends ON lot_auctions(status, ends_at);

    -- Bid log per auction. Each bid escrows money on the bidder (money
    -- deducted at bid time, refunded on outbid / void close).
    CREATE TABLE IF NOT EXISTS lot_bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id TEXT NOT NULL,
      bidder_team_id TEXT NOT NULL,
      bidder_tag TEXT NOT NULL,
      amount INTEGER NOT NULL,
      placed_at INTEGER NOT NULL,
      refunded INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (auction_id) REFERENCES lot_auctions(id) ON DELETE CASCADE,
      FOREIGN KEY (bidder_team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lot_bids_auction ON lot_bids(auction_id, placed_at DESC);

    CREATE TABLE IF NOT EXISTS lot_cars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id TEXT NOT NULL,
      car_id TEXT NOT NULL,
      bought_at INTEGER NOT NULL,
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lot_cars_lot ON lot_cars(lot_id);

    CREATE TABLE IF NOT EXISTS lot_luxuries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      bought_at INTEGER NOT NULL,
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lot_luxuries_lot ON lot_luxuries(lot_id);

    CREATE TABLE IF NOT EXISTS lot_residents (
      lot_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      moved_in_at INTEGER NOT NULL,
      PRIMARY KEY (lot_id, player_id),
      FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lot_residents_player ON lot_residents(player_id);
  `);
  // Skin inventory rows owned by this team — JSON-blob per skin instance.
  db.exec(`
    CREATE TABLE IF NOT EXISTS skin_inventory (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      json TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_skin_team ON skin_inventory(team_id);

    -- Per-skinId mint counter. Each row tracks how many copies of a given
    -- skin have ever been minted server-wide; allocateSerial bumps + returns
    -- the next number. Drives the "Howl #0042" NFT-style provenance label.
    CREATE TABLE IF NOT EXISTS skin_serial_counters (
      skin_id TEXT PRIMARY KEY,
      minted INTEGER NOT NULL DEFAULT 0
    );

    -- Peer-to-peer skin listings. The skin row itself stays in
    -- skin_inventory under the seller until a buyer claims it; the listing
    -- is just metadata + asking price. ON DELETE CASCADE so deleting a
    -- team (or a skin) auto-clears any orphaned listings.
    CREATE TABLE IF NOT EXISTS skin_market_listings (
      id TEXT PRIMARY KEY,
      skin_instance_id TEXT NOT NULL UNIQUE,
      seller_team_id TEXT NOT NULL,
      asking_price INTEGER NOT NULL,
      listed_at INTEGER NOT NULL,
      FOREIGN KEY (seller_team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (skin_instance_id) REFERENCES skin_inventory(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_skin_listing_seller ON skin_market_listings(seller_team_id);
  `);
  // Booster cards. Unapplied cards sit here; applied boosts live on the
  // owning player's JSON (player.activeBoost field) so they travel with
  // the player through transfers/loans without needing a join.
  db.exec(`
    CREATE TABLE IF NOT EXISTS boost_inventory (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      rarity TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      json TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_boost_team ON boost_inventory(team_id);
  `);

  // -------- Owner / auth --------

  const insertOwner = db.prepare(
    `INSERT INTO owners (nickname, pin_hash, pin_salt, team_id, created_at) VALUES (?, ?, ?, NULL, ?)`,
  );
  const findOwner = db.prepare(`SELECT * FROM owners WHERE nickname = ? COLLATE NOCASE`);
  const setOwnerTeam = db.prepare(`UPDATE owners SET team_id = ? WHERE nickname = ? COLLATE NOCASE`);

  function hashPin(pin: string, salt: string): string {
    return createHash('sha256').update(`${salt}:${pin}`).digest('hex');
  }

  function authenticateOrRegister(nickname: string, pin: string): { ok: boolean; teamId: string | null } {
    const existing = findOwner.get(nickname) as
      | { nickname: string; pin_hash: string; pin_salt: string; team_id: string | null }
      | undefined;
    if (existing) {
      const ok = hashPin(pin, existing.pin_salt) === existing.pin_hash;
      return { ok, teamId: ok ? existing.team_id : null };
    }
    // First time this nickname has been seen — register on the spot.
    const salt = randomBytes(8).toString('hex');
    insertOwner.run(nickname, hashPin(pin, salt), salt, Date.now());
    return { ok: true, teamId: null };
  }

  // -------- Admin (gated upstream by handlers) --------

  const listAllOwnersStmt = db.prepare(`
    SELECT o.nickname, o.team_id, o.created_at,
           t.tag AS team_tag, t.name AS team_name, t.region, t.money, t.player_ids
      FROM owners o
      LEFT JOIN teams t ON t.id = o.team_id
      ORDER BY o.created_at ASC
  `);
  interface OwnerJoinRow {
    nickname: string;
    team_id: string | null;
    created_at: number;
    team_tag: string | null;
    team_name: string | null;
    region: string | null;
    money: number | null;
    player_ids: string | null;
  }
  function listAllOwners(): OwnerJoinRow[] {
    return listAllOwnersStmt.all() as OwnerJoinRow[];
  }
  const updateOwnerPinStmt = db.prepare(
    `UPDATE owners SET pin_hash = ?, pin_salt = ? WHERE nickname = ? COLLATE NOCASE`,
  );
  function resetOwnerPin(nickname: string, newPin: string): boolean {
    const salt = randomBytes(8).toString('hex');
    const r = updateOwnerPinStmt.run(hashPin(newPin, salt), salt, nickname);
    return r.changes > 0;
  }
  // For force-delete: cascade the team's players, listings, challenges,
  // history, achievements, loans, sponsors, presets, and the owners pointer.
  const deleteTeamRow = db.prepare(`DELETE FROM teams WHERE id = ?`);
  const deleteTeamPlayers = db.prepare(`DELETE FROM players WHERE team_id = ?`);
  const clearOwnerTeam = db.prepare(`UPDATE owners SET team_id = NULL WHERE team_id = ?`);
  const deleteTeamListings = db.prepare(`DELETE FROM market_listings WHERE seller_team_id = ?`);
  // Challenges only track the challenger; accepted ones are removed and
  // promoted to match_history immediately. So no accepter column exists.
  const deleteTeamChallenges = db.prepare(
    `DELETE FROM challenges WHERE challenger_team_id = ?`,
  );
  const deleteTeamMatches = db.prepare(
    `DELETE FROM match_history WHERE team_a_id = ? OR team_b_id = ?`,
  );
  const deleteTeamAchievements = db.prepare(`DELETE FROM achievements WHERE team_id = ?`);
  function deleteTeamCascade(teamId: string): void {
    db.transaction(() => {
      deleteTeamListings.run(teamId);
      deleteTeamChallenges.run(teamId);
      deleteTeamMatches.run(teamId, teamId);
      deleteTeamAchievements.run(teamId);
      deleteTeamSkins.run(teamId);
      deleteTeamBoosts.run(teamId);
      deleteTeamPlayers.run(teamId);
      clearOwnerTeam.run(teamId);
      deleteTeamRow.run(teamId);
    })();
  }

  // -------- Teams --------

  const insertTeam = db.prepare(
    `INSERT INTO teams (id, name, tag, region, owner_nick, money, day, created_at, player_ids, tactics_json, wallet_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getTeam = db.prepare(`SELECT * FROM teams WHERE id = ?`);
  const getTeamByTag = db.prepare(`SELECT * FROM teams WHERE tag = ? COLLATE NOCASE LIMIT 1`);
  const getTeamByWalletId = db.prepare(`SELECT * FROM teams WHERE wallet_id = ? COLLATE NOCASE LIMIT 1`);
  const setTeamWalletId = db.prepare(`UPDATE teams SET wallet_id = ? WHERE id = ?`);
  const listTeamsMissingWallet = db.prepare(`SELECT id FROM teams WHERE wallet_id = ''`);
  const updateTeamPlayers = db.prepare(`UPDATE teams SET player_ids = ? WHERE id = ?`);
  const updateTeamMoneyDay = db.prepare(`UPDATE teams SET money = ?, day = ? WHERE id = ?`);
  const updateTeamTactics = db.prepare(`UPDATE teams SET tactics_json = ? WHERE id = ?`);
  const updatePlayerJson = db.prepare(`UPDATE players SET json = ?, team_id = ? WHERE id = ?`);
  // Admin-only: targeted field edits on the teams row.
  const updateTeamName = db.prepare(`UPDATE teams SET name = ? WHERE id = ?`);
  const updateTeamTag = db.prepare(`UPDATE teams SET tag = ? WHERE id = ?`);
  const updateTeamRegion = db.prepare(`UPDATE teams SET region = ? WHERE id = ?`);
  const updateTeamMoney = db.prepare(`UPDATE teams SET money = ? WHERE id = ?`);
  function adminEditTeamField(teamId: string, field: 'name' | 'tag' | 'region', value: string): boolean {
    const stmt =
      field === 'name' ? updateTeamName : field === 'tag' ? updateTeamTag : updateTeamRegion;
    return stmt.run(value, teamId).changes > 0;
  }
  function adminSetTeamMoney(teamId: string, money: number): boolean {
    return updateTeamMoney.run(money, teamId).changes > 0;
  }

  // -------- Daily login bonus + free case --------

  const getLastDailyClaim = db.prepare(`SELECT last_daily_claim FROM teams WHERE id = ?`);
  const setLastDailyClaim = db.prepare(`UPDATE teams SET last_daily_claim = ? WHERE id = ?`);
  function getDailyClaimDate(teamId: string): string {
    const r = getLastDailyClaim.get(teamId) as { last_daily_claim: string | null } | undefined;
    return r?.last_daily_claim ?? '';
  }
  function markDailyClaim(teamId: string, isoDate: string): void {
    setLastDailyClaim.run(isoDate, teamId);
  }

  const getLastFreeCase = db.prepare(`SELECT last_free_case FROM teams WHERE id = ?`);
  const setLastFreeCase = db.prepare(`UPDATE teams SET last_free_case = ? WHERE id = ?`);
  function getFreeCaseDate(teamId: string): string {
    const r = getLastFreeCase.get(teamId) as { last_free_case: string | null } | undefined;
    return r?.last_free_case ?? '';
  }
  function markFreeCaseClaim(teamId: string, isoDate: string): void {
    setLastFreeCase.run(isoDate, teamId);
  }

  // -------- Daily duel cap --------

  // Note: the persisted columns are duels_date / duels_used / duels_extra.
  // We now use them as: duels_date = "day-{team.day}" (in-game day key),
  // duels_used = duels played this in-game day, duels_extra = REFILLS used
  // (capped at MAX_REFILLS_PER_DAY). Keeping the column names avoids a
  // destructive migration on existing databases.
  const getDuelCounters = db.prepare(
    `SELECT duels_date, duels_used, duels_extra FROM teams WHERE id = ?`,
  );
  const setDuelCounters = db.prepare(
    `UPDATE teams SET duels_date = ?, duels_used = ?, duels_extra = ? WHERE id = ?`,
  );
  /** Read the team's duel counters, auto-resetting them if the stored day
   *  key is not the current in-game day. Always returns today's values. */
  function getDuelStats(teamId: string, todayKey: string): { used: number; refillsUsed: number } {
    const r = getDuelCounters.get(teamId) as
      | { duels_date: string | null; duels_used: number | null; duels_extra: number | null }
      | undefined;
    if (!r) return { used: 0, refillsUsed: 0 };
    if ((r.duels_date ?? '') !== todayKey) return { used: 0, refillsUsed: 0 };
    return { used: r.duels_used ?? 0, refillsUsed: r.duels_extra ?? 0 };
  }
  function recordDuelUsed(teamId: string, todayKey: string): { used: number; refillsUsed: number } {
    const cur = getDuelStats(teamId, todayKey);
    const next = { used: cur.used + 1, refillsUsed: cur.refillsUsed };
    setDuelCounters.run(todayKey, next.used, next.refillsUsed, teamId);
    return next;
  }
  /** Pay-to-refill: reset duels_used to 0, increment refills counter.
   *  Caller validates the per-day refill cap + charges money. */
  function recordDuelRefill(teamId: string, todayKey: string): { used: number; refillsUsed: number } {
    const cur = getDuelStats(teamId, todayKey);
    const next = { used: 0, refillsUsed: cur.refillsUsed + 1 };
    setDuelCounters.run(todayKey, next.used, next.refillsUsed, teamId);
    return next;
  }

  // -------- Lifetime achievement counters --------

  const bumpLifetimeCases = db.prepare(`UPDATE teams SET lifetime_cases_opened = COALESCE(lifetime_cases_opened, 0) + 1 WHERE id = ?`);
  const getLifetimeCases = db.prepare(`SELECT lifetime_cases_opened FROM teams WHERE id = ?`);
  const bumpLifetimeStreams = db.prepare(`UPDATE teams SET lifetime_streams = COALESCE(lifetime_streams, 0) + 1 WHERE id = ?`);
  const getLifetimeStreams = db.prepare(`SELECT lifetime_streams FROM teams WHERE id = ?`);
  const bumpLifetimeTournamentsWon = db.prepare(`UPDATE teams SET lifetime_tournaments_won = COALESCE(lifetime_tournaments_won, 0) + 1 WHERE id = ?`);
  const getLifetimeTournamentsWon = db.prepare(`SELECT lifetime_tournaments_won FROM teams WHERE id = ?`);

  function recordCaseOpened(teamId: string): number {
    bumpLifetimeCases.run(teamId);
    const r = getLifetimeCases.get(teamId) as { lifetime_cases_opened: number | null } | undefined;
    return r?.lifetime_cases_opened ?? 0;
  }
  function recordStreamDone(teamId: string): number {
    bumpLifetimeStreams.run(teamId);
    const r = getLifetimeStreams.get(teamId) as { lifetime_streams: number | null } | undefined;
    return r?.lifetime_streams ?? 0;
  }
  // -------- MMR ladder --------

  const updateMmrRow = db.prepare(
    `UPDATE teams SET mmr = ?, peak_mmr = MAX(COALESCE(peak_mmr, 0), ?), placement_matches_played = COALESCE(placement_matches_played, 0) + 1 WHERE id = ?`,
  );
  /** Set a team's new MMR; bumps peak + placement-match counter. */
  function applyMmrChange(teamId: string, newMmr: number): void {
    updateMmrRow.run(newMmr, newMmr, teamId);
  }

  const rankedLeaderboardStmt = db.prepare(
    `SELECT id, tag, name, region, mmr, peak_mmr, placement_matches_played
     FROM teams
     WHERE mmr IS NOT NULL
     ORDER BY mmr DESC, peak_mmr DESC
     LIMIT 100`,
  );
  function loadMmrLeaderboard(): Array<{
    teamId: string; teamTag: string; teamName: string; region: string;
    mmr: number; peakMmr: number; placementMatchesPlayed: number;
  }> {
    const rows = rankedLeaderboardStmt.all() as Array<{
      id: string; tag: string; name: string; region: string;
      mmr: number | null; peak_mmr: number | null; placement_matches_played: number | null;
    }>;
    return rows.map((r) => ({
      teamId: r.id, teamTag: r.tag, teamName: r.name, region: r.region,
      mmr: r.mmr ?? 1000, peakMmr: r.peak_mmr ?? 1000,
      placementMatchesPlayed: r.placement_matches_played ?? 0,
    }));
  }

  function recordTournamentWin(teamId: string): number {
    bumpLifetimeTournamentsWon.run(teamId);
    const r = getLifetimeTournamentsWon.get(teamId) as { lifetime_tournaments_won: number | null } | undefined;
    return r?.lifetime_tournaments_won ?? 0;
  }

  // -------- Daily quests + login streak --------

  const getLoginStreakRow = db.prepare(`SELECT login_streak, last_streak_date FROM teams WHERE id = ?`);
  const setLoginStreakRow = db.prepare(`UPDATE teams SET login_streak = ?, last_streak_date = ? WHERE id = ?`);
  function getLoginStreak(teamId: string): number {
    const r = getLoginStreakRow.get(teamId) as { login_streak: number | null; last_streak_date: string | null } | undefined;
    return r?.login_streak ?? 0;
  }
  function getLastStreakDate(teamId: string): string {
    const r = getLoginStreakRow.get(teamId) as { login_streak: number | null; last_streak_date: string | null } | undefined;
    return r?.last_streak_date ?? '';
  }
  function setLoginStreak(teamId: string, streak: number, utcDate: string): void {
    setLoginStreakRow.run(streak, utcDate, teamId);
  }

  const getAllDoneBonusRow = db.prepare(`SELECT all_done_bonus_date FROM teams WHERE id = ?`);
  const setAllDoneBonusRow = db.prepare(`UPDATE teams SET all_done_bonus_date = ? WHERE id = ?`);
  function getAllDoneBonusDate(teamId: string): string {
    const r = getAllDoneBonusRow.get(teamId) as { all_done_bonus_date: string | null } | undefined;
    return r?.all_done_bonus_date ?? '';
  }
  function markAllDoneBonusPaid(teamId: string, utcDate: string): void {
    setAllDoneBonusRow.run(utcDate, teamId);
  }

  const insertQuestStmt = db.prepare(
    `INSERT INTO daily_quests (id, team_id, utc_date, kind, label, difficulty, target, progress, reward)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const loadQuestsForDay = db.prepare(
    `SELECT id, kind, label, difficulty, target, progress, reward, claimed_at
     FROM daily_quests WHERE team_id = ? AND utc_date = ? ORDER BY
       CASE difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
  );
  const loadQuestById = db.prepare(`SELECT * FROM daily_quests WHERE id = ?`);
  const bumpQuestProgressStmt = db.prepare(
    // MIN guards against over-shoot when multiple actions fire in a burst.
    `UPDATE daily_quests SET progress = MIN(target, progress + ?)
     WHERE team_id = ? AND utc_date = ? AND kind = ? AND claimed_at IS NULL`,
  );
  const markQuestClaimed = db.prepare(`UPDATE daily_quests SET claimed_at = ? WHERE id = ?`);

  function insertDailyQuest(args: {
    id: string; teamId: string; utcDate: string; kind: string;
    label: string; difficulty: string; target: number; reward: number;
  }): void {
    insertQuestStmt.run(
      args.id, args.teamId, args.utcDate, args.kind,
      args.label, args.difficulty, args.target, args.reward,
    );
  }
  function loadDailyQuests(teamId: string, utcDate: string): import('../../src/online/protocol.ts').DailyQuest[] {
    const rows = loadQuestsForDay.all(teamId, utcDate) as Array<{
      id: string; kind: string; label: string; difficulty: string;
      target: number; progress: number; reward: number; claimed_at: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      difficulty: r.difficulty as 'easy' | 'medium' | 'hard',
      target: r.target,
      progress: r.progress,
      reward: r.reward,
      claimedAt: r.claimed_at,
    }));
  }
  function loadDailyQuest(id: string): { teamId: string; utcDate: string; target: number; progress: number; reward: number; claimedAt: number | null } | null {
    const r = loadQuestById.get(id) as {
      team_id: string; utc_date: string; target: number; progress: number; reward: number; claimed_at: number | null;
    } | undefined;
    if (!r) return null;
    return {
      teamId: r.team_id, utcDate: r.utc_date, target: r.target,
      progress: r.progress, reward: r.reward, claimedAt: r.claimed_at,
    };
  }
  function bumpDailyQuestProgress(teamId: string, utcDate: string, kind: string, amount: number): void {
    bumpQuestProgressStmt.run(amount, teamId, utcDate, kind);
  }
  function claimDailyQuest(id: string): void {
    markQuestClaimed.run(Date.now(), id);
  }

  // -------- AI vs AI betting market --------

  const insertAiCard = db.prepare(
    `INSERT INTO ai_match_cards (id, status, scheduled_start_at, payload_json) VALUES (?, ?, ?, ?)`,
  );
  const updateAiCardStatus = db.prepare(
    `UPDATE ai_match_cards SET status = ? WHERE id = ?`,
  );
  const updateAiCardResolved = db.prepare(
    `UPDATE ai_match_cards SET status = 'resolved', resolved_at = ?, match_history_id = ?, payload_json = ? WHERE id = ?`,
  );
  const deleteAiCard = db.prepare(`DELETE FROM ai_match_cards WHERE id = ?`);
  const loadAiCardById = db.prepare(`SELECT * FROM ai_match_cards WHERE id = ?`);
  const loadAiCardsActiveOrRecent = db.prepare(
    // 'open' / 'closing' / 'live' or recently resolved (within replay window)
    `SELECT * FROM ai_match_cards
     WHERE status IN ('open','closing','live') OR (status = 'resolved' AND resolved_at >= ?)
     ORDER BY scheduled_start_at ASC`,
  );
  const loadAiCardsToStart = db.prepare(
    `SELECT * FROM ai_match_cards WHERE status IN ('open','closing') AND scheduled_start_at <= ?`,
  );
  const loadAiCardsToCleanup = db.prepare(
    `SELECT id FROM ai_match_cards WHERE status = 'resolved' AND resolved_at < ?`,
  );
  const countAiOpenCards = db.prepare(
    `SELECT COUNT(*) AS n FROM ai_match_cards WHERE status IN ('open','closing')`,
  );

  interface AiCardRow {
    id: string;
    status: string;
    scheduled_start_at: number;
    resolved_at: number | null;
    match_history_id: string | null;
    payload_json: string;
  }
  function createAiCard(args: { id: string; status: string; scheduledStartAt: number; payloadJson: string }): void {
    insertAiCard.run(args.id, args.status, args.scheduledStartAt, args.payloadJson);
  }
  function setAiCardStatus(id: string, status: string): void { updateAiCardStatus.run(status, id); }
  function resolveAiCard(id: string, matchHistoryId: string, payloadJson: string): void {
    updateAiCardResolved.run(Date.now(), matchHistoryId, payloadJson, id);
  }
  function loadAiCard(id: string): AiCardRow | null {
    return (loadAiCardById.get(id) as AiCardRow | undefined) ?? null;
  }
  function loadVisibleAiCards(): AiCardRow[] {
    const cutoff = Date.now() - 0; // replay window check happens caller-side
    return loadAiCardsActiveOrRecent.all(cutoff - 0) as AiCardRow[];
  }
  /** Cards whose start time has passed but haven't yet been simulated. */
  function loadDueAiCards(now: number): AiCardRow[] {
    return loadAiCardsToStart.all(now) as AiCardRow[];
  }
  function loadStaleAiCardIds(before: number): string[] {
    const rows = loadAiCardsToCleanup.all(before) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
  function deleteAiCardById(id: string): void { deleteAiCard.run(id); }
  function countOpenAiCards(): number {
    const r = countAiOpenCards.get() as { n: number };
    return r.n;
  }

  // ----- AI bets -----

  const upsertAiBet = db.prepare(
    `INSERT INTO ai_match_bets (card_id, bettor_team_id, side, stake, odds_at_bet, status, placed_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(card_id, bettor_team_id) DO UPDATE SET
       side = excluded.side,
       stake = ai_match_bets.stake + excluded.stake,
       odds_at_bet = ((ai_match_bets.stake * ai_match_bets.odds_at_bet) + (excluded.stake * excluded.odds_at_bet)) / (ai_match_bets.stake + excluded.stake)`,
  );
  const loadAiBetByTeam = db.prepare(
    `SELECT * FROM ai_match_bets WHERE card_id = ? AND bettor_team_id = ?`,
  );
  const loadAiBetsForCard = db.prepare(
    `SELECT * FROM ai_match_bets WHERE card_id = ?`,
  );
  const settleAiBet = db.prepare(
    `UPDATE ai_match_bets SET status = ?, settled_at = ?, payout = ? WHERE card_id = ? AND bettor_team_id = ?`,
  );

  interface AiBetRow {
    card_id: string;
    bettor_team_id: string;
    side: 'A' | 'B';
    stake: number;
    odds_at_bet: number;
    status: 'pending' | 'won' | 'lost';
    placed_at: number;
    settled_at: number | null;
    payout: number | null;
  }
  function placeAiBet(args: {
    cardId: string; bettorTeamId: string; side: 'A' | 'B'; stake: number; oddsAtBet: number;
  }): void {
    upsertAiBet.run(args.cardId, args.bettorTeamId, args.side, args.stake, args.oddsAtBet, Date.now());
  }
  function loadAiBet(cardId: string, bettorTeamId: string): AiBetRow | null {
    return (loadAiBetByTeam.get(cardId, bettorTeamId) as AiBetRow | undefined) ?? null;
  }
  function loadAllAiBetsForCard(cardId: string): AiBetRow[] {
    return loadAiBetsForCard.all(cardId) as AiBetRow[];
  }
  function settleAiBetRow(cardId: string, bettorTeamId: string, status: 'won' | 'lost', payout: number): void {
    settleAiBet.run(status, Date.now(), payout, cardId, bettorTeamId);
  }

  // ----- AI bet history (permanent settlement log) -----

  const insertAiBetHistory = db.prepare(
    `INSERT INTO ai_bet_history
       (bettor_team_id, card_id, team_a_tag, team_b_tag, team_a_logo, team_b_logo, team_a_color, team_b_color,
        side, stake, odds_at_bet, status, payout, winner_side, maps_a, maps_b, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectAiBetHistory = db.prepare(
    `SELECT card_id, team_a_tag, team_b_tag, team_a_logo, team_b_logo, team_a_color, team_b_color,
            side, stake, odds_at_bet, status, payout, winner_side, maps_a, maps_b, settled_at
       FROM ai_bet_history
      WHERE bettor_team_id = ?
      ORDER BY settled_at DESC
      LIMIT ?`,
  );
  const trimAiBetHistory = db.prepare(
    `DELETE FROM ai_bet_history
      WHERE bettor_team_id = ?
        AND id NOT IN (
          SELECT id FROM ai_bet_history WHERE bettor_team_id = ? ORDER BY settled_at DESC LIMIT ?
        )`,
  );

  interface AiBetHistoryRow {
    card_id: string;
    team_a_tag: string; team_b_tag: string;
    team_a_logo: string; team_b_logo: string;
    team_a_color: string; team_b_color: string;
    side: 'A' | 'B';
    stake: number;
    odds_at_bet: number;
    status: 'won' | 'lost';
    payout: number;
    winner_side: 'A' | 'B';
    maps_a: number;
    maps_b: number;
    settled_at: number;
  }
  function recordAiBetHistory(args: {
    bettorTeamId: string;
    cardId: string;
    teamATag: string; teamBTag: string;
    teamALogo: string; teamBLogo: string;
    teamAColor: string; teamBColor: string;
    side: 'A' | 'B';
    stake: number;
    oddsAtBet: number;
    status: 'won' | 'lost';
    payout: number;
    winnerSide: 'A' | 'B';
    mapsA: number;
    mapsB: number;
  }): void {
    insertAiBetHistory.run(
      args.bettorTeamId, args.cardId,
      args.teamATag, args.teamBTag, args.teamALogo, args.teamBLogo, args.teamAColor, args.teamBColor,
      args.side, args.stake, args.oddsAtBet, args.status, args.payout,
      args.winnerSide, args.mapsA, args.mapsB, Date.now(),
    );
  }
  function loadAiBetHistory(teamId: string, limit = 10): AiBetHistoryRow[] {
    return selectAiBetHistory.all(teamId, limit) as AiBetHistoryRow[];
  }
  /** Cap history per team — generous (100) since we only display 10. */
  function trimAiBetHistoryForTeam(teamId: string, keep: number): void {
    trimAiBetHistory.run(teamId, teamId, keep);
  }

  // -------- Virtual real estate --------

  interface LotRow {
    id: string;
    x: number;
    y: number;
    owner_team_id: string;
    apartment_tier: string;
    vault_balance: number;
    created_at: number;
    won_auction_id: string | null;
    last_interest_at: number;
  }
  interface LotAuctionRow {
    id: string;
    x: number;
    y: number;
    status: 'open' | 'closed' | 'void';
    started_at: number;
    ends_at: number;
    current_bid: number;
    current_bidder_team_id: string | null;
    winner_team_id: string | null;
  }
  interface LotBidRow {
    id: number;
    auction_id: string;
    bidder_team_id: string;
    bidder_tag: string;
    amount: number;
    placed_at: number;
    refunded: number;
  }
  interface LotCarRow { id: number; lot_id: string; car_id: string; bought_at: number }
  interface LotLuxuryRow { id: number; lot_id: string; item_id: string; bought_at: number }
  interface LotResidentRow { lot_id: string; player_id: string; moved_in_at: number }

  // ----- Lot CRUD -----
  const insertLot = db.prepare(
    `INSERT INTO lots (id, x, y, owner_team_id, apartment_tier, vault_balance, created_at, won_auction_id, last_interest_at)
     VALUES (?, ?, ?, ?, 'studio', 0, ?, ?, ?)`,
  );
  const findLotById = db.prepare(`SELECT * FROM lots WHERE id = ?`);
  const findLotByCoord = db.prepare(`SELECT * FROM lots WHERE x = ? AND y = ?`);
  const lotsInBox = db.prepare(`SELECT * FROM lots WHERE x >= ? AND x <= ? AND y >= ? AND y <= ?`);
  const lotsForOwner = db.prepare(`SELECT * FROM lots WHERE owner_team_id = ?`);
  const updateLotTierStmt = db.prepare(`UPDATE lots SET apartment_tier = ? WHERE id = ?`);
  const updateLotVaultStmt = db.prepare(`UPDATE lots SET vault_balance = ? WHERE id = ?`);
  const updateLotInterestAtStmt = db.prepare(`UPDATE lots SET last_interest_at = ? WHERE id = ?`);
  const allLotsStmt = db.prepare(`SELECT * FROM lots`);

  function createLot(args: { id: string; x: number; y: number; ownerTeamId: string; wonAuctionId: string | null }): void {
    // Interest clock starts at creation so a fresh lot doesn't insta-owe
    // 30 days of back-interest the first time the owner clicks Collect.
    insertLot.run(args.id, args.x, args.y, args.ownerTeamId, Date.now(), args.wonAuctionId, Date.now());
  }
  function loadLot(id: string): LotRow | null { return (findLotById.get(id) as LotRow | undefined) ?? null; }
  function loadLotByCoord(x: number, y: number): LotRow | null { return (findLotByCoord.get(x, y) as LotRow | undefined) ?? null; }
  function loadLotsInBox(x0: number, y0: number, x1: number, y1: number): LotRow[] {
    return lotsInBox.all(x0, x1, y0, y1) as LotRow[];
  }
  function loadLotsForOwner(teamId: string): LotRow[] { return lotsForOwner.all(teamId) as LotRow[]; }
  function loadAllLots(): LotRow[] { return allLotsStmt.all() as LotRow[]; }
  function setLotApartmentTier(lotId: string, tier: string): void { updateLotTierStmt.run(tier, lotId); }
  function setLotVault(lotId: string, balance: number): void { updateLotVaultStmt.run(balance, lotId); }
  function setLotInterestAt(lotId: string, atMs: number): void { updateLotInterestAtStmt.run(atMs, lotId); }

  // ----- Lot auctions -----
  const insertLotAuction = db.prepare(
    `INSERT INTO lot_auctions (id, x, y, status, started_at, ends_at, current_bid, current_bidder_team_id)
     VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`,
  );
  const findAuction = db.prepare(`SELECT * FROM lot_auctions WHERE id = ?`);
  const findOpenAuctionAtCoord = db.prepare(`SELECT * FROM lot_auctions WHERE x = ? AND y = ? AND status = 'open'`);
  const allOpenAuctions = db.prepare(`SELECT * FROM lot_auctions WHERE status = 'open' ORDER BY ends_at ASC`);
  const dueAuctions = db.prepare(`SELECT * FROM lot_auctions WHERE status = 'open' AND ends_at <= ?`);
  const updateAuctionBid = db.prepare(`UPDATE lot_auctions SET current_bid = ?, current_bidder_team_id = ?, ends_at = ? WHERE id = ?`);
  const closeAuctionStmt = db.prepare(`UPDATE lot_auctions SET status = 'closed', winner_team_id = ? WHERE id = ?`);
  const voidAuctionStmt = db.prepare(`UPDATE lot_auctions SET status = 'void' WHERE id = ?`);

  function createLotAuction(args: { id: string; x: number; y: number; startedAt: number; endsAt: number; openingBid: number; bidderTeamId: string }): void {
    insertLotAuction.run(args.id, args.x, args.y, args.startedAt, args.endsAt, args.openingBid, args.bidderTeamId);
  }
  function loadAuction(id: string): LotAuctionRow | null { return (findAuction.get(id) as LotAuctionRow | undefined) ?? null; }
  function loadOpenAuctionAtCoord(x: number, y: number): LotAuctionRow | null {
    return (findOpenAuctionAtCoord.get(x, y) as LotAuctionRow | undefined) ?? null;
  }
  function loadAllOpenAuctions(): LotAuctionRow[] { return allOpenAuctions.all() as LotAuctionRow[]; }
  function loadDueLotAuctions(now: number): LotAuctionRow[] { return dueAuctions.all(now) as LotAuctionRow[]; }
  function updateLotAuctionBid(id: string, bid: number, bidderTeamId: string, newEndsAt: number): void {
    updateAuctionBid.run(bid, bidderTeamId, newEndsAt, id);
  }
  function closeLotAuction(id: string, winnerTeamId: string): void { closeAuctionStmt.run(winnerTeamId, id); }
  function voidLotAuction(id: string): void { voidAuctionStmt.run(id); }

  // ----- Lot bids -----
  const insertLotBid = db.prepare(
    `INSERT INTO lot_bids (auction_id, bidder_team_id, bidder_tag, amount, placed_at, refunded) VALUES (?, ?, ?, ?, ?, 0)`,
  );
  const bidsForAuction = db.prepare(`SELECT * FROM lot_bids WHERE auction_id = ? ORDER BY placed_at DESC LIMIT 20`);
  const unrefundedBidsForBidder = db.prepare(
    `SELECT * FROM lot_bids WHERE auction_id = ? AND bidder_team_id = ? AND refunded = 0`,
  );
  const markBidRefunded = db.prepare(`UPDATE lot_bids SET refunded = 1 WHERE id = ?`);

  function recordLotBid(args: { auctionId: string; bidderTeamId: string; bidderTag: string; amount: number }): number {
    const r = insertLotBid.run(args.auctionId, args.bidderTeamId, args.bidderTag, args.amount, Date.now());
    return r.lastInsertRowid as number;
  }
  function loadLotBids(auctionId: string): LotBidRow[] { return bidsForAuction.all(auctionId) as LotBidRow[]; }
  function loadUnrefundedBidsForBidder(auctionId: string, bidderTeamId: string): LotBidRow[] {
    return unrefundedBidsForBidder.all(auctionId, bidderTeamId) as LotBidRow[];
  }
  function markLotBidRefunded(bidId: number): void { markBidRefunded.run(bidId); }

  // ----- Lot cars -----
  const insertLotCar = db.prepare(`INSERT INTO lot_cars (lot_id, car_id, bought_at) VALUES (?, ?, ?)`);
  const carsForLotStmt = db.prepare(`SELECT * FROM lot_cars WHERE lot_id = ? ORDER BY id ASC`);
  const findLotCar = db.prepare(`SELECT * FROM lot_cars WHERE id = ? AND lot_id = ?`);
  const deleteLotCar = db.prepare(`DELETE FROM lot_cars WHERE id = ?`);
  const countLotCars = db.prepare(`SELECT COUNT(*) AS n FROM lot_cars WHERE lot_id = ?`);

  function addLotCar(lotId: string, carId: string): number {
    return insertLotCar.run(lotId, carId, Date.now()).lastInsertRowid as number;
  }
  function loadLotCars(lotId: string): LotCarRow[] { return carsForLotStmt.all(lotId) as LotCarRow[]; }
  function loadLotCar(lotId: string, lotCarId: number): LotCarRow | null {
    return (findLotCar.get(lotCarId, lotId) as LotCarRow | undefined) ?? null;
  }
  function removeLotCar(lotCarId: number): void { deleteLotCar.run(lotCarId); }
  function countLotCarsFor(lotId: string): number { return (countLotCars.get(lotId) as { n: number }).n; }

  // ----- Lot luxuries -----
  const insertLotLuxury = db.prepare(`INSERT INTO lot_luxuries (lot_id, item_id, bought_at) VALUES (?, ?, ?)`);
  const luxuriesForLotStmt = db.prepare(`SELECT * FROM lot_luxuries WHERE lot_id = ? ORDER BY id ASC`);
  const findLotLuxury = db.prepare(`SELECT * FROM lot_luxuries WHERE id = ? AND lot_id = ?`);
  const deleteLotLuxury = db.prepare(`DELETE FROM lot_luxuries WHERE id = ?`);
  const countLotLuxuries = db.prepare(`SELECT COUNT(*) AS n FROM lot_luxuries WHERE lot_id = ?`);

  function addLotLuxury(lotId: string, itemId: string): number {
    return insertLotLuxury.run(lotId, itemId, Date.now()).lastInsertRowid as number;
  }
  function loadLotLuxuries(lotId: string): LotLuxuryRow[] { return luxuriesForLotStmt.all(lotId) as LotLuxuryRow[]; }
  function loadLotLuxury(lotId: string, lotLuxuryId: number): LotLuxuryRow | null {
    return (findLotLuxury.get(lotLuxuryId, lotId) as LotLuxuryRow | undefined) ?? null;
  }
  function removeLotLuxury(lotLuxuryId: number): void { deleteLotLuxury.run(lotLuxuryId); }
  function countLotLuxuriesFor(lotId: string): number { return (countLotLuxuries.get(lotId) as { n: number }).n; }

  // ----- Lot residents -----
  const insertResident = db.prepare(`INSERT INTO lot_residents (lot_id, player_id, moved_in_at) VALUES (?, ?, ?)`);
  const residentsForLotStmt = db.prepare(`SELECT * FROM lot_residents WHERE lot_id = ? ORDER BY moved_in_at ASC`);
  const deleteResident = db.prepare(`DELETE FROM lot_residents WHERE lot_id = ? AND player_id = ?`);
  const countLotResidents = db.prepare(`SELECT COUNT(*) AS n FROM lot_residents WHERE lot_id = ?`);
  const isPlayerAResident = db.prepare(`SELECT lot_id FROM lot_residents WHERE player_id = ?`);

  function addLotResident(lotId: string, playerId: string): void { insertResident.run(lotId, playerId, Date.now()); }
  function loadLotResidents(lotId: string): LotResidentRow[] { return residentsForLotStmt.all(lotId) as LotResidentRow[]; }
  function removeLotResident(lotId: string, playerId: string): void { deleteResident.run(lotId, playerId); }
  function countLotResidentsFor(lotId: string): number { return (countLotResidents.get(lotId) as { n: number }).n; }
  function residencyOf(playerId: string): string | null {
    const r = isPlayerAResident.get(playerId) as { lot_id: string } | undefined;
    return r ? r.lot_id : null;
  }

  // -------- Wall-clock auto-advance --------

  const getLastAutoTick = db.prepare(`SELECT last_auto_tick_at FROM teams WHERE id = ?`);
  const setLastAutoTick = db.prepare(`UPDATE teams SET last_auto_tick_at = ? WHERE id = ?`);
  function getAutoTickAnchor(teamId: string): number {
    const r = getLastAutoTick.get(teamId) as { last_auto_tick_at: number | null } | undefined;
    return r?.last_auto_tick_at ?? 0;
  }
  function setAutoTickAnchor(teamId: string, atMs: number): void {
    setLastAutoTick.run(atMs, teamId);
  }

  // -------- Massage center --------

  const getLastMassageDayStmt = db.prepare(`SELECT last_massage_day FROM teams WHERE id = ?`);
  const setLastMassageDayStmt = db.prepare(`UPDATE teams SET last_massage_day = ? WHERE id = ?`);
  function getLastMassageDay(teamId: string): number {
    const r = getLastMassageDayStmt.get(teamId) as { last_massage_day: number | null } | undefined;
    return r?.last_massage_day ?? 0;
  }
  function setLastMassageDay(teamId: string, day: number): void {
    setLastMassageDayStmt.run(day, teamId);
  }

  // -------- Morale mini-game --------

  const getMoraleGameStmt = db.prepare(`SELECT morale_game_day, morale_game_plays FROM teams WHERE id = ?`);
  const setMoraleGameStmt = db.prepare(`UPDATE teams SET morale_game_day = ?, morale_game_plays = ? WHERE id = ?`);
  /** Returns plays USED this in-game day (auto-resets when day changes). */
  function getMoraleGamePlays(teamId: string, gameDay: number): number {
    const r = getMoraleGameStmt.get(teamId) as { morale_game_day: number | null; morale_game_plays: number | null } | undefined;
    if (!r) return 0;
    if ((r.morale_game_day ?? 0) !== gameDay) return 0;
    return r.morale_game_plays ?? 0;
  }
  function recordMoraleGamePlay(teamId: string, gameDay: number): number {
    const cur = getMoraleGamePlays(teamId, gameDay);
    const next = cur + 1;
    setMoraleGameStmt.run(gameDay, next, teamId);
    return next;
  }

  // -------- Skin inventory --------

  const insertSkin = db.prepare(`INSERT INTO skin_inventory (id, team_id, acquired_at, json) VALUES (?, ?, ?, ?)`);
  const deleteSkin = db.prepare(`DELETE FROM skin_inventory WHERE id = ? AND team_id = ?`);
  const loadSkinsForTeam = db.prepare(`SELECT json FROM skin_inventory WHERE team_id = ? ORDER BY acquired_at DESC LIMIT 500`);
  const loadSkinById = db.prepare(`SELECT json FROM skin_inventory WHERE id = ? AND team_id = ?`);
  const deleteTeamSkins = db.prepare(`DELETE FROM skin_inventory WHERE team_id = ?`);
  function addSkin(teamId: string, skinId: string, skinJson: string): void {
    insertSkin.run(skinId, teamId, Date.now(), skinJson);
  }
  function loadSkins(teamId: string): unknown[] {
    return (loadSkinsForTeam.all(teamId) as { json: string }[]).map((r) => JSON.parse(r.json));
  }
  function loadSkin(teamId: string, skinId: string): unknown | null {
    const r = loadSkinById.get(skinId, teamId) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : null;
  }
  function removeSkin(teamId: string, skinId: string): boolean {
    return deleteSkin.run(skinId, teamId).changes > 0;
  }

  // ----- Skin serial allocator -----
  //
  // Global mint counter — every case open / souvenir / trade-up gets a
  // unique sequential serial (#1, #2, #3, …) regardless of which skin
  // dropped. Implemented as a single row keyed by '__global__'. The
  // (per-skinId) variant was confusing because every fresh skin showed
  // #0001 on small servers — there were just no prior mints of THAT
  // exact skin yet. A monotonically growing global number reads as a
  // true "you're the Nth person ever to mint here" provenance label.
  //
  // The skinId param is kept on the signature so callers in caseOpening
  // (single-player + online) don't need to change, but it's ignored.

  const GLOBAL_SERIAL_KEY = '__global__';
  const getSerialCounter = db.prepare(`SELECT minted FROM skin_serial_counters WHERE skin_id = ?`);
  const upsertSerialCounter = db.prepare(
    `INSERT INTO skin_serial_counters (skin_id, minted) VALUES (?, 1)
     ON CONFLICT(skin_id) DO UPDATE SET minted = minted + 1`,
  );

  /** Atomically increment + return the next global serial. The skinId
   *  param is accepted for callsite compatibility but ignored. */
  function allocateSkinSerial(_skinId: string): number {
    upsertSerialCounter.run(GLOBAL_SERIAL_KEY);
    const row = getSerialCounter.get(GLOBAL_SERIAL_KEY) as { minted: number } | undefined;
    return row?.minted ?? 1;
  }

  // One-shot init: if the global counter row hasn't been seeded yet but
  // per-skinId counters already exist from the pre-global era, sum them
  // up so post-migration mints don't recycle low numbers. Idempotent —
  // runs at most once per database lifetime.
  {
    const globalRow = getSerialCounter.get(GLOBAL_SERIAL_KEY) as { minted: number } | undefined;
    if (!globalRow) {
      const sumRow = db.prepare(
        `SELECT COALESCE(SUM(minted), 0) AS total FROM skin_serial_counters WHERE skin_id != ?`,
      ).get(GLOBAL_SERIAL_KEY) as { total: number };
      if (sumRow.total > 0) {
        db.prepare(`INSERT INTO skin_serial_counters (skin_id, minted) VALUES (?, ?)`)
          .run(GLOBAL_SERIAL_KEY, sumRow.total);
      }
    }
  }

  // ----- Skin transfer (used by peer marketplace + future loan-like flows) -----

  const updateSkinJson = db.prepare(`UPDATE skin_inventory SET json = ? WHERE id = ?`);
  const moveSkinOwner = db.prepare(`UPDATE skin_inventory SET team_id = ?, acquired_at = ? WHERE id = ?`);

  /** Persist a JSON-blob update for an existing skin row (used to bump
   *  the ownership-history trail after a trade). Idempotent. */
  function updateSkin(skinInstanceId: string, json: string): void {
    updateSkinJson.run(json, skinInstanceId);
  }

  /** Transfer ownership of a skin row to a different team_id. Caller is
   *  responsible for the JSON history bump + any market_listings cleanup. */
  function transferSkin(skinInstanceId: string, newOwnerTeamId: string): void {
    moveSkinOwner.run(newOwnerTeamId, Date.now(), skinInstanceId);
  }

  // ----- Peer skin marketplace -----

  const insertSkinListing = db.prepare(
    `INSERT INTO skin_market_listings (id, skin_instance_id, seller_team_id, asking_price, listed_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const deleteSkinListing = db.prepare(`DELETE FROM skin_market_listings WHERE id = ?`);
  const deleteListingsForSkin = db.prepare(`DELETE FROM skin_market_listings WHERE skin_instance_id = ?`);
  const findSkinListing = db.prepare(
    `SELECT l.id, l.skin_instance_id, l.seller_team_id, l.asking_price, l.listed_at,
            t.tag AS seller_team_tag, s.json AS skin_json
     FROM skin_market_listings l
     INNER JOIN teams t ON t.id = l.seller_team_id
     INNER JOIN skin_inventory s ON s.id = l.skin_instance_id
     WHERE l.id = ?`,
  );
  const allOpenSkinListings = db.prepare(
    `SELECT l.id, l.skin_instance_id, l.seller_team_id, l.asking_price, l.listed_at,
            t.tag AS seller_team_tag, s.json AS skin_json
     FROM skin_market_listings l
     INNER JOIN teams t ON t.id = l.seller_team_id
     INNER JOIN skin_inventory s ON s.id = l.skin_instance_id
     ORDER BY l.listed_at DESC
     LIMIT 200`,
  );
  const findListingBySkinId = db.prepare(
    `SELECT id FROM skin_market_listings WHERE skin_instance_id = ?`,
  );

  interface SkinListingRow {
    id: string;
    skin_instance_id: string;
    seller_team_id: string;
    seller_team_tag: string;
    asking_price: number;
    listed_at: number;
    skin_json: string;
  }

  function createSkinListing(args: {
    id: string;
    skinInstanceId: string;
    sellerTeamId: string;
    askingPrice: number;
  }): void {
    insertSkinListing.run(args.id, args.skinInstanceId, args.sellerTeamId, args.askingPrice, Date.now());
  }
  function loadSkinListing(listingId: string): SkinListingRow | null {
    return (findSkinListing.get(listingId) as SkinListingRow | undefined) ?? null;
  }
  function loadAllSkinListings(): SkinListingRow[] {
    return allOpenSkinListings.all() as SkinListingRow[];
  }
  function removeSkinListing(listingId: string): void {
    deleteSkinListing.run(listingId);
  }
  function removeListingForSkin(skinInstanceId: string): void {
    deleteListingsForSkin.run(skinInstanceId);
  }
  function hasOpenListingForSkin(skinInstanceId: string): boolean {
    return !!findListingBySkinId.get(skinInstanceId);
  }

  // -------- Booster cards --------

  const insertBoost = db.prepare(`INSERT INTO boost_inventory (id, team_id, rarity, acquired_at, json) VALUES (?, ?, ?, ?, ?)`);
  const loadBoostsForTeam = db.prepare(`SELECT json FROM boost_inventory WHERE team_id = ? ORDER BY acquired_at DESC`);
  const loadBoostById = db.prepare(`SELECT json FROM boost_inventory WHERE id = ? AND team_id = ?`);
  const deleteBoost = db.prepare(`DELETE FROM boost_inventory WHERE id = ? AND team_id = ?`);
  const deleteTeamBoosts = db.prepare(`DELETE FROM boost_inventory WHERE team_id = ?`);
  function addBoost(teamId: string, cardId: string, rarity: string, cardJson: string): void {
    insertBoost.run(cardId, teamId, rarity, Date.now(), cardJson);
  }
  function loadBoosts(teamId: string): unknown[] {
    return (loadBoostsForTeam.all(teamId) as { json: string }[]).map((r) => JSON.parse(r.json));
  }
  function loadBoost(teamId: string, cardId: string): unknown | null {
    const r = loadBoostById.get(cardId, teamId) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : null;
  }
  function removeBoost(teamId: string, cardId: string): boolean {
    return deleteBoost.run(cardId, teamId).changes > 0;
  }

  function rowToTeam(row: Record<string, unknown>): TeamRow {
    let tactics: Partial<Tactics> = {};
    try {
      const raw = row.tactics_json as string | undefined;
      if (raw) tactics = JSON.parse(raw);
    } catch { /* malformed JSON → default empty */ }
    return {
      id: row.id as string,
      name: row.name as string,
      tag: row.tag as string,
      region: row.region as Region,
      ownerNick: row.owner_nick as string,
      money: row.money as number,
      day: row.day as number,
      createdAt: row.created_at as number,
      playerIds: JSON.parse(row.player_ids as string),
      tactics,
      bio: (row.bio as string | null) ?? '',
      primaryColor: (row.primary_color as string | null) ?? '#de9b35',
      twitchUrl: (row.twitch_url as string | null) ?? '',
      twitterUrl: (row.twitter_url as string | null) ?? '',
      youtubeUrl: (row.youtube_url as string | null) ?? '',
      logoId: (row.logo_id as string | null) ?? '',
      mmr: (row.mmr as number | null) ?? 1000,
      peakMmr: (row.peak_mmr as number | null) ?? 1000,
      placementMatchesPlayed: (row.placement_matches_played as number | null) ?? 0,
      walletId: (row.wallet_id as string | null) ?? '',
    };
  }

  function createTeam(team: TeamRow): void {
    // Allocate a wallet id if the caller didn't provide one; retry on
    // the (extremely rare) UNIQUE collision. Give up after 8 tries to
    // avoid unbounded loops on a corrupted RNG.
    let wid = team.walletId?.trim() || generateWalletId();
    let attempt = 0;
    while (attempt < 8) {
      try {
        insertTeam.run(
          team.id,
          team.name,
          team.tag,
          team.region,
          team.ownerNick,
          team.money,
          team.day,
          team.createdAt,
          JSON.stringify(team.playerIds),
          JSON.stringify(team.tactics ?? {}),
          wid,
        );
        team.walletId = wid;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('wallet_id') && !msg.includes('UNIQUE')) throw err;
        wid = generateWalletId();
        attempt++;
        if (attempt >= 8) throw new Error('failed to allocate a unique wallet id');
      }
    }
    setOwnerTeam.run(team.id, team.ownerNick);
  }

  function setTeamTactics(teamId: string, tactics: Partial<Tactics>): void {
    updateTeamTactics.run(JSON.stringify(tactics), teamId);
  }

  // Profile customization update — sparse, each field optional.
  function updateTeamProfile(teamId: string, fields: TeamProfileFields): void {
    const sets: string[] = [];
    const args: (string | number)[] = [];
    if (typeof fields.bio === 'string') { sets.push('bio = ?'); args.push(fields.bio.slice(0, 500)); }
    if (typeof fields.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(fields.primaryColor)) {
      sets.push('primary_color = ?'); args.push(fields.primaryColor);
    }
    if (typeof fields.twitchUrl === 'string') { sets.push('twitch_url = ?'); args.push(fields.twitchUrl.slice(0, 200)); }
    if (typeof fields.twitterUrl === 'string') { sets.push('twitter_url = ?'); args.push(fields.twitterUrl.slice(0, 200)); }
    if (typeof fields.youtubeUrl === 'string') { sets.push('youtube_url = ?'); args.push(fields.youtubeUrl.slice(0, 200)); }
    // Logo id — short emoji code from LOGO_PACK. Capped at 8 chars so
    // we don't accept arbitrarily long blobs even if the client lies.
    if (typeof fields.logoId === 'string') { sets.push('logo_id = ?'); args.push(fields.logoId.slice(0, 8)); }
    if (sets.length === 0) return;
    args.push(teamId);
    db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }

  // -------- Achievements --------

  interface AchievementRow { team_id: string; kind: string; value: number | null; achieved_at: number; }

  const upsertAchievement = db.prepare(
    `INSERT INTO achievements (team_id, kind, value, achieved_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(team_id, kind) DO NOTHING`,
  );
  const findAchievement = db.prepare(`SELECT * FROM achievements WHERE team_id = ? AND kind = ?`);
  const achievementsForTeam = db.prepare(`SELECT * FROM achievements WHERE team_id = ? ORDER BY achieved_at DESC`);

  /** Returns true if this was a fresh unlock, false if the team already had it. */
  function unlockAchievement(teamId: string, kind: string, value?: number): boolean {
    const before = findAchievement.get(teamId, kind);
    if (before) return false;
    upsertAchievement.run(teamId, kind, value ?? null, Date.now());
    return true;
  }

  function loadAchievements(teamId: string) {
    const rows = achievementsForTeam.all(teamId) as AchievementRow[];
    return rows.map((r) => ({
      teamId: r.team_id,
      kind: r.kind,
      value: r.value ?? undefined,
      achievedAt: r.achieved_at,
    }));
  }

  // -------- Achievement cash rewards --------

  const loadUnpaidAchievementsStmt = db.prepare(
    `SELECT team_id, kind, value, achieved_at FROM achievements
     WHERE team_id = ? AND (reward_paid IS NULL OR reward_paid = 0)`,
  );
  const markAchievementPaidStmt = db.prepare(
    `UPDATE achievements SET reward_paid = 1 WHERE team_id = ? AND kind = ?`,
  );
  function loadUnpaidAchievements(teamId: string): Array<{ teamId: string; kind: string; value?: number; achievedAt: number }> {
    const rows = loadUnpaidAchievementsStmt.all(teamId) as AchievementRow[];
    return rows.map((r) => ({
      teamId: r.team_id, kind: r.kind, value: r.value ?? undefined, achievedAt: r.achieved_at,
    }));
  }
  function markAchievementRewardPaid(teamId: string, kind: string): void {
    markAchievementPaidStmt.run(teamId, kind);
  }

  function loadTeam(teamId: string): TeamRow | null {
    const row = getTeam.get(teamId) as Record<string, unknown> | undefined;
    return row ? rowToTeam(row) : null;
  }
  function loadTeamByTag(tag: string): TeamRow | null {
    const row = getTeamByTag.get(tag) as Record<string, unknown> | undefined;
    return row ? rowToTeam(row) : null;
  }
  /** Lookup by Wallet ID — the E-Wallet's canonical recipient handle
   *  (BTC-style opaque address). Case-insensitive, hyphens optional. */
  function loadTeamByWalletId(walletId: string): TeamRow | null {
    const normalized = walletId.trim().toUpperCase().replace(/\s+/g, '');
    const row = getTeamByWalletId.get(normalized) as Record<string, unknown> | undefined;
    return row ? rowToTeam(row) : null;
  }
  function assignTeamWalletId(teamId: string, walletId: string): void {
    setTeamWalletId.run(walletId, teamId);
  }

  /** Boot-time backfill: any team without a wallet_id gets one
   *  generated. Collision-safe — retries on the UNIQUE constraint.
   *  Wallet ID format: `CSM-XXXX-XXXX-XXXX` (12 hex chars, grouped
   *  in 4s). Idempotent; on subsequent boots this becomes a no-op. */
  function backfillWalletIds(): { assigned: number } {
    const rows = listTeamsMissingWallet.all() as Array<{ id: string }>;
    let assigned = 0;
    for (const r of rows) {
      let attempt = 0;
      while (attempt < 5) {
        const wid = generateWalletId();
        try {
          setTeamWalletId.run(wid, r.id);
          assigned++;
          break;
        } catch {
          attempt++;
        }
      }
    }
    return { assigned };
  }

  function setTeamPlayers(teamId: string, playerIds: string[]): void {
    updateTeamPlayers.run(JSON.stringify(playerIds), teamId);
  }

  function setTeamMoneyDay(teamId: string, money: number, day: number): void {
    updateTeamMoneyDay.run(money, day, teamId);
  }

  function persistPlayer(player: Player): void {
    updatePlayerJson.run(JSON.stringify(player), player.teamId, player.id);
  }

  // -------- Players --------

  // OR IGNORE so a duplicate id never crashes a batch insert — the caller's
  // collision-avoidance loop is the authoritative dedupe; this is belt-and-
  // braces only. Use `persistPlayer` (UPDATE) for in-place mutations.
  const insertPlayer = db.prepare(`INSERT OR IGNORE INTO players (id, team_id, json) VALUES (?, ?, ?)`);
  const loadPlayerStmt = db.prepare(`SELECT json FROM players WHERE id = ?`);
  const loadPlayersByTeam = db.prepare(`SELECT json FROM players WHERE team_id = ?`);

  function savePlayer(player: Player): void {
    insertPlayer.run(player.id, player.teamId, JSON.stringify(player));
  }

  function loadPlayer(id: string): Player | null {
    const row = loadPlayerStmt.get(id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Player) : null;
  }

  function loadTeamPlayers(teamId: string): Player[] {
    const rows = loadPlayersByTeam.all(teamId) as { json: string }[];
    const players = rows.map((r) => JSON.parse(r.json) as Player);
    // Re-order to match the team's saved lineup (the JSON column on teams).
    // Without this, SQLite returns rows in rowid order — `players.slice(0,5)`
    // in the duel engine would then pick the FIRST FIVE PLAYERS EVER SAVED,
    // not the 5 the user dragged to the top of their lineup. That's a quiet
    // way to lose matches because your bench is playing instead of starters.
    const team = loadTeam(teamId);
    if (!team) return players;
    const indexById = new Map(team.playerIds.map((id, i) => [id, i] as const));
    return players.sort((a, b) => {
      const ai = indexById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = indexById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }

  // Used by every newgen-spawning code path (initial roster, FA pool refill,
  // pay-to-scout mint) to avoid `UNIQUE constraint failed` on insert. We have
  // to scan the whole table — checking only free agents misses signed roster
  // players whose nick happens to collide with the next generated one.
  const allPlayerKeysStmt = db.prepare(`SELECT id, json FROM players`);
  function loadAllPlayerKeys(): { ids: Set<string>; nicks: Set<string> } {
    const rows = allPlayerKeysStmt.all() as { id: string; json: string }[];
    const ids = new Set<string>();
    const nicks = new Set<string>();
    for (const r of rows) {
      ids.add(r.id);
      try {
        const p = JSON.parse(r.json) as Player;
        if (p.nickname) nicks.add(p.nickname.toLowerCase());
      } catch {
        // bad row → skip nickname check, id already added
      }
    }
    return { ids, nicks };
  }

  // Slim team enumeration for async-PvP matchmaking. We only need the
  // fields the matchmaker filters on (money, roster count) plus the bare
  // identity fields — full team rows would be 10× heavier.
  const matchmakingPoolStmt = db.prepare(
    `SELECT id, tag, name, region, money, player_ids
     FROM teams
     WHERE money >= ?
     ORDER BY rowid ASC`,
  );

  function loadMatchmakingPool(minMoney: number): Array<{
    id: string; tag: string; name: string; region: string; money: number; playerIds: string[];
  }> {
    const rows = matchmakingPoolStmt.all(minMoney) as Array<{
      id: string; tag: string; name: string; region: string; money: number; player_ids: string;
    }>;
    return rows.map((r) => {
      let ids: string[] = [];
      try { ids = JSON.parse(r.player_ids ?? '[]') as string[]; } catch { /* empty roster */ }
      return { id: r.id, tag: r.tag, name: r.name, region: r.region, money: r.money, playerIds: ids };
    });
  }

  // -------- Sessions --------

  const upsertSession = db.prepare(
    `INSERT INTO sessions (token, team_id, last_seen) VALUES (?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET last_seen = excluded.last_seen`,
  );
  const findSession = db.prepare(`SELECT * FROM sessions WHERE token = ?`);

  function issueSession(teamId: string): string {
    const token = randomBytes(16).toString('hex');
    upsertSession.run(token, teamId, Date.now());
    return token;
  }

  function resolveSession(token: string): SessionRow | null {
    const row = findSession.get(token) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      token: row.token as string,
      teamId: row.team_id as string,
      lastSeen: row.last_seen as number,
    };
  }

  // -------- Market --------

  const insertListing = db.prepare(
    `INSERT INTO market_listings (id, player_id, seller_team_id, seller_team_tag, asking_price, listed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const deleteListing = db.prepare(`DELETE FROM market_listings WHERE id = ?`);
  const findListing = db.prepare(`SELECT * FROM market_listings WHERE id = ?`);
  const findListingByPlayer = db.prepare(`SELECT * FROM market_listings WHERE player_id = ?`);
  const allListings = db.prepare(`SELECT * FROM market_listings ORDER BY listed_at DESC LIMIT 200`);

  interface ListingRow {
    id: string;
    player_id: string;
    seller_team_id: string;
    seller_team_tag: string;
    asking_price: number;
    listed_at: number;
  }

  function listingRowToObj(row: ListingRow) {
    return {
      id: row.id,
      playerId: row.player_id,
      sellerTeamId: row.seller_team_id,
      sellerTeamTag: row.seller_team_tag,
      askingPrice: row.asking_price,
      listedAt: row.listed_at,
    };
  }

  function createListing(
    id: string,
    playerId: string,
    sellerTeamId: string,
    sellerTeamTag: string,
    askingPrice: number,
  ): { id: string; playerId: string; sellerTeamId: string; sellerTeamTag: string; askingPrice: number; listedAt: number } {
    const listedAt = Date.now();
    insertListing.run(id, playerId, sellerTeamId, sellerTeamTag, askingPrice, listedAt);
    return { id, playerId, sellerTeamId, sellerTeamTag, askingPrice, listedAt };
  }

  function removeListing(id: string): void {
    deleteListing.run(id);
  }

  function loadListing(id: string) {
    const row = findListing.get(id) as ListingRow | undefined;
    return row ? listingRowToObj(row) : null;
  }

  function loadListingByPlayer(playerId: string) {
    const row = findListingByPlayer.get(playerId) as ListingRow | undefined;
    return row ? listingRowToObj(row) : null;
  }

  function loadAllListings() {
    const rows = allListings.all() as ListingRow[];
    return rows.map(listingRowToObj);
  }

  // -------- Free agent pool --------
  //
  // Free agents are stored in the same `players` table with team_id = NULL.
  // We keep a small pool fresh at all times so a solo player always has
  // someone to scout / sign. `loadFreeAgents` ignores any player that's
  // currently on a listing (those are paid market entries).

  const freeAgentsStmt = db.prepare(
    `SELECT players.json FROM players
     WHERE players.team_id IS NULL
       AND players.id NOT IN (SELECT player_id FROM market_listings)
     ORDER BY RANDOM()
     LIMIT ?`,
  );
  const countFreeAgentsStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM players WHERE team_id IS NULL`,
  );

  function loadFreeAgents(limit = 60): Player[] {
    const rows = freeAgentsStmt.all(limit) as { json: string }[];
    // Filter out retired players — they're in the HoF, not the market.
    // JSON payload holds the flag; SQL can't easily filter without a
    // column, and this scan is fast enough for FA pool sizes.
    return rows.map((r) => JSON.parse(r.json) as Player).filter((p) => !p.retired);
  }

  function countFreeAgents(): number {
    const row = countFreeAgentsStmt.get() as { n: number };
    return row.n;
  }

  // -------- Challenges --------

  interface ChallengeRow {
    id: string;
    challenger_team_id: string;
    challenger_tag: string;
    challenger_nick: string;
    stake: number;
    format: string;
    message: string | null;
    created_at: number;
    status: string;
  }

  const insertChallenge = db.prepare(
    `INSERT INTO challenges (id, challenger_team_id, challenger_tag, challenger_nick, stake, format, message, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
  );
  const findChallenge = db.prepare(`SELECT * FROM challenges WHERE id = ?`);
  const deleteChallenge = db.prepare(`DELETE FROM challenges WHERE id = ?`);
  const allOpenChallenges = db.prepare(
    `SELECT * FROM challenges WHERE status = 'open' ORDER BY created_at DESC LIMIT 50`,
  );
  const challengesByTeam = db.prepare(
    `SELECT * FROM challenges WHERE challenger_team_id = ? AND status = 'open'`,
  );

  function rowToChallenge(row: ChallengeRow) {
    return {
      id: row.id,
      challengerTeamId: row.challenger_team_id,
      challengerTag: row.challenger_tag,
      challengerNick: row.challenger_nick,
      stake: row.stake,
      format: row.format as 'BO1' | 'BO3' | 'BO5',
      message: row.message ?? undefined,
      createdAt: row.created_at,
    };
  }

  function createChallenge(args: {
    id: string;
    challengerTeamId: string;
    challengerTag: string;
    challengerNick: string;
    stake: number;
    format: string;
    message?: string;
  }) {
    insertChallenge.run(
      args.id,
      args.challengerTeamId,
      args.challengerTag,
      args.challengerNick,
      args.stake,
      args.format,
      args.message ?? null,
      Date.now(),
    );
  }

  function loadChallenge(id: string) {
    const row = findChallenge.get(id) as ChallengeRow | undefined;
    return row ? rowToChallenge(row) : null;
  }

  function removeChallenge(id: string): void {
    deleteChallenge.run(id);
  }

  function loadOpenChallenges() {
    const rows = allOpenChallenges.all() as ChallengeRow[];
    return rows.map(rowToChallenge);
  }

  function loadChallengesByTeam(teamId: string) {
    const rows = challengesByTeam.all(teamId) as ChallengeRow[];
    return rows.map(rowToChallenge);
  }

  // -------- Match history --------

  interface MatchHistoryRow {
    id: string;
    team_a_id: string;
    team_b_id: string | null;
    team_a_tag: string;
    team_b_tag: string;
    winner_id: string;
    maps_a: number;
    maps_b: number;
    stake: number;
    kind: string;
    played_at: number;
    result_json: string;
  }

  const insertMatch = db.prepare(
    `INSERT INTO match_history (id, team_a_id, team_b_id, team_a_tag, team_b_tag, winner_id, maps_a, maps_b, stake, kind, played_at, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const findMatch = db.prepare(`SELECT * FROM match_history WHERE id = ?`);
  const matchesForTeam = db.prepare(
    `SELECT * FROM match_history
     WHERE team_a_id = ? OR team_b_id = ?
     ORDER BY played_at DESC
     LIMIT ?`,
  );

  function recordMatch(args: {
    id: string;
    teamAId: string;
    teamBId: string | null;
    teamATag: string;
    teamBTag: string;
    winnerId: string;
    mapsA: number;
    mapsB: number;
    stake: number;
    kind: 'ai' | 'pvp';
    resultJson: string;
  }): void {
    insertMatch.run(
      args.id,
      args.teamAId,
      args.teamBId,
      args.teamATag,
      args.teamBTag,
      args.winnerId,
      args.mapsA,
      args.mapsB,
      args.stake,
      args.kind,
      Date.now(),
      args.resultJson,
    );
  }

  function loadMatch(id: string) {
    const row = findMatch.get(id) as MatchHistoryRow | undefined;
    return row;
  }

  function loadMatchesForTeam(teamId: string, limit = 25) {
    const rows = matchesForTeam.all(teamId, teamId, limit) as MatchHistoryRow[];
    return rows;
  }

  // -------- Seasons + leaderboard --------

  interface SeasonRow {
    season_no: number;
    started_at: number;
    ends_at: number;
    prize_pool: number;
    finished: number;
  }

  interface StandingsRow {
    team_id: string;
    team_tag: string;
    team_name: string;
    wins: number;
    losses: number;
    net_money: number;
    streak: number;
  }

  const SEASON_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // weekly

  const insertSeason = db.prepare(
    `INSERT INTO seasons (season_no, started_at, ends_at, prize_pool, finished) VALUES (?, ?, ?, ?, 0)`,
  );
  const latestSeasonStmt = db.prepare(
    `SELECT * FROM seasons ORDER BY season_no DESC LIMIT 1`,
  );
  const finishSeasonStmt = db.prepare(`UPDATE seasons SET finished = 1 WHERE season_no = ?`);

  function currentSeason(): { seasonNo: number; startedAt: number; endsAt: number; prizePool: number } {
    const row = latestSeasonStmt.get() as SeasonRow | undefined;
    const now = Date.now();
    if (!row) {
      // First-ever season starts now.
      const ends = now + SEASON_DURATION_MS;
      insertSeason.run(1, now, ends, 0);
      return { seasonNo: 1, startedAt: now, endsAt: ends, prizePool: 0 };
    }
    if (row.finished || row.ends_at <= now) {
      // Previous one expired — open a new season.
      const nextNo = row.season_no + 1;
      const ends = now + SEASON_DURATION_MS;
      insertSeason.run(nextNo, now, ends, 0);
      // Mark prior season as finished if it wasn't already (helps reads).
      if (!row.finished) finishSeasonStmt.run(row.season_no);
      return { seasonNo: nextNo, startedAt: now, endsAt: ends, prizePool: 0 };
    }
    return {
      seasonNo: row.season_no,
      startedAt: row.started_at,
      endsAt: row.ends_at,
      prizePool: row.prize_pool,
    };
  }

  const upsertStanding = db.prepare(
    `INSERT INTO season_standings (season_no, team_id, wins, losses, net_money, streak)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(season_no, team_id) DO UPDATE SET
       wins = season_standings.wins + excluded.wins,
       losses = season_standings.losses + excluded.losses,
       net_money = season_standings.net_money + excluded.net_money,
       streak = excluded.streak`,
  );
  const standingsForTeamStmt = db.prepare(
    `SELECT wins, losses, net_money, streak FROM season_standings WHERE season_no = ? AND team_id = ?`,
  );
  const leaderboardStmt = db.prepare(
    `SELECT s.team_id, s.wins, s.losses, s.net_money, s.streak,
            t.tag AS team_tag, t.name AS team_name
     FROM season_standings s
     INNER JOIN teams t ON t.id = s.team_id
     WHERE s.season_no = ?
     ORDER BY s.wins DESC, s.net_money DESC
     LIMIT 50`,
  );

  function recordSeasonOutcome(
    seasonNo: number,
    teamId: string,
    won: boolean,
    moneyDelta: number,
  ): { wins: number; losses: number; netMoney: number; streak: number } {
    const prior = standingsForTeamStmt.get(seasonNo, teamId) as
      | { wins: number; losses: number; net_money: number; streak: number }
      | undefined;
    const priorStreak = prior?.streak ?? 0;
    const newStreak = won
      ? Math.max(1, priorStreak + 1)   // wins continue / restart positive
      : Math.min(-1, priorStreak - 1); // losses go negative
    upsertStanding.run(seasonNo, teamId, won ? 1 : 0, won ? 0 : 1, moneyDelta, newStreak);
    const fresh = standingsForTeamStmt.get(seasonNo, teamId) as
      | { wins: number; losses: number; net_money: number; streak: number };
    return {
      wins: fresh.wins,
      losses: fresh.losses,
      netMoney: fresh.net_money,
      streak: fresh.streak,
    };
  }

  function loadLeaderboard(seasonNo: number) {
    const rows = leaderboardStmt.all(seasonNo) as StandingsRow[];
    return rows.map((r, i) => ({
      rank: i + 1,
      teamId: r.team_id,
      teamTag: r.team_tag,
      teamName: r.team_name,
      wins: r.wins,
      losses: r.losses,
      netMoney: r.net_money,
      streak: r.streak,
    }));
  }

  function loadTeamStandings(seasonNo: number, teamId: string) {
    const row = standingsForTeamStmt.get(seasonNo, teamId) as
      | { wins: number; losses: number; net_money: number; streak: number }
      | undefined;
    if (!row) return { wins: 0, losses: 0, netMoney: 0, streak: 0 };
    return { wins: row.wins, losses: row.losses, netMoney: row.net_money, streak: row.streak };
  }

  // -------- PvP-only leaderboard (derived from match_history) --------
  //
  // The standings table above mixes AI + PvP wins. To incentivise live
  // duels we expose a parallel leaderboard that only counts PvP matches
  // played within the current season window. Walks match_history once per
  // call — at ~hundreds of matches per week this is cheap; if it ever
  // grows we can cache or materialise it. Streak is computed per team by
  // scanning their matches in time order and counting the trailing run.

  const pvpMatchesSinceStmt = db.prepare(
    `SELECT m.team_a_id, m.team_b_id, m.team_a_tag, m.team_b_tag,
            m.winner_id, m.stake, m.played_at,
            ta.name AS team_a_name, tb.name AS team_b_name
     FROM match_history m
     LEFT JOIN teams ta ON ta.id = m.team_a_id
     LEFT JOIN teams tb ON tb.id = m.team_b_id
     WHERE m.kind = 'pvp' AND m.played_at >= ? AND m.team_b_id IS NOT NULL
     ORDER BY m.played_at ASC`,
  );

  interface PvpAgg {
    teamId: string;
    teamTag: string;
    teamName: string;
    wins: number;
    losses: number;
    netStake: number;
    /** Win/loss results in chronological order — used to compute streak. */
    results: ('W' | 'L')[];
  }

  function aggregatePvp(seasonStartedAt: number): Map<string, PvpAgg> {
    const rows = pvpMatchesSinceStmt.all(seasonStartedAt) as Array<{
      team_a_id: string;
      team_b_id: string;
      team_a_tag: string;
      team_b_tag: string;
      winner_id: string;
      stake: number;
      played_at: number;
      team_a_name: string | null;
      team_b_name: string | null;
    }>;
    const stats = new Map<string, PvpAgg>();
    const ensure = (id: string, tag: string, name: string | null): PvpAgg => {
      const cur = stats.get(id);
      if (cur) return cur;
      const fresh: PvpAgg = {
        teamId: id, teamTag: tag, teamName: name ?? tag,
        wins: 0, losses: 0, netStake: 0, results: [],
      };
      stats.set(id, fresh);
      return fresh;
    };
    for (const r of rows) {
      const a = ensure(r.team_a_id, r.team_a_tag, r.team_a_name);
      const b = ensure(r.team_b_id, r.team_b_tag, r.team_b_name);
      if (r.winner_id === r.team_a_id) {
        a.wins += 1; a.netStake += r.stake; a.results.push('W');
        b.losses += 1; b.netStake -= r.stake; b.results.push('L');
      } else {
        b.wins += 1; b.netStake += r.stake; b.results.push('W');
        a.losses += 1; a.netStake -= r.stake; a.results.push('L');
      }
    }
    return stats;
  }

  /** Compute current streak from a chronological results list. Positive
   *  = trailing W-streak length, negative = trailing L-streak length. */
  function computeStreak(results: ('W' | 'L')[]): number {
    if (results.length === 0) return 0;
    const last = results[results.length - 1]!;
    let n = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] === last) n++;
      else break;
    }
    return last === 'W' ? n : -n;
  }

  function loadPvpLeaderboard(seasonStartedAt: number) {
    const stats = aggregatePvp(seasonStartedAt);
    const rows = [...stats.values()].map((s) => ({
      teamId: s.teamId,
      teamTag: s.teamTag,
      teamName: s.teamName,
      pvpWins: s.wins,
      pvpLosses: s.losses,
      pvpNetStake: s.netStake,
      pvpStreak: computeStreak(s.results),
    }));
    // Primary sort: wins desc. Tiebreak 1: net stake. Tiebreak 2: win%.
    rows.sort((a, b) => {
      if (a.pvpWins !== b.pvpWins) return b.pvpWins - a.pvpWins;
      if (a.pvpNetStake !== b.pvpNetStake) return b.pvpNetStake - a.pvpNetStake;
      const aTotal = a.pvpWins + a.pvpLosses;
      const bTotal = b.pvpWins + b.pvpLosses;
      const aPct = aTotal > 0 ? a.pvpWins / aTotal : 0;
      const bPct = bTotal > 0 ? b.pvpWins / bTotal : 0;
      return bPct - aPct;
    });
    return rows.slice(0, 50).map((r, i) => ({ rank: i + 1, ...r }));
  }

  function loadPvpStandingsForTeam(seasonStartedAt: number, teamId: string) {
    const stats = aggregatePvp(seasonStartedAt);
    const me = stats.get(teamId);
    if (!me) return { pvpWins: 0, pvpLosses: 0, pvpNetStake: 0, pvpStreak: 0 };
    return {
      pvpWins: me.wins,
      pvpLosses: me.losses,
      pvpNetStake: me.netStake,
      pvpStreak: computeStreak(me.results),
    };
  }

  // -------- Hall of Fame --------

  interface HoFRow {
    player_id: string;
    nickname: string;
    role: string;
    nationality: string;
    last_age: number;
    peak_ca: number;
    career_wins: number;
    career_losses: number;
    last_team_id: string | null;
    last_team_tag: string | null;
    retired_at: number;
  }

  const insertHoF = db.prepare(
    `INSERT INTO hall_of_fame (player_id, nickname, role, nationality, last_age, peak_ca, career_wins, career_losses, last_team_id, last_team_tag, retired_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id) DO NOTHING`,
  );
  const findHoF = db.prepare(`SELECT * FROM hall_of_fame WHERE player_id = ?`);
  const topHoF = db.prepare(`SELECT * FROM hall_of_fame ORDER BY peak_ca DESC, retired_at DESC LIMIT ?`);
  // Career W/L for a team — aggregated from every match in history.
  // Used at HoF induction so the retiree's record reflects the team
  // they played for (we don't track per-player W/L on the Player row).
  const teamCareerRecordStmt = db.prepare(
    `SELECT
       SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN winner_id != ? AND (team_a_id = ? OR team_b_id = ?) THEN 1 ELSE 0 END) AS losses
       FROM match_history
       WHERE team_a_id = ? OR team_b_id = ?`,
  );

  function rowToHoF(r: HoFRow) {
    return {
      playerId: r.player_id,
      nickname: r.nickname,
      role: r.role,
      nationality: r.nationality,
      lastAge: r.last_age,
      peakCA: r.peak_ca,
      careerWins: r.career_wins,
      careerLosses: r.career_losses,
      lastTeamId: r.last_team_id ?? undefined,
      lastTeamTag: r.last_team_tag ?? undefined,
      retiredAt: r.retired_at,
    };
  }

  function inductIntoHoF(args: {
    playerId: string;
    nickname: string;
    role: string;
    nationality: string;
    lastAge: number;
    peakCA: number;
    careerWins?: number;
    careerLosses?: number;
    lastTeamId?: string | null;
    lastTeamTag?: string | null;
  }): void {
    insertHoF.run(
      args.playerId, args.nickname, args.role, args.nationality,
      args.lastAge, args.peakCA, args.careerWins ?? 0, args.careerLosses ?? 0,
      args.lastTeamId ?? null, args.lastTeamTag ?? null, Date.now(),
    );
  }

  function loadHallOfFame(limit = 50) {
    return (topHoF.all(limit) as HoFRow[]).map(rowToHoF);
  }

  /** Career W/L for a team across all match_history rows. */
  function loadTeamCareerRecord(teamId: string): { wins: number; losses: number } {
    const r = teamCareerRecordStmt.get(teamId, teamId, teamId, teamId, teamId, teamId) as
      | { wins: number | null; losses: number | null }
      | undefined;
    return { wins: r?.wins ?? 0, losses: r?.losses ?? 0 };
  }

  /** One-shot backfill: every HoF row that was inducted with the default
   *  0-0 record gets its W/L recomputed from match_history using the
   *  player's last team. Idempotent — canary-gated; safe to call on every
   *  boot. Returns the count of rows updated. */
  function backfillHallOfFameRecords(): { updated: number } {
    if (getMeta('hof_wl_backfilled') === '1') return { updated: 0 };
    const rows = db.prepare(
      `SELECT player_id, last_team_id FROM hall_of_fame WHERE career_wins = 0 AND career_losses = 0 AND last_team_id IS NOT NULL`,
    ).all() as Array<{ player_id: string; last_team_id: string }>;
    const update = db.prepare(`UPDATE hall_of_fame SET career_wins = ?, career_losses = ? WHERE player_id = ?`);
    let updated = 0;
    for (const r of rows) {
      const rec = loadTeamCareerRecord(r.last_team_id);
      if (rec.wins === 0 && rec.losses === 0) continue;
      update.run(rec.wins, rec.losses, r.player_id);
      updated++;
    }
    setMeta('hof_wl_backfilled', '1');
    return { updated };
  }

  function loadHoFEntry(playerId: string) {
    const r = findHoF.get(playerId) as HoFRow | undefined;
    return r ? rowToHoF(r) : null;
  }

  // -------- Coaches --------

  interface CoachRow {
    id: string;
    name: string;
    nationality: string;
    skill: number;
    monthly_wage: number;
    hired_by_team_id: string | null;
    hired_at: number | null;
    generated_at: number;
  }

  const insertCoach = db.prepare(
    `INSERT INTO coaches (id, name, nationality, skill, monthly_wage, hired_by_team_id, hired_at, generated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
  );
  const openCoaches = db.prepare(
    `SELECT * FROM coaches WHERE hired_by_team_id IS NULL ORDER BY skill DESC LIMIT 12`,
  );
  const findCoach = db.prepare(`SELECT * FROM coaches WHERE id = ?`);
  const coachForTeam = db.prepare(`SELECT * FROM coaches WHERE hired_by_team_id = ? LIMIT 1`);
  const setCoachHired = db.prepare(`UPDATE coaches SET hired_by_team_id = ?, hired_at = ? WHERE id = ?`);
  const countCoaches = db.prepare(`SELECT COUNT(*) AS n FROM coaches WHERE hired_by_team_id IS NULL`);

  function rowToCoach(r: CoachRow) {
    return {
      id: r.id,
      name: r.name,
      nationality: r.nationality,
      skill: r.skill,
      monthlyWage: r.monthly_wage,
      hiredByTeamId: r.hired_by_team_id ?? undefined,
      hiredAt: r.hired_at ?? undefined,
    };
  }

  function addCoachToPool(args: { id: string; name: string; nationality: string; skill: number; monthlyWage: number }): void {
    insertCoach.run(args.id, args.name, args.nationality, args.skill, args.monthlyWage, Date.now());
  }
  function loadOpenCoaches() { return (openCoaches.all() as CoachRow[]).map(rowToCoach); }
  function loadCoach(id: string) { const r = findCoach.get(id) as CoachRow | undefined; return r ? rowToCoach(r) : null; }
  function loadHiredCoachFor(teamId: string) { const r = coachForTeam.get(teamId) as CoachRow | undefined; return r ? rowToCoach(r) : null; }
  function hireCoach(id: string, teamId: string | null) { setCoachHired.run(teamId, teamId ? Date.now() : null, id); }
  function countOpenCoaches() { return (countCoaches.get() as { n: number }).n; }

  // -------- Sponsors (objective-based) --------

  interface SponsorRow {
    id: string;
    team_id: string;
    sponsor_name: string;
    monthly_amount: number; // legacy column name; holds the one-shot reward
    status: string;
    offered_at: number;
    last_paid_at: number | null;
    wins_required: number;
    wins_at_start: number;
    activated_at: number;
  }

  const insertSponsor = db.prepare(
    `INSERT INTO sponsors (id, team_id, sponsor_name, monthly_amount, status, offered_at, last_paid_at, wins_required, wins_at_start, activated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, 0, 0)`,
  );
  const findSponsor = db.prepare(`SELECT * FROM sponsors WHERE id = ?`);
  const sponsorsForTeam = db.prepare(`SELECT * FROM sponsors WHERE team_id = ? AND status != 'declined' AND status != 'claimed' ORDER BY offered_at DESC`);
  const updateSponsorStatus = db.prepare(`UPDATE sponsors SET status = ? WHERE id = ?`);
  const activateSponsor = db.prepare(`UPDATE sponsors SET status = 'active', activated_at = ?, wins_at_start = ? WHERE id = ?`);
  const claimSponsor = db.prepare(`UPDATE sponsors SET status = 'claimed' WHERE id = ?`);

  type SponsorStatus = 'pending' | 'active' | 'ready' | 'claimed' | 'declined';
  interface SponsorOfferRow {
    id: string;
    teamId: string;
    sponsorName: string;
    /** One-shot reward (dollars) paid on claim. */
    rewardAmount: number;
    /** Total wins required under this sponsorship to unlock the reward. */
    winsRequired: number;
    winsAtStart: number;
    status: SponsorStatus;
    offeredAt: number;
    activatedAt?: number;
  }
  function rowToSponsor(r: SponsorRow): SponsorOfferRow {
    return {
      id: r.id,
      teamId: r.team_id,
      sponsorName: r.sponsor_name,
      rewardAmount: r.monthly_amount,
      winsRequired: r.wins_required,
      winsAtStart: r.wins_at_start,
      status: r.status as SponsorStatus,
      offeredAt: r.offered_at,
      activatedAt: r.activated_at > 0 ? r.activated_at : undefined,
    };
  }

  function createSponsorOffer(args: { id: string; teamId: string; sponsorName: string; rewardAmount: number; winsRequired: number }): void {
    insertSponsor.run(args.id, args.teamId, args.sponsorName, args.rewardAmount, Date.now(), args.winsRequired);
  }
  function loadSponsor(id: string) { const r = findSponsor.get(id) as SponsorRow | undefined; return r ? rowToSponsor(r) : null; }
  function loadSponsorsForTeam(teamId: string) { return (sponsorsForTeam.all(teamId) as SponsorRow[]).map(rowToSponsor); }
  function setSponsorStatus(id: string, status: SponsorStatus) { updateSponsorStatus.run(status, id); }
  function markSponsorActive(id: string, winsAtStart: number): void {
    activateSponsor.run(Date.now(), winsAtStart, id);
  }
  function markSponsorClaimed(id: string): void { claimSponsor.run(id); }

  /** One-shot canary-gated cleanup: any sponsor row created BEFORE the
   *  objective model (wins_required = 0 AND status is still 'pending' or
   *  'active') gets set to 'declined'. Old monthly rows are meaningless
   *  in the new economy — safer to sunset them than to grant free cash. */
  function backfillLegacySponsors(): { updated: number } {
    if (getMeta('sponsors_objective_migrated') === '1') return { updated: 0 };
    const r = db.prepare(
      `UPDATE sponsors SET status = 'declined' WHERE wins_required = 0 AND (status = 'pending' OR status = 'active')`,
    ).run();
    setMeta('sponsors_objective_migrated', '1');
    return { updated: r.changes };
  }

  // -------- Player loans --------

  interface LoanRow {
    id: string;
    from_team_id: string;
    to_team_id: string;
    player_id: string;
    fee: number;
    days: number;
    offered_at: number;
    ends_at: number | null;
    status: string;
  }

  const insertLoan = db.prepare(
    `INSERT INTO player_loans (id, from_team_id, to_team_id, player_id, fee, days, offered_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
  );
  const findLoan = db.prepare(`SELECT * FROM player_loans WHERE id = ?`);
  const loanFromTeam = db.prepare(`SELECT * FROM player_loans WHERE from_team_id = ? AND status != 'returned' AND status != 'declined' ORDER BY offered_at DESC`);
  const loanToTeam = db.prepare(`SELECT * FROM player_loans WHERE to_team_id = ? AND status != 'returned' AND status != 'declined' ORDER BY offered_at DESC`);
  // Pre-offer guard: catches multi-team spam on the SAME player while a
  // previous offer is still pending OR a previous loan is still active.
  const openLoanForPlayer = db.prepare(
    `SELECT * FROM player_loans WHERE player_id = ? AND (status = 'pending' OR status = 'active') LIMIT 1`,
  );
  const dueLoans = db.prepare(`SELECT * FROM player_loans WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?`);
  const updateLoanStatus = db.prepare(`UPDATE player_loans SET status = ?, ends_at = ? WHERE id = ?`);

  function rowToLoan(r: LoanRow) {
    return {
      id: r.id,
      fromTeamId: r.from_team_id,
      toTeamId: r.to_team_id,
      playerId: r.player_id,
      fee: r.fee,
      days: r.days,
      offeredAt: r.offered_at,
      endsAt: r.ends_at ?? undefined,
      status: r.status as 'pending' | 'active' | 'returned' | 'declined',
    };
  }

  function createLoanOffer(args: { id: string; fromTeamId: string; toTeamId: string; playerId: string; fee: number; days: number }): void {
    insertLoan.run(args.id, args.fromTeamId, args.toTeamId, args.playerId, args.fee, args.days, Date.now());
  }
  function loadLoan(id: string) { const r = findLoan.get(id) as LoanRow | undefined; return r ? rowToLoan(r) : null; }
  function loadLoansFromTeam(teamId: string) { return (loanFromTeam.all(teamId) as LoanRow[]).map(rowToLoan); }
  function loadLoansToTeam(teamId: string) { return (loanToTeam.all(teamId) as LoanRow[]).map(rowToLoan); }
  function loadOpenLoanForPlayer(playerId: string) {
    const r = openLoanForPlayer.get(playerId) as LoanRow | undefined;
    return r ? rowToLoan(r) : null;
  }
  function loadDueLoans(now: number) { return (dueLoans.all(now) as LoanRow[]).map(rowToLoan); }
  function setLoanStatus(id: string, status: 'pending' | 'active' | 'returned' | 'declined', endsAt: number | null = null) {
    updateLoanStatus.run(status, endsAt, id);
  }

  // -------- Tactics presets --------

  interface PresetRow {
    id: string;
    owner_nick: string;
    name: string;
    tactics_json: string;
    created_at: number;
  }

  const insertPreset = db.prepare(
    `INSERT INTO tactics_presets (id, owner_nick, name, tactics_json, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const findPreset = db.prepare(`SELECT * FROM tactics_presets WHERE id = ?`);
  const presetsForOwner = db.prepare(
    `SELECT * FROM tactics_presets WHERE owner_nick = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 20`,
  );
  const deletePreset = db.prepare(`DELETE FROM tactics_presets WHERE id = ? AND owner_nick = ? COLLATE NOCASE`);

  function rowToPreset(row: PresetRow) {
    let tactics: Partial<Tactics> = {};
    try { tactics = JSON.parse(row.tactics_json); } catch { /* default empty */ }
    return {
      id: row.id,
      ownerNick: row.owner_nick,
      name: row.name,
      tactics,
      createdAt: row.created_at,
    };
  }

  function savePreset(id: string, ownerNick: string, name: string, tactics: Partial<Tactics>): void {
    insertPreset.run(id, ownerNick, name.slice(0, 32), JSON.stringify(tactics), Date.now());
  }

  function loadPresetsForOwner(ownerNick: string) {
    const rows = presetsForOwner.all(ownerNick) as PresetRow[];
    return rows.map(rowToPreset);
  }

  function loadPreset(id: string) {
    const row = findPreset.get(id) as PresetRow | undefined;
    return row ? rowToPreset(row) : null;
  }

  function removePreset(id: string, ownerNick: string): void {
    deletePreset.run(id, ownerNick);
  }

  // -------- News ticker --------

  interface NewsRow { id: number; kind: string; body: string; at: number; }

  const insertNews = db.prepare(`INSERT INTO news_items (kind, body, at) VALUES (?, ?, ?)`);
  const findNews = db.prepare(`SELECT * FROM news_items WHERE id = ?`);
  const newsRecent = db.prepare(`SELECT * FROM news_items ORDER BY id DESC LIMIT ?`);
  const trimNews = db.prepare(
    `DELETE FROM news_items WHERE id NOT IN (SELECT id FROM news_items ORDER BY id DESC LIMIT 200)`,
  );

  function rowToNews(r: NewsRow) {
    return { id: r.id, kind: r.kind, body: r.body, at: r.at };
  }

  function publishNews(kind: string, body: string) {
    const at = Date.now();
    const info = insertNews.run(kind, body.slice(0, 220), at);
    trimNews.run();
    const id = info.lastInsertRowid as number;
    const row = findNews.get(id) as NewsRow;
    return rowToNews(row);
  }

  function loadRecentNews(limit = 50) {
    const rows = newsRecent.all(limit) as NewsRow[];
    return rows.map(rowToNews).reverse(); // oldest first for ticker
  }

  // -------- Player development goals --------

  interface GoalRow {
    player_id: string;
    attr: string;
    target: number;
    set_at: number;
    reached_at: number | null;
  }

  const upsertGoal = db.prepare(
    `INSERT INTO player_goals (player_id, attr, target, set_at, reached_at) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(player_id, attr) DO UPDATE SET target = excluded.target, set_at = excluded.set_at, reached_at = NULL`,
  );
  const deleteGoal = db.prepare(`DELETE FROM player_goals WHERE player_id = ? AND attr = ?`);
  const goalsForPlayers = db.prepare(
    `SELECT * FROM player_goals WHERE player_id IN (SELECT id FROM players WHERE team_id = ?)`,
  );
  const goalsAllOpen = db.prepare(`SELECT * FROM player_goals WHERE reached_at IS NULL`);
  const markGoalReached = db.prepare(
    `UPDATE player_goals SET reached_at = ? WHERE player_id = ? AND attr = ?`,
  );

  function rowToGoal(r: GoalRow) {
    return {
      playerId: r.player_id,
      attr: r.attr,
      target: r.target,
      setAt: r.set_at,
      reachedAt: r.reached_at ?? undefined,
    };
  }

  function setGoal(playerId: string, attr: string, target: number): void {
    upsertGoal.run(playerId, attr, target, Date.now());
  }

  function clearGoal(playerId: string, attr: string): void {
    deleteGoal.run(playerId, attr);
  }

  function loadGoalsForTeam(teamId: string) {
    const rows = goalsForPlayers.all(teamId) as GoalRow[];
    return rows.map(rowToGoal);
  }

  function loadAllOpenGoals() {
    const rows = goalsAllOpen.all() as GoalRow[];
    return rows.map(rowToGoal);
  }

  function flagGoalReached(playerId: string, attr: string): void {
    markGoalReached.run(Date.now(), playerId, attr);
  }

  // -------- Chat --------

  const insertChat = db.prepare(
    `INSERT INTO chat_messages (channel, author_nick, team_tag, text, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const findChat = db.prepare(`SELECT * FROM chat_messages WHERE id = ?`);
  const chatByChannel = db.prepare(
    `SELECT * FROM chat_messages WHERE channel = ? ORDER BY id DESC LIMIT ?`,
  );
  const trimChat = db.prepare(
    `DELETE FROM chat_messages WHERE id NOT IN (
       SELECT id FROM chat_messages WHERE channel = ? ORDER BY id DESC LIMIT 200
     ) AND channel = ?`,
  );

  interface ChatRow {
    id: number;
    channel: string;
    author_nick: string;
    team_tag: string | null;
    text: string;
    created_at: number;
  }

  function rowToChat(row: ChatRow) {
    return {
      id: row.id,
      channel: row.channel,
      from: row.author_nick,
      teamTag: row.team_tag ?? undefined,
      text: row.text,
      at: row.created_at,
    };
  }

  function appendChatMessage(channel: string, nick: string, tag: string | undefined, text: string) {
    const at = Date.now();
    const info = insertChat.run(channel, nick, tag ?? null, text, at);
    // Keep each channel capped at 200 messages — cheap delete on insert.
    trimChat.run(channel, channel);
    const id = info.lastInsertRowid as number;
    const row = findChat.get(id) as ChatRow;
    return rowToChat(row);
  }

  function loadChatHistory(channel: string, limit = 100) {
    const rows = chatByChannel.all(channel, limit) as ChatRow[];
    return rows.map(rowToChat).reverse(); // chronological asc for client display
  }

  // -------- Tournaments --------

  interface TournamentRow {
    id: string;
    name: string;
    size: number;
    entry_fee: number;
    prize_pool: number;
    status: string;
    bracket_json: string;
    prizes_json: string | null;
    created_at: number;
  }

  const insertTournament = db.prepare(
    `INSERT INTO tournaments (id, name, size, entry_fee, prize_pool, status, bracket_json, created_at)
     VALUES (?, ?, ?, ?, 0, 'open', '[]', ?)`,
  );
  const findTournament = db.prepare(`SELECT * FROM tournaments WHERE id = ?`);
  const allTournaments = db.prepare(
    `SELECT * FROM tournaments ORDER BY created_at DESC LIMIT 30`,
  );
  const updateTournament = db.prepare(
    `UPDATE tournaments SET status = ?, prize_pool = ?, bracket_json = ?, prizes_json = ? WHERE id = ?`,
  );

  const insertRegistration = db.prepare(
    `INSERT INTO tournament_registrations (tournament_id, team_id, seed) VALUES (?, ?, ?)`,
  );
  const findRegistrations = db.prepare(
    `SELECT team_id, seed FROM tournament_registrations WHERE tournament_id = ? ORDER BY seed ASC`,
  );
  const countRegistrations = db.prepare(
    `SELECT COUNT(*) AS n FROM tournament_registrations WHERE tournament_id = ?`,
  );
  const isRegistered = db.prepare(
    `SELECT 1 FROM tournament_registrations WHERE tournament_id = ? AND team_id = ?`,
  );

  function createTournamentRow(
    id: string,
    name: string,
    size: number,
    entryFee: number,
  ): void {
    insertTournament.run(id, name, size, entryFee, Date.now());
  }

  function loadTournament(id: string): TournamentRow | null {
    const row = findTournament.get(id) as TournamentRow | undefined;
    return row ?? null;
  }

  function loadAllTournaments(): TournamentRow[] {
    return allTournaments.all() as TournamentRow[];
  }

  function saveTournament(args: {
    id: string;
    status: string;
    prizePool: number;
    bracketJson: string;
    prizesJson: string | null;
  }): void {
    updateTournament.run(args.status, args.prizePool, args.bracketJson, args.prizesJson, args.id);
  }

  function registerTeam(tournamentId: string, teamId: string, seed: number): void {
    insertRegistration.run(tournamentId, teamId, seed);
  }

  function loadRegistrations(tournamentId: string): { teamId: string; seed: number }[] {
    const rows = findRegistrations.all(tournamentId) as { team_id: string; seed: number }[];
    return rows.map((r) => ({ teamId: r.team_id, seed: r.seed }));
  }

  function countTournamentRegistrations(tournamentId: string): number {
    return (countRegistrations.get(tournamentId) as { n: number }).n;
  }

  function teamIsRegistered(tournamentId: string, teamId: string): boolean {
    return !!isRegistered.get(tournamentId, teamId);
  }

  // -------- Meta / canary store --------

  const getMetaStmt = db.prepare(`SELECT value FROM meta_kv WHERE key = ?`);
  const setMetaStmt = db.prepare(`INSERT INTO meta_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  function getMeta(key: string): string | null {
    const r = getMetaStmt.get(key) as { value: string } | undefined;
    return r ? r.value : null;
  }
  function setMeta(key: string, value: string): void {
    setMetaStmt.run(key, value);
  }

  // -------- Public team-page comments --------

  const insertTeamComment = db.prepare(
    `INSERT INTO team_comments (team_id, author_nick, text, posted_at, ip) VALUES (?, ?, ?, ?, ?)`,
  );
  const selectTeamComments = db.prepare(
    `SELECT id, author_nick AS authorNick, text, posted_at AS postedAt FROM team_comments WHERE team_id = ? ORDER BY posted_at DESC LIMIT ?`,
  );
  const countRecentIpComments = db.prepare(
    `SELECT COUNT(*) AS n FROM team_comments WHERE ip = ? AND posted_at > ?`,
  );
  const deleteOldTeamComments = db.prepare(
    `DELETE FROM team_comments WHERE team_id = ? AND id NOT IN (SELECT id FROM team_comments WHERE team_id = ? ORDER BY posted_at DESC LIMIT ?)`,
  );
  interface TeamCommentRow { id: number; authorNick: string; text: string; postedAt: number }
  function addTeamComment(args: { teamId: string; authorNick: string; text: string; ip: string }): void {
    insertTeamComment.run(args.teamId, args.authorNick, args.text, Date.now(), args.ip);
  }
  function loadTeamComments(teamId: string, limit = 50): TeamCommentRow[] {
    return selectTeamComments.all(teamId, limit) as TeamCommentRow[];
  }
  function countIpCommentsSince(ip: string, since: number): number {
    return (countRecentIpComments.get(ip, since) as { n: number }).n;
  }
  /** Trim a team's comment thread to the most recent `keep` entries —
   *  prevents the wall growing without bound. Called opportunistically
   *  after every successful post. */
  function trimTeamComments(teamId: string, keep: number): void {
    deleteOldTeamComments.run(teamId, teamId, keep);
  }

  return {
    raw: db,
    authenticateOrRegister,
    // Admin (handlers gate by env-var nick before calling these):
    listAllOwners,
    resetOwnerPin,
    deleteTeamCascade,
    adminEditTeamField,
    adminSetTeamMoney,
    // Daily bonus + cases:
    getDailyClaimDate,
    markDailyClaim,
    getFreeCaseDate,
    markFreeCaseClaim,
    getDuelStats,
    recordDuelUsed,
    recordDuelRefill,
    recordCaseOpened,
    recordStreamDone,
    recordTournamentWin,
    getLoginStreak,
    getLastStreakDate,
    setLoginStreak,
    getAllDoneBonusDate,
    markAllDoneBonusPaid,
    insertDailyQuest,
    loadDailyQuests,
    loadDailyQuest,
    bumpDailyQuestProgress,
    claimDailyQuest,
    createAiCard,
    setAiCardStatus,
    resolveAiCard,
    loadAiCard,
    loadVisibleAiCards,
    loadDueAiCards,
    loadStaleAiCardIds,
    deleteAiCardById,
    countOpenAiCards,
    placeAiBet,
    loadAiBet,
    loadAllAiBetsForCard,
    settleAiBetRow,
    recordAiBetHistory,
    loadAiBetHistory,
    trimAiBetHistoryForTeam,
    // Real estate — lots
    createLot,
    loadLot,
    loadLotByCoord,
    loadLotsInBox,
    loadLotsForOwner,
    setLotApartmentTier,
    setLotVault,
    setLotInterestAt,
    loadAllLots,
    // Real estate — auctions
    createLotAuction,
    loadAuction,
    loadOpenAuctionAtCoord,
    loadAllOpenAuctions,
    loadDueLotAuctions,
    updateLotAuctionBid,
    closeLotAuction,
    voidLotAuction,
    // Real estate — bids
    recordLotBid,
    loadLotBids,
    loadUnrefundedBidsForBidder,
    markLotBidRefunded,
    // Real estate — cars
    addLotCar,
    loadLotCars,
    loadLotCar,
    removeLotCar,
    countLotCarsFor,
    // Real estate — luxuries
    addLotLuxury,
    loadLotLuxuries,
    loadLotLuxury,
    removeLotLuxury,
    countLotLuxuriesFor,
    // Real estate — residents
    addLotResident,
    loadLotResidents,
    removeLotResident,
    countLotResidentsFor,
    residencyOf,
    applyMmrChange,
    loadMmrLeaderboard,
    getAutoTickAnchor,
    setAutoTickAnchor,
    getLastMassageDay,
    setLastMassageDay,
    getMoraleGamePlays,
    recordMoraleGamePlay,
    addSkin,
    loadSkins,
    loadSkin,
    removeSkin,
    updateSkin,
    transferSkin,
    allocateSkinSerial,
    createSkinListing,
    loadSkinListing,
    loadAllSkinListings,
    removeSkinListing,
    removeListingForSkin,
    hasOpenListingForSkin,
    addBoost,
    loadBoosts,
    loadBoost,
    removeBoost,
    createTeam,
    loadTeam,
    loadTeamByTag,
    loadTeamByWalletId,
    assignTeamWalletId,
    backfillWalletIds,
    setTeamPlayers,
    setTeamMoneyDay,
    setTeamTactics,
    updateTeamProfile,
    unlockAchievement,
    loadUnpaidAchievements,
    markAchievementRewardPaid,
    loadAchievements,
    savePlayer,
    persistPlayer,
    loadPlayer,
    loadTeamPlayers,
    loadAllPlayerKeys,
    loadMatchmakingPool,
    issueSession,
    resolveSession,
    createListing,
    removeListing,
    loadListing,
    loadListingByPlayer,
    loadAllListings,
    loadFreeAgents,
    countFreeAgents,
    createChallenge,
    loadChallenge,
    removeChallenge,
    loadOpenChallenges,
    loadChallengesByTeam,
    recordMatch,
    loadMatch,
    loadMatchesForTeam,
    currentSeason,
    recordSeasonOutcome,
    loadLeaderboard,
    loadTeamStandings,
    loadPvpLeaderboard,
    loadPvpStandingsForTeam,
    createTournamentRow,
    loadTournament,
    loadAllTournaments,
    saveTournament,
    registerTeam,
    loadRegistrations,
    countTournamentRegistrations,
    teamIsRegistered,
    getMeta,
    setMeta,
    addTeamComment,
    loadTeamComments,
    countIpCommentsSince,
    trimTeamComments,
    appendChatMessage,
    loadChatHistory,
    setGoal,
    clearGoal,
    loadGoalsForTeam,
    loadAllOpenGoals,
    flagGoalReached,
    savePreset,
    loadPresetsForOwner,
    loadPreset,
    removePreset,
    publishNews,
    loadRecentNews,
    createLoanOffer,
    loadLoan,
    loadLoansFromTeam,
    loadLoansToTeam,
    loadOpenLoanForPlayer,
    loadDueLoans,
    setLoanStatus,
    inductIntoHoF,
    loadTeamCareerRecord,
    backfillHallOfFameRecords,
    loadHallOfFame,
    loadHoFEntry,
    addCoachToPool,
    loadOpenCoaches,
    loadCoach,
    loadHiredCoachFor,
    hireCoach,
    countOpenCoaches,
    createSponsorOffer,
    loadSponsor,
    loadSponsorsForTeam,
    setSponsorStatus,
    markSponsorActive,
    markSponsorClaimed,
    backfillLegacySponsors,
  };
}

export type DB = ReturnType<typeof openDb>;
