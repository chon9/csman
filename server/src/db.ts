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
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
      FOREIGN KEY (owner_nick) REFERENCES owners(nickname)
    );

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
      monthly_amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'active' | 'declined'
      offered_at INTEGER NOT NULL,
      last_paid_at INTEGER,
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
    `INSERT INTO teams (id, name, tag, region, owner_nick, money, day, created_at, player_ids, tactics_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getTeam = db.prepare(`SELECT * FROM teams WHERE id = ?`);
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
    };
  }

  function createTeam(team: TeamRow): void {
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
    );
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

  function loadTeam(teamId: string): TeamRow | null {
    const row = getTeam.get(teamId) as Record<string, unknown> | undefined;
    return row ? rowToTeam(row) : null;
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
    return rows.map((r) => JSON.parse(r.json) as Player);
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

  // -------- Sponsors --------

  interface SponsorRow {
    id: string;
    team_id: string;
    sponsor_name: string;
    monthly_amount: number;
    status: string;
    offered_at: number;
    last_paid_at: number | null;
  }

  const insertSponsor = db.prepare(
    `INSERT INTO sponsors (id, team_id, sponsor_name, monthly_amount, status, offered_at, last_paid_at)
     VALUES (?, ?, ?, ?, 'pending', ?, NULL)`,
  );
  const findSponsor = db.prepare(`SELECT * FROM sponsors WHERE id = ?`);
  const sponsorsForTeam = db.prepare(`SELECT * FROM sponsors WHERE team_id = ? AND status != 'declined' ORDER BY offered_at DESC`);
  const updateSponsorStatus = db.prepare(`UPDATE sponsors SET status = ? WHERE id = ?`);
  const markSponsorPaid = db.prepare(`UPDATE sponsors SET last_paid_at = ? WHERE id = ?`);
  const dueSponsors = db.prepare(
    `SELECT * FROM sponsors WHERE team_id = ? AND status = 'active' AND (last_paid_at IS NULL OR last_paid_at <= ?)`,
  );

  function rowToSponsor(r: SponsorRow) {
    return {
      id: r.id,
      teamId: r.team_id,
      sponsorName: r.sponsor_name,
      monthlyAmount: r.monthly_amount,
      status: r.status as 'pending' | 'active' | 'declined',
      offeredAt: r.offered_at,
      lastPaidAt: r.last_paid_at ?? undefined,
    };
  }

  function createSponsorOffer(args: { id: string; teamId: string; sponsorName: string; monthlyAmount: number }): void {
    insertSponsor.run(args.id, args.teamId, args.sponsorName, args.monthlyAmount, Date.now());
  }
  function loadSponsor(id: string) { const r = findSponsor.get(id) as SponsorRow | undefined; return r ? rowToSponsor(r) : null; }
  function loadSponsorsForTeam(teamId: string) { return (sponsorsForTeam.all(teamId) as SponsorRow[]).map(rowToSponsor); }
  function setSponsorStatus(id: string, status: 'pending' | 'active' | 'declined') { updateSponsorStatus.run(status, id); }
  function recordSponsorPaid(id: string) { markSponsorPaid.run(Date.now(), id); }
  function loadDueSponsors(teamId: string, cutoff: number) { return (dueSponsors.all(teamId, cutoff) as SponsorRow[]).map(rowToSponsor); }

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
    addBoost,
    loadBoosts,
    loadBoost,
    removeBoost,
    createTeam,
    loadTeam,
    setTeamPlayers,
    setTeamMoneyDay,
    setTeamTactics,
    updateTeamProfile,
    unlockAchievement,
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
    recordSponsorPaid,
    loadDueSponsors,
  };
}

export type DB = ReturnType<typeof openDb>;
