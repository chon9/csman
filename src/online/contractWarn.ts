// Helper that powers the "this match will deplete your starter's contract"
// confirmation prompt. Surfaces ONLY for first-five starters — bench
// players don't accrue match wages so their contract is fine.

import type { OnlineTeam, PublicPlayer } from './protocol';
import type { Player } from '../types';

/** Returns the prompt text + at-risk player nicknames when at least one
 *  starter would be left with 0 contract duels after the next match.
 *  Returns null if nobody's at the brink. */
export function starterContractWarning(
  team: OnlineTeam | null,
  players: Record<string, Player | PublicPlayer>,
): { message: string; nicks: string[] } | null {
  if (!team) return null;
  const starters = team.playerIds.slice(0, 5).map((id) => players[id]).filter(Boolean) as Array<Player | PublicPlayer>;
  const atRisk = starters
    .map((p) => ({ nick: p.nickname, remaining: ('contract' in p ? p.contract?.duelsRemaining : undefined) }))
    .filter((p) => typeof p.remaining === 'number' && p.remaining <= 1);
  if (atRisk.length === 0) return null;
  const nicks = atRisk.map((p) => p.nick);
  const list = nicks.join(', ');
  const message =
    `Starting this match will use the LAST contract duel for: ${list}.\n\n` +
    `They will walk to free agency after the match unless you renew their contract first ` +
    `(Home → Roster → Renew).\n\n` +
    `Continue with the match?`;
  return { message, nicks };
}
