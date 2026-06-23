// Press conferences + player concerns + dressing room dynamics.
// These are the FM "feel" loops — not deeply simulated, but visible enough
// to make the squad feel alive.

import type {
  GameState,
  PlayerConcern,
  PressConference,
  PressQuestion,
  PressTone,
  ScheduledMatch,
  Team,
} from '../types';
import { RNG, hashSeed } from '../engine/rng';
import { addDays } from './calendar';
import { pushPost } from './news';
import { pressFactor } from './managerEffects';

let nextPressId = 0;
let nextConcernId = 0;

// ============ Press conferences ============

/** Schedule a pre-match press conference before a tier-1 user match. */
export function maybeSchedulePreMatchPress(
  g: GameState,
  match: ScheduledMatch,
): PressConference | null {
  const tournament = g.tournaments[match.tournamentId];
  if (!tournament) return null;
  // Only pre-match press for S-tier or A-tier events, and only big matches
  if (tournament.tier === 'B') return null;
  const opp = match.teamAId === g.userTeamId ? g.teams[match.teamBId] : g.teams[match.teamAId];
  if (!opp) return null;
  // Dedupe — skip if a press is already pending for this match
  if ((g.pressConferences ?? []).some((p) => p.matchId === match.id && p.kind === 'pre-match')) return null;

  const rng = new RNG(hashSeed(`press-${match.id}-pre`));
  const conf: PressConference = {
    id: `press-${++nextPressId}-${match.id}-pre`,
    date: g.currentDate,
    kind: 'pre-match',
    matchId: match.id,
    tournamentId: tournament.id,
    contextTeamId: opp.id,
    questions: buildPreMatchQuestions(g, opp, tournament.name, rng),
    answered: false,
  };
  return conf;
}

/** Post-match press after a notable result (won/lost a major, big upset, etc.). */
export function maybeSchedulePostMatchPress(
  g: GameState,
  match: ScheduledMatch,
  won: boolean,
  upset: boolean,
): PressConference | null {
  const tournament = g.tournaments[match.tournamentId];
  if (!tournament) return null;
  if (tournament.tier === 'B' && !upset) return null;
  const opp = match.teamAId === g.userTeamId ? g.teams[match.teamBId] : g.teams[match.teamAId];
  if (!opp) return null;

  const rng = new RNG(hashSeed(`press-${match.id}-post`));
  const conf: PressConference = {
    id: `press-${++nextPressId}-${match.id}-post`,
    date: g.currentDate,
    kind: 'post-match',
    matchId: match.id,
    tournamentId: tournament.id,
    contextTeamId: opp.id,
    questions: buildPostMatchQuestions(g, opp, won, upset, rng),
    answered: false,
  };
  return conf;
}

function buildPreMatchQuestions(
  g: GameState,
  opponent: Team,
  tournamentName: string,
  rng: RNG,
): PressQuestion[] {
  const userTeam = g.teams[g.userTeamId];
  const isFavorite = userTeam.worldRanking < opponent.worldRanking;
  const qs = [
    {
      id: 'q1',
      question: `${opponent.name} look strong heading into ${tournamentName}. How are you preparing for them?`,
      options: [
        {
          tone: 'confident',
          answer: `We've studied their habits. We know how to break them down.`,
          moraleDelta: 0.3,
          confidenceDelta: 0,
          mediaTrustDelta: 2,
        },
        {
          tone: 'humble',
          answer: `They're a great team. We have huge respect for what they've built — it'll be tough.`,
          moraleDelta: 0,
          confidenceDelta: 0,
          mediaTrustDelta: 3,
        },
        {
          tone: 'aggressive',
          answer: `Honestly, I'm not worried about them. They should worry about us.`,
          moraleDelta: 0.5,
          confidenceDelta: -1,
          mediaTrustDelta: -3,
        },
        {
          tone: 'calm',
          answer: `Same prep as any other match. Trust the process.`,
          moraleDelta: 0,
          confidenceDelta: 0,
          mediaTrustDelta: 0,
        },
      ],
    },
    {
      id: 'q2',
      question: isFavorite
        ? `You're the favorites — does that pressure get to the squad?`
        : `Most pundits have you as underdogs. Do you agree?`,
      options: isFavorite
        ? [
            {
              tone: 'confident',
              answer: `Pressure is a privilege. We're built for these moments.`,
              moraleDelta: 0.4,
              confidenceDelta: 1,
              mediaTrustDelta: 1,
            },
            {
              tone: 'calm',
              answer: `Favorite tags don't win matches. Execution does.`,
              moraleDelta: 0.2,
              confidenceDelta: 0,
              mediaTrustDelta: 2,
            },
            {
              tone: 'humble',
              answer: `Any team at this level can beat any other on the day.`,
              moraleDelta: -0.1,
              confidenceDelta: 0,
              mediaTrustDelta: 1,
            },
          ]
        : [
            {
              tone: 'confident',
              answer: `Underdogs? We're going to win this. Write it down.`,
              moraleDelta: 0.5,
              confidenceDelta: -1,
              mediaTrustDelta: -2,
            },
            {
              tone: 'humble',
              answer: `Yeah, they're the better team on paper. We'll fight for every round.`,
              moraleDelta: -0.2,
              confidenceDelta: 0,
              mediaTrustDelta: 2,
            },
            {
              tone: 'calm',
              answer: `Rankings are a snapshot. We focus on our game.`,
              moraleDelta: 0.1,
              confidenceDelta: 0,
              mediaTrustDelta: 1,
            },
          ],
    },
  ];
  return qs.map((q) => ({ ...q, id: `${q.id}-${rng.int(1, 9999).toString(36)}` })) as PressQuestion[];
}

