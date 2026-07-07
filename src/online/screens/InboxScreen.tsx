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
import Icon, { type IconName } from '../../ui/Icon';

// Kind → icon + label + accent colour. Icons come from the shared Icon
// set; colours are drawn from the palette tokens with per-kind hues so
// the eye can sort at a glance without emoji noise.
interface KindMeta { icon: IconName; label: string; color: string }
const KIND_META: Record<InboxKind, KindMeta> = {
  event:            { icon: 'globe',      label: 'Event',          color: '#6ba0f5' },
  'missed-battle':  { icon: 'crosshair',  label: 'Missed Battle',  color: '#f04b6a' },
  sponsor:          { icon: 'briefcase',  label: 'Sponsor',        color: '#d9b344' },
  'player-message': { icon: 'mail',       label: 'Player Message', color: '#4dd4b0' },
  media:            { icon: 'megaphone',  label: 'Media',          color: '#b47ef7' },
  training:         { icon: 'dumbbell',   label: 'Training',       color: '#f2c443' },
  wallet:           { icon: 'wallet',     label: 'E-Wallet',       color: '#4dd4b0' },
  bet:              { icon: 'bet',        label: 'Sportsbook',     color: '#ff8a00' },
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 8,
              background: 'var(--accent-soft)', color: 'var(--accent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--border-accent)',
            }}
          >
            <Icon name="inbox" size={20} />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>Inbox</h2>
            <div className="hero-sub">
              Last 30 items · events, missed battles, sponsors, players, media, training, wallet, sportsbook
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            disabled={unread === 0}
            onClick={() => markAllRead()}
            title={unread === 0 ? 'Nothing unread' : `Mark ${unread} unread item${unread === 1 ? '' : 's'} as read`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="check" size={13} /> Mark all as read{unread > 0 ? ` (${unread})` : ''}
          </button>
          <button
            className="btn"
            onClick={() => go('home')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="chevron-left" size={13} /> Back
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="panel" style={{ padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {filters.map((f) => {
          const isAll = f === 'all';
          const meta = isAll ? null : KIND_META[f];
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`btn ${active ? 'btn-accent' : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11.5,
              }}
            >
              <Icon name={isAll ? 'folder' : meta!.icon} size={13} />
              <span>{isAll ? 'All' : meta!.label}</span>
              <span
                className="muted small"
                style={{
                  marginLeft: 2, fontVariantNumeric: 'tabular-nums',
                  color: active ? '#06121c' : 'var(--muted)',
                  opacity: active ? 0.8 : 1,
                }}
              >{counts[f]}</span>
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

  // Read + collapsed → heavily dimmed strip. Read + expanded → full
  // opacity so the user can re-read the body without visual noise.
  // Unread → high-visibility tint regardless of expanded state.
  const dimmed = !unread && !expanded;

  return (
    <div
      className="panel"
      onClick={onToggle}
      style={{
        cursor: 'pointer',
        marginBottom: 0,
        borderLeft: unread ? `3px solid ${meta.color}` : `2px solid ${meta.color}44`,
        background: unread ? `${meta.color}14` : 'var(--panel)',
        boxShadow: unread ? `0 0 0 1px ${meta.color}33 inset` : 'none',
        opacity: dimmed ? 0.55 : 1,
        transition: 'opacity 140ms ease, background 140ms ease',
        padding: dimmed ? '10px 14px' : '12px 14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span
            style={{
              width: 26, height: 26, borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: unread ? `${meta.color}22` : `${meta.color}12`,
              border: `1px solid ${meta.color}${unread ? '55' : '33'}`,
              color: meta.color,
              flexShrink: 0,
            }}
          >
            <Icon name={meta.icon} size={14} />
          </span>
          <span
            style={{
              background: `${meta.color}${unread ? '22' : '15'}`,
              border: `1px solid ${meta.color}${unread ? '55' : '33'}`,
              color: meta.color,
              padding: '1px 7px',
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              borderRadius: 3,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >{meta.label}</span>
          <strong style={{
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            color: unread ? 'var(--text)' : 'var(--text-dim)',
            fontWeight: unread ? 700 : 500,
            fontSize: unread ? 14 : 13,
            letterSpacing: unread ? '-0.005em' : undefined,
          }}>{item.title}</strong>
          {unread && (
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: meta.color,
              boxShadow: `0 0 6px ${meta.color}, 0 0 12px ${meta.color}66`,
              flexShrink: 0,
            }} />
          )}
        </div>
        <span
          className="muted small"
          style={{ flexShrink: 0, fontWeight: unread ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}
        >
          {fmtAgo(item.createdAt)}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--text-dim)', fontSize: 13 }}>
            {item.body}
          </div>

          {interactive && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
              marginTop: 12, padding: '8px 12px',
              background: 'var(--bg-elev)', borderRadius: 4,
              borderLeft: `2px solid ${meta.color}`,
              fontSize: 12, color: 'var(--text-dim)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Icon name="check" size={13} style={{ color: meta.color }} />
              Response recorded {fmtAgo(item.resolvedAt!)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
