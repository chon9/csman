# CS2 Manager Multiplayer Server

WebSocket + SQLite server that powers the **Play Online** mode in the React
client. Designed to run on a small AWS Lightsail Linux instance behind
`systemd`. One file, one DB, no Docker required.

---

## Quick local test

```bash
cd server
npm install
npm run dev        # listens on ws://localhost:8787
```

Then in another terminal launch the client (`npm run dev` from the project
root) and click **Play Online → Connect** with the default
`ws://localhost:8787`.

---

## Deploying to AWS Lightsail (Ubuntu 22.04 / 24.04)

> **TL;DR**: see [`DEPLOY.md`](../DEPLOY.md) at the repo root for the
> recommended single-domain HTTPS setup via the bundled deploy scripts.
> The sections below describe the lower-level pieces that script wires
> up — useful if you want to deviate.

### 1. Create the instance

* Lightsail → Create instance → **Linux/Unix → Ubuntu 22.04 LTS**
* Smallest plan ($5/mo, 512 MB RAM, 1 vCPU) is enough for Phase 1-2
* Wait until the instance is "Running", note the **public IPv4**

### 2. Open the WebSocket port

Lightsail → your instance → **Networking** → IPv4 Firewall →
**Add rule**:

| Application | Protocol | Port range | Source |
|---|---|---|---|
| Custom | TCP | `8787` | `Anywhere (0.0.0.0/0)` |

(You can pick any port; just keep the client URL in sync.)

### 3. Install Node.js 20 + git on the box

SSH into the instance (Lightsail offers a one-click browser SSH):

```bash
sudo apt update
sudo apt install -y curl git build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
node --version    # should print v20.x
```

`better-sqlite3` ships prebuilt binaries for x64 Linux, so `build-essential`
is only needed as a fallback.

### 4. Clone the repo + install server deps

```bash
git clone https://github.com/<you>/csmanager.git ~/csmanager
cd ~/csmanager/server
npm install
mkdir -p data    # SQLite file goes here
```

### 5. systemd unit (auto-start, auto-restart on crash)

Create `/etc/systemd/system/csm-server.service`:

```ini
[Unit]
Description=CS2 Manager multiplayer server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/csmanager/server
Environment=CSM_PORT=8787
Environment=CSM_BIND=0.0.0.0
Environment=CSM_DB=/home/ubuntu/csmanager/server/data/csm.db
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now csm-server
sudo systemctl status csm-server          # confirm it's running
sudo journalctl -fu csm-server            # live log tail
```

### 6. Connect from the client

In the client's **Connect** screen, enter:

```
ws://<your-lightsail-public-ip>:8787
```

If you want a friendly DNS name, attach a static IP in Lightsail and point
a subdomain (`csm.yourdomain.com`) at it — then connect with
`ws://csm.yourdomain.com:8787`.

### 7. (Optional) Wrap with TLS for `wss://`

