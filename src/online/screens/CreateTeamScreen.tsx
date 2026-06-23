// Create-team flow — first-time setup for a newly registered nickname.
// Once the team is created the server immediately spawns 5 newgens.

import { useRef, useState } from 'react';
import type { Region } from '../../types';
import { useOnline } from '../onlineStore';
import { INITIAL_ROSTER_SIZE } from '../protocol';

const REGIONS: { value: Region; label: string }[] = [
  { value: 'Europe', label: 'Europe' },
  { value: 'CIS', label: 'CIS' },
  { value: 'Americas', label: 'Americas' },
  { value: 'Asia', label: 'Asia' },
];

export default function CreateTeamScreen() {
  const team = useOnline((s) => s.team);
  const createTeam = useOnline((s) => s.createTeam);
  const importTeam = useOnline((s) => s.importTeam);
  const errorBanner = useOnline((s) => s.errorBanner);
  const clearError = useOnline((s) => s.clearError);
  const disconnect = useOnline((s) => s.disconnect);

  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [region, setRegion] = useState<Region>('Europe');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') importTeam(reader.result);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const canSubmit = name.trim().length >= 2 && tag.trim().length >= 2 && tag.trim().length <= 6;

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    clearError();
    createTeam(name.trim(), tag.trim().toUpperCase(), region);
  }

  // Once the team is created the server auto-spawns the roster and switches
  // us to the home screen. While we're waiting, show a friendly status.
  if (team) {
    return (
      <div className="menu-screen">
        <div className="menu-bg" />
        <div className="menu-content" style={{ maxWidth: 480 }}>
          <div className="menu-brand">
            <span className="menu-brand-cs">{team.tag}</span>
            <span className="menu-brand-mgr">{team.name}</span>
          </div>
          <div className="menu-tagline">
            Spawning {INITIAL_ROSTER_SIZE} newgens…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="menu-screen">
      <div className="menu-bg" />
      <div className="menu-content" style={{ maxWidth: 520 }}>
        <div className="menu-brand">
          <span className="menu-brand-cs">CREATE</span>
          <span className="menu-brand-mgr">YOUR TEAM</span>
        </div>
        <div className="menu-tagline">
          Pick a name, tag, and region. {INITIAL_ROSTER_SIZE} newgens will spawn into your roster.
        </div>

        <form className="menu-buttons" onSubmit={handleSubmit} style={{ gap: 12 }}>
          <label className="field">
            <span className="field-label">Team name</span>
            <input
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              placeholder="e.g. Phantom Esports"
              maxLength={32}
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field-label">Team tag (2-6 chars)</span>
            <input
              className="input"
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="e.g. PHN"
              maxLength={6}
              style={{ textTransform: 'uppercase', letterSpacing: 2 }}
            />
          </label>

          <label className="field">
            <span className="field-label">Region</span>
            <select
              className="input"
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
            >
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <span className="muted small">
              Region biases newgen names + nationalities. You can sign across regions later.
            </span>
          </label>

          {errorBanner && (
            <div className="menu-err" role="alert">{errorBanner}</div>
          )}

          <button type="submit" className="menu-btn menu-btn-primary" disabled={!canSubmit}>
            <span className="menu-btn-label">Found Team</span>
            <span className="menu-btn-sub">Locks in your name + tag, spawns roster</span>
          </button>
          <button type="button" className="menu-btn" onClick={() => fileRef.current?.click()}>
            <span className="menu-btn-label">Import Team from File</span>
            <span className="menu-btn-sub">Drop in a .csm.json export — money resets to starting balance</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,.csm.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button type="button" className="menu-btn" onClick={disconnect}>
            <span className="menu-btn-label">Disconnect</span>
            <span className="menu-btn-sub">Return to the main menu</span>
          </button>
        </form>
      </div>
    </div>
  );
}
