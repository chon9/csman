// Floating chat widget — modern IG/DM-style bubbles. Mine on the right
// in a blue-purple gradient, others left with a coloured avatar disc.
// Messages group by consecutive author so long conversations don't
// waste vertical space on repeated names.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from '../onlineStore';
import { dmChannelFor } from '../protocol';

/** Deterministic hue per author nick — keeps avatar colours stable
 *  across sessions without any server state. */
function avatarColorFor(nick: string): string {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 62%)`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** YYYY-MM-DD key for grouping messages by calendar day (local time). */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

/** Human-friendly day label for the divider between message groups —
 *  Today / Yesterday / weekday for the last week, otherwise full date.
 *  Matches the pattern most modern chat apps use (IG, WhatsApp, Slack). */
function formatDayLabel(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((startOf(now) - startOf(d)) / dayMs);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ChatWidget() {
  const open = useOnline((s) => s.chatOpen);
  const messages = useOnline((s) => s.chatHistory);
  const sendChat = useOnline((s) => s.sendChat);
  const toggle = useOnline((s) => s.toggleChat);
  const myNick = useOnline((s) => s.nickname);
  const chatChannel = useOnline((s) => s.chatChannel);
  const setChatChannel = useOnline((s) => s.setChatChannel);
  const activeTournament = useOnline((s) => s.activeTournament);
  const directory = useOnline((s) => s.directory);
  const listOnlineTeams = useOnline((s) => s.listOnlineTeams);
  const team = useOnline((s) => s.team);

  const [draft, setDraft] = useState('');
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tournChannel = activeTournament?.iAmIn ? `tourn:${activeTournament.id}` : null;
  const isDmChannel = chatChannel.startsWith('dm:');
  const dmOtherTeam = isDmChannel && team
    ? (() => {
        const ids = chatChannel.slice(3).split(':').filter((id) => id !== team.id);
        const other = ids[0];
        return directory.find((t) => t.id === other);
      })()
    : null;

  // Group consecutive messages from the same author so the avatar +
  // name header only shows on the first message in a run.
  const grouped = useMemo(() => {
    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const sameAsPrev = !!prev && prev.from === m.from && (m.at - prev.at) < 5 * 60 * 1000;
      const sameAsNext = !!next && next.from === m.from && (next.at - m.at) < 5 * 60 * 1000;
      // Insert a day divider whenever this message falls on a different
      // calendar day than the previous one. First message always gets one.
      const showDayDivider = !prev || dayKey(prev.at) !== dayKey(m.at);
      return {
        m,
        groupStart: !sameAsPrev,
        groupEnd: !sameAsNext,
        showDayDivider,
        dayLabel: showDayDivider ? formatDayLabel(m.at) : '',
      };
    });
  }, [messages]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, open]);

  if (!open) return null;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sendChat(text);
    setDraft('');
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="Chat">
      <div className="chat-head">
        <strong>💬 Chat</strong>
        <button className="link-btn" onClick={toggle} aria-label="Close chat">close ✕</button>
      </div>

      <div className="chat-channels">
        <button
          className={`chat-chan-pill ${chatChannel === 'global' ? 'active' : ''}`}
          onClick={() => setChatChannel('global')}
        >🌐 Global</button>
        {tournChannel && (
          <button
            className={`chat-chan-pill ${chatChannel === tournChannel ? 'active' : ''}`}
            onClick={() => setChatChannel(tournChannel)}
            title={`Private channel for ${activeTournament?.name}`}
          >🏆 Tournament</button>
        )}
        {isDmChannel && dmOtherTeam && (
          <button
            className="chat-chan-pill active"
            title={`DM with ${dmOtherTeam.tag}`}
          >💌 {dmOtherTeam.tag}</button>
        )}
        <button
          className="chat-chan-pill"
          title="Direct message another team"
          onClick={() => { setDmPickerOpen((b) => !b); if (!dmPickerOpen) listOnlineTeams(); }}
        >{dmPickerOpen ? '✕' : '+ DM'}</button>
      </div>

      {dmPickerOpen && (
        <div className="dm-picker">
          {directory.filter((t) => t.id !== team?.id).length === 0 ? (
            <div className="muted small" style={{ padding: 6 }}>No other teams online.</div>
          ) : directory.filter((t) => t.id !== team?.id).map((t) => (
            <button
              key={t.id}
              className="dm-picker-row"
              onClick={() => {
                if (!team) return;
                setChatChannel(dmChannelFor(team.id, t.id));
                setDmPickerOpen(false);
              }}
            >
              <span
                className="chat-avatar"
                style={{ background: avatarColorFor(t.tag), width: 24, height: 24, fontSize: 10 }}
              >{t.tag.slice(0, 2).toUpperCase()}</span>
              <strong>{t.tag}</strong>
              <span className="muted small">{t.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <span className="em">💬</span>
            No messages yet. Say hi!
          </div>
        ) : grouped.map(({ m, groupStart, groupEnd, showDayDivider, dayLabel }) => {
          const mine = m.from.toLowerCase() === myNick.toLowerCase();
          return (
            <div key={m.id}>
              {showDayDivider && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  margin: '10px 8px 6px', color: 'var(--muted)', fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
                }}>
                  <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
                  <span>{dayLabel}</span>
                  <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
                </div>
              )}
              <div
                className={`chat-msg-row ${mine ? 'mine' : ''} ${groupStart ? 'group-start' : ''} ${groupEnd ? 'group-end' : ''}`}
              >
                {/* Avatar only on the LAST message of a group (visual anchor). */}
                <div
                  className={`chat-avatar ${groupEnd ? '' : 'avatar-hidden'}`}
                  style={{ background: avatarColorFor(m.from) }}
                  title={m.from}
                >{m.from.slice(0, 2).toUpperCase()}</div>
                <div className="chat-bubble-col">
                  {groupStart && !mine && (
                    <div className="chat-msg-author">
                      {m.teamTag && <span className="chat-tag">{m.teamTag}</span>}
                      <span>{m.from}</span>
                    </div>
                  )}
                  <div className="chat-bubble">{m.text}</div>
                  <div className="chat-time" title={new Date(m.at).toLocaleString()}>{formatTime(m.at)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <input
          type="text"
          maxLength={280}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message…"
          aria-label="Message"
        />
        <button type="submit" className="chat-send" disabled={!draft.trim()} aria-label="Send">
          ➤
        </button>
      </form>
    </div>
  );
}
