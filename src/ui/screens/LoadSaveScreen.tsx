import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { fmtDate } from '../util';
import { deleteSlot, importSlotRaw, readSlotRaw, renameSlot, listSlots } from '../../store/saveStorage';
import type { SaveSlotMeta } from '../../store/saveStorage';

export default function LoadSaveScreen({ onBack }: { onBack: () => void }) {
  const loadGame = useGame((s) => s.loadGame);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Always read fresh from storage (refreshKey forces re-read after mutations)
  const slots: SaveSlotMeta[] = (() => { void refreshKey; return listSlots(); })();

  function bump() { setRefreshKey((k) => k + 1); }

  function doLoad(slotId: string) {
    if (!loadGame(slotId)) {
      setError(`Save "${slotId}" could not be loaded.`);
      return;
    }
  }

  function doDelete(slotId: string) {
    deleteSlot(slotId);
    setConfirmingDeleteId(null);
    bump();
  }

  function commitRename(slotId: string) {
    if (renameValue.trim()) {
      renameSlot(slotId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
    bump();
  }

  function exportSave(slotId: string, name: string) {
    const raw = readSlotRaw(slotId);
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cs2manager-${(name).replace(/[^a-z0-9-_]/gi, '-')}-${slotId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importFromFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      // Use the file basename (without extension) as the proposed slot name
      const proposedName = file.name.replace(/\.json$/i, '').replace(/^cs2manager-/, '');
      const result = importSlotRaw(proposedName || 'Imported Save', String(reader.result));
      if (!result.ok) {
        setError(result.error ?? 'Import failed.');
      } else {
        setError(null);
        bump();
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="menu-screen">
      <div className="menu-bg" />
      <div className="menu-content" style={{ maxWidth: 720 }}>
        <div className="menu-brand">
          <span className="menu-brand-cs">CS2</span>
          <span className="menu-brand-mgr">MANAGER</span>
        </div>
        <div className="menu-tagline">Save Manager — {slots.length} save{slots.length === 1 ? '' : 's'}</div>

        <div className="menu-panel" style={{ width: '100%' }}>
          {slots.length === 0 && (
            <>
              <div className="menu-panel-title">No Saves Yet</div>
              <p className="menu-panel-note">
                You haven't started a career yet. Start a new one from the main menu, or import a save file below.
              </p>
            </>
          )}

          {slots.map((slot) => (
            <div key={slot.id} className="save-slot" style={{ marginBottom: 10 }}>
              <div className="save-slot-row">
                <span className="save-slot-tag">{slot.teamTag}</span>
                {renamingId === slot.id ? (
                  <input
                    className="input"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(slot.id);
                      if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                    }}
                    onBlur={() => commitRename(slot.id)}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <>
                    <span className="save-slot-team" style={{ flex: 1 }}>
                      <span style={{ fontSize: 14 }}>{slot.name}</span>
                      <span className="muted small" style={{ marginLeft: 8 }}>{slot.teamName}</span>
                    </span>
                    <button
                      className="menu-btn-back"
                      style={{ marginTop: 0 }}
                      title="Rename"
                      onClick={() => { setRenamingId(slot.id); setRenameValue(slot.name); }}
                    >
                      ✎
                    </button>
                  </>
                )}
                <span className="save-slot-rank">#{slot.worldRanking}</span>
              </div>
              <div className="save-slot-meta">
                <span>Date: <strong>{fmtDate(slot.currentDate)}</strong></span>
                <span>Season: <strong>{slot.seasonYear}</strong></span>
                <span>Matches: <strong>{slot.matchesPlayed}</strong></span>
                <span>Budget: <strong>${slot.budget.toLocaleString()}</strong></span>
                <span className="muted small">Saved: {new Date(slot.lastModified).toLocaleString()}</span>
                <span className="muted small">{(slot.bytes / 1024).toFixed(0)} KB</span>
              </div>
              <div className="save-actions" style={{ marginTop: 8 }}>
                <button className="menu-btn menu-btn-primary" onClick={() => doLoad(slot.id)}>
                  <span className="menu-btn-label">Load</span>
                </button>
                <button className="menu-btn" onClick={() => exportSave(slot.id, slot.name)}>
                  <span className="menu-btn-label">Export to File</span>
                  <span className="menu-btn-sub">Download as JSON backup</span>
                </button>
                {confirmingDeleteId === slot.id ? (
                  <div className="save-confirm">
                    <span>Delete <strong>{slot.name}</strong> permanently?</span>
                    <button className="menu-btn menu-btn-danger" onClick={() => doDelete(slot.id)}>
                      <span className="menu-btn-label">Yes, Delete</span>
                    </button>
                    <button className="menu-btn" onClick={() => setConfirmingDeleteId(null)}>
                      <span className="menu-btn-label">Cancel</span>
                    </button>
                  </div>
                ) : (
                  <button className="menu-btn menu-btn-danger" onClick={() => setConfirmingDeleteId(slot.id)}>
                    <span className="menu-btn-label">Delete</span>
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="save-actions" style={{ marginTop: 14 }}>
            <label className="menu-btn">
              <span className="menu-btn-label">Import a Save File</span>
              <span className="menu-btn-sub">Create a new slot from a JSON backup</span>
              <input
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && importFromFile(e.target.files[0])}
              />
            </label>
          </div>

          {error && <div className="menu-err">{error}</div>}
          <button className="menu-btn-back" onClick={onBack} style={{ marginTop: 14 }}>← Back</button>
        </div>
      </div>
    </div>
  );
}
