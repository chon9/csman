// Reusable clickable team display — logo + name that navigates to TeamProfile.
// Use this wherever a team is mentioned in the app so users can drill down to
// any team's roster from any context.

import { useGame } from '../store/gameStore';
import { TeamLogo } from './TeamLogo';
import type { Team } from '../types';

interface Props {
  team: Team;
  /** Logo size — sm/md/lg. md is default. */
  logoSize?: 'sm' | 'md' | 'lg';
  /** Show 'tag' (VIT) or 'name' (Team Vitality) text. Defaults to 'name'. */
  display?: 'tag' | 'name' | 'both';
  /** Hide the logo entirely (for compact contexts). */
  noLogo?: boolean;
  /** Extra class on the wrapper. */
  className?: string;
}

export function TeamLink({ team, logoSize = 'sm', display = 'name', noLogo = false, className }: Props) {
  const openTeam = useGame((s) => s.openTeam);
  return (
    <span
      className={`team-link ${className ?? ''}`}
      onClick={(e) => {
        e.stopPropagation();
        openTeam(team.id);
      }}
      title={`Open ${team.name} profile`}
    >
      {!noLogo && <TeamLogo team={team} size={logoSize} />}
      {display === 'tag' ? (
        <span className="team-link-text">{team.tag}</span>
      ) : display === 'both' ? (
        <span className="team-link-text">
          {team.name} <span className="muted">{team.tag}</span>
        </span>
      ) : (
        <span className="team-link-text">{team.name}</span>
      )}
    </span>
  );
}
