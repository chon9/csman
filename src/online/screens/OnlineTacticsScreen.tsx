// Tactics + lineup picker for online mode. Local edits are pushed to the
// server only on "Save" — server validates + clamps + persists. The saved
// Tactics object is merged on top of DEFAULT_TACTICS engine-side, so you
// only ship the fields you actually want to override.

import { useEffect, useMemo, useState } from 'react';
import type {
  CTSidePlaystyle, CtArchetype, MapName, Tactics,
  TSidePlaystyle, TStratArchetype,
} from '../../types';
import { ALL_MAPS, DEFAULT_TACTICS } from '../../types';
import {
  CT_ARCHETYPES, CT_ARCHETYPE_BLURB, CT_ARCHETYPE_LABEL,
  T_ARCHETYPES, T_ARCHETYPE_BLURB, T_ARCHETYPE_LABEL,
  inferArchetypesFromRoster, matchupBonusPct,
} from '../../engine/tacticalMatchup';
import { useOnline } from '../onlineStore';
import ToastStack from './ToastStack';

type SliderKey = 'aggression' | 'utilityUsage' | 'midRoundFlexibility' | 'ecoDiscipline' | 'forceBuyTendency';
const SLIDER_LABELS: Record<SliderKey, { label: string; hint: string }> = {
  aggression: { label: 'Aggression', hint: 'High = fights more, less anchoring' },
  utilityUsage: { label: 'Utility Usage', hint: 'High = more nades per execute' },
  midRoundFlexibility: { label: 'Mid-round Adapt', hint: 'High = IGL adapts more on the fly' },
  ecoDiscipline: { label: 'Eco Discipline', hint: 'High = strict force-buy rules' },
  forceBuyTendency: { label: 'Force-Buy', hint: 'High = more force buys vs save rounds' },
};

const T_STYLES: { id: TSidePlaystyle; label: string; hint: string }[] = [
  { id: 'default', label: 'Default', hint: 'Balanced strats and timings' },
  { id: 'explosive', label: 'Explosive', hint: 'Fast hits, opening picks, high tempo' },
  { id: 'slow-default', label: 'Slow Default', hint: 'Map control, late executes' },
  { id: 'mixed', label: 'Mixed', hint: 'Switches gears between fast / slow' },
];

const CT_STYLES: { id: CTSidePlaystyle; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard', hint: 'Stable setups + map presence' },
  { id: 'aggressive-info', label: 'Aggressive Info', hint: 'Early peeks, kill-feed plays' },
  { id: 'passive-retake', label: 'Passive Retake', hint: 'Save util for retakes' },
  { id: 'stacked-gambles', label: 'Stacked Gambles', hint: 'Heavy site stacks, reads-based' },
];

