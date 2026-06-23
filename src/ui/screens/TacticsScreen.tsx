import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { MAP_STRATS } from '../../engine/strats';
import { ALL_MAPS } from '../../types';
import { allRoleStars, familiarityTier, roleFamiliarityPoints } from '../../sim/playerAnalytics';
import { FormationPitch } from '../FormationPitch';
import type { FamiliarityTier } from '../../sim/playerAnalytics';
import type {
  CTSidePlaystyle,
  GameState,
  MapName,
  MapTactics,
  MatchPlan,
  Player,
  PlayerRole,
  RoleDuty,
  RoleSlot,
  Tactics,
  TempoPreset,
  TSidePlaystyle,
} from '../../types';

// ============ Tab definitions ============

type TabId = 'default' | MapName | 'roles' | 'plans';

const TABS: { id: TabId; label: string }[] = [
  { id: 'default', label: 'Default' },
  ...ALL_MAPS.map((m) => ({ id: m as TabId, label: m })),
  { id: 'roles', label: 'Roles' },
  { id: 'plans', label: 'Match Plans' },
];

// ============ Reference data ============

const T_STYLES: { value: TSidePlaystyle; label: string }[] = [
  { value: 'default', label: 'Default — map control, mid-round calls' },
  { value: 'explosive', label: 'Explosive — fast executes, early aggression' },
  { value: 'slow-default', label: 'Slow Default — patient, late executes' },
  { value: 'mixed', label: 'Mixed — vary round to round' },
];

const CT_STYLES: { value: CTSidePlaystyle; label: string }[] = [
  { value: 'standard', label: 'Standard — balanced site setups' },
  { value: 'aggressive-info', label: 'Aggressive Info — early pushes for info' },
  { value: 'passive-retake', label: 'Passive Retake — give space, retake sites' },
  { value: 'stacked-gambles', label: 'Stacked Gambles — gamble stacks on reads' },
];

const SLIDERS: { key: keyof Tactics; label: string; hint: string }[] = [
  { key: 'aggression', label: 'Aggression', hint: 'How readily players take fights' },
  { key: 'utilityUsage', label: 'Utility Usage', hint: 'Utility committed per execute' },
  { key: 'midRoundFlexibility', label: 'Mid-Round Flexibility', hint: 'IGL adapting mid-round' },
  { key: 'ecoDiscipline', label: 'Eco Discipline', hint: 'Strictness of economy rules' },
  { key: 'forceBuyTendency', label: 'Force-Buy Tendency', hint: 'Willingness to force' },
];

const TEMPO_PRESETS: { value: TempoPreset; label: string; hint: string; tempos: string[] }[] = [
  { value: 'patient', label: 'Patient', hint: 'Slow defaults, info-first plays', tempos: ['slow', 'standard'] },
  { value: 'balanced', label: 'Balanced', hint: 'Full playbook, situational picks', tempos: ['rush', 'fast', 'standard', 'slow'] },
  { value: 'aggressive', label: 'Aggressive', hint: 'Rushes and fast executes', tempos: ['rush', 'fast'] },
];

const ROLES_ORDER: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler', 'Anchor'];
const DUTIES: { value: RoleDuty; label: string; hint: string }[] = [
  { value: 'aggressive', label: 'Aggressive', hint: '+ peek wins, − anchor power' },
  { value: 'balanced', label: 'Balanced', hint: 'Default behaviour' },
  { value: 'passive', label: 'Passive', hint: '+ anchor power, − peek wins' },
];

// ============ Screen ============

