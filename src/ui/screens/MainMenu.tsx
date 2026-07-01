import { useEffect, useState } from 'react';
import { getSoundSettings, setSoundSettings, startBackgroundMusic, toggleMusicMuted, unlockAudio } from '../../sound/soundManager';

type Panel = 'main' | 'settings' | 'about';

/** Note: `onNewCareer` / `onLoadSelected` kept in the signature for
 *  parent compat but the buttons are removed — this game is online-only
 *  as of v0.5. Single-player screens still exist in the codebase but no
 *  entry point on the main menu. */
export default function MainMenu({
  onNewCareer: _onNewCareer,
  onLoadSelected: _onLoadSelected,
  onOnline,
}: {
  onNewCareer: () => void;
  onLoadSelected: () => void;
  onOnline: () => void;
}) {
  const [panel, setPanel] = useState<Panel>('main');

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
            <button
              className="menu-btn menu-btn-online"
              onClick={() => {
                // Any click on the menu is a user gesture — browsers
                // require one before autoplay, so kick off BGM here.
                unlockAudio();
                startBackgroundMusic();
                onOnline();
              }}
            >
              <span className="menu-btn-online-pulse" aria-hidden />
              <span className="menu-btn-label">
                Play Online
                <span className="menu-btn-online-badge">LIVE</span>
              </span>
              <span className="menu-btn-sub">Duel real managers · cross-team transfers · tournaments · gambling mini-games</span>
            </button>
            <button className="menu-btn" onClick={() => setPanel('settings')}>
              <span className="menu-btn-label">Settings</span>
              <span className="menu-btn-sub">Sound, volume</span>
            </button>
            <button className="menu-btn" onClick={() => setPanel('about')}>
              <span className="menu-btn-label">About</span>
              <span className="menu-btn-sub">Credits &amp; version</span>
            </button>
          </div>
        )}

        {panel === 'settings' && <SettingsPanel onBack={() => setPanel('main')} />}
        {panel === 'about' && <AboutPanel onBack={() => setPanel('main')} />}
      </div>
      <div className="menu-footer">
        <span>v0.5 · Alex Chon</span>
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

      {/* ===== SFX (round wins, bomb, ambient) ===== */}
      <label className="menu-field">
        <span className="menu-field-label">Sound effects</span>
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

      {/* ===== Background music (looping BGM) ===== */}
      <label className="menu-field" style={{ marginTop: 12 }}>
        <span className="menu-field-label">Background music</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className={`menu-toggle ${sound.musicMuted ? 'off' : 'on'}`}
            onClick={() => {
              unlockAudio();
              toggleMusicMuted();
              setSound(getSoundSettings());
            }}
          >
            {sound.musicMuted ? 'Muted' : 'On'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sound.musicVolume}
            disabled={sound.musicMuted}
            onChange={(e) => {
              unlockAudio();
              setSoundSettings({ musicVolume: Number(e.target.value), musicMuted: false });
              setSound(getSoundSettings());
            }}
            style={{ flex: 1 }}
          />
          <span className="muted small" style={{ minWidth: 36, textAlign: 'right' }}>
            {Math.round(sound.musicVolume * 100)}%
          </span>
        </div>
      </label>

      <p className="menu-panel-note">
        Effects fire on round wins, bomb plants, defuses, and atmosphere cues. Music loops in the background.
        Toggle either from the sidebar at any time.
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
