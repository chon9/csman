// Tiny HTTP route table for the same port the WebSocket server uses.
// Right now it serves one route — GET /team/:id renders a public team
// profile page anyone can share. Kept dead-simple (string-templated HTML,
// no framework) because Phase 7's only HTTP need is sharing a team URL.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DB } from './db.ts';
import type { MatchResult } from '../../src/types.ts';

const HEAD = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>CS2 Manager — Team Profile</title>
  <style>
    body { font-family: -apple-system, Segoe UI, Inter, sans-serif; background: #14171c; color: #d8dce4; margin: 0; padding: 24px; }
    .wrap { max-width: 720px; margin: 0 auto; }
    .head { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
    .logo { width: 72px; height: 72px; border-radius: 8px; background: #1d2129; border: 1px solid #2a2f3a;
            display: flex; align-items: center; justify-content: center; font-weight: 800; color: #de9b35; font-size: 22px; letter-spacing: 1px; }
    .tag { color: #de9b35; font-size: 28px; font-weight: 800; letter-spacing: 0.5px; }
    .name { font-size: 18px; color: #d8dce4; margin-top: 2px; }
    .meta { color: #8b93a3; font-size: 13px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #2a2f3a; font-size: 13px; }
    th { color: #8b93a3; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .footer { margin-top: 20px; color: #5d6678; font-size: 12px; text-align: center; }
    a { color: #de9b35; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">`;

const FOOT = `
    <div class="footer">CS2 Manager · public team profile</div>
  </div>
</body>
</html>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderTeamPage(db: DB, teamId: string): { status: number; body: string; contentType: string } {
  const team = db.loadTeam(teamId);
  if (!team) {
    return {
      status: 404,
      body: HEAD + `<h1 style="color:#e25555">Team not found</h1><p>No team with id <code>${escapeHtml(teamId)}</code>.</p>` + FOOT,
      contentType: 'text/html; charset=utf-8',
    };
  }
  const players = db.loadTeamPlayers(team.id);
  const accent = team.primaryColor && /^#[0-9a-fA-F]{6}$/.test(team.primaryColor) ? team.primaryColor : '#de9b35';
  const logo = `<div class="logo" style="color:${accent}">${escapeHtml(team.tag.slice(0, 3))}</div>`;
  const playerRows = players.map((p) => `
    <tr>
      <td><strong>${escapeHtml(p.nickname)}</strong> <span style="color:#8b93a3">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</span></td>
      <td>${escapeHtml(p.role)}</td>
      <td>${escapeHtml(p.nationality)}</td>
      <td class="num">${p.age}</td>
      <td class="num">${p.currentAbility}</td>
      <td class="num">${p.potentialAbility}</td>
    </tr>`).join('');

  // Achievements: render each as a badge chip.
  const ach = db.loadAchievements(team.id);
  const achBlock = ach.length === 0 ? '' : `
    <h2 style="margin-top:24px;color:#d8dce4">Achievements</h2>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${ach.map((a) => `<span style="background:#1d2129;border:1px solid #2a2f3a;border-left:3px solid ${accent};border-radius:4px;padding:4px 10px;font-size:12.5px">${escapeHtml(a.kind)}</span>`).join('')}
    </div>`;

  // Bio + socials.
  const bioBlock = team.bio ? `<p style="margin-top:14px;color:#d8dce4;line-height:1.5">${escapeHtml(team.bio)}</p>` : '';
  const socials: string[] = [];
  if (team.twitchUrl) socials.push(`<a href="${escapeHtml(team.twitchUrl)}" target="_blank" rel="noopener">Twitch</a>`);
  if (team.twitterUrl) socials.push(`<a href="${escapeHtml(team.twitterUrl)}" target="_blank" rel="noopener">Twitter</a>`);
  if (team.youtubeUrl) socials.push(`<a href="${escapeHtml(team.youtubeUrl)}" target="_blank" rel="noopener">YouTube</a>`);
  const socialBlock = socials.length === 0 ? '' : `<div style="margin-top:8px">${socials.join(' · ')}</div>`;

  const body =
    HEAD +
    `<div class="head">
      ${logo}
      <div>
        <div class="tag" style="color:${accent}">${escapeHtml(team.tag)}</div>
        <div class="name">${escapeHtml(team.name)}</div>
        <div class="meta">${escapeHtml(team.region)} · owner ${escapeHtml(team.ownerNick)} · day ${team.day}</div>
        ${socialBlock}
      </div>
    </div>
    ${bioBlock}
    ${achBlock}
    <h2 style="margin-top:24px;color:#d8dce4">Roster</h2>
    <table>
      <thead><tr><th>Player</th><th>Role</th><th>Nat</th><th class="num">Age</th><th class="num">CA</th><th class="num">PA</th></tr></thead>
      <tbody>${playerRows}</tbody>
    </table>` +
    FOOT;
  return { status: 200, body, contentType: 'text/html; charset=utf-8' };
}

/**
 * Render a stored match as a public HTML page. Match history rows are
 * stripped of frames + kills, so what we have to work with is the
 * scoreboard + the per-round winner/reason flags. That's enough to
 * communicate the result; the actual replay needs the live in-memory
 * cache and falls outside this public-URL surface.
 */
function renderReplayPage(db: DB, matchId: string): { status: number; body: string; contentType: string } {
  const row = db.loadMatch(matchId);
  if (!row) {
    return {
      status: 404,
      body: HEAD + `<h1 style="color:#e25555">Match not found</h1><p>No stored match with id <code>${escapeHtml(matchId)}</code>.</p>` + FOOT,
      contentType: 'text/html; charset=utf-8',
    };
  }
  let result: MatchResult;
  try { result = JSON.parse(row.result_json); }
  catch {
    return {
      status: 500,
      body: HEAD + `<h1 style="color:#e25555">Match data corrupted</h1>` + FOOT,
      contentType: 'text/html; charset=utf-8',
    };
  }
  const playedAt = new Date(row.played_at).toUTCString().slice(0, 22);

  const mapsHtml = result.maps.map((m, i) => {
    const rows = Object.values(m.playerStats)
      .sort((a, b) => b.rating - a.rating)
      .map((s) => `
        <tr>
          <td>${escapeHtml(s.playerId)}</td>
          <td class="num">${s.kills}</td>
          <td class="num">${s.deaths}</td>
          <td class="num">${s.assists}</td>
          <td class="num"><strong style="color:${s.rating >= 1.1 ? '#6ed09a' : s.rating < 0.9 ? '#e25555' : '#d8dce4'}">${s.rating.toFixed(2)}</strong></td>
        </tr>`).join('');
    // Round-by-round dots (W/L from team A's perspective).
    const dots = m.rounds.map((r) => {
      const aWon = r.winnerTeamId === result.teamAId;
      return `<span style="display:inline-block;width:14px;height:14px;border-radius:2px;margin-right:2px;background:${aWon ? 'rgba(76,175,125,0.45)' : 'rgba(226,85,85,0.4)'};"></span>`;
    }).join('');
    return `
      <h2 style="margin-top:24px;color:#d8dce4">Map ${i + 1}: ${escapeHtml(m.map)} — ${m.scoreA}:${m.scoreB}</h2>
      <div style="margin:8px 0">${dots}</div>
      <table>
        <thead><tr><th>Player</th><th class="num">K</th><th class="num">D</th><th class="num">A</th><th class="num">Rtg</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  const winnerSide = row.winner_id === row.team_a_id ? row.team_a_tag : row.team_b_tag;
  const body = HEAD + `
    <div class="head">
      <div class="logo">${escapeHtml(row.team_a_tag.slice(0, 3))}</div>
      <div>
        <div class="tag">${escapeHtml(row.team_a_tag)} ${row.maps_a} — ${row.maps_b} ${escapeHtml(row.team_b_tag)}</div>
        <div class="name">${escapeHtml(winnerSide)} won · ${escapeHtml(row.kind === 'pvp' ? 'PvP' : row.kind === 'ai' ? 'AI duel' : row.kind)} · stake $${row.stake.toLocaleString()}</div>
        <div class="meta">Played ${escapeHtml(playedAt)}</div>
      </div>
    </div>
    ${mapsHtml}` + FOOT;
  return { status: 200, body, contentType: 'text/html; charset=utf-8' };
}

/**
 * Server-wide stats dashboard — shareable URL that surfaces aggregate
 * activity. Cheap queries only; pages over time can be added later.
 */
function renderStatsPage(db: DB): { status: number; body: string; contentType: string } {
  const totals = db.raw.prepare(`SELECT COUNT(*) AS n FROM teams`).get() as { n: number };
  const matches = db.raw.prepare(`SELECT COUNT(*) AS n FROM match_history`).get() as { n: number };
  const topMoney = db.raw.prepare(
    `SELECT tag, name, money FROM teams ORDER BY money DESC LIMIT 10`,
  ).all() as Array<{ tag: string; name: string; money: number }>;
  const topWins = db.raw.prepare(
    `SELECT s.team_id, t.tag, t.name, s.wins, s.losses
       FROM season_standings s INNER JOIN teams t ON t.id = s.team_id
       WHERE s.season_no = (SELECT MAX(season_no) FROM seasons)
       ORDER BY s.wins DESC LIMIT 10`,
  ).all() as Array<{ tag: string; name: string; wins: number; losses: number }>;
  const recentNews = db.raw.prepare(`SELECT kind, body, at FROM news_items ORDER BY id DESC LIMIT 12`)
    .all() as Array<{ kind: string; body: string; at: number }>;

  const moneyRows = topMoney.map((t, i) => `<tr><td>${i + 1}</td><td><strong>${escapeHtml(t.tag)}</strong></td><td>${escapeHtml(t.name)}</td><td class="num">$${t.money.toLocaleString()}</td></tr>`).join('');
  const winRows = topWins.map((t, i) => `<tr><td>${i + 1}</td><td><strong>${escapeHtml(t.tag)}</strong></td><td>${escapeHtml(t.name)}</td><td class="num">${t.wins}-${t.losses}</td></tr>`).join('');
  const newsList = recentNews.map((n) => `<li><span style="color:#8b93a3">${new Date(n.at).toUTCString().slice(0, 22)}</span> · ${escapeHtml(n.body)}</li>`).join('');

  const body = HEAD + `
    <div class="head">
      <div class="logo">CSM</div>
      <div>
        <div class="tag">Server Stats</div>
        <div class="name">${totals.n} teams · ${matches.n} matches recorded</div>
        <div class="meta">Live aggregate snapshot of this server</div>
      </div>
    </div>
    <h2 style="margin-top:24px;color:#d8dce4">Top 10 by Cash</h2>
    <table><thead><tr><th>#</th><th>Tag</th><th>Team</th><th class="num">Money</th></tr></thead><tbody>${moneyRows}</tbody></table>
    <h2 style="margin-top:24px;color:#d8dce4">Top 10 Current-Season Wins</h2>
    <table><thead><tr><th>#</th><th>Tag</th><th>Team</th><th class="num">W-L</th></tr></thead><tbody>${winRows}</tbody></table>
    <h2 style="margin-top:24px;color:#d8dce4">Recent Headlines</h2>
    <ul style="line-height:1.7;color:#d8dce4;font-size:13px;padding-left:18px">${newsList}</ul>
  ` + FOOT;
  return { status: 200, body, contentType: 'text/html; charset=utf-8' };
}

/**
 * Server-wide Hall of Fame — sorted by career rating, then career age.
 * Only retired players appear here.
 */
function renderHallOfFamePage(db: DB): { status: number; body: string; contentType: string } {
  const rows = db.loadHallOfFame(50);
  const list = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(r.nickname)}</strong></td>
      <td>${escapeHtml(r.role)}</td>
      <td>${escapeHtml(r.nationality)}</td>
      <td class="num">${r.peakCA}</td>
      <td class="num">${r.careerWins}-${r.careerLosses}</td>
      <td class="num">${r.lastAge}</td>
      <td>${escapeHtml(r.lastTeamTag ?? '')}</td>
    </tr>`).join('');
  const body = HEAD + `
    <div class="head">
      <div class="logo">HOF</div>
      <div>
        <div class="tag">Hall of Fame</div>
        <div class="name">${rows.length} retired players honoured</div>
        <div class="meta">Sorted by peak CA. Server-wide.</div>
      </div>
    </div>
    <table style="margin-top:14px">
      <thead><tr><th>#</th><th>Player</th><th>Role</th><th>Nat</th><th class="num">Peak CA</th><th class="num">W-L</th><th class="num">Age</th><th>Last team</th></tr></thead>
      <tbody>${list}</tbody>
    </table>` + FOOT;
  return { status: 200, body, contentType: 'text/html; charset=utf-8' };
}

/**
 * HTTP request handler attached to the same Node http.Server that the
 * WebSocket server upgrades from. Returns true if the request was handled
 * (don't call res.end again). For non-matching URLs the caller writes 404.
 */
export function handleHttp(db: DB, req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      'CS2 Manager server is up. WebSocket: connect to this same port.\n' +
      'Team profile URLs: /team/<teamId>\n' +
      'Replay sharing URLs: /replay/<matchId>\n' +
      'Server stats: /stats\n' +
      'Hall of Fame: /hof',
    );
    return true;
  }
  if (req.method === 'GET' && url === '/stats') {
    const rendered = renderStatsPage(db);
    res.writeHead(rendered.status, {
      'content-type': rendered.contentType,
      'cache-control': 'public, max-age=30',
      'access-control-allow-origin': '*',
    });
    res.end(rendered.body);
    return true;
  }
  if (req.method === 'GET' && url === '/hof') {
    const rendered = renderHallOfFamePage(db);
    res.writeHead(rendered.status, {
      'content-type': rendered.contentType,
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
    });
    res.end(rendered.body);
    return true;
  }
  const teamMatch = url.match(/^\/team\/([a-zA-Z0-9-]+)\/?$/);
  if (req.method === 'GET' && teamMatch) {
    const rendered = renderTeamPage(db, teamMatch[1]);
    res.writeHead(rendered.status, {
      'content-type': rendered.contentType,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(rendered.body);
    return true;
  }
  const replayMatch = url.match(/^\/replay\/([a-zA-Z0-9-]+)\/?$/);
  if (req.method === 'GET' && replayMatch) {
    const rendered = renderReplayPage(db, replayMatch[1]);
    res.writeHead(rendered.status, {
      'content-type': rendered.contentType,
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    });
    res.end(rendered.body);
    return true;
  }
  return false;
}
