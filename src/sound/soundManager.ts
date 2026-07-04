// Sound manager — Web Audio API for synth-generated default sounds,
// with file-based override at public/sounds/{name}.ogg or .mp3.
// Designed to never block the UI: lazy AudioContext init on first interaction,
// graceful fail if audio isn't permitted.

export type SoundEvent =
  | 'tick'             // UI click / day-advance tick
  | 'inbox'            // new inbox message ding
  | 'round-win'        // round won (CS-style positive beep)
  | 'round-loss'       // round lost (low beep)
  | 'bomb-plant'       // bomb planted (urgent low rumble)
  | 'bomb-defuse'      // bomb defused (relief tone)
  | 'match-win'        // match victory fanfare
  | 'match-loss'       // match defeat tone
  | 'major-win'        // big tournament win — extended fanfare
  | 'sponsor-signed'   // cha-ching
  | 'concern'          // player concern walk-in (knock-knock)
  | 'case-tick'        // CS2 case scroll tick (short metallic click)
  | 'case-reveal'      // strip lands on winner (bright stinger)
  | 'case-rare';       // extra fanfare layered on covert/knife drops

/** Which BGM track to play. 'random' rotates uniformly through the pool
 *  between plays. Named tracks loop that single file. */
export type MusicTrack = 'random' | 'bg' | 'bg2' | 'bg3' | 'bg4' | 'bg5';

/** Ordered pool for random rotation. bg maps to the original bgmusic.mp3;
 *  bg2..bg5 are additional files dropped by the user into public/. */
export const MUSIC_TRACKS: { id: MusicTrack; label: string; url: string }[] = [
  { id: 'random', label: 'Random rotation', url: '' },
  { id: 'bg',     label: 'Track 1 — Menu theme', url: '/bgmusic.mp3' },
  { id: 'bg2',    label: 'Track 2', url: '/bg2.mp3' },
  { id: 'bg3',    label: 'Track 3', url: '/bg3.mp3' },
  { id: 'bg4',    label: 'Track 4', url: '/bg4.mp3' },
  { id: 'bg5',    label: 'Track 5', url: '/bg5.mp3' },
];

interface SoundSettings {
  muted: boolean;
  volume: number;       // 0-1 master (SFX)
  musicVolume: number;  // 0-1 BGM volume
  musicMuted: boolean;  // separate mute for BGM so users can silence music without killing SFX
  musicTrack: MusicTrack; // active track choice ('random' rotates)
}

const SETTINGS_KEY = 'cs2manager-sound-settings';
const DEFAULT_SETTINGS: SoundSettings = { muted: false, volume: 0.5, musicVolume: 0.25, musicMuted: false, musicTrack: 'random' };

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let settings: SoundSettings = loadSettings();
// Cache for loaded audio file buffers (when user drops sounds into public/sounds/)
const bufferCache = new Map<SoundEvent, AudioBuffer | 'missing'>();
// Per-event mapping to filename (extensible)
const FILE_MAP: Record<SoundEvent, string> = {
  tick: 'tick',
  inbox: 'inbox',
  'round-win': 'round-ct-win',
  'round-loss': 'round-t-win',
  'bomb-plant': 'bomb-planted',
  'bomb-defuse': 'bomb-defused',
  'match-win': 'match-win',
  'match-loss': 'match-loss',
  'major-win': 'major-win',
  'sponsor-signed': 'cash',
  concern: 'knock',
  'case-tick': 'case-tick',
  'case-reveal': 'case-reveal',
  'case-rare': 'case-rare',
};

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function getSoundSettings(): SoundSettings {
  return { ...settings };
}

export function setSoundSettings(patch: Partial<SoundSettings>): void {
  settings = { ...settings, ...patch };
  saveSettings();
  if (masterGain) masterGain.gain.value = settings.muted ? 0 : settings.volume;
  // Music channel obeys the same mute + its own volume slider.
  if (musicEl) musicEl.volume = settings.musicMuted ? 0 : settings.musicVolume;
}

