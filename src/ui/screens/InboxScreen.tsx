import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import type { InboxCategory, PressConference } from '../../types';
import { fmtDate, fmtShortDate } from '../util';

const CAT_LABEL: Record<InboxCategory, string> = {
  match: 'Match',
  transfer: 'Transfer',
  finance: 'Finance',
  board: 'Board',
  training: 'Training',
  tournament: 'Tournament',
  scouting: 'Scouting',
};

export default function InboxScreen() {
  const game = useGame((s) => s.game)!;
  const markInboxRead = useGame((s) => s.markInboxRead);
  const markAllRead = useGame((s) => s.markAllRead);
  const answerPress = useGame((s) => s.answerPress);

  const messages = [...game.inbox].reverse();
  const [selectedId, setSelectedId] = useState<string | null>(messages[0]?.id ?? null);
  const selected = messages.find((m) => m.id === selectedId) ?? null;
  // Resolve the press conference referenced by the currently-selected inbox message (if any).
  const linkedPress: PressConference | null = selected?.linkType === 'press' && selected.linkId
    ? (game.pressConferences ?? []).find((c) => c.id === selected.linkId) ?? null
    : null;

  function open(id: string) {
    setSelectedId(id);
    const m = game.inbox.find((x) => x.id === id);
    if (m && !m.read) markInboxRead(id);
  }

  return (
    <div className="screen screen-fill">
      <div className="inbox-head">
        <h2 className="screen-title">Inbox</h2>
        <button className="btn" onClick={() => markAllRead()}>
          Mark All Read
        </button>
      </div>
      <div className="inbox-layout">
        <div className="inbox-list panel">
          {messages.length === 0 && <div className="muted" style={{ padding: 12 }}>No messages.</div>}
          {messages.map((m) => (
            <button
              key={m.id}
              className={`inbox-item ${m.id === selectedId ? 'active' : ''} ${m.read ? '' : 'unread'}`}
              onClick={() => open(m.id)}
            >
              <div className="inbox-item-top">
                <span className={`cat-tag cat-${m.category}`}>{CAT_LABEL[m.category]}</span>
                <span className="muted small">{fmtShortDate(m.date)}</span>
              </div>
              <div className="inbox-item-subject">{m.subject}</div>
            </button>
          ))}
        </div>
        <div className="inbox-reading panel">
          {selected ? (
            <>
              <div className="inbox-read-head">
                <span className={`cat-tag cat-${selected.category}`}>{CAT_LABEL[selected.category]}</span>
                <span className="muted">{fmtDate(selected.date)}</span>
              </div>
              <h3 className="inbox-read-subject">{selected.subject}</h3>
              <div className="inbox-read-body">
                {selected.body.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>

              {/* Inline press answer UI when this message links to a pending conference */}
              {linkedPress && (
                <div style={{ marginTop: 14 }}>
                  {linkedPress.questions.map((q) => (
                    <div key={q.id} className="press-q-block">
                      <p className="press-q">"{q.question}"</p>
                      <div className="press-options">
                        {q.options.map((opt, i) => (
                          <button
                            key={i}
                            className={`press-option tone-${opt.tone}`}
                            onClick={() => answerPress(linkedPress.id, q.id, i)}
                          >
                            <span className="press-tone-pill">{opt.tone}</span>
                            <span className="press-answer">"{opt.answer}"</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selected.linkType === 'press' && !linkedPress && (
                <p className="muted small" style={{ marginTop: 10 }}>
                  This press conference has already been answered.
                </p>
              )}
            </>
          ) : (
            <div className="muted" style={{ padding: 16 }}>
              Select a message to read it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
