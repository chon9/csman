// Tactics + lineup picker for online mode. Local edits are pushed to the
// server only on "Save" — server validates + clamps + persists. The saved
// Tactics object is merged on top of DEFAULT_TACTICS engine-side, so you
// only ship the fields you actually want to override.

import { useEffect, useMemo, useState } from 'react';
import type { CTSidePlaystyle, MapName, Tactics, TSidePlaystyle } from '../../types';
import { ALL_MAPS, DEFAULT_TACTICS } from '../../types';
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

      {/* ===== Lineup ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Lineup <span className="muted small">— first 5 start every duel</span></div>
        <table className="table table-dense">
          <thead>
            <tr>
              <th></th>
              <th>Player</th>
              <th>Role</th>
              <th>Nat</th>
              <th>Age</th>
              <th className="num">CA</th>
              <th className="num">PA</th>
              <th>Slot</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {order.map((id, idx) => {
              const p = players[id];
              if (!p) return null;
              const isStarter = idx < 5;
              return (
                <tr key={id} style={{ background: isStarter ? 'rgba(76, 175, 125, 0.06)' : undefined }}>
                  <td className="muted small">{isStarter ? '★' : ''}</td>
                  <td><strong>{p.nickname}</strong></td>
                  <td>{p.role}</td>
                  <td className="muted">{p.nationality}</td>
                  <td>{p.age}</td>
                  <td className="num">{p.currentAbility}</td>
                  <td className="num">{p.potentialAbility}</td>
                  <td className="muted small">{isStarter ? `#${idx + 1} starter` : 'bench'}</td>
                  <td>
                    <button className="btn btn-tiny" disabled={idx === 0} onClick={() => move(idx, -1)}>↑</button>{' '}
                    <button className="btn btn-tiny" disabled={idx === order.length - 1} onClick={() => move(idx, 1)}>↓</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
