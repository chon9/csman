import { useState } from 'react';

interface Props {
  playerId: string;
  nickname: string;
  nationality: string; // ISO-2 uppercase
  size?: number;
  side?: 'T' | 'CT' | null;
  /** HLTV player id — enables lazy bodyshot from img-cdn.hltv.org */
  hltvId?: number;
}

// Deterministic background hue per player
function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * Player portrait. Uses public/players/<playerId>.png when present (drop in real
 * photos there), otherwise renders a generated avatar with initials and flag.
 */
export default function PlayerAvatar({ playerId, nickname, nationality, size = 32, side }: Props) {
  // HLTV CDN returns 403 for hotlinked bodyshots (anti-scraping). Local PNG
  // drop-in at public/players/{playerId}.png is the supported path; falls back
  // to a generated initials avatar.
  const [imgFailed, setImgFailed] = useState(false);
  const [flagFailed, setFlagFailed] = useState(false);

  const ring = side === 'T' ? '#f2a13c' : side === 'CT' ? '#6aa7ec' : '#2a2f3a';
  const initials = nickname.slice(0, 2);

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        width: size,
        height: size,
        flex: 'none',
      }}
    >
      {!imgFailed ? (
        <img
          src={`${import.meta.env.BASE_URL}players/${playerId}.png`}
          alt={nickname}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setImgFailed(true)}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            border: `2px solid ${ring}`,
            background: '#1d2129',
            display: 'block',
          }}
        />
      ) : (
        <span
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            border: `2px solid ${ring}`,
            background: `linear-gradient(135deg, hsl(${hueOf(playerId)} 30% 26%), hsl(${hueOf(playerId)} 35% 16%))`,
            color: '#e8ecf3',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(9, size * 0.34),
            fontWeight: 800,
            letterSpacing: 0.3,
            boxSizing: 'border-box',
          }}
        >
          {initials}
        </span>
      )}
      {!flagFailed && nationality && (
        <img
          src={`https://flagcdn.com/w20/${nationality.toLowerCase()}.png`}
          alt={nationality}
          onError={() => setFlagFailed(true)}
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: Math.max(12, size * 0.42),
            borderRadius: 2,
            border: '1px solid #0d0f14',
            display: 'block',
          }}
        />
      )}
    </span>
  );
}
