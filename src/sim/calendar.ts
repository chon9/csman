import type { Team, Tournament, TournamentTier } from '../types';

// Season tournament calendar generator — mirrors the real CS2 circuit shape
interface EventTemplate {
  name: string;
  tier: TournamentTier;
  prizePool: number;
  startMonth: number; // 0-based
  startDay: number;
  durationDays: number;
  teamCount: number;
  isMajor: boolean;
}

const SEASON_EVENTS: EventTemplate[] = [
  { name: 'BLAST Bounty Spring', tier: 'A', prizePool: 500000, startMonth: 0, startDay: 20, durationDays: 9, teamCount: 16, isMajor: false },
  { name: 'IEM Katowice', tier: 'S', prizePool: 1000000, startMonth: 1, startDay: 5, durationDays: 11, teamCount: 16, isMajor: false },
  { name: 'RMR Spring', tier: 'B', prizePool: 300000, startMonth: 1, startDay: 22, durationDays: 7, teamCount: 16, isMajor: false },
  { name: 'ESL Pro League Season 1', tier: 'A', prizePool: 750000, startMonth: 2, startDay: 8, durationDays: 12, teamCount: 16, isMajor: false },
  { name: 'BLAST Open Spring', tier: 'B', prizePool: 400000, startMonth: 3, startDay: 2, durationDays: 8, teamCount: 16, isMajor: false },
  { name: 'IEM Dallas', tier: 'A', prizePool: 750000, startMonth: 4, startDay: 1, durationDays: 9, teamCount: 16, isMajor: false },
  { name: 'CS2 Major: Spring', tier: 'S', prizePool: 1250000, startMonth: 4, startDay: 20, durationDays: 13, teamCount: 16, isMajor: true },
  { name: 'BLAST Bounty Summer', tier: 'B', prizePool: 400000, startMonth: 5, startDay: 15, durationDays: 8, teamCount: 16, isMajor: false },
  { name: 'IEM Cologne', tier: 'S', prizePool: 1000000, startMonth: 6, startDay: 18, durationDays: 11, teamCount: 16, isMajor: false },
  { name: 'ESL Pro League Season 2', tier: 'A', prizePool: 750000, startMonth: 8, startDay: 3, durationDays: 12, teamCount: 16, isMajor: false },
  { name: 'BLAST Open Fall', tier: 'B', prizePool: 400000, startMonth: 8, startDay: 24, durationDays: 8, teamCount: 16, isMajor: false },
  { name: 'RMR Autumn', tier: 'B', prizePool: 300000, startMonth: 9, startDay: 10, durationDays: 7, teamCount: 16, isMajor: false },
  { name: 'CS2 Major: Autumn', tier: 'S', prizePool: 1250000, startMonth: 10, startDay: 1, durationDays: 13, teamCount: 16, isMajor: true },
  { name: 'BLAST World Final', tier: 'S', prizePool: 1000000, startMonth: 11, startDay: 5, durationDays: 8, teamCount: 8, isMajor: false },
];

const PRIZE_SPREAD_16 = [0.4, 0.18, 0.09, 0.09, 0.035, 0.035, 0.035, 0.035, 0.0125, 0.0125, 0.0125, 0.0125, 0.0125, 0.0125, 0.0125, 0.0125];
const PRIZE_SPREAD_8 = [0.45, 0.2, 0.1, 0.1, 0.0375, 0.0375, 0.0375, 0.0375];

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tier-band invitations from current rankings, with a user wildcard where plausible. */
export function inviteByRanking(
  tier: TournamentTier,
  teamCount: number,
  teams: Record<string, Team>,
  userTeamId: string,
): string[] {
  // Defunct (folded) orgs can't be invited anywhere — they no longer exist.
  const ranked = Object.values(teams)
    .filter((t) => !t.defunct)
    .sort((a, b) => a.worldRanking - b.worldRanking);
  let pool: Team[];
  if (tier === 'S') pool = ranked.slice(0, teamCount + 4);
  else if (tier === 'A') pool = ranked.slice(0, 26);
  // B-tier qualifiers: ranks 7+ down to the bottom of the database. Previously
  // hard-capped at rank 32, which excluded the tier-2 teams in ROSTERS_D from
  // ever getting B-tier action.
  else pool = ranked.slice(6);

  let invited = pool.slice(0, teamCount).map((t) => t.id);
  if (!invited.includes(userTeamId)) {
    const userRank = teams[userTeamId].worldRanking;
    const eligible =
      (tier === 'S' && userRank <= 24) || (tier === 'A' && userRank <= 28) || tier === 'B';
    if (eligible) invited = [...invited.slice(0, teamCount - 1), userTeamId];
  }
  return invited;
}

export function generateSeasonTournaments(
  year: number,
  teams: Record<string, Team>,
  userTeamId: string,
): Record<string, Tournament> {
  const out: Record<string, Tournament> = {};

  for (const ev of SEASON_EVENTS) {
    const start = iso(year, ev.startMonth, ev.startDay);
    const id = `${year}-${ev.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const invited = inviteByRanking(ev.tier, ev.teamCount, teams, userTeamId);

    out[id] = {
      id,
      name: ev.name,
      tier: ev.tier,
      prizePool: ev.prizePool,
      prizeSpread: ev.teamCount === 8 ? PRIZE_SPREAD_8 : PRIZE_SPREAD_16,
      startDate: start,
      endDate: addDays(start, ev.durationDays),
      teamCount: ev.teamCount,
      stages:
        ev.teamCount === 8
          ? [{ name: 'Playoffs', type: 'single-elim', format: 'BO3', finalFormat: 'BO5', advance: 1 }]
          : [
              { name: 'Swiss Stage', type: 'swiss', format: 'BO3', advance: 8 },
              { name: 'Playoffs', type: 'single-elim', format: 'BO3', finalFormat: 'BO5', advance: 1 },
            ],
      invitedTeamIds: invited,
      isMajor: ev.isMajor,
      rankingPoints: ev.tier === 'S' ? 1000 : ev.tier === 'A' ? 600 : 300,
    };
  }
  // link RMRs to their Majors
  const spring = out[`${year}-cs2-major-spring`];
  if (spring && out[`${year}-rmr-spring`]) spring.qualifierId = `${year}-rmr-spring`;
  const autumn = out[`${year}-cs2-major-autumn`];
  if (autumn && out[`${year}-rmr-autumn`]) autumn.qualifierId = `${year}-rmr-autumn`;
  return out;
}

export { addDays };
