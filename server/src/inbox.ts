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
  myTag: string;
  oppTag: string;
  mood: 'win' | 'loss';
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
  starters: Player[];
  /** ACE count on the viewer's own team (across all maps). Extracted
   *  from the round commentary strings by counting `🏆 ACE!` lines. */
  ownAces?: number;
  /** ACE count on the opponent's team. */
  oppAces?: number;
  /** Clutch wins by the viewer's own team (any 1vX). Extracted from
   *  the round.clutch payload when the winner was on our side. */
  ownClutches?: number;
  oppClutches?: number;
  /** Highest single-map rating on OWN team (may exceed MVP if series
   *  MVP had a quieter final map). */
  peakOwnRating?: number;
  /** Player who put up the peak-rating map (nickname). */
  peakOwnPlayer?: string;
}

interface Situation {
  sweep: boolean;
  close: boolean;
  ownMvp: boolean;
  /** MVP had a monster series (rating ≥ 1.3). */
  monsterMvp: boolean;
  /** OWN team dropped at least one ACE. */
  ownAce: boolean;
  /** Opponent dropped at least one ACE — signals a rough loss or one to admire. */
  oppAce: boolean;
  /** OWN team won at least one clutch. */
  ownClutch: boolean;
  /** MVP has extreme K/D (≥ 2.0). */
  hyperFragger: boolean;
  /** Match significance multiplier for fans swings. */
  significance: number;
}

