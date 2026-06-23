// Online case-opening screen — port of the single-player CasesScreen,
// minus trade-ups and souvenirs (initial release). Server rolls the skin
// and returns the strip; client just plays the cubic-bezier scroll.
// Sold skins credit team.money directly — no separate manager stash.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from '../onlineStore';
import { RARITY_COLOR, RARITY_LABEL } from '../../sim/caseOpening';
import type { SkinInstanceWire, SkinStripEntry } from '../protocol';
import ToastStack from './ToastStack';

const TILE_WIDTH = 120;
const VIEWPORT_WIDTH = 760;
const ANIM_MS = 5500;

export default function OnlineCasesScreen() {
  const team = useOnline((s) => s.team);
  const cases = useOnline((s) => s.cases);
  const freeCaseId = useOnline((s) => s.freeCaseId);
  const freeCaseAvailable = useOnline((s) => s.freeCaseAvailable);
  const skins = useOnline((s) => s.skins);
  const caseOpening = useOnline((s) => s.caseOpening);
  const listCases = useOnline((s) => s.listCases);
  const listSkins = useOnline((s) => s.listSkins);
  const openCase = useOnline((s) => s.openCase);
  const openFreeCase = useOnline((s) => s.openFreeCase);
  const sellSkin = useOnline((s) => s.sellSkin);
  const dismissCaseOpening = useOnline((s) => s.dismissCaseOpening);
  const go = useOnline((s) => s.go);

  useEffect(() => {
    listCases();
    listSkins();
  }, [listCases, listSkins]);

  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  useEffect(() => {
    if (cases.length > 0 && !selectedCaseId) setSelectedCaseId(cases[0].id);
  }, [cases, selectedCaseId]);
  const selectedCase = cases.find((c) => c.id === selectedCaseId);

  // Hide the freshly rolled skin from the inventory while the reel spins —
  // otherwise it spoilers into the table before the animation lands.
  const [reveal, setReveal] = useState(false);
  const inventory = useMemo(() => {
    if (caseOpening && !reveal) {
      return skins.filter((s) => s.id !== caseOpening.instance.id);
    }
    return skins;
  }, [skins, caseOpening, reveal]);

  if (!team) return null;
  const canAffordSelected = selectedCase ? team.money >= selectedCase.keyPrice : false;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Cases</h2>
          <div className="muted small">
            Open cases, sell skins, fund your team. Daily free case from the {cases.find((c) => c.id === freeCaseId)?.name ?? 'starter'} pool.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="muted small">Cash: <strong>${team.money.toLocaleString()}</strong></span>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      {/* ===== Case picker ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Choose a case</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 8 }}>
          {cases.map((c) => {
            const isSel = c.id === selectedCaseId;
            return (
              <button
                key={c.id}
                className={`panel case-card ${isSel ? 'case-card-active' : ''}`}
                onClick={() => setSelectedCaseId(c.id)}
                style={{
                  padding: 12,
                  border: isSel ? `2px solid ${c.accent ?? '#de9b35'}` : '1px solid rgba(255,255,255,0.08)',
                  background: isSel ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <strong style={{ color: c.accent ?? '#de9b35' }}>{c.name}</strong>
                <div className="muted small">{c.skinCount} skins · ${c.keyPrice.toLocaleString()} key</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            className="btn btn-accent"
            disabled={!selectedCase || !canAffordSelected || !!caseOpening}
            onClick={() => selectedCase && openCase(selectedCase.id)}
            title={!canAffordSelected ? 'Insufficient funds' : ''}
          >
            Open {selectedCase?.name ?? 'case'} · ${selectedCase?.keyPrice.toLocaleString() ?? '—'}
          </button>
          <button
            className="btn"
            disabled={!freeCaseAvailable || !!caseOpening}
            onClick={openFreeCase}
            title={freeCaseAvailable ? '' : 'Already claimed today — back at 00:00 UTC'}
          >
            🎁 Free daily case {freeCaseAvailable ? '· available' : '· claimed'}
          </button>
        </div>
      </div>

      {/* ===== Inventory ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">
          Inventory <span className="muted small">{inventory.length} skin{inventory.length === 1 ? '' : 's'}</span>
        </div>
        {inventory.length === 0 ? (
          <div className="muted small">No skins yet — open a case to drop your first.</div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Weapon</th>
                <th>Skin</th>
                <th>Rarity</th>
                <th>Wear</th>
                <th>StatTrak</th>
                <th className="num">Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.weapon}</strong></td>
                  <td>{s.name}</td>
                  <td style={{ color: RARITY_COLOR[s.rarity] }}>{RARITY_LABEL[s.rarity]}</td>
                  <td className="muted">{s.wear}</td>
                  <td>{s.statTrak ? <span style={{ color: '#ff8a00' }}>StatTrak™</span> : <span className="muted">—</span>}</td>
                  <td className="num">${s.marketValue.toLocaleString()}</td>
                  <td>
                    <button className="btn btn-tiny" onClick={() => sellSkin(s.id)}>Sell</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {caseOpening && (
        <CaseOpenModal
          strip={caseOpening.strip}
          winnerIndex={caseOpening.winnerIndex}
          instance={caseOpening.instance}
          onReveal={() => setReveal(true)}
          onClose={() => { setReveal(false); dismissCaseOpening(); }}
        />
      )}

      <ToastStack />
    </div>
  );
}

interface CaseOpenModalProps {
  strip: SkinStripEntry[];
  winnerIndex: number;
  instance: SkinInstanceWire;
  onReveal: () => void;
  onClose: () => void;
}

function CaseOpenModal({ strip, winnerIndex, instance, onReveal, onClose }: CaseOpenModalProps): React.ReactElement {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = 'translateX(0)';
    void el.offsetWidth;
    const jitter = (Math.random() - 0.5) * (TILE_WIDTH * 0.45);
    const target = winnerIndex * TILE_WIDTH - (VIEWPORT_WIDTH / 2 - TILE_WIDTH / 2) + jitter;
    el.style.transition = `transform ${ANIM_MS}ms cubic-bezier(0.05, 0.65, 0.15, 1)`;
    el.style.transform = `translateX(-${target}px)`;

    const revealTimer = window.setTimeout(() => {
      setRevealed(true);
      onReveal();
    }, ANIM_MS + 200);
    return () => window.clearTimeout(revealTimer);
  }, [winnerIndex, onReveal]);

  return (
    <div className="modal-backdrop" onClick={revealed ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820, padding: 16 }}>
        <div className="modal-head" style={{ marginBottom: 10 }}>
          <h3>{revealed ? 'Unboxed!' : 'Opening…'}</h3>
          {revealed && <button className="link-btn" onClick={onClose}>close ✕</button>}
        </div>

        <div
          style={{
            width: VIEWPORT_WIDTH,
            maxWidth: '100%',
            overflow: 'hidden',
            position: 'relative',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            margin: '0 auto',
          }}
        >
          {/* Centre pointer */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 2,
              background: 'var(--accent, #de9b35)',
              transform: 'translateX(-50%)',
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
          <div
            ref={stripRef}
            style={{
              display: 'flex',
              willChange: 'transform',
            }}
          >
            {strip.map((s, i) => (
              <div
                key={i}
                style={{
                  width: TILE_WIDTH,
                  flex: '0 0 auto',
                  padding: 8,
                  boxSizing: 'border-box',
                  borderRight: '1px solid rgba(255,255,255,0.05)',
                  borderLeft: `3px solid ${RARITY_COLOR[s.rarity]}`,
                  fontSize: 11,
                  textAlign: 'center',
                  height: 120,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <div style={{ fontWeight: 600 }}>{s.weapon}</div>
                <div className="muted">{s.name}</div>
              </div>
            ))}
          </div>
        </div>

        {revealed && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 8,
              border: `2px solid ${RARITY_COLOR[instance.rarity]}`,
              background: 'rgba(255,255,255,0.03)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 12, color: RARITY_COLOR[instance.rarity], marginBottom: 4 }}>
              {RARITY_LABEL[instance.rarity]}{instance.statTrak ? ' · StatTrak™' : ''}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{instance.weapon}</div>
            <div className="muted">{instance.name}</div>
            <div className="muted small" style={{ marginTop: 6 }}>{instance.wear}</div>
            <div style={{ marginTop: 8, fontSize: 16, color: '#9be29b' }}>
              ${instance.marketValue.toLocaleString()}
            </div>
            <button className="btn btn-accent" onClick={onClose} style={{ marginTop: 12 }}>
              Add to inventory
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
