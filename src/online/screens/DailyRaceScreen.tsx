// Daily Race — two live leaderboards that reset every UTC midnight:
//   📈 Points Race — MMR gained since 00:00 UTC (drives duel/tourney
//                    performance to matter for cash).
//   💰 Money Race  — gross positive money deltas today (rewards earners
//                    without penalising investment/spending).
// Top 3 on each board share $500k / $250k / $100k at rollover.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import type { DailyRaceEntryWire } from '../protocol';
import ToastStack from './ToastStack';

export default function DailyRaceScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const daily = useOnline((s) => s.dailyRace);
  const refresh = useOnline((s) => s.refreshDailyRace);
  const go = useOnline((s) => s.go);

  useEffect(() => {
    refresh();
    // Refresh every 30s so deltas stay live without a heavy poll.
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="hero-panel">
        <div>
          <h2>🏁 Daily Race</h2>
          <div className="hero-sub">Two boards · resets 00:00 UTC · top 3 win cash on each · no signup, just play</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {daily && <RolloverChip rolloverUtcMs={daily.rolloverUtcMs} />}
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* Payout schedule strip */}
      <div className="panel panel-accent" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }}>
        <span className="section-title" style={{ margin: 0, flex: 'none' }}>Payout schedule</span>
        <span className="pill pill-accent">🥇 $500,000</span>
        <span className="pill">🥈 $250,000</span>
        <span className="pill">🥉 $100,000</span>
        <span className="muted small" style={{ marginLeft: 'auto' }}>Awarded automatically at 00:00 UTC · positive deltas only</span>
      </div>

      {/* The two boards */}
      {!daily ? (
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>Loading race boards…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <Board
            title="📈 Points Race"
            subtitle="MMR gained today"
            rows={daily.pointsBoard}
            myTeamId={team.id}
            myRank={daily.myRank.points}
            unit="MMR"
            accent="#78d078"
          />
          <Board
            title="💰 Money Race"
            subtitle="Gross earned today"
            rows={daily.moneyBoard}
            myTeamId={team.id}
            myRank={daily.myRank.money}
            unit="$"
            accent="#d9b344"
          />
        </div>
      )}

      {/* Recent payouts strip */}
      {daily && daily.recentPayouts.length > 0 && (
        <div className="panel">
          <div className="panel-title">Your recent race wins</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--text-md)' }}>
            {daily.recentPayouts.map((p) => (
              <div key={`${p.dateUtc}-${p.raceKind}-${p.rank}`} style={{
                display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)',
                padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elev)',
                borderLeft: `2px solid ${p.raceKind === 'points' ? '#78d078' : 'var(--accent)'}`,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span className="pill" style={{ minWidth: 90 }}>{p.dateUtc}</span>
                  <span>{p.raceKind === 'points' ? '📈 Points' : '💰 Money'} <span className="muted">#{p.rank}</span></span>
                  <span className="muted small">
                    Δ {p.raceKind === 'points' ? `${p.valueDelta.toLocaleString()} MMR` : `$${p.valueDelta.toLocaleString()}`}
                  </span>
                </span>
                <strong style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>+${p.amount.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastStack />
    </div>
  );
}

// ---------------------------------------------------------------------

function Board({
  title, subtitle, rows, myTeamId, myRank, unit, accent,
}: {
  title: string; subtitle: string;
  rows: DailyRaceEntryWire[]; myTeamId: string; myRank: number | null;
  unit: 'MMR' | '$'; accent: string;
}): React.ReactElement {
  const fmtDelta = (n: number): string => unit === '$' ? `$${n.toLocaleString()}` : `+${n} MMR`;
  const rankColor = (i: number): string =>
    i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.55)';

  return (
    <div className="panel" style={{ borderTop: `3px solid ${accent}`, padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-1)' }}>
        <div className="panel-title" style={{ margin: 0 }}>{title}</div>
        {myRank != null && (
          <span className="pill" style={{
            background: `${accent}22`, borderColor: `${accent}55`, color: accent,
          }}>
            You · #{myRank}
          </span>
        )}
      </div>
      <div className="muted small" style={{ marginBottom: 'var(--space-3)' }}>{subtitle}</div>
      {rows.length === 0 ? (
        <div className="muted small" style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
          No entries yet today — be the first!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.map((r, i) => {
            const isMe = r.teamId === myTeamId;
            return (
              <div key={r.teamId} style={{
                display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 'var(--space-2)', alignItems: 'center',
                padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                background: isMe ? `${accent}18` : 'transparent',
                borderLeft: isMe ? `2px solid ${accent}` : '2px solid transparent',
                fontWeight: isMe ? 600 : 400,
                transition: 'background var(--motion-fast)',
              }}>
                <span style={{ color: rankColor(i), fontWeight: 700, fontSize: 'var(--text-md)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                  {r.logoId && <span style={{ fontSize: 16 }}>{r.logoId}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: r.primaryColor ?? 'inherit' }}>{r.tag}</strong>
                    <span className="muted" style={{ marginLeft: 6, fontSize: 'var(--text-sm)' }}>{r.name}</span>
                  </span>
                </span>
                <strong style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>{fmtDelta(r.delta)}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Countdown chip — h/m/s until rollover.

function RolloverChip({ rolloverUtcMs }: { rolloverUtcMs: number }): React.ReactElement {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const remaining = Math.max(0, rolloverUtcMs - now);
  const label = useMemo(() => {
    const s = Math.floor(remaining / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m ${sec.toString().padStart(2, '0')}s`;
  }, [remaining]);
  return (
    <span className="pill pill-accent" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
      ⏳ Rolls in <strong>{label}</strong>
    </span>
  );
}
