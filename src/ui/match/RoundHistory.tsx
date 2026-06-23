import type { RoundResult } from '../../types';

interface Props {
  rounds: RoundResult[]; // only revealed rounds (no spoilers)
  teamAId: string;
  teamATag: string;
  teamBTag: string;
}

const T_COLOR = '#f2a13c';
const CT_COLOR = '#6aa7ec';

function WinIcon({ reason, color }: { reason: RoundResult['reason']; color: string }) {
  const s = { width: 13, height: 13, display: 'block' } as const;
  switch (reason) {
    case 'elimination': // skull-ish
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <circle cx="8" cy="7" r="5" fill={color} />
          <rect x="5.5" y="10" width="5" height="3.5" rx="1" fill={color} />
          <circle cx="6.2" cy="6.5" r="1.3" fill="#10131a" />
          <circle cx="9.8" cy="6.5" r="1.3" fill="#10131a" />
        </svg>
      );
    case 'bomb': // bomb burst
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <circle cx="8" cy="9" r="4.5" fill={color} />
          <rect x="7" y="2.5" width="2" height="3" fill={color} />
          <path d="M9.5 2 L12 0.5 L11 3.5 Z" fill={color} />
        </svg>
      );
    case 'defuse': // wire cutter / defuse kit
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <rect x="2.5" y="6.5" width="11" height="4" rx="1.2" fill={color} />
          <rect x="5" y="3.5" width="6" height="3" rx="1" fill="none" stroke={color} strokeWidth="1.6" />
        </svg>
      );
    case 'time': // clock
      return (
        <svg viewBox="0 0 16 16" style={s}>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="1.8" />
          <path d="M8 5 V8 L10.5 9.5" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

/** HLTV-style two-row round timeline: one row per team, icon in the winner's row. */
export default function RoundHistory({ rounds, teamAId, teamATag, teamBTag }: Props) {
  if (rounds.length === 0) return null;

  // group: regulation halves of 12, then OT blocks of 6
  const groups: RoundResult[][] = [];
  for (const r of rounds) {
    const idx = r.roundNo <= 12 ? 0 : r.roundNo <= 24 ? 1 : 2 + Math.floor((r.roundNo - 25) / 6);
    (groups[idx] = groups[idx] ?? []).push(r);
  }

  return (
    <div className="rh-wrap panel">
      <div className="rh-rows">
        <div className="rh-tag">{teamATag}</div>
        <div className="rh-tag">{teamBTag}</div>
      </div>
      <div className="rh-scroll">
        {groups.map((g, gi) =>
          g ? (
            <div key={gi} className="rh-group">
              {g.map((r) => {
                const aWon = r.winnerTeamId === teamAId;
                // side the winner played that round
                const color = r.winnerSide === 'T' ? T_COLOR : CT_COLOR;
                return (
                  <div key={r.roundNo} className="rh-col" title={`Round ${r.roundNo}: ${r.winnerSide} win (${r.reason})`}>
                    <div className="rh-cell">{aWon ? <WinIcon reason={r.reason} color={color} /> : null}</div>
                    <div className="rh-no">{r.roundNo}</div>
                    <div className="rh-cell">{!aWon ? <WinIcon reason={r.reason} color={color} /> : null}</div>
                  </div>
                );
              })}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
