// Initial staff pool generator. Top teams (rank 1-8) auto-hire a full bench of
// high-tier coaches; mid teams get partial staffs; the rest is free-agent pool
// the user can hire from.

import type { GameState, Staff, StaffRole, Team } from '../types';
import { STAFF_ROLES } from '../types';
import { RNG, hashSeed } from '../engine/rng';

const COACH_FIRST_NAMES = [
  'Anders', 'Daniel', 'David', 'Dmitri', 'Eduardo', 'Emil', 'Erik', 'Felix', 'Henrik', 'Igor',
  'James', 'Jens', 'Jonas', 'Kasper', 'Kirill', 'Lars', 'Lukas', 'Marco', 'Mateusz', 'Mats',
  'Mauricio', 'Michal', 'Nicolas', 'Oleksandr', 'Pablo', 'Patrik', 'Pedro', 'Petr', 'Rafael',
  'Roman', 'Ruslan', 'Sebastian', 'Sergei', 'Stefan', 'Thomas', 'Timo', 'Tomas', 'Valentin',
  'Vincent', 'Wojciech', 'Yannick', 'Yusuf',
];

const COACH_LAST_NAMES = [
  'Andersson', 'Becker', 'Bergmann', 'Castro', 'Christensen', 'Costa', 'Diaz', 'Eriksson',
  'Fischer', 'Garcia', 'Hansen', 'Holm', 'Ivanov', 'Jansen', 'Kovac', 'Kowalski', 'Krause',
  'Larsen', 'Lindqvist', 'Maier', 'Marin', 'Melnyk', 'Meyer', 'Moller', 'Nielsen', 'Novak',
  'Pavlov', 'Petrov', 'Romero', 'Sanchez', 'Schmidt', 'Silva', 'Sokolov', 'Tanaka', 'Tarasov',
  'Vasiliev', 'Werner', 'Wilson', 'Zielinski',
];

const NATS_BY_REGION: Record<string, string[]> = {
  Europe: ['DK', 'SE', 'NO', 'FI', 'DE', 'FR', 'PL', 'CZ', 'NL', 'PT', 'IS', 'GB', 'BE'],
  CIS: ['RU', 'UA', 'BY', 'KZ', 'LT'],
  Americas: ['US', 'CA', 'BR', 'AR', 'CL', 'MX'],
  Asia: ['JP', 'KR', 'CN', 'MN', 'SG'],
};

/** Skill distribution. Higher tier = better coach. */
function skillForTier(tier: number, rng: RNG): number {
  // tier 1 = elite (16-20), 2 = strong (13-17), 3 = solid (10-14), 4 = journeyman (6-11)
  switch (tier) {
    case 1: return rng.int(16, 20);
    case 2: return rng.int(13, 17);
    case 3: return rng.int(10, 14);
    default: return rng.int(6, 11);
  }
}

function reputationForSkill(skill: number, rng: RNG): number {
  // Reputation roughly tracks skill but with variance — some coaches are
  // underrated, some are over-hyped vs results.
  return Math.max(1, Math.min(100, skill * 5 + rng.int(-15, 15)));
}

function wageForSkillAndRole(skill: number, role: StaffRole): number {
  const roleMul = role === 'HeadCoach' ? 1.4 : role === 'Analyst' ? 1.1 : 1.0;
  // Skill 10 = ~$6k/mo, skill 20 = ~$25k/mo
  const base = 2000 + skill * 1100;
  return Math.round((base * roleMul) / 500) * 500;
}

function makeStaff(
  id: string,
  role: StaffRole,
  tier: number,
  region: keyof typeof NATS_BY_REGION,
  rng: RNG,
): Staff {
  const skill = skillForTier(tier, rng);
  return {
    id,
    name: `${rng.pick(COACH_FIRST_NAMES)} ${rng.pick(COACH_LAST_NAMES)}`,
    nationality: rng.pick(NATS_BY_REGION[region]),
    age: rng.int(28, 52),
    role,
    skill,
    reputation: reputationForSkill(skill, rng),
    wage: wageForSkillAndRole(skill, role),
    contract: null,
    teamId: null,
  };
}

/**
 * Populate g.staff with an initial pool. Higher-ranked teams get a fuller
 * staff with stronger coaches; lower-ranked teams get partial staff; remaining
 * coaches go into the free-agent market.
 */
