// Personal inbox — the narrative layer.
//
// Renders up to 30 items in reverse-chronological order. Every item shows
// its category chip, title, body, and elapsed time. Interactive items
// (kind='player-message' or 'media') expose the choice buttons; picking
// one fires respond-inbox → server applies effect → server pushes the
// resolved item back with the summary. Once resolved, choices are hidden
// and the summary text replaces them.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import type { InboxChoice, InboxItem, InboxKind } from '../protocol';
import ToastStack from './ToastStack';

const KIND_META: Record<InboxKind, { icon: string; label: string; color: string }> = {
  event:            { icon: '🌍', label: 'Event',           color: '#5aa4e6' },
  'missed-battle':  { icon: '⚔',  label: 'Missed Battle',  color: '#e25555' },
  sponsor:          { icon: '💼', label: 'Sponsor',         color: '#d9b344' },
  'player-message': { icon: '💬', label: 'Player Message',  color: '#78d078' },
  media:            { icon: '📺', label: 'Media',           color: '#c084fc' },
  training:         { icon: '🎯', label: 'Training',        color: '#f2c443' },
  wallet:           { icon: '💸', label: 'E-Wallet',        color: '#6ed09a' },
  bet:              { icon: '🎰', label: 'Bet',             color: '#ff8a00' },
};

type Filter = 'all' | InboxKind;

function fmtAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function InboxScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const items = useOnline((s) => s.inboxItems);
  const unread = useOnline((s) => s.inboxUnread);
  const refresh = useOnline((s) => s.refreshInbox);
  const markRead = useOnline((s) => s.markInboxRead);
  const markAllRead = useOnline((s) => s.markAllInboxRead);
  const respond = useOnline((s) => s.respondInbox);
  const go = useOnline((s) => s.go);

  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((it) => it.kind === filter);
  }, [items, filter]);

  const counts = useMemo(() => {
    const acc: Record<Filter, number> = {
      all: items.length, event: 0, 'missed-battle': 0, sponsor: 0,
      'player-message': 0, media: 0, training: 0, wallet: 0, bet: 0,
    };
    for (const it of items) acc[it.kind]++;
    return acc;
  }, [items]);

  if (!team) return null;

  const filters: Filter[] = ['all', 'event', 'missed-battle', 'sponsor', 'player-message', 'media', 'training', 'wallet', 'bet'];

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="hero-panel">
        <div>
          <h2>📬 Inbox</h2>
          <div className="hero-sub">Last 30 items · events, missed battles, sponsors, player messages, media, training, e-wallet transfers, and bet results</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            disabled={unread === 0}
            onClick={() => markAllRead()}
            title={unread === 0 ? 'Nothing unread' : `Mark ${unread} unread item${unread === 1 ? '' : 's'} as read`}
          >
            ✓ Mark all as read{unread > 0 ? ` (${unread})` : ''}
          </button>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="panel" style={{ padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {filters.map((f) => {
          const meta = f === 'all' ? { icon: '📋', label: 'All', color: 'var(--text)' } : KIND_META[f];
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`btn ${active ? 'btn-accent' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
              <span className="muted small" style={{ marginLeft: 4 }}>{counts[f]}</span>
            </button>
          );
        })}
      </div>

      {/* Items */}
      {filtered.length === 0 ? (
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <div className="muted">No items in this filter.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((it) => (
            <InboxRow
              key={it.id}
              item={it}
              expanded={expanded === it.id}
              onToggle={() => {
                const opening = expanded !== it.id;
                setExpanded(opening ? it.id : null);
                if (opening && !it.readAt) markRead(it.id);
              }}
              onRespond={(choiceId) => respond(it.id, choiceId)}
            />
          ))}
        </div>
      )}

      <ToastStack />
    </div>
  );
}

function InboxRow({
  item, expanded, onToggle, onRespond,
}: {
  item: InboxItem;
  expanded: boolean;
  onToggle: () => void;
  onRespond: (choiceId: string) => void;
}): React.ReactElement {
  const meta = KIND_META[item.kind];
  const unread = !item.readAt;
  const resolved = !!item.resolvedAt;
  const choices = (item.payload.choices as InboxChoice[] | undefined) ?? [];
  const interactive = choices.length > 0 && !resolved;

  return (
    <div
      className="panel"
      onClick={onToggle}
      style={{
        cursor: 'pointer',
        marginBottom: 0,
        borderLeft: `3px solid ${meta.color}`,
        background: unread ? `${meta.color}12` : 'var(--panel)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 16 }}>{meta.icon}</span>
          <span
            className="pill"
            style={{
              background: `${meta.color}22`, borderColor: `${meta.color}55`, color: meta.color,
              padding: '2px 8px', fontSize: 10,
            }}
          >{meta.label.toUpperCase()}</span>
          <strong style={{
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            color: unread ? 'var(--text)' : 'var(--text-dim)',
          }}>{item.title}</strong>
          {unread && (
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: meta.color,
              boxShadow: `0 0 6px ${meta.color}88`,
              flexShrink: 0,
            }} />
          )}
        </div>
        <span className="muted small" style={{ flexShrink: 0 }}>{fmtAgo(item.createdAt)}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, color: 'var(--text-dim)' }}>
            {item.body}
          </div>

          {interactive && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {choices.map((c) => (
                <button
                  key={c.id}
                  className="btn"
                  onClick={() => onRespond(c.id)}
                  style={{ textAlign: 'left', padding: '10px 14px' }}
                >
                  <div style={{ fontWeight: 700 }}>{c.label}</div>
                  {c.hint && <div className="muted small" style={{ marginTop: 2 }}>{c.hint}</div>}
                </button>
              ))}
            </div>
          )}

          {resolved && (
            <div style={{
              marginTop: 10, padding: '8px 12px',
              background: 'var(--bg-elev)', borderRadius: 4,
              borderLeft: `3px solid ${meta.color}`,
              fontSize: 12, color: 'var(--text-dim)',
              fontStyle: 'italic',
            }}>
              ✓ Response recorded {fmtAgo(item.resolvedAt!)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
