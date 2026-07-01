// Primary navigation rail for all post-login online screens. Replaces the
// dense top-bar button row on OnlineHomeScreen — moves every "go to" link
// here, leaves the top of each screen for status + screen-specific actions.

import { useEffect, useState } from 'react';
import { useOnline } from '../onlineStore';
import type { OnlineScreen } from '../onlineStore';
import { publicOrigin } from '../serverUrl';
import { formatGameAge } from '../dateHelpers';
import { getSoundSettings, toggleMusicMuted, startBackgroundMusic } from '../../sound/soundManager';
import RankBadge from './RankBadge';

interface NavItem {
  id: OnlineScreen;
  label: string;
  icon: string;
  // Optional badge text (e.g. "!" for the daily bonus). Empty → no badge.
  badge?: string;
}

const PRIMARY: NavItem[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'tactics', label: 'Tactics', icon: '🎯' },
  { id: 'challenges', label: 'PvP Lobby', icon: '⚔' },
  { id: 'tournaments', label: 'Tournaments', icon: '🏆' },
  { id: 'market', label: 'Market', icon: '💱' },
  { id: 'cases', label: 'Cases', icon: '📦' },
  { id: 'boosters', label: 'Boosters', icon: '🎴' },
  { id: 'massage', label: 'Massage', icon: '💆' },
  { id: 'mini-games', label: 'Mini Games', icon: '🎮' },
  { id: 'ai-bets', label: 'AI Betting', icon: '🎰' },
  { id: 'real-estate', label: 'Real Estate', icon: '🏘' },
  { id: 'ewallet', label: 'E-Wallet', icon: '💳' },
  { id: 'streaming', label: 'Streaming', icon: '📺' },
  { id: 'scout', label: 'Scout', icon: '🔬' },
  { id: 'history', label: 'History', icon: '📜' },
  { id: 'leaderboard', label: 'Leaderboard', icon: '📈' },
];