function buildPostMatchQuestions(
  g: GameState,
  opponent: Team,
  won: boolean,
  upset: boolean,
  rng: RNG,
): PressQuestion[] {
  void g;
  const qs = [
    {
      id: 'q1',
      question: won
        ? `Big win against ${opponent.name}. What's the takeaway?`
        : `Tough result against ${opponent.name}. What went wrong?`,
      options: won
        ? [
            {
              tone: 'humble',
              answer: `Credit to the players. They executed every call.`,
              moraleDelta: 0.5,
              confidenceDelta: 0,
              mediaTrustDelta: 3,
            },
            {
              tone: 'confident',
              answer: `We knew we had them. Result reflects months of preparation.`,
              moraleDelta: 0.3,
              confidenceDelta: 1,
              mediaTrustDelta: 1,
            },
            {
              tone: 'aggressive',
              answer: upset
                ? `Hope the so-called experts are watching. Big talk gets exposed.`
                : `Job done. Onto the next one.`,
              moraleDelta: 0.2,
              confidenceDelta: 0,
              mediaTrustDelta: -2,
            },
          ]
        : [
            {
              tone: 'calm',
              answer: `We were outplayed in the key moments. Back to the drawing board.`,
              moraleDelta: 0,
              confidenceDelta: 0,
              mediaTrustDelta: 2,
            },
            {
              tone: 'humble',
              answer: `They deserved it. We weren't at our best — that's on me.`,
              moraleDelta: -0.3,
              confidenceDelta: -1,
              mediaTrustDelta: 3,
            },
            {
              tone: 'aggressive',
              answer: `Plenty of rounds we threw away. The players need to look themselves in the mirror.`,
              moraleDelta: -0.6,
              confidenceDelta: 0,
              mediaTrustDelta: -2,
            },
            {
              tone: 'confident',
              answer: `One loss doesn't define a season. We bounce back next event.`,
              moraleDelta: 0.2,
              confidenceDelta: 0,
              mediaTrustDelta: 0,
            },
          ],
    },
  ];
  return qs.map((q) => ({ ...q, id: `${q.id}-${rng.int(1, 9999).toString(36)}` })) as PressQuestion[];
}

