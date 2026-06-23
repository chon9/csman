// FM-style starting-five formation pitch — reused across Tactics, Squad, and
// Team Profile so the lineup visual stays in sync everywhere.
//
// For the USER team we read tactics.roleSlots (the engine's actual lineup).
// For other teams we derive a 5-slot formation from their first 5 players'
// natural roles, so any team profile can be inspected with the same layout.

import { useGame } from '../store/gameStore';
import { familiarityTier, roleFamiliarityPoints } from '../sim/playerAnalytics';
import type { FamiliarityTier } from '../sim/playerAnalytics';
import type { Player, PlayerRole, RoleSlot, Team } from '../types';

function initials(p: Player): string {
  const n = p.nickname.trim();
  if (n.length <= 3) return n.toUpperCase();
  const parts = n.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function tierClass(tier: FamiliarityTier): string {
  switch (tier) {
    case 'Natural': return 'fam-natural';
    case 'Accomplished': return 'fam-accomplished';
    case 'Competent': return 'fam-competent';
    case 'Unconvincing': return 'fam-unconvincing';
    case 'Awkward': return 'fam-awkward';
  }
}

/** Derive a 5-slot RoleSlot[] for any team — uses saved tactics for user,
 *  else falls back to the team's first 5 by tier + each player's natural role. */
export function deriveFormation(
  team: Team,
  players: Record<string, Player>,
  userRoleSlots?: RoleSlot[],
): RoleSlot[] {
  if (team.isUser && userRoleSlots && userRoleSlots.length === 5) {
    return userRoleSlots;
  }
  // Pick top 5 by squad tier (first-team first), preserving playerIds order.
  const tierRank = (p: Player): number => {
    const t = p.squadTier ?? 'first';
    return t === 'first' ? 0 : t === 'reserve' ? 1 : 2;
  };
  const lineup = team.playerIds
    .map((id) => players[id])
    .filter((p): p is Player => !!p)
    .sort((a, b) => tierRank(a) - tierRank(b))
    .slice(0, 5);
  // Use each player's natural role for the slot.
  const fillRoles: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support'];
  return Array.from({ length: 5 }).map((_, i) => ({
    role: lineup[i]?.role ?? fillRoles[i],
    duty: 'balanced' as RoleSlot['duty'],
    playerId: lineup[i]?.id ?? null,
  }));
}

interface Props {
  team: Team;
  /** Saved role slots (user team only). Other teams: pass undefined. */
  slots?: RoleSlot[];
  /** Click handler — only the user's pitch needs this; non-interactive otherwise. */
  onSlotClick?: (idx: number) => void;
  /** Index currently selected (shown highlighted). */
  selectedIdx?: number | null;
  /** Compact mode — smaller cards for sidebar/embed use. */
  compact?: boolean;
}

export function FormationPitch({ team, slots, onSlotClick, selectedIdx, compact }: Props) {
  const game = useGame((s) => s.game)!;
  const resolved = deriveFormation(team, game.players, slots);

  return (
    <div className={`formation-pitch ${compact ? 'formation-pitch-compact' : ''}`}>
      {resolved.map((slot, idx) => {
        const player = slot.playerId ? game.players[slot.playerId] : null;
        const fam = player ? familiarityTier(roleFamiliarityPoints(player, slot.role)) : null;
        const isSelected = selectedIdx === idx;
        const injured = !!player?.injury;
        const interactive = !!onSlotClick;
        const className = `formation-slot ${fam ? tierClass(fam) : 'empty'} ${
          isSelected ? 'selected' : ''
        } ${injured ? 'formation-slot-injured' : ''}`;
        const inner = (
          <>
            <span className="slot-role-label">{slot.role}</span>
            <span className="slot-initials">{player ? initials(player) : '—'}</span>
            <span className="slot-nick">{player ? player.nickname : 'Vacant'}</span>
            {fam && !compact && <span className={`slot-fam-pill ${tierClass(fam)}`}>{fam}</span>}
            {slot.duty && slot.duty !== 'balanced' && !compact && (
              <span className={`slot-duty-pill duty-${slot.duty}`}>{slot.duty}</span>
            )}
            {injured && <span className="slot-inj-pill">🚑 INJ</span>}
          </>
        );
        return interactive ? (
          <button
            key={idx}
            type="button"
            className={className}
            onClick={() => onSlotClick!(idx)}
            title={player ? `${player.nickname} — ${fam ?? 'unrated'} at ${slot.role}` : `Vacant ${slot.role} slot`}
          >
            {inner}
          </button>
        ) : (
          <div
            key={idx}
            className={className}
            title={player ? `${player.nickname} (${slot.role})` : `Vacant ${slot.role} slot`}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
