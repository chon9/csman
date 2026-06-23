// Sponsor inbox. Pending offers get Accept/Decline buttons; active deals
// quietly auto-credit every 30 days on the next refresh-state.

import { useEffect } from 'react';
import { useOnline } from '../onlineStore';

function daysAgo(ts: number): string {
  const d = Math.round((Date.now() - ts) / 86400000);
  return d === 0 ? 'today' : `${d}d ago`;
}

export default function SponsorsPanel() {
  const sponsors = useOnline((s) => s.sponsors);
  const list = useOnline((s) => s.listSponsors);
  const respond = useOnline((s) => s.respondSponsor);

  useEffect(() => { list(); }, [list]);

  if (sponsors.length === 0) return null;
  const pending = sponsors.filter((s) => s.status === 'pending');
  const active = sponsors.filter((s) => s.status === 'active');

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title">💼 Sponsors</div>

      {pending.length > 0 && (
        <>
          <div className="muted small">Pending offers:</div>
          {pending.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, background: 'var(--panel-2)', borderRadius: 4, borderLeft: '3px solid var(--accent)', marginTop: 6 }}>
              <div>
                <strong>{s.sponsorName}</strong>
                <div className="muted small">${s.monthlyAmount.toLocaleString()}/mo · auto-credits every 30 days while active</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-tiny btn-accent" onClick={() => respond(s.id, true)}>Accept</button>
                <button className="btn btn-tiny btn-danger" onClick={() => respond(s.id, false)}>Decline</button>
              </div>
            </div>
          ))}
        </>
      )}

      {active.length > 0 && (
        <>
          <div className="muted small" style={{ marginTop: 10 }}>Active deals:</div>
          <table className="table table-dense">
            <thead><tr><th>Sponsor</th><th className="num">Monthly</th><th>Last paid</th></tr></thead>
            <tbody>
              {active.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.sponsorName}</strong></td>
                  <td className="num">${s.monthlyAmount.toLocaleString()}</td>
                  <td className="muted small">{s.lastPaidAt ? daysAgo(s.lastPaidAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
