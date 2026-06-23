import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { buildInitialDatabase } from '../../data/database';
import { money } from '../util';
import { loadManagerByName, startingAttrsFor } from '../../store/managerStorage';
import type { ManagerStyle, Player, Team } from '../../types';

const STYLE_OPTIONS: { id: ManagerStyle; label: string; blurb: string }[] = [
  { id: 'tactician', label: 'Tactician', blurb: 'Reads players sharply. Stronger scouting + tactical edge.' },
  { id: 'motivator', label: 'Motivator', blurb: 'Lifts dressing-room morale. Faster bounceback after losses.' },
  { id: 'youth-specialist', label: 'Youth Specialist', blurb: 'Develops young talent faster. Stronger mentor effect.' },
  { id: 'all-rounder', label: 'All-rounder', blurb: 'Balanced attributes across the board. No weaknesses.' },
];

export default function NewGameScreen({ onBack }: { onBack?: () => void } = {}) {
  const newGame = useGame((s) => s.newGame);

  const [selected, setSelected] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('My Career');
  const [managerName, setManagerName] = useState('');
  const [nationality, setNationality] = useState('');
  const [style, setStyle] = useState<ManagerStyle>('all-rounder');

  // If the manager name matches a saved profile, show "returning manager" hint
  // and lock the style picker (existing attrs win over the form selection).
  const existing = useMemo(
    () => (managerName.trim() ? loadManagerByName(managerName.trim()) : null),
    [managerName],
  );
  const previewAttrs = existing?.attributes ?? startingAttrsFor(style);

  const db = useMemo(() => {
    try {
      return buildInitialDatabase('2026-01-05');
    } catch {
      return null;
    }
  }, []);

  const teams: Team[] = useMemo(() => {
    if (!db) return [];
    return Object.values(db.teams).sort((a, b) => a.worldRanking - b.worldRanking);
  }, [db]);

  function topPlayers(t: Team): Player[] {
    if (!db) return [];
    return t.playerIds
      .map((id) => db.players[id])
      .filter(Boolean)
      .sort((a, b) => b.currentAbility - a.currentAbility)
      .slice(0, 3);
  }

  return (
    <div className="newgame">
      <div className="newgame-hero">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 className="newgame-title">NEW CAREER</h1>
            <p className="newgame-sub">Pick the team you'll take charge of. Save name is shown in the sidebar.</p>
          </div>
          {onBack && (
            <button className="btn" onClick={onBack}>← Back to Menu</button>
          )}
        </div>
        <div className="newgame-controls">
          <label className="field">
            <span className="field-label">Manager name</span>
            <input
              className="input"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              placeholder="optional"
              maxLength={40}
            />
          </label>
          <label className="field">
            <span className="field-label">Nationality</span>
            <input
              className="input"
              value={nationality}
              onChange={(e) => setNationality(e.target.value.toUpperCase().slice(0, 3))}
              placeholder="DE / SE / US"
              maxLength={3}
            />
          </label>
          <label className="field">
            <span className="field-label">Save name</span>
            <input
              className="input"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              maxLength={40}
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={!selected || !saveName.trim()}
            onClick={() =>
              selected &&
              newGame(
                selected,
                saveName.trim(),
                managerName.trim()
                  ? { name: managerName.trim(), nationality: nationality.trim() || 'XX', style }
                  : undefined,
              )
            }
          >
            Start Career
          </button>
        </div>

        {/* Manager style picker — locked if a saved profile with this name exists */}
        {managerName.trim() && (
          <div className="newgame-style-row">
            {existing ? (
              <div className="newgame-style-existing">
                <strong>Returning manager:</strong> {existing.name} · {existing.style} · reputation {existing.reputation} · {existing.trophiesTotal} trophies across {existing.career.length} stints. Style locked from prior careers.
              </div>
            ) : (
              <div className="newgame-style-grid">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    className={`style-card ${style === opt.id ? 'selected' : ''}`}
                    onClick={() => setStyle(opt.id)}
                  >
                    <div className="style-card-label">{opt.label}</div>
                    <div className="style-card-blurb">{opt.blurb}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="newgame-attrs-preview">
              <span>Motivating <strong>{previewAttrs.motivating}</strong></span>
              <span>Youngsters <strong>{previewAttrs.youngsters}</strong></span>
              <span>Press <strong>{previewAttrs.press}</strong></span>
              <span>Judging Talent <strong>{previewAttrs.judgingTalent}</strong></span>
            </div>
          </div>
        )}
      </div>

      {!db && (
        <div className="panel newgame-empty">
          <p>Team database unavailable. Please reload.</p>
        </div>
      )}

      <div className="newgame-grid">
        {teams.map((t) => (
          <button
            key={t.id}
            className={`team-card ${selected === t.id ? 'selected' : ''}`}
            onClick={() => setSelected(t.id)}
          >
            <div className="team-card-head">
              <span className="team-card-tag">{t.tag}</span>
              <span className="team-card-rank">#{t.worldRanking}</span>
            </div>
            <div className="team-card-name">{t.name}</div>
            <div className="team-card-meta">
              <span>{t.region}</span>
              <span>{money(t.budget)}</span>
            </div>
            <div className="team-card-players">
              {topPlayers(t)
                .map((p) => p.nickname)
                .join(' / ')}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
