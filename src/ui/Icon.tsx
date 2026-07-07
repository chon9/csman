// Shared icon set — inline SVGs, no dependency.
//
// Design constraints (Midnight Navy + Teal redesign):
//   - Single stroke, 1.6px, rounded caps. Reads at 12–24 px.
//   - `currentColor` throughout so the caller controls hue via CSS.
//   - Named after semantic use (home, cash, inbox) not visual shape,
//     so swapping the pictogram later doesn't require rename cascades.
//   - No emoji or bitmap fallbacks — chrome purge is total.
//
// Add new icons with an <IconMap> entry keyed by name. Keep viewBox
// consistent at 0 0 24 24 so callers can size uniformly.

import type { CSSProperties } from 'react';

export type IconName =
  | 'home' | 'squad' | 'tactics' | 'inbox' | 'market' | 'history'
  | 'leaderboard' | 'tournament' | 'training' | 'cash' | 'wallet'
  | 'sponsor' | 'coach' | 'players' | 'chart' | 'search' | 'shield'
  | 'settings' | 'help' | 'bell' | 'cases' | 'stream' | 'realestate'
  | 'bet' | 'mini-games' | 'boosters' | 'massage' | 'news' | 'scout'
  | 'admin' | 'daily' | 'ranking' | 'trophy' | 'star' | 'check'
  | 'x' | 'chevron-right' | 'chevron-left' | 'chevron-down' | 'plus'
  | 'minus' | 'play' | 'pause' | 'skip-forward' | 'download' | 'upload'
  | 'lock' | 'unlock' | 'globe' | 'mail' | 'megaphone' | 'clock'
  | 'flag' | 'target' | 'sparkle' | 'circle-dot' | 'arrow-up'
  | 'arrow-down' | 'refresh' | 'menu' | 'user' | 'users'
  | 'building' | 'briefcase' | 'gift' | 'zap' | 'shield-check'
  | 'trending-up' | 'trending-down' | 'dumbbell' | 'crosshair'
  | 'radio' | 'wifi' | 'volume' | 'music' | 'log-out' | 'log-in'
  | 'money-bag' | 'bar-chart' | 'pie-chart' | 'file' | 'folder'
  | 'copy' | 'external-link';

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** Render an icon by semantic name. Sized via the `size` prop (default 16),
 *  colored via `currentColor` so parent text-color drives the hue. */
export default function Icon({
  name, size = 16, strokeWidth = 1.6, className, style, title,
}: IconProps): React.ReactElement {
  const path = ICON_PATHS[name];
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {path}
    </svg>
  );
}