/** Apply chosen press answer to game state. Also posts the quote to the News feed. */
export function applyPressAnswer(
  g: GameState,
  conferenceId: string,
  questionId: string,
  optionIndex: number,
): void {
  const conf = (g.pressConferences ?? []).find((c) => c.id === conferenceId);
  if (!conf) return;
  const question = conf.questions.find((q) => q.id === questionId);
  if (!question) return;
  const opt = question.options[optionIndex];
  if (!opt) return;
  // Apply effects
  const userTeam = g.teams[g.userTeamId];
  for (const pid of userTeam.playerIds) {
    const p = g.players[pid];
    if (p) p.morale = Math.max(1, Math.min(20, p.morale + opt.moraleDelta));
  }
  if (g.board) g.board.confidence = Math.max(0, Math.min(100, g.board.confidence + opt.confidenceDelta));
  // Manager 'press' attribute amplifies gains, softens losses.
  const pf = pressFactor(g);
  const scaledTrust = opt.mediaTrustDelta >= 0 ? opt.mediaTrustDelta * pf : opt.mediaTrustDelta / pf;
  g.mediaTrust = Math.max(0, Math.min(100, (g.mediaTrust ?? 50) + scaledTrust));

  // Publish the manager quote on the News feed — covered by a press outlet
  // so the answer becomes public. Aggressive tones travel further (more likes).
  if (g.news && g.newsAuthors) {
    const pressAuthors = ['press-hltv', 'press-dexerto', 'press-dust2', 'press-thescore'];
    const authorId = pressAuthors[Math.floor((conf.id.length + opt.tone.length) % pressAuthors.length)];
    const manager = g.managerName || `${userTeam.name}'s manager`;
    const verb = conf.kind === 'pre-match' ? 'previews' : 'reflects after';
    const opp = conf.contextTeamId ? g.teams[conf.contextTeamId]?.name : 'the match';
    const baseLikes = opt.tone === 'aggressive' ? 6500 :
      opt.tone === 'confident' ? 4200 :
      opt.tone === 'humble' ? 3500 : 2800;
    const variance = Math.floor((authorId.length * 137 + opt.answer.length * 13) % 1500);
    // Outlets publish the quote next morning, not the same minute it's spoken —
    // post-dating + a News-screen filter hides future-dated entries until then.
    // Routed through pushPost so per-category caps apply (and engagement numbers
    // are computed consistently with other press posts).
    const newsRng = new RNG(hashSeed(`press-news-${conf.id}-${optionIndex}`));
    pushPost(g, {
      date: addDays(g.currentDate, 1),
      authorId,
      text: `${manager} ${verb} ${opp}: "${opt.answer}" — ${/^[aeiou]/i.test(opt.tone) ? 'an' : 'a'} ${opt.tone} tone from the ${userTeam.tag} boss.`,
      category: 'press-release',
      taggedTeamIds: conf.contextTeamId ? [userTeam.id, conf.contextTeamId] : [userTeam.id],
    }, newsRng);
    void baseLikes; void variance;
  }

  // Mark answered once all questions handled
  // (For simplicity, mark answered after first question — UI shows all in one panel)
  conf.answered = true;
}

// ============ Player Concerns ============