// ---------------------------------------------------------------------
// Background music channel — HTMLAudioElement so we can stream + loop
// without pre-decoding the whole track. Separate mute + volume so the
// user can silence music without killing round-tick SFX.
// ---------------------------------------------------------------------

let musicEl: HTMLAudioElement | null = null;
let musicStarted = false;
/** The last random track played — so we don't repeat back-to-back when
 *  the pool has >1 concrete file. */
let lastRandomTrack: MusicTrack | null = null;

/** Concrete (non-random) track ids, in URL-list order. */
const CONCRETE_TRACKS: { id: MusicTrack; url: string }[] = MUSIC_TRACKS
  .filter((t) => t.id !== 'random')
  .map((t) => ({ id: t.id, url: t.url }));

/** Resolve a URL for the current track setting. 'random' picks a
 *  concrete track that isn't the one we just finished. */
function pickTrackUrl(): string {
  const setting = settings.musicTrack;
  if (setting !== 'random') {
    const hit = CONCRETE_TRACKS.find((t) => t.id === setting);
    if (hit) return hit.url;
  }
  // Random rotation — avoid repeat.
  const candidates = CONCRETE_TRACKS.filter((t) => t.id !== lastRandomTrack);
  const pool = candidates.length > 0 ? candidates : CONCRETE_TRACKS;
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  lastRandomTrack = pick.id;
  return pick.url;
}

/** Start the background music if it isn't already playing. Called on
 *  first user gesture (menu click, etc.) because browsers block auto-
 *  play without one. Idempotent — safe to call repeatedly. */
export function startBackgroundMusic(): void {
  if (typeof window === 'undefined') return;
  if (musicStarted && musicEl) {
    if (musicEl.paused && !settings.musicMuted) void musicEl.play().catch(() => {});
    return;
  }
  musicStarted = true;
  const el = new Audio();
  el.volume = settings.musicMuted ? 0 : settings.musicVolume;
  el.preload = 'auto';
  // Loop the CURRENT track only when the user picked a specific one.
  // In random mode we let it end and pick a new one, so no loop flag.
  el.loop = settings.musicTrack !== 'random';
  el.src = pickTrackUrl();
  // When a track ends in random mode, pick another and keep going.
  el.addEventListener('ended', () => {
    if (settings.musicTrack === 'random' && !settings.musicMuted) {
      el.src = pickTrackUrl();
      void el.play().catch(() => {});
    }
  });
  el.addEventListener('error', () => {
    // File missing — try the next candidate rather than dying silently.
    if (settings.musicTrack === 'random') {
      el.src = pickTrackUrl();
      if (!settings.musicMuted) void el.play().catch(() => {});
    }
  });
  musicEl = el;
  if (!settings.musicMuted) {
    void el.play().catch(() => { /* autoplay may still be blocked; second gesture recovers */ });
  }
}

/** Pause the background music without unloading the element. Resume by
 *  calling startBackgroundMusic() again. */
export function stopBackgroundMusic(): void {
  if (musicEl) musicEl.pause();
}

/** Toggle music mute — pauses/resumes the element AND writes the setting
 *  so it persists across reloads. Returns the new muted state. */
export function toggleMusicMuted(): boolean {
  const next = !settings.musicMuted;
  setSoundSettings({ musicMuted: next });
  if (musicEl) {
    if (next) musicEl.pause();
    else void musicEl.play().catch(() => {});
  }
  return next;
}

/** Switch active track. If music is already playing we swap the source
 *  live and resume; otherwise the choice is stored for the next start.
 *  Passing 'random' immediately kicks off a fresh random pick. */
