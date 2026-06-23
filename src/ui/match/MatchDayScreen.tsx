import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { MAP_LAYOUTS } from '../../data/maps';
import type { KillEvent, MapResult, MatchResult, Player, Team } from '../../types';
import MapCanvas from './MapCanvas';
import PlayerAvatar from './PlayerAvatar';
import { TeamLogo } from '../TeamLogo';
import { play as playSound } from '../../sound/soundManager';
import RoundHistory from './RoundHistory';
import { hashSeed, RNG } from '../../engine/rng';
import { computeMomentum, detectRoundHighlights, type Highlight } from './highlights';

const T_COLOR = '#f2a13c';
const CT_COLOR = '#6aa7ec';

type Phase = 'pre' | 'live' | 'between-rounds' | 'between-maps' | 'done';

// Viewer position survives navigating to other screens mid-match (module scope,
// keyed by the scheduled match id so a NEW match still starts fresh).
let viewerMemo: {
  matchId: string | null;
  phase: Phase;
  mapIdx: number;
  roundIdx: number;
  frameIdx: number;
} = { matchId: null, phase: 'pre', mapIdx: 0, roundIdx: 0, frameIdx: 0 };

// ============ Pundit show helpers ============

interface PunditTake {
  author: string;
  text: string;
}

/** Pre-match punditry: two analyst predictions + key player to watch per side. */
function generatePreMatchTakes(
  teamA: Team,
  teamB: Team,
  lineupA: Player[],
  lineupB: Player[],
  matchId: string,
  format: string,
): { predictions: PunditTake[]; keyPlayers: { team: Team; player: Player; reason: string }[] } {
  const rng = new RNG(hashSeed(`pundit-pre-${matchId}`));
  const rankDelta = teamB.worldRanking - teamA.worldRanking;
  const favoured = rankDelta >= 0 ? teamA : teamB;
  const underdog = rankDelta >= 0 ? teamB : teamA;
  const gap = Math.abs(rankDelta);
  const scoreLine =
    format === 'BO1' ? '16-' + (12 + rng.int(0, 2)) :
    gap >= 8 ? '2-0' : gap >= 3 ? '2-1' : (rng.chance(0.55) ? '2-1' : '2-0');
  const conviction = gap >= 8 ? 'clean sweep' : gap >= 3 ? 'edge' : 'narrow upset window';
  const analystPool = [
    { id: 'SPUNJ', voice: ['the firepower edge', 'better setups', 'cleaner T-side'] },
    { id: 'Thorin', voice: ['the IGL gap', 'a tactical mismatch', 'better mid-round adapts'] },
    { id: 'launders', voice: ['recent form', 'momentum', 'the depth of role players'] },
    { id: 'YNk', voice: ['the AWP impact', 'mid-control', 'utility execution'] },
  ];
  const picks = rng.shuffle(analystPool).slice(0, 2);
  const predictions: PunditTake[] = picks.map((p) => ({
    author: p.id,
    text: `${p.id}: ${favoured.tag} ${scoreLine} — ${rng.pick(p.voice)} should decide it. ${conviction === 'narrow upset window' ? `Don't sleep on ${underdog.tag} though.` : ''}`.trim(),
  }));

  function keyOf(team: Team, lineup: Player[]): { team: Team; player: Player; reason: string } | null {
    if (lineup.length === 0) return null;
    const star = [...lineup].sort((a, b) => b.stats.rating * 0.5 + b.currentAbility * 0.5 - (a.stats.rating * 0.5 + a.currentAbility * 0.5))[0];
    const inForm = star.form >= 13;
    const onFire = star.stats.rating >= 1.15;
    const reasons = [
      onFire ? `In red-hot form (${star.stats.rating.toFixed(2)} season rating)` : null,
      inForm ? `Riding a strong week (form ${star.form.toFixed(0)})` : null,
      star.role === 'AWPer' ? 'The AWP X-factor for this matchup' : null,
      star.role === 'IGL' ? 'Brain of the team — calls will define the game' : null,
      `Career CA ${star.currentAbility}, the star to watch`,
    ].filter(Boolean) as string[];
    return { team, player: star, reason: rng.pick(reasons) };
  }
  const keyPlayers = [keyOf(teamA, lineupA), keyOf(teamB, lineupB)].filter((x): x is { team: Team; player: Player; reason: string } => !!x);
  return { predictions, keyPlayers };
}

/** Post-match reactions: standout stat callout + 2 analyst takes + fan tweet. */
function generatePostMatchReactions(
  matchRef: MatchResult,
  teamA: Team,
  teamB: Team,
  game: { players: Record<string, Player>; teams: Record<string, Team> },
): { spotlight: string | null; takes: PunditTake[]; fan: string | null } {
  const rng = new RNG(hashSeed(`pundit-post-${matchRef.matchId ?? `${teamA.id}-${teamB.id}`}`));
  const winner = game.teams[matchRef.winnerId];
  const loserId = matchRef.winnerId === teamA.id ? teamB.id : teamA.id;
  const loser = game.teams[loserId];

  // Find MVP + standout stats
  const byPlayer = new Map<string, { rating: number; n: number; k: number; d: number; util: number }>();
  for (const m of matchRef.maps) {
    for (const s of Object.values(m.playerStats)) {
      const e = byPlayer.get(s.playerId) ?? { rating: 0, n: 0, k: 0, d: 0, util: 0 };
      e.rating += s.rating; e.n++; e.k += s.kills; e.d += s.deaths; e.util += s.utilityDamage;
      byPlayer.set(s.playerId, e);
    }
  }
  const sorted = [...byPlayer.entries()].sort((a, b) => b[1].rating / b[1].n - a[1].rating / a[1].n);
  const top = sorted[0];
  const topPlayer = top ? game.players[top[0]] : null;
  const topAvg = top ? top[1].rating / top[1].n : 0;

  const spotlight = topPlayer
    ? `🎯 Standout: ${topPlayer.nickname} ${topAvg.toFixed(2)} rating · ${top![1].k}-${top![1].d} (${winner.tag === game.teams[topPlayer.teamId ?? '']?.tag ? 'on the winning side' : 'on the losing side, but a personal showcase'})`
    : null;

  const seriesScore = `${matchRef.mapsA}-${matchRef.mapsB}`;
  const clean = Math.abs(matchRef.mapsA - matchRef.mapsB) >= 2;
  const upset = winner && winner.worldRanking > (loser?.worldRanking ?? 99) + 4;

  const analysts = ['SPUNJ', 'Thorin', 'launders', 'YNk'];
  const takeTemplates: (() => string)[] = [
    () => `${winner.tag} ${clean ? 'cruised' : 'edged it'} ${seriesScore}. ${topPlayer ? `${topPlayer.nickname} was the difference.` : ''} ${loser ? `${loser.tag} need to look at their utility usage.` : ''}`,
    () => `${upset ? 'Massive result for' : 'Routine business for'} ${winner.tag}. ${topPlayer ? `${topPlayer.nickname}'s ${topAvg.toFixed(2)} rating is the headline.` : ''}`,
    () => `Tactically ${winner.tag} read ${loser?.tag ?? 'their opponent'} like a book. The rotations were a step ahead all match.`,
    () => `${loser?.tag ?? 'The loser'} weren't bad — ${winner.tag} were just better when it mattered. ${seriesScore} flatters neither side.`,
    () => `${seriesScore} doesn't tell the full story — ${winner.tag}'s map control was textbook today.`,
  ];
  const takes: PunditTake[] = [];
  const usedT = new Set<number>();
  const usedA = new Set<string>();
  for (let i = 0; i < 2; i++) {
    let idx = rng.int(0, takeTemplates.length - 1);
    let tries = 0;
    while (usedT.has(idx) && tries++ < 6) idx = rng.int(0, takeTemplates.length - 1);
    usedT.add(idx);
    let author = analysts[rng.int(0, analysts.length - 1)];
    let tries2 = 0;
    while (usedA.has(author) && tries2++ < 6) author = analysts[rng.int(0, analysts.length - 1)];
    usedA.add(author);
    takes.push({ author, text: takeTemplates[idx]().trim().replace(/\s+/g, ' ') });
  }

  const fanTemplates = [
    `${winner.tag} ARE SO BACK 🚀🚀`,
    `${loser?.tag ?? 'them'} are FINISHED. time for a roster move`,
    topPlayer ? `${topPlayer.nickname} is unreal 🐐 ${topAvg.toFixed(2)} casually` : `told y'all ${winner.tag} would take it`,
    upset ? `BIGGEST upset of the event. ${winner.tag} cooking 🔥` : `business as usual for ${winner.tag}`,
    `as a ${loser?.tag ?? 'fan'} fan i need a break from this scene`,
  ];
  const fan = rng.pick(fanTemplates);
  return { spotlight, takes, fan };
}

