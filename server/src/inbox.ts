// Narrative inbox — the "make the world alive" layer.
//
// Interactive choice registry lives here. When a client posts
// `respond-inbox { itemId, choiceId }`, the handler looks the item up,
// dispatches on kind, and lets the resolver in this module decide what
// the choice does (morale bump, fans bump, follow-up news line, etc.).
// Effect strings + choice labels are all human-written so the game
// reads like a broadcast, not a spreadsheet.

import type { DB } from './db.ts';
import type { InboxChoice, InboxItem, ServerMessage } from '../../src/online/protocol.ts';
import type { Player } from '../../src/types.ts';

/** Fixed set of morale-delta buckets a choice can carry. Kept small so
 *  effects feel balanced and predictable. */
type MoraleDelta = -2 | -1 | 0 | 1 | 2;
/** Fans delta buckets — media choices only. Fans matter at scale so
 *  the buckets are bigger. */
type FansDelta = -500 | -200 | 0 | 200 | 500 | 1000;

interface ChoiceEffect {
  /** Free-text morale change applied to a specific player (for
   *  player-message items). */
  playerMorale?: MoraleDelta;
  /** Morale change applied to EVERY starter (for media items when
   *  the answer lands with the whole roster). */
  rosterMorale?: MoraleDelta;
  /** Fans delta from media items. */
  fans?: FansDelta;
  /** One-line summary shown as a toast + on the resolved inbox item. */
  summary: string;
}

// =====================================================================
// Post-match player message templates
// =====================================================================
//
// Each template = 3 choices with different effects. The generator picks
// one at random and stamps the target player's nickname into the copy.
// Choice ids stay stable so they resolve correctly on the server.

interface PlayerMessageTemplate {
  /** Which post-match mood this covers — win or loss. */
  mood: 'win' | 'loss';
  /** Title shown in the inbox list. `{nick}` templated to nickname. */
  title: string;
  /** Body shown when opened. `{nick}` templated. */
  body: string;
  choices: Array<InboxChoice & { effect: ChoiceEffect }>;
}

const WIN_MESSAGES: PlayerMessageTemplate[] = [
  {
    mood: 'win',
    title: '{nick} wants to talk shop',
    body: `"That win felt good, but I think we should push harder next time. I could've had five more frags if we called the fake earlier."`,
    choices: [
      { id: 'agree-agg', label: 'Agreed — trust the reads more.', hint: 'confident', effect: { playerMorale: +1, summary: 'Player leaves the meeting fired up.' } },
      { id: 'stay-tight', label: 'Stay disciplined — don\'t overpeek.', hint: 'measured', effect: { playerMorale: 0, summary: 'Neutral response; player nods and moves on.' } },
      { id: 'dismiss',    label: 'Focus on the next map.', hint: 'brush-off', effect: { playerMorale: -1, summary: 'Player feels brushed off. Small morale hit.' } },
    ],
  },
  {
    mood: 'win',
    title: '{nick} asks about their role',
    body: `"I noticed I got the entry fewer times this map. Am I underperforming, or is the plan changing?"`,
    choices: [
      { id: 'reassure', label: 'You\'re still our first pick — trust the plan.', hint: 'supportive', effect: { playerMorale: +1, summary: 'Player feels backed by the manager.' } },
      { id: 'honest',   label: 'Some rounds the read is on the other side.', hint: 'honest', effect: { playerMorale: 0, summary: 'Player accepts the honest read.' } },
      { id: 'blame',    label: 'You need to earn it back in scrims.', hint: 'harsh', effect: { playerMorale: -2, summary: 'Player takes it personally. Morale dips hard.' } },
    ],
  },
];

const LOSS_MESSAGES: PlayerMessageTemplate[] = [
  {
    mood: 'loss',
    title: '{nick} feels responsible',
    body: `"That last round on me. I should\'ve traded the AWPer instead of the entry. What do you want me to fix?"`,
    choices: [
      { id: 'coach',   label: 'Watch the VOD tonight — we\'ll break it down.', hint: 'coaching', effect: { playerMorale: +1, summary: 'Player leaves feeling supported and eager to learn.' } },
      { id: 'shrug',   label: 'One round, one match. Reset for tomorrow.', hint: 'reassuring', effect: { playerMorale: 0, summary: 'Player nods but stays quiet.' } },
      { id: 'blame',   label: 'Yeah — you cost us that one.', hint: 'harsh', effect: { playerMorale: -2, summary: 'Player takes the blame publicly. Morale drops.' } },
    ],
  },
  {
    mood: 'loss',
    title: '{nick} is questioning the tactics',
    body: `"I don\'t think we should\'ve been forcing fast executes against a stack. Why did we call that?"`,
    choices: [
      { id: 'admit',    label: 'Fair point — I\'ll adjust the play-book.', hint: 'humble', effect: { playerMorale: +1, summary: 'Player respects the honest answer.' } },
      { id: 'defend',   label: 'The read was right, the execution was off.', hint: 'firm', effect: { playerMorale: 0, summary: 'Player accepts it and moves on.' } },
      { id: 'shutdown', label: 'Play your role and stop questioning calls.', hint: 'authoritarian', effect: { playerMorale: -1, summary: 'Player goes silent. Small trust hit.' } },
    ],
  },
  {
    mood: 'loss',
    title: '{nick} needs air',
    body: `"I\'m gonna step away for a bit. That one hit different — the crowd was chirping the whole time."`,
    choices: [
      { id: 'space',   label: 'Take the day. Come back fresh.', hint: 'supportive', effect: { playerMorale: +2, summary: 'Player is genuinely grateful for the space.' } },
      { id: 'listen',  label: 'What do you need from me?', hint: 'engaged', effect: { playerMorale: +1, summary: 'Player opens up a little more.' } },
      { id: 'grind',   label: 'Now\'s the time to grind, not step away.', hint: 'harsh', effect: { playerMorale: -2, summary: 'Player forces a smile and grinds. Morale tanks.' } },
    ],
  },
];

