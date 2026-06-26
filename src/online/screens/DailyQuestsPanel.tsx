// Daily quests panel — drops on the Home screen. Pulls today's quest trio
// + login-streak multiplier from the server. Shows progress bars per quest,
// Claim buttons on completed ones, and a bonus row for the all-done reward.

import { useEffect } from 'react';
import { useOnline } from '../onlineStore';
import type { DailyQuest, QuestDifficulty } from '../protocol';

const DIFFICULTY_COLOR: Record<QuestDifficulty, string> = {
  easy: '#6ed09a',
  medium: '#f2c443',
  hard: '#e25555',
};
const DIFFICULTY_LABEL: Record<QuestDifficulty, string> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'HARD',
};

export default function DailyQuestsPanel(): React.ReactElement | null {
  const snapshot = useOnline((s) => s.questSnapshot);
  const refresh = useOnline((s) => s.refreshQuests);
  const claim = useOnline((s) => s.claimQuest);
  const claimAllDone = useOnline((s) => s.claimAllDoneBonus);

  // Pull on mount + once a minute so a UTC rollover refreshes the trio
  // (server is the source of truth — client just keeps the cache fresh).
  useEffect(() => {
    refresh();
    const id = window.setInterval(() => refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!snapshot) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">📋 Daily Quests</div>
        <div className="muted small">Loading today's quests…</div>
      </div>
    );
  }

  const { quests, loginStreak, streakMult, allDoneBonus, allDoneBonusClaimed } = snapshot;
  const allClaimed = quests.length > 0 && quests.every((q) => q.claimedAt !== null);
  const bonusReady = allClaimed && !allDoneBonusClaimed;

  return (
    <div
      className="panel"
      style={{
        padding: 14,
        background: 'linear-gradient(135deg, rgba(75,105,255,0.08), rgba(110,208,154,0.06))',
        border: '1px solid rgba(109,229,255,0.18)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>📋 Daily Quests</div>
        <div
          style={{
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          }}
        >
          <span
            title="Login streak. Increases by 1 each UTC day you claim at least one quest; resets if you miss a day. Boosts every quest reward."
            style={{
              padding: '4px 9px', borderRadius: 999, background: 'rgba(242,196,67,0.12)',
              border: '1px solid rgba(242,196,67,0.40)', color: '#f2c443', fontSize: 11, fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            🔥 {loginStreak}d streak · ×{streakMult.toFixed(2)}
          </span>
          <span className="muted small">resets at 00:00 UTC</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {quests.map((q) => (
          <QuestRow key={q.id} q={q} onClaim={() => claim(q.id)} />
        ))}
      </div>

      {/* ===== All-done bonus row ===== */}
      <div
        style={{
          marginTop: 10,
          padding: 10,
          borderRadius: 8,
          background: bonusReady ? 'rgba(110,208,154,0.10)' : 'rgba(255,255,255,0.02)',
          border: `1px solid ${bonusReady ? 'rgba(110,208,154,0.40)' : 'rgba(255,255,255,0.06)'}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: bonusReady ? '#9be29b' : '#d4d8e1' }}>
            🎁 All-done bonus
          </div>
          <div className="muted small">
            {allDoneBonusClaimed
              ? `Already claimed today. Comes back at 00:00 UTC.`
              : `Claim every quest to unlock +$${allDoneBonus.toLocaleString()}.`}
          </div>
        </div>
        <button
          className="btn btn-accent"
          disabled={!bonusReady}
          onClick={claimAllDone}
        >
          {allDoneBonusClaimed ? 'Claimed' : `Claim $${allDoneBonus.toLocaleString()}`}
        </button>
      </div>
    </div>
  );
}

function QuestRow({ q, onClaim }: { q: DailyQuest; onClaim: () => void }): React.ReactElement {
  const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
  const done = q.progress >= q.target;
  const claimed = q.claimedAt !== null;
  const color = DIFFICULTY_COLOR[q.difficulty];
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        background: claimed ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.18)',
        border: `1px solid ${claimed ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)'}`,
        opacity: claimed ? 0.55 : 1,
        display: 'grid',
        gridTemplateColumns: '70px 1fr 120px',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 1,
          textAlign: 'center',
          padding: '3px 0',
          borderRadius: 4,
          background: `${color}22`,
          border: `1px solid ${color}66`,
          color,
        }}
      >
        {DIFFICULTY_LABEL[q.difficulty]}
      </span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf0', textDecoration: claimed ? 'line-through' : 'none' }}>
          {q.label}
        </div>
        <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 999, marginTop: 4, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: color, transition: 'width 200ms' }} />
        </div>
        <div className="muted small" style={{ marginTop: 2, fontSize: 10 }}>
          {q.progress}/{q.target} · reward <strong style={{ color: '#9be29b' }}>${q.reward.toLocaleString()}</strong>
        </div>
      </div>
      <button
        className={`btn btn-tiny ${done && !claimed ? 'btn-accent' : ''}`}
        disabled={!done || claimed}
        onClick={onClaim}
        title={claimed ? 'Claimed' : done ? 'Collect cash' : 'Keep playing to fill the bar'}
        style={{ padding: '6px 10px' }}
      >
        {claimed ? '✓ Claimed' : done ? 'Claim' : 'In progress'}
      </button>
    </div>
  );
}
