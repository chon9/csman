// Live replay viewer for a just-finished duel. Walks through every frame
// of every round at the user's chosen speed using the existing MapCanvas
// component (which is fully prop-driven and decoupled from the
// single-player gameStore).
//
// Frames are only available in the ~5 minute window after the duel
// resolves (server-side memory cache). Past that, the History screen's
// stat-only viewer takes over.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import { MAP_LAYOUTS } from '../../data/maps';
import MapCanvas from '../../ui/match/MapCanvas';
import type { Player, RoundFrame, RoundResult } from '../../types';

const SPEEDS = [1, 2, 4, 8];
const T_COLOR = '#f2a13c';
const CT_COLOR = '#6aa7ec';

type CenterHighlightSub = 'multikill' | 'plant' | 'defuse' | 'clutch' | 'awp' | 'headshot';

interface CenterHighlight {
  /** Stable key — React uses this to re-fire the pop-in CSS animation. */
  key: string;
  /** Big label, e.g. "Double Kill", "ACE", "1v3 Clutch", "Bomb Planted". */
  type: string;
  /** Subject player id (the killer, planter, defuser, clutcher). May be null
   *  for events the engine doesn't tag (e.g. bomb defused — engine only
   *  records the round-end reason, not who did the wires). */
  playerId: string | null;
  /** Optional weapon-style badge — 'AWP' or 'HS'. Skipped for non-kill events. */
  weaponBadge: 'AWP' | 'HS' | null;
  subType: CenterHighlightSub;
}

/** How many ticks the multi-kill / single-kill badge stays on screen
 *  after the kill that triggered it. ~3 ticks ≈ 6 seconds in-engine; long
 *  enough to read at 4× playback. */
const HIGHLIGHT_DECAY_TICKS = 3;

/** Pick the single most relevant highlight to flash in the centre of the
 *  map for the current frame. Event priority (most recent wins):
 *    1. Round-end events at the final frame (clutch / defuse)
 *    2. Bomb plant transition this very frame
 *    3. Multi-kill (Double / Triple / Quad / Ace) by the latest killer
 *    4. Single AWP or headshot kill (still highlight-worthy)
 *  Returns null when nothing exciting is happening so the centre stays
 *  empty rather than spamming the screen with every pistol tap. */
export function computeCenterHighlight(
  round: RoundResult | null | undefined,
  frame: RoundFrame | null | undefined,
  prevFrame: RoundFrame | null | undefined,
  frameIdx: number,
): CenterHighlight | null {
  if (!round || !frame) return null;
  const curTick = frame.tick;
  const isLastFrame = frameIdx >= round.frames.length - 1;

  // (1) Round-end events — defuse + clutch. Fire on the FINAL frame so
  //     the badge lands as the round resolves.
  if (isLastFrame) {
    if (round.clutch?.won) {
      return {
        key: `clutch-${round.roundNo}-${round.clutch.playerId}`,
        type: `1v${round.clutch.vs} Clutch`,
        playerId: round.clutch.playerId,
        weaponBadge: null,
        subType: 'clutch',
      };
    }
    if (round.reason === 'defuse') {
      return {
        key: `defuse-${round.roundNo}`,
        type: 'Bomb Defused',
        playerId: null,
        weaponBadge: null,
        subType: 'defuse',
      };
    }
  }

  // (2) Bomb plant — detect frame where bombPlanted flipped on. Player
  //     who planted is the dot carrying the bomb on the previous frame.
  if (frame.bombPlanted && prevFrame && !prevFrame.bombPlanted) {
    const planter = prevFrame.dots.find((d) => d.hasBomb)?.playerId ?? null;
    return {
      key: `plant-${round.roundNo}-${curTick}`,
      type: 'Bomb Planted',
      playerId: planter,
      weaponBadge: null,
      subType: 'plant',
    };
  }

  // (3 / 4) Look at the most recent kill — drives multi-kill + single-kill
  //         highlight detection. Both decay after a few ticks so the badge
  //         clears between events instead of lingering.
  const revealedKills = round.kills.filter((k) => k.tick <= curTick);
  if (revealedKills.length === 0) return null;
  const lastKill = revealedKills[revealedKills.length - 1]!;
  if (curTick - lastKill.tick > HIGHLIGHT_DECAY_TICKS) return null;

  const killerKillCount = revealedKills.filter((k) => k.killerId === lastKill.killerId).length;
  const weapon = lastKill.weapon ?? '';
  const isAwp = /awp/i.test(weapon);
  const baseBadge: 'AWP' | 'HS' | null = isAwp ? 'AWP' : (lastKill.headshot ? 'HS' : null);

  if (killerKillCount >= 2) {
    const label = killerKillCount >= 5 ? 'ACE'
      : killerKillCount === 4 ? 'Quad Kill'
      : killerKillCount === 3 ? 'Triple Kill'
      : 'Double Kill';
    return {
      key: `multi-${round.roundNo}-${lastKill.killerId}-${killerKillCount}-${lastKill.tick}`,
      type: label,
      playerId: lastKill.killerId,
      weaponBadge: baseBadge,
      subType: 'multikill',
    };
  }

  // Single big kill — only flash when the weapon is notable (AWP or HS).
  if (isAwp) {
    return {
      key: `awp-${round.roundNo}-${lastKill.killerId}-${lastKill.tick}`,
      type: 'AWP Pickoff',
      playerId: lastKill.killerId,
      weaponBadge: 'AWP',
      subType: 'awp',
    };
  }
  if (lastKill.headshot) {
    return {
      key: `hs-${round.roundNo}-${lastKill.killerId}-${lastKill.tick}`,
      type: 'Headshot',
      playerId: lastKill.killerId,
      weaponBadge: 'HS',
      subType: 'headshot',
    };
  }
  return null;
}