export default function TacticsScreen() {
  const game = useGame((s) => s.game)!;
  const setTactics = useGame((s) => s.setTactics);
  const setMapOverride = useGame((s) => s.setMapOverride);
  const toggleStratEnabled = useGame((s) => s.toggleStratEnabled);
  const setRoleSlot = useGame((s) => s.setRoleSlot);
  const setMatchPlan = useGame((s) => s.setMatchPlan);
  const [tab, setTab] = useState<TabId>('default');

  return (
    <div className="screen">
      <h2 className="screen-title">Tactics</h2>
      <div className="tab-row tactics-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'default' && (
        <DefaultTab tactics={game.tactics} onChange={setTactics} />
      )}
      {ALL_MAPS.includes(tab as MapName) && (
        <MapTab
          map={tab as MapName}
          tactics={game.tactics}
          onChangeOverride={(patch) => setMapOverride(tab as MapName, patch)}
          onToggleStrat={(name, all) => toggleStratEnabled(tab as MapName, name, all)}
        />
      )}
      {tab === 'roles' && <RolesTab game={game} onSetSlot={setRoleSlot} />}
      {tab === 'plans' && <PlansTab game={game} onSetPlan={setMatchPlan} />}
    </div>
  );
}

// ============ Default tab — global tactics + veto priority ============

// One-click presets that apply a named approach across all sliders + playstyles.
const APPROACH_PRESETS: {
  id: string;
  label: string;
  hint: string;
  patch: Partial<Tactics>;
}[] = [
  {
    id: 'agg-default',
    label: 'Aggressive Default',
    hint: 'Take early duels, push for info, force buys after losses.',
    patch: {
      tPlaystyle: 'explosive', ctPlaystyle: 'aggressive-info',
      aggression: 16, utilityUsage: 12, midRoundFlexibility: 14, ecoDiscipline: 10, forceBuyTendency: 14,
    },
  },
  {
    id: 'slow-control',
    label: 'Slow Map Control',
    hint: 'Patient defaults, gather info, late executes when ahead.',
    patch: {
      tPlaystyle: 'slow-default', ctPlaystyle: 'standard',
      aggression: 7, utilityUsage: 13, midRoundFlexibility: 16, ecoDiscipline: 16, forceBuyTendency: 8,
    },
  },
  {
    id: 'heavy-execute',
    label: 'Heavy Execute',
    hint: 'Burn utility on full-team site takes.',
    patch: {
      tPlaystyle: 'default', ctPlaystyle: 'standard',
      aggression: 11, utilityUsage: 18, midRoundFlexibility: 11, ecoDiscipline: 13, forceBuyTendency: 10,
    },
  },
  {
    id: 'fast-rush',
    label: 'Fast Rush',
    hint: 'Snap executes, minimal mid-round adjustment.',
    patch: {
      tPlaystyle: 'explosive', ctPlaystyle: 'aggressive-info',
      aggression: 18, utilityUsage: 14, midRoundFlexibility: 8, ecoDiscipline: 9, forceBuyTendency: 13,
    },
  },
  {
    id: 'defensive-hold',
    label: 'Defensive Hold',
    hint: 'Anchor sites, give space, win retakes.',
    patch: {
      tPlaystyle: 'slow-default', ctPlaystyle: 'passive-retake',
      aggression: 6, utilityUsage: 11, midRoundFlexibility: 12, ecoDiscipline: 17, forceBuyTendency: 6,
    },
  },
  {
    id: 'retake-setup',
    label: 'Retake Setup',
    hint: 'CT-side passive into retakes; T-side mixed.',
    patch: {
      tPlaystyle: 'mixed', ctPlaystyle: 'passive-retake',
      aggression: 9, utilityUsage: 15, midRoundFlexibility: 13, ecoDiscipline: 15, forceBuyTendency: 8,
    },
  },
  {
    id: 'eco-focus',
    label: 'Economy-Focused',
    hint: 'Save aggressively, never force, punish enemy ecos.',
    patch: {
      tPlaystyle: 'mixed', ctPlaystyle: 'standard',
      aggression: 9, utilityUsage: 12, midRoundFlexibility: 13, ecoDiscipline: 19, forceBuyTendency: 4,
    },
  },
];

