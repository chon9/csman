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
      <div className="panel" style={{
        padding: 18,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        background: 'linear-gradient(135deg, #1a3a1a 0%, #2a2a4a 60%, #4a3a1a 100%)',
        border: '1px solid rgba(255,215,0,0.24)',
      }}>
        <div>
          <h2 style={{ margin: '0 0 4px', letterSpacing: 1 }}>🏁 DAILY RACE</h2>
          <div className="muted small">Two boards · resets 00:00 UTC · top 3 win cash on each · no signup, just play</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {daily && <RolloverChip rolloverUtcMs={daily.rolloverUtcMs} />}
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* Payout schedule strip */}
      <div className="panel" style={{ padding: 12, fontSize: 12, background: 'rgba(0,0,0,0.2)' }}>
        <strong>Payout per board:</strong> &nbsp;
        🥇 <strong>$500,000</strong> · 🥈 <strong>$250,000</strong> · 🥉 <strong>$100,000</strong>
        &nbsp; — awarded automatically at 00:00 UTC. Only positive deltas eligible.
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
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title" style={{ marginBottom: 8 }}>Your recent race wins</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {daily.recentPayouts.map((p) => (
              <div key={`${p.dateUtc}-${p.raceKind}-${p.rank}`} style={{
                display: 'flex', justifyContent: 'space-between', gap: 8,
                padding: '4px 8px', borderRadius: 4,
                background: 'rgba(255,255,255,0.03)',
              }}>
                <span>
                  <strong>{p.dateUtc}</strong> · {p.raceKind === 'points' ? '📈' : '💰'} {p.raceKind === 'points' ? 'Points' : 'Money'}
                  &nbsp; #{p.rank} <span className="muted">(Δ {p.raceKind === 'points' ? p.valueDelta.toLocaleString() + ' MMR' : '$' + p.valueDelta.toLocaleString()})</span>
                </span>
                <strong style={{ color: '#d9b344' }}>+${p.amount.toLocaleString()}</strong>
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
    <div className="panel" style={{ padding: 14, borderTop: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div className="panel-title">{title}</div>
        {myRank != null && (
          <div style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: `${accent}22`, color: accent, fontWeight: 700 }}>
            You: #{myRank}
          </div>
        )}
      </div>
      <div className="muted small" style={{ marginBottom: 10 }}>{subtitle}</div>
      {rows.length === 0 ? (
        <div className="muted small" style={{ padding: 12, textAlign: 'center' }}>
          No entries yet today — be the first!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r, i) => {
            const isMe = r.teamId === myTeamId;
            return (
              <div key={r.teamId} style={{
                display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: 8, alignItems: 'center',
                padding: '6px 10px', borderRadius: 6,
                background: isMe ? `${accent}18` : (i < 3 ? 'rgba(255,255,255,0.05)' : 'transparent'),
                border: isMe ? `1px solid ${accent}55` : '1px solid transparent',
                fontWeight: isMe ? 700 : 400,
              }}>
                <span style={{ color: rankColor(i), fontWeight: 800, fontSize: 13, textAlign: 'center' }}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {r.logoId && <span style={{ fontSize: 16 }}>{r.logoId}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: r.primaryColor ?? 'inherit' }}>{r.tag}</strong>
                    <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{r.name}</span>
                  </span>
                </span>
                <strong style={{ color: accent }}>{fmtDelta(r.delta)}</strong>
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
    <div style={{
      padding: '6px 12px', borderRadius: 999,
      background: 'rgba(0,0,0,0.35)',
      fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
    }}>
      ⏳ Rolls in <strong>{label}</strong>
    </div>
  );
}
