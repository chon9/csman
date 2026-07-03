// Live spectator feed — modern card layout. Each match is a card with
// team logos, big central score, coloured kind ribbon at the top, and
// a full-width Watch button that fetches the frame-bearing replay
// (falls back to a toast if past the 5-min live cache).

import { useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import { TeamTag } from './TeamProfileModal';
import CommentaryModal from './CommentaryModal';

type Filter = 'all' | 'pvp' | 'ai' | 'tournament';

function fmtAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Same deterministic-hue avatar treatment as chat, so the same tag
 *  keeps the same colour across chat + feed. */
function avatarColorFor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, 55%, 62%)`;
}

export default function LiveFeedWidget() {
  const open = useOnline((s) => s.liveFeedOpen);
  const feed = useOnline((s) => s.liveFeed);
  const toggle = useOnline((s) => s.toggleLiveFeed);
  const fetchReplay = useOnline((s) => s.fetchLiveReplay);
  const openCommentary = useOnline((s) => s.openCommentary);
  const pendingCommentary = useOnline((s) => s.pendingCommentaryMatchId);

  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    if (filter === 'all') return feed;
    return feed.filter((e) => e.kind === filter);
  }, [feed, filter]);

  const counts = useMemo(() => ({
    all: feed.length,
    pvp: feed.filter((e) => e.kind === 'pvp').length,
    ai: feed.filter((e) => e.kind === 'ai').length,
    tournament: feed.filter((e) => e.kind === 'tournament').length,
  }), [feed]);

  if (!open) return null;

  return (
    <div className="livefeed-panel" role="dialog" aria-label="Live feed">
      <div className="livefeed-head">
        <strong>📡 Live Feed</strong>
        <span className="muted small" style={{ marginLeft: 6, fontSize: 11 }}>server-wide</span>
        <button className="link-btn" onClick={toggle} aria-label="Close live feed">close ✕</button>
      </div>

      <div className="lf-filter-row">
        {(['all', 'pvp', 'ai', 'tournament'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`lf-filter-pill ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'pvp' ? 'PvP' : f === 'ai' ? 'AI' : 'Cup'} · {counts[f]}
          </button>
        ))}
      </div>

      <div className="livefeed-scroll">
        {visible.length === 0 ? (
          <div className="livefeed-empty">
            <span className="em">📡</span>
            {feed.length === 0
              ? 'No matches yet. Run an AI duel or PvP challenge — it lands here for the whole server.'
              : 'No matches in this filter.'}
          </div>
        ) : visible.map((e) => {
          const kindCls = e.kind === 'tournament' ? 'lf-kind-tournament'
            : e.kind === 'pvp' ? 'lf-kind-pvp'
            : 'lf-kind-ai';
          const kindLabel = e.kind === 'tournament' ? 'CUP'
            : e.kind === 'pvp' ? 'PVP'
            : 'AI';
          const aWon = e.mapsA > e.mapsB;
          const bWon = e.mapsB > e.mapsA;
          return (
            <article key={e.matchId} className="lf-card">
              <div className="lf-card-head">
                <span className={`lf-kind-ribbon ${kindCls}`}>{kindLabel}</span>
                {e.context && <span className="lf-context" title={e.context}>{e.context}</span>}
                <span className="lf-time">{fmtAgo(e.at)}</span>
              </div>

              <div className="lf-score">
                <div className="lf-side">
                  <div
                    className="lf-side-avatar"
                    style={{ background: avatarColorFor(e.teamATag) }}
                    title={e.teamATag}
                  >{e.teamATag.slice(0, 2).toUpperCase()}</div>
                  <div className="lf-side-tag" style={{ color: aWon ? '#6ed09a' : '#a3adc0' }}>
                    <TeamTag teamId={e.teamAId} tag={e.teamATag} accent={aWon ? '#6ed09a' : '#a3adc0'} />
                  </div>
                </div>

                <div className="lf-score-num">
                  <span className={aWon ? 'winner' : 'loser'}>{e.mapsA}</span>
                  <span className="sep">:</span>
                  <span className={bWon ? 'winner' : 'loser'}>{e.mapsB}</span>
                </div>

                <div className="lf-side right">
                  <div
                    className="lf-side-avatar"
                    style={{ background: avatarColorFor(e.teamBTag) }}
                    title={e.teamBTag}
                  >{e.teamBTag.slice(0, 2).toUpperCase()}</div>
                  <div className="lf-side-tag" style={{ color: bWon ? '#6ed09a' : '#a3adc0' }}>
                    {e.teamBId
                      ? <TeamTag teamId={e.teamBId} tag={e.teamBTag} accent={bWon ? '#6ed09a' : '#a3adc0'} />
                      : <span>{e.teamBTag}</span>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="lf-watch"
                  style={{ flex: 1 }}
                  onClick={() => fetchReplay(e.matchId)}
                >
                  ▶ Watch Replay
                </button>
                <button
                  className="lf-watch"
                  style={{ flex: 1, background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text)' }}
                  disabled={pendingCommentary === e.matchId}
                  onClick={() => openCommentary(e.matchId)}
                  title="Read the round-by-round commentary without playing back the replay frames"
                >
                  {pendingCommentary === e.matchId ? 'Loading…' : '📝 Read Commentary'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <CommentaryModal />
    </div>
  );
}
