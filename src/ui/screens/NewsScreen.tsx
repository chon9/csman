import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import type { NewsAuthor, NewsPost } from '../../types';
import { fmtDate } from '../util';

type Filter = 'all' | 'match' | 'transfer' | 'sponsor' | 'rumor' | 'milestone' | 'banter' | 'press-release' | 'injury';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'match', label: 'Matches' },
  { value: 'press-release', label: 'Press' },
  { value: 'injury', label: 'Injuries' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'milestone', label: 'Milestones' },
  { value: 'rumor', label: 'Rumours' },
  { value: 'sponsor', label: 'Sponsors' },
  { value: 'banter', label: 'Banter' },
];

export default function NewsScreen() {
  const game = useGame((s) => s.game)!;
  const [filter, setFilter] = useState<Filter>('all');

  const posts = useMemo(() => {
    // Hide posts dated in the future (e.g. press answers scheduled for tomorrow's papers)
    const visible = (game.news ?? []).filter((p) => p.date <= game.currentDate);
    if (filter === 'all') return visible;
    return visible.filter((p) => p.category === filter);
  }, [game.news, filter, game.currentDate]);

  return (
    <div className="screen">
      <h2 className="screen-title">News Feed</h2>

      <div className="tab-row news-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`tab ${filter === f.value ? 'active' : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="news-feed">
        {posts.length === 0 && (
          <p className="muted small">No posts yet — keep playing, the scene is just warming up.</p>
        )}
        {posts.map((post) => (
          <PostCard key={post.id} post={post} authors={game.newsAuthors ?? {}} />
        ))}
      </div>
    </div>
  );
}

function PostCard({ post, authors }: { post: NewsPost; authors: Record<string, NewsAuthor> }) {
  // Fall back to a synthetic placeholder author if the post's authorId isn't in
  // the directory (e.g., older save loaded before ensureNewsAuthors ran, or a
  // pro-player author that didn't get lazy-created during an older code path).
  // Previously this returned null and silently dropped the post, which is why
  // tabs looked empty in older saves.
  const author: NewsAuthor = authors[post.authorId] ?? {
    id: post.authorId,
    name: post.authorId.startsWith('player-') ? post.authorId.slice(7) :
          post.authorId.startsWith('team-') ? 'Team Account' :
          'Unknown',
    handle: post.authorId,
    kind: post.authorId.startsWith('player-') ? 'pro-player' :
          post.authorId.startsWith('team-') ? 'team-official' :
          post.authorId.startsWith('analyst-') ? 'analyst' :
          post.authorId.startsWith('press-') ? 'press' :
          'fan',
    avatarSeed: post.authorId,
  };
  const [showComments, setShowComments] = useState(false);
  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);

  const initials = author.name.slice(0, 2).toUpperCase();
  const tag = (author.kind === 'press' || author.kind === 'analyst')
    ? 'press'
    : author.kind === 'team-official'
      ? 'official'
      : author.kind === 'pro-player'
        ? 'player'
        : 'fan';

  return (
    <div className={`post-card kind-${tag}`}>
      <div className="post-head">
        <div className={`post-avatar avatar-${tag}`} title={author.name}>
          {initials}
        </div>
        <div className="post-author-meta">
          <div className="post-author-name">
            <strong>{author.name}</strong>
            {author.verified && <span className="post-verified" title="Verified">✓</span>}
            <span className="post-handle muted">@{author.handle}</span>
          </div>
          <div className="post-time muted small">{fmtDate(post.date)}</div>
        </div>
      </div>

      <div className="post-body">{post.text}</div>

      <div className="post-actions">
        <button
          className={`post-action ${liked ? 'active' : ''}`}
          onClick={() => setLiked((v) => !v)}
          title="Like"
        >
          ♥ <span>{(post.likes + (liked ? 1 : 0)).toLocaleString()}</span>
        </button>
        <button
          className={`post-action ${reposted ? 'active' : ''}`}
          onClick={() => setReposted((v) => !v)}
          title="Repost"
        >
          ↻ <span>{(post.reposts + (reposted ? 1 : 0)).toLocaleString()}</span>
        </button>
        <button
          className={`post-action ${showComments ? 'active' : ''}`}
          onClick={() => setShowComments((v) => !v)}
          title="Comments"
        >
          💬 <span>{post.comments.length}</span>
        </button>
      </div>

      {showComments && post.comments.length > 0 && (
        <div className="post-comments">
          {post.comments.map((c, i) => {
            const handle = authors[c.authorId]?.handle ?? c.authorId;
            return (
              <div key={i} className="post-comment">
                <span className="post-comment-author">@{handle}</span>{' '}
                <span>{c.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
