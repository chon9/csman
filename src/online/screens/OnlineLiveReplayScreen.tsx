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
  const teamAPlayerIds = new Set<string>(
    Object.values(curMap?.playerStats ?? {})
      .map((s) => s.playerId)
      .filter((pid) => {
        const p = players[pid];
        // Without a registered player record we can't tell side cleanly;
        // assume any user-team player is teamA-side when userIsA.
        if (p && p.teamId === team.id) return userIsA;
        return !userIsA;
      }),
  );

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
          </div>
        </div>
        <button className="btn" onClick={close}>← Back</button>
      </div>

      {layout && frame && (
        <div className="panel" style={{ padding: 8 }}>
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
        <button
          className="btn btn-tiny"
          onClick={() => {
            // Skip to end of round.
            if (curRound) setFrameIdx(curRound.frames.length - 1);
          }}
        >
          Skip round
        </button>
        <button
          className="btn btn-tiny"
          onClick={() => {
            // Skip to end of map.
            if (curMap) {
              setRoundIdx(curMap.rounds.length - 1);
              setFrameIdx((curMap.rounds[curMap.rounds.length - 1].frames.length ?? 1) - 1);
            }
          }}
        >
          Skip map
        </button>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          Replay window: ~5min after duel. Once expired, use History for stats-only view.
        </span>
      </div>
    </div>
  );
}