const CONCERN_TEMPLATES: Record<PlayerConcern['type'], (g: GameState, p: { id: string; nickname: string }, team: Team) => Pick<PlayerConcern, 'message' | 'options'>> = {
  'wage-demand': (_g, p) => ({
    message: `${p.nickname} feels his performances deserve a wage rise. He's earning below his current market value and his agent has been vocal.`,
    options: [
      {
        label: 'Offer +15% wage',
        description: 'Pay him what he wants — secures loyalty.',
        moraleDelta: 1.5,
        loyaltyDelta: 2,
        wageRisePct: 15,
        confidenceDelta: -1,
      },
      {
        label: 'Offer +5% as compromise',
        description: 'Modest bump, signals appreciation without breaking the bank.',
        moraleDelta: 0.5,
        loyaltyDelta: 0,
        wageRisePct: 5,
        confidenceDelta: 0,
      },
      {
        label: 'Refuse the request',
        description: 'Hold the line on wages. Risk a sour player.',
        moraleDelta: -2,
        loyaltyDelta: -3,
        confidenceDelta: 1,
      },
    ],
  }),
  'role-demotion': (_g, p) => ({
    message: `${p.nickname} feels under-utilised in his current role and wants more responsibility. He brought it up with the analyst.`,
    options: [
      {
        label: 'Promise a bigger role',
        description: 'Commit to giving him more leadership / star plays.',
        moraleDelta: 1.5,
        loyaltyDelta: 1,
        confidenceDelta: 0,
      },
      {
        label: 'Say you\'ll review it',
        description: 'Buy time without committing.',
        moraleDelta: 0,
        loyaltyDelta: 0,
        confidenceDelta: 0,
      },
      {
        label: 'Tell him to earn it',
        description: 'Push back hard — he needs to play himself into a bigger role.',
        moraleDelta: -1.5,
        loyaltyDelta: -1,
        confidenceDelta: 1,
      },
    ],
  }),
  'transfer-request': (_g, p) => ({
    message: `${p.nickname} has requested a transfer. He says he needs a new challenge and feels his time at the club is done.`,
    options: [
      {
        label: 'Accept — list him',
        description: 'Put him on the transfer list. Frees his wages and avoids drama.',
        moraleDelta: 1,
        loyaltyDelta: -5,
        confidenceDelta: -2,
        listsPlayer: true,
      },
      {
        label: 'Refuse the request',
        description: 'Tell him he\'s going nowhere. Risk a sulky star.',
        moraleDelta: -3,
        loyaltyDelta: -2,
        confidenceDelta: 1,
      },
      {
        label: 'Try to talk him round',
        description: 'Plead the team\'s case. Might restore some buy-in.',
        moraleDelta: 0.5,
        loyaltyDelta: 1,
        confidenceDelta: 0,
      },
    ],
  }),
  'happiness-low': (_g, p) => ({
    message: `${p.nickname} has been visibly down in the team house. He's worried about his form and the team's direction.`,
    options: [
      {
        label: 'Reassure him personally',
        description: 'Show some faith. Costs nothing.',
        moraleDelta: 1.5,
        loyaltyDelta: 1,
        confidenceDelta: 0,
      },
      {
        label: 'Tell him to focus on the game',
        description: 'No-nonsense response. Old-school approach.',
        moraleDelta: -0.5,
        loyaltyDelta: 0,
        confidenceDelta: 0,
      },
      {
        label: 'Give him a few days off',
        description: 'Mental reset. Costs match-day prep time.',
        moraleDelta: 2,
        loyaltyDelta: 1,
        confidenceDelta: -1,
      },
    ],
  }),
  'unsettled-rival': (_g, p) => ({
    message: `${p.nickname} is unsettled by a recent signing. He sees the new player as a direct challenger to his spot.`,
    options: [
      {
        label: 'Confirm he\'s still your starter',
        description: 'Hard commitment. The new signing\'s morale will drop.',
        moraleDelta: 1.5,
        loyaltyDelta: 2,
        confidenceDelta: -1,
      },
      {
        label: 'Tell him he\'ll have to compete',
        description: 'Open competition for the spot. Honest but unsettling.',
        moraleDelta: -0.5,
        loyaltyDelta: -1,
        confidenceDelta: 0,
      },
      {
        label: 'Suggest he learns from the rival',
        description: 'Frame it as growth opportunity. Soft pivot.',
        moraleDelta: 0.5,
        loyaltyDelta: 0,
        confidenceDelta: 0,
      },
    ],
  }),
  'admiring-offer': (_g, p) => ({
    message: `${p.nickname} has been approached by another club. They're prepared to triple his wage. He wanted you to know directly.`,
    options: [
      {
        label: 'Match the offer',
        description: 'Triple his current wage to keep him. Massive financial commitment.',
        moraleDelta: 2,
        loyaltyDelta: 3,
        wageRisePct: 200,
        confidenceDelta: -3,
      },
      {
        label: 'Counter with +30% wage',
        description: 'Substantial raise, signals you value him.',
        moraleDelta: 1,
        loyaltyDelta: 1,
        wageRisePct: 30,
        confidenceDelta: -1,
      },
      {
        label: 'Wish him well — let him go',
        description: 'Don\'t match. He\'ll likely leave when his contract is up.',
        moraleDelta: -2,
        loyaltyDelta: -3,
        confidenceDelta: 0,
      },
    ],
  }),
};