// =====================================================================
// Media question templates
// =====================================================================
//
// Post-match press-conference questions. Choices affect FANS (not morale)
// because the media influences the public brand, not the locker room.

interface MediaTemplate {
  mood: 'win' | 'loss';
  title: string;
  body: string;
  choices: Array<InboxChoice & { effect: ChoiceEffect }>;
}

const WIN_MEDIA: MediaTemplate[] = [
  {
    mood: 'win',
    title: 'Reporter: "What\'s the secret?"',
    body: `You just took a series off {opp}. A reporter shoves a mic in your face and asks how you did it.`,
    choices: [
      { id: 'team',    label: 'It was all my players — I just make the calls.', hint: 'humble', effect: { fans: +500, rosterMorale: +1, summary: '+500 fans · roster morale +1 (deflecting to players plays well).' } },
      { id: 'trash',   label: '{opp} weren\'t ready. We\'d planned this for weeks.', hint: 'confident', effect: { fans: +200, summary: '+200 fans · trash-talk lands with your base but rattles the opposition.' } },
      { id: 'boring',  label: 'We just played our game.', hint: 'safe', effect: { fans: 0, summary: 'Neutral answer. Zero swing.' } },
    ],
  },
  {
    mood: 'win',
    title: 'Post-match interview',
    body: `The broadcast desk pulls you in for the after-game chat. They ask if this is the best win of the season.`,
    choices: [
      { id: 'hype',    label: 'Absolutely — this is what we\'ve been building toward.', hint: 'hype', effect: { fans: +500, summary: '+500 fans · confidence sells.' } },
      { id: 'humble',  label: 'Every win matters, we take them one at a time.', hint: 'humble', effect: { fans: +200, summary: '+200 fans · humble answer, respectable.' } },
      { id: 'cold',    label: 'It\'s just a group stage match.', hint: 'cold', effect: { fans: -200, summary: '-200 fans · cold shrug reads as unmarketable.' } },
    ],
  },
];

const LOSS_MEDIA: MediaTemplate[] = [
  {
    mood: 'loss',
    title: 'Reporter: "What went wrong?"',
    body: `A reporter catches you leaving the arena after the loss to {opp}. They ask if the team is in trouble.`,
    choices: [
      { id: 'own',     label: 'On me. I called the wrong plays — we\'ll fix it.', hint: 'own it', effect: { fans: +200, rosterMorale: +1, summary: '+200 fans · +1 roster morale (players see you shielding them).' } },
      { id: 'players', label: 'Some individual mistakes cost us today.', hint: 'blame players', effect: { fans: -500, rosterMorale: -1, summary: '-500 fans · -1 roster morale (throwing players under the bus).' } },
      { id: 'shrug',   label: 'No comment.', hint: 'stone-wall', effect: { fans: -200, summary: '-200 fans · silence reads as evasive.' } },
    ],
  },
  {
    mood: 'loss',
    title: 'Post-match interview',
    body: `They ask what the plan is going forward after dropping the series.`,
    choices: [
      { id: 'grind',   label: 'Back to the practice server, no excuses.', hint: 'gritty', effect: { fans: +500, summary: '+500 fans · fans respect the workmanlike answer.' } },
      { id: 'excuse',  label: '{opp} got lucky — the rounds were closer than the score.', hint: 'defensive', effect: { fans: -200, summary: '-200 fans · excuses don\'t sell.' } },
      { id: 'boring',  label: 'We\'ll review and come back stronger.', hint: 'boilerplate', effect: { fans: 0, summary: 'Neutral. Zero swing.' } },
    ],
  },
];

// =====================================================================
// Generators
// =====================================================================

function pick<T>(list: T[]): T | null {
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)]!;
}

/** Substitute template placeholders on every visible string. Handles
 *  `{nick}` (player nickname) and `{opp}` (opponent team tag). Missing
 *  values leave the placeholder as-is so the bug is visible in copy
 *  rather than silently swallowed. */
function fill(text: string, vars: { nick?: string; opp?: string }): string {
  let out = text;
  if (vars.nick) out = out.replace(/\{nick\}/g, vars.nick);
  if (vars.opp) out = out.replace(/\{opp\}/g, vars.opp);
  return out;
}

