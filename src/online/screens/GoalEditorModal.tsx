// Modal for setting / clearing a development goal on one of your players.
// Lets the manager pick any attribute and dial in a 1-20 target. Server
// enforces the max-5-open-goals cap and replaces any existing goal for
// the same player+attr pair.

import { useState } from 'react';
import type { Player, PlayerAttributes } from '../../types';
import { useOnline } from '../onlineStore';

const ATTR_KEYS: (keyof PlayerAttributes)[] = [
  'aim', 'reflexes', 'positioning', 'utility', 'clutch',
  'gameSense', 'communication', 'leadership', 'consistency', 'composure',
  'resilience', 'discipline', 'aggression', 'teamwork', 'loyalty', 'endurance',
];

export default function GoalEditorModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const setGoal = useOnline((s) => s.setPlayerGoal);
  const clearGoal = useOnline((s) => s.clearPlayerGoal);
  const existing = useOnline((s) => s.playerGoals.filter((g) => g.playerId === player.id));

  const [attr, setAttr] = useState<keyof PlayerAttributes>('aim');
  const current = player.attributes[attr];
  const [target, setTarget] = useState<number>(Math.min(20, current + 2));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>Development goal — {player.nickname}</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>
        <div className="modal-body">
          <p className="muted small" style={{ marginTop: 0 }}>
            Targets are tracked during time-skips. Crossing the threshold pushes a notification.
            Max 5 open goals across your roster.
          </p>
          <label className="field">
            <span className="field-label">Attribute</span>
            <select
              className="input"
              value={attr}
              onChange={(e) => {
                const a = e.target.value as keyof PlayerAttributes;
                setAttr(a);
                setTarget(Math.min(20, player.attributes[a] + 2));
              }}
            >
              {ATTR_KEYS.map((a) => (
                <option key={a} value={a}>
                  {a} (now {player.attributes[a]})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">
              Target {target} <span className="muted small">(current {current})</span>
            </span>
            <input
              type="range"
              min={Math.min(20, current + 1)}
              max={20}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </label>
          {existing.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="muted small">Existing goals for this player:</div>
              {existing.map((g) => (
                <div key={g.attr} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span>
                    {g.attr} → {g.target}
                    {g.reachedAt ? <span className="text-win" style={{ marginLeft: 6 }}>✓ reached</span> : null}
                  </span>
                  <button className="btn btn-tiny btn-danger" onClick={() => clearGoal(g.playerId, g.attr)}>Clear</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-accent"
            disabled={target <= current}
            onClick={() => { setGoal(player.id, attr, target); onClose(); }}
          >
            Set goal: {attr} → {target}
          </button>
        </div>
      </div>
    </div>
  );
}
