import { useEffect, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { getSoundSettings, setSoundSettings, unlockAudio } from '../../sound/soundManager';

type Panel = 'main' | 'settings' | 'about';

export default function MainMenu({
  onNewCareer,
  onLoadSelected,
  onOnline,
}: {
  onNewCareer: () => void;
  onLoadSelected: () => void;
  onOnline: () => void;
}) {
  const loadGame = useGame((s) => s.loadGame);
  const hasSave = useGame((s) => s.hasSave);
  const [panel, setPanel] = useState<Panel>('main');
  const [loadError, setLoadError] = useState<string | null>(null);
  const save = hasSave();

  function tryLoad() {
    if (!loadGame()) {
      setLoadError('Save could not be loaded.');
      return;
    }
    setLoadError(null);
  }

  return (
    <div className="menu-screen">
      <div className="menu-bg" />
      <div className="menu-content">
        <div className="menu-brand">
          <span className="menu-brand-cs">CS2</span>
          <span className="menu-brand-mgr">MANAGER</span>
        </div>
        <div className="menu-tagline">Build a dynasty. One round at a time.</div>

        {panel === 'main' && (
          <div className="menu-buttons">
            {save && (
              <button className="menu-btn menu-btn-primary" onClick={tryLoad}>
                <span className="menu-btn-label">Continue Career</span>
                <span className="menu-btn-sub">Pick up where you left off</span>
              </button>
            )}
            <button className="menu-btn" onClick={onNewCareer}>
              <span className="menu-btn-label">New Career</span>
              <span className="menu-btn-sub">Pick a team and start a fresh save</span>
            </button>
            <button className="menu-btn" disabled={!save} onClick={onLoadSelected}>
              <span className="menu-btn-label">Load / Manage Save</span>
              <span className="menu-btn-sub">{save ? 'Inspect or delete the current save' : 'No save yet'}</span>
            </button>
            <button className="menu-btn" onClick={onOnline}>
              <span className="menu-btn-label">Play Online <span className="muted small">(Beta)</span></span>
              <span className="menu-btn-sub">Connect to a multiplayer server — duels vs other teams + AI</span>
            </button>
            <button className="menu-btn" onClick={() => setPanel('settings')}>
              <span className="menu-btn-label">Settings</span>
              <span className="menu-btn-sub">Sound, volume</span>
            </button>
            <button className="menu-btn" onClick={() => setPanel('about')}>
              <span className="menu-btn-label">About</span>
              <span className="menu-btn-sub">Credits &amp; version</span>
            </button>
            {loadError && <div className="menu-err">{loadError}</div>}
          </div>
        )}

        {panel === 'settings' && <SettingsPanel onBack={() => setPanel('main')} />}
        {panel === 'about' && <AboutPanel onBack={() => setPanel('main')} />}
      </div>
      <div className="menu-footer">
        <span>v0.3 · Alex Chon</span>
        <span>Built for the CS scene.</span>
      </div>
    </div>
  );
}

function SettingsPanel({ onBack }: { onBack: () => void }) {
  const [sound, setSound] = useState(getSoundSettings());
  useEffect(() => setSound(getSoundSettings()), []);

  return (
    <div className="menu-panel">
      <div className="menu-panel-title">Settings</div>
      <label className="menu-field">
        <span className="menu-field-label">Audio</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className={`menu-toggle ${sound.muted ? 'off' : 'on'}`}
            onClick={() => {
              unlockAudio();
              const next = !sound.muted;
              setSoundSettings({ muted: next });
              setSound(getSoundSettings());
            }}
          >
            {sound.muted ? 'Muted' : 'On'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sound.volume}
            disabled={sound.muted}
            onChange={(e) => {
              unlockAudio();
              setSoundSettings({ volume: Number(e.target.value), muted: false });
              setSound(getSoundSettings());
            }}
            style={{ flex: 1 }}
          />
          <span className="muted small" style={{ minWidth: 36, textAlign: 'right' }}>
            {Math.round(sound.volume * 100)}%
          </span>
        </div>
      </label>
      <p className="menu-panel-note">
        In-game sound includes round wins, bomb plants, defuses, and atmosphere cues.
        Toggle from the sidebar at any time as well.
      </p>
      <button className="menu-btn-back" onClick={onBack}>← Back</button>
    </div>
  );
}

function AboutPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="menu-panel">
      <div className="menu-panel-title">About</div>
      <p className="menu-panel-note">
        <strong>CS2 Manager</strong> is a Football Manager–style sim for the Counter-Strike scene.
        Manage tactics, role familiarity, training, transfers, sponsorships, and the dressing room
        across multiple seasons.
      </p>
      <p className="menu-panel-note">
        Every match simulates round-by-round with deterministic engine math —
        your tactical sliders, role assignments, and mid-game timeouts genuinely shift outcomes.
      </p>
      <p className="menu-panel-note muted small">
        Engine v0.3 · React 18 · TypeScript strict · Zustand · Mulberry32 PRNG
      </p>
      <button className="menu-btn-back" onClick={onBack}>← Back</button>
    </div>
  );
}
