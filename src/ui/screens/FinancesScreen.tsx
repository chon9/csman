import { useGame } from '../../store/gameStore';
import { money, fmtDate } from '../util';

export default function FinancesScreen() {
  const game = useGame((s) => s.game)!;
  const openPlayer = useGame((s) => s.openPlayer);
  const acceptSponsorOffer = useGame((s) => s.acceptSponsorOffer);
  const rejectSponsorOffer = useGame((s) => s.rejectSponsorOffer);

  const team = game.teams[game.userTeamId];
  const players = team.playerIds.map((id) => game.players[id]).filter(Boolean);
  const wageBill = players.reduce((s, p) => s + (p.contract?.wage ?? 0), 0);

  const records = [...game.finances].sort((a, b) => b.month.localeCompare(a.month));
  const lastSponsor = records[0]?.sponsorIncome ?? 0;
  const projectedNet = lastSponsor - wageBill;

  const sponsorDeals = team.sponsorDeals ?? [];
  const sponsorMonthly = sponsorDeals.reduce((s, d) => s + d.monthlyValue, 0);
  const sponsorBonusEstimate = sponsorDeals.reduce(
    (s, d) => s + d.bonusPerMajor + d.bonusPerPodium * 3, // rough season-wide estimate
    0,
  );

  const net = (r: (typeof records)[number]) =>
    r.sponsorIncome + r.prizeMoney + r.transfersIn - r.wages - r.transfersOut;

  return (
    <div className="screen">
      <h2 className="screen-title">Finances</h2>

      <div className="finance-summary">
        <div className="panel stat-panel">
          <span className="stat-label">Balance</span>
          <span className={`stat-big ${team.budget < 0 ? 'text-loss' : ''}`}>{money(team.budget)}</span>
        </div>
        <div className="panel stat-panel">
          <span className="stat-label">Monthly Wage Bill</span>
          <span className="stat-big">{money(wageBill)}</span>
        </div>
        <div className="panel stat-panel">
          <span className="stat-label">Projected Monthly Net</span>
          <span className={`stat-big ${projectedNet >= 0 ? 'text-win' : 'text-loss'}`}>{money(projectedNet)}</span>
        </div>
      </div>

      {(game.sponsorOffers ?? []).length > 0 && (
        <div className="panel">
          <div className="panel-title">
            Sponsor Offers <span className="badge">{(game.sponsorOffers ?? []).length}</span>
          </div>
          <p className="muted small">
            Brands courting your team. Each offer is typically 5-15% above the
            renewal baseline — they want you specifically. Offers lapse after 7 days.
          </p>
          <div className="sponsor-grid">
            {(game.sponsorOffers ?? []).map((o) => {
              const s = game.sponsors?.[o.sponsorId];
              if (!s) return null;
              const replacing = o.replacesDealOfSponsorId ? game.sponsors?.[o.replacesDealOfSponsorId] : null;
              return (
                <div key={o.id} className={`sponsor-card sponsor-tier-${s.tier} sponsor-offer-card`}>
                  <div className="sponsor-head">
                    <span className="sponsor-brand">{s.brand}</span>
                    <span className="sponsor-tier-pill">{s.tier.toUpperCase()}</span>
                  </div>
                  <div className="sponsor-name muted small">{s.name} · {s.category}</div>
                  <div className="sponsor-meta">
                    <span className="sponsor-monthly">{money(o.monthlyValue)}/mo</span>
                    <span className="muted small">{o.lengthMonths} mo · resp by {fmtDate(o.expiresOn)}</span>
                  </div>
                  {(o.bonusPerMajor > 0 || o.bonusPerPodium > 0) && (
                    <div className="sponsor-bonus muted small">
                      {o.bonusPerMajor > 0 && <span>Major: +{money(o.bonusPerMajor)} </span>}
                      {o.bonusPerPodium > 0 && <span>Podium: +{money(o.bonusPerPodium)}</span>}
                    </div>
                  )}
                  {replacing && (
                    <div className="sponsor-bonus muted small text-bad">
                      ⚠ Replaces existing deal with {replacing.brand}
                    </div>
                  )}
                  <div className="sponsor-offer-actions">
                    <button className="btn btn-tiny btn-accent" onClick={() => acceptSponsorOffer(o.id)}>Accept</button>
                    <button className="btn btn-tiny btn-danger" onClick={() => rejectSponsorOffer(o.id)}>Reject</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">
          Sponsors <span className="muted small" style={{ float: 'right' }}>{money(sponsorMonthly)}/mo base · ~{money(sponsorBonusEstimate)} potential bonuses/yr</span>
        </div>
        {sponsorDeals.length === 0 ? (
          <p className="muted small">No active sponsorship deals. Climb the rankings to attract brands — bigger teams get bigger names.</p>
        ) : (
          <div className="sponsor-grid">
            {sponsorDeals.map((d) => {
              const s = game.sponsors?.[d.sponsorId];
              if (!s) return null;
              const tierClass = `sponsor-tier-${s.tier}`;
              return (
                <div key={d.sponsorId} className={`sponsor-card ${tierClass}`}>
                  <div className="sponsor-head">
                    <span className="sponsor-brand">{s.brand}</span>
                    <span className="sponsor-tier-pill">{s.tier.toUpperCase()}</span>
                  </div>
                  <div className="sponsor-name muted small">{s.name} · {s.category}</div>
                  <div className="sponsor-meta">
                    <span className="sponsor-monthly">{money(d.monthlyValue)}/mo</span>
                    <span className="muted small">until {fmtDate(d.expiresDate)}</span>
                  </div>
                  {(d.bonusPerMajor > 0 || d.bonusPerPodium > 0) && (
                    <div className="sponsor-bonus muted small">
                      {d.bonusPerMajor > 0 && <span>Major win: +{money(d.bonusPerMajor)} </span>}
                      {d.bonusPerPodium > 0 && <span>Podium: +{money(d.bonusPerPodium)}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel table-panel">
        <div className="panel-title">Monthly Records</div>
        <table className="table table-dense">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Sponsor</th>
              <th className="num">Prize</th>
              <th className="num">Transfers In</th>
              <th className="num">Transfers Out</th>
              <th className="num">Wages</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const n = net(r);
              return (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td className="num">{money(r.sponsorIncome)}</td>
                  <td className="num">{money(r.prizeMoney)}</td>
                  <td className="num">{money(r.transfersIn)}</td>
                  <td className="num">{money(r.transfersOut)}</td>
                  <td className="num">{money(r.wages)}</td>
                  <td className={`num ${n >= 0 ? 'text-win' : 'text-loss'}`}>{money(n)}</td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No financial records yet — they appear at the start of each month.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel table-panel">
        <div className="panel-title">Wage Bill Breakdown</div>
        <table className="table table-dense">
          <thead>
            <tr>
              <th>Player</th>
              <th>Role</th>
              <th className="num">Wage / mo</th>
              <th className="num">% of Bill</th>
            </tr>
          </thead>
          <tbody>
            {[...players]
              .sort((a, b) => (b.contract?.wage ?? 0) - (a.contract?.wage ?? 0))
              .map((p) => (
                <tr key={p.id} className="clickable" onClick={() => openPlayer(p.id)}>
                  <td>
                    <span className="player-nick">{p.nickname}</span>
                  </td>
                  <td>{p.role}</td>
                  <td className="num">{money(p.contract?.wage ?? 0)}</td>
                  <td className="num">
                    {wageBill > 0 ? (((p.contract?.wage ?? 0) / wageBill) * 100).toFixed(1) : '0.0'}%
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
