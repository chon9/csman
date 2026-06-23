import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { money, fmtDate } from '../util';
import { STAFF_ROLES, STAFF_ROLE_LABEL, STAFF_ROLE_HINT } from '../../types';
import type { Staff, StaffRole } from '../../types';

type Filter = StaffRole | 'all';

export default function StaffScreen() {
  const game = useGame((s) => s.game)!;
  const hireStaff = useGame((s) => s.hireStaff);
  const releaseStaff = useGame((s) => s.releaseStaff);

  const [filter, setFilter] = useState<Filter>('all');

  const userTeam = game.teams[game.userTeamId];
  const allStaff = game.staff ?? {};

  // Hired staff for the user team, keyed by role
  const hiredByRole: Partial<Record<StaffRole, Staff>> = {};
  for (const id of userTeam.staffIds ?? []) {
    const s = allStaff[id];
    if (s) hiredByRole[s.role] = s;
  }

  const market = useMemo(() => {
    return Object.values(allStaff)
      .filter((s) => !s.teamId && (filter === 'all' || s.role === filter))
      .sort((a, b) => b.skill - a.skill);
  }, [allStaff, filter]);

  const monthlyStaffWage = Object.values(hiredByRole).reduce(
    (sum, s) => sum + (s?.contract?.wage ?? 0),
    0,
  );

  return (
    <div className="screen">
      <h2 className="screen-title">Staff</h2>
      <p className="muted small">
        Specialist coaches multiply training and development. Without a specialist,
        training in that area runs at baseline. Total staff wages:{' '}
        <strong>{money(monthlyStaffWage)}/mo</strong>.
      </p>

      <div className="panel">
        <div className="panel-title">Your Staff</div>
        <div className="staff-slot-grid">
          {STAFF_ROLES.map((role) => {
            const s = hiredByRole[role];
            return (
              <div key={role} className={`staff-slot ${s ? 'filled' : 'vacant'}`}>
                <div className="staff-slot-head">
                  <span className="staff-slot-role">{STAFF_ROLE_LABEL[role]}</span>
                  {s && (
                    <span className="staff-skill-pill" title={`Skill ${s.skill}/20`}>
                      {s.skill}
                    </span>
                  )}
                </div>
                {s ? (
                  <>
                    <div className="staff-name">{s.name}</div>
                    <div className="muted small">
                      {s.nationality} · {s.age} yrs
                    </div>
                    <div className="staff-contract">
                      {money(s.contract?.wage ?? s.wage)}/mo
                      {s.contract && ` · expires ${fmtDate(s.contract.expires)}`}
                    </div>
                    <button
                      className="btn btn-tiny btn-danger"
                      onClick={() => {
                        if (window.confirm(`Release ${s.name}? Their contract ends immediately.`)) {
                          releaseStaff(s.id);
                        }
                      }}
                    >
                      Release
                    </button>
                  </>
                ) : (
                  <>
                    <div className="muted small">— vacant —</div>
                    <div className="staff-slot-hint muted small">{STAFF_ROLE_HINT[role]}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-title">
          Staff Market
          <span className="muted small" style={{ float: 'right' }}>
            {market.length} available
          </span>
        </div>
        <div className="tab-row" style={{ marginTop: 4 }}>
          <button
            className={`tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          {STAFF_ROLES.map((role) => (
            <button
              key={role}
              className={`tab ${filter === role ? 'active' : ''}`}
              onClick={() => setFilter(role)}
            >
              {STAFF_ROLE_LABEL[role]}
            </button>
          ))}
        </div>
        <div className="panel table-panel" style={{ padding: 0, border: 'none' }}>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Nat</th>
                <th>Age</th>
                <th className="num">Skill</th>
                <th className="num">Rep</th>
                <th className="num">Ask Wage/mo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {market.map((s) => {
                const askingWage = Math.round((s.wage * 1.1) / 500) * 500;
                const canAfford = userTeam.budget >= askingWage * 12;
                const tip =
                  STAFF_ROLE_HINT[s.role] +
                  ` · Asking ${money(askingWage)}/mo (need 12-month buffer in budget)`;
                return (
                  <tr key={s.id} title={tip}>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td>{STAFF_ROLE_LABEL[s.role]}</td>
                    <td>{s.nationality}</td>
                    <td>{s.age}</td>
                    <td className="num staff-skill-cell">{s.skill}</td>
                    <td className="num">{s.reputation}</td>
                    <td className="num">{money(askingWage)}</td>
                    <td className="cell-actions">
                      <button
                        className="btn btn-tiny"
                        disabled={!canAfford}
                        onClick={() => hireStaff(s.id)}
                        title={
                          canAfford
                            ? `Hire on 2-year deal at ${money(askingWage)}/mo`
                            : `Need ${money(askingWage * 12)} budget buffer`
                        }
                      >
                        Hire
                      </button>
                    </td>
                  </tr>
                );
              })}
              {market.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No available staff in this category.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
