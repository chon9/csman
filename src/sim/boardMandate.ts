// Board mandates + manager confidence bar.
//
// Each season the board sets 2-3 concrete objectives ("Top 8 by July", "Sign
// a Brazilian", "Win an A-tier"). Meeting them swings board confidence up;
// missing them swings it down. Confidence drives sacking risk — below 20%
// triggers a warning inbox, below 10% the board's hand is forced.
//
// This is the visible "are you safe?" meter that gives every save its own
// narrative arc beyond the win/loss column.

import { RNG } from '../engine/rng';
import type { BoardMandate, GameState, Region } from '../types';

let nextMandateId = 1;

/**
 * Generate this season's mandates. Called once per season (at rollover or
 * fresh career start). Tuned to club ambition: top-5 clubs demand trophies,
 * bottom-half clubs demand survival + finances.
 */
export function generateSeasonMandates(g: GameState, seasonYear: number, rng: RNG): BoardMandate[] {
  const user = g.teams[g.userTeamId];
  if (!user) return [];
  const ambition = user.reputation; // 1-200
  const out: BoardMandate[] = [];

  // ----- Always: ranking target (window of mid-season) -----
  const midDeadline = `${seasonYear}-07-15`;
  const rankTarget = ambition >= 170 ? 4 : ambition >= 140 ? 8 : ambition >= 110 ? 16 : 24;
  out.push({
    id: `mand-${seasonYear}-rank-${nextMandateId++}`,
    kind: 'rank',
    label: `Reach top ${rankTarget} by mid-season`,
    detail: `Board expects ${user.tag} to be inside the world top ${rankTarget} by ${midDeadline}. Slip outside and confidence drops sharply.`,
    deadline: midDeadline,
    target: rankTarget,
    status: 'open',
    rewardConfidence: ambition >= 140 ? 18 : 14,
    rewardCash: 0,
  });

  // ----- Trophy mandate for ambitious clubs -----
  if (ambition >= 140 && rng.chance(0.85)) {
    out.push({
      id: `mand-${seasonYear}-trophy-${nextMandateId++}`,
      kind: 'trophy',
      label: 'Win an A-tier or S-tier event',
      detail: `Lift silverware before the season ends (${seasonYear}-12-15). Trophies = bonus + huge confidence boost; no trophies = serious doubts.`,
      deadline: `${seasonYear}-12-15`,
      target: 1,
      status: 'open',
      rewardConfidence: ambition >= 170 ? 25 : 20,
      rewardCash: 400_000,
    });
  }

  // ----- Wage discipline for finance-stressed clubs -----
  const wageBill = user.playerIds.reduce((s, id) => s + (g.players[id]?.contract?.wage ?? 0), 0);
  if (wageBill > user.budget / 4 || ambition < 100) {
    // Trim 15% off the wage bill by season's two-thirds mark.
    const target = Math.round(wageBill * 0.85);
    out.push({
      id: `mand-${seasonYear}-wage-${nextMandateId++}`,
      kind: 'wage-bill',
      label: `Trim wage bill to $${(target / 1000).toFixed(0)}k/mo`,
      detail: `Board wants the monthly wage bill below $${target.toLocaleString()} by ${seasonYear}-09-01. Sell, loan out, or run leaner contracts.`,
      deadline: `${seasonYear}-09-01`,
      target,
      status: 'open',
      rewardConfidence: 12,
    });
  }

  // ----- Develop a youth product -----
  if (rng.chance(0.6)) {
    out.push({
      id: `mand-${seasonYear}-youth-${nextMandateId++}`,
      kind: 'develop-youth',
      label: 'Promote a youth player to first team',
      detail: `Bring at least one player from your academy (age ≤21) up to the first team this season. Shows scouting + development is working.`,
      deadline: `${seasonYear}-11-30`,
      target: 1,
      status: 'open',
      rewardConfidence: 10,
    });
  }

  // ----- Regional signing flavour -----
  if (rng.chance(0.4)) {
    const REGIONS: Region[] = ['Europe', 'CIS', 'Americas', 'Asia'];
    const region = rng.pick(REGIONS.filter((r) => r !== user.region));
    out.push({
      id: `mand-${seasonYear}-sign-${nextMandateId++}`,
      kind: 'sign-from',
      label: `Sign a player from ${region}`,
      detail: `Board want to internationalise the brand — sign at least one ${region} player this season.`,
      deadline: `${seasonYear}-11-30`,
      target: 1,
      param: region,
      status: 'open',
      rewardConfidence: 8,
    });
  }

  return out;
}

/**
 * Daily check — judge any mandate whose deadline has arrived, then update
 * board confidence with the rewards/penalties. Returns the mandates that
 * changed status so the caller can push inbox + (for finance mandates)
 * pay out the cash bonus.
 */