export default function MatchDayScreen() {
  const game = useGame((s) => s.game)!;
  const liveMatch = useGame((s) => s.liveMatch);
  const liveMatchConfirmed = useGame((s) => s.liveMatchConfirmed);
  const liveMatchScheduledId = useGame((s) => s.liveMatchScheduledId);
  const playUserMatch = useGame((s) => s.playUserMatch);
  const playNextMap = useGame((s) => s.playNextMap);
  const seriesIsDecided = useGame((s) => s.seriesIsDecided);
  const confirmUserMatch = useGame((s) => s.confirmUserMatch);
  const userMatchToday = useGame((s) => s.userMatchToday);
  const pendingCalls = useGame((s) => s.game?.pendingCalls ?? []);
  const queueCall = useGame((s) => s.queueCall);
  const removeCall = useGame((s) => s.removeCall);
  const callTimeout = useGame((s) => s.callTimeout);
  const timeoutsRemaining = useGame((s) => s.timeoutsRemaining);
  const go = useGame((s) => s.go);
  const openPlayer = useGame((s) => s.openPlayer);

  const scheduled = userMatchToday();

  // resume from the saved viewer position when re-mounting mid-match
  const resume = liveMatch && liveMatchScheduledId && viewerMemo.matchId === liveMatchScheduledId;
  const [phase, setPhase] = useState<Phase>(() => {
    if (!liveMatch) return 'pre';
    if (liveMatchConfirmed) return 'done';
    return resume ? viewerMemo.phase : 'live';
  });
  const [mapIdx, setMapIdx] = useState(() => (resume ? viewerMemo.mapIdx : 0));
  const [roundIdx, setRoundIdx] = useState(() => (resume ? viewerMemo.roundIdx : 0));
  const [frameIdx, setFrameIdx] = useState(() => (resume ? viewerMemo.frameIdx : 0));
  const [lerp, setLerp] = useState(0);
  const [speed, setSpeed] = useState(2);
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  const [timeoutStatus, setTimeoutStatus] = useState<string | null>(null);
  // Critical-moment manager intervention: capped at 3 per map.
  const [interventionsLeft, setInterventionsLeft] = useState(3);
  const [criticalMoment, setCriticalMoment] = useState<{ title: string; line: string } | null>(null);
  // Transient highlight banners — fade in/out for big moments (multi-kill, clutch, etc).
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const lastHighlightRoundRef = useRef<string>(''); // dedupe key: mapIdx-roundIdx
  // Track dismissal timers so we can cancel them on unmount (otherwise
  // setHighlights fires on an unmounted component → React warning + leak).
  const highlightTimersRef = useRef<number[]>([]);
  const confirmedRef = useRef(liveMatchConfirmed);

  // keep the viewer position saved so navigating away and back resumes playback
  useEffect(() => {
    if (phase === 'pre') return;
    viewerMemo = { matchId: liveMatchScheduledId, phase, mapIdx, roundIdx, frameIdx };
  }, [liveMatchScheduledId, phase, mapIdx, roundIdx, frameIdx]);

  // new match day while screen stays mounted: reset to pre-match
  useEffect(() => {
    if (!liveMatch) {
      viewerMemo = { matchId: null, phase: 'pre', mapIdx: 0, roundIdx: 0, frameIdx: 0 };
      setPhase('pre');
      setMapIdx(0);
      setRoundIdx(0);
      setFrameIdx(0);
      confirmedRef.current = false;
    }
  }, [liveMatch]);

  const nicknames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of Object.values(game.players)) out[p.id] = p.nickname;
    return out;
  }, [game.players]);

  // no match and nothing live → bounce home
  if (!scheduled && !liveMatch) {
    return (
      <div className="panel" style={{ padding: 24 }}>
        <h2>No match today</h2>
        <button className="btn" onClick={() => go('home')}>Back</button>
      </div>
    );
  }

  const matchRef: MatchResult | null = liveMatch;
  const teamA = game.teams[(matchRef?.teamAId ?? scheduled!.teamAId)];
  const teamB = game.teams[(matchRef?.teamBId ?? scheduled!.teamBId)];
  const tournament = scheduled ? game.tournaments[scheduled.tournamentId] : null;

  const curMap: MapResult | null = matchRef ? matchRef.maps[Math.min(mapIdx, matchRef.maps.length - 1)] : null;
  const curRound = curMap ? curMap.rounds[Math.min(roundIdx, curMap.rounds.length - 1)] : null;
  const frames = curRound?.frames ?? [];
  const frame = frames.length ? frames[Math.min(frameIdx, frames.length - 1)] : null;
  const prevFrame = frames.length ? frames[Math.max(0, Math.min(frameIdx, frames.length - 1) - 1)] : null;

  const doConfirm = () => {
    if (!confirmedRef.current) {
      confirmedRef.current = true;
      confirmUserMatch();
    }
  };

  // playback loop — pauses while the tactical timeout modal is open OR a
  // critical-moment overlay is showing.
  useEffect(() => {
    if (phase !== 'live' || !matchRef || timeoutOpen || criticalMoment) return;
    const tickMs = 300 / speed;
    let raf = 0;
    let last = performance.now();
    let acc = lerp;
    const step = (now: number) => {
      acc += (now - last) / tickMs;
      last = now;
      if (acc >= 1) {
        acc = 0;
        setFrameIdx((f) => {
          const map = matchRef.maps[mapIdx];
          const round = map.rounds[roundIdx];
          if (f + 1 >= round.frames.length) {
            // Round ended — play side-appropriate audio cue
            const userIsA = matchRef.teamAId === game.userTeamId;
            const winnerIsUser = round.winnerTeamId === (userIsA ? matchRef.teamAId : matchRef.teamBId);
            // Defuse = CT clutch save (high-tension relief)
            if (round.reason === 'defuse') playSound('bomb-defuse');
            else playSound(winnerIsUser ? 'round-win' : 'round-loss');
            setPhase('between-rounds');
            return f;
          }
          // Bomb plant detection — fires once when frame's bombPlanted flips on
          const prev = round.frames[f];
          const next = round.frames[f + 1];
          if (next && !prev?.bombPlanted && next.bombPlanted) {
            playSound('bomb-plant');
          }
          return f + 1;
        });
      }
      setLerp(Math.min(1, acc));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, speed, mapIdx, roundIdx, matchRef, timeoutOpen, criticalMoment]);

  // Detect critical moments at end of round → trigger overlay before auto-advance.
  // Fires when phase becomes 'between-rounds', once per round.
  useEffect(() => {
    if (phase !== 'between-rounds' || !matchRef || !curMap || criticalMoment || interventionsLeft <= 0) return;
    if (roundIdx >= curMap.rounds.length) return;
    const round = curMap.rounds[roundIdx];
    const userIsA = teamA.id === game.userTeamId;
    const userIsB = teamB.id === game.userTeamId;
    if (!userIsA && !userIsB) return; // only fire for user matches
    const revealedSlice = curMap.rounds.slice(0, roundIdx + 1);
    let aScore = 0, bScore = 0;
    for (const r of revealedSlice) { if (r.winnerTeamId === teamA.id) aScore++; else bScore++; }
    const userScore = userIsA ? aScore : bScore;
    const oppScore = userIsA ? bScore : aScore;
    const userWonRound = round.winnerTeamId === game.userTeamId;
    // Detect 3-round losing/winning streak
    let streak = 0;
    for (let i = revealedSlice.length - 1; i >= 0; i--) {
      const winnerUser = revealedSlice[i].winnerTeamId === game.userTeamId;
      if (i === revealedSlice.length - 1) { streak = winnerUser ? 1 : -1; continue; }
      if (winnerUser && streak > 0) streak++;
      else if (!winnerUser && streak < 0) streak--;
      else break;
    }
    let moment: { title: string; line: string } | null = null;
    // Big-stakes detection — pick the most dramatic if multiple apply.
    if ((userScore === 12 && oppScore <= 11) || (oppScore === 12 && userScore <= 11)) {
      moment = userScore === 12
        ? { title: '🎯 MAP POINT', line: `${teamA.id === game.userTeamId ? teamA.tag : teamB.tag} need ONE more for the map. Time to close it out — or stumble at the line.` }
        : { title: '🚨 FACING MAP POINT', line: `${teamA.id === game.userTeamId ? teamB.tag : teamA.tag} are on map point. One round to delay the inevitable.` };
    } else if (round.clutch?.won && curMap.rounds[roundIdx].winnerTeamId === game.userTeamId) {
      moment = { title: '🔥 CLUTCH WIN', line: `${round.clutch.playerId} pulls off the clutch! Massive momentum swing for your side.` };
    } else if (round.clutch?.won && curMap.rounds[roundIdx].winnerTeamId !== game.userTeamId) {
      moment = { title: '😤 CLUTCH AGAINST', line: `An impossible clutch goes against you. Stay composed — there's still a long way to go.` };
    } else if (streak <= -4) {
      moment = { title: '📉 LOSING STREAK', line: `That's ${-streak} rounds in a row going against you. The wheels are coming off if you don't intervene.` };
    } else if (streak >= 4) {
      moment = { title: '🚀 ROLLING', line: `${streak}-round streak! The squad's locked in — but easy to get cocky here.` };
    } else if (revealedSlice.length === 12) {
      moment = { title: '🔁 HALFTIME', line: `Half over — ${userScore}:${oppScore}. Side swap incoming. What's the tone for half 2?` };
    } else if (Math.abs(userScore - oppScore) <= 1 && revealedSlice.length >= 18) {
      moment = { title: '⚖️ CLOSE FINISH', line: `Tight scoreline late in the map. Every round here decides it.` };
    }
    if (moment) {
      setCriticalMoment(moment);
      // Auto-dismiss after 7s if user doesn't interact (no call applied).
      const t = window.setTimeout(() => setCriticalMoment((cur) => (cur === moment ? null : cur)), 7000);
      return () => window.clearTimeout(t);
    }
    // satisfy unused-var lint when no moment fires
    void userWonRound;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundIdx, mapIdx, matchRef]);

  // Highlight banners — detect dramatic round moments at end of round and
  // queue them as fading overlays. Multiple banners stack and fade independently.
  useEffect(() => {
    if (phase !== 'between-rounds' || !matchRef || !curMap) return;
    const key = `${mapIdx}-${roundIdx}`;
    if (lastHighlightRoundRef.current === key) return; // already processed
    lastHighlightRoundRef.current = key;
    const round = curMap.rounds[roundIdx];
    if (!round) return;
    const rosterAIds = new Set(teamA.playerIds);
    const found = detectRoundHighlights(round, game.players, rosterAIds);
    if (found.length === 0) return;
    setHighlights((prev) => [...prev, ...found]);
    // Each banner self-dismisses after ~3.5s. Track ids so unmount cleanup
    // can cancel them.
    for (const h of found) {
      const id = window.setTimeout(() => {
        setHighlights((cur) => cur.filter((x) => x.id !== h.id));
      }, 3500);
      highlightTimersRef.current.push(id);
    }
  }, [phase, roundIdx, mapIdx, matchRef, curMap, game.players, teamA.playerIds]);

  // Cancel pending highlight dismissals on unmount.
  useEffect(
    () => () => {
      for (const id of highlightTimersRef.current) window.clearTimeout(id);
      highlightTimersRef.current = [];
    },
    [],
  );

  // between-rounds → advance after pause (also frozen during a tactical timeout
  // or a critical-moment overlay)
  useEffect(() => {
    if (phase !== 'between-rounds' || !matchRef || timeoutOpen || criticalMoment) return;
    const t = setTimeout(() => {
      const map = matchRef.maps[mapIdx];
      if (roundIdx + 1 < map.rounds.length) {
        setRoundIdx(roundIdx + 1);
        setFrameIdx(0);
        setPhase('live');
      } else if (!seriesIsDecided()) {
        // map break: next map not simulated yet — tactics can still be changed
        setPhase('between-maps');
      } else {
        doConfirm();
        setPhase('done');
      }
    }, 1400 / Math.min(speed, 4));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundIdx, mapIdx, matchRef, speed, timeoutOpen, criticalMoment]);

  // live K/D computed from revealed kills only (no spoilers)
  const liveStats = useMemo(() => {
    const stats: Record<string, { k: number; d: number; a: number }> = {};
    if (!matchRef) return stats;
    const map = matchRef.maps[Math.min(mapIdx, matchRef.maps.length - 1)];
    const reveal = (k: KillEvent, rIdx: number) =>
      rIdx < roundIdx || (rIdx === roundIdx && (phase !== 'live' || k.tick <= (frame?.tick ?? 0)));
    map.rounds.forEach((r, rIdx) => {
      if (rIdx > roundIdx) return;
      for (const k of r.kills) {
        if (!reveal(k, rIdx)) continue;
        stats[k.killerId] = stats[k.killerId] ?? { k: 0, d: 0, a: 0 };
        stats[k.victimId] = stats[k.victimId] ?? { k: 0, d: 0, a: 0 };
        stats[k.killerId].k++;
        stats[k.victimId].d++;
        if (k.assistId) {
          stats[k.assistId] = stats[k.assistId] ?? { k: 0, d: 0, a: 0 };
          stats[k.assistId].a++;
        }
      }
    });
    return stats;
  }, [matchRef, mapIdx, roundIdx, frame, phase]);

  // revealed score for current map
  const mapScore = useMemo(() => {
    if (!matchRef || !curMap) return { a: 0, b: 0 };
    let a = 0, b = 0;
    const upTo = phase === 'between-rounds' || phase === 'between-maps' || phase === 'done' ? roundIdx : roundIdx - 1;
    curMap.rounds.forEach((r, i) => {
      if (i <= upTo) {
        if (r.winnerTeamId === teamA.id) a++;
        else b++;
      }
    });
    return { a, b };
  }, [matchRef, curMap, roundIdx, phase, teamA.id]);

  const seriesScore = useMemo(() => {
    if (!matchRef) return { a: 0, b: 0 };
    let a = 0, b = 0;
    matchRef.maps.forEach((m, i) => {
      if (i < mapIdx || (i === mapIdx && phase === 'done')) {
        if (m.scoreA > m.scoreB) a++;
        else b++;
      }
    });
    if (phase === 'between-maps' && curMap) {
      if (curMap.scoreA > curMap.scoreB) a++;
      else b++;
    }
    return { a, b };
  }, [matchRef, mapIdx, phase, curMap]);

  // revealed rounds (current round only after its banner shows — no spoilers)
  const revealedRounds = useMemo(() => {
    if (!curMap) return [];
    const n = phase === 'live' ? roundIdx : roundIdx + 1;
    return curMap.rounds.slice(0, Math.max(0, Math.min(n, curMap.rounds.length)));
  }, [curMap, roundIdx, phase]);

  // which side team A plays this round (from the live frame)
  const teamASide: 'T' | 'CT' | null = useMemo(() => {
    const d = frame?.dots.find((x) => teamA.playerIds.includes(x.playerId));
    return d?.side ?? null;
  }, [frame, teamA.playerIds]);
  const teamBSide: 'T' | 'CT' | null = teamASide === 'T' ? 'CT' : teamASide === 'CT' ? 'T' : null;

  // per-half breakdown from revealed rounds
  const halves = useMemo(() => {
    const h = { a1: 0, b1: 0, a2: 0, b2: 0, aot: 0, bot: 0, second: false, ot: false };
    for (const r of revealedRounds) {
      const a = r.winnerTeamId === teamA.id;
      if (r.roundNo <= 12) a ? h.a1++ : h.b1++;
      else if (r.roundNo <= 24) {
        h.second = true;
        a ? h.a2++ : h.b2++;
      } else {
        h.ot = true;
        a ? h.aot++ : h.bot++;
      }
    }
    return h;
  }, [revealedRounds, teamA.id]);

  // series maps parsed from the veto log (picks + decider)
  const seriesMaps = useMemo(() => {
    if (!matchRef) return [];
    const picks: { map: string; by: string | null }[] = [];
    for (const line of matchRef.vetoLog) {
      let m = line.match(/^(\S+) pick (\S+)$/);
      if (m) {
        picks.push({ map: m[2], by: m[1] });
        continue;
      }
      m = line.match(/^(\S+) is the (decider|map five)$/);
      if (m) picks.push({ map: m[1], by: null });
    }
    return picks;
  }, [matchRef]);

  // kill feed (last 6 revealed kills in current round)
  const killFeed = useMemo(() => {
    if (!curRound) return [];
    const cur = phase === 'live' ? (frame?.tick ?? 0) : 9999;
    return curRound.kills.filter((k) => k.tick <= cur).slice(-6);
  }, [curRound, frame, phase]);

  // commentary feed
  const commentary = useMemo(() => {
    if (!curMap) return [];
    const out: { round: number; text: string }[] = [];
    curMap.rounds.forEach((r, i) => {
      if (i > roundIdx) return;
      const all = r.commentary;
      const n =
        i < roundIdx || phase !== 'live'
          ? all.length
          : Math.ceil((Math.min(frameIdx, (r.frames.length || 1) - 1) / Math.max(1, r.frames.length - 1)) * all.length);
      all.slice(0, n).forEach((text) => out.push({ round: r.roundNo, text }));
    });
    return out.slice(-9);
  }, [curMap, roundIdx, frameIdx, phase]);

  const skipRound = () => setPhase('between-rounds');
  const skipMap = () => {
    if (!matchRef) return;
    setRoundIdx(matchRef.maps[mapIdx].rounds.length - 1);
    setPhase('between-rounds');
  };
  const skipAll = () => {
    if (!matchRef) return;
    setMapIdx(matchRef.maps.length - 1);
    setRoundIdx(matchRef.maps[matchRef.maps.length - 1].rounds.length - 1);
    doConfirm();
    setPhase('done');
  };

  // ============ PRE-MATCH ============
  if (phase === 'pre' && scheduled) {
    const lineup = (teamId: string) =>
      game.teams[teamId].playerIds.slice(0, 5).map((id) => game.players[id]).filter(Boolean);
    const lineupA = lineup(teamA.id);
    const lineupB = lineup(teamB.id);
    const punditShow = generatePreMatchTakes(teamA, teamB, lineupA, lineupB, scheduled.id, scheduled.format);
    // Head-to-head from match history
    const h2hMatches = game.matchHistory.filter((mh) =>
      (mh.teamAId === teamA.id && mh.teamBId === teamB.id) ||
      (mh.teamAId === teamB.id && mh.teamBId === teamA.id),
    );
    const h2hAWins = h2hMatches.filter((mh) => mh.winnerId === teamA.id).length;
    const h2hBWins = h2hMatches.filter((mh) => mh.winnerId === teamB.id).length;
    return (
      <div className="md-pre">
        <div className="panel" style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ color: '#8b93a3', fontSize: 13 }}>
            {tournament?.name} — {scheduled.roundLabel} ({scheduled.format})
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, margin: '12px 0' }}>
            <TeamLogo team={teamA} size="lg" />
            <h1 style={{ margin: 0 }}>
              {teamA.name} <span style={{ color: '#8b93a3' }}>vs</span> {teamB.name}
            </h1>
            <TeamLogo team={teamB} size="lg" />
          </div>
          <div style={{ color: '#8b93a3', fontSize: 13 }}>
            World #{teamA.worldRanking} vs World #{teamB.worldRanking}
            {h2hMatches.length > 0 && (
              <span style={{ marginLeft: 14 }}>· H2H: <strong>{h2hAWins}</strong>–<strong>{h2hBWins}</strong></span>
            )}
          </div>

          {/* ===== Pre-match punditry ===== */}
          <div className="pundit-panel" style={{ maxWidth: 760, margin: '18px auto 0' }}>
            <div className="pundit-head">📺 PRE-MATCH SHOW</div>
            <div className="pundit-predictions">
              {punditShow.predictions.map((p, i) => (
                <div key={i} className="pundit-take">
                  <span className="pundit-author">{p.author}</span>
                  <span className="pundit-text">{p.text}</span>
                </div>
              ))}
            </div>
            <div className="pundit-keyplayers">
              {punditShow.keyPlayers.map((kp) => (
                <div key={kp.team.id} className="pundit-keyplayer">
                  <span className="muted small">KEY PLAYER · {kp.team.tag}</span>
                  <strong>{kp.player.nickname}</strong>
                  <span className="muted small">{kp.reason}</span>
                </div>
              ))}
            </div>
          </div>

          {(teamA.id === game.userTeamId || teamB.id === game.userTeamId) && (
            <PreMatchLineup userTeamId={game.userTeamId} />
          )}

          {(teamA.id === game.userTeamId || teamB.id === game.userTeamId) && (
            <DressingRoomTalk matchId={scheduled.id} />
          )}

          <div className="calls-panel" style={{ maxWidth: 720, margin: '20px auto 0' }}>
            <div className="calls-head">
              PRE-MATCH CALL — APPLIES TO MAP 1
              <span className="muted small">opt out anytime by un-clicking</span>
            </div>
            <div className="calls-grid">
              {(
                [
                  { id: 'speed-up', label: 'Speed Up', hint: 'Bias to rush/fast strats' },
                  { id: 'slow-down', label: 'Slow Down', hint: 'Bias to slow defaults' },
                  { id: 'stack-a', label: 'Stack A', hint: 'Force 3 CTs onto A site' },
                  { id: 'stack-b', label: 'Stack B', hint: 'Force 3 CTs onto B site' },
                  { id: 'push', label: 'Push', hint: '+5 aggression' },
                  { id: 'hold', label: 'Hold', hint: '−5 aggression' },
                ] as const
              ).map((c) => {
                const active = pendingCalls.includes(c.id);
                return (
                  <button
                    key={c.id}
                    className={`call-chip ${active ? 'active' : ''}`}
                    title={c.hint}
                    onClick={() => (active ? removeCall(c.id) : queueCall(c.id))}
                  >
                    <span className="call-chip-label">{c.label}</span>
                    <span className="call-chip-hint">{c.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-accent" onClick={() => { playUserMatch(); setPhase('live'); setMapIdx(0); setRoundIdx(0); setFrameIdx(0); }}>
              Go to Match
            </button>
            <button
              className="btn"
              onClick={() => {
                playUserMatch();
                // confirm + jump straight to result
                setTimeout(() => {
                  const lm = useGame.getState().liveMatch;
                  if (lm) {
                    setMapIdx(lm.maps.length - 1);
                    setRoundIdx(lm.maps[lm.maps.length - 1].rounds.length - 1);
                  }
                  if (!confirmedRef.current) {
                    confirmedRef.current = true;
                    useGame.getState().confirmUserMatch();
                  }
                  setPhase('done');
                }, 0);
              }}
            >
              Instant Result
            </button>
          </div>
        </div>
        <div className="md-two">
          {[teamA, teamB].map((t) => (
            <div key={t.id} className="panel" style={{ padding: 16 }}>
              <h3 style={{ marginTop: 0 }}>{t.name}</h3>
              <table className="table">
                <thead>
                  <tr><th>Player</th><th>Role</th><th>Form</th><th>Rating</th></tr>
                </thead>
                <tbody>
                  {lineup(t.id).map((p) => (
                    <tr key={p.id}>
                      <td>{p.nickname}</td>
                      <td>{p.role}</td>
                      <td>{p.form.toFixed(0)}</td>
                      <td>{p.stats.rating.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!matchRef || !curMap || !curRound) return null;

  // ============ POST-MATCH ============
  if (phase === 'done') {
    const won = matchRef.winnerId === game.userTeamId;
    const allStats = matchRef.maps.flatMap((m) => Object.values(m.playerStats));
    const byPlayer = new Map<string, { rating: number; n: number; k: number; d: number }>();
    for (const s of allStats) {
      const e = byPlayer.get(s.playerId) ?? { rating: 0, n: 0, k: 0, d: 0 };
      e.rating += s.rating; e.n++; e.k += s.kills; e.d += s.deaths;
      byPlayer.set(s.playerId, e);
    }
    const mvp = [...byPlayer.entries()].sort((a, b) => b[1].rating / b[1].n - a[1].rating / a[1].n)[0];
    const postShow = generatePostMatchReactions(matchRef, teamA, teamB, game);
    return (
      <div className="md-post">
        <div className="panel" style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ color: won ? '#4caf7d' : '#e25555', fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>
            {won ? 'VICTORY' : 'DEFEAT'}
          </div>
          <h1 style={{ margin: '6px 0' }}>
            {teamA.tag} {matchRef.mapsA} — {matchRef.mapsB} {teamB.tag}
          </h1>
          <div style={{ color: '#8b93a3' }}>
            {matchRef.maps.map((m) => `${m.map} ${m.scoreA}-${m.scoreB}`).join('  •  ')}
          </div>
          {mvp && (
            <div style={{ marginTop: 8, color: '#de9b35' }}>
              MVP: {nicknames[mvp[0]]} ({(mvp[1].rating / mvp[1].n).toFixed(2)} rating, {mvp[1].k}-{mvp[1].d})
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-accent" onClick={() => go('home')}>Continue</button>
          </div>
        </div>

        {/* ===== Post-match show ===== */}
        <div className="pundit-panel" style={{ padding: 14 }}>
          <div className="pundit-head">📺 POST-MATCH SHOW</div>
          {postShow.spotlight && (
            <div className="pundit-spotlight">{postShow.spotlight}</div>
          )}
          <div className="pundit-predictions">
            {postShow.takes.map((t, i) => (
              <div key={i} className="pundit-take">
                <span className="pundit-author">{t.author}</span>
                <span className="pundit-text">"{t.text}"</span>
              </div>
            ))}
          </div>
          {postShow.fan && (
            <div className="pundit-fan">💬 fan_42: <em>{postShow.fan}</em></div>
          )}
        </div>
        {matchRef.maps.map((m, i) => (
          <div key={i} className="panel" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>{m.map} — {m.scoreA}:{m.scoreB}</h3>
            <div className="md-two">
              {[teamA, teamB].map((t) => (
                <table key={t.id} className="sb-table">
                  <thead>
                    <tr>
                      <th>{t.tag}</th>
                      <th className="num">K</th>
                      <th className="num">D</th>
                      <th className="num">A</th>
                      <th className="num">ADR</th>
                      <th className="num" title="Utility damage per round">UD</th>
                      <th className="num">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(m.playerStats)
                      .filter((s) => game.players[s.playerId]?.teamId === t.id || t.playerIds.includes(s.playerId))
                      .sort((a, b) => b.rating - a.rating)
                      .map((s) => {
                        const p = game.players[s.playerId];
                        return (
                          <tr key={s.playerId}>
                            <td className="clickable" onClick={() => openPlayer(s.playerId)} title="Open profile">
                              <span className="sb-player">
                                <PlayerAvatar
                                  playerId={s.playerId}
                                  nickname={p?.nickname ?? s.playerId}
                                  nationality={p?.nationality ?? ''}
                                  hltvId={p?.hltvId}
                                  size={24}
                                />
                                <span className="sb-nick">{nicknames[s.playerId]}</span>
                              </span>
                            </td>
                            <td className="num">{s.kills}</td>
                            <td className="num">{s.deaths}</td>
                            <td className="num">{s.assists}</td>
                            <td className="num">{(s.damage / m.rounds.length).toFixed(0)}</td>
                            <td className="num ud-cell" title={`${s.utilityDamage} total util damage`}>
                              {(s.utilityDamage / m.rounds.length).toFixed(1)}
                            </td>
                            <td className="num" style={{ color: s.rating >= 1.1 ? '#4caf7d' : s.rating < 0.9 ? '#e25555' : undefined, fontWeight: 700 }}>
                              {s.rating.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ))}
            </div>
          </div>
        ))}
        <div className="panel" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Veto</h3>
          <div style={{ color: '#8b93a3', fontSize: 13 }}>{matchRef.vetoLog.join('  →  ')}</div>
        </div>
      </div>
    );
  }

  // ============ LIVE ============
  const layout = MAP_LAYOUTS[curMap.map];
  const teamAIds = new Set(teamA.playerIds);
  const lastRoundBanner = phase === 'between-rounds' || phase === 'between-maps';

  return (
    <div className="md-live">
      {/* ===== TOP BAR: score head + momentum + maps strip + round timeline ===== */}
      <div className="md-top">
        <div className="panel md-scorehead">
          <div className="md-scorehead-team md-scorehead-left">
            <span className="md-scorehead-tag">{teamA.tag}</span>
            {teamASide && <span className={`side-badge ${teamASide.toLowerCase()}`}>{teamASide}</span>}
          </div>
          <div className="md-scorehead-center">
            <div className="md-scorehead-score">
              <span style={{ color: teamASide === 'T' ? T_COLOR : teamASide === 'CT' ? CT_COLOR : undefined }}>{mapScore.a}</span>
              <span style={{ color: '#5d6678' }}> : </span>
              <span style={{ color: teamBSide === 'T' ? T_COLOR : teamBSide === 'CT' ? CT_COLOR : undefined }}>{mapScore.b}</span>
            </div>
            <div className="md-scorehead-meta">
              <span>{curMap.map} • R{Math.min(roundIdx + 1, curMap.rounds.length)}</span>
              {phase === 'live' && frame && (() => {
                const bombPlantTick = curRound?.bombPlanted
                  ? curRound.frames.find((f) => f.bombPlanted)?.tick
                  : undefined;
                const planted = frame.bombPlanted && bombPlantTick !== undefined;
                const secs = planted
                  ? Math.max(0, 40 - (frame.tick - bombPlantTick!) * 2)
                  : Math.max(0, 115 - frame.tick * 2);
                return (
                  <span className={`round-clock ${planted ? 'planted' : ''} ${secs <= 10 ? 'low' : ''}`}>
                    {planted ? '💣 ' : ''}
                    {Math.floor(secs / 60)}:{String(Math.floor(secs) % 60).padStart(2, '0')}
                  </span>
                );
              })()}
              <span>1st {halves.a1}:{halves.b1}</span>
              {halves.second && <span>2nd {halves.a2}:{halves.b2}</span>}
              {halves.ot && <span>OT {halves.aot}:{halves.bot}</span>}
            </div>
          </div>
          <div className="md-scorehead-team md-scorehead-right">
            {teamBSide && <span className={`side-badge ${teamBSide.toLowerCase()}`}>{teamBSide}</span>}
            <span className="md-scorehead-tag">{teamB.tag}</span>
          </div>
        </div>

        {/* Compact strip: maps-bar | momentum | round timeline. */}
        <div className="md-strip">
          {seriesMaps.length > 0 && (
            <div className="maps-bar md-strip-maps">
              {seriesMaps.map((sm, i) => {
                const played = matchRef.maps[i];
                const isLive = i === mapIdx;
                const score =
                  !played || i > mapIdx
                    ? '—'
                    : i === mapIdx
                      ? `${mapScore.a}:${mapScore.b}`
                      : `${played.scoreA}:${played.scoreB}`;
                return (
                  <div key={i} className={`maps-pill ${isLive ? 'live' : ''}`}>
                    <span className="mp-name">{sm.map}</span>
                    <span className="mp-score">{score}</span>
                  </div>
                );
              })}
            </div>
          )}

          {revealedRounds.length >= 2 && (() => {
            const m = computeMomentum(revealedRounds, teamA.id);
            const pct = 50 + m * 50;
            const label = Math.abs(m) >= 0.6 ? `${m > 0 ? teamA.tag : teamB.tag} surging` : 'Tight';
            return (
              <div className="momentum-bar md-strip-mom" title={`Momentum ${(m * 100).toFixed(0)}`}>
                <div className="momentum-track">
                  <div className="momentum-fill-a" style={{ width: `${pct}%` }} />
                  <div className="momentum-fill-b" style={{ width: `${100 - pct}%` }} />
                  <span className="momentum-pivot" />
                </div>
                <div className="momentum-label">{label}</div>
              </div>
            );
          })()}

          <div className="md-strip-timeline">
            <RoundHistory rounds={revealedRounds} teamAId={teamA.id} teamATag={teamA.tag} teamBTag={teamB.tag} />
          </div>
        </div>
      </div>

      {/* ===== STAGE: map fills the space, overlays for kill feed + commentary ===== */}
      <div className="md-stage">
        <div className="md-stage-map">
          <MapCanvas
            layout={layout}
            frame={frame}
            prevFrame={prevFrame}
            lerp={lerp}
            userIsA={teamA.id === game.userTeamId}
            teamAPlayerIds={teamAIds}
            nicknames={nicknames}
          />
        </div>

        {/* Kill feed — overlays the LEFT of the stage, low opacity, top-most kills */}
        <div className="md-overlay md-overlay-killfeed">
          <div className="md-overlay-label">KILL FEED</div>
          {killFeed.length === 0 ? (
            <div className="md-overlay-empty">…</div>
          ) : (
            killFeed.slice().reverse().map((k, i) => {
              const killerA = teamAIds.has(k.killerId);
              const victimA = teamAIds.has(k.victimId);
              const kSide = killerA ? teamASide : teamBSide;
              const vSide = victimA ? teamASide : teamBSide;
              const kColor = kSide === 'T' ? T_COLOR : kSide === 'CT' ? CT_COLOR : '#d8dce4';
              const vColor = vSide === 'T' ? T_COLOR : vSide === 'CT' ? CT_COLOR : '#d8dce4';
              return (
                <div key={i} className="kf-overlay-line">
                  <span
                    className="kf-overlay-nick clickable"
                    style={{ color: kColor }}
                    onClick={() => openPlayer(k.killerId)}
                    title="Open profile"
                  >
                    {nicknames[k.killerId]}
                  </span>
                  <span className="kf-overlay-weapon">{k.weapon}{k.headshot ? ' •HS' : ''}</span>
                  <span
                    className="kf-overlay-nick clickable"
                    style={{ color: vColor, opacity: 0.85 }}
                    onClick={() => openPlayer(k.victimId)}
                    title="Open profile"
                  >
                    {nicknames[k.victimId]}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Commentary — overlays the TOP-RIGHT of the stage at lower opacity */}
        <div className="md-overlay md-overlay-commentary">
          <div className="md-overlay-label">COMMENTARY</div>
          {commentary.slice(-6).map((c, i) => (
            <div key={i} className="md-overlay-comm-line">
              <span className="md-overlay-comm-r">R{c.round}</span> {c.text}
            </div>
          ))}
        </div>

        {/* Highlight banners — bottom-right so they don't fight commentary */}
        {highlights.length > 0 && (
          <div className="highlight-stack md-stage-highlights">
            {highlights.map((h) => (
              <div
                key={h.id}
                className={`highlight-banner kind-${h.kind}`}
                style={{ filter: `brightness(${0.9 + h.intensity * 0.3})` }}
              >
                <div className="highlight-title">{h.title}</div>
                <div className="highlight-sub">{h.sub}</div>
              </div>
            ))}
          </div>
        )}

        {lastRoundBanner && (
          <div className="md-stage-banner">
            <div className="panel" style={{ padding: '14px 28px', textAlign: 'center' }}>
              {phase === 'between-maps' ? (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      {curMap.map} goes to {curMap.scoreA > curMap.scoreB ? teamA.name : teamB.name}
                    </div>
                    <div style={{ color: '#8b93a3', margin: '6px 0 12px' }}>{curMap.scoreA} — {curMap.scoreB}</div>
                    <div className="calls-panel">
                      <div className="calls-head">
                        MAP BREAK — TACTICAL CALLS
                        <span className="muted small">applies to next map only</span>
                      </div>
                      <div className="calls-grid">
                        {(
                          [
                            { id: 'speed-up', label: 'Speed Up', hint: 'Bias to rush/fast strats, +3 aggression' },
                            { id: 'slow-down', label: 'Slow Down', hint: 'Bias to slow defaults, −3 aggression' },
                            { id: 'stack-a', label: 'Stack A', hint: 'Force 3 CTs onto A site' },
                            { id: 'stack-b', label: 'Stack B', hint: 'Force 3 CTs onto B site' },
                            { id: 'push', label: 'Push', hint: '+5 aggression, CT plays aggressive-info' },
                            { id: 'hold', label: 'Hold', hint: '−5 aggression, CT plays passive-retake' },
                          ] as const
                        ).map((c) => {
                          const active = pendingCalls.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              className={`call-chip ${active ? 'active' : ''}`}
                              title={c.hint}
                              onClick={() => (active ? removeCall(c.id) : queueCall(c.id))}
                            >
                              <span className="call-chip-label">{c.label}</span>
                              <span className="call-chip-hint">{c.hint}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="muted small" style={{ marginTop: 6 }}>
                        Need a deeper change? <button className="link-btn" onClick={() => go('tactics')}>Open Tactics →</button>
                      </div>
                    </div>

                    <button
                      className="btn btn-accent"
                      onClick={() => { playNextMap(); setMapIdx(mapIdx + 1); setRoundIdx(0); setFrameIdx(0); setPhase('live'); setInterventionsLeft(3); }}
                    >
                      Next Map
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    Round {curRound.roundNo}: {curRound.winnerTeamId === teamA.id ? teamA.tag : teamB.tag} win
                    <span style={{ color: '#8b93a3' }}> ({curRound.reason})</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      {/* ===== BOTTOM DOCK: scoreboards + economy + controls ===== */}
      <div className="md-bottom">
        <div className="md-bottom-eco">
          <span style={{ color: '#de9b35' }}>{teamA.tag} ${curRound.moneyA.toLocaleString()} <em style={{ color: '#8b93a3' }}>({curRound.buyA})</em></span>
          <span style={{ color: '#5e97db' }}>{teamB.tag} ${curRound.moneyB.toLocaleString()} <em style={{ color: '#8b93a3' }}>({curRound.buyB})</em></span>
        </div>

        <div className="md-bottom-controls">
          {[1, 2, 4, 8].map((s) => (
            <button key={s} className={`btn ${speed === s ? 'btn-accent' : ''}`} onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {(() => {
            const remaining = timeoutsRemaining();
            const mapInProgress = phase === 'live' || phase === 'between-rounds';
            const canCall = mapInProgress && remaining > 0 && roundIdx < curMap.rounds.length - 1;
            return (
              <button
                className="btn"
                disabled={!canCall}
                style={canCall ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                title={canCall
                  ? `Pause and adjust tactics for the rest of this map (${remaining}/2 left)`
                  : 'Tactical timeouts unavailable here'}
                onClick={() => { setTimeoutOpen(true); setTimeoutStatus(null); }}
              >
                Timeout ({remaining}/2)
              </button>
            );
          })()}
          <button className="btn" onClick={skipRound}>Skip Round</button>
          <button className="btn" onClick={skipMap}>Skip Map</button>
          <button className="btn" onClick={skipAll}>Skip to Result</button>
        </div>

        {criticalMoment && (
          <div className="critical-overlay" onClick={() => setCriticalMoment(null)}>
            <div className="critical-modal" onClick={(e) => e.stopPropagation()}>
              <div className="critical-title">{criticalMoment.title}</div>
              <p className="critical-line">"{criticalMoment.line}"</p>
              <div className="critical-meta muted small">
                Manager calls left: {interventionsLeft}/3 · auto-dismisses in 7s
              </div>
              <div className="critical-actions">
                <button
                  className="critical-call critical-call-rally"
                  onClick={() => {
                    useGame.getState().applyManagerCall('rally');
                    setInterventionsLeft((n) => Math.max(0, n - 1));
                    setCriticalMoment(null);
                  }}
                  disabled={interventionsLeft <= 0}
                >
                  <span className="critical-call-label">RALLY</span>
                  <span className="critical-call-hint">+morale, +form — good for behind</span>
                </button>
                <button
                  className="critical-call critical-call-calm"
                  onClick={() => {
                    useGame.getState().applyManagerCall('calm');
                    setInterventionsLeft((n) => Math.max(0, n - 1));
                    setCriticalMoment(null);
                  }}
                  disabled={interventionsLeft <= 0}
                >
                  <span className="critical-call-label">STAY COMPOSED</span>
                  <span className="critical-call-hint">+morale, −fatigue — steady the ship</span>
                </button>
                <button
                  className="critical-call critical-call-aggro"
                  onClick={() => {
                    useGame.getState().applyManagerCall('aggressive');
                    setInterventionsLeft((n) => Math.max(0, n - 1));
                    setCriticalMoment(null);
                  }}
                  disabled={interventionsLeft <= 0}
                >
                  <span className="critical-call-label">GO FOR THE THROAT</span>
                  <span className="critical-call-hint">+form, slight morale tax</span>
                </button>
                <button className="critical-dismiss" onClick={() => setCriticalMoment(null)}>
                  Say nothing
                </button>
              </div>
            </div>
          </div>
        )}

        {timeoutOpen && (
          <div className="timeout-overlay" onClick={() => setTimeoutOpen(false)}>
            <div className="timeout-modal" onClick={(e) => e.stopPropagation()}>
              <div className="timeout-head">
                <strong>TACTICAL TIMEOUT</strong>
                <span className="muted small">
                  Round {Math.min(roundIdx + 1, curMap.rounds.length)} · adjust calls below, then resume — remaining rounds re-simulate with the new tactics.
                </span>
              </div>
              <div className="calls-panel" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                <div className="calls-grid">
                  {(
                    [
                      { id: 'speed-up', label: 'Speed Up', hint: 'Bias to rush/fast strats, +3 aggression' },
                      { id: 'slow-down', label: 'Slow Down', hint: 'Bias to slow defaults, −3 aggression' },
                      { id: 'stack-a', label: 'Stack A', hint: 'Force 3 CTs onto A site' },
                      { id: 'stack-b', label: 'Stack B', hint: 'Force 3 CTs onto B site' },
                      { id: 'push', label: 'Push', hint: '+5 aggression, CT aggressive-info' },
                      { id: 'hold', label: 'Hold', hint: '−5 aggression, CT passive-retake' },
                    ] as const
                  ).map((c) => {
                    const active = pendingCalls.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        className={`call-chip ${active ? 'active' : ''}`}
                        title={c.hint}
                        onClick={() => (active ? removeCall(c.id) : queueCall(c.id))}
                      >
                        <span className="call-chip-label">{c.label}</span>
                        <span className="call-chip-hint">{c.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="muted small" style={{ marginTop: 8 }}>
                Need deeper adjustments? <button className="link-btn" onClick={() => { setTimeoutOpen(false); go('tactics'); }}>Open Tactics →</button>
              </div>
              {timeoutStatus && (
                <div className="muted small" style={{ marginTop: 8 }}>{timeoutStatus}</div>
              )}
              <div className="timeout-actions">
                <button
                  className="btn btn-accent"
                  onClick={() => {
                    const result = callTimeout(roundIdx);
                    if (result.ok) {
                      setTimeoutStatus(`Timeout used. ${result.remaining} left this map.`);
                      setTimeoutOpen(false);
                    } else {
                      setTimeoutStatus(result.error ?? 'Timeout failed.');
                    }
                  }}
                >
                  Apply &amp; Resume
                </button>
                <button className="btn" onClick={() => setTimeoutOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Compact dual scoreboard — pulled from current map's playerStats so it
            shows exactly the 5 who walked out (matches dots on the map). */}
        <div className="md-bottom-scoreboards">
          {[teamA, teamB].map((t) => {
            const side = t.id === teamA.id ? teamASide : teamBSide;
            const lineupIds = curMap
              ? Object.values(curMap.playerStats)
                  .map((s) => s.playerId)
                  .filter((pid) => game.players[pid]?.teamId === t.id)
                  .slice(0, 5)
              : t.playerIds.slice(0, 5);
            return (
              <table key={t.id} className="sb-table md-bottom-sb">
                <thead>
                  <tr>
                    <th>
                      {t.tag}{' '}
                      {side && <span className={`side-badge ${side.toLowerCase()}`}>{side}</span>}
                    </th>
                    <th className="num">K</th>
                    <th className="num">D</th>
                    <th className="num">A</th>
                    <th className="num">+/-</th>
                  </tr>
                </thead>
                <tbody>
                  {lineupIds.map((pid) => {
                    const p = game.players[pid];
                    const s = liveStats[pid] ?? { k: 0, d: 0, a: 0 };
                    const aliveNow = frame?.dots.find((d) => d.playerId === pid)?.alive ?? true;
                    const diff = s.k - s.d;
                    return (
                      <tr key={pid} style={{ opacity: aliveNow ? 1 : 0.45 }}>
                        <td className="clickable" onClick={() => openPlayer(pid)} title="Open profile">
                          <span className="sb-player">
                            <PlayerAvatar
                              playerId={pid}
                              nickname={p?.nickname ?? pid}
                              nationality={p?.nationality ?? ''}
                              hltvId={p?.hltvId}
                              size={20}
                              side={side}
                            />
                            <span className="sb-nick">{p?.nickname ?? pid}</span>
                          </span>
                        </td>
                        <td className="num">{s.k}</td>
                        <td className="num">{s.d}</td>
                        <td className="num">{s.a}</td>
                        <td className="num" style={{ color: diff > 0 ? '#4caf7d' : diff < 0 ? '#e25555' : '#5d6678' }}>
                          {diff > 0 ? `+${diff}` : diff}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============ Pre-match lineup picker ============
// Lets the user verify / swap their starting 5 before the match starts.
// Critical when a starter is injured — pull in a reserve so the team doesn't
// play short. Slot order matches tactics.roleSlots; pendingLineup overrides
// without touching the saved tactics.
function PreMatchLineup({ userTeamId }: { userTeamId: string }) {
  const game = useGame((s) => s.game)!;
  const setPendingLineupSlot = useGame((s) => s.setPendingLineupSlot);
  const team = game.teams[userTeamId];
  const slots = game.tactics.roleSlots ?? [];
  // Resolve the effective lineup: pendingLineup overrides if present.
  const effective: (string | null)[] = game.pendingLineup && game.pendingLineup.length === 5
    ? game.pendingLineup
    : slots.map((s) => s.playerId ?? null);

  const allHealthy = team.playerIds
    .map((id) => game.players[id])
    .filter((p): p is import('../../types').Player => !!p && !p.injury);

  // Detect injured starters so we can flag them in red.
  const injuredInSlots = slots
    .map((s, i) => ({ slotIdx: i, p: s.playerId ? game.players[s.playerId] : null }))
    .filter((x) => x.p && x.p.injury);

  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const usedIds = new Set(effective.filter(Boolean) as string[]);
  const benchPool = allHealthy
    .filter((p) => !usedIds.has(p.id))
    .sort((a, b) => b.currentAbility - a.currentAbility);

  const fivePicked = effective.filter((id) => {
    if (!id) return false;
    const p = game.players[id];
    return p && !p.injury;
  }).length;

  return (
    <div className="lineup-panel">
      <div className="lineup-head">
        <span className="lineup-head-title">STARTING LINEUP</span>
        <span className={`lineup-count ${fivePicked < 5 ? 'lineup-warn' : ''}`}>
          {fivePicked} / 5 ready
        </span>
        {injuredInSlots.length > 0 && (
          <span className="lineup-warn-pill">
            🚑 {injuredInSlots.length} starter{injuredInSlots.length === 1 ? '' : 's'} injured — pick a sub
          </span>
        )}
      </div>
      <div className="lineup-grid">
        {slots.map((slot, idx) => {
          const id = effective[idx];
          const player = id ? game.players[id] : null;
          const injured = !!player?.injury;
          const empty = !player || injured;
          return (
            <div key={idx} className={`lineup-slot ${empty ? 'lineup-slot-empty' : ''} ${injured ? 'lineup-slot-injured' : ''}`}>
              <div className="lineup-slot-role">{slot.role}</div>
              {player ? (
                <div className="lineup-slot-player">
                  <strong>{player.nickname}</strong>
                  {injured && <span className="lineup-slot-tag-inj">🚑 INJ</span>}
                  <div className="muted small">{player.role} · CA {player.currentAbility}</div>
                </div>
              ) : (
                <div className="lineup-slot-player muted small">empty slot</div>
              )}
              <button
                className={`btn btn-tiny ${injured || empty ? 'btn-accent' : ''}`}
                onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
              >
                {openIdx === idx ? 'Close' : empty ? 'Pick sub' : 'Swap'}
              </button>
              {openIdx === idx && (
                <div className="lineup-bench">
                  <div className="muted small" style={{ marginBottom: 4 }}>Bench (healthy):</div>
                  {benchPool.length === 0 ? (
                    <div className="muted small">No subs available.</div>
                  ) : (
                    benchPool.map((p) => (
                      <button
                        key={p.id}
                        className="lineup-bench-pick"
                        onClick={() => {
                          setPendingLineupSlot(idx, p.id);
                          setOpenIdx(null);
                        }}
                      >
                        <strong>{p.nickname}</strong>{' '}
                        <span className="muted small">{p.role} · CA {p.currentAbility} · {p.squadTier ?? 'first'}</span>
                      </button>
                    ))
                  )}
                  {player && (
                    <button
                      className="lineup-bench-pick lineup-clear"
                      onClick={() => { setPendingLineupSlot(idx, null); setOpenIdx(null); }}
                    >
                      Clear slot
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ Pre-match dressing-room talk ============
// FM-style team talk before kickoff. 5 tones with different morale/form
// effects depending on squad composure. One-shot per match.
function DressingRoomTalk({ matchId }: { matchId: string }) {
  const game = useGame((s) => s.game)!;
  const giveTeamTalk = useGame((s) => s.giveTeamTalk);
  const talk = game.pendingTeamTalk;
  const given = talk && talk.matchId === matchId;

  const TONES: { id: import('../../types').TeamTalkTone; label: string; hint: string }[] = [
    { id: 'relax', label: 'Relax', hint: 'Take the pressure off — small lift, helps fatigued squads' },
    { id: 'encourage', label: 'Encourage', hint: 'Steady confidence boost — works on any side' },
    { id: 'demand-more', label: 'Demand More', hint: 'Sharpens composed players, rattles fragile ones' },
    { id: 'passionate', label: 'Passionate', hint: 'Big morale spike — fire them up' },
    { id: 'aggressive', label: 'Aggressive', hint: 'High risk: pays on a confident squad, bombs on a fragile one' },
  ];

  return (
    <div className="talk-panel">
      <div className="talk-head">
        DRESSING ROOM TALK
        <span className="muted small">one shot before kickoff</span>
      </div>
      {given ? (
        <div className="talk-given">
          <span className="talk-given-tone">✓ {TONES.find((t) => t.id === talk.tone)?.label}</span>
          <span className="muted small">{talk.summary}</span>
        </div>
      ) : (
        <div className="talk-grid">
          {TONES.map((t) => (
            <button
              key={t.id}
              className={`talk-chip talk-${t.id}`}
              title={t.hint}
              onClick={() => giveTeamTalk(t.id)}
            >
              <span className="talk-chip-label">{t.label}</span>
              <span className="talk-chip-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
