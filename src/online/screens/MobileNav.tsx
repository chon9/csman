// Mobile bottom-app-bar nav + drawer. Only visible on narrow viewports
// (≤ 900px CSS breakpoint). Five primary destinations sit on the bar;
// the rest live in a bottom-sheet drawer opened via the "More" button.
//
// The desktop OnlineSidebar stays mounted underneath — CSS hides it on
// mobile — so all the sidebar's peripheral chrome (rank badge, cash
// pill, disconnect) is available from the drawer's footer.

import { useState } from 'react';
import { useOnline } from '../onlineStore';
import type { OnlineScreen } from '../onlineStore';
import { publicOrigin } from '../serverUrl';
import { getSoundSettings, startBackgroundMusic, toggleMusicMuted } from '../../sound/soundManager';

interface NavItem {
  id: OnlineScreen;
  label: string;
  icon: string;
}

/** Primary 4 bar destinations — most-used online-mode screens. */
const PRIMARY: NavItem[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'inbox', label: 'Inbox', icon: '📬' },
  { id: 'challenges', label: 'PvP', icon: '⚔' },
  { id: 'market', label: 'Market', icon: '💱' },
];

/** Everything else lives in the drawer. */
const DRAWER: NavItem[] = [
  { id: 'tactics', label: 'Tactics', icon: '🎯' },
  { id: 'tournaments', label: 'Tournaments', icon: '🏆' },
  { id: 'daily-race', label: 'Daily Race', icon: '🏁' },
  { id: 'training', label: 'Training', icon: '🎯' },
  { id: 'cases', label: 'Cases', icon: '📦' },
  { id: 'boosters', label: 'Boosters', icon: '🎴' },
  { id: 'massage', label: 'Massage', icon: '💆' },
  { id: 'mini-games', label: 'Mini Games', icon: '🎮' },
  { id: 'ai-bets', label: 'AI Betting', icon: '🎰' },
  { id: 'real-estate', label: 'Real Estate', icon: '🏘' },
  { id: 'streaming', label: 'Streaming', icon: '📺' },
  { id: 'scout', label: 'Scout', icon: '🔬' },
  { id: 'history', label: 'History', icon: '📜' },
  { id: 'leaderboard', label: 'Leaderboard', icon: '📈' },
];

export default function MobileNav(): React.ReactElement {
  const screen = useOnline((s) => s.screen);
  const go = useOnline((s) => s.go);
  const isAdmin = useOnline((s) => s.isAdmin);
  const team = useOnline((s) => s.team);
  const disconnect = useOnline((s) => s.disconnect);
  const exportTeam = useOnline((s) => s.exportTeam);

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Consider "in the drawer" active if the current screen is any drawer item.
  const activeInDrawer = DRAWER.some((d) => d.id === screen) || (isAdmin && screen === 'admin');

  function jump(s: OnlineScreen): void {
    setDrawerOpen(false);
    go(s);
  }

  return (
    <>
      {/* Bottom app bar — always mounted, CSS hides it on desktop. */}
      <nav className="mobile-nav" aria-label="Primary navigation">
        {PRIMARY.map((item) => (
          <button
            key={item.id}
            className={`mobile-nav-btn ${screen === item.id ? 'mobile-nav-btn-active' : ''}`}
            onClick={() => jump(item.id)}
          >
            <span className="mobile-nav-icon">{item.icon}</span>
            <span className="mobile-nav-label">{item.label}</span>
          </button>
        ))}
        <button
          className={`mobile-nav-btn ${activeInDrawer || drawerOpen ? 'mobile-nav-btn-active' : ''}`}
          onClick={() => setDrawerOpen((o) => !o)}
          aria-expanded={drawerOpen}
        >
          <span className="mobile-nav-icon">☰</span>
          <span className="mobile-nav-label">More</span>
        </button>
      </nav>

      {/* Drawer backdrop */}
      <div className={`mobile-drawer-backdrop ${drawerOpen ? 'open' : ''}`} onClick={() => setDrawerOpen(false)} />

      {/* Drawer bottom sheet */}
      <aside className={`mobile-drawer ${drawerOpen ? 'open' : ''}`} aria-hidden={!drawerOpen}>
        <div className="mobile-drawer-handle" />
        <div className="mobile-drawer-title">Menu</div>
        <div className="mobile-drawer-grid">
          {DRAWER.map((item) => (
            <button
              key={item.id}
              className={`mobile-drawer-item ${screen === item.id ? 'mobile-drawer-item-active' : ''}`}
              onClick={() => jump(item.id)}
            >
              <span className="mobile-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
          {isAdmin && (
            <button
              className={`mobile-drawer-item ${screen === 'admin' ? 'mobile-drawer-item-active' : ''}`}
              onClick={() => jump('admin')}
            >
              <span className="mobile-nav-icon">🛠</span>
              <span>Admin</span>
            </button>
          )}
        </div>

        <div className="mobile-drawer-title">Team</div>
        <div className="mobile-drawer-row">
          <button
            className="btn btn-tiny"
            onClick={() => { if (typeof window !== 'undefined' && team) window.open(`${publicOrigin()}/team/${team.id}`, '_blank'); }}
            disabled={!team}
          >🔗 Public profile</button>
          <button className="btn btn-tiny" onClick={exportTeam} disabled={!team}>⬇ Export team</button>
        </div>

        <div className="mobile-drawer-title">Shortcuts</div>
        <div className="mobile-drawer-row">
          <button
            className="btn btn-tiny"
            onClick={() => { if (typeof window !== 'undefined') window.open(`${publicOrigin()}/hof`, '_blank'); }}
          >🏛 Hall of Fame</button>
          <button
            className="btn btn-tiny"
            onClick={() => { if (typeof window !== 'undefined') window.open(`${publicOrigin()}/stats`, '_blank'); }}
          >📊 Stats</button>
          <button
            className="btn btn-tiny"
            onClick={() => {
              startBackgroundMusic();
              toggleMusicMuted();
              // Force a re-render by re-opening (dropped state).
              setDrawerOpen(true);
            }}
          >{getSoundSettings().musicMuted ? '🔇 Music' : '🎵 Music'}</button>
        </div>

        <div className="mobile-drawer-row">
          <button className="btn btn-danger" onClick={disconnect} style={{ width: '100%' }}>⏻ Disconnect</button>
        </div>
      </aside>
    </>
  );
}
