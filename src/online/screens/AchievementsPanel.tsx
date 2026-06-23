// Display all unlocked + locked achievements so the user can see what's
// chasable. Lives as a collapsible panel on the home screen so it doesn't
// dominate the layout.

import { useEffect, useState } from 'react';
import { ACHIEVEMENT_LABELS } from '../protocol';
import { useOnline } from '../onlineStore';

export default function AchievementsPanel() {
  const list = useOnline((s) => s.listAchievements);
  const unlocked = useOnline((s) => s.achievements);
  const [open, setOpen] = useState(true);

  useEffect(() => { list(); }, [list]);

  const allKinds = Object.keys(ACHIEVEMENT_LABELS);
  const unlockedSet = new Set(unlocked.map((a) => a.kind));
  const got = unlocked.length;
  const total = allKinds.length;

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          🏅 Achievements <span className="muted small">{got} / {total}</span>
        </span>
        <button className="link-btn" onClick={() => setOpen((b) => !b)}>{open ? 'hide' : 'show'}</button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {allKinds.map((kind) => {
            const has = unlockedSet.has(kind);
            return (
              <span
                key={kind}
                className="achievement-chip"
                style={{
                  opacity: has ? 1 : 0.35,
                  background: has ? 'rgba(76,175,125,0.18)' : 'var(--panel-2)',
                  borderColor: has ? 'rgba(76,175,125,0.5)' : 'var(--border)',
                }}
                title={ACHIEVEMENT_LABELS[kind]}
              >
                {ACHIEVEMENT_LABELS[kind]}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
