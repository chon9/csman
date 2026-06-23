import { useEffect, useRef, useState } from 'react';
import type { MapLayout, RoundFrame } from '../../types';

interface Props {
  layout: MapLayout;
  frame: RoundFrame | null;
  prevFrame: RoundFrame | null;
  lerp: number; // 0-1 interpolation between prevFrame and frame
  userIsA: boolean;
  teamAPlayerIds: Set<string>;
  nicknames: Record<string, string>;
}

const SIZE = 640; // radar images are square

// Square crop window per map (x, y, side in normalized image coords) — trims the
// big empty margins in the official radar images. Zone coords are remapped through it.
const CROPS: Record<string, [number, number, number]> = {
  Mirage: [0.07, 0.1, 0.88],
  Inferno: [0.04, 0.03, 0.94],
  Nuke: [0.02, 0.03, 0.96],
  Ancient: [0.08, 0.04, 0.9],
  Anubis: [0.1, 0.02, 0.88],
  Vertigo: [0.08, 0.1, 0.8],
  Dust2: [0.02, 0.0, 0.97],
};

function nearestZoneId(layout: MapLayout, x: number, y: number): string {
  let best = layout.zones[0].id;
  let bestD = Infinity;
  for (const z of layout.zones) {
    const d = (z.x - x) * (z.x - x) + (z.y - y) * (z.y - y);
    if (d < bestD) {
      bestD = d;
      best = z.id;
    }
  }
  return best;
}

/** Position along [from, ...bends, to] polyline at fraction t (by arc length). */
function alongPath(pts: [number, number][], t: number): [number, number] {
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  if (total === 0) return pts[0];
  let dist = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (dist <= lens[i] || i === lens.length - 1) {
      const f = lens[i] === 0 ? 0 : Math.min(1, dist / lens[i]);
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      ];
    }
    dist -= lens[i];
  }
  return pts[pts.length - 1];
}

// module-level radar image cache
const imageCache = new Map<string, HTMLImageElement>();
// Per-image listener sets — `img.onload =` would clobber previous callbacks,
// and once an image is cached we never replace the assignment, so stale
// callbacks from unmounted MapCanvas instances could fire setState forever.
// addEventListener + removeEventListener lets each caller clean up on unmount.
function getRadar(mapName: string, onload: () => void): { img: HTMLImageElement; detach: () => void } {
  let img = imageCache.get(mapName);
  if (!img) {
    img = new Image();
    img.src = `${import.meta.env.BASE_URL}maps/${mapName}.png`;
    imageCache.set(mapName, img);
  }
  if (img.complete && img.naturalWidth > 0) {
    // Already loaded — fire immediately so the caller can paint.
    onload();
    return { img, detach: () => {} };
  }
  img.addEventListener('load', onload);
  return { img, detach: () => img!.removeEventListener('load', onload) };
}

// ============ playable-area mask (from radar alpha channel) ============
// Guarantees dots are never rendered outside the map: any position landing on a
// transparent pixel is snapped to the nearest opaque (playable) one.
const MASK_N = 192;
interface PlayableMask {
  data: Uint8Array; // MASK_N * MASK_N, 1 = playable
}
const maskCache = new Map<string, PlayableMask>();

function getMask(mapName: string, img: HTMLImageElement): PlayableMask | null {
  const cached = maskCache.get(mapName);
  if (cached) return cached;
  if (!img.complete || img.naturalWidth === 0) return null;
  const cv = document.createElement('canvas');
  cv.width = MASK_N;
  cv.height = MASK_N;
  const c = cv.getContext('2d', { willReadFrequently: true });
  if (!c) return null;
  c.drawImage(img, 0, 0, MASK_N, MASK_N);
  const raw = c.getImageData(0, 0, MASK_N, MASK_N).data;
  const data = new Uint8Array(MASK_N * MASK_N);
  for (let i = 0; i < MASK_N * MASK_N; i++) {
    data[i] = raw[i * 4 + 3] > 40 ? 1 : 0;
  }
  const mask = { data };
  maskCache.set(mapName, mask);
  return mask;
}

const clampCell = (v: number) => Math.max(0, Math.min(MASK_N - 1, v));

/** Snap a normalized image coordinate to the nearest playable pixel. */
function snapToPlayable(mask: PlayableMask, x: number, y: number): [number, number] {
  const cx = clampCell(Math.floor(x * MASK_N));
  const cy = clampCell(Math.floor(y * MASK_N));
  if (mask.data[cy * MASK_N + cx]) return [x, y];
  for (let r = 1; r <= 18; r++) {
    let bx = -1;
    let by = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const px2 = cx + dx;
        const py2 = cy + dy;
        if (px2 < 0 || py2 < 0 || px2 >= MASK_N || py2 >= MASK_N) continue;
        if (mask.data[py2 * MASK_N + px2]) {
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            bx = px2;
            by = py2;
          }
        }
      }
    }
    if (bx >= 0) return [(bx + 0.5) / MASK_N, (by + 0.5) / MASK_N];
  }
  return [x, y];
}

