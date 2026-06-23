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
import type { Player } from '../../types';

const SPEEDS = [1, 2, 4, 8];
const T_COLOR = '#f2a13c';
const CT_COLOR = '#6aa7ec';

export default function OnlineLiveReplayScreen() {
  const team = useOnline((s) => s.team);
  const players = useOnline((s) => s.players);
  const replay = useOnline((s) => s.liveReplay);
  const close = useOnline((s) => s.closeReplay);

  const [mapIdx, setMapIdx] = useState(0);
  const [roundIdx, setRoundIdx] = useState(0);
  const [frameIdx, setFrameIdx] = useState(0);
  const [speed, setSpeed] = useState(2);
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
        return f;
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [playing, speed, mapIdx, roundIdx, replay]);

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

  // Side detection — every frame carries each player's current side. Use the
  // user's team as the anchor (we always have one of their player records).
  const userPlayerIds = useMemo(() => new Set(team.playerIds), [team.playerIds]);
  const teamASide: 'T' | 'CT' | null = useMemo(() => {
    if (!frame) return null;
    const anchor = userIsA
      ? frame.dots.find((d) => userPlayerIds.has(d.playerId))
      : frame.dots.find((d) => !userPlayerIds.has(d.playerId));
    return anchor?.side ?? null;
  }, [frame, userIsA, userPlayerIds]);
  const teamBSide: 'T' | 'CT' | null = teamASide === 'T' ? 'CT' : teamASide === 'CT' ? 'T' : null;

  // Team membership for kill-feed colouring. Frame dots are authoritative —
  // the user's own roster ids land on whichever side userIsA dictates; every
  // other dot belongs to the opponent.
  const teamAPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    if (!frame) return ids;
    for (const d of frame.dots) {
      const isUser = userPlayerIds.has(d.playerId);
      const onA = userIsA ? isUser : !isUser;
      if (onA) ids.add(d.playerId);
    }
    return ids;
  }, [frame, userIsA, userPlayerIds]);

  // Kill feed — last 6 kills whose tick ≤ current frame.tick.
  const killFeed = useMemo(() => {
    if (!curRound) return [];
    const cur = frame?.tick ?? 0;
    return curRound.kills.filter((k) => k.tick <= cur).slice(-6);
  }, [curRound, frame]);

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
            Replay — {team.tag} {userIsA ? r.mapsA : r.mapsB} — {userIsA ? r.mapsB : r.mapsA} opp
          </h2>
          <div className="muted small">
            Map {mapIdx + 1}/{r.maps.length} · {curMap?.map} · R{roundIdx + 1}/{curMap?.rounds.length}
            · Frame {frameIdx + 1}/{curRound?.frames.length ?? 0}
            {teamASide && <> · <span className={`side-badge ${teamASide.toLowerCase()}`}>{userIsA ? teamASide : teamBSide}</span></>}
          </div>
        </div>
        <button className="btn" onClick={close}>← Back</button>
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
    </div>
  );
}
