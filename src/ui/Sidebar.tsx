import { useState } from 'react';
import { useGame } from '../store/gameStore';
import type { Screen } from '../store/gameStore';
import { TeamLogo } from './TeamLogo';
import { getSoundSettings, setSoundSettings, unlockAudio } from '../sound/soundManager';

const NAV: { screen: Screen; label: string }[] = [
  { screen: 'home', label: 'Home' },
  { screen: 'inbox', label: 'Inbox' },
  { screen: 'news', label: 'News' },
  { screen: 'manager', label: 'Manager' },
  { screen: 'squad', label: 'Squad' },
  { screen: 'tactics', label: 'Tactics' },
  { screen: 'training', label: 'Training' },
  { screen: 'staff', label: 'Staff' },
  { screen: 'schedule', label: 'Schedule' },
  { screen: 'transfers', label: 'Transfers' },
  { screen: 'scouting', label: 'Scouting' },
  { screen: 'finances', label: 'Finances' },
  { screen: 'rankings', label: 'Rankings' },
  { screen: 'history', label: 'History' },
  { screen: 'halloffame', label: 'Hall of Fame' },
  { screen: 'cases', label: 'CS2 Cases' },
  { screen: 'sportsbook', label: 'Bc Gaming' },
  { screen: 'mods', label: 'Mods' },
];

export default function Sidebar() {
  const game = useGame((s) => s.game)!;
  const screen = useGame((s) => s.screen);
  const go = useGame((s) => s.go);
  const saveGame = useGame((s) => s.saveGame);
  const [saved, setSaved] = useState(false);

  const team = game.teams[game.userTeamId];
  const unattached = !!game.managerUnattached;
  const unread = game.inbox.filter((m) => !m.read).length;
  const [sound, setSound] = useState(getSoundSettings());

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        {unattached ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div className="sidebar-tag" style={{ background: '#b46a1f', color: 'white' }}>—</div>
            </div>
            <div className="sidebar-team">Between Jobs</div>
            <div className="sidebar-save-name">{game.manager?.name ?? game.saveName}</div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <TeamLogo team={team} size="md" />
              <div className="sidebar-tag">{team.tag}</div>
            </div>
            <div className="sidebar-team">{team.name}</div>
            <div className="sidebar-save-name">{game.saveName}</div>
          </>
        )}
      </div>
      <div className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.screen}
            className={`nav-item ${screen === item.screen ? 'active' : ''}`}
            onClick={() => go(item.screen)}
          >
            <span>{item.label}</span>
            {item.screen === 'inbox' && unread > 0 && <span className="badge">{unread}</span>}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <div className="sound-controls">
          <button
            className={`sound-toggle ${sound.muted ? 'muted' : ''}`}
            title={sound.muted ? 'Unmute' : 'Mute'}
            onClick={() => {
              unlockAudio();
              setSoundSettings({ muted: !sound.muted });
              setSound(getSoundSettings());
            }}
          >
            {sound.muted ? '🔇' : sound.volume > 0.66 ? '🔊' : sound.volume > 0.33 ? '🔉' : '🔈'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sound.volume}
            onChange={(e) => {
              unlockAudio();
              setSoundSettings({ volume: Number(e.target.value), muted: false });
              setSound(getSoundSettings());
            }}
            title={`Volume ${Math.round(sound.volume * 100)}%`}
          />
        </div>
        <button
          className="btn btn-block"
          onClick={() => {
            saveGame();
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
        >
          {saved ? 'Saved' : 'Save Game'}
        </button>
      </div>
    </nav>
  );
}