// Path bodies. Keep them terse — one <g> or a series of <path>s.
// Sourced from Lucide (MIT) — pared down where possible.
const ICON_PATHS: Record<IconName, React.ReactElement> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>,
  squad: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" /><path d="M15 20c0-2 1.5-3.5 4-3.5s2.5 1.5 2.5 3.5" /></>,
  tactics: <><path d="M4 4h16v16H4z" /><path d="M4 12h16" /><path d="M12 4v16" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="16" cy="16" r="1" fill="currentColor" /></>,
  inbox: <><path d="M3 12h6l1.5 2h3L15 12h6" /><path d="M4 6h16l1 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4l1-8z" /></>,
  market: <><path d="M4 6h16l-1 12H5L4 6z" /><path d="M8 6V4a4 4 0 0 1 8 0v2" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  leaderboard: <><path d="M4 20h4v-8H4v8z" /><path d="M10 20h4V4h-4v16z" /><path d="M16 20h4v-11h-4v11z" /></>,
  tournament: <><path d="M8 4h8v4a4 4 0 1 1-8 0V4z" /><path d="M8 8H4v2a3 3 0 0 0 4 3" /><path d="M16 8h4v2a3 3 0 0 1-4 3" /><path d="M12 14v3" /><path d="M8 21h8" /><path d="M9 21v-4h6v4" /></>,
  training: <><path d="M6 6l-2 2 4 4-4 4 2 2 4-4 4 4 2-2-4-4 4-4-2-2-4 4-4-4z" /></>,
  cash: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4" /><path d="M18 10v4" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13v4H5a2 2 0 0 1-2-2z" /><path d="M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" /><circle cx="17" cy="14" r="1" fill="currentColor" /></>,
  sponsor: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>,
  coach: <><circle cx="12" cy="8" r="3" /><path d="M6 21c0-3 2.5-6 6-6s6 3 6 6" /><path d="M15 3l2 2 3-3" /></>,
  players: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" /><path d="M15 20c0-2 1.5-3.5 4-3.5s2.5 1.5 2.5 3.5" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2.5-2.5 4.5" /><circle cx="12" cy="17" r="0.5" fill="currentColor" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  cases: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>,
  stream: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M10 9l5 3-5 3V9z" fill="currentColor" /></>,
  realestate: <><path d="M3 21h18" /><path d="M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></>,
  bet: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="16" cy="16" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  'mini-games': <><rect x="2" y="7" width="20" height="10" rx="3" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="16" cy="10.5" r="1" fill="currentColor" /><circle cx="17.5" cy="13" r="1" fill="currentColor" /></>,
  boosters: <><path d="M12 3l3 6 6 1-4.5 4.5L18 21l-6-3-6 3 1.5-6.5L3 10l6-1 3-6z" /></>,
  massage: <><circle cx="12" cy="6" r="2.5" /><path d="M12 8v6" /><path d="M8 14h8v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4z" /></>,
  news: <><path d="M4 4h13a2 2 0 0 1 2 2v14H4V4z" /><path d="M19 8h2v11a1 1 0 0 1-1 1" /><path d="M8 8h7" /><path d="M8 12h7" /><path d="M8 16h4" /></>,
  scout: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /><path d="M11 8v3l2 2" /></>,
  admin: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>,
  daily: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 3v4" /><path d="M16 3v4" /><circle cx="12" cy="14" r="2" /></>,
  ranking: <><path d="M4 20h4v-8H4v8z" /><path d="M10 20h4V4h-4v16z" /><path d="M16 20h4v-11h-4v11z" /></>,
  trophy: <><path d="M8 4h8v4a4 4 0 1 1-8 0V4z" /><path d="M8 8H4v2a3 3 0 0 0 4 3" /><path d="M16 8h4v2a3 3 0 0 1-4 3" /><path d="M12 14v3" /><path d="M8 21h8" /><path d="M9 21v-4h6v4" /></>,
  star: <path d="M12 3l3 6 6 1-4.5 4.5L18 21l-6-3-6 3 1.5-6.5L3 10l6-1 3-6z" />,
  check: <path d="M4 12l5 5 11-11" />,
  x: <><path d="M5 5l14 14" /><path d="M19 5L5 19" /></>,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  play: <path d="M7 4l14 8-14 8V4z" fill="currentColor" />,
  pause: <><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></>,
  'skip-forward': <><path d="M4 4l12 8-12 8V4z" fill="currentColor" /><path d="M20 4v16" /></>,
  download: <><path d="M12 3v14" /><path d="M6 12l6 6 6-6" /><path d="M4 21h16" /></>,
  upload: <><path d="M12 21V7" /><path d="M6 12l6-6 6 6" /><path d="M4 3h16" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7-3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c3 3 4.5 6.5 4.5 9s-1.5 6-4.5 9c-3-3-4.5-6.5-4.5-9s1.5-6 4.5-9z" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  megaphone: <><path d="M3 11v3l14 5V6L3 11z" /><path d="M17 8v9" /><path d="M8 15l1 5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  flag: <><path d="M5 3v18" /><path d="M5 4h13l-3 4 3 4H5" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  sparkle: <><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="M5.6 5.6l2.8 2.8" /><path d="M15.6 15.6l2.8 2.8" /><path d="M5.6 18.4l2.8-2.8" /><path d="M15.6 8.4l2.8-2.8" /></>,
  'circle-dot': <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" fill="currentColor" /></>,
  'arrow-up': <><path d="M12 20V4" /><path d="M5 11l7-7 7 7" /></>,
  'arrow-down': <><path d="M12 4v16" /><path d="M5 13l7 7 7-7" /></>,
  refresh: <><path d="M4 4v6h6" /><path d="M20 20v-6h-6" /><path d="M4 10a8 8 0 0 1 14.9-2" /><path d="M20 14a8 8 0 0 1-14.9 2" /></>,
  menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  users: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" /><path d="M15 20c0-2 1.5-3.5 4-3.5s2.5 1.5 2.5 3.5" /></>,
  building: <><rect x="4" y="3" width="16" height="18" /><path d="M8 7h2" /><path d="M14 7h2" /><path d="M8 11h2" /><path d="M14 11h2" /><path d="M10 21v-4h4v4" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  gift: <><rect x="3" y="8" width="18" height="6" /><path d="M4 14v7h16v-7" /><path d="M12 21V8" /><path d="M12 8c-2-3-6-1-6 1s1 2 3 2" /><path d="M12 8c2-3 6-1 6 1s-1 2-3 2" /></>,
  zap: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  'shield-check': <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>,
  'trending-up': <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  'trending-down': <><path d="M3 7l6 6 4-4 8 8" /><path d="M14 17h7v-7" /></>,
  dumbbell: <><path d="M6 8v8" /><path d="M4 10v4" /><path d="M18 8v8" /><path d="M20 10v4" /><path d="M6 12h12" /></>,
  crosshair: <><circle cx="12" cy="12" r="9" /><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /></>,
  radio: <><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M5.5 5.5a9 9 0 0 0 0 13" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>,
  wifi: <><path d="M5 12a10 10 0 0 1 14 0" /><path d="M8 15a6 6 0 0 1 8 0" /><path d="M11 18h2" /></>,
  volume: <><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 8a5 5 0 0 1 0 8" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  'log-out': <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
  'log-in': <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h12" /></>,
  'money-bag': <><path d="M6 8h12l2 10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3L6 8z" /><path d="M9 4h6l-1 4h-4l-1-4z" /></>,
  'bar-chart': <><path d="M4 20V10" /><path d="M12 20V4" /><path d="M20 20v-8" /></>,
  'pie-chart': <><path d="M12 3v9l7 5" /><circle cx="12" cy="12" r="9" /></>,
  file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" /><path d="M14 3v6h6" /></>,
  folder: <><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  'external-link': <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
};