If you serve the React client over HTTPS (browsers refuse mixed-content
`ws://` from an `https://` page), front the WebSocket with **Caddy**:

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddy
csm.yourdomain.com {
  reverse_proxy /* localhost:8787
}
```

```bash
sudo systemctl reload caddy
```

Caddy provisions a Let's Encrypt cert automatically. Update the firewall to
open `80` + `443` and close `8787` to the public if you only want TLS
traffic. Clients then use `wss://csm.yourdomain.com`.

---

## Environment variables

| Var | Default | What it does |
|---|---|---|
| `CSM_PORT` | `8787` | TCP port the WebSocket server binds. |
| `CSM_BIND` | `0.0.0.0` | Interface to bind (use `127.0.0.1` if only behind a reverse proxy). |
| `CSM_DB` | `./data/csm.db` | SQLite file path. **Back this up!** |

---

## Backups

The SQLite file at `$CSM_DB` is the whole world state. Simplest backup:

```bash
sqlite3 /home/ubuntu/csmanager/server/data/csm.db ".backup /tmp/csm-$(date +%F).db"
```

Cron daily and ship to S3 / Glacier if you care about it.

---

## Upgrading the server

```bash
cd ~/csmanager
git pull
cd server
npm install
sudo systemctl restart csm-server
```

The DB schema uses `CREATE TABLE IF NOT EXISTS` and is forward-compatible
within Phase 1 — Phase 2+ schema changes will ship a one-shot migration
note here.

---

## Protocol

See [`../src/online/protocol.ts`](../src/online/protocol.ts) — single
source of truth for both server and client. Bump `PROTOCOL_VERSION` if a
breaking change ships.

Current version: **v9** (Phase 9 — player retirements + Hall of Fame, coach hires, sponsor deals, online presence, server stats dashboard).

### Phase 2 message kinds

Client → Server:
- `register-ai-duel { stake, format }` — match a scaled AI opponent
- `time-skip { days }` — pay-per-day fast-forward + weekly training tick
- `list-market` / `list-player` / `unlist-player` / `buy-listed-player` — marketplace

Server → Client:
- `duel-result { outcome }` — match result, money delta, full per-player K/D
- `time-skipped { newDay, daysAdvanced, trainingNotes, cost }`
- `market { listings, players }` / `market-listed` / `market-unlisted` / `market-bought`

### Phase 3 message kinds

Client → Server:
- `post-challenge { stake, format, message? }` — put an open PvP challenge in the lobby
- `cancel-challenge { challengeId }` — pull your own challenge before anyone accepts
- `list-challenges` — fetch open + my challenges
- `accept-challenge { challengeId }` — resolves the duel instantly, money flows both ways
- `list-free-agents` — fetch the shared FA pool snapshot
- `sign-free-agent { playerId, wage }` — pay a 2× monthly signing fee to add to roster
- `list-history` — last 25 duels for your team
- `fetch-match { matchId }` — pull a stored match for the viewer

Server → Client:
- `challenges { open, mine }` — lobby snapshot
- `challenge-posted { challenge }` — your post was accepted into the lobby
- `challenge-cancelled { challengeId }` — yours was cancelled or resolved (pushed to BOTH parties when resolved)
- `free-agents { players, suggestedWageById }`
- `free-agent-signed { player, wage }`
- `history { matches }` — stripped match history rows
- `match-detail { matchId, result }` — full stripped match (no frames) for the viewer

### Push-to-team

`index.ts` now maintains a `teamId → Set<WebSocket>` index so handlers can
push messages to a specific team's connected sockets. Used to notify the
challenger when someone accepts their challenge — both sides see the
`duel-result` simultaneously.

### Phase 4 message kinds

Client → Server:
- `set-tactics { tactics }` — persist sparse Tactics overrides (sliders + playstyles)
- `reorder-lineup { playerIds }` — server validates it's a permutation, persists
- `list-leaderboard` — current weekly season standings + your line

Server → Client:
- `tactics-saved { tactics }` — confirms persistence + echoes the cleaned/clamped values
- `lineup-saved { playerIds }`
- `leaderboard { season, rows, me }` — top 50 + your standings line

### Schema migration

`teams` gained a `tactics_json TEXT NOT NULL DEFAULT '{}'` column and two new
tables `seasons` + `season_standings`. The migration runs unconditionally on
startup via a defensive `ALTER TABLE ADD COLUMN` wrapped in try/catch, so it's
idempotent — restarting against an existing DB just no-ops.

### Scrim mode

`register-ai-duel` with `stake === 0` enters **scrim mode**:
- No money flows in either direction
- Doesn't write to `season_standings` (won't affect your leaderboard line)
- Aftermath (form/morale/fatigue) is halved so practice doesn't grind the squad
- Still writes to `match_history` for review

### Phase 5 message kinds

Client → Server:
- `fetch-live-replay { matchId }` — pull the full frames-bearing result from the 5-min in-memory cache
- `send-chat { text }` — broadcast to all connected sockets
- `fetch-chat-history` — last 100 chat messages
- `list-tournaments` — lobby snapshot
- `create-tournament { size, entryFee }` — open a new bracket (size = 4 or 8)
- `register-tournament { tournamentId }` — pay entry, claim a seed; auto-fires the bracket when full

Server → Client:
- `live-replay { matchId, result }` — full MatchResult with frames
- `live-replay-expired { matchId }` — cache miss (past 5-min TTL)
- `chat-history { messages }` / `chat-message { message }` (broadcast to all)
- `tournaments { list }` / `tournament-detail { tournament }` / `tournament-update { tournament }` (broadcast)

### Live replay cache

[`server/src/liveState.ts`](src/liveState.ts) holds the full frame-bearing
MatchResult for ~5 minutes after each duel resolves. Server-side
match_history rows are still stripped (frames/kills/commentary stripped) so
the persistent DB stays slim — the cache is purely for "watch the
just-finished match" UX. Old matches fall back to the stats-only viewer.

### Public chat

In-memory ring buffer capped at 100 messages. Survives nothing — restarting
the server clears history. `broadcast()` in index.ts pushes each new message
to every socket regardless of team. The client renders a floating chat panel
toggleable from the bottom-right.

### Tournaments

Single-elim 4 or 8 team brackets. Anyone can create or register if they
cover the entry fee. The moment registrations hit `size`, `runReadyTournaments`
flips the status to `in-progress` and simulates every bracket round
synchronously via `simulateMatch`. Each bracket match writes to match_history
+ cacheLiveReplay, so participants can review (and watch replays of) every
round they fought. Prize pool = sum of entry fees, split 60/25/7.5/7.5
across 1st / 2nd / two semi-finalists.

### Growth report (dev arcs)

`time-skipped` server replies now include a `devChanges` array — per-player
CA before/after for every player whose CA actually moved during the skip.
The client auto-opens a Growth Report modal whenever the array is non-empty.

### Phase 6 message kinds

Client → Server:
- `set-player-goal { playerId, attr, target }` — pin a development target (1-20) on one of your players
- `clear-player-goal { playerId, attr }`
- `list-player-goals`
- `set-team-logo { dataUrl }` — upload a data:image URL (max 80 KB) as your team logo

Server → Client:
- `player-goals { goals }` — refreshed on every set/clear/list
- `goal-reached { playerId, nickname, attr, target }` — pushed to your team's sockets when a goal target is crossed
- `team-logo-saved { teamId, dataUrl }` — broadcast so all clients update their team-tag chips
- `live-match-feed { entry }` — broadcast every duel (AI / PvP / tournament round) to all sockets; clients show a Live Feed widget

### Schema additions (Phase 6)

New tables `chat_messages` (channelled) + `player_goals`. Existing `teams`
gains a `logo_data` TEXT column via the idempotent ALTER pattern — running
against a Phase 5 DB is a no-op on the column add.

### Recurring tournaments

`ensureDailyTournament(db)` fires on every `list-tournaments` request. It
no-ops when an open `Daily Open · …` tournament already exists; otherwise
it spawns a fresh 4-team $2.5k entry-fee bracket named for today's UTC
date. Lazy by design — no separate scheduler thread, no missed wakeups.

### Persisted chat with channels

Chat moved from in-memory ring buffer to the `chat_messages` table.
Channels are arbitrary strings — `global` is the default, `tourn:<id>`
gets surfaced as a separate "Tournament" tab when the user is registered
for the currently-viewed bracket. Each channel is independently capped at
200 messages via post-insert trimming.

### Live spectator feed

Every duel resolution — AI duels, PvP duels, and tournament bracket
matches — fires a `live-match-feed` broadcast. Clients accumulate the last
30 entries in a floating widget and offer a "Watch" button per entry
that pulls the cached replay (within the 5-min TTL).

### Player development goals

Server tracks attribute targets in the `player_goals` table. `skipTime`
now snapshots targeted attrs before each weekly tick and surfaces any that
crossed their target via the per-team `goal-reached` push. Cap of 5 open
goals per team enforced server-side.

### Team logos

Owner uploads any image; client converts to data URI via FileReader and
sends `set-team-logo`. Server enforces size (80 KB after base64) and
broadcasts `team-logo-saved` to all sockets, so opponents' rosters and
team-tag chips render with the new logo too.

### Phase 7 message kinds

Client → Server:
- `save-tactics-preset { name }` — snapshot the team's current tactics under a name
- `list-tactics-presets` / `apply-tactics-preset { presetId }` / `delete-tactics-preset { presetId }`
- `fetch-news` — last 50 news ticker items
- `list-online-teams` — directory for the DM picker
- `export-team` — returns a portable JSON blob the client downloads as `.csm.json`
- `import-team { payload }` — create a new team from a previous export (fresh IDs, starting money)

Server → Client:
- `tactics-presets { presets }` — refreshed on every save/delete/list
- `news-history { items }` (on fetch) / `news-item { item }` (broadcast on every transfer / big duel / tournament win)
- `online-teams { teams }`
- `team-export { payload }` — client triggers a Blob download
- `team-imported { team }`

### HTTP layer + public team profile

`server/src/httpRoutes.ts` shares the same Node http.Server the WebSocket
listens on, so one port (default 8787) handles both `ws://` upgrades and
plain HTTP. New routes:

- `GET /` — friendly "server is up" plaintext
- `GET /team/:id` — public HTML profile page anyone can share

The home screen has a 🔗 Profile button that copies that URL to the
clipboard. Behind Caddy (or another HTTPS reverse proxy), the URL becomes
a clean `https://csm.yourdomain.com/team/team-abc123`.

### Tactics presets

Named snapshots of a team's Tactics, owned by the manager's nickname (so
they roam with the owner across teams). Capped at 10 per owner. UI lives
on the existing Tactics screen — quick save + load + delete.

### News ticker

Auto-emitted on:
- Market sale (transfer)
- Free agent signing (transfer)
- PvP duel with stake ≥ $10k (duel)
- Tournament champion (tournament)
- Imported team (other)

Each emit is both stored in `news_items` and broadcast as a `news-item`
message. The client home screen renders a scrolling ticker pinned at the
top with the most recent 12 headlines.

### DM chat

DM channels use the format `dm:<smallerId>:<largerId>` so both sides
resolve to the same channel string. The chat handler now checks
`isDmParticipant` on every send + history fetch — strangers can't read or
write to a DM they aren't a party to. Client adds a **DM…** picker that
populates from the `list-online-teams` directory.

### Cross-server team export / import

Export returns a JSON blob containing the team config + tactics + logo +
every player record. Import on a fresh connection (no team yet)
reconstructs the team with **fresh server-generated IDs** for both the
team and every player, so collisions are impossible. Money is reset to
`STARTING_MONEY` to prevent economy abuse via import laundering.

### Phase 8 message kinds

Client → Server:
- `list-achievements` — list your team's unlocked achievements
- `update-profile { fields }` — sparse update of bio / primary color / social links
- `offer-loan { toTeamId, playerId, fee, days }` — propose a temporary cross-team transfer
- `list-loan-offers` — fetch incoming + outgoing loan offers
- `accept-loan { loanId }` / `decline-loan { loanId }`

Server → Client:
- `achievements { entries }` — refreshed on list-achievements
- `achievement-unlocked { achievement }` — pushed to the team's sockets on every fresh unlock
- `profile-updated { team }` — echoes the team with the new profile fields baked in
- `loan-offers { incoming, outgoing }` — refreshed on list-loan-offers
- `loan-event { loan }` — broadcast to both parties on every loan state change

### Replay sharing route

`GET /replay/:id` renders a public HTML page with the full per-map scoreboard,
veto log, and round-by-round W/L dots for any stored match. **No frames** —
those are only kept in the 5-minute live cache for the in-app frame viewer.
Each history row in the client now has a 🔗 button that opens the public
replay page in a new tab.

### Achievements

10 achievement kinds unlock automatically during normal play
(`ACHIEVEMENT_LABELS` in protocol.ts):

| Kind | Trigger |
|---|---|
| first_blood | Win your first duel |
| ten_wins / fifty_wins | 10 / 50 wins in the current season |
| first_tournament | Win your first tournament |
| first_fa_sign / first_market_sale | First FA signing / market sale |
| first_logo / first_goal_reached | First logo upload / first development goal hit |
| bankroll_100k | Cross +$100,000 net duel earnings |
| underdog_win | Beat an opponent with ≥8 higher avg CA in a PvP |

Unlocks fire a per-team push (`achievement-unlocked`) → client toasts the
badge label, and the chip becomes lit on the home Achievements panel.
Achievements also render on the public `/team/:id` page.

### Team profile customisation

`teams` table gains `bio`, `primary_color`, `twitch_url`, `twitter_url`,
`youtube_url` (all via the idempotent `tryAddColumn` pattern). The home
header has an **Edit Profile** button that opens a modal with text fields
+ a colour picker. Saved values render on the public `/team/:id` page
(bio paragraph, accent-coloured team tag, social link row).

### Themed weekly tournaments

`ensureThemedTournament(db)` runs lazily on every `list-tournaments`
request alongside the daily spawner. Cycles 4 themes by week-of-year:
🔥 Hot Streak (BO3 of 8), 🧊 Sub-130 CA, 💸 Big Money ($10k entry),
🌍 World Tour (BO3 of 8). Themes are cosmetic labels for now —
constraints could be enforced server-side later.

### Player loans (online)

Lender chooses a player + recipient + fee + days (1-21). Recipient gets
the loan offer pushed to their sockets and can accept (fee transfers,
player joins their roster, `ends_at` set) or decline (offer drops). When
`ends_at` passes, the next `refresh-state` call from any client fires
`processDueLoans` which moves the player back to the lender and notifies
both parties via `loan-event`. No scheduler thread — piggybacks on the
existing 8-second client refresh cadence.

### Phase 9 message kinds

Client → Server:
- `list-hof` — server-wide hall of fame top 50 (by peak CA)
- `list-coaches` — open pool + your hired coach
- `hire-coach { coachId }` / `fire-coach`
- `list-sponsors` — pending + active deals for your team
- `respond-sponsor { sponsorId, accept }`

Server → Client:
- `presence { onlineTeams }` — broadcast every 15s + on connect/disconnect
- `hof { entries }`
- `player-retired { playerId, nickname, lastAge }` — pushed when one of your players retires
- `coach-pool { openCoaches, myCoach }`
- `coach-hired { coach }`
- `sponsors { offers, paid }` — offers list + any 30-day payouts that fired this tick

### New HTTP routes

- `GET /stats` — server-wide stats dashboard (total teams, total matches, top 10 by money, top 10 wins, recent news)
- `GET /hof` — Hall of Fame leaderboard (top 50 retired players by peak CA)

### Player retirements

`processRetirements` fires inside `time-skip`. For each player at or above
`RETIREMENT_AGE_THRESHOLD` (32), it rolls an age-curved chance per week
advanced (4% at 32 → 50% at 38+). Retired players are inducted into
`hall_of_fame` and their `teamId` is nulled (record stays in `players`
for history). Pushes a `player-retired` notification to the owning team
and broadcasts a news headline.

### Coach hires

A rotating NPC coach pool is topped up lazily to 10 entries via
`ensureCoachPool`. Skill 4-18, monthly wage scaled by skill. Hire costs
one month wage upfront; subsequent skips charge a prorated wage based on
days advanced. While a coach is hired their `skill` replaces the engine
default in `applyWeeklyTraining` — high-skill coaches noticeably accelerate
attribute growth during time-skip.

### Sponsor deals

`maybeOfferSponsor` runs on every `refresh-state` for teams with ≥3
career wins. ~60% chance per ~3-day cooldown to generate a fresh
`pending` offer (≈$2-8k/mo scaling with career wins). On accept the first
payout fires immediately and subsequent payouts auto-credit every 30
real days during `refresh-state` (`processSponsorPayouts`). No scheduler
thread — piggybacks on the existing 8s client refresh cadence.

### Real-time presence

`socketsByTeam.size` is broadcast as `{ kind: 'presence', onlineTeams }`
on every connect, disconnect, and every 15 seconds. Surfaces as the
"👥 N online" chip in the client header.

### Weekly season rollover

`currentSeason()` is called on every leaderboard query and every duel
resolution. If the current row's `ends_at` is in the past it auto-marks it
finished and inserts the next one — so the cycle continues without an explicit
scheduler. Each season lasts 7 real days from the first request after the
previous one expired.

### Money flow knobs (tune in protocol.ts)

| Constant | Default | Effect |
|---|---|---|
| `STARTING_MONEY` | `$100,000` | Cash on first team creation |
| `MIN_DUEL_STAKE` | `$1,000` | Smallest duel stake |
| `MAX_DUEL_STAKE` | `$50,000` | Largest duel stake |
| `TIME_SKIP_COST_PER_DAY` | `$500` | Per-day fee for fast-forward |
| `MAX_TIME_SKIP_DAYS` | `30` | Hard cap per skip request |
