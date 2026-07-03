// Narrative inbox — the "make the world alive" layer.
//
// Everything match-driven runs through a MatchContext so the copy can
// reference what actually happened: MVP nickname, the exact scoreline,
// whether it was a sweep or a one-round nailbiter. Three item types:
//
//   1. Player Quote (non-interactive)  — a starter speaks to the press
//      about a specific moment in the match. Just something to read.
//   2. Match Recap  (non-interactive)  — a headline-writer's take, with
//      concrete numbers (K/D, rating, score). Read-only.
//   3. Media Question (interactive)    — a reporter asks the manager a
//      match-specific question. Rare (~5% of matches). Fan swings are
//      randomized within a range so the same choice doesn't feel
//      identical every time.
//
// The old fixed-value effect system was replaced with { fansMin, fansMax }
// and a match-significance multiplier so wins in tight series or upsets
// pay bigger fan swings than routine wins.

import type { DB } from './db.ts';
import type { InboxChoice, InboxItem, ServerMessage } from '../../src/online/protocol.ts';
import type { Player } from '../../src/types.ts';

type MoraleDelta = -2 | -1 | 0 | 1 | 2;

interface ChoiceEffect {
  /** Fans swing — rolled uniformly between min/max at resolve time. */
  fansMin?: number;
  fansMax?: number;
  /** Whole-roster morale bump when the answer lands (or backfires). */
  rosterMorale?: MoraleDelta;
  /** One-line summary shown as a toast. Includes numeric details after
   *  the roll runs (see resolveMedia). */
  summary: string;
}

/** Everything the generators need to write match-specific copy. */
export interface MatchContext {
  /** Viewer's team tag — used only when the copy needs to reference
   *  their own team by name (rare — most templates use pronouns). */
  myTag: string;
  /** Opponent tag — shows up in titles + body copy. */
  oppTag: string;
  /** Series outcome from THIS team's perspective. */
  mood: 'win' | 'loss';
  /** Score by side (map wins). Used to compute close/sweep. */
  myMaps: number;
  oppMaps: number;
  /** MVP snapshot from computeMvpSnapshot — undefined for legacy paths. */
  mvp?: {
    playerId: string;
    nickname: string;
    role: string;
    teamTag: string;
    isOwn: boolean;
    avgRating: number;
    kills: number;
    deaths: number;
  };
  /** The team's starting five (for player-quote generation). */
  starters: Player[];
}

interface Situation {
  /** ≥2 map differential — dominant. */
  sweep: boolean;
  /** 1-map differential — heartbreak or nail-biter. */
  close: boolean;
  /** MVP is on the viewer's own team. */
  ownMvp: boolean;
  /** Multiplier applied to fans deltas so dramatic matches pay more.
   *  Ranges 1.0–2.0 depending on close/sweep/upset. */
  significance: number;
}

function situation(ctx: MatchContext): Situation {
  const diff = Math.abs(ctx.myMaps - ctx.oppMaps);
  const sweep = diff >= 2;
  const close = diff === 1;
  const ownMvp = ctx.mvp?.isOwn ?? false;
  // Sweeps + comeback wins + MVP performances all bump significance.
  let significance = 1.0;
  if (sweep) significance += 0.4;
  if (close) significance += 0.3;
  if (ownMvp && ctx.mood === 'win') significance += 0.3;
  return { sweep, close, ownMvp, significance: Math.min(2.0, significance) };
}

// =====================================================================
// 1) PLAYER QUOTE — non-interactive, MVP/standout-aware
// =====================================================================

interface PlayerQuoteTemplate {
  /** When this template fires. */
  when: (s: Situation, ctx: MatchContext) => boolean;
  /** Title in the inbox list. Templated with {nick}. */
  title: string;
  /** Body — the actual quote. Templated with {nick}, {opp}, {rating},
   *  {kills}, {deaths}, {mvpNick}. */
  body: string;
  /** Which starter delivers the quote. */
  speaker: (ctx: MatchContext) => Player | null;
}

/** Pick the highest-rated (MVP) if they're on our side, else a random
 *  starter. Used when the template wants "someone who played well." */
function pickMvpOrRandom(ctx: MatchContext): Player | null {
  const eligible = ctx.starters.filter((p) => !p.isRealName && !p.retired);
  if (eligible.length === 0) return null;
  if (ctx.mvp?.isOwn) {
    const own = eligible.find((p) => p.id === ctx.mvp!.playerId);
    if (own) return own;
  }
  return eligible[Math.floor(Math.random() * eligible.length)]!;
}

