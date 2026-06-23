// Loan-offer inbox + outbox. Auto-refreshes on mount; live updates flow in
// via `loan-event` pushes from the server. Accept = fee transfer + player
// joins your roster temporarily; declined offers just drop off.

import { useEffect } from 'react';
import { useOnline } from '../onlineStore';

function fmtAgo(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function fmtRemaining(endsAt?: number): string {
  if (!endsAt) return '—';
  const s = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export default function LoanOffersPanel() {
  const incoming = useOnline((s) => s.loansIncoming);
  const outgoing = useOnline((s) => s.loansOutgoing);
  const listLoans = useOnline((s) => s.listLoanOffers);
  const accept = useOnline((s) => s.acceptLoan);
  const decline = useOnline((s) => s.declineLoan);
  const team = useOnline((s) => s.team);

  useEffect(() => { listLoans(); }, [listLoans]);

  if (!team) return null;
  // Hide entirely if there's no loan activity at all.
  if (incoming.length === 0 && outgoing.length === 0) return null;

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title">📨 Loan Offers</div>
      {incoming.length > 0 && (
        <>
          <div className="muted small" style={{ marginTop: 4 }}>Incoming:</div>
          <table className="table table-dense">
            <thead><tr><th>Player</th><th>From</th><th className="num">Fee</th><th>Length</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {incoming.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.playerNickname}</strong></td>
                  <td>{l.fromTeamTag}</td>
                  <td className="num">${l.fee.toLocaleString()}</td>
                  <td>{l.days}d</td>
                  <td>{l.status === 'active' ? <span className="text-win">{fmtRemaining(l.endsAt)} left</span> : l.status}</td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    {l.status === 'pending' && (
                      <>
                        <button className="btn btn-tiny btn-accent" disabled={team.money < l.fee} onClick={() => accept(l.id)}>Accept</button>
                        <button className="btn btn-tiny btn-danger" onClick={() => decline(l.id)}>Decline</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <div className="muted small" style={{ marginTop: 10 }}>Outgoing:</div>
          <table className="table table-dense">
            <thead><tr><th>Player</th><th>To</th><th className="num">Fee</th><th>Length</th><th>Status</th><th>Sent</th></tr></thead>
            <tbody>
              {outgoing.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.playerNickname}</strong></td>
                  <td>{l.toTeamTag}</td>
                  <td className="num">${l.fee.toLocaleString()}</td>
                  <td>{l.days}d</td>
                  <td>{l.status === 'active' ? <span className="text-win">{fmtRemaining(l.endsAt)} left</span> : l.status}</td>
                  <td className="muted small">{fmtAgo(l.offeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
