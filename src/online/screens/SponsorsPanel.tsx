// Sponsor inbox — objective-based. Each sponsor demands N wins to
// unlock a one-shot reward. Pending offers show Accept/Decline; active
// deals show a progress bar + Cancel; ready deals get a big gold
// Claim button.

import { useEffect } from 'react';
import { useOnline } from '../onlineStore';

export default function SponsorsPanel() {
  const sponsors = useOnline((s) => s.sponsors);
  const list = useOnline((s) => s.listSponsors);
  const respond = useOnline((s) => s.respondSponsor);
  const claim = useOnline((s) => s.claimSponsor);
  const cancel = useOnline((s) => s.cancelSponsor);

  useEffect(() => { list(); }, [list]);

  if (sponsors.length === 0) return null;
  const pending = sponsors.filter((s) => s.status === 'pending');
  const active = sponsors.filter((s) => s.status === 'active' || s.status === 'ready');

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title">💼 Sponsors</div>

      {/* ===== Pending offers ===== */}
      {pending.length > 0 && (
        <>
          <div className="muted small" style={{ marginTop: 4 }}>Pending offers — accept to start the objective:</div>
          {pending.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 10, background: 'var(--panel-2)', borderRadius: 6,
                borderLeft: '3px solid var(--accent)', marginTop: 6, gap: 10, flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong>{s.sponsorName}</strong>
                <div className="muted small">
                  Reward <strong style={{ color: '#6ed09a' }}>${s.rewardAmount.toLocaleString()}</strong>{' '}
                  · win <strong style={{ color: '#f2c443' }}>{s.winsRequired}</strong> match{s.winsRequired === 1 ? '' : 'es'} to unlock · one-shot payout
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-tiny btn-accent" onClick={() => respond(s.id, true)}>Accept</button>
                <button className="btn btn-tiny btn-danger" onClick={() => respond(s.id, false)}>Decline</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ===== Active + Ready deals ===== */}
      {active.length > 0 && (
        <>
          <div className="muted small" style={{ marginTop: 10 }}>Active sponsorships:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            {active.map((s) => {
              const isReady = s.status === 'ready' || s.winsProgress >= s.winsRequired;
              const pct = Math.min(100, Math.round((s.winsProgress / Math.max(1, s.winsRequired)) * 100));
              return (
                <div
                  key={s.id}
                  style={{
                    padding: 10, borderRadius: 6,
                    background: isReady
                      ? 'linear-gradient(90deg, rgba(242,196,67,0.20), rgba(242,196,67,0.05))'
                      : 'var(--panel-2)',
                    border: `1px solid ${isReady ? 'rgba(242,196,67,0.55)' : 'rgba(255,255,255,0.06)'}`,
                    borderLeft: `4px solid ${isReady ? '#f2c443' : '#4b8eff'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong>{s.sponsorName}</strong>{' '}
                      {isReady
                        ? <span style={{ color: '#f2c443', fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>· OBJECTIVE COMPLETE</span>
                        : <span className="muted small">· {s.winsRequired - s.winsProgress} win{s.winsRequired - s.winsProgress === 1 ? '' : 's'} to go</span>}
                      <div className="muted small">
                        Reward <strong style={{ color: '#6ed09a' }}>${s.rewardAmount.toLocaleString()}</strong>{' '}
                        · progress <strong>{s.winsProgress}</strong> / {s.winsRequired}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {isReady && (
                        <button
                          className="btn btn-tiny"
                          onClick={() => claim(s.id)}
                          style={{ background: '#f2c443', color: '#0a0d12', border: 'none', fontWeight: 800, padding: '6px 12px' }}
                          title={`Claim $${s.rewardAmount.toLocaleString()}`}
                        >
                          🎁 Claim ${s.rewardAmount.toLocaleString()}
                        </button>
                      )}
                      <button
                        className="btn btn-tiny btn-danger"
                        onClick={() => {
                          if (window.confirm(`Cancel ${s.sponsorName}? Objective progress lost.`)) cancel(s.id);
                        }}
                        title="End the sponsorship (progress lost)"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: isReady ? '#f2c443' : '#4b8eff', transition: 'width 200ms ease-out' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