/** Deliberately pick a NON-MVP so the quote reads as team credit. */
function pickNonMvpStarter(ctx: MatchContext): Player | null {
  const eligible = ctx.starters.filter((p) =>
    !p.isRealName && !p.retired && p.id !== ctx.mvp?.playerId,
  );
  if (eligible.length === 0) return pickMvpOrRandom(ctx);
  return eligible[Math.floor(Math.random() * eligible.length)]!;
}

const PLAYER_QUOTES: PlayerQuoteTemplate[] = [
  // ----- Win + own MVP (star player speaks) -----
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownMvp,
    title: '{nick}: "Best series in months"',
    body: `"That was probably my cleanest performance of the split — {rating} rating, {kills}/{deaths} on the day. The reads just came." — {nick} after {myTag}'s {myMaps}-{oppMaps} win over {opp}.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownMvp && s.sweep,
    title: '{nick} on the sweep',
    body: `"I felt locked in from the pistol. When you go up early it snowballs — {opp} never got their footing. Now we push for a title." — {nick}, MVP of the {myMaps}-{oppMaps} series.`,
    speaker: pickMvpOrRandom,
  },

  // ----- Win + own MVP → teammate gives them credit -----
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownMvp,
    title: 'Teammate praises {mvpNick}',
    body: `"{mvpNick} carried us today. I just did my job — the reads, the entries, that was all him." — {nick} after {myTag}'s win.`,
    speaker: pickNonMvpStarter,
  },

  // ----- Win + close series -----
  {
    when: (s, ctx) => ctx.mood === 'win' && s.close,
    title: '{nick}: "We had to earn every round"',
    body: `"Series like that build the team room. {opp} pushed us to the last map — but we found the answers." — {nick} after the {myMaps}-{oppMaps} nailbiter.`,
    speaker: pickMvpOrRandom,
  },

  // ----- Win + sweep -----
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep,
    title: '{nick}: "Feels good to be dominant"',
    body: `"That\'s the standard now. When we execute like that, no team in the region beats us." — {nick} after the {myMaps}-{oppMaps} sweep of {opp}.`,
    speaker: pickMvpOrRandom,
  },

  // ----- Loss + individual played well -----
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.ownMvp,
    title: '{nick} takes it hard despite the {rating} rating',
    body: `"I had the frags but we couldn\'t close together. {rating} rating means nothing if the series went the other way. On me to step up in clutch." — {nick} after the loss to {opp}.`,
    speaker: pickMvpOrRandom,
  },

  // ----- Loss + close -----
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.close,
    title: '{nick}: "One round away"',
    body: `"That\'s what stings the most — we had them. One round the other way and we\'re celebrating." — {nick} after the {myMaps}-{oppMaps} loss to {opp}.`,
    speaker: pickMvpOrRandom,
  },

  // ----- Loss + blowout -----
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.sweep,
    title: '{nick} on the loss',
    body: `"Got outclassed today. {opp} played the better tactical series and we didn\'t adjust. Back to the practice server — no excuses." — {nick} after the {oppMaps}-{myMaps} defeat.`,
    speaker: pickMvpOrRandom,
  },

  // ----- Fallback for any mood -----
  {
    when: () => true,
    title: '{nick} on the {mood}',
    body: `"Every series is a lesson. We\'ll take the reps and get better." — {nick} after {myTag} vs {opp}.`,
    speaker: pickMvpOrRandom,
  },
];

// =====================================================================
// 2) MATCH RECAP — non-interactive, reporter's write-up
// =====================================================================

interface RecapTemplate {
  when: (s: Situation, ctx: MatchContext) => boolean;
  title: string;
  body: string;
}