function situation(ctx: MatchContext): Situation {
  const diff = Math.abs(ctx.myMaps - ctx.oppMaps);
  const sweep = diff >= 2;
  const close = diff === 1;
  const ownMvp = ctx.mvp?.isOwn ?? false;
  const monsterMvp = ownMvp && (ctx.mvp?.avgRating ?? 0) >= 1.3;
  const ownAce = (ctx.ownAces ?? 0) > 0;
  const oppAce = (ctx.oppAces ?? 0) > 0;
  const ownClutch = (ctx.ownClutches ?? 0) > 0;
  const hyperFragger = ownMvp
    && (ctx.mvp?.kills ?? 0) >= (ctx.mvp?.deaths ?? 1) * 2;
  let significance = 1.0;
  if (sweep) significance += 0.4;
  if (close) significance += 0.3;
  if (monsterMvp) significance += 0.3;
  if (ownAce) significance += 0.2;
  return {
    sweep, close, ownMvp, monsterMvp,
    ownAce, oppAce, ownClutch, hyperFragger,
    significance: Math.min(2.0, significance),
  };
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
  // ===== ACE moments — highest priority when ACE landed =====
  {
    when: (s) => s.ownAce && s.ownMvp,
    title: '{nick} on the ACE: "The flick just felt right"',
    body: `"When it went to a 1v5 I saw the smoke coming and just committed to the peek. Sometimes the game gives you those moments." — {nick} after posting {rating} with an ACE in {myTag}'s series.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s) => s.ownAce,
    title: '"Watched it back three times" — {nick} on the ACE',
    body: `"We were all screaming in comms. I had to rewatch it after the map to believe it happened." — {nick} on the round that flipped momentum in {myTag} vs {opp}.`,
    speaker: pickMvpOrRandom,
  },

  // ===== Monster MVP performance (win) =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.monsterMvp,
    title: '{nick} on his {rating} series',
    body: `"Sometimes you feel the game before it happens. Every peek felt automatic — {kills} frags, {deaths} deaths, but I honestly couldn\'t tell you which one was the best." — {nick} after the win.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.hyperFragger,
    title: '{nick}: "Everything clicked today"',
    body: `"Aim was there, reads were there, the team set me up. When it all lines up you get {kills}/{deaths} series like this one." — {nick} after the win over {opp}.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownMvp,
    title: '{nick}: "Best series in months"',
    body: `"That was probably my cleanest performance of the split — {rating} rating, {kills}/{deaths} on the day. The reads just came." — {nick} after {myTag}'s {myMaps}-{oppMaps} win over {opp}.`,
    speaker: pickMvpOrRandom,
  },

  // ===== Clutch talk (win) =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownClutch,
    title: '{nick} on the clutch: "Time slows down"',
    body: `"When it goes to a 1vX you stop thinking about the series and just play the round. Muscle memory takes over." — {nick} after {myTag}'s comeback win.`,
    speaker: pickMvpOrRandom,
  },

  // ===== Teammate credits the MVP =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownMvp,
    title: 'Teammate praises {mvpNick}',
    body: `"{mvpNick} carried us today. I just did my job — the reads, the entries, that was all him." — {nick} after {myTag}'s win.`,
    speaker: pickNonMvpStarter,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.monsterMvp,
    title: 'Teammate: "Just clear the smoke and let {mvpNick} cook"',
    body: `"When he's on that {rating}-rating pace we just try not to get in the way. Flash, clear the smoke, {mvpNick} does the rest." — {nick} after the win over {opp}.`,
    speaker: pickNonMvpStarter,
  },

  // ===== Close-win drama =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.close,
    title: '{nick}: "We had to earn every round"',
    body: `"Series like that build the team room. {opp} pushed us to the last map — but we found the answers." — {nick} after the {myMaps}-{oppMaps} nailbiter.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.close,
    title: '{nick} on the comeback',
    body: `"Down at half we told ourselves it\'s just fifteen rounds. Reset the head, trust the plan, take it one at a time. And here we are." — {nick} after {myTag} edged {opp}.`,
    speaker: pickMvpOrRandom,
  },

  // ===== Sweep confidence =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep,
    title: '{nick}: "Feels good to be dominant"',
    body: `"That\'s the standard now. When we execute like that, no team in the region beats us." — {nick} after the {myMaps}-{oppMaps} sweep of {opp}.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep,
    title: '{nick} plays down the sweep',
    body: `"A sweep\'s a sweep — {opp} still had good rounds. We just executed the plan and the map score reflected that." — {nick}, measured after the win.`,
    speaker: pickMvpOrRandom,
  },

  // ===== Losses — MVP played well but team lost =====
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.ownMvp,
    title: '{nick} takes it hard despite the {rating} rating',
    body: `"I had the frags but we couldn\'t close together. {rating} rating means nothing if the series went the other way. On me to step up in clutch." — {nick} after the loss to {opp}.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.monsterMvp,
    title: '{nick}: "Frags don\'t matter if we lose"',
    body: `"Nice K/D, we lost the series. That\'s not a highlight — it\'s a stat sheet. Team wins matter." — {nick}, blunt after the {oppMaps}-{myMaps} defeat to {opp}.`,
    speaker: pickMvpOrRandom,
  },

  // ===== Losses — close =====
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.close,
    title: '{nick}: "One round away"',
    body: `"That\'s what stings the most — we had them. One round the other way and we\'re celebrating." — {nick} after the {myMaps}-{oppMaps} loss to {opp}.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.close,
    title: 'Teammate on the loss',
    body: `"The scoreline says close, but they were the better team in the important moments. We got outplayed in the clutches." — {nick} being honest about the loss to {opp}.`,
    speaker: pickNonMvpStarter,
  },

  // ===== Losses — blowout =====
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.sweep,
    title: '{nick} on the loss',
    body: `"Got outclassed today. {opp} played the better tactical series and we didn\'t adjust. Back to the practice server — no excuses." — {nick} after the {oppMaps}-{myMaps} defeat.`,
    speaker: pickMvpOrRandom,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.sweep,
    title: '{nick}: "Time to reset the room"',
    body: `"Series like that hurt but they\'re fixable. VOD review, own the mistakes, come in Monday ready to work." — {nick} being professional after the sweep.`,
    speaker: pickMvpOrRandom,
  },

  // ===== Opponent ACE (loss — respect) =====
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.oppAce,
    title: '{nick} tips his cap: "Their guy went crazy"',
    body: `"You have to respect a series with an ACE in it. Their guy showed up. We\'ll be ready when we play them next time." — {nick} after the loss to {opp}.`,
    speaker: pickMvpOrRandom,
  },

  // ===== Universal fallback =====
  {
    when: () => true,
    title: '{nick} on {myTag} vs {opp}',
    body: `"Every series is a lesson. We\'ll take the reps and get better." — {nick} after the {mood}.`,
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
  // ===== ACE-driven headlines (highest priority — real highlight moments) =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownAce && s.ownMvp,
    title: 'ACE alert: {mvpNick} carries {myTag} past {opp}',
    body: `HLTV recap: A jaw-dropping ACE from {mvpNick} punctuated {myTag}'s {myMaps}-{oppMaps} series win over {opp}. Final stat line — {rating} rating, {kills}/{deaths}. Highlight desks are cutting the clip already.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.oppAce,
    title: 'ACE from {opp} sinks {myTag}',
    body: `HLTV recap: {opp} took the series {oppMaps}-{myMaps} on the back of a highlight-reel ACE. {myTag} had answers on paper but not in the deciding round. The clip is already trending.`,
  },
  {
    when: (s) => s.ownAce && s.close,
    title: 'ACE + a nailbiter: {myTag} vs {opp} was must-watch',
    body: `HLTV recap: One of the most watchable series of the week — an ACE, six clutch rounds, {myMaps}-{oppMaps} on the boards. Highlight reels basically wrote themselves.`,
  },

  // ===== Clutch-driven headlines =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.ownClutch && s.close,
    title: 'Clutch masters: {myTag} steal it late from {opp}',
    body: `HLTV recap: {myTag} took the series {myMaps}-{oppMaps} on the strength of the clutch rounds — the deciding moments went their way when they had to. {mvpNick} was in the middle of every last stand ({rating} rating).`,
  },
  {
    when: (s) => s.ownClutch,
    title: 'Nerves of steel: {myTag} lock down the clutches',
    body: `HLTV recap: A masterclass in composure from {myTag}. When the rounds got tight, they closed. {mvpNick} led the charge at {rating}.`,
  },

  // ===== Monster MVP performances =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.monsterMvp,
    title: '{mvpNick} posts a {rating} — {myTag} take down {opp}',
    body: `HLTV recap: {mvpNick} was on a different level today. {rating} rating over the series with {kills}/{deaths} on the day. {myTag} take it {myMaps}-{oppMaps}; every top-8 ranking analyst is going to be re-jigging their list this week.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.hyperFragger,
    title: '{mvpNick} on a rampage: {kills} frags in the win',
    body: `HLTV recap: {kills} kills, {deaths} deaths, {rating} rating. {mvpNick} was everywhere for {myTag} in their {myMaps}-{oppMaps} win over {opp}. Series like this are why the sport pays for tape review.`,
  },

  // ===== Sweeps =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep && s.ownMvp,
    title: '{myTag} steamroll {opp} — {mvpNick} the difference',
    body: `HLTV recap: {myTag} put down {opp} {myMaps}-{oppMaps} in a dominant series. {mvpNick} led all fraggers with a {rating} rating ({kills}/{deaths}), doing the heavy lifting round after round. Ranking watchers are already pushing {myTag} up their tier lists.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep,
    title: '{myTag} dispatch {opp} without breaking a sweat',
    body: `HLTV recap: Clinical from {myTag} — a {myMaps}-{oppMaps} series win with the outcome rarely in doubt. Tactical execution was sharp; frags followed. {opp} will want to forget this one quickly.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.sweep,
    title: 'Statement win: {myTag} dominate {opp}',
    body: `HLTV recap: A statement result. {myTag} take the series {myMaps}-{oppMaps} with rounds to spare, sending a message to the rest of the field.`,
  },

  // ===== Close wins =====
  {
    when: (s, ctx) => ctx.mood === 'win' && s.close,
    title: '{myTag} edge {opp} in a thriller',
    body: `HLTV recap: {myTag} take the series {myMaps}-{oppMaps} in a nailbiter that went the distance. Every map came down to the final rounds; {mvpNick} was the difference with a {rating} rating. Scenes in the studio when the last kill dropped.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'win' && s.close,
    title: '{myTag} escape with the {myMaps}-{oppMaps} win over {opp}',
    body: `HLTV recap: A series {myTag} had to earn. {opp} were the better team on paper for stretches, but the closing rounds went the other way. {mvpNick}'s {rating} rating was quietly decisive.`,
  },

  // ===== Solid wins (fallback for wins) =====
  {
    when: (s, ctx) => ctx.mood === 'win',
    title: 'Solid win: {myTag} take down {opp}',
    body: `HLTV recap: {myTag} take the series {myMaps}-{oppMaps} over {opp}. {mvpNick} topped the scoreboard ({rating} rating, {kills}/{deaths}); the team looked composed in the important moments.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'win',
    title: '{myTag} book the win vs {opp}',
    body: `HLTV recap: A workmanlike win from {myTag}, {myMaps}-{oppMaps} on the boards. Nothing flashy, nothing headline-worthy — just the two points they came for.`,
  },

  // ===== Blowout losses =====
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.sweep,
    title: 'Rough day: {opp} sweep {myTag}',
    body: `HLTV recap: {opp} took {myTag} down {oppMaps}-{myMaps} in a series that got away early. Analysts point to the mid-round adjustments as the gap. Time to hit the tape review.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.sweep,
    title: '{opp} humble {myTag} in a straight-sets defeat',
    body: `HLTV recap: {opp} take the series {oppMaps}-{myMaps} in a series where {myTag} never quite found their rhythm. Off-days happen — but this one was ugly.`,
  },

  // ===== Close losses =====
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.close,
    title: '{myTag} fall {oppMaps}-{myMaps} in a heartbreaker',
    body: `HLTV recap: {opp} took the deciding map in a {oppMaps}-{myMaps} series that could have gone either way. {mvpNick} was quietly among the top performers on the map — the series was decided in the small margins.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss' && s.close,
    title: 'Coin-flip series: {opp} take it {oppMaps}-{myMaps}',
    body: `HLTV recap: Not much separated {myTag} and {opp} today, but the closing rounds went {opp}'s way. {mvpNick} carried the fight ({rating} rating) — the team just couldn't turn it into map wins.`,
  },

  // ===== Losses (fallback) =====
  {
    when: (s, ctx) => ctx.mood === 'loss',
    title: '{opp} take the series over {myTag}',
    body: `HLTV recap: {opp} take it {oppMaps}-{myMaps}. Not the day {myTag} wanted; back to the drawing board.`,
  },
  {
    when: (s, ctx) => ctx.mood === 'loss',
    title: '{myTag} drop the series to {opp}',
    body: `HLTV recap: A quiet loss for {myTag} — {opp} took it {oppMaps}-{myMaps} without much drama. VOD-review Monday awaits.`,
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
  // Weighted split — reasoning:
  //   55% Player Quote (falls through to Recap if no eligible speaker,
  //      e.g. all-real-name rosters where no newgen can be quoted).
  //   40% Match Recap (never null in practice — universal fallback
  //      templates gate only on mood).
  //   5% Media Question (interactive; only when a match-specific
  //      template gates open).
  if (r < 0.55) {
    gen = generatePlayerQuoteItem(ctx);
    kind = 'player-message';
  } else if (r < 0.95) {
    gen = generateMatchRecapItem(ctx);
    kind = 'media'; // "reporter recap" uses the media icon/colour
  } else {
    gen = generateMediaQuestionItem(ctx);
    kind = 'media';
  }
  // Bulletproof fallback chain — no null items ever leak through when
  // any narrative content is possible for this mood.
  if (!gen) {
    gen = generateMatchRecapItem(ctx);
    kind = 'media';
  }
  if (!gen) {
    gen = generatePlayerQuoteItem(ctx);
    kind = 'player-message';
  }
  if (!gen) return null;
  return emitInboxItem(db, notifyTeam, {
    teamId, kind,
    title: gen.title,
    body: gen.body,
    payload: gen.payload,
  });
}
