// Compact achievements summary shown on the home screen. The full
// catalogue lives on the dedicated AchievementsScreen — this panel
// just teases the progress ring + a strip of most-recent unlocks and
// deep-links into the full page.

import { useEffect, useMemo } from 'react';
import { ACHIEVEMENT_LABELS, achievementReward } from '../protocol';
import { useOnline } from '../onlineStore';
import Icon from '../../ui/Icon';

export default function AchievementsPanel() {
  const list = useOnline((s) => s.listAchievements);
  const unlocked = useOnline((s) => s.achievements);
  const go = useOnline((s) => s.go);

  useEffect(() => { list(); }, [list]);

  const totalKinds = Object.keys(ACHIEVEMENT_LABELS).length;
  const got = unlocked.length;
  const pct = totalKinds > 0 ? Math.round((got / totalKinds) * 100) : 0;
  const totalReward = unlocked.reduce((s, a) => s + (a.rewardCash ?? achievementReward(a.kind)), 0);

  // Show the 3 most-recent unlocks so users can glance at what's fresh.
  const recent = useMemo(() => {
    return [...unlocked]
      .sort((a, b) => b.achievedAt - a.achievedAt)
      .slice(0, 3);
  }, [unlocked]);

  return (
    <div
      className="panel"
      style={{ padding: 14, cursor: 'pointer' }}
      onClick={() => go('achievements')}
      title="Open full achievements page"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 6,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--border-accent)',
            flexShrink: 0,
          }}><Icon name="trophy" size={18} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="panel-title" style={{ margin: 0 }}>Achievements</div>
            <div className="muted small">
              {got}/{totalKinds} unlocked · {pct}% · ${totalReward.toLocaleString()} earned
            </div>
          </div>
        </div>
        <Icon name="chevron-right" size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
      </div>

      {/* Slim progress bar */}
      <div style={{
        marginTop: 10, position: 'relative', height: 4, borderRadius: 999,
        background: 'var(--panel-2)', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, width: `${pct}%`,
          background: 'linear-gradient(90deg, var(--accent-dark), var(--accent))',
          borderRadius: 999,
        }} />
      </div>

      {/* Recent unlocks strip */}
      {recent.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {recent.map((a) => (
            <span
              key={`${a.kind}-${a.achievedAt}`}
              className="pill"
              style={{
                fontSize: 10.5,
                background: 'var(--accent-soft)',
                borderColor: 'var(--border-accent)',
                color: 'var(--accent)',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
              title={ACHIEVEMENT_LABELS[a.kind] ?? a.kind}
            >
              <Icon name="check" size={11} />
              {(a.label ?? ACHIEVEMENT_LABELS[a.kind] ?? a.kind)
                .replace(/^\p{Extended_Pictographic}(\p{Extended_Pictographic}|[☀-➿️])*\s*/u, '')
                .split(' — ')[0]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