export default function OnlineLiveReplayScreen() {
  const team = useOnline((s) => s.team);
  const players = useOnline((s) => s.players);
  const replay = useOnline((s) => s.liveReplay);
  const close = useOnline((s) => s.closeReplay);
  // Two locked-replay sources:
  //   - PvP duel-result with lockedReplay=true → drain into result modal on 'home'
  //   - AI bet card resolution → endAiBetReplay routes back to 'ai-bets'
  // Both force 4× speed + hide the scrub controls so every viewer
  // watches the same match at the same beat.
  const pendingDuelResult = useOnline((s) => s.pendingDuelResult);
  const drainPendingDuelResult = useOnline((s) => s.drainPendingDuelResult);
  const aiBetReplayLocked = useOnline((s) => s.aiBetReplayLocked);
  const endAiBetReplay = useOnline((s) => s.endAiBetReplay);
  const locked = !!pendingDuelResult || aiBetReplayLocked;

  const [mapIdx, setMapIdx] = useState(0);
  const [roundIdx, setRoundIdx] = useState(0);
  const [frameIdx, setFrameIdx] = useState(0);
  const [speed, setSpeed] = useState<number>(locked ? 4 : 2);
  const [playing, setPlaying] = useState(true);

  // Nickname dictionary for the on-canvas player labels.
  const nicknames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of Object.values(players) as Player[]) out[p.id] = p.nickname;
    // Replay frames may contain players we don't have in local state (the AI
    // opponent or another live team's roster) — fall back to playerId.
    return out;
  }, [players]);

  // Playback loop — advance one frame per tick. RAF is overkill for a
  // map dot animation; a 100ms interval at speed=1 is plenty.
  useEffect(() => {
    if (!playing || !replay) return;
    const curMap = replay.result.maps[mapIdx];
    const curRound = curMap?.rounds[roundIdx];
    if (!curRound) return;
    const stepMs = Math.max(40, Math.round(220 / speed));
    const id = setInterval(() => {
      setFrameIdx((f) => {
        if (f + 1 < curRound.frames.length) return f + 1;
        // End of round → advance to next round, then next map, then stop.
        if (roundIdx + 1 < curMap.rounds.length) {
          setRoundIdx(roundIdx + 1);
          return 0;
        }
        if (mapIdx + 1 < replay.result.maps.length) {
          setMapIdx(mapIdx + 1);
          setRoundIdx(0);
          return 0;
        }
        setPlaying(false);
        // Locked-mode hand-off:
        //   PvP: drain pending duel result → result modal on 'home'
        //   AI bet: end the replay → route back to 'ai-bets' (settlement
        //     toast already landed; nothing extra to show)
        // Brief delay so the user sees the final frame before swap.
        if (pendingDuelResult) {
          window.setTimeout(() => drainPendingDuelResult(), 500);
        } else if (aiBetReplayLocked) {
          window.setTimeout(() => endAiBetReplay(), 500);
        }
        return f;
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [playing, speed, mapIdx, roundIdx, replay, pendingDuelResult, drainPendingDuelResult, aiBetReplayLocked, endAiBetReplay]);

  if (!replay || !team) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <div className="panel"><div className="muted">No live replay loaded.</div></div>
      </div>
    );
  }

  const r = replay.result;
  const curMap = r.maps[mapIdx];
  const curRound = curMap?.rounds[roundIdx];
  const frame = curRound?.frames[frameIdx] ?? null;
  const prevFrame = curRound?.frames[Math.max(0, frameIdx - 1)] ?? null;
  const layout = curMap ? MAP_LAYOUTS[curMap.map] : null;
  const userIsA = r.teamAId === team.id;
  const userIsB = r.teamBId === team.id;
  // Spectator mode: neither team is the viewer's own (AI vs AI bet
  // replay). Two signals — both forced true here for robustness:
  //   1. Neither side's teamId matches the viewer's own team
  //   2. The matchId carries the AI bet prefix (server stamps these as
  //      `aibet-match-${cardId}`), which works even if a future code
  //      path slips a viewer's teamId into one of the team slots.
  // Header + scoreboard skip the team.tag substitution when spectator
  // is true so both AI tags surface correctly.
  const isAiBetMatch = r.matchId.startsWith('aibet-');
  const spectator = isAiBetMatch || (!userIsA && !userIsB);
  // Roster anchor for spectator mode — prefer the engine-stamped result
  // field (covers tournament + PvP + AI bet replays uniformly), fall
  // back to the legacy outer message field, then to empty.
  const specRosterSource = r.teamARosterIds ?? replay?.teamARosterIds ?? [];
  const specRosterA = useMemo(() => new Set(specRosterSource), [specRosterSource]);

  // Side detection — every frame carries each player's current side. Use the
  // user's team as the anchor (we always have one of their player records);
  // in spectator mode anchor on the server-supplied team A roster instead.
  const userPlayerIds = useMemo(() => new Set(team.playerIds), [team.playerIds]);
  const teamASide: 'T' | 'CT' | null = useMemo(() => {
    if (!frame) return null;
    const anchor = spectator
      ? frame.dots.find((d) => specRosterA.has(d.playerId))
      : userIsA
        ? frame.dots.find((d) => userPlayerIds.has(d.playerId))
        : frame.dots.find((d) => !userPlayerIds.has(d.playerId));
    return anchor?.side ?? null;
  }, [frame, userIsA, userPlayerIds, spectator, specRosterA]);
  const teamBSide: 'T' | 'CT' | null = teamASide === 'T' ? 'CT' : teamASide === 'CT' ? 'T' : null;

  // Team membership for kill-feed colouring. Frame dots are authoritative —
  // the user's own roster ids land on whichever side userIsA dictates; every
  // other dot belongs to the opponent. In spectator mode we test membership
  // against the server-supplied team A roster.
  const teamAPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    if (!frame) return ids;
    for (const d of frame.dots) {
      const onA = spectator
        ? specRosterA.has(d.playerId)
        : userIsA ? userPlayerIds.has(d.playerId) : !userPlayerIds.has(d.playerId);
      if (onA) ids.add(d.playerId);
    }
    return ids;
  }, [frame, userIsA, userPlayerIds, spectator, specRosterA]);

  // Kill feed — last 6 kills whose tick ≤ current frame.tick.
  const killFeed = useMemo(() => {
    if (!curRound) return [];
    const cur = frame?.tick ?? 0;
    return curRound.kills.filter((k) => k.tick <= cur).slice(-6);
  }, [curRound, frame]);

  // Live K/D/A from revealed kills — same pattern as the SP MatchDayScreen.
  // Past rounds count fully; current round counts kills with tick ≤ frame.tick.
  const liveStats = useMemo(() => {
    const stats: Record<string, { k: number; d: number; a: number }> = {};
    if (!curMap) return stats;
    const curTick = frame?.tick ?? 0;
    curMap.rounds.forEach((rd, rIdx) => {
      if (rIdx > roundIdx) return;
      for (const k of rd.kills) {
        if (rIdx === roundIdx && k.tick > curTick) continue;
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
  }, [curMap, roundIdx, frame]);

  // Revealed map score (only rounds the playhead has crossed).
  const mapScore = useMemo(() => {
    if (!curMap) return { a: 0, b: 0 };
    let a = 0, b = 0;
    // During the current round, the score is what it was at the START — we
    // haven't seen the winning hit yet. Once we cross into the next round
    // (or hit the final frame of the last one) the last round's result lands.
    const lastFrameOfRound = curRound && frameIdx >= curRound.frames.length - 1;
    const upTo = lastFrameOfRound ? roundIdx : roundIdx - 1;
    curMap.rounds.forEach((rd, i) => {
      if (i > upTo) return;
      if (rd.winnerTeamId === r.teamAId) a++; else b++;
    });
    return { a, b };
  }, [curMap, curRound, roundIdx, frameIdx, r.teamAId]);

  // Bomb-planted countdown. Per the SP engine: 40s fuse, 1 tick = 2 sec.
  // Pre-plant: 115s round timer. ≤10s → low-alert styling.
  const roundClock = useMemo(() => {
    if (!curRound || !frame) return null;
    const bombPlantTick = curRound.bombPlanted
      ? curRound.frames.find((f) => f.bombPlanted)?.tick
      : undefined;
    const planted = frame.bombPlanted && bombPlantTick !== undefined;
    const secs = planted
      ? Math.max(0, 40 - (frame.tick - bombPlantTick!) * 2)
      : Math.max(0, 115 - frame.tick * 2);
    return {
      planted,
      secs,
      low: secs <= 10,
      label: `${Math.floor(secs / 60)}:${String(Math.floor(secs) % 60).padStart(2, '0')}`,
    };
  }, [curRound, frame]);

  // Scoreboard rosters: for each side, the 5 playerIds derived from this
  // map's playerStats (matches who actually walked onto the map this game).
  const teamABoard = useMemo(() => {
    if (!curMap) return [];
    return Object.values(curMap.playerStats)
      .map((s) => s.playerId)
      .filter((pid) => teamAPlayerIds.has(pid))
      .slice(0, 5);
  }, [curMap, teamAPlayerIds]);
  const teamBBoard = useMemo(() => {
    if (!curMap) return [];
    return Object.values(curMap.playerStats)
      .map((s) => s.playerId)
      .filter((pid) => !teamAPlayerIds.has(pid))
      .slice(0, 5);
  }, [curMap, teamAPlayerIds]);

  // Commentary — reveal proportionally as the round progresses, plus every
  // line from already-completed rounds. Cap to last 9 to fit the overlay.
  const commentary = useMemo(() => {
    if (!curMap) return [];
    const out: { round: number; text: string }[] = [];
    curMap.rounds.forEach((rd, i) => {
      if (i > roundIdx) return;
      const all = rd.commentary;
      const n =
        i < roundIdx
          ? all.length
          : Math.ceil(
              (Math.min(frameIdx, (rd.frames.length || 1) - 1) /
                Math.max(1, rd.frames.length - 1)) *
                all.length,
            );
      all.slice(0, n).forEach((text) => out.push({ round: rd.roundNo, text }));
    });
    return out.slice(-9);
  }, [curMap, roundIdx, frameIdx]);

  // ---- Skip controls ----
  // Skip-round jumps to the NEXT round (or next map if at the last round of
  // the current map). Skip-map jumps to the NEXT map. Both reset frameIdx.
  function skipRound(): void {
    if (!curMap) return;
    if (roundIdx + 1 < curMap.rounds.length) {
      setRoundIdx(roundIdx + 1);
      setFrameIdx(0);
      return;
    }
    if (mapIdx + 1 < r.maps.length) {
      setMapIdx(mapIdx + 1);
      setRoundIdx(0);
      setFrameIdx(0);
      return;
    }
    setPlaying(false);
  }
  function skipMap(): void {
    if (mapIdx + 1 < r.maps.length) {
      setMapIdx(mapIdx + 1);
      setRoundIdx(0);
      setFrameIdx(0);
      return;
    }
    // Already on the last map — jump to its final frame and stop.
    if (curMap) {
      const lastRound = curMap.rounds.length - 1;
      const lastFrame = (curMap.rounds[lastRound]?.frames.length ?? 1) - 1;
      setRoundIdx(lastRound);
      setFrameIdx(Math.max(0, lastFrame));
    }
    setPlaying(false);
  }

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>
            {/* No final score in the title — the whole point of the replay is
                the suspense. Live in-progress score lives in the subline below
                and only reveals as rounds play out. */}
            {/* Always team A on the LEFT, team B on the RIGHT — matches
                the score/scoreboard so all three surfaces agree. The
                server already stamps teamATag/teamBTag to the correct
                side (user's tag lands on their actual side, not always
                on the left), so no user-vs-opponent flipping needed. */}
            Replay — {replay.teamATag || 'A'} <span className="muted">vs</span> {replay.teamBTag || 'B'}
          </h2>
          <div className="muted small" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Map {mapIdx + 1}/{r.maps.length} · {curMap?.map}</span>
            {/* Live map round score, colour-coded by current side. */}
            <span>
              <span style={{ color: teamASide === 'T' ? T_COLOR : teamASide === 'CT' ? CT_COLOR : undefined, fontWeight: 700 }}>{mapScore.a}</span>
              <span style={{ opacity: 0.5 }}> : </span>
              <span style={{ color: teamBSide === 'T' ? T_COLOR : teamBSide === 'CT' ? CT_COLOR : undefined, fontWeight: 700 }}>{mapScore.b}</span>
            </span>
            <span>R{roundIdx + 1}/{curMap?.rounds.length}</span>
            {/* Bomb-planted timer or pre-plant round clock. */}
            {roundClock && (
              <span className={`round-clock ${roundClock.planted ? 'planted' : ''} ${roundClock.low ? 'low' : ''}`}>
                {roundClock.planted ? '💣 ' : '⏱ '}{roundClock.label}
              </span>
            )}
            {teamASide && <span className={`side-badge ${teamASide.toLowerCase()}`}>{teamASide}</span>}
          </div>
        </div>
        {locked ? (
          <span
            className="muted small"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              background: 'rgba(110,208,154,0.10)',
              border: '1px solid rgba(110,208,154,0.30)',
              color: '#9be29b',
              letterSpacing: 0.5,
            }}
            title={aiBetReplayLocked ? 'Every bettor on this card is watching at the same time — no skipping.' : 'Both teams are watching this replay at the same time — no skipping.'}
          >
            🔒 Synced replay · 4×
          </span>
        ) : (
          <button className="btn" onClick={close}>← Back</button>
        )}
      </div>

      {layout && frame && (
        <div className="md-stage">
          <div className="md-stage-map">
            <MapCanvas
              layout={layout}
              frame={frame}
              prevFrame={prevFrame}
              lerp={1}
              userIsA={userIsA}
              teamAPlayerIds={teamAPlayerIds}
              nicknames={nicknames}
            />
          </div>

          {/* ===== Center highlight flash — only fires on noteworthy
              moments (multi-kills, bomb plant/defuse, clutch, AWP/HS
              single kills) instead of every single kill. Format:
              "TYPE — Player [• weapon-badge]". Keyed by event signature
              so each new highlight re-fires the CSS pop-in animation. ===== */}
          {(() => {
            const hl = computeCenterHighlight(curRound, frame, prevFrame, frameIdx);
            if (!hl) return null;
            const onA = hl.playerId ? teamAPlayerIds.has(hl.playerId) : false;
            const pSide = hl.playerId ? (onA ? teamASide : teamBSide) : null;
            const pColor = pSide === 'T' ? T_COLOR : pSide === 'CT' ? CT_COLOR : '#d8dce4';
            const accent = hl.subType === 'plant' ? '#f2a13c'
              : hl.subType === 'defuse' ? '#6aa7ec'
              : hl.subType === 'clutch' ? '#f2c443'
              : hl.subType === 'multikill' ? '#e25555'
              : '#d8dce4';
            return (
              <div
                key={hl.key}
                className="md-overlay-killflash"
                aria-hidden
              >
                <div className="kf-flash-line">
                  <span className="kf-highlight-type" style={{ color: accent, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', textShadow: `0 0 12px ${accent}88` }}>
                    {hl.type}
                  </span>
                  {hl.playerId && (
                    <>
                      <span style={{ opacity: 0.5 }}>—</span>
                      <span style={{ color: pColor }}>{nicknames[hl.playerId] ?? hl.playerId}</span>
                    </>
                  )}
                  {hl.weaponBadge && (
                    <span className="kf-flash-hs" style={{
                      background: hl.weaponBadge === 'AWP' ? 'rgba(242,196,67,0.18)' : 'rgba(226,85,85,0.18)',
                      borderColor: hl.weaponBadge === 'AWP' ? '#f2c443' : '#e25555',
                      color: hl.weaponBadge === 'AWP' ? '#f2c443' : '#e25555',
                    }}>{hl.weaponBadge}</span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Kill feed — overlays the LEFT of the stage */}
          <div className="md-overlay md-overlay-killfeed">
            <div className="md-overlay-label">KILL FEED</div>
            {killFeed.length === 0 ? (
              <div className="md-overlay-empty">…</div>
            ) : (
              killFeed.slice().reverse().map((k, i) => {
                const killerA = teamAPlayerIds.has(k.killerId);
                const victimA = teamAPlayerIds.has(k.victimId);
                const kSide = killerA ? teamASide : teamBSide;
                const vSide = victimA ? teamASide : teamBSide;
                const kColor = kSide === 'T' ? T_COLOR : kSide === 'CT' ? CT_COLOR : '#d8dce4';
                const vColor = vSide === 'T' ? T_COLOR : vSide === 'CT' ? CT_COLOR : '#d8dce4';
                return (
                  <div key={i} className="kf-overlay-line">
                    <span className="kf-overlay-nick" style={{ color: kColor }}>
                      {nicknames[k.killerId] ?? k.killerId}
                    </span>
                    <span className="kf-overlay-weapon">{k.weapon}{k.headshot ? ' •HS' : ''}</span>
                    <span className="kf-overlay-nick" style={{ color: vColor, opacity: 0.85 }}>
                      {nicknames[k.victimId] ?? k.victimId}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Commentary — overlays the TOP-RIGHT of the stage */}
          <div className="md-overlay md-overlay-commentary">
            <div className="md-overlay-label">COMMENTARY</div>
            {commentary.length === 0 ? (
              <div className="md-overlay-empty">…</div>
            ) : (
              commentary.map((c, i) => (
                <div key={i} className="md-overlay-comm-line">
                  <span className="md-overlay-comm-r">R{c.round}</span> {c.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===== Dual scoreboard — K / D / A / +- per player, alive dimming ===== */}
      {curMap && (teamABoard.length > 0 || teamBBoard.length > 0) && (
        <div className="panel" style={{ padding: 10 }}>
          <div className="md-bottom-scoreboards">
            {[
              { rosterIds: teamABoard, tag: replay.teamATag || 'A', side: teamASide },
              { rosterIds: teamBBoard, tag: replay.teamBTag || 'B', side: teamBSide },
            ].map((board, bi) => (
              <table key={bi} className="sb-table md-bottom-sb">
                <thead>
                  <tr>
                    <th>
                      {board.tag}{' '}
                      {board.side && <span className={`side-badge ${board.side.toLowerCase()}`}>{board.side}</span>}
                    </th>
                    <th className="num">K</th>
                    <th className="num">D</th>
                    <th className="num">A</th>
                    <th className="num">+/-</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rosterIds.map((pid) => {
                    const s = liveStats[pid] ?? { k: 0, d: 0, a: 0 };
                    const aliveNow = frame?.dots.find((d) => d.playerId === pid)?.alive ?? true;
                    const diff = s.k - s.d;
                    return (
                      <tr key={pid} style={{ opacity: aliveNow ? 1 : 0.45 }}>
                        <td><span className="sb-nick">{nicknames[pid] ?? pid}</span></td>
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
            ))}
          </div>
        </div>
      )}

      {locked ? (
        <div className="panel" style={{ padding: 12, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span className="muted small">
            🔒 Watching with your opponent · forced 4× · skipping disabled. Result reveals when the last frame plays.
          </span>
        </div>
      ) : (
        <div className="panel" style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" onClick={() => setPlaying((p) => !p)}>
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          {SPEEDS.map((s) => (
            <button key={s} className={`btn btn-tiny ${speed === s ? 'btn-accent' : ''}`} onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
          <button className="btn btn-tiny" onClick={skipRound}>Skip round</button>
          <button className="btn btn-tiny" onClick={skipMap}>Skip map</button>
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            Replay window: ~5min after duel. Once expired, use History for stats-only view.
          </span>
        </div>
      )}
    </div>
  );
}