export function setMusicTrack(track: MusicTrack): void {
  setSoundSettings({ musicTrack: track });
  if (!musicEl) return;
  const wasPlaying = !musicEl.paused;
  musicEl.loop = track !== 'random';
  musicEl.src = pickTrackUrl();
  if (wasPlaying && !settings.musicMuted) {
    void musicEl.play().catch(() => {});
  }
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = settings.muted ? 0 : settings.volume;
    masterGain.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/** Resume the audio context (needed after first user gesture in most browsers). */
export function unlockAudio(): void {
  const c = ensureCtx();
  if (c && c.state === 'suspended') void c.resume();
}

/**
 * Try to load a file from public/sounds/ for this event.
 * Returns a cached buffer if available, fetches on first call, returns
 * 'missing' on 404 (we never retry).
 */
async function tryLoadFile(event: SoundEvent): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(event);
  if (cached === 'missing') return null;
  if (cached) return cached;
  const c = ensureCtx();
  if (!c) return null;
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const candidates = [`${base}sounds/${FILE_MAP[event]}.ogg`, `${base}sounds/${FILE_MAP[event]}.mp3`];
  for (const url of candidates) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const ab = await r.arrayBuffer();
      const buf = await c.decodeAudioData(ab.slice(0));
      bufferCache.set(event, buf);
      return buf;
    } catch {
      // try next
    }
  }
  bufferCache.set(event, 'missing');
  return null;
}

/** Per-event throttle: minimum ms between consecutive plays. Prevents
 *  audio-node spam when an effect can fire many times in quick succession
 *  (notably case-tick during the spin animation). 0 = no throttle. */
const THROTTLE_MS: Partial<Record<SoundEvent, number>> = {
  'case-tick': 35,
  tick: 50,
};
const lastPlayedAt: Partial<Record<SoundEvent, number>> = {};

/** Play a sound event. Synth-generated unless a file override exists. */
export function play(event: SoundEvent): void {
  if (settings.muted) return;
  const throttle = THROTTLE_MS[event];
  if (throttle) {
    const now = performance.now();
    const last = lastPlayedAt[event] ?? 0;
    if (now - last < throttle) return;
    lastPlayedAt[event] = now;
  }
  const c = ensureCtx();
  if (!c || !masterGain) return;
  // Try file first (async, fire-and-forget); fall back to synth immediately.
  // This means file overrides may be skipped on the very first play (still loading)
  // but used on subsequent calls.
  void tryLoadFile(event).then((buf) => {
    if (!buf || !c || !masterGain || settings.muted) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(masterGain);
    src.start();
  });
  // Synth fallback — plays immediately
  playSynth(event, c, masterGain);
}

/**
 * Synth-generated sound effects. Carefully tuned to evoke their CS counterparts
 * without using copyrighted samples. Each effect is a short envelope + filter.
 */
