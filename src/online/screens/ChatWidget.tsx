// Floating chat widget. Always available from any online screen via the
// header toggle. Server broadcasts every message to every connected socket,
// so this is a live multiplayer chat shared across the whole server.

import { useEffect, useRef, useState } from 'react';
import { useOnline } from '../onlineStore';
import { dmChannelFor } from '../protocol';

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

  // Build available channels: global is always present; if the user is
  // registered for the currently-viewed tournament, expose its channel too.
  const tournChannel = activeTournament?.iAmIn ? `tourn:${activeTournament.id}` : null;
  const isDmChannel = chatChannel.startsWith('dm:');
  // Resolve the other party of the current DM channel for the header label.
  const dmOtherTeam = isDmChannel && team
    ? (() => {
        const ids = chatChannel.slice(3).split(':').filter((id) => id !== team.id);
        const other = ids[0];
        return directory.find((t) => t.id === other);
      })()
    : null;

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, open]);

  if (!open) {
    return (
      <button className="chat-toggle" onClick={toggle} title="Open chat">
        💬 {messages.length > 0 ? messages.length : ''}
      </button>
    );
  }

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sendChat(text);
    setDraft('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <strong>Chat</strong>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', marginRight: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-tiny ${chatChannel === 'global' ? 'btn-accent' : ''}`}
            onClick={() => setChatChannel('global')}
          >Global</button>
          {tournChannel && (
            <button
              className={`btn btn-tiny ${chatChannel === tournChannel ? 'btn-accent' : ''}`}
              onClick={() => setChatChannel(tournChannel)}
              title={`Private channel for ${activeTournament?.name}`}
            >Tournament</button>
          )}
          {isDmChannel && dmOtherTeam && (
            <button className="btn btn-tiny btn-accent" title={`DM with ${dmOtherTeam.tag}`}>
              DM · {dmOtherTeam.tag}
            </button>
          )}
          <button
            className="btn btn-tiny"
            title="Open a direct message with another team"
            onClick={() => { setDmPickerOpen((b) => !b); if (!dmPickerOpen) listOnlineTeams(); }}
          >DM…</button>
        </div>
        <button className="link-btn" onClick={toggle}>close ✕</button>
      </div>
      {dmPickerOpen && (
        <div className="dm-picker">
          <div className="muted small" style={{ padding: '4px 8px' }}>Pick a team:</div>
          {directory.filter((t) => t.id !== team?.id).length === 0 && (
            <div className="muted small" style={{ padding: 6 }}>No other teams found.</div>
          )}
          {directory.filter((t) => t.id !== team?.id).map((t) => (
            <button
              key={t.id}
              className="dm-picker-row"
              onClick={() => {
                if (!team) return;
                setChatChannel(dmChannelFor(team.id, t.id));
                setDmPickerOpen(false);
              }}
            >
              <span className="team-logo team-logo-sm team-logo-placeholder" style={{ fontSize: 9 }}>{t.tag.slice(0, 2)}</span>
              <strong>{t.tag}</strong> <span className="muted small">{t.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="muted small" style={{ padding: 8 }}>No messages yet — say hi.</div>
        ) : messages.map((m) => {
          const mine = m.from.toLowerCase() === myNick.toLowerCase();
          const time = new Date(m.at);
          return (
            <div key={m.id} className={`chat-line ${mine ? 'chat-mine' : ''}`}>
              <span className="chat-meta">
                {m.teamTag && <span className="chat-tag">{m.teamTag}</span>}
                <strong>{m.from}</strong>
                <span className="muted small" style={{ marginLeft: 4 }}>{time.getHours().toString().padStart(2, '0')}:{time.getMinutes().toString().padStart(2, '0')}</span>
              </span>
              <span className="chat-text">{m.text}</span>
            </div>
          );
        })}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          type="text"
          maxLength={280}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something… (max 280)"
        />
        <button type="submit" className="btn btn-tiny btn-accent" disabled={!draft.trim()}>Send</button>
      </form>
    </div>
  );
}