export function processMandates(g: GameState, today: string): { judged: BoardMandate[]; cashAwarded: number } {
  const judged: BoardMandate[] = [];
  let cash = 0;
  for (const m of g.boardMandates ?? []) {
    if (m.status !== 'open') continue;
    if (today < m.deadline) continue;
    const met = checkMandateMet(g, m);
    m.status = met ? 'met' : 'failed';
    judged.push(m);
    if (met) {
      adjustConfidence(g, m.rewardConfidence, `Mandate met: ${m.label}`);
      cash += m.rewardCash ?? 0;
    } else {
      // Failed mandates hurt more than meeting them helps — board punishes
      // missed targets more harshly than it rewards hitting them.
      adjustConfidence(g, -Math.round(m.rewardConfidence * 1.3), `Mandate failed: ${m.label}`);
    }
  }
  return { judged, cashAwarded: cash };
}

/** Check whether an open mandate's success criteria are currently met. */
function checkMandateMet(g: GameState, m: BoardMandate): boolean {
  const user = g.teams[g.userTeamId];
  if (!user) return false;
  switch (m.kind) {
    case 'rank':
      return user.worldRanking <= m.target;
    case 'trophy': {
      // Count trophies won during this calendar year (since the deadline is
      // always YYYY-12-15 or earlier).
      const year = m.deadline.slice(0, 4);
      let trophies = 0;
      for (const t of Object.values(g.tournaments)) {
        if (!t.endDate.startsWith(year)) continue;
        if (t.tier === 'B') continue; // only A + S count
        const st = g.tournamentStates[t.id];
        if (st?.finished && st.placements[g.userTeamId] === 1) trophies++;
      }
      return trophies >= m.target;
    }
    case 'wage-bill': {
      const wageBill = user.playerIds.reduce((s, id) => s + (g.players[id]?.contract?.wage ?? 0), 0);
      return wageBill <= m.target;
    }
    case 'develop-youth': {
      // Count first-team players who were YOUTH-tier at season start AND are
      // under 22. Approximate via age + squadTier == 'first' (we don't track
      // tier history, but a first-team player ≤21 implies promotion).
      const promoted = user.playerIds
        .map((id) => g.players[id])
        .filter((p) => p && (p.squadTier ?? 'first') === 'first' && p.age <= 21)
        .length;
      return promoted >= m.target;
    }
    case 'sign-from': {
      // Count first-team players from the requested region whose club history
      // shows they joined this club THIS SEASON (joinedOn this calendar year).
      const region = m.param;
      const year = m.deadline.slice(0, 4);
      const signings = user.playerIds
        .map((id) => g.players[id])
        .filter((p) => {
          if (!p) return false;
          // Use nationality region mapping — best-effort.
          if (regionOfNat(p.nationality) !== region) return false;
          const hist = p.clubHistory ?? [];
          const lastJoin = hist[hist.length - 1];
          return lastJoin?.teamId === g.userTeamId && lastJoin.joinedOn.startsWith(year);
        }).length;
      return signings >= m.target;
    }
    default:
      return false;
  }
}

/** Apply a board confidence delta. Tracks the reason via `lastBoardWarning`. */
export function adjustConfidence(g: GameState, delta: number, reason: string): void {
  const cur = g.boardConfidence ?? 50;
  g.boardConfidence = Math.max(0, Math.min(100, cur + delta));
  void reason; // reason currently only used in caller's inbox copy
}

/** Daily "drift" — confidence creeps toward 50 on quiet days so a one-bad-
 *  result swing isn't permanent. Tiny effect (≤0.2/day). */
export function driftConfidence(g: GameState): void {
  const cur = g.boardConfidence ?? 50;
  if (cur === 50) return;
  const dir = cur < 50 ? 1 : -1;
  g.boardConfidence = Math.max(0, Math.min(100, cur + dir * 0.15));
}

/** Map nationality code to its region — minimal, defaulting to Europe. */
function regionOfNat(nat: string): Region {
  const CIS = ['RU', 'UA', 'KZ', 'BY', 'EE', 'LV', 'LT'];
  const AMERICAS = ['BR', 'US', 'CA', 'AR', 'CL', 'MX', 'GT', 'PE', 'CO'];
  const ASIA = ['CN', 'KR', 'JP', 'MN', 'AU', 'NZ', 'MY', 'TH', 'VN', 'ID', 'IN', 'IR'];
  if (CIS.includes(nat)) return 'CIS';
  if (AMERICAS.includes(nat)) return 'Americas';
  if (ASIA.includes(nat)) return 'Asia';
  return 'Europe';
}