const RECAPS: RecapTemplate[] = [
  // Own team wins ---
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep && s.ownMvp,
    title: '{myTag} steamroll {opp} — {mvpNick} the difference',
    body: `HLTV recap: {myTag} put down {opp} {myMaps}-{oppMaps} in a dominant series. {mvpNick} led all fraggers with a {rating} rating ({kills}/{deaths}), doing the heavy lifting round after round. Ranking watchers are already pushing {myTag} up their tier lists.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.close,
    title: '{myTag} edge {opp} in a thriller',
    body: `Recap: {myTag} take the series {myMaps}-{oppMaps} in a nailbiter that went the distance. Every map came down to the final rounds; {mvpNick} was the difference with a {rating} rating. Scenes in the studio when the last kill dropped.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep,
    title: '{myTag} sweep {opp} {myMaps}-{oppMaps}',
    body: `Recap: A clinical performance from {myTag} — {myMaps}-{oppMaps} over {opp} without ever really being threatened. The tactical playbook was working, the frags followed, and the crowd left happy.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'win',
    title: 'Solid win: {myTag} take down {opp}',
    body: `Recap: {myTag} take the series {myMaps}-{oppMaps} over {opp}. {mvpNick} topped the scoreboard ({rating} rating, {kills}/{deaths}); the team looked composed in the important moments.`,
  },

  // Own team loses ---
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.sweep,
    title: 'Rough day: {opp} sweep {myTag}',
    body: `Recap: {opp} took {myTag} down {oppMaps}-{myMaps} in a series that got away early. Analysts point to the mid-round adjustments as the gap. Time to hit the tape review.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.close,
    title: '{myTag} fall {oppMaps}-{myMaps} in a heartbreaker',
    body: `Recap: {opp} took the deciding map in a {oppMaps}-{myMaps} series that could have gone either way. {mvpNick} was quietly among the top performers on the map — the series was decided in the small margins.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss',
    title: '{opp} take the series over {myTag}',
    body: `Recap: {opp} take it {oppMaps}-{myMaps}. Not the day {myTag} wanted; back to the drawing board.`,
  },
];

// =====================================================================
// 3) MEDIA QUESTION — interactive, match-specific, rare
// =====================================================================

interface MediaQuestionTemplate {
  when: (s: Situation, ctx: MatchContext) => boolean;
  title: string;
  body: string;
  choices: Array<InboxChoice & { effect: ChoiceEffect }>;
}

const MEDIA_QUESTIONS: MediaQuestionTemplate[] = [
  // Win: MVP performance
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownMvp && ctx.mvp!.avgRating >= 1.2,
    title: 'Reporter on {mvpNick}\'s ceiling',
    body: `A reporter catches you after the win: "{mvpNick} posted a {rating} rating with {kills} frags. Is that the ceiling — or the floor?"`,
    choices: [
      { id: 'ceiling', label: 'That\'s a ceiling performance — you can\'t reproduce that every match.',
        hint: 'humble',
        effect: { fansMin: 100, fansMax: 400, summary: 'Fans respect the honest answer.' } },
      { id: 'standard', label: 'That\'s the standard now.',
        hint: 'confident',
        effect: { fansMin: 300, fansMax: 800, rosterMorale: 1, summary: 'Bold. The room hears it too.' } },
      { id: 'warming', label: '{mvpNick} is just warming up.',
        hint: 'hype',
        effect: { fansMin: 200, fansMax: 700, summary: 'Storyline gold — pushes the highlight cycle.' } },
    ],
  },

  // Win + sweep
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep,
    title: 'Sweep aftermath',
    body: `You just took {opp} down {myMaps}-{oppMaps} without breaking a sweat. The mic goes to you: "Is this the strongest {myTag} we\'ve ever seen?"`,
    choices: [
      { id: 'process', label: 'The process is working — that\'s all we can ask.',
        hint: 'measured',
        effect: { fansMin: 100, fansMax: 300, summary: 'Coach-speak. Safe.' } },
      { id: 'peak', label: 'We\'re playing our best cs right now.',
        hint: 'confident',
        effect: { fansMin: 300, fansMax: 700, summary: 'Confidence sells.' } },
      { id: 'brag', label: 'Nobody in the region is close to us.',
        hint: 'trash-talk',
        effect: { fansMin: 400, fansMax: 1000, rosterMorale: -1, summary: 'The base loves it. The room worries about backlash.' } },
    ],
  },

  // Loss + close
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.close,
    title: 'Close loss — reporter presses',
    body: `The mic finds you after the {oppMaps}-{myMaps} loss to {opp}. "One round the other way and you win the series. What went wrong?"`,
    choices: [
      { id: 'clean', label: 'Small margins. We\'ll clean it up.',
        hint: 'professional',
        effect: { fansMin: 100, fansMax: 300, summary: 'Neutral. Standard.' } },
      { id: 'credit', label: '{opp} played us well — {mvpNick} was on a different level.',
        hint: 'credit opponent',
        effect: { fansMin: 200, fansMax: 500, rosterMorale: 1, summary: 'The room appreciates you not throwing them under.' } },
      { id: 'excuse', label: 'The tick rate was off — hard to aim in that server.',
        hint: 'deflect',
        effect: { fansMin: -600, fansMax: -200, summary: 'Excuses read badly. Fans notice.' } },
    ],
  },

  // Loss + blowout
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.sweep,
    title: 'Rough series — reporter asks the tough one',
    body: `{opp} just swept you {oppMaps}-{myMaps}. A reporter asks: "Is this team in trouble?"`,
    choices: [
      { id: 'grind', label: 'Back to the practice server. No excuses.',
        hint: 'gritty',
        effect: { fansMin: 300, fansMax: 700, rosterMorale: 1, summary: 'Fans respect the workmanlike answer.' } },
      { id: 'own', label: 'On me — I called it wrong today.',
        hint: 'own it',
        effect: { fansMin: 200, fansMax: 500, rosterMorale: 2, summary: 'The room sees you shielding them.' } },
      { id: 'blame', label: 'Some individual mistakes cost us.',
        hint: 'blame players',
        effect: { fansMin: -600, fansMax: -300, rosterMorale: -1, summary: 'Fans and players both notice.' } },
    ],
  },
];

// =====================================================================
// Public generators — pick a template that fits the situation
// =====================================================================

function fill(text: string, vars: Record<string, string | number | undefined>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) continue;
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

function commonVars(ctx: MatchContext, speaker?: Player | null): Record<string, string | number | undefined> {
  return {
    myTag: ctx.myTag,
    opp: ctx.oppTag,
    myMaps: ctx.myMaps,
    oppMaps: ctx.oppMaps,
    mood: ctx.mood,
    nick: speaker?.nickname,
    mvpNick: ctx.mvp?.nickname ?? speaker?.nickname,
    rating: ctx.mvp?.avgRating?.toFixed(2),
    kills: ctx.mvp?.kills,
    deaths: ctx.mvp?.deaths,
  };
}

/** Generate a non-interactive player quote about the match, or null if
 *  no eligible starter / no matching template. */
export function generatePlayerQuoteItem(
  ctx: MatchContext,
): { title: string; body: string; payload: Record<string, unknown> } | null {
  const s = situation(ctx);
  const matching = PLAYER_QUOTES.filter((t) => t.when(s, ctx));
  if (matching.length === 0) return null;
  const template = matching[Math.floor(Math.random() * matching.length)]!;
  const speaker = template.speaker(ctx);
  if (!speaker) return null;
  const vars = commonVars(ctx, speaker);
  return {
    title: fill(template.title, vars),
    body: fill(template.body, vars),
    payload: {
      // No choices → client renders as read-only.
      quoteType: 'player',
      speakerId: speaker.id,
      speakerNickname: speaker.nickname,
    },
  };
}

/** Generate a non-interactive match recap (reporter's headline + body). */
export function generateMatchRecapItem(
  ctx: MatchContext,
): { title: string; body: string; payload: Record<string, unknown> } | null {
  const s = situation(ctx);
  const matching = RECAPS.filter((t) => t.when(s, ctx));
  if (matching.length === 0) return null;
  const template = matching[Math.floor(Math.random() * matching.length)]!;
  const vars = commonVars(ctx);
  return {
    title: fill(template.title, vars),
    body: fill(template.body, vars),
    payload: {
      quoteType: 'recap',
      mvpNick: ctx.mvp?.nickname,
    },
  };
}

/** Generate an interactive media question tied to the match specifics. */
export function generateMediaQuestionItem(
  ctx: MatchContext,
): { title: string; body: string; payload: Record<string, unknown> } | null {
  const s = situation(ctx);
  const matching = MEDIA_QUESTIONS.filter((t) => t.when(s, ctx));
  if (matching.length === 0) return null;
  const template = matching[Math.floor(Math.random() * matching.length)]!;
  const idx = MEDIA_QUESTIONS.indexOf(template);
  const vars = commonVars(ctx);
  return {
    title: fill(template.title, vars),
    body: fill(template.body, vars),
    payload: {
      templateId: `media:${idx}`,
      significance: s.significance,
      choices: template.choices.map((c) => ({
        id: c.id,
        label: fill(c.label, vars),
        hint: c.hint,
      })),
    },
  };
}

// =====================================================================
// Response resolver — applies effect of chosen media response
// =====================================================================

/** Apply the effect of a chosen media response and return a summary line.
 *  Fans deltas are rolled uniformly between min/max and multiplied by the
 *  match significance so dramatic series pay more than routine ones. */
export function resolveInboxChoice(
  db: DB,
  item: InboxItem,
  teamId: string,
  choiceId: string,
): { summary: string; newFans?: number } | null {
  if (item.kind !== 'media') {
    // Player messages are now read-only (no choices). Any other kind
    // just gets an acknowledgment.
    return { summary: 'Acknowledged.' };
  }
  const templateId = item.payload.templateId as string | undefined;
  if (!templateId?.startsWith('media:')) return null;
  const idx = Number(templateId.slice('media:'.length));
  const template = MEDIA_QUESTIONS[idx];
  if (!template) return null;
  const choice = template.choices.find((c) => c.id === choiceId);
  if (!choice) return null;
  const significance = Number(item.payload.significance ?? 1);
  const effect = choice.effect;

  let newFans: number | undefined;
  if (typeof effect.fansMin === 'number' && typeof effect.fansMax === 'number') {
    const rolled = effect.fansMin + Math.random() * (effect.fansMax - effect.fansMin);
    const swing = Math.round(rolled * significance);
    if (swing !== 0) {
      db.bumpTeamBonusFans(teamId, swing);
      newFans = swing;
    }
  }
  const rosterDelta = effect.rosterMorale ?? 0;
  if (rosterDelta !== 0) {
    const roster = db.loadTeamPlayers(teamId);
    for (const p of roster.slice(0, 5)) {
      p.morale = Math.max(1, Math.min(20, (p.morale ?? 12) + rosterDelta));
      db.persistPlayer(p);
    }
  }
  const parts: string[] = [];
  if (newFans !== undefined) parts.push(`${newFans > 0 ? '+' : ''}${newFans.toLocaleString()} fans`);
  if (rosterDelta !== 0) parts.push(`roster morale ${rosterDelta > 0 ? '+' : ''}${rosterDelta}`);
  const detail = parts.length > 0 ? `${parts.join(' · ')} — ` : '';
  return { summary: `${detail}${effect.summary}`, newFans };
}

// =====================================================================
// Helper: emit an inbox item + push it to the team's live sockets
// =====================================================================

export function emitInboxItem(
  db: DB,
  notifyTeam: (teamId: string, msg: ServerMessage) => void,
  args: { teamId: string; kind: string; title: string; body: string; payload?: Record<string, unknown> },
): InboxItem {
  const item = db.pushInbox(args) as InboxItem;
  const unread = db.inboxUnreadCount(args.teamId);
  notifyTeam(args.teamId, { kind: 'inbox-item', item, unread });
  return item;
}

// =====================================================================
// Convenience: roll ONE post-match narrative for a team.
// Weighted: player quote 55%, match recap 30%, media question 15%.
// Overall cap is decided by the caller (skip the whole call some %).
// =====================================================================

export function rollPostMatchInbox(
  db: DB,
  notifyTeam: (teamId: string, msg: ServerMessage) => void,
  teamId: string,
  ctx: MatchContext,
): InboxItem | null {
  const r = Math.random();
  let gen: { title: string; body: string; payload: Record<string, unknown> } | null = null;
  let kind: 'player-message' | 'media' = 'player-message';
  if (r < 0.55) {
    gen = generatePlayerQuoteItem(ctx);
    kind = 'player-message';
  } else if (r < 0.85) {
    gen = generateMatchRecapItem(ctx);
    kind = 'media'; // "reporter recap" uses the media icon/colour
  } else {
    gen = generateMediaQuestionItem(ctx);
    kind = 'media';
  }
  if (!gen) {
    // Fall back to a recap if the specific type had no eligible template.
    gen = generateMatchRecapItem(ctx);
    kind = 'media';
    if (!gen) return null;
  }
  return emitInboxItem(db, notifyTeam, {
    teamId, kind,
    title: gen.title,
    body: gen.body,
    payload: gen.payload,
  });
}
