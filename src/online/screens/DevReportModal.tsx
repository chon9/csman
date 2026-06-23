// Growth report — shown after a time-skip whenever at least one player's
// CA moved. Highlights gains in green, regressions in red. Closes either
// by clicking the backdrop or the "Got it" button.

import { useOnline } from '../onlineStore';

export default function DevReportModal() {
  const show = useOnline((s) => s.showDevReport);
  const changes = useOnline((s) => s.lastDevChanges);
  const dismiss = useOnline((s) => s.dismissDevReport);

  if (!show || changes.length === 0) return null;

  // Sort biggest movers first; positive deltas before negatives.
  const sorted = [...changes].sort((a, b) => {
    const da = a.caAfter - a.caBefore;
    const db = b.caAfter - b.caBefore;
    return Math.abs(db) - Math.abs(da);
  });

  const gainers = sorted.filter((c) => c.caAfter > c.caBefore);
  const dippers = sorted.filter((c) => c.caAfter < c.caBefore);

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3>📈 Growth Report</h3>
          <button className="link-btn" onClick={dismiss}>close ✕</button>
        </div>
        <div className="modal-body">
          <div className="muted small" style={{ marginBottom: 8 }}>
            {gainers.length} gain{gainers.length === 1 ? '' : 's'} ·{' '}
            {dippers.length} regression{dippers.length === 1 ? '' : 's'} across {changes.length} player{changes.length === 1 ? '' : 's'}.
          </div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">CA before</th>
                <th></th>
                <th className="num">CA after</th>
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const delta = c.caAfter - c.caBefore;
                const cls = delta > 0 ? 'text-win' : 'text-loss';
                return (
                  <tr key={c.playerId}>
                    <td><strong>{c.nickname}</strong></td>
                    <td className="num">{c.caBefore}</td>
                    <td className="muted">→</td>
                    <td className="num">{c.caAfter}</td>
                    <td className={`num ${cls}`} style={{ fontWeight: 700 }}>
                      {delta > 0 ? '+' : ''}{delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-accent" onClick={dismiss}>Got it</button>
        </div>
      </div>
    </div>
  );
}
