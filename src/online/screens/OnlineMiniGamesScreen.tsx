// Hub for in-game mini-games. Currently houses Rock Paper Scissor
// (morale recovery) and 射龍門 Dragon Gate (cash gambling). New games
// can drop in as additional tabs without restructuring routing.

import { useState } from 'react';
import { useOnline } from '../onlineStore';
import MoraleGamePanel from './MoraleGamePanel';
import DragonGatePanel from './DragonGatePanel';
import ToastStack from './ToastStack';

type Tab = 'rps' | 'dragon-gate';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'rps', label: 'Rock Paper Scissor', icon: '✊' },
  { id: 'dragon-gate', label: '🐉 Dragon Gate', icon: '🐉' },
];

export default function OnlineMiniGamesScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const go = useOnline((s) => s.go);
  const [tab, setTab] = useState<Tab>('rps');

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Mini Games</h2>
          <div className="muted small">Free morale recovery, gambling card games. Quick clicks between duels.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="muted small">Cash: <strong>${team.money.toLocaleString()}</strong></span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* ===== Tab strip ===== */}
      <div className="panel" style={{ padding: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`btn ${tab === t.id ? 'btn-accent' : ''}`}
            onClick={() => setTab(t.id)}
            style={{ flex: '1 1 160px', padding: '10px 14px' }}
          >
            <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ===== Active tab body ===== */}
      {tab === 'rps' && <MoraleGamePanel />}
      {tab === 'dragon-gate' && <DragonGatePanel />}

      <ToastStack />
    </div>
  );
}
