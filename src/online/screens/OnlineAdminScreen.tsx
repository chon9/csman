// Admin console — only reachable when the connecting nickname matches the
// server's CSM_ADMIN_NICK env var. The server gates every admin message; the
// UI is just a convenient front door so the box owner doesn't have to SSH in
// and poke SQLite for PIN resets, team rename, or cleanup.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import type { AdminUserRow } from '../protocol';
import type { Region } from '../../types';
import ToastStack from './ToastStack';

const REGIONS: Region[] = ['Europe', 'CIS', 'Americas', 'Asia'];

export default function OnlineAdminScreen() {
  const isAdmin = useOnline((s) => s.isAdmin);
  const users = useOnline((s) => s.adminUsers);
  const refresh = useOnline((s) => s.adminListUsers);
  const resetPin = useOnline((s) => s.adminResetPin);
  const editTeam = useOnline((s) => s.adminEditTeam);
  const adjustMoney = useOnline((s) => s.adminAdjustMoney);
  const deleteTeam = useOnline((s) => s.adminDeleteTeam);
  const go = useOnline((s) => s.go);

  const [query, setQuery] = useState('');
  // Modal state — only one open at a time.
  const [pinTarget, setPinTarget] = useState<AdminUserRow | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [editTarget, setEditTarget] = useState<AdminUserRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editRegion, setEditRegion] = useState<Region>('Europe');
  const [moneyTarget, setMoneyTarget] = useState<AdminUserRow | null>(null);
  const [moneyDelta, setMoneyDelta] = useState(10000);
  const [moneyNote, setMoneyNote] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.nickname.toLowerCase().includes(q) ||
        (u.teamTag ?? '').toLowerCase().includes(q) ||
        (u.teamName ?? '').toLowerCase().includes(q),
    );
  }, [users, query]);

  if (!isAdmin) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <div className="panel" style={{ padding: 14 }}>
          <div className="muted">This account is not an admin on this server.</div>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => go('home')}>← Back</button>
        </div>
      </div>
    );
  }

  function openEdit(row: AdminUserRow): void {
    setEditTarget(row);
    setEditName(row.teamName ?? '');
    setEditTag(row.teamTag ?? '');
    setEditRegion((row.region ?? 'Europe') as Region);
  }
  function submitEdit(): void {
    if (!editTarget?.teamId) return;
    editTeam(editTarget.teamId, { name: editName, tag: editTag, region: editRegion });
    setEditTarget(null);
  }
  function submitPin(): void {
    if (!pinTarget) return;
    if (!/^\d{4,8}$/.test(pinValue)) return;
    resetPin(pinTarget.nickname, pinValue);
    setPinTarget(null);
    setPinValue('');
  }
  function submitMoney(): void {
    if (!moneyTarget?.teamId) return;
    adjustMoney(moneyTarget.teamId, Math.round(moneyDelta), moneyNote || undefined);
    setMoneyTarget(null);
    setMoneyDelta(10000);
    setMoneyNote('');
  }
  function submitDelete(): void {
    if (!deleteTarget?.teamId) return;
    if (deleteConfirm.toUpperCase() !== (deleteTarget.teamTag ?? '').toUpperCase()) return;
    deleteTeam(deleteTarget.teamId);
    setDeleteTarget(null);
    setDeleteConfirm('');
  }

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Admin Console</h2>
          <div className="muted small">{users.length} registered owner{users.length === 1 ? '' : 's'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="Filter by nick or team…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <button className="btn" onClick={refresh}>Refresh</button>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table table-dense" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Nickname</th>
              <th>Team</th>
              <th>Region</th>
              <th className="num">Money</th>
              <th className="num">Roster</th>
              <th>Joined</th>
              <th style={{ width: 320 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="muted small" style={{ textAlign: 'center', padding: 18 }}>No owners match.</td></tr>
            ) : filtered.map((u) => (
              <tr key={u.nickname}>
                <td><strong>{u.nickname}</strong></td>
                <td>
                  {u.teamId ? (
                    <>
                      <span className="muted small">[{u.teamTag}]</span> {u.teamName}
                    </>
                  ) : (
                    <span className="muted small">no team</span>
                  )}
                </td>
                <td className="muted">{u.region ?? '—'}</td>
                <td className="num">{u.money !== null ? `$${u.money.toLocaleString()}` : '—'}</td>
                <td className="num">{u.rosterSize}</td>
                <td className="muted small">{new Date(u.createdAt).toISOString().slice(0, 10)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button className="btn btn-tiny" onClick={() => { setPinTarget(u); setPinValue(''); }}>
                      Reset PIN
                    </button>
                    {u.teamId && (
                      <>
                        <button className="btn btn-tiny" onClick={() => openEdit(u)}>Edit team</button>
                        <button className="btn btn-tiny" onClick={() => { setMoneyTarget(u); setMoneyDelta(10000); setMoneyNote(''); }}>
                          Money
                        </button>
                        <button className="btn btn-tiny btn-danger" onClick={() => { setDeleteTarget(u); setDeleteConfirm(''); }}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===== Reset PIN ===== */}
      {pinTarget && (
        <div className="modal-backdrop" onClick={() => setPinTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <h3>Reset PIN — {pinTarget.nickname}</h3>
              <button className="link-btn" onClick={() => setPinTarget(null)}>close ✕</button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span className="field-label">New PIN (4–8 digits)</span>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  value={pinValue}
                  maxLength={8}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
                />
                <span className="muted small">User can change it themselves once they log back in.</span>
              </label>
            </div>
            <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setPinTarget(null)}>Cancel</button>
              <button className="btn btn-accent" disabled={!/^\d{4,8}$/.test(pinValue)} onClick={submitPin}>
                Reset PIN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Edit team ===== */}
      {editTarget && (
        <div className="modal-backdrop" onClick={() => setEditTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <h3>Edit team — {editTarget.teamTag}</h3>
              <button className="link-btn" onClick={() => setEditTarget(null)}>close ✕</button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
              <label className="field">
                <span className="field-label">Team name</span>
                <input className="input" value={editName} maxLength={32} onChange={(e) => setEditName(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Tag (max 6, uppercased)</span>
                <input className="input" value={editTag} maxLength={6} onChange={(e) => setEditTag(e.target.value.toUpperCase())} />
              </label>
              <label className="field">
                <span className="field-label">Region</span>
                <select className="input" value={editRegion} onChange={(e) => setEditRegion(e.target.value as Region)}>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            </div>
            <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setEditTarget(null)}>Cancel</button>
              <button className="btn btn-accent" onClick={submitEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Adjust money ===== */}
      {moneyTarget && (
        <div className="modal-backdrop" onClick={() => setMoneyTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <h3>Adjust money — {moneyTarget.teamTag}</h3>
              <button className="link-btn" onClick={() => setMoneyTarget(null)}>close ✕</button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
              <div className="muted small">Current: <strong>${moneyTarget.money?.toLocaleString()}</strong></div>
              <label className="field">
                <span className="field-label">Delta (USD) — negative subtracts</span>
                <input
                  className="input"
                  type="number"
                  value={moneyDelta}
                  step={1000}
                  onChange={(e) => setMoneyDelta(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">Note (optional, logged on server)</span>
                <input className="input" value={moneyNote} onChange={(e) => setMoneyNote(e.target.value)} placeholder="e.g. bug compensation" />
              </label>
              <div className="muted small">
                Result: <strong>${Math.max(0, (moneyTarget.money ?? 0) + Math.round(moneyDelta)).toLocaleString()}</strong>
              </div>
            </div>
            <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setMoneyTarget(null)}>Cancel</button>
              <button className="btn btn-accent" onClick={submitMoney}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Delete team ===== */}
      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <h3>Delete team — {deleteTarget.teamTag}</h3>
              <button className="link-btn" onClick={() => setDeleteTarget(null)}>close ✕</button>
            </div>
            <div className="modal-body">
              <div className="muted small" style={{ marginBottom: 10 }}>
                This wipes the team, its players, listings, challenges, match history and achievements.
                Owner <strong>{deleteTarget.nickname}</strong> can keep their login and create a new team.
              </div>
              <label className="field">
                <span className="field-label">Type the team tag <strong>{deleteTarget.teamTag}</strong> to confirm</span>
                <input
                  className="input"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value.toUpperCase())}
                />
              </label>
            </div>
            <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                disabled={deleteConfirm.toUpperCase() !== (deleteTarget.teamTag ?? '').toUpperCase()}
                onClick={submitDelete}
              >
                Permanently delete
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastStack />
    </div>
  );
}