export default function MapCanvas({ layout, frame, prevFrame, lerp, teamAPlayerIds, nicknames }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, setLoaded] = useState(0); // bump to redraw once the radar finishes loading

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { img: radar, detach: detachLoad } = getRadar(layout.name, () => setLoaded((n) => n + 1));
    const mask = getMask(layout.name, radar);
    const [cx, cy, cs] = CROPS[layout.name] ?? [0, 0, 1];
    // remap a normalized image coordinate through the crop window
    const px = (v: number) => ((v - cx) / cs) * SIZE;
    const py = (v: number) => ((v - cy) / cs) * SIZE;

    // background
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(0, 0, SIZE, SIZE);
    if (radar.complete && radar.naturalWidth > 0) {
      const w = radar.naturalWidth;
      const h = radar.naturalHeight;
      ctx.drawImage(radar, cx * w, cy * h, cs * w, cs * h, 0, 0, SIZE, SIZE);
      // dim slightly so dots stand out
      ctx.fillStyle = 'rgba(10, 12, 18, 0.32)';
      ctx.fillRect(0, 0, SIZE, SIZE);
    } else {
      ctx.fillStyle = '#5d6678';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Loading ${layout.name} radar…`, SIZE / 2, SIZE / 2);
    }

    if (!frame) return;

    // bomb
    if (frame.bombPlanted && frame.bombX !== undefined && frame.bombY !== undefined) {
      const [sbx, sby] = mask ? snapToPlayable(mask, frame.bombX, frame.bombY) : [frame.bombX, frame.bombY];
      const bx = px(sbx);
      const by = py(sby);
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 180);
      ctx.fillStyle = `rgba(226,85,85,${0.35 + pulse * 0.5})`;
      ctx.beginPath();
      ctx.arc(bx, by, 10 + pulse * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('C4', bx, by);
    }

    // players (interpolated between frames)
    for (const dot of frame.dots) {
      const prev = prevFrame?.dots.find((d) => d.playerId === dot.playerId) ?? dot;
      // route movement through corridor waypoints when the edge has them
      let ix = prev.x + (dot.x - prev.x) * lerp;
      let iy = prev.y + (dot.y - prev.y) * lerp;
      const moved = Math.abs(dot.x - prev.x) + Math.abs(dot.y - prev.y) > 0.001;
      if (moved && layout.bends) {
        const fromId = nearestZoneId(layout, prev.x, prev.y);
        const toId = nearestZoneId(layout, dot.x, dot.y);
        if (fromId !== toId) {
          const key = [fromId, toId].sort().join('|');
          const bend = layout.bends[key];
          if (bend && bend.length) {
            // bends stored in sorted-id direction; reverse when traveling the other way
            const oriented = fromId < toId ? bend : [...bend].reverse();
            const pts: [number, number][] = [[prev.x, prev.y], ...oriented, [dot.x, dot.y]];
            [ix, iy] = alongPath(pts, lerp);
          }
        }
      }
      if (mask) [ix, iy] = snapToPlayable(mask, ix, iy);
      const x = px(ix);
      const y = py(iy);
      const isT = dot.side === 'T';
      const color = isT ? '#f2a13c' : '#6aa7ec';

      if (!dot.alive) {
        ctx.strokeStyle = 'rgba(180,180,190,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
        ctx.stroke();
        continue;
      }

      // glow for visibility on busy radar art
      ctx.fillStyle = isT ? 'rgba(242,161,60,0.25)' : 'rgba(106,167,236,0.25)';
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d0f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (dot.hasBomb) {
        ctx.fillStyle = '#e25555';
        ctx.beginPath();
        ctx.arc(x + 6, y - 6, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0d0f14';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // nickname with shadow for readability
      const name = nicknames[dot.playerId] ?? '';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(name, x + 1, y - 9);
      ctx.fillStyle = teamAPlayerIds.has(dot.playerId) ? '#f5e3c4' : '#d2e2f7';
      ctx.fillText(name, x, y - 10);
    }
    // Detach the radar-loaded listener if the effect re-runs or component
    // unmounts — otherwise pending image loads call setLoaded on stale state.
    return detachLoad;
  }, [layout, frame, prevFrame, lerp, teamAPlayerIds, nicknames]);

  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      style={{ width: '100%', maxWidth: SIZE, borderRadius: 8, border: '1px solid #2a2f3a', background: '#0d1016' }}
    />
  );
}
