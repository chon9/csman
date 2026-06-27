// HTTP route table for the same port the WebSocket server uses.
//
//   GET  /team/:id              Facebook-style public team profile page
//   POST /team/:id/comment      Post a comment (form-encoded, rate-limited)
//   GET  /replay/:id            Public replay summary
//   GET  /stats                 Server-wide stats dashboard
//   GET  /hof                   Hall of Fame
//   GET  /                      Tiny landing page
//
// Output is hand-rolled HTML (no framework) — Phase 7's HTTP surface is
// share-link-only, no SPA needed. EVERY interpolated value goes through
// escapeHtml(); comment input is also length-capped and IP rate-limited
// to keep XSS / spam off the page.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DB } from './db.ts';
import type { MatchResult } from '../../src/types.ts';
import { ACHIEVEMENT_LABELS } from '../../src/online/protocol.ts';

// ---------------------------------------------------------------------
// Style + escape helpers
// ---------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Whitelisted CSS hex colour. Defaults to brand orange on bad input. */
function safeColor(s: string | undefined | null): string {
  return s && /^#[0-9a-fA-F]{6}$/.test(s) ? s : '#de9b35';
}

/** Whitelisted external URL: only http(s) origins; everything else rejected. */
function safeUrl(s: string | undefined | null): string | null {
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

const PAGE_CSS = `
  :root {
    --bg: #0f1419;
    --panel: #1a1f29;
    --panel-2: #232a37;
    --border: #2a3140;
    --text: #e4e7ee;
    --muted: #8b93a3;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 0; line-height: 1.5; }
  a { color: #4b8eff; text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* FB-style top bar */
  .topbar { background: #14181f; border-bottom: 1px solid var(--border); padding: 10px 20px; display: flex; align-items: center; gap: 14px; }
  .topbar-brand { font-weight: 800; color: #de9b35; letter-spacing: 0.4px; font-size: 16px; }
  .topbar-sub { color: var(--muted); font-size: 13px; }

  /* Page shell */
  .wrap { max-width: 1000px; margin: 0 auto; }

  /* Cover */
  .cover { height: 220px; position: relative; overflow: hidden; }
  .cover::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.55) 100%); }

  /* Identity strip */
  .identity { display: flex; align-items: flex-end; gap: 18px; padding: 0 24px; margin-top: -56px; position: relative; z-index: 2; }
  .logo { width: 120px; height: 120px; border-radius: 14px; background: var(--panel); border: 4px solid var(--bg);
          display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 44px; flex-shrink: 0;
          box-shadow: 0 6px 16px rgba(0,0,0,0.55); }
  .identity-text { flex: 1; padding-bottom: 8px; }
  .identity-tag { font-size: 30px; font-weight: 800; letter-spacing: 0.4px; }
  .identity-name { font-size: 16px; color: #cfd6e1; margin-top: 2px; }
  .identity-meta { color: var(--muted); font-size: 13px; margin-top: 6px; }
  .identity-socials { margin-top: 6px; }
  .identity-socials a { margin-right: 12px; font-size: 13px; }

  /* Two-col layout */
  .grid { display: grid; grid-template-columns: 340px 1fr; gap: 16px; padding: 18px 24px 40px; }
  @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }

  /* Card */
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 14px; }
  .card h2 { margin: 0 0 10px; font-size: 15px; font-weight: 700; color: #cfd6e1; letter-spacing: 0.4px; text-transform: uppercase; }

  /* Stats grid */
  .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .stat { background: var(--panel-2); padding: 10px; border-radius: 6px; }
  .stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
  .stat-value { font-size: 18px; font-weight: 700; margin-top: 2px; color: #fff; }

  /* Achievement chips */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { background: var(--panel-2); border-left: 3px solid; border-radius: 4px; padding: 4px 10px; font-size: 12px; }

  /* Roster grid */
  .roster { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
  .player { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
  .player-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .player-nick { font-weight: 700; font-size: 15px; }
  .player-role { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .player-name { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .player-stats { display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: #cfd6e1; }
  .player-stats strong { color: #fff; }
  .player-traits { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
  .trait-chip { font-size: 10px; padding: 2px 6px; border-radius: 999px; border: 1px solid; }

  /* Comments wall */
  .comment-form textarea, .comment-form input { width: 100%; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 8px 10px; font-size: 13px; font-family: inherit; }
  .comment-form textarea { resize: vertical; min-height: 72px; }
  .comment-form .row { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
  .comment-form input[name="author"] { flex: 1; }
  .comment-form .btn { background: #4b8eff; color: #0a0d12; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px; }
  .comment-form .btn:hover { background: #6aa7ff; }
  .comment-form .hint { color: var(--muted); font-size: 11px; }
  .comment-form .err { color: #e25555; font-size: 12px; margin-bottom: 6px; }

  .comments { display: flex; flex-direction: column; gap: 10px; }
  .comment { background: var(--panel-2); padding: 10px 12px; border-radius: 6px; border-left: 3px solid var(--border); }
  .comment-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .comment-author { color: #cfd6e1; font-weight: 700; }
  .comment-body { font-size: 14px; color: var(--text); white-space: pre-wrap; word-wrap: break-word; }
  .empty { color: var(--muted); font-size: 13px; text-align: center; padding: 16px; }

  .footer { padding: 20px; color: var(--muted); font-size: 12px; text-align: center; border-top: 1px solid var(--border); margin-top: 20px; }
`;

function shellHead(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-brand">CS2 Manager</div>
  <div class="topbar-sub">Public Profile</div>
</div>
<div class="wrap">`;
}

const SHELL_FOOT = `<div class="footer">CS2 Manager · public team page · <a href="/">home</a></div></body></html>`;

// ---------------------------------------------------------------------
// FB-style team profile page
// ---------------------------------------------------------------------

const TRAIT_DESC: Record<string, { label: string; icon: string; positive: boolean }> = {
  mirage_spec:  { label: 'Mirage Spec',  icon: '🌅', positive: true },
  inferno_spec: { label: 'Inferno Spec', icon: '🔥', positive: true },
  dust2_spec:   { label: 'Dust2 Spec',   icon: '🏜', positive: true },
  nuke_spec:    { label: 'Nuke Spec',    icon: '☢', positive: true },
  ancient_spec: { label: 'Ancient Spec', icon: '🗿', positive: true },
  vertigo_spec: { label: 'Vertigo Spec', icon: '🏗', positive: true },
  mirage_weak:  { label: 'Mirage Weak',  icon: '🌅', positive: false },
  nuke_weak:    { label: 'Nuke Weak',    icon: '☢', positive: false },
  ancient_weak: { label: 'Ancient Weak', icon: '🗿', positive: false },
  big_game:     { label: 'Big Game',     icon: '⭐', positive: true },
  stage_fright: { label: 'Stage Fright', icon: '😰', positive: false },
};

function formatRelative(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toUTCString().slice(0, 16);
}

function renderTeamPage(
  db: DB,
  teamId: string,
  opts: { errorText?: string; postedJustNow?: boolean } = {},
): { status: number; body: string; contentType: string } {
  const team = db.loadTeam(teamId);
  if (!team) {
    return {
      status: 404,
      body: shellHead('Team not found')
        + `<div class="card" style="margin:24px"><h2 style="color:#e25555">Team not found</h2><p class="empty">No team with id <code>${escapeHtml(teamId)}</code>.</p></div>`
        + SHELL_FOOT,
      contentType: 'text/html; charset=utf-8',
    };
  }
  const accent = safeColor(team.primaryColor);
  const players = db.loadTeamPlayers(team.id);
  const ach = db.loadAchievements(team.id);
  const comments = db.loadTeamComments(team.id, 50);

  // Cover banner uses the team's accent colour.
  const cover = `<div class="cover" style="background: linear-gradient(135deg, ${accent}, ${accent}88 60%, #1a1f29);"></div>`;

  // Identity strip — logo / tag / name / meta / socials.
  const logoMark = team.logoId
    ? `<div class="logo" style="color:${accent}">${escapeHtml(team.logoId)}</div>`
    : `<div class="logo" style="color:${accent}">${escapeHtml(team.tag.slice(0, 2).toUpperCase())}</div>`;

  const socials: string[] = [];
  const tw = safeUrl(team.twitchUrl); if (tw) socials.push(`<a href="${escapeHtml(tw)}" target="_blank" rel="noopener nofollow">Twitch</a>`);
  const tt = safeUrl(team.twitterUrl); if (tt) socials.push(`<a href="${escapeHtml(tt)}" target="_blank" rel="noopener nofollow">Twitter</a>`);
  const yt = safeUrl(team.youtubeUrl); if (yt) socials.push(`<a href="${escapeHtml(yt)}" target="_blank" rel="noopener nofollow">YouTube</a>`);
  const socialBlock = socials.length === 0 ? '' : `<div class="identity-socials">${socials.join('')}</div>`;

  // Stats (sidebar). Standings is per-season — read the current season.
  const season = db.currentSeason();
  const standings = season ? db.loadTeamStandings(season.seasonNo, team.id) : null;
  const wins = standings?.wins ?? 0;
  const losses = standings?.losses ?? 0;
  const wr = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  const statsCard = `
    <div class="card">
      <h2>Stats</h2>
      <div class="stats">
        <div class="stat"><div class="stat-label">MMR</div><div class="stat-value">${team.mmr}</div></div>
        <div class="stat"><div class="stat-label">Peak</div><div class="stat-value">${team.peakMmr}</div></div>
        <div class="stat"><div class="stat-label">Wins</div><div class="stat-value">${wins}</div></div>
        <div class="stat"><div class="stat-label">Losses</div><div class="stat-value">${losses}</div></div>
        <div class="stat"><div class="stat-label">Win rate</div><div class="stat-value">${wr}%</div></div>
        <div class="stat"><div class="stat-label">Day</div><div class="stat-value">${team.day}</div></div>
      </div>
    </div>`;

  // About / bio.
  const aboutCard = `
    <div class="card">
      <h2>About</h2>
      ${team.bio ? `<p style="margin:0;white-space:pre-wrap">${escapeHtml(team.bio)}</p>` : `<p class="empty" style="padding:0">No bio yet.</p>`}
      <div style="margin-top:10px;font-size:12px;color:var(--muted)">
        Owner <strong style="color:#cfd6e1">${escapeHtml(team.ownerNick)}</strong> · ${escapeHtml(team.region)}
      </div>
    </div>`;

  // Achievements.
  const achCard = ach.length === 0 ? '' : `
    <div class="card">
      <h2>Achievements (${ach.length})</h2>
      <div class="chips">
        ${ach.map((a) => `<span class="chip" style="border-color:${accent}">${escapeHtml(ACHIEVEMENT_LABELS[a.kind] ?? a.kind)}</span>`).join('')}
      </div>
    </div>`;

  // Roster — main column.
  const rosterCards = players.map((p) => {
    const traits = (p.traits ?? []).map((id) => {
      const t = TRAIT_DESC[id];
      if (!t) return '';
      const c = t.positive ? '#6ed09a' : '#e25555';
      return `<span class="trait-chip" style="color:${c};border-color:${c}55;background:${c}1a">${t.icon} ${escapeHtml(t.label)}</span>`;
    }).join('');
    return `
      <div class="player">
        <div class="player-head">
          <div>
            <div class="player-nick">${escapeHtml(p.nickname)}</div>
            <div class="player-name">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)} · ${escapeHtml(p.nationality)}</div>
          </div>
          <div class="player-role">${escapeHtml(p.role)}</div>
        </div>
        <div class="player-stats">
          <span>CA <strong>${p.currentAbility}</strong></span>
          <span>PA <strong>${p.potentialAbility}</strong></span>
          <span>Age <strong>${Math.floor(p.age)}</strong></span>
        </div>
        ${traits ? `<div class="player-traits">${traits}</div>` : ''}
      </div>`;
  }).join('');
  const rosterCard = `
    <div class="card">
      <h2>Roster (${players.length})</h2>
      ${players.length === 0 ? `<p class="empty" style="padding:0">No players signed.</p>` : `<div class="roster">${rosterCards}</div>`}
    </div>`;

  // Comments wall.
  const errBlock = opts.errorText ? `<div class="err">${escapeHtml(opts.errorText)}</div>` : '';
  const postedBlock = opts.postedJustNow ? `<div style="color:#6ed09a;font-size:12px;margin-bottom:6px">Comment posted ✓</div>` : '';
  const commentForm = `
    <form class="comment-form" method="post" action="/team/${encodeURIComponent(team.id)}/comment">
      ${errBlock}
      ${postedBlock}
      <textarea name="text" maxlength="280" required placeholder="Write something..."></textarea>
      <div class="row">
        <input name="author" maxlength="24" required placeholder="Your name" />
        <button class="btn" type="submit">Post</button>
      </div>
      <div class="hint">Comments are public. Max 280 chars · max 24-char name · rate-limited.</div>
    </form>`;
  const commentList = comments.length === 0
    ? `<div class="empty">No comments yet. Be the first.</div>`
    : `<div class="comments">
        ${comments.map((c) => `
          <div class="comment">
            <div class="comment-head">
              <span class="comment-author">${escapeHtml(c.authorNick)}</span>
              <span>${escapeHtml(formatRelative(c.postedAt))}</span>
            </div>
            <div class="comment-body">${escapeHtml(c.text)}</div>
          </div>`).join('')}
       </div>`;
  const commentsCard = `
    <div class="card">
      <h2>Comments (${comments.length})</h2>
      ${commentForm}
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      ${commentList}
    </div>`;

  // Assemble.
  const body =
    shellHead(`${team.tag} · ${team.name}`) +
    cover +
    `<div class="identity">
      ${logoMark}
      <div class="identity-text">
        <div class="identity-tag" style="color:${accent}">${escapeHtml(team.tag)}</div>
        <div class="identity-name">${escapeHtml(team.name)}</div>
        <div class="identity-meta">${escapeHtml(team.region)} · owner ${escapeHtml(team.ownerNick)} · in-game day ${team.day}</div>
        ${socialBlock}
      </div>
    </div>
    <div class="grid">
      <div>${statsCard}${aboutCard}${achCard}</div>
      <div>${rosterCard}${commentsCard}</div>
    </div>` +
    SHELL_FOOT;
  return { status: 200, body, contentType: 'text/html; charset=utf-8' };
}

// ---------------------------------------------------------------------
// Comment POST handler — anonymous, rate-limited, HTML-escaped on render
// ---------------------------------------------------------------------

const COMMENT_RATE_WINDOW_MS = 60_000;
const COMMENT_RATE_MAX = 5;       // max comments per IP per minute
const COMMENT_MAX_TEXT = 280;
const COMMENT_MAX_NICK = 24;
const COMMENT_KEEP_PER_TEAM = 200;

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0]!.trim().slice(0, 64);
  }
  return (req.socket.remoteAddress ?? 'unknown').slice(0, 64);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let len = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      len += c.length;
      if (len > maxBytes) {
        req.destroy();
        reject(new Error('payload-too-large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decodeURIComponent((eq >= 0 ? part.slice(0, eq) : part).replace(/\+/g, ' '));
    const v = decodeURIComponent((eq >= 0 ? part.slice(eq + 1) : '').replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

async function handleCommentPost(db: DB, req: IncomingMessage, res: ServerResponse, teamId: string): Promise<void> {
  // Team must exist (the DELETE CASCADE on the FK would silently drop the
  // row otherwise, but a 404 here gives the spammer a clear no).
  const team = db.loadTeam(teamId);
  if (!team) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Team not found');
    return;
  }

  let body: string;
  try { body = await readBody(req, 4096); }
  catch {
    res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Payload too large');
    return;
  }
  const fields = parseFormBody(body);
  const author = (fields.author ?? '').trim().slice(0, COMMENT_MAX_NICK);
  const text = (fields.text ?? '').trim().slice(0, COMMENT_MAX_TEXT);

  let errorText: string | undefined;
  if (!author) errorText = 'Name is required.';
  else if (!text) errorText = 'Comment is required.';
  else {
    const ip = clientIp(req);
    const recent = db.countIpCommentsSince(ip, Date.now() - COMMENT_RATE_WINDOW_MS);
    if (recent >= COMMENT_RATE_MAX) {
      errorText = `Slow down — max ${COMMENT_RATE_MAX} comments per minute from your IP.`;
    } else {
      db.addTeamComment({ teamId: team.id, authorNick: author, text, ip });
      db.trimTeamComments(team.id, COMMENT_KEEP_PER_TEAM);
      // PRG (post / redirect / get) so a refresh doesn't re-submit.
      res.writeHead(303, { location: `/team/${encodeURIComponent(team.id)}?posted=1` });
      res.end();
      return;
    }
  }
  // Render the page with the error inline so the user keeps context.
  const rendered = renderTeamPage(db, team.id, { errorText });
  res.writeHead(rendered.status, { 'content-type': rendered.contentType, 'cache-control': 'no-store' });
  res.end(rendered.body);
}

// ---------------------------------------------------------------------
// Replay page (unchanged from old impl; styling adopts new shell)
// ---------------------------------------------------------------------

function renderReplayPage(db: DB, matchId: string): { status: number; body: string; contentType: string } {
  const row = db.loadMatch(matchId);
  if (!row) {
    return {
      status: 404,
      body: shellHead('Match not found')
        + `<div class="card" style="margin:24px"><h2 style="color:#e25555">Match not found</h2><p class="empty">No stored match with id <code>${escapeHtml(matchId)}</code>.</p></div>`
        + SHELL_FOOT,
      contentType: 'text/html; charset=utf-8',
    };
  }
  let result: MatchResult;
  try { result = JSON.parse(row.result_json); }
  catch {
    return { status: 500, body: shellHead('Error') + `<div class="card" style="margin:24px"><h2 style="color:#e25555">Match data corrupted</h2></div>` + SHELL_FOOT, contentType: 'text/html; charset=utf-8' };
  }
  const playedAt = new Date(row.played_at).toUTCString().slice(0, 22);
  const mapsHtml = result.maps.map((m, i) => {
    const rows = Object.values(m.playerStats)
      .sort((a, b) => b.rating - a.rating)
      .map((s) => `
        <tr>
          <td>${escapeHtml(s.playerId)}</td>
          <td style="text-align:right">${s.kills}</td>
          <td style="text-align:right">${s.deaths}</td>
          <td style="text-align:right">${s.assists}</td>
          <td style="text-align:right"><strong style="color:${s.rating >= 1.1 ? '#6ed09a' : s.rating < 0.9 ? '#e25555' : '#d8dce4'}">${s.rating.toFixed(2)}</strong></td>
        </tr>`).join('');
    const dots = m.rounds.map((r) => {
      const aWon = r.winnerTeamId === result.teamAId;
      return `<span style="display:inline-block;width:14px;height:14px;border-radius:2px;margin-right:2px;background:${aWon ? 'rgba(76,175,125,0.45)' : 'rgba(226,85,85,0.4)'}"></span>`;
    }).join('');
    return `
      <div class="card">
        <h2>Map ${i + 1}: ${escapeHtml(m.map)} — ${m.scoreA}:${m.scoreB}</h2>
        <div style="margin-bottom:8px">${dots}</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase">
            <th>Player</th><th style="text-align:right">K</th><th style="text-align:right">D</th><th style="text-align:right">A</th><th style="text-align:right">Rtg</th>
          </tr></thead>
          <tbody style="font-size:13px">${rows}</tbody>
        </table>
      </div>`;
  }).join('');
  const winnerSide = row.winner_id === row.team_a_id ? row.team_a_tag : row.team_b_tag;
  const body = shellHead(`Replay ${row.team_a_tag} vs ${row.team_b_tag}`) +
    `<div style="padding:24px">
      <div class="card">
        <h2>${escapeHtml(row.team_a_tag)} ${row.maps_a} — ${row.maps_b} ${escapeHtml(row.team_b_tag)}</h2>
        <div style="color:var(--muted);font-size:13px">${escapeHtml(winnerSide)} won · ${escapeHtml(row.kind === 'pvp' ? 'PvP' : 'AI')} · stake $${row.stake.toLocaleString()} · ${escapeHtml(playedAt)}</div>
      </div>
      ${mapsHtml}
    </div>` + SHELL_FOOT;
  return { status: 200, body, contentType: 'text/html; charset=utf-8' };
}

// ---------------------------------------------------------------------
// Stats + HoF (lightly restyled into new shell)
// ---------------------------------------------------------------------

function renderStatsPage(db: DB): { status: number; body: string; contentType: string } {
  const totals = db.raw.prepare(`SELECT COUNT(*) AS n FROM teams`).get() as { n: number };
  const matches = db.raw.prepare(`SELECT COUNT(*) AS n FROM match_history`).get() as { n: number };
  const topMoney = db.raw.prepare(`SELECT tag, name, money FROM teams ORDER BY money DESC LIMIT 10`).all() as Array<{ tag: string; name: string; money: number }>;
  const topWins = db.raw.prepare(
    `SELECT s.team_id, t.tag, t.name, s.wins, s.losses
       FROM season_standings s INNER JOIN teams t ON t.id = s.team_id
       WHERE s.season_no = (SELECT MAX(season_no) FROM seasons)
       ORDER BY s.wins DESC LIMIT 10`,
  ).all() as Array<{ tag: string; name: string; wins: number; losses: number }>;
  const recentNews = db.raw.prepare(`SELECT kind, body, at FROM news_items ORDER BY id DESC LIMIT 12`)
    .all() as Array<{ kind: string; body: string; at: number }>;

  const tbl = (rows: string) => `<table style="width:100%;border-collapse:collapse"><tbody style="font-size:13px">${rows}</tbody></table>`;
  const moneyRows = topMoney.map((t, i) => `<tr><td>${i + 1}</td><td><a href="/team/${escapeHtml(t.tag)}" style="font-weight:700">${escapeHtml(t.tag)}</a></td><td style="color:var(--muted)">${escapeHtml(t.name)}</td><td style="text-align:right">$${t.money.toLocaleString()}</td></tr>`).join('');
  const winRows = topWins.map((t, i) => `<tr><td>${i + 1}</td><td><strong>${escapeHtml(t.tag)}</strong></td><td style="color:var(--muted)">${escapeHtml(t.name)}</td><td style="text-align:right">${t.wins}-${t.losses}</td></tr>`).join('');
  const newsList = recentNews.map((n) => `<li><span style="color:var(--muted)">${new Date(n.at).toUTCString().slice(0, 22)}</span> · ${escapeHtml(n.body)}</li>`).join('');

  const body = shellHead('Server Stats') +
    `<div style="padding:24px">
      <div class="card">
        <h2>Server Stats</h2>
        <div style="color:var(--muted);font-size:13px">${totals.n} teams · ${matches.n} matches recorded</div>
      </div>
      <div class="card"><h2>Top 10 by Cash</h2>${tbl(moneyRows)}</div>
      <div class="card"><h2>Top 10 Current-Season Wins</h2>${tbl(winRows)}</div>
      <div class="card"><h2>Recent Headlines</h2><ul style="line-height:1.7;font-size:13px;padding-left:18px">${newsList}</ul></div>
    </div>` + SHELL_FOOT;
  return { status: 200, body, contentType: 'text/html; charset=utf-8' };
}

function renderHallOfFamePage(db: DB): { status: number; body: string; contentType: string } {
  const rows = db.loadHallOfFame(50);
  const list = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(r.nickname)}</strong></td>
      <td>${escapeHtml(r.role)}</td>
      <td>${escapeHtml(r.nationality)}</td>
      <td style="text-align:right">${r.peakCA}</td>
      <td style="text-align:right">${r.careerWins}-${r.careerLosses}</td>
      <td style="text-align:right">${r.lastAge}</td>
      <td>${escapeHtml(r.lastTeamTag ?? '')}</td>
    </tr>`).join('');
  const body = shellHead('Hall of Fame') +
    `<div style="padding:24px">
      <div class="card">
        <h2>Hall of Fame</h2>
        <div style="color:var(--muted);font-size:13px">${rows.length} retired players honoured · sorted by peak CA</div>
      </div>
      <div class="card">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase">
            <th>#</th><th>Player</th><th>Role</th><th>Nat</th><th style="text-align:right">Peak CA</th><th style="text-align:right">W-L</th><th style="text-align:right">Age</th><th>Last team</th>
          </tr></thead>
          <tbody style="font-size:13px">${list}</tbody>
        </table>
      </div>
    </div>` + SHELL_FOOT;
  return { status: 200, body, contentType: 'text/html; charset=utf-8' };
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

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
    res.writeHead(rendered.status, { 'content-type': rendered.contentType, 'cache-control': 'public, max-age=30', 'access-control-allow-origin': '*' });
    res.end(rendered.body);
    return true;
  }
  if (req.method === 'GET' && url === '/hof') {
    const rendered = renderHallOfFamePage(db);
    res.writeHead(rendered.status, { 'content-type': rendered.contentType, 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' });
    res.end(rendered.body);
    return true;
  }
  // /team/:id and /team/:id?posted=1 — pull path component before ?.
  const pathOnly = url.split('?')[0] ?? url;
  const teamMatch = pathOnly.match(/^\/team\/([a-zA-Z0-9-]+)\/?$/);
  if (req.method === 'GET' && teamMatch) {
    const teamId = teamMatch[1];
    const posted = url.includes('posted=1');
    const rendered = renderTeamPage(db, teamId, { postedJustNow: posted });
    res.writeHead(rendered.status, { 'content-type': rendered.contentType, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(rendered.body);
    return true;
  }
  // POST /team/:id/comment
  const commentMatch = pathOnly.match(/^\/team\/([a-zA-Z0-9-]+)\/comment\/?$/);
  if (req.method === 'POST' && commentMatch) {
    // Fire and forget — the helper writes the response itself.
    handleCommentPost(db, req, res, commentMatch[1]).catch((err) => {
      console.error('[csm:http] comment post error', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Internal error');
      }
    });
    return true;
  }
  const replayMatch = pathOnly.match(/^\/replay\/([a-zA-Z0-9-]+)\/?$/);
  if (req.method === 'GET' && replayMatch) {
    const rendered = renderReplayPage(db, replayMatch[1]);
    res.writeHead(rendered.status, { 'content-type': rendered.contentType, 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' });
    res.end(rendered.body);
    return true;
  }
  return false;
}
