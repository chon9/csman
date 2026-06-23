// Live spectator feed — sits below the chat widget. Shows the last 30
// server-wide match results as they resolve. Clicking Watch on any entry
// tries to fetch the live (frame-bearing) replay; if it's past the 5-min
// cache window the user just gets a toast and falls back to History.

import { useOnline } from '../onlineStore';

function fmtAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export default function LiveFeedWidget() {
  const open = useOnline((s) => s.liveFeedOpen);
  const feed = useOnline((s) => s.liveFeed);
  const toggle = useOnline((s) => s.toggleLiveFeed);
  const fetchReplay = useOnline((s) => s.fetchLiveReplay);

  if (!open) {
    return (
      <button className="livefeed-toggle" onClick={toggle} title="Live match feed">
        📡 {feed.length > 0 ? feed.length : ''}
      </button>
    );
  }

  return (
    <div className="livefeed-panel">
      <div className="livefeed-head">
        <strong>Live Feed</strong>
        <span className="muted small" style={{ marginLeft: 8 }}>server-wide</span>
        <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={toggle}>close ✕</button>
      </div>
      <div className="livefeed-scroll">
        {feed.length === 0 ? (
          <div className="muted small" style={{ padding: 10 }}>
            No matches yet. Run an AI duel or accept a PvP challenge — it'll show up here for everyone on the server.
          </div>
        ) : feed.map((e) => {
          const kindCls = e.kind === 'tournament' ? 'kind-tournament' : e.kind === 'pvp' ? 'kind-pvp' : 'kind-ai';
          return (
            <div key={e.matchId} className="livefeed-line">
              <span className={`livefeed-kind ${kindCls}`}>{e.kind.toUpperCase()}</span>
              <span className="livefeed-score">
                <strong>{e.teamATag}</strong> {e.mapsA}-{e.mapsB} <strong>{e.teamBTag}</strong>
              </span>
              {e.context && <span className="muted small">· {e.context}</span>}
              <span className="muted small" style={{ marginLeft: 'auto' }}>{fmtAgo(e.at)}</span>
              <button className="btn btn-tiny" onClick={() => fetchReplay(e.matchId)}>Watch</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
