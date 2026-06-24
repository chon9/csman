// Primary navigation rail for all post-login online screens. Replaces the
// dense top-bar button row on OnlineHomeScreen — moves every "go to" link
// here, leaves the top of each screen for status + screen-specific actions.

import { useOnline } from '../onlineStore';
import type { OnlineScreen } from '../onlineStore';
import { publicOrigin } from '../serverUrl';

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
  const disconnect = useOnline((s) => s.disconnect);
  const exportTeam = useOnline((s) => s.exportTeam);

  const profileUrl = team ? `${publicOrigin()}/team/${team.id}` : '';

  return (
    <aside className="osb">
      {/* ===== Brand / team badge ===== */}
      <div className="osb-brand">
        <div className="osb-brand-mark">{team?.tag.slice(0, 2) ?? '··'}</div>
        <div className="osb-brand-text">
          <div className="osb-brand-name">{team?.name ?? 'CS2 Manager'}</div>
          <div className="osb-brand-meta">
            <span className={`osb-dot osb-dot-${status}`} />
            {status} · {onlineTeams} online
          </div>
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
        <button className="osb-footer-btn osb-footer-disconnect" onClick={disconnect}>
          ⏻ Disconnect
        </button>
      </div>
    </aside>
  );
}
