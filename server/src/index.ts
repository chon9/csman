// CS2 Manager multiplayer server.
//
// Boots a WebSocket server, persists everything to a single SQLite file,
// and routes JSON messages through handlers.ts. Designed to run on a small
// Lightsail Linux box behind systemd. See server/README.md for deploy notes.
//
// Env vars:
//   CSM_PORT       Port to listen on (default 8787)
//   CSM_DB         SQLite file path (default ./data/csm.db)
//   CSM_BIND       Bind interface (default 0.0.0.0 — public)

import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { openDb } from './db.ts';
import { handle, newConnSession, type ConnSession } from './handlers.ts';
import { handleHttp } from './httpRoutes.ts';
import { backfillLegacyContracts, backfillPlayerTraits, backfillRealNameAndHoF, sanitizePlayerAges, seedRealNamePool } from './freeAgents.ts';
import { startBustTicker as startCrashBustTicker } from './crashSessions.ts';
import { cleanupStaleCards, ensureCards, settleDueCards } from './aiBetting.ts';
import { closeDueAuctions as closeDueLotAuctions } from './realEstate.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../src/online/protocol.ts';

const PORT = Number(process.env.CSM_PORT ?? 8787);
const HOST = process.env.CSM_BIND ?? '0.0.0.0';
const DB_PATH = process.env.CSM_DB ?? './data/csm.db';

const db = openDb(DB_PATH);
console.log(`[csm] sqlite ready at ${DB_PATH}`);

// One-time seed of HLTV real-name players into the free-agent pool.
// Idempotent — gated by a canary row, safe to call on every boot.
const seedResult = seedRealNamePool(db);
if (seedResult.added > 0) {
  console.log(`[csm] seeded ${seedResult.added} real-name HLTV players into the FA pool`);
}

// Stamp duelsRemaining onto any signed player whose contract predates the
// duel-cap system. Bench-promoted players otherwise display 'unlimited'
// until they play a match, which looks like a bug to the user.
const backfillResult = backfillLegacyContracts(db);
if (backfillResult.updated > 0) {
  console.log(`[csm] backfilled duelsRemaining on ${backfillResult.updated} legacy contracts`);
}

// Round any player ages that accumulated float garbage from past += 0.02.
const ageCleanup = sanitizePlayerAges(db);
if (ageCleanup.cleaned > 0) {
  console.log(`[csm] sanitized ${ageCleanup.cleaned} player ages with float drift`);
}

// One-shot: roll traits onto every legacy player who didn't have any.
// Canary-gated; subsequent boots no-op.
const traitsBackfill = backfillPlayerTraits(db);
if (traitsBackfill.updated > 0) {
  console.log(`[csm] backfilled traits onto ${traitsBackfill.updated} legacy players`);
}

// One-shot: recompute career W/L for HoF entries inducted with the old
// 0-0 default. Canary-gated; subsequent boots no-op.
const hofBackfill = db.backfillHallOfFameRecords();
if (hofBackfill.updated > 0) {
  console.log(`[csm] recomputed career W/L on ${hofBackfill.updated} HoF rows`);
}

// One-shot: retire any sponsor row created before the objective model.
// Legacy monthly-payout rows can't be migrated cleanly (no wins_required
// stored). Mark them 'declined' so they vanish from the UI; users will
// receive fresh objective-based offers naturally.
const sponsorMigration = db.backfillLegacySponsors();
if (sponsorMigration.updated > 0) {
  console.log(`[csm] retired ${sponsorMigration.updated} legacy sponsor rows (objective model migration)`);
}

// One-shot: flag every HLTV real-name player with isRealName=true,
// un-retire any that got mistakenly retired, and purge them from the
// Hall of Fame (they're evergreen now — never age, never retire).
const realNameMigration = backfillRealNameAndHoF(db);
if (realNameMigration.flagged > 0 || realNameMigration.hofDeleted > 0 || realNameMigration.unretired > 0) {
  console.log(
    `[csm] real-name/HoF backfill: flagged=${realNameMigration.flagged}, ` +
    `un-retired=${realNameMigration.unretired}, HoF rows deleted=${realNameMigration.hofDeleted}`,
  );
}

