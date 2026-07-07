// Confirm modal for incoming Quick Match / accepted-challenge results.
// The passive party (defender / earlier-challenge issuer) shouldn't be
// yanked out of a mini-game into a forced replay — instead we pop this
// modal at the shell level and let them Watch or Skip. Skipping still
// preserves the missed-battle inbox record so the outcome isn't lost.

import { useOnline } from '../onlineStore';

export default function WatchPromptModal(): React.ReactElement | null {
  const prompt = useOnline((s) => s.watchPrompt);
  const accept = useOnline((s) => s.acceptWatchPrompt);
  const decline = useOnline((s) => s.declineWatchPrompt);

  if (!prompt) return null;
  const { outcome, sourceLabel, opponentTag } = prompt;
  const scoreA = outcome.result.mapsA;
  const scoreB = outcome.result.mapsB;
  const won = outcome.moneyDelta >= 0;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="panel"
        style={{
          width: 'min(440px, 92vw)', padding: 24,
          border: `1px solid ${won ? 'rgba(76,175,117,0.5)' : 'rgba(226,85,85,0.5)'}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          {sourceLabel}
        </div>
        <h2 style={{ margin: '4px 0 12px', fontSize: 20 }}>
          {opponentTag} just played a match against you
        </h2>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', borderRadius: 8,
            background: 'var(--bg-elev)', marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 24 }}>{won ? '🏆' : '💀'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Final: {scoreA}-{scoreB}
            </div>
            <div className="muted small">{outcome.summary}</div>
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 16 }}>
          Watch the replay now, or skip — the outcome is already saved to your Inbox either way.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn"
            onClick={decline}
            style={{ flex: 1, padding: '10px 14px' }}
          >
            Skip
          </button>
          <button
            className="btn btn-accent"
            onClick={accept}
            style={{ flex: 1, padding: '10px 14px', fontWeight: 700 }}
          >
            ▶ Watch replay
          </button>
        </div>
      </div>
    </div>
  );
}