function DefaultTab({ tactics, onChange }: { tactics: Tactics; onChange: (t: Tactics) => void }) {
  function update(patch: Partial<Tactics>) {
    onChange({ ...tactics, ...patch });
  }
  function moveMap(idx: number, dir: -1 | 1) {
    const next = [...tactics.mapVetoPriority];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    update({ mapVetoPriority: next });
  }
  return (
    <div className="tactics-grid">
      <div className="panel">
        <div className="panel-title">Tactical Approach</div>
        <p className="muted small">
          One-click presets that set playstyles + sliders to match a named identity. You can still
          fine-tune any slider below afterward.
        </p>
        <div className="approach-presets">
          {APPROACH_PRESETS.map((a) => (
            <button
              key={a.id}
              className="approach-chip"
              title={a.hint}
              onClick={() => update(a.patch)}
            >
              <span className="approach-label">{a.label}</span>
              <span className="approach-hint">{a.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">Global Playstyle</div>
        <p className="muted small">
          These settings apply to every map unless overridden in a map tab.
        </p>
        <PlaystyleAndSliders tactics={tactics} onPatch={update} />
      </div>
      <div className="panel">
        <div className="panel-title">Map Veto Priority</div>
        <p className="muted small">Ordered preference, best first.</p>
        <div className="veto-list">
          {tactics.mapVetoPriority.map((m, idx) => (
            <div key={m} className="veto-row">
              <span className="veto-rank">{idx + 1}</span>
              <span className="veto-map">{m}</span>
              <span className="veto-actions">
                <button className="btn btn-tiny" disabled={idx === 0} onClick={() => moveMap(idx, -1)}>Up</button>
                <button className="btn btn-tiny" disabled={idx === tactics.mapVetoPriority.length - 1} onClick={() => moveMap(idx, 1)}>Dn</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ Map tab — per-map overrides + strat playbook ============

interface MapTabProps {
  map: MapName;
  tactics: Tactics;
  onChangeOverride: (patch: Partial<MapTactics> | null) => void;
  onToggleStrat: (stratName: string, allStratNames: string[]) => void;
}

function MapTab({ map, tactics, onChangeOverride, onToggleStrat }: MapTabProps) {
  const override: MapTactics = tactics.mapOverrides?.[map] ?? {};
  const allStratNames = useMemo(() => MAP_STRATS[map].map((s) => s.name), [map]);
  const enabled = override.enabledStrats ?? allStratNames;

  // Merged view: what's actually in effect (override falls back to global)
  function effField<K extends keyof Tactics>(key: K): Tactics[K] {
    return (override[key as keyof MapTactics] as Tactics[K]) ?? tactics[key];
  }

  function patchOverride(patch: Partial<MapTactics>) {
    onChangeOverride(patch);
  }

  function setPreset(preset: TempoPreset) {
    const p = TEMPO_PRESETS.find((x) => x.value === preset)!;
    const matching = MAP_STRATS[map].filter((s) => p.tempos.includes(s.tempo)).map((s) => s.name);
    patchOverride({ tempoPreset: preset, enabledStrats: matching });
  }

  return (
    <div className="tactics-grid">
      <div className="panel">
        <div className="panel-title">{map} — Playstyle Overrides</div>
        <p className="muted small">
          Leave fields on "Inherit from Default" unless you want this map to play differently.
        </p>
        <InheritField
          label="T-Side Playstyle"
          inherited={tactics.tPlaystyle}
          override={override.tPlaystyle}
          onSet={(v) => patchOverride({ tPlaystyle: v as TSidePlaystyle })}
          onClear={() => patchOverride({ tPlaystyle: undefined })}
          options={T_STYLES}
        />
        <InheritField
          label="CT-Side Playstyle"
          inherited={tactics.ctPlaystyle}
          override={override.ctPlaystyle}
          onSet={(v) => patchOverride({ ctPlaystyle: v as CTSidePlaystyle })}
          onClear={() => patchOverride({ ctPlaystyle: undefined })}
          options={CT_STYLES}
        />

        {SLIDERS.map((s) => (
          <InheritSlider
            key={s.key}
            label={s.label}
            hint={s.hint}
            inherited={tactics[s.key] as number}
            override={(override as Record<string, number | undefined>)[s.key as string]}
            onSet={(v) => patchOverride({ [s.key]: v } as Partial<MapTactics>)}
            onClear={() => patchOverride({ [s.key]: undefined } as Partial<MapTactics>)}
          />
        ))}
      </div>

      <div className="panel">
        <div className="panel-title">Playbook — {enabled.length}/{allStratNames.length} strats</div>
        <p className="muted small">
          Toggle which T-side calls your IGL is allowed to make on this map. Disable
          too many and your team becomes predictable; enable all for variety.
        </p>
        <div className="chip-row tempo-presets">
          {TEMPO_PRESETS.map((p) => (
            <button
              key={p.value}
              className={`chip ${override.tempoPreset === p.value ? 'chip-user' : ''}`}
              title={p.hint}
              onClick={() => setPreset(p.value)}
            >
              {p.label}
            </button>
          ))}
          <button
            className="chip"
            title="Reset all per-map settings"
            onClick={() => onChangeOverride(null)}
          >
            Reset Map
          </button>
        </div>
        <div className="strat-grid">
          {MAP_STRATS[map].map((s) => {
            const on = enabled.includes(s.name);
            return (
              <button
                key={s.name}
                className={`strat-card ${on ? 'enabled' : 'disabled'}`}
                onClick={() => onToggleStrat(s.name, allStratNames)}
              >
                <div className="strat-card-head">
                  <span className="strat-name">{s.name}</span>
                  <span className={`strat-side strat-site-${s.site}`}>{s.site}</span>
                </div>
                <div className="strat-card-tempo">{s.tempo.toUpperCase()}</div>
                {s.startLine && (
                  <div className="strat-card-line">"{s.startLine.replace('{team}', 'Your team')}"</div>
                )}
                <div className="strat-card-status">{on ? '✓ Enabled' : '○ Disabled'}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Generic select with "inherit" toggle
function InheritField<T extends string>({
  label,
  inherited,
  override,
  onSet,
  onClear,
  options,
}: {
  label: string;
  inherited: T;
  override?: T;
  onSet: (v: T) => void;
  onClear: () => void;
  options: { value: T; label: string }[];
}) {
  const isOverridden = override !== undefined;
  return (
    <label className="field inherit-field">
      <span className="field-label">
        {label}
        <button
          className={`chip tiny ${isOverridden ? 'chip-user' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            if (isOverridden) onClear();
            else onSet(inherited);
          }}
        >
          {isOverridden ? 'Override' : 'Inherit'}
        </button>
      </span>
      <select
        className="input"
        value={override ?? inherited}
        disabled={!isOverridden}
        onChange={(e) => onSet(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InheritSlider({
  label,
  hint,
  inherited,
  override,
  onSet,
  onClear,
}: {
  label: string;
  hint: string;
  inherited: number;
  override?: number;
  onSet: (v: number) => void;
  onClear: () => void;
}) {
  const isOverridden = override !== undefined;
  const value = override ?? inherited;
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span>
          {label}{' '}
          <button
            className={`chip tiny ${isOverridden ? 'chip-user' : ''}`}
            onClick={() => (isOverridden ? onClear() : onSet(inherited))}
          >
            {isOverridden ? 'Override' : 'Inherit'}
          </button>
        </span>
        <span className="slider-value">{value}</span>
      </div>
      <input
        type="range"
        min={1}
        max={20}
        value={value}
        disabled={!isOverridden}
        onChange={(e) => onSet(Number(e.target.value))}
      />
      <div className="muted small">{hint}</div>
    </div>
  );
}

// Shared playstyle + slider block (used in Default tab only — no inherit)
function PlaystyleAndSliders({
  tactics,
  onPatch,
}: {
  tactics: Tactics;
  onPatch: (patch: Partial<Tactics>) => void;
}) {
  return (
    <>
      <label className="field">
        <span className="field-label">T-Side Playstyle</span>
        <select
          className="input"
          value={tactics.tPlaystyle}
          onChange={(e) => onPatch({ tPlaystyle: e.target.value as TSidePlaystyle })}
        >
          {T_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">CT-Side Playstyle</span>
        <select
          className="input"
          value={tactics.ctPlaystyle}
          onChange={(e) => onPatch({ ctPlaystyle: e.target.value as CTSidePlaystyle })}
        >
          {CT_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="panel-title small-title">Approach</div>
      {SLIDERS.map((s) => (
        <div key={s.key} className="slider-row">
          <div className="slider-head">
            <span>{s.label}</span>
            <span className="slider-value">{tactics[s.key] as number}</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={tactics[s.key] as number}
            onChange={(e) => onPatch({ [s.key]: Number(e.target.value) } as Partial<Tactics>)}
          />
          <div className="muted small">{s.hint}</div>
        </div>
      ))}
    </>
  );
}

// ============ Roles tab — 5 positional cards ============

function initials(p: Player): string {
  const n = p.nickname.trim();
  if (n.length <= 3) return n.toUpperCase();
  const parts = n.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function tierClass(tier: FamiliarityTier): string {
  switch (tier) {
    case 'Natural': return 'fam-natural';
    case 'Accomplished': return 'fam-accomplished';
    case 'Competent': return 'fam-competent';
    case 'Unconvincing': return 'fam-unconvincing';
    case 'Awkward': return 'fam-awkward';
  }
}

function tierShort(tier: FamiliarityTier): string {
  switch (tier) {
    case 'Natural': return 'Nat';
    case 'Accomplished': return 'Acc';
    case 'Competent': return 'Cmp';
    case 'Unconvincing': return 'Unc';
    case 'Awkward': return 'Awk';
  }
}

// Default fallback formation when a save has no roleSlots yet.
const DEFAULT_FORMATION: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support'];

// Pre-built formation templates — applied via "Apply Formation" without touching player assignments.
const FORMATION_PRESETS: { id: string; label: string; roles: PlayerRole[]; hint: string }[] = [
  { id: 'classic', label: 'Classic', roles: ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support'], hint: 'Standard CS lineup — one of each role.' },
  { id: 'double-awp', label: 'Double AWP', roles: ['IGL', 'AWPer', 'AWPer', 'Entry', 'Support'], hint: 'Two AWPers — heavy info plays, strong CT side.' },
  { id: 'no-lurker', label: 'No Lurker', roles: ['IGL', 'AWPer', 'Entry', 'Entry', 'Support'], hint: 'Double-entry rush — no map-spread lurking.' },
  { id: 'rifle-heavy', label: 'All-Rifle', roles: ['IGL', 'Entry', 'Lurker', 'Support', 'Rifler'], hint: 'No AWP — five-rifle utility-heavy executes.' },
  { id: 'anchor-ct', label: 'Anchor Stack', roles: ['IGL', 'AWPer', 'Entry', 'Anchor', 'Support'], hint: 'Dedicated site anchor — CT-focused identity.' },
  { id: 'triple-rifle', label: 'Triple Rifle', roles: ['IGL', 'AWPer', 'Rifler', 'Rifler', 'Rifler'], hint: 'Roleless rifling — flex spots.' },
];

function RolesTab({
  game,
  onSetSlot,
}: {
  game: GameState;
  onSetSlot: (idx: number, patch: Partial<RoleSlot>) => void;
}) {
  const team = game.teams[game.userTeamId];
  const allRoster = team.playerIds.map((id) => game.players[id]).filter(Boolean);
  const starting = allRoster.slice(0, 5);

  // Read whatever slot config is saved — no role enforcement. User picks any role per slot.
  const storedSlots = game.tactics.roleSlots;
  const slots: RoleSlot[] =
    storedSlots && storedSlots.length === 5
      ? storedSlots
      : DEFAULT_FORMATION.map((role, i) => ({
          role,
          duty: 'balanced',
          playerId: starting[i]?.id ?? null,
        }));

  // FM-style: select a position, then pick a player from the squad list.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  function assignPlayer(playerId: string) {
    if (selectedIdx === null) return;
    onSetSlot(selectedIdx, { playerId });
    setSelectedIdx(null);
  }

  function clearSlot() {
    if (selectedIdx === null) return;
    onSetSlot(selectedIdx, { playerId: null });
    setSelectedIdx(null);
  }

  function setDuty(duty: RoleDuty) {
    if (selectedIdx === null) return;
    onSetSlot(selectedIdx, { duty });
  }

  function setSlotRole(idx: number, role: PlayerRole) {
    onSetSlot(idx, { role });
  }

  function applyPreset(roles: PlayerRole[]) {
    for (let i = 0; i < 5; i++) onSetSlot(i, { role: roles[i] });
    setSelectedIdx(null);
  }

  const selectedSlot = selectedIdx !== null ? slots[selectedIdx] : null;
  // Players sorted by familiarity at the selected position, then by CA.
  const squadList = (() => {
    if (!selectedSlot) {
      // No selection: just list roster naturally
      return allRoster.map((p) => ({ p, points: roleFamiliarityPoints(p, p.role), tier: 'Natural' as FamiliarityTier }));
    }
    const role = selectedSlot.role;
    return allRoster
      .map((p) => {
        const points = roleFamiliarityPoints(p, role);
        return { p, points, tier: familiarityTier(points) };
      })
      .sort((a, b) => b.points - a.points || b.p.currentAbility - a.p.currentAbility);
  })();

  return (
    <div className="formation-layout">
      <div className="panel formation-panel">
        <div className="panel-title">Squad Formation</div>
        <p className="muted small">
          Click a position to select it, then pick a player from the squad list to assign them.
          Players gain familiarity with a role by playing matches there — well-familiar players
          perform up to +5%, awkward fits up to −7%. Pick any role per slot — go double-AWP, drop
          the Lurker, or run all riflers.
        </p>
        <div className="formation-presets">
          <span className="muted small" style={{ alignSelf: 'center', marginRight: 4 }}>Presets:</span>
          {FORMATION_PRESETS.map((p) => (
            <button
              key={p.id}
              className="chip"
              title={p.hint}
              onClick={() => applyPreset(p.roles)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <FormationPitch
          team={team}
          slots={slots}
          selectedIdx={selectedIdx}
          onSlotClick={(idx) => setSelectedIdx(selectedIdx === idx ? null : idx)}
        />

        {selectedSlot && (
          <div className="formation-detail">
            <div className="panel-title small-title">
              Position {selectedIdx! + 1} — {selectedSlot.role}
              {selectedSlot.playerId && game.players[selectedSlot.playerId] && (
                <span className="muted small"> · {game.players[selectedSlot.playerId].nickname}</span>
              )}
            </div>
            <div className="formation-detail-grid">
              <label className="field">
                <span className="field-label">Slot role</span>
                <select
                  className="input input-tight"
                  value={selectedSlot.role}
                  onChange={(e) => setSlotRole(selectedIdx!, e.target.value as PlayerRole)}
                >
                  {ROLES_ORDER.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span className="field-label">Duty</span>
                <div className="duty-chips">
                  {DUTIES.map((d) => (
                    <button
                      key={d.value}
                      title={d.hint}
                      className={`chip ${selectedSlot.duty === d.value ? 'chip-user' : ''}`}
                      onClick={() => setDuty(d.value)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {selectedSlot.playerId && (
              <button className="btn btn-tiny" style={{ marginTop: 8 }} onClick={clearSlot}>
                Clear position
              </button>
            )}
          </div>
        )}
      </div>

      <div className="panel squad-list-panel">
        <div className="panel-title">
          Squad
          {selectedSlot && (
            <span className="muted small"> — ranked by familiarity at {selectedSlot.role}</span>
          )}
        </div>
        {!selectedSlot && (
          <p className="muted small">Select a position to assign a player.</p>
        )}
        <div className="squad-list-grid">
          {squadList.map(({ p, points, tier }) => {
            const isAssigned = slots.some((s) => s.playerId === p.id);
            const canAssign = selectedSlot !== null;
            const stars = allRoleStars(p).find((r) => r.role === (selectedSlot?.role ?? p.role))?.stars ?? 0;
            return (
              <button
                key={p.id}
                className={`squad-row ${tierClass(tier)} ${isAssigned ? 'in-lineup' : ''} ${canAssign ? 'pickable' : ''}`}
                disabled={!canAssign}
                onClick={() => assignPlayer(p.id)}
                title={
                  canAssign
                    ? `Assign ${p.nickname} to ${selectedSlot!.role} — ${tier} (${points} exp)`
                    : `${p.nickname} — natural ${p.role}`
                }
              >
                <span className="squad-row-initials">{initials(p)}</span>
                <span className="squad-row-name">
                  <span className="squad-row-nick">{p.nickname}</span>
                  <span className="squad-row-role muted small">Natural: {p.role}</span>
                </span>
                <span className="squad-row-fit">
                  <span className="squad-row-stars">
                    {'★'.repeat(Math.round(stars))}
                    <span className="slot-stars-empty">{'★'.repeat(5 - Math.round(stars))}</span>
                  </span>
                  <span className={`squad-row-fam ${tierClass(tier)}`} title={`${tier} (${points} exp)`}>
                    {tierShort(tier)}
                  </span>
                </span>
                <span className="squad-row-ca muted small">CA {p.currentAbility}</span>
                {isAssigned && <span className="squad-row-tag">in lineup</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============ Match Plans tab — pre-match scouting allocation ============

function PlansTab({
  game,
  onSetPlan,
}: {
  game: GameState;
  onSetPlan: (opponentTeamId: string, patch: Partial<MatchPlan>) => void;
}) {
  // Find upcoming opponents from the schedule (next 8 scheduled or live user matches)
  const upcoming = game.schedule
    .filter(
      (m) =>
        (m.teamAId === game.userTeamId || m.teamBId === game.userTeamId) &&
        m.status !== 'finished',
    )
    .slice(0, 8);

  const userTeam = game.teams[game.userTeamId];
  const coachSkill = userTeam.coachSkill;
  // Max prep points scales lightly with coach skill (default 10 at coachSkill=10)
  const maxPoints = Math.round(10 + (coachSkill - 10) * 0.5);

  return (
    <div className="panel">
      <div className="panel-title">Match Plans — Pre-Match Scouting</div>
      <p className="muted small">
        Allocate prep points to specific situations. Your CT side reads better
        against prepped opponent buy types (Pistols / Defaults / Executes /
        Anti-Ecos). Coach skill <strong>{coachSkill}/20</strong> grants
        <strong> {maxPoints}</strong> total points per opponent. Each point = +1% CT round form on
        matching situations.
      </p>
      {upcoming.length === 0 && (
        <div className="muted small">No upcoming matches scheduled.</div>
      )}
      {upcoming.map((m) => {
        const oppId = m.teamAId === game.userTeamId ? m.teamBId : m.teamAId;
        const opp = game.teams[oppId];
        if (!opp) return null;
        const plan = game.tactics.matchPlans?.[oppId] ?? {
          pistols: 0,
          defaults: 0,
          executes: 0,
          antiEcos: 0,
        };
        const total = plan.pistols + plan.defaults + plan.executes + plan.antiEcos;
        const over = total > maxPoints;
        return (
          <div key={m.id} className="prep-row">
            <div className="prep-row-head">
              <div>
                <strong>{opp.name}</strong>
                <span className="muted small"> — {m.roundLabel} · {m.format} · {m.date}</span>
              </div>
              <div className={`prep-total ${over ? 'prep-over' : ''}`}>
                {total} / {maxPoints} pts
              </div>
            </div>
            <div className="prep-bars">
              {(['pistols', 'defaults', 'executes', 'antiEcos'] as const).map((key) => (
                <div key={key} className="prep-bar-row">
                  <span className="prep-label">
                    {key === 'antiEcos' ? 'Anti-Ecos' : key[0].toUpperCase() + key.slice(1)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    value={plan[key]}
                    onChange={(e) => onSetPlan(oppId, { [key]: Number(e.target.value) })}
                  />
                  <span className="prep-val">{plan[key]}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
