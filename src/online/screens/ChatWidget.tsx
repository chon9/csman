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
      return {
        m,
        groupStart: !sameAsPrev,
        groupEnd: !sameAsNext,
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
        ) : grouped.map(({ m, groupStart, groupEnd }) => {
          const mine = m.from.toLowerCase() === myNick.toLowerCase();
          return (
            <div
              key={m.id}
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
                <div className="chat-time">{formatTime(m.at)}</div>
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
