// Connect screen — first thing the user sees in online mode. Collects
// server URL + nickname + PIN, fires off the hello message. Persists the
// last-used server URL to localStorage so reconnecting is one click.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import { wsOrigin } from '../serverUrl';

const LAST_SERVER_KEY = 'csm-online-last-server';

function defaultServerUrl(): string {
  try {
    const saved = localStorage.getItem(LAST_SERVER_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  // wsOrigin() resolves to wss://<host> behind a Caddy / reverse proxy and
  // ws://<host>:8787 for raw-IP / local dev. One source of truth keeps
  // production + dev connect URLs in sync without manual editing.
  return wsOrigin();
}

export default function ConnectScreen({ onBack }: { onBack: () => void }) {
  const connectTo = useOnline((s) => s.connectTo);
  const status = useOnline((s) => s.status);
  const errorBanner = useOnline((s) => s.errorBanner);
  const log = useOnline((s) => s.log);
  const clearError = useOnline((s) => s.clearError);

  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [nickname, setNickname] = useState('');
  const [pin, setPin] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => () => clearError(), [clearError]);

  const pinValid = /^\d{4,8}$/.test(pin);
  const nickValid = nickname.trim().length >= 2 && nickname.trim().length <= 24;
  const urlValid = serverUrl.startsWith('ws://') || serverUrl.startsWith('wss://');
  const canSubmit = pinValid && nickValid && urlValid && status !== 'connecting';

  function handleConnect(e: React.FormEvent): void {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    try { localStorage.setItem(LAST_SERVER_KEY, serverUrl); } catch { /* ignore */ }
    connectTo(serverUrl.trim(), nickname.trim(), pin.trim());
  }

  return (
    <div className="menu-screen">
      <div className="menu-bg" />
      <div className="menu-content" style={{ maxWidth: 560 }}>
        <div className="menu-brand">
          <span className="menu-brand-cs">CS2</span>
          <span className="menu-brand-mgr">MANAGER · ONLINE</span>
        </div>
        <div className="menu-tagline">Connect to a multiplayer server.</div>

        <form className="menu-buttons" onSubmit={handleConnect} style={{ gap: 12 }}>
          <label className="field">
            <span className="field-label">Server URL</span>
            <input
              className="input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="ws://your-lightsail-ip:8787"
            />
            {touched && !urlValid && (
              <span className="muted small" style={{ color: '#e25555' }}>
                Must start with ws:// or wss://
              </span>
            )}
          </label>

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
        <span>Online (Beta) · Phase 1</span>
        <span>Per-team clock · LAN/Internet ready</span>
      </div>
    </div>
  );
}