/** Generate a post-match player message. Returns null if no eligible
 *  starter is available (all real-name / retired etc.). */
export function generatePlayerMessageItem(
  starters: Player[], mood: 'win' | 'loss',
): { title: string; body: string; payload: Record<string, unknown> } | null {
  const eligible = starters.filter((p) => !p.isRealName && !p.retired);
  if (eligible.length === 0) return null;
  const player = pick(eligible)!;
  const template = pick(mood === 'win' ? WIN_MESSAGES : LOSS_MESSAGES);
  if (!template) return null;
  const vars = { nick: player.nickname };
  return {
    title: fill(template.title, vars),
    body: fill(template.body, vars),
    payload: {
      templateId: `${mood}:${WIN_MESSAGES.concat(LOSS_MESSAGES).indexOf(template)}`,
      playerId: player.id,
      playerNickname: player.nickname,
      mood,
      choices: template.choices.map((c) => ({
        id: c.id,
        label: fill(c.label, vars),
        hint: c.hint,
      })),
    },
  };
}

/** Generate a post-match media question. */
export function generateMediaItem(
  oppTag: string, mood: 'win' | 'loss',
): { title: string; body: string; payload: Record<string, unknown> } | null {
  const template = pick(mood === 'win' ? WIN_MEDIA : LOSS_MEDIA);
  if (!template) return null;
  const vars = { opp: oppTag };
  return {
    title: fill(template.title, vars),
    body: fill(template.body, vars),
    payload: {
      templateId: `${mood}:${WIN_MEDIA.concat(LOSS_MEDIA).indexOf(template)}`,
      oppTag,
      mood,
      choices: template.choices.map((c) => ({
        id: c.id,
        label: fill(c.label, vars),
        hint: c.hint,
      })),
    },
  };
}

// =====================================================================
// Resolver — applies the effect of a chosen response
// =====================================================================

/** Given a resolved inbox item and the chosen id, apply the effect and
 *  return a summary line for the toast. Returns null when the choice
 *  doesn\'t match any registered template (silent no-op). */
export function resolveInboxChoice(
  db: DB,
  item: InboxItem,
  teamId: string,
  choiceId: string,
): { summary: string; newFans?: number } | null {
  if (item.kind === 'player-message') {
    return resolvePlayerMessage(db, item, choiceId);
  }
  if (item.kind === 'media') {
    return resolveMedia(db, item, teamId, choiceId);
  }
  // Other kinds are non-interactive — respond-inbox just marks resolved.
  return { summary: 'Acknowledged.' };
}

function resolvePlayerMessage(
  db: DB, item: InboxItem, choiceId: string,
): { summary: string } | null {
  const templates = [...WIN_MESSAGES, ...LOSS_MESSAGES];
  const templateId = item.payload.templateId as string | undefined;
  if (!templateId) return null;
  const [mood, idxStr] = templateId.split(':');
  void mood;
  const template = templates[Number(idxStr)];
  if (!template) return null;
  const choice = template.choices.find((c) => c.id === choiceId);
  if (!choice) return null;
  const playerId = item.payload.playerId as string | undefined;
  if (!playerId) return { summary: choice.effect.summary };
  const player = db.loadPlayer(playerId);
  if (!player) return { summary: choice.effect.summary };
  const delta = choice.effect.playerMorale ?? 0;
  if (delta !== 0) {
    player.morale = Math.max(1, Math.min(20, (player.morale ?? 12) + delta));
    db.persistPlayer(player);
  }
  return { summary: choice.effect.summary };
}

function resolveMedia(
  db: DB, item: InboxItem, teamId: string, choiceId: string,
): { summary: string; newFans?: number } | null {
  const templates = [...WIN_MEDIA, ...LOSS_MEDIA];
  const templateId = item.payload.templateId as string | undefined;
  if (!templateId) return null;
  const [, idxStr] = templateId.split(':');
  const template = templates[Number(idxStr)];
  if (!template) return null;
  const choice = template.choices.find((c) => c.id === choiceId);
  if (!choice) return null;
  let newFans: number | undefined;
  if (choice.effect.fans) {
    // Persist the fans swing so it stacks over time.
    db.bumpTeamBonusFans(teamId, choice.effect.fans);
    // Report the CURRENT total (roster-derived + persisted bonus). Roster
    // derivation is heavy; we just echo the bonus delta and let the next
    // profile fetch reconcile the full number.
    newFans = choice.effect.fans;
  }
  // Roster-wide morale bump/dip from choice.
  const delta = choice.effect.rosterMorale ?? 0;
  if (delta !== 0) {
    const roster = db.loadTeamPlayers(teamId);
    for (const p of roster.slice(0, 5)) {
      p.morale = Math.max(1, Math.min(20, (p.morale ?? 12) + delta));
      db.persistPlayer(p);
    }
  }
  return { summary: choice.effect.summary, newFans };
}

// =====================================================================
// Helper: emit an inbox item to a team + push it to their live sockets
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