export default function OnlineSidebar(): React.ReactElement {
  const screen = useOnline((s) => s.screen);
  const go = useOnline((s) => s.go);
  const isAdmin = useOnline((s) => s.isAdmin);
  const team = useOnline((s) => s.team);
  const status = useOnline((s) => s.status);
  const onlineTeams = useOnline((s) => s.onlineTeams);
  const dailyBonusAvailable = useOnline((s) => s.dailyBonusAvailable);
  const claimDailyBonus = useOnline((s) => s.claimDailyBonus);
  const nextTickUtcMs = useOnline((s) => s.nextTickUtcMs);
  const refresh = useOnline((s) => s.refreshState);
  const disconnect = useOnline((s) => s.disconnect);
  const exportTeam = useOnline((s) => s.exportTeam);

  // 1Hz heartbeat for the countdown display + auto-refresh when a tick lands.
  const [tickClock, setTickClock] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTickClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // When the boundary has crossed (countdown went negative) and we still
  // have a stale nextTickUtcMs, fire a refresh so the server re-anchors us.
  useEffect(() => {
    if (nextTickUtcMs > 0 && Date.now() >= nextTickUtcMs + 1000) refresh();
  }, [tickClock, nextTickUtcMs, refresh]);

  const profileUrl = team ? `${publicOrigin()}/team/${team.id}` : '';

  return (
    <aside className="osb">
      {/* ===== Brand / team badge ===== */}
      <div className="osb-brand">
        <div className="osb-brand-mark" style={team?.primaryColor ? { background: `linear-gradient(135deg, ${team.primaryColor}, ${team.primaryColor}88)`, color: '#0a0d12' } : undefined}>
          {team?.logoId || team?.tag.slice(0, 2).toUpperCase() || '··'}
        </div>
        <div className="osb-brand-text">
          <div className="osb-brand-name">{team?.name ?? 'CS2 Manager'}</div>
          <div className="osb-brand-meta">
            <span className={`osb-dot osb-dot-${status}`} />
            {status} · {onlineTeams} online
          </div>
          {team && (
            <div style={{ marginTop: 6 }}>
              <RankBadge mmr={team.mmr} placementMatchesPlayed={team.placementMatchesPlayed} size="full" showProgress />
            </div>
          )}
        </div>
      </div>

      {/* ===== Cash + daily bonus pill (prominent) ===== */}
      {team && (
        <div className="osb-cash">
          <div className="osb-cash-label">Cash</div>
          <div className="osb-cash-amount">${team.money.toLocaleString()}</div>
          {dailyBonusAvailable && (
            <button className="osb-daily" onClick={claimDailyBonus} title="Claim $10,000 daily login bonus">
              🎁 Claim daily $10k
            </button>
          )}
        </div>
      )}

      {/* ===== Game clock + next-tick countdown ===== */}
      {team && nextTickUtcMs > 0 && (
        <div className="osb-tick">
          <div className="osb-tick-row">
            <span className="osb-tick-label">Game age</span>
            <span className="osb-tick-value" title={`Day ${team.day}`}>{formatGameAge(team.day)}</span>
          </div>
          <div className="osb-tick-row">
            <span className="osb-tick-label">Next tick</span>
            <span className="osb-tick-value osb-tick-countdown" title="Time auto-advances 6 in-game days per real day (every 4 hours UTC)">
              {formatCountdown(Math.max(0, nextTickUtcMs - tickClock))}
            </span>
          </div>
        </div>
      )}

      {/* ===== Primary nav ===== */}
      <nav className="osb-nav">
        {PRIMARY.map((item) => (
          <button
            key={item.id}
            className={`osb-nav-item ${screen === item.id ? 'osb-nav-item-active' : ''}`}
            onClick={() => go(item.id)}
          >
            <span className="osb-nav-icon">{item.icon}</span>
            <span className="osb-nav-label">{item.label}</span>
            {item.badge && <span className="osb-nav-badge">{item.badge}</span>}
          </button>
        ))}
        {isAdmin && (
          <button
            className={`osb-nav-item osb-nav-admin ${screen === 'admin' ? 'osb-nav-item-active' : ''}`}
            onClick={() => go('admin')}
          >
            <span className="osb-nav-icon">🛠</span>
            <span className="osb-nav-label">Admin</span>
          </button>
        )}
      </nav>

      {/* ===== Secondary footer ===== */}
      <div className="osb-footer">
        <button
          className="osb-footer-btn"
          onClick={() => { if (typeof window !== 'undefined') window.open(`${publicOrigin()}/hof`, '_blank'); }}
          title="Hall of Fame (opens in new tab)"
        >🏛 HoF</button>
        <button
          className="osb-footer-btn"
          onClick={() => { if (typeof window !== 'undefined') window.open(`${publicOrigin()}/stats`, '_blank'); }}
          title="Server stats (opens in new tab)"
        >📊 Stats</button>
        <button
          className="osb-footer-btn"
          onClick={() => { navigator.clipboard?.writeText(profileUrl); }}
          title={`Copy public team page link: ${profileUrl}`}
          disabled={!team}
        >🔗 Profile link</button>
        <button
          className="osb-footer-btn"
          onClick={exportTeam}
          title="Download a portable .csm.json snapshot"
          disabled={!team}
        >⬇ Export team</button>
        <button
          className="osb-footer-btn"
          onClick={() => {
            // Ensure the music channel is booted (first-click gesture) then toggle.
            startBackgroundMusic();
            toggleMusicMuted();
            setTickClock(Date.now()); // force re-render so the label updates
          }}
          title="Toggle background music"
        >{getSoundSettings().musicMuted ? '🔇 Music' : '🎵 Music'}</button>
        <button className="osb-footer-btn osb-footer-disconnect" onClick={disconnect}>
          ⏻ Disconnect
        </button>
      </div>
    </aside>
  );
}

/** Format ms remaining as HH:MM:SS, dropping leading zeros for hours. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