function playSynth(event: SoundEvent, c: AudioContext, master: GainNode): void {
  // If a file is loaded, skip the synth to avoid layering
  const cached = bufferCache.get(event);
  if (cached && cached !== 'missing') return;
  const now = c.currentTime;
  switch (event) {
    case 'tick':
      beep(c, master, now, 1500, 0.04, 'square', 0.05);
      break;
    case 'inbox':
      beep(c, master, now, 880, 0.08, 'sine', 0.18);
      beep(c, master, now + 0.08, 1320, 0.08, 'sine', 0.18);
      break;
    case 'round-win':
      // ascending two-note positive
      beep(c, master, now, 660, 0.1, 'triangle', 0.25);
      beep(c, master, now + 0.1, 990, 0.18, 'triangle', 0.28);
      break;
    case 'round-loss':
      // descending two-note negative
      beep(c, master, now, 440, 0.12, 'sawtooth', 0.22);
      beep(c, master, now + 0.12, 330, 0.2, 'sawtooth', 0.22);
      break;
    case 'bomb-plant': {
      // urgent low rumble + accent
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, now);
      o.frequency.exponentialRampToValueAtTime(80, now + 0.4);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.4, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      o.connect(g);
      g.connect(master);
      o.start(now);
      o.stop(now + 0.5);
      beep(c, master, now + 0.05, 1760, 0.06, 'square', 0.15);
      break;
    }
    case 'bomb-defuse':
      // relief: ascending arpeggio
      beep(c, master, now, 523, 0.08, 'triangle', 0.2);
      beep(c, master, now + 0.07, 659, 0.08, 'triangle', 0.2);
      beep(c, master, now + 0.14, 784, 0.15, 'triangle', 0.25);
      break;
    case 'match-win':
      // four-note fanfare
      beep(c, master, now, 523, 0.1, 'triangle', 0.3);
      beep(c, master, now + 0.1, 659, 0.1, 'triangle', 0.3);
      beep(c, master, now + 0.2, 784, 0.1, 'triangle', 0.3);
      beep(c, master, now + 0.3, 1047, 0.25, 'triangle', 0.32);
      break;
    case 'match-loss':
      beep(c, master, now, 392, 0.12, 'sawtooth', 0.25);
      beep(c, master, now + 0.12, 311, 0.18, 'sawtooth', 0.22);
      beep(c, master, now + 0.28, 247, 0.3, 'sawtooth', 0.2);
      break;
    case 'major-win':
      // extended fanfare with chord
      beep(c, master, now, 523, 0.12, 'triangle', 0.28);
      beep(c, master, now + 0.12, 659, 0.12, 'triangle', 0.28);
      beep(c, master, now + 0.24, 784, 0.12, 'triangle', 0.28);
      beep(c, master, now + 0.36, 1047, 0.4, 'triangle', 0.32);
      beep(c, master, now + 0.36, 659, 0.4, 'triangle', 0.2);
      beep(c, master, now + 0.36, 784, 0.4, 'triangle', 0.2);
      break;
    case 'sponsor-signed':
      // cha-ching: high bell + glissando
      beep(c, master, now, 1318, 0.12, 'sine', 0.18);
      beep(c, master, now + 0.05, 1760, 0.18, 'sine', 0.2);
      beep(c, master, now + 0.13, 2093, 0.22, 'sine', 0.18);
      break;
    case 'concern':
      // knock-knock
      beep(c, master, now, 180, 0.05, 'square', 0.25);
      beep(c, master, now + 0.13, 180, 0.05, 'square', 0.25);
      break;
    case 'case-tick': {
      // Short metallic click — quick decay on a low square. Mimics the
      // ratchet sound a real CS case scroll makes.
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(420, now);
      o.frequency.exponentialRampToValueAtTime(180, now + 0.04);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      o.connect(g);
      g.connect(master);
      o.start(now);
      o.stop(now + 0.06);
      break;
    }
    case 'case-reveal':
      // Bright bell stinger — ascending two-note resolve.
      beep(c, master, now, 880, 0.12, 'triangle', 0.28);
      beep(c, master, now + 0.08, 1320, 0.2, 'triangle', 0.3);
      break;
    case 'case-rare':
      // Extra fanfare layered on rare drops — ascending arpeggio with sparkle.
      beep(c, master, now, 1047, 0.12, 'triangle', 0.3);
      beep(c, master, now + 0.08, 1318, 0.12, 'triangle', 0.3);
      beep(c, master, now + 0.16, 1568, 0.12, 'triangle', 0.3);
      beep(c, master, now + 0.24, 2093, 0.35, 'triangle', 0.32);
      beep(c, master, now + 0.24, 2637, 0.35, 'sine', 0.18); // sparkle
      break;
  }
}

function beep(
  c: AudioContext,
  master: GainNode,
  startTime: number,
  freq: number,
  duration: number,
  type: OscillatorType,
  peakGain: number,
): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, startTime);
  g.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  o.connect(g);
  g.connect(master);
  o.start(startTime);
  o.stop(startTime + duration + 0.02);
}
