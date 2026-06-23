import { useState } from 'react';
import type { Team } from '../types';

/**
 * Team logo with graceful fallback:
 *   1. Try local PNG at public/teams/{teamId}.png — drop your own logos here
 *   2. On miss, fall back to a colored tag chip with the team's tag text
 *
 * HLTV CDN was tried but returns 403 Forbidden for all hotlinked images
 * (their anti-scraping protection). team.hltvId is still kept on the data
 * model so you can swap in alternate image sources later (e.g., a self-hosted
 * mirror or Wikimedia Commons URLs).
 */
export function TeamLogo({ team, size = 'md' }: { team: Team; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const px = size === 'sm' ? 24 : size === 'lg' ? 64 : 40;

  // Mod-supplied logo takes priority over file-based lookup.
  const src = team.customLogoUrl ?? `${import.meta.env.BASE_URL}teams/${team.id}.png`;

  if (!failed) {
    return (
      <img
        src={src}
        alt={team.name}
        width={px}
        height={px}
        loading="lazy"
        onError={() => setFailed(true)}
        title={team.name}
        style={{
          width: px,
          height: px,
          objectFit: 'contain',
          flex: 'none',
        }}
      />
    );
  }
  // Fallback: colored tag chip
  return (
    <span
      title={team.name}
      style={{
        width: px,
        height: px,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--panel-2, #1a1d24)',
        border: '1px solid var(--border, #2a2f3a)',
        borderRadius: 4,
        color: 'var(--accent, #e0a060)',
        fontWeight: 800,
        fontSize: size === 'sm' ? 9 : size === 'lg' ? 16 : 11,
        letterSpacing: 0.5,
      }}
    >
      {team.tag}
    </span>
  );
}