export function buildInitialStaffPool(g: GameState, rng: RNG): void {
  g.staff = {};
  let nextId = 1;
  const teams = Object.values(g.teams).sort((a, b) => a.worldRanking - b.worldRanking);

  // Hire staff onto teams based on ranking bucket.
  for (const team of teams) {
    team.staffIds = [];
    const rank = team.worldRanking;
    // Pick which roles this team fills and at what tier
    const fills: { role: StaffRole; tier: number }[] = [];
    if (rank <= 8) {
      // Top teams field full staff at strong tiers
      for (const role of STAFF_ROLES) {
        const tier = role === 'HeadCoach' ? 1 : rng.chance(0.6) ? 1 : 2;
        fills.push({ role, tier });
      }
    } else if (rank <= 16) {
      // Mid teams: HC + 3-4 specialists at tier 2
      fills.push({ role: 'HeadCoach', tier: 2 });
      const others: StaffRole[] = ['AimCoach', 'TacticsCoach', 'Analyst', 'PerformanceCoach', 'UtilityCoach', 'Physio'];
      for (const role of rng.shuffle(others).slice(0, rng.int(2, 4))) {
        fills.push({ role, tier: rng.chance(0.7) ? 2 : 3 });
      }
    } else if (rank <= 24) {
      // Low-mid: HC + maybe one specialist
      fills.push({ role: 'HeadCoach', tier: rng.chance(0.5) ? 2 : 3 });
      if (rng.chance(0.6)) {
        const r: StaffRole = rng.pick(['AimCoach', 'TacticsCoach', 'Analyst']);
        fills.push({ role: r, tier: 3 });
      }
    } else {
      // Bottom-tier teams: just a HC
      fills.push({ role: 'HeadCoach', tier: rng.chance(0.5) ? 3 : 4 });
    }

    for (const { role, tier } of fills) {
      const id = `staff-${String(nextId++).padStart(4, '0')}`;
      const region = (team.region in NATS_BY_REGION ? team.region : 'Europe') as keyof typeof NATS_BY_REGION;
      const staff = makeStaff(id, role, tier, region, rng);
      // Sign with a 1-3 year contract
      const expiresYear = parseInt(g.currentDate.slice(0, 4)) + rng.int(1, 3);
      staff.contract = { wage: staff.wage, expires: `${expiresYear}-01-05` };
      staff.teamId = team.id;
      g.staff[id] = staff;
      team.staffIds.push(id);
      // Sync HeadCoach onto legacy Team.coachName / coachSkill so the match engine
      // (which already reads coachSkill via mkSim/effectiveSkill) stays compatible.
      if (role === 'HeadCoach') {
        team.coachName = staff.name;
        team.coachSkill = staff.skill;
      }
    }
  }

  // Add free-agent pool: ~40 unemployed coaches across all roles for the market
  const regionKeys = Object.keys(NATS_BY_REGION) as (keyof typeof NATS_BY_REGION)[];
  for (let i = 0; i < 40; i++) {
    const id = `staff-${String(nextId++).padStart(4, '0')}`;
    const role = rng.pick(STAFF_ROLES);
    // Mix of tiers in free agent pool — some hidden gems, mostly average
    const tier = rng.chance(0.1) ? 1 : rng.chance(0.35) ? 2 : rng.chance(0.4) ? 3 : 4;
    const region = rng.pick(regionKeys);
    g.staff[id] = makeStaff(id, role, tier, region, rng);
  }
}

/** Look up a team's hired staff by role. Returns null if no one fills that slot. */
export function staffForRole(g: GameState, teamId: string, role: StaffRole): Staff | null {
  const team = g.teams[teamId];
  if (!team || !team.staffIds || !g.staff) return null;
  for (const id of team.staffIds) {
    const s = g.staff[id];
    if (s && s.role === role) return s;
  }
  return null;
}

/**
 * Convert a coach's skill into a training multiplier. Centered at 1.0 around
 * skill 12. Skill 20 = ~1.7x, skill 6 = ~0.5x. Absence = 1.0 (baseline).
 */
export function coachTrainingMultiplier(staff: Staff | null): number {
  if (!staff) return 1.0;
  return Math.max(0.5, Math.min(1.8, 0.4 + staff.skill / 12));
}
