// Auto-scrolling news headline strip. Pinned to the top of the online
// home screen. Server publishes news on FA signings, market sales, big
// PvPs, tournament wins, etc. — clients accumulate them in a ring buffer.

import { useEffect } from 'react';
import { useOnline } from '../onlineStore';

const ICON: Record<string, string> = {
  transfer: '💸',
  duel: '⚔️',
  tournament: '🏆',
  goal: '🎯',
  event: '🌍',
  other: '📰',
};

export default function NewsTicker() {
  const news = useOnline((s) => s.news);
  const fetchNews = useOnline((s) => s.fetchNews);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  if (news.length === 0) return null;
  // Show newest 12 entries; CSS keyframes scroll them right-to-left.
  const recent = news.slice(-12).reverse();
  return (
    <div className="news-ticker">
      <span className="news-ticker-label">LIVE NEWS</span>
      <div className="news-ticker-scroll">
        <div className="news-ticker-track">
          {recent.map((n) => (
            <span key={n.id} className="news-ticker-item">
              <span className="news-ticker-icon">{ICON[n.kind] ?? '📰'}</span>
              {n.body}
            </span>
          ))}
          {/* Duplicate so the scroll wraps seamlessly. */}
          {recent.map((n) => (
            <span key={`dup-${n.id}`} className="news-ticker-item" aria-hidden>
              <span className="news-ticker-icon">{ICON[n.kind] ?? '📰'}</span>
              {n.body}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