export default function OnlineTacticsScreen() {
  const team = useOnline((s) => s.team);
  const players = useOnline((s) => s.players);
  const setTactics = useOnline((s) => s.setTactics);
  const reorderLineup = useOnline((s) => s.reorderLineup);
  const presets = useOnline((s) => s.tacticsPresets);
  const listPresets = useOnline((s) => s.listTacticsPresets);
  const savePreset = useOnline((s) => s.saveTacticsPreset);
  const applyPreset = useOnline((s) => s.applyTacticsPreset);
  const deletePreset = useOnline((s) => s.deleteTacticsPreset);
  const go = useOnline((s) => s.go);

  // Local draft state — merged on top of DEFAULT_TACTICS so unsaved fields
  // still preview correctly while editing.
  const merged: Tactics = useMemo(
    () => ({ ...DEFAULT_TACTICS, ...(team?.tactics ?? {}) }),
    [team?.tactics],
  );
  const [draft, setDraft] = useState<Tactics>(merged);
  useEffect(() => setDraft(merged), [merged]);

  // Local lineup state for drag-style reordering via Up/Down buttons.
  const [order, setOrder] = useState<string[]>(team?.playerIds ?? []);
  useEffect(() => setOrder(team?.playerIds ?? []), [team?.playerIds]);

  // ---- Lineup drag-and-drop state ----
  // dragId = the player id currently being dragged; dropAtIdx = the index the
  // dragged row would land at if dropped now (between rows visually). Both
  // null when nothing's being dragged.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAtIdx, setDropAtIdx] = useState<number | null>(null);
  function handleDragStart(e: React.DragEvent, id: string): void {
    setDragId(id);
    // Required for Firefox to actually start a drag.
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
  function handleDragOver(e: React.DragEvent, overIdx: number): void {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Drop ABOVE if cursor in top half of row, BELOW if bottom half. Maps to
    // an insertion index in [0..order.length].
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    setDropAtIdx(above ? overIdx : overIdx + 1);
  }
  function handleDrop(e: React.DragEvent): void {
    e.preventDefault();
    if (!dragId || dropAtIdx === null) { clearDrag(); return; }
    setOrder((arr) => {
      const fromIdx = arr.indexOf(dragId);
      if (fromIdx === -1) return arr;
      const next = [...arr];
      next.splice(fromIdx, 1);
      // Account for the index shift when the source is above the drop target.
      const insertAt = fromIdx < dropAtIdx ? dropAtIdx - 1 : dropAtIdx;
      next.splice(insertAt, 0, dragId);
      return next;
    });
    clearDrag();
  }
  function clearDrag(): void {
    setDragId(null);
    setDropAtIdx(null);
  }

  // Presets — refresh once on mount.
  useEffect(() => { listPresets(); }, [listPresets]);
  const [newPresetName, setNewPresetName] = useState('');

  if (!team) return null;

  const sliderUpdate = (key: SliderKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft((d) => ({ ...d, [key]: Number(e.target.value) }));
  };

  const move = (idx: number, dir: -1 | 1) => {
    setOrder((arr) => {
      const next = [...arr];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return next;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  function saveTactics(): void {
    // Ship a sparse object — only the fields the user can edit here.
    const sparse: Partial<Tactics> = {
      tPlaystyle: draft.tPlaystyle,
      ctPlaystyle: draft.ctPlaystyle,
      tArchetype: draft.tArchetype,
      ctArchetype: draft.ctArchetype,
      aggression: draft.aggression,
      utilityUsage: draft.utilityUsage,
      midRoundFlexibility: draft.midRoundFlexibility,
      ecoDiscipline: draft.ecoDiscipline,
      forceBuyTendency: draft.forceBuyTendency,
      mapVetoPriority: draft.mapVetoPriority,
      mapOverrides: draft.mapOverrides,
    };
    setTactics(sparse);
  }

  function moveVeto(idx: number, dir: -1 | 1): void {
    const list = [...(draft.mapVetoPriority ?? ALL_MAPS)];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    setDraft((d) => ({ ...d, mapVetoPriority: list }));
  }

  function setOverride(map: MapName, field: 'tPlaystyle' | 'ctPlaystyle' | 'aggression', value: string | number): void {
    setDraft((d) => {
      const next: Tactics = { ...d };
      const overrides = { ...(next.mapOverrides ?? {}) };
      const entry = { ...(overrides[map] ?? {}) };
      // Type-narrow via field.
      if (field === 'aggression' && typeof value === 'number') entry.aggression = value;
      else if (field === 'tPlaystyle') entry.tPlaystyle = value as TSidePlaystyle;
      else if (field === 'ctPlaystyle') entry.ctPlaystyle = value as CTSidePlaystyle;
      overrides[map] = entry;
      next.mapOverrides = overrides;
      return next;
    });
  }

  function clearOverride(map: MapName): void {
    setDraft((d) => {
      const next = { ...d };
      const overrides = { ...(next.mapOverrides ?? {}) };
      delete overrides[map];
      next.mapOverrides = overrides;
      return next;
    });
  }

  function saveLineup(): void {
    reorderLineup(order);
  }

  const tacticsDirty = JSON.stringify(draft) !== JSON.stringify(merged);
  const lineupDirty = JSON.stringify(order) !== JSON.stringify(team.playerIds);

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Tactics &amp; Lineup</h2>
          <div className="muted small">
            Your saved tactics feed straight into the match engine on every duel.
            Lineup order: first 5 are the starters, rest are bench.
          </div>
        </div>
        <button className="btn" onClick={() => go('home')}>← Back</button>
      </div>

      {/* ===== Tactical Archetypes (FM-style matchup rock-paper-scissors) ===== */}
      <ArchetypePanel
        players={Object.values(players)}
        starterIds={team.playerIds.slice(0, 5)}
        tArchetype={draft.tArchetype}
        ctArchetype={draft.ctArchetype}
        onPickT={(t) => setDraft((d) => ({ ...d, tArchetype: t }))}
        onPickCt={(ct) => setDraft((d) => ({ ...d, ctArchetype: ct }))}
      />

      {/* ===== Playstyles ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">T-side Playstyle</div>
        <div className="focus-cards">
          {T_STYLES.map((s) => (
            <button
              key={s.id}
              className={`focus-card ${draft.tPlaystyle === s.id ? 'selected' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, tPlaystyle: s.id }))}
            >
              <div className="focus-card-label">{s.label}</div>
              <div className="focus-card-desc">{s.hint}</div>
            </button>
          ))}
        </div>
        <div className="panel-title" style={{ marginTop: 14 }}>CT-side Playstyle</div>
        <div className="focus-cards">
          {CT_STYLES.map((s) => (
            <button
              key={s.id}
              className={`focus-card ${draft.ctPlaystyle === s.id ? 'selected' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, ctPlaystyle: s.id }))}
            >
              <div className="focus-card-label">{s.label}</div>
              <div className="focus-card-desc">{s.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ===== Tactics presets ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Presets <span className="muted small">— save / load tactics builds, max 10 per nickname</span></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <input
            className="input"
            type="text"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value.slice(0, 32))}
            placeholder="Preset name (e.g. anti-explosive)"
            style={{ flex: 1, minWidth: 160 }}
          />
          <button
            className="btn btn-accent"
            disabled={!newPresetName.trim() || tacticsDirty}
            title={tacticsDirty ? 'Save current tactics first, then save as preset' : ''}
            onClick={() => { savePreset(newPresetName.trim()); setNewPresetName(''); }}
          >
            Save Current as Preset
          </button>
        </div>
        {presets.length === 0 ? (
          <div className="muted small" style={{ marginTop: 8 }}>No presets yet — save your favourite build to load instantly later.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {presets.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, background: 'var(--panel-2)', borderRadius: 4 }}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted small">
                    {p.tactics.tPlaystyle ?? '—'} T · {p.tactics.ctPlaystyle ?? '—'} CT · agg {p.tactics.aggression ?? '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-tiny btn-accent" onClick={() => applyPreset(p.id)}>Apply</button>
                  <button className="btn btn-tiny btn-danger" onClick={() => deletePreset(p.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Sliders ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Style Sliders <span className="muted small">— 1 to 20</span></div>
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          {(Object.keys(SLIDER_LABELS) as SliderKey[]).map((k) => (
            <label key={k} className="field">
              <span className="field-label">
                {SLIDER_LABELS[k].label} <strong>{draft[k]}</strong> <span className="muted small">· {SLIDER_LABELS[k].hint}</span>
              </span>
              <input type="range" min={1} max={20} value={draft[k]} onChange={sliderUpdate(k)} />
            </label>
          ))}
        </div>
        <button
          className="btn btn-accent"
          disabled={!tacticsDirty}
          style={{ marginTop: 12 }}
          onClick={saveTactics}
        >
          {tacticsDirty ? 'Save Tactics' : 'Tactics Saved'}
        </button>
      </div>

      {/* ===== Map veto order ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Map Veto Order <span className="muted small">— top = most-wanted to play</span></div>
        <p className="muted small" style={{ marginTop: 2 }}>
          Engine vetoes from both teams' priority lists when picking maps for BO3/BO5 duels.
          Drag your strongest maps to the top and your worst to the bottom.
        </p>
        <table className="table table-dense">
          <thead>
            <tr><th>#</th><th>Map</th><th>Override</th><th></th></tr>
          </thead>
          <tbody>
            {(draft.mapVetoPriority ?? ALL_MAPS).map((map, idx) => {
              const o = draft.mapOverrides?.[map];
              const hasOverride = o && (o.tPlaystyle !== undefined || o.ctPlaystyle !== undefined || o.aggression !== undefined);
              return (
                <tr key={map}>
                  <td className="muted small">{idx + 1}</td>
                  <td><strong>{map}</strong></td>
                  <td>{hasOverride ? <span className="text-win">customised</span> : <span className="muted small">global</span>}</td>
                  <td>
                    <button className="btn btn-tiny" disabled={idx === 0} onClick={() => moveVeto(idx, -1)}>↑</button>{' '}
                    <button className="btn btn-tiny" disabled={idx === ALL_MAPS.length - 1} onClick={() => moveVeto(idx, 1)}>↓</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ===== Per-map overrides ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Per-Map Overrides <span className="muted small">— sparse: only set what you want different</span></div>
        <p className="muted small" style={{ marginTop: 2 }}>
          Defaults inherit from the global tactics above. Override aggression / playstyle on a per-map basis
          (e.g. ultra-passive CT on Nuke, full-tempo T on Dust2).
        </p>
        {ALL_MAPS.map((map) => {
          const o = draft.mapOverrides?.[map] ?? {};
          const hasAny = o.tPlaystyle !== undefined || o.ctPlaystyle !== undefined || o.aggression !== undefined;
          return (
            <details key={map} style={{ marginTop: 6, padding: 8, background: 'var(--panel-2)', borderRadius: 4 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                {map} {hasAny && <span className="text-win">·</span>}
              </summary>
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                <label className="field">
                  <span className="field-label">T-side</span>
                  <select
                    className="input"
                    value={o.tPlaystyle ?? ''}
                    onChange={(e) => setOverride(map, 'tPlaystyle', e.target.value || '')}
                  >
                    <option value="">— inherit ({draft.tPlaystyle}) —</option>
                    {T_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">CT-side</span>
                  <select
                    className="input"
                    value={o.ctPlaystyle ?? ''}
                    onChange={(e) => setOverride(map, 'ctPlaystyle', e.target.value || '')}
                  >
                    <option value="">— inherit ({draft.ctPlaystyle}) —</option>
                    {CT_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">
                    Aggression {o.aggression ?? <span className="muted">(inherit {draft.aggression})</span>}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={o.aggression ?? draft.aggression}
                    onChange={(e) => setOverride(map, 'aggression', Number(e.target.value))}
                  />
                </label>
                {hasAny && (
                  <button className="btn btn-tiny btn-danger" style={{ alignSelf: 'flex-start' }} onClick={() => clearOverride(map)}>
                    Clear override
                  </button>
                )}
              </div>
            </details>
          );
        })}
      </div>

      {/* ===== Lineup (drag-and-drop) ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">
          Lineup
          <span className="muted small"> — drag rows to reorder · top 5 start every duel</span>
        </div>
        <div
          className="lineup-list"
          onDragOver={(e) => { if (dragId) e.preventDefault(); }}
          onDrop={handleDrop}
        >
          {order.map((id, idx) => {
            const p = players[id];
            if (!p) return null;
            const isStarter = idx < 5;
            const isDragging = id === dragId;
            const showDropAbove = dropAtIdx === idx && dragId !== null;
            const showDropBelow = dropAtIdx === idx + 1 && idx === order.length - 1 && dragId !== null;
            // Insert a "BENCH" divider above row 5 (the first bench player)
            // when nothing's being dragged — avoids drop-zone confusion.
            const showBenchDivider = idx === 5 && dragId === null;
            return (
              <div key={id}>
                {showBenchDivider && <div className="lineup-divider">— Bench —</div>}
                {showDropAbove && <div className="lineup-drop-line" />}
                <div
                  className={`lineup-row ${isStarter ? 'lineup-row-starter' : 'lineup-row-bench'} ${isDragging ? 'lineup-row-dragging' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, id)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={clearDrag}
                  onDrop={handleDrop}
                >
                  <div className="lineup-handle" title="Drag to reorder">⠿</div>
                  <div className="lineup-slot">
                    {isStarter ? <span className="lineup-slot-num">#{idx + 1}</span> : <span className="muted small">bench</span>}
                  </div>
                  <div className="lineup-main">
                    <strong>{p.nickname}</strong>
                    <span className="muted small" style={{ marginLeft: 6 }}>{p.role} · {p.nationality} · age {p.age}</span>
                  </div>
                  <div className="lineup-stats">
                    <span className="lineup-stat" title="Current Ability"><span className="muted small">CA</span> {p.currentAbility}</span>
                    <span className="lineup-stat" title="Potential Ability"><span className="muted small">PA</span> {p.potentialAbility}</span>
                  </div>
                  <div className="lineup-arrows">
                    <button className="btn btn-tiny" disabled={idx === 0} onClick={() => move(idx, -1)} title="Move up">↑</button>
                    <button className="btn btn-tiny" disabled={idx === order.length - 1} onClick={() => move(idx, 1)} title="Move down">↓</button>
                  </div>
                </div>
                {showDropBelow && <div className="lineup-drop-line" />}
              </div>
            );
          })}
        </div>
        <button
          className="btn btn-accent"
          disabled={!lineupDirty}
          style={{ marginTop: 12 }}
          onClick={saveLineup}
        >
          {lineupDirty ? 'Save Lineup' : 'Lineup Saved'}
        </button>
      </div>

      <ToastStack />
    </div>
  );
}

// =====================================================================
// Tactical Archetype Panel — FM-style matchup rock-paper-scissors
// =====================================================================
//
// Two pickers (T archetype × CT archetype) with:
//   - A row of five cards per side (Fast Rush, Slow Default, ...)
//   - A "Roster tendency" hint showing what your five would default to
//   - A live matchup heatmap for the picked T archetype against every
//     possible opponent CT archetype (so you can immediately see when
//     your pick is a good match / bad match)
//
// The user's choice is written to draft.tArchetype / draft.ctArchetype;
// leaving them undefined falls back to roster inference at match time.

function ArchetypePanel({
  players, starterIds, tArchetype, ctArchetype, onPickT, onPickCt,
}: {
  players: import('../../types').Player[];
  starterIds: string[];
  tArchetype: TStratArchetype | undefined;
  ctArchetype: CtArchetype | undefined;
  onPickT: (t: TStratArchetype | undefined) => void;
  onPickCt: (ct: CtArchetype | undefined) => void;
}): React.ReactElement {
  // Roster tendency — what the engine would infer if you set nothing.
  const starters = useMemo(
    () => starterIds
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is import('../../types').Player => !!p),
    [players, starterIds],
  );
  const inferred = useMemo(() => inferArchetypesFromRoster(starters), [starters]);

  const effectiveT = tArchetype ?? inferred.t;
  const effectiveCt = ctArchetype ?? inferred.ct;

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span>Tactical Archetype <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>— the meta-call your team leans on. Applies a matchup bonus vs the opponent's archetype every round.</span></span>
        <span className="pill">
          Roster tendency: <strong style={{ color: 'var(--accent-hi)' }}>{T_ARCHETYPE_LABEL[inferred.t]} · {CT_ARCHETYPE_LABEL[inferred.ct]}</strong>
        </span>
      </div>

      {/* T-side pickers */}
      <div className="section-title" style={{ margin: '10px 0 6px' }}>T-side archetype</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        {T_ARCHETYPES.map((t) => {
          const isPicked = tArchetype === t;
          const isEffective = effectiveT === t;
          return (
            <button
              key={t}
              onClick={() => onPickT(isPicked ? undefined : t)}
              style={{
                textAlign: 'left', padding: 10, cursor: 'pointer', border: 'none',
                background: isPicked ? 'var(--accent-soft)' : (isEffective ? 'var(--bg-elev)' : 'var(--panel-2)'),
                borderRadius: 'var(--radius-sm)',
                borderLeft: isPicked ? '3px solid var(--accent)' : isEffective ? '3px solid var(--text-faint)' : '3px solid transparent',
                color: 'var(--text)', fontFamily: 'inherit',
                transition: 'background var(--motion-fast), border-color var(--motion-fast)',
              }}
              title={T_ARCHETYPE_BLURB[t]}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>{T_ARCHETYPE_LABEL[t]}</strong>
                {isPicked && <span className="pill pill-accent" style={{ padding: '1px 6px', fontSize: 10 }}>picked</span>}
                {!isPicked && isEffective && <span className="pill" style={{ padding: '1px 6px', fontSize: 10 }}>roster</span>}
              </div>
              <div className="muted small" style={{ marginTop: 4, fontSize: 11, lineHeight: 1.4 }}>{T_ARCHETYPE_BLURB[t]}</div>
            </button>
          );
        })}
      </div>

      {/* CT-side pickers */}
      <div className="section-title" style={{ margin: '14px 0 6px' }}>CT-side archetype</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        {CT_ARCHETYPES.map((ct) => {
          const isPicked = ctArchetype === ct;
          const isEffective = effectiveCt === ct;
          return (
            <button
              key={ct}
              onClick={() => onPickCt(isPicked ? undefined : ct)}
              style={{
                textAlign: 'left', padding: 10, cursor: 'pointer', border: 'none',
                background: isPicked ? 'var(--accent-soft)' : (isEffective ? 'var(--bg-elev)' : 'var(--panel-2)'),
                borderRadius: 'var(--radius-sm)',
                borderLeft: isPicked ? '3px solid var(--accent)' : isEffective ? '3px solid var(--text-faint)' : '3px solid transparent',
                color: 'var(--text)', fontFamily: 'inherit',
                transition: 'background var(--motion-fast), border-color var(--motion-fast)',
              }}
              title={CT_ARCHETYPE_BLURB[ct]}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>{CT_ARCHETYPE_LABEL[ct]}</strong>
                {isPicked && <span className="pill pill-accent" style={{ padding: '1px 6px', fontSize: 10 }}>picked</span>}
                {!isPicked && isEffective && <span className="pill" style={{ padding: '1px 6px', fontSize: 10 }}>roster</span>}
              </div>
              <div className="muted small" style={{ marginTop: 4, fontSize: 11, lineHeight: 1.4 }}>{CT_ARCHETYPE_BLURB[ct]}</div>
            </button>
          );
        })}
      </div>

      {/* Live matchup preview — for the effective T archetype, show your
       *  advantage vs every possible opponent CT archetype. Users can eyeball
       *  which opponents this call is favoured / punished by. */}
      <div className="section-title" style={{ margin: '14px 0 6px' }}>
        Matchup preview
        <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, marginLeft: 8 }}>
          — your <strong style={{ color: 'var(--accent-hi)' }}>{T_ARCHETYPE_LABEL[effectiveT]}</strong> (T) and <strong style={{ color: 'var(--accent-hi)' }}>{CT_ARCHETYPE_LABEL[effectiveCt]}</strong> (CT) vs every opponent archetype
        </span>
      </div>
      <MatchupPreview t={effectiveT} ct={effectiveCt} />
    </div>
  );
}

function MatchupPreview({ t, ct }: { t: TStratArchetype; ct: CtArchetype }): React.ReactElement {
  const colorFor = (pct: number): string => {
    if (pct >= 6) return 'var(--win)';
    if (pct >= 3) return 'rgba(76,175,125,0.6)';
    if (pct <= -6) return 'var(--loss)';
    if (pct <= -3) return 'rgba(226,85,85,0.6)';
    return 'var(--text-dim)';
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <div className="muted small" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Your T vs opponent's CT
        </div>
        {CT_ARCHETYPES.map((oppCt) => {
          const pct = matchupBonusPct(t, oppCt);
          return (
            <div key={oppCt} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid var(--border-soft)' }}>
              <span>{CT_ARCHETYPE_LABEL[oppCt]}</span>
              <strong style={{ color: colorFor(pct), fontVariantNumeric: 'tabular-nums' }}>
                {pct > 0 ? `+${pct}%` : `${pct}%`}
              </strong>
            </div>
          );
        })}
      </div>
      <div>
        <div className="muted small" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Your CT vs opponent's T
        </div>
        {T_ARCHETYPES.map((oppT) => {
          // From the CT team's perspective, matchupBonusPct is negated.
          const pct = -matchupBonusPct(oppT, ct);
          return (
            <div key={oppT} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid var(--border-soft)' }}>
              <span>{T_ARCHETYPE_LABEL[oppT]}</span>
              <strong style={{ color: colorFor(pct), fontVariantNumeric: 'tabular-nums' }}>
                {pct > 0 ? `+${pct}%` : `${pct}%`}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
