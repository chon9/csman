// Coach hire panel. Shows your active coach (if any) + the open pool.
// Hired coach's skill boosts the training tick during time-skip; their
// monthly wage is prorated against days skipped.

import { useEffect } from 'react';
import { useOnline } from '../onlineStore';

export default function CoachesPanel() {
  const team = useOnline((s) => s.team);
  const myCoach = useOnline((s) => s.myCoach);
  const pool = useOnline((s) => s.coachPool);
  const list = useOnline((s) => s.listCoaches);
  const hire = useOnline((s) => s.hireCoach);
  const fire = useOnline((s) => s.fireCoach);

  useEffect(() => { list(); }, [list]);

  if (!team) return null;

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="panel-title">🎓 Coaches</div>
      {myCoach ? (
        <div style={{ padding: 8, background: 'var(--panel-2)', borderRadius: 4, borderLeft: '3px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{myCoach.name}</strong> <span className="muted small">{myCoach.nationality}</span>
              <div className="muted small">Skill {myCoach.skill}/20 · ${myCoach.monthlyWage.toLocaleString()}/mo (prorated on time-skip)</div>
            </div>
            <button className="btn btn-tiny btn-danger" onClick={fire}>Fire</button>
          </div>
        </div>
      ) : (
        <div className="muted small">No active coach. Hire one below to boost weekly training gains during time-skip.</div>
      )}

      {pool.length > 0 && (
        <>
          <div className="muted small" style={{ marginTop: 10 }}>Open pool:</div>
          <table className="table table-dense">
            <thead><tr><th>Name</th><th>Nat</th><th className="num">Skill</th><th className="num">Wage</th><th></th></tr></thead>
            <tbody>
              {pool.map((c) => {
                const fee = c.monthlyWage; // server charges 1 month upfront
                const canHire = !!team && team.money >= fee && !myCoach;
                return (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td className="muted">{c.nationality}</td>
                    <td className={`num ${c.skill >= 16 ? 'text-win' : c.skill <= 8 ? 'text-loss' : ''}`} style={{ fontWeight: 700 }}>{c.skill}</td>
                    <td className="num">${c.monthlyWage.toLocaleString()}</td>
                    <td>
                      <button
                        className="btn btn-tiny btn-accent"
                        disabled={!canHire}
                        title={myCoach ? 'Fire current coach first' : team.money < fee ? 'Insufficient funds' : ''}
                        onClick={() => hire(c.id)}
                      >Hire (${fee.toLocaleString()})</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