/** Roll for a new player concern. Low chance per day, modulated by squad morale/loyalty. */
export function rollPlayerConcern(g: GameState, today: string, rng: RNG): PlayerConcern | null {
  const team = g.teams[g.userTeamId];
  if (!team) return null;
  // Don't spam — cap at 3 pending concerns
  const pending = (g.playerConcerns ?? []).length;
  if (pending >= 3) return null;

  // Base 2%/day. +1% per low-morale player.
  let p = 0.02;
  for (const id of team.playerIds) {
    const player = g.players[id];
    if (!player) continue;
    if (player.morale < 8) p += 0.012;
    if (player.attributes.loyalty < 8) p += 0.006;
  }
  if (!rng.chance(Math.min(0.18, p))) return null;

  // Pick a player likely to be concerned
  const candidates = team.playerIds
    .map((id) => g.players[id])
    .filter((p) => !!p);
  if (candidates.length === 0) return null;
  // Weight by inverse morale + inverse loyalty
  const weighted = candidates.map((p) => ({
    p,
    w: Math.max(1, 25 - p.morale - p.attributes.loyalty),
  }));
  const totalW = weighted.reduce((s, x) => s + x.w, 0);
  let roll = rng.next() * totalW;
  let pick = weighted[0].p;
  for (const w of weighted) {
    roll -= w.w;
    if (roll <= 0) {
      pick = w.p;
      break;
    }
  }
  // Pick concern type based on player state
  let type: PlayerConcern['type'];
  if (pick.morale < 6) type = rng.pick(['happiness-low', 'transfer-request']);
  else if (pick.attributes.loyalty < 8 && pick.currentAbility >= 150) type = 'admiring-offer';
  else if (pick.currentAbility >= 140 && (pick.contract?.wage ?? 0) < 30000) type = 'wage-demand';
  else type = rng.pick(['wage-demand', 'role-demotion', 'happiness-low', 'unsettled-rival']);

  const template = CONCERN_TEMPLATES[type];
  const built = template(g, pick, team);
  return {
    id: `concern-${++nextConcernId}-${today}-${pick.id}`,
    playerId: pick.id,
    date: today,
    type,
    ...built,
  };
}

/** Apply a concern response option to game state. Returns brief outcome text. */
export function applyConcernResponse(g: GameState, concernId: string, optionIndex: number): string {
  const concern = (g.playerConcerns ?? []).find((c) => c.id === concernId);
  if (!concern) return '';
  const opt = concern.options[optionIndex];
  if (!opt) return '';
  const p = g.players[concern.playerId];
  if (!p) return '';
  // Apply effects
  p.morale = Math.max(1, Math.min(20, p.morale + opt.moraleDelta));
  p.attributes.loyalty = Math.max(1, Math.min(20, p.attributes.loyalty + opt.loyaltyDelta));
  if (opt.wageRisePct && p.contract) {
    p.contract.wage = Math.round((p.contract.wage * (1 + opt.wageRisePct / 100)) / 500) * 500;
  }
  if (opt.listsPlayer) p.transferListed = true;
  if (g.board) g.board.confidence = Math.max(0, Math.min(100, g.board.confidence + opt.confidenceDelta));
  return `${p.nickname}: ${opt.label}. Morale ${opt.moraleDelta >= 0 ? '+' : ''}${opt.moraleDelta}, Loyalty ${opt.loyaltyDelta >= 0 ? '+' : ''}${opt.loyaltyDelta}.`;
}

// ============ Dressing room ============

/** Compute team chemistry score (0-100) from squad attribute coherence + morale spread. */
export function calcTeamChemistry(g: GameState, team: Team): number {
  const players = team.playerIds.slice(0, 5).map((id) => g.players[id]).filter(Boolean);
  if (players.length === 0) return 50;
  const avgTeamwork = players.reduce((s, p) => s + p.attributes.teamwork, 0) / players.length;
  const avgMorale = players.reduce((s, p) => s + p.morale, 0) / players.length;
  const avgLoyalty = players.reduce((s, p) => s + p.attributes.loyalty, 0) / players.length;
  const moraleVariance =
    players.reduce((s, p) => s + Math.abs(p.morale - avgMorale), 0) / players.length;
  // Score: teamwork drives ceiling, low morale variance + high loyalty boost
  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        avgTeamwork * 3 + avgMorale * 2 + avgLoyalty * 1.5 - moraleVariance * 3,
      ),
    ),
  );
}

/** Classify a player's squad hierarchy role from CA + age. */
export function dressingRoomRole(
  player: { currentAbility: number; age: number; attributes: { leadership: number } },
): 'leader' | 'star' | 'important' | 'rotation' | 'prospect' | 'fringe' {
  const ca = player.currentAbility;
  if (player.attributes.leadership >= 17 && player.age >= 25) return 'leader';
  if (ca >= 165) return 'star';
  if (ca >= 145) return 'important';
  if (player.age <= 21 && ca >= 110) return 'prospect';
  if (ca >= 120) return 'rotation';
  return 'fringe';
}
