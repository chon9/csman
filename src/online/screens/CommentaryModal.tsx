// Read-only commentary modal — pops from the Live Feed's "Read Commentary"
// button. Shows every round's commentary in one scrollable pane using the
// same category-colored styling as the replay overlay, so the user can
// skim analyst calls, aces, and fake executes without spinning up the
// full replay screen.

import { useMemo } from 'react';
import { useOnline } from '../onlineStore';
import { classifyCommentary, COMMENTARY_STYLE } from './commentaryStyles';

export default function CommentaryModal(): React.ReactElement | null {
  const panel = useOnline((s) => s.commentaryPanel);
  const close = useOnline((s) => s.closeCommentary);

  const flatLines = useMemo(() => {
    if (!panel) return [];
    // Roll every map's rounds into one list, tagged with map + round for
    // grouping headers. The engine may emit 0 commentary lines on some
    // rounds (all-quiet default-into-execute); we skip those to keep the
    // scroll clean.
    const out: Array<{ mapName: string; roundNo: number; text: string; isFirstOfMap: boolean; isFirstOfRound: boolean }> = [];
    for (const m of panel.result.maps) {
      let firstOfMap = true;
      for (const r of m.rounds) {
        if (!r.commentary || r.commentary.length === 0) continue;
        let firstOfRound = true;
        for (const text of r.commentary) {
          out.push({
            mapName: m.map,
            roundNo: r.roundNo,
            text,
            isFirstOfMap: firstOfMap,
            isFirstOfRound: firstOfRound,
          });
          firstOfMap = false;
          firstOfRound = false;
        }
      }
    }
    return out;
  }, [panel]);

  if (!panel) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={close}
      style={{ zIndex: 200 }}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h3 style={{ margin: 0 }}>
            📝 Commentary · <span style={{ color: 'var(--accent)' }}>{panel.teamATag}</span> vs <span style={{ color: 'var(--accent)' }}>{panel.teamBTag}</span>
          </h3>
          <button className="link-btn" onClick={close}>close ✕</button>
        </div>
        <div
          className="modal-body"
          style={{
            overflowY: 'auto',
            fontSize: 12.5,
            lineHeight: 1.55,
            padding: '8px 4px',
          }}
        >
          {flatLines.length === 0 ? (
            <div className="muted small" style={{ padding: 20, textAlign: 'center' }}>
              No commentary was captured for this match.
            </div>
          ) : (
            flatLines.map((line, i) => {
              const cat = classifyCommentary(line.text);
              const style = COMMENTARY_STYLE[cat];
              return (
                <div key={i}>
                  {line.isFirstOfMap && (
                    <div
                      className="section-title"
                      style={{ margin: '12px 0 6px', color: 'var(--accent-hi)' }}
                    >
                      🗺 {line.mapName}
                    </div>
                  )}
                  {line.isFirstOfRound && !line.isFirstOfMap && (
                    <div
                      className="muted small"
                      style={{ marginTop: 8, marginBottom: 2, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}
                    >
                      Round {line.roundNo}
                    </div>
                  )}
                  {line.isFirstOfRound && line.isFirstOfMap && (
                    <div
                      className="muted small"
                      style={{ marginBottom: 2, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}
                    >
                      Round {line.roundNo}
                    </div>
                  )}
                  <div
                    style={{
                      padding: '3px 8px',
                      marginBottom: 2,
                      color: style.color,
                      fontWeight: style.weight,
                      borderLeft: style.stripe ? `3px solid ${style.stripe}` : '3px solid transparent',
                      background: style.background,
                      borderRadius: style.background ? 3 : undefined,
                    }}
                  >
                    <span style={{ opacity: 0.5, marginRight: 6, fontSize: 10 }}>R{line.roundNo}</span>
                    {line.text}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="modal-foot" style={{ padding: 8, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
