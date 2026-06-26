// Connect screen — first thing the user sees in online mode. Collects
// nickname + PIN, fires off the hello message. Server URL is auto-derived
// from the page origin (wsOrigin) — no manual entry needed for the single
// hosted deployment.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import { wsOrigin } from '../serverUrl';

export default function ConnectScreen({ onBack }: { onBack: () => void }) {
  const connectTo = useOnline((s) => s.connectTo);
  const status = useOnline((s) => s.status);
  const errorBanner = useOnline((s) => s.errorBanner);
  const log = useOnline((s) => s.log);
  const clearError = useOnline((s) => s.clearError);

  const [nickname, setNickname] = useState('');
  const [pin, setPin] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => () => clearError(), [clearError]);

  const pinValid = /^\d{4,8}$/.test(pin);
  const nickValid = nickname.trim().length >= 2 && nickname.trim().length <= 24;
  const canSubmit = pinValid && nickValid && status !== 'connecting';

  function handleConnect(e: React.FormEvent): void {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    connectTo(wsOrigin(), nickname.trim(), pin.trim());
  }

  return (
    <div className="menu-screen">
      <div className="menu-bg" />
      <div className="menu-content" style={{ maxWidth: 560 }}>
        <div className="menu-brand">
          <span className="menu-brand-cs">CS2</span>
          <span className="menu-brand-mgr">MANAGER · ONLINE</span>
        </div>
        <div className="menu-tagline">Sign in to play.</div>

        <form className="menu-buttons" onSubmit={handleConnect} style={{ gap: 12 }}>
          <label className="field">
            <span className="field-label">Nickname</span>
            <input
              className="input"
              type="text"
              autoComplete="username"
              spellCheck={false}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="2-24 chars, case-insensitive"
              maxLength={24}
            />
            {touched && !nickValid && (
              <span className="muted small" style={{ color: '#e25555' }}>
                Nickname must be 2-24 chars.
              </span>
            )}
          </label>

          <label className="field">
            <span className="field-label">PIN (4-8 digits)</span>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="••••"
              maxLength={8}
            />
            <span className="muted small">
              First time? Pick any PIN — it registers your nickname. Re-use the same PIN to reclaim your team.
            </span>
          </label>

          {errorBanner && (
            <div className="menu-err" role="alert">{errorBanner}</div>
          )}

          <button type="submit" className="menu-btn menu-btn-primary" disabled={!canSubmit}>
            <span className="menu-btn-label">
              {status === 'connecting' ? 'Connecting…' : status === 'reconnecting' ? 'Reconnecting…' : 'Connect'}
            </span>
            <span className="menu-btn-sub">
              {status === 'open' ? 'Connected — handshake pending' : 'Press to join the server'}
            </span>
          </button>

          <button type="button" className="menu-btn" onClick={onBack}>
            <span className="menu-btn-label">Back to Main Menu</span>
            <span className="menu-btn-sub">Disconnects from any online session</span>
          </button>
        </form>

        {log.length > 0 && (
          <details style={{ marginTop: 16, color: 'var(--muted)' }}>
            <summary className="muted small">Connection log ({log.length})</summary>
            <pre style={{ fontSize: 11, padding: 8, background: 'var(--panel-2)', borderRadius: 4, marginTop: 6, maxHeight: 180, overflow: 'auto' }}>
              {log.join('\n')}
            </pre>
          </details>
        )}
      </div>
      <div className="menu-footer">
        <span>Online · live multiplayer</span>
        <span>Per-team clock · auto-advances every 4h UTC</span>
      </div>
    </div>
  );
}