// Shared http.Server: serves /team/:id HTML profiles + upgrades to WebSocket
// on the same port. Reverse-proxy (Caddy) friendliness — one URL, one cert.
const httpServer = createServer((req, res) => {
  try {
    if (handleHttp(db, req, res)) return;
  } catch (err) {
    console.error('[csm:http] handler error', err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal server error');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
httpServer.listen(PORT, HOST, () => {
  console.log(`[csm] listening on http://${HOST}:${PORT} (ws + http) (protocol v${PROTOCOL_VERSION})`);
});

const wss = new WebSocketServer({ server: httpServer });

// Per-connection session state, and a reverse index from teamId → live
// sockets so PvP results can be pushed to the opponent in real time. A
// single team can have multiple connected tabs, hence the Set.
const connections = new WeakMap<WebSocket, ConnSession>();
const socketsByTeam = new Map<string, Set<WebSocket>>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/** Push a message to every connected socket owned by `teamId`. No-op if
 *  the team isn't currently online — recipients will see persisted state on
 *  their next reconnect. */
function notifyTeam(teamId: string, msg: ServerMessage): void {
  const sockets = socketsByTeam.get(teamId);
  if (!sockets) return;
  for (const ws of sockets) send(ws, msg);
}

/** Push a message to every connected socket regardless of team. Used by
 *  chat broadcasts + tournament-update events that everyone should see. */
function broadcastAll(msg: ServerMessage): void {
  for (const sockets of socketsByTeam.values()) {
    for (const ws of sockets) send(ws, msg);
  }
}

/** Distinct teams currently connected — used by the presence broadcast. */
function onlineTeamCount(): number {
  return socketsByTeam.size;
}

// Periodic presence broadcast — every 15 seconds, push the current online
// team count to all connected clients so the header chip can update live.
setInterval(() => {
  broadcastAll({ kind: 'presence', onlineTeams: onlineTeamCount() });
}, 15_000).unref();

// Crash / Rocket bust ticker. 20 Hz poll over all open Crash sessions —
// the moment any session's live multiplier crosses its secret crashAt,
// the server pushes a bust result to that team's sockets and removes the
// session. Cashout still works while the rocket is alive; once the tick
// removes the session, cashout will see "no session" and reject.
startCrashBustTicker(50, (session) => {
  const team = db.loadTeam(session.teamId);
  if (!team) return;
  console.log(`[csm:crash] autobust ${team.tag} at ${session.crashAt}x (bet $${session.bet} lost)`);
  notifyTeam(session.teamId, {
    kind: 'crash-result',
    result: {
      sessionId: session.sessionId,
      outcome: 'bust',
      multiplier: session.crashAt,
      crashAt: session.crashAt,
      bet: session.bet,
      delta: -session.bet,
      newMoney: team.money,
    },
  });
});

// Real-estate auction ticker. Every 60s, close any lot auctions whose
// anti-snipe countdown has elapsed (4-hour default, reset on each bid).
// Closes are cheap when nothing is due — a single indexed SELECT.
setInterval(() => {
  try { closeDueLotAuctions(db, notifyTeam, broadcastAll, (line) => console.log(`[csm:lot] ${line}`)); }
  catch (err) { console.error('[csm:lot] tick error', err); }
}, 60_000).unref();

// AI vs AI betting market ticker. Every 2 seconds:
//   - Top up the active-card count to AI_BET_ACTIVE_CARDS (broadcast new cards)
//   - Settle any cards whose scheduled kickoff has passed (run sim, pay bets)
//   - Drop resolved cards once their replay window has elapsed
// All three calls are cheap idempotent SQL operations; safe to run frequently.
ensureCards(db, broadcastAll);
setInterval(() => {
  try {
    ensureCards(db, broadcastAll);
    settleDueCards(db, notifyTeam, broadcastAll, (line) => console.log(`[csm:ai-bet] ${line}`));
    cleanupStaleCards(db);
  } catch (err) {
    console.error('[csm:ai-bet] tick error', err);
  }
}, 2_000).unref();

function bindTeamSocket(ws: WebSocket, teamId: string): void {
  let set = socketsByTeam.get(teamId);
  if (!set) { set = new Set(); socketsByTeam.set(teamId, set); }
  set.add(ws);
}

function unbindTeamSocket(ws: WebSocket, teamId: string): void {
  const set = socketsByTeam.get(teamId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) socketsByTeam.delete(teamId);
}

function logFor(conn: ConnSession): (line: string) => void {
  const id = conn.nickname ?? '?';
  return (line) => console.log(`[csm:${id}] ${line}`);
}

wss.on('connection', (ws, req) => {
  const peer = req.socket.remoteAddress ?? 'unknown';
  const conn = newConnSession();
  connections.set(ws, conn);
  console.log(`[csm] connect from ${peer}`);

  ws.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send(ws, { kind: 'error', code: 'bad-json', message: 'Message was not valid JSON.' });
      return;
    }
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { kind?: unknown }).kind !== 'string') {
      send(ws, { kind: 'error', code: 'bad-shape', message: 'Message missing "kind".' });
      return;
    }
    // Snapshot teamId BEFORE the handler so we can detect when an auth or
    // create-team flow newly attaches the connection to a team.
    const teamIdBefore = conn.teamId;
    try {
      const reply = handle(db, conn, parsed as ClientMessage, logFor(conn), notifyTeam, broadcastAll);
      if (reply) send(ws, reply);
    } catch (err) {
      console.error('[csm] handler error', err);
      send(ws, { kind: 'error', code: 'server-error', message: 'Internal server error — check server logs.' });
    }
    // If the handler attached us to a team (hello / create-team), register
    // this socket in the push lookup so we receive opponent notifications.
    if (!teamIdBefore && conn.teamId) {
      bindTeamSocket(ws, conn.teamId);
      broadcastAll({ kind: 'presence', onlineTeams: onlineTeamCount() });
    }
  });

  ws.on('close', () => {
    if (conn.teamId) {
      unbindTeamSocket(ws, conn.teamId);
      broadcastAll({ kind: 'presence', onlineTeams: onlineTeamCount() });
    }
    console.log(`[csm] disconnect ${conn.nickname ?? '?'}`);
  });

  ws.on('error', (err) => {
    console.error('[csm] ws error', err);
  });
});

// Graceful shutdown — let SQLite flush WAL on Ctrl-C / systemd SIGTERM.
function shutdown(signal: string): void {
  console.log(`[csm] ${signal} received, closing...`);
  wss.close(() => {
    httpServer.close(() => {
      db.raw.close();
      console.log('[csm] bye');
      process.exit(0);
    });
  });
  // Force-exit if it stalls.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
