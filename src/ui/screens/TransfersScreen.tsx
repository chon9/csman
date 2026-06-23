import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import type { PersonalTerms, Player, PlayerRole, SquadStatusPromise, TransferOffer } from '../../types';
import { TeamLink } from '../TeamLink';
import { fmtDate, money } from '../util';
import { playerWageDemand, previewExpectedTerms } from '../../sim/negotiation';
import { playerReputation } from '../../sim/playerAnalytics';

type Tab = 'offers' | 'market' | 'bids' | 'loans' | 'free';
type SortKey = 'ability' | 'age' | 'price';
type FASortKey = 'ca' | 'pa' | 'age-young' | 'age-old' | 'wonderkid';

const ROLES: (PlayerRole | 'all')[] = ['all', 'IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler', 'Anchor'];

export default function TransfersScreen() {
  const game = useGame((s) => s.game)!;
  const openPlayer = useGame((s) => s.openPlayer);
  const respondOffer = useGame((s) => s.respondOffer);
  const counterIncomingOffer = useGame((s) => s.counterIncomingOffer);
  const submitBid = useGame((s) => s.submitBid);
  const acceptCounter = useGame((s) => s.acceptCounter);
  const counterBack = useGame((s) => s.counterBack);
  const submitPersonalTerms = useGame((s) => s.submitPersonalTerms);
  const withdrawBid = useGame((s) => s.withdrawBid);
  const triggerBuyout = useGame((s) => s.triggerBuyout);
  const matchRivalBid = useGame((s) => s.matchRivalBid);
  const loanOut = useGame((s) => s.loanOut);
  const recallLoan = useGame((s) => s.recallLoan);
  const signFreeAgent = useGame((s) => s.signFreeAgent);

  const [tab, setTab] = useState<Tab>('market');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<PlayerRole | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('ability');
  const [bidTarget, setBidTarget] = useState<Player | null>(null);
  const [activeOfferId, setActiveOfferId] = useState<string | null>(null);
  const [loanTarget, setLoanTarget] = useState<Player | null>(null);
  const [faSearch, setFaSearch] = useState('');
  const [faRole, setFaRole] = useState<PlayerRole | 'all'>('all');
  const [faSort, setFaSort] = useState<FASortKey>('ca');
  const [faAgeFilter, setFaAgeFilter] = useState<'all' | 'wonderkid' | 'young' | 'vet'>('all');

  const userId = game.userTeamId;
  const incoming = game.offers.filter((o) => o.direction === 'in' && o.status === 'pending');
  const outgoing = game.offers.filter((o) => o.direction === 'out');
  const activeBids = outgoing.filter((o) => o.status !== 'accepted' && o.status !== 'rejected' && o.status !== 'withdrawn');
  const loans = (game.loans ?? []).filter((l) => l.fromTeamId === userId);

  const marketPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(game.players)
      .filter((p) => p.teamId && p.teamId !== userId)
      .filter((p) => role === 'all' || p.role === role)
      .filter(
        (p) =>
          !q ||
          p.nickname.toLowerCase().includes(q) ||
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        if (sort === 'age') return a.age - b.age;
        if (sort === 'price') return a.askingPrice - b.askingPrice;
        return b.currentAbility - a.currentAbility;
      });
  }, [game.players, userId, search, role, sort]);

  const freeAgents = useMemo(() => {
    const q = faSearch.trim().toLowerCase();
    const filtered = Object.values(game.players).filter((p) => {
      if (p.teamId !== null) return false;
      if (q && !p.nickname.toLowerCase().includes(q) && !p.lastName.toLowerCase().includes(q)) return false;
      if (faRole !== 'all' && p.role !== faRole) return false;
      if (faAgeFilter === 'wonderkid' && !(p.age <= 19 && (p.potentialAbility - p.currentAbility) >= 20)) return false;
      if (faAgeFilter === 'young' && p.age > 23) return false;
      if (faAgeFilter === 'vet' && p.age < 28) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      switch (faSort) {
        case 'pa': return b.potentialAbility - a.potentialAbility;
        case 'age-young': return a.age - b.age;
        case 'age-old': return b.age - a.age;
        case 'wonderkid': {
          // Sort by raw potential headroom — best wonderkids on top
          const wkA = (a.potentialAbility - a.currentAbility) - Math.max(0, a.age - 21) * 5;
          const wkB = (b.potentialAbility - b.currentAbility) - Math.max(0, b.age - 21) * 5;
          return wkB - wkA;
        }
        case 'ca':
        default: return b.currentAbility - a.currentAbility;
      }
    });
  }, [game.players, faSearch, faRole, faSort, faAgeFilter]);

  const activeOffer = activeOfferId ? outgoing.find((o) => o.id === activeOfferId) : null;

  // Negotiations the user needs to act on right now (their move).
  // Negotiations the user needs to act on: outgoing bids in counter/terms +
  // any incoming bid for a user player.
  const needsAction = [
    ...activeBids.filter(
      (o) => o.status === 'club-counter' || o.status === 'player-counter' || o.status === 'personal-terms',
    ),
    ...incoming,
  ];

  return (
    <div className="screen">
      <h2 className="screen-title">Transfers</h2>

      {needsAction.length > 0 && (
        <div className="nego-banner panel">
          <div className="nego-banner-icon">🤝</div>
          <div className="nego-banner-body">
            <div className="nego-banner-title">
              {needsAction.length} {needsAction.length === 1 ? 'negotiation' : 'negotiations'} awaiting your move
            </div>
            <div className="nego-banner-list">
              {needsAction.slice(0, 6).map((o) => {
                const p = game.players[o.playerId];
                return (
                  <button
                    key={o.id}
                    className="nego-banner-chip"
                    onClick={() => {
                      if (o.direction === 'in') {
                        setTab('offers');
                      } else {
                        setTab('bids');
                        setActiveOfferId(o.id);
                      }
                    }}
                    title="Open negotiation"
                  >
                    <strong>{p?.nickname ?? 'Player'}</strong>
                    <span className="muted small"> · {o.direction === 'in' ? 'Bid received' : statusLabel(o.status)}</span>
                  </button>
                );
              })}
              {needsAction.length > 6 && (
                <span className="muted small">+{needsAction.length - 6} more</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="tab-row">
        <button className={`tab ${tab === 'market' ? 'active' : ''}`} onClick={() => setTab('market')}>Market</button>
        <button className={`tab ${tab === 'bids' ? 'active' : ''}`} onClick={() => setTab('bids')}>
          My Bids {activeBids.length > 0 && <span className="badge">{activeBids.length}</span>}
        </button>
        <button className={`tab ${tab === 'offers' ? 'active' : ''}`} onClick={() => setTab('offers')}>
          Incoming {incoming.length > 0 && <span className="badge">{incoming.length}</span>}
        </button>
        <button className={`tab ${tab === 'loans' ? 'active' : ''}`} onClick={() => setTab('loans')}>
          Loans Out {loans.length > 0 && <span className="badge">{loans.length}</span>}
        </button>
        <button className={`tab ${tab === 'free' ? 'active' : ''}`} onClick={() => setTab('free')}>Free Agents</button>
      </div>

      {tab === 'market' && (
        <div className="panel table-panel">
          <div className="filter-row">
            <input className="input" placeholder="Search players..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as PlayerRole | 'all')}>
              {ROLES.map((r) => <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>)}
            </select>
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="ability">Sort: Ability</option>
              <option value="age">Sort: Age</option>
              <option value="price">Sort: Price</option>
            </select>
          </div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th>
                <th>Age</th>
                <th>Role</th>
                <th>Team</th>
                <th className="num">Rating</th>
                <th className="num">Asking</th>
                <th className="num">Buyout</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {marketPlayers.slice(0, 80).map((p) => (
                <tr key={p.id}>
                  <td className="clickable" onClick={() => openPlayer(p.id)}>
                    <span className="player-nick">{p.nickname}</span>
                  </td>
                  <td>{p.age}</td>
                  <td>{p.role}</td>
                  <td>{p.teamId && game.teams[p.teamId] ? <TeamLink team={game.teams[p.teamId]!} display="tag" noLogo /> : <span className="muted">—</span>}</td>
                  <td className="num">{p.stats.rating.toFixed(2)}</td>
                  <td className="num">{money(p.askingPrice)}</td>
                  <td className="num muted">{p.contract ? money(p.contract.buyout) : '—'}</td>
                  <td className="cell-actions">
                    <button className="btn btn-tiny" onClick={() => setBidTarget(p)}>Negotiate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'bids' && (
        <div className="panel">
          <div className="panel-title">My Bids — Active Negotiations</div>
          {activeBids.length === 0 && <p className="muted small">No active negotiations. Open the Market tab to start one.</p>}
          <div className="bid-list">
            {activeBids.map((o) => {
              const p = game.players[o.playerId];
              if (!p) return null;
              return (
                <div key={o.id} className={`bid-card status-${o.status}`} onClick={() => setActiveOfferId(o.id)}>
                  <div className="bid-card-head">
                    <div>
                      <strong>{p.nickname}</strong>
                      <span className="muted small"> · {game.teams[p.teamId ?? '']?.name}</span>
                    </div>
                    <span className={`bid-status-pill status-${o.status}`}>{statusLabel(o.status)}</span>
                  </div>
                  <div className="bid-card-body">
                    <span>Fee: {money(o.fee)}</span>
                    {!!o.counterFee && <span className="bid-counter">Counter: {money(o.counterFee)}</span>}
                    {!!o.rivalBid && <span className="bid-rival">⚠ Rival: {money(o.rivalBid.fee)} ({game.teams[o.rivalBid.teamId]?.tag})</span>}
                  </div>
                  <div className="muted small">Click to manage →</div>
                </div>
              );
            })}
          </div>

          {/* Past deals collapsed */}
          {outgoing.filter((o) => o.status === 'accepted' || o.status === 'rejected' || o.status === 'withdrawn').length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted small">Closed negotiations ({outgoing.filter((o) => o.status === 'accepted' || o.status === 'rejected' || o.status === 'withdrawn').length})</summary>
              <ul className="closed-list">
                {outgoing
                  .filter((o) => o.status === 'accepted' || o.status === 'rejected' || o.status === 'withdrawn')
                  .slice(-20)
                  .reverse()
                  .map((o) => (
                    <li key={o.id} className="muted small">
                      {fmtDate(o.date)} — {game.players[o.playerId]?.nickname ?? o.playerId}: {statusLabel(o.status)}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {tab === 'offers' && (
        <div className="panel">
          <div className="panel-title">Incoming Offers for Your Players</div>
          {incoming.length === 0 ? (
            <div className="muted">No pending offers for your players.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {incoming.map((o) => (
                <IncomingOfferCard
                  key={o.id}
                  offer={o}
                  onAccept={() => respondOffer(o.id, true)}
                  onReject={() => respondOffer(o.id, false)}
                  onCounter={(fee) => counterIncomingOffer(o.id, fee)}
                  onOpenPlayer={() => openPlayer(o.playerId)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'loans' && (
        <div className="panel">
          <div className="panel-title">Loans Out</div>
          <p className="muted small">
            Loan younger or fringe players to other clubs for development. The recipient
            covers a share of their wage; players return automatically when the loan ends.
          </p>
          <div className="bid-list">
            {loans.length === 0 && <p className="muted small">No active loans out.</p>}
            {loans.map((l) => {
              const p = game.players[l.playerId];
              return (
                <div key={l.id} className="bid-card">
                  <div className="bid-card-head">
                    <div>
                      <strong>{p?.nickname}</strong>
                      <span className="muted small"> · loaned to {game.teams[l.toTeamId]?.name}</span>
                    </div>
                    <button className="btn btn-tiny btn-danger" onClick={() => recallLoan(l.id)}>Recall</button>
                  </div>
                  <div className="bid-card-body">
                    <span>Through {fmtDate(l.endDate)}</span>
                    <span>Wage cover: {Math.round(l.wageContribution * 100)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="panel-title" style={{ marginTop: 14 }}>Loan a player out</div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th><th>Role</th><th>Age</th><th className="num">CA</th><th></th>
              </tr>
            </thead>
            <tbody>
              {game.teams[userId].playerIds
                .slice(5) // bench only
                .map((id) => game.players[id])
                .filter(Boolean)
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.nickname}</td>
                    <td>{p.role}</td>
                    <td>{p.age}</td>
                    <td className="num">{p.currentAbility}</td>
                    <td className="cell-actions">
                      <button className="btn btn-tiny" onClick={() => setLoanTarget(p)}>Loan out</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'free' && (
        <div className="panel table-panel">
          <div className="panel-title">
            Free Agents <span className="muted small">— {freeAgents.length} match your filter</span>
          </div>
          <div className="filter-row">
            <input className="input" placeholder="Search nickname or last name..." value={faSearch} onChange={(e) => setFaSearch(e.target.value)} />
            <select className="input" value={faRole} onChange={(e) => setFaRole(e.target.value as PlayerRole | 'all')}>
              {ROLES.map((r) => <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>)}
            </select>
            <select className="input" value={faAgeFilter} onChange={(e) => setFaAgeFilter(e.target.value as typeof faAgeFilter)}>
              <option value="all">All ages</option>
              <option value="wonderkid">Wonderkids (≤19, big PA)</option>
              <option value="young">Young (≤23)</option>
              <option value="vet">Veterans (≥28)</option>
            </select>
            <select className="input" value={faSort} onChange={(e) => setFaSort(e.target.value as FASortKey)}>
              <option value="ca">Sort: Current Ability</option>
              <option value="pa">Sort: Potential Ability</option>
              <option value="wonderkid">Sort: Wonderkid score</option>
              <option value="age-young">Sort: Youngest</option>
              <option value="age-old">Sort: Oldest</option>
            </select>
          </div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th>
                <th>Age</th>
                <th>Nat</th>
                <th>Role</th>
                <th className="num">CA</th>
                <th className="num">PA</th>
                <th className="num">Demand</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {freeAgents.slice(0, 200).map((p) => {
                const demand = playerWageDemand(p, game.teams, 1.05);
                const wonderkid = (p.potentialAbility - p.currentAbility) >= 25 && p.age <= 21;
                return (
                  <tr key={p.id}>
                    <td className="clickable" onClick={() => openPlayer(p.id)}>
                      {p.nickname}{' '}
                      {wonderkid && <span className="wonderkid-badge" title="High potential">★</span>}{' '}
                      <span className="muted small">{p.firstName} {p.lastName}</span>
                    </td>
                    <td>{p.age}</td>
                    <td>{p.nationality}</td>
                    <td>{p.role}</td>
                    <td className="num">{p.currentAbility}</td>
                    <td className={`num ${wonderkid ? 'text-win' : ''}`}>{p.potentialAbility}</td>
                    <td className="num">{money(demand)}/mo</td>
                    <td>
                      <button className="btn btn-tiny" onClick={() => signFreeAgent(p.id, demand)}>
                        Sign @ {money(demand)}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {freeAgents.length > 200 && (
                <tr><td colSpan={8} className="muted small" style={{ textAlign: 'center', padding: 8 }}>
                  Showing first 200 of {freeAgents.length}. Narrow filters above to see specific players.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ============ Bid modal (start negotiation) ============ */}
      {bidTarget && (
        <BidModal
          player={bidTarget}
          onClose={() => setBidTarget(null)}
          onSubmit={(fee) => {
            submitBid(bidTarget.id, fee);
            setBidTarget(null);
            setTab('bids');
          }}
          onTriggerBuyout={() => {
            triggerBuyout(bidTarget.id);
            setBidTarget(null);
            setTab('bids');
          }}
        />
      )}

      {/* ============ Negotiation panel (manage an active bid) ============ */}
      {activeOffer && (
        <NegotiationPanel
          offer={activeOffer}
          onClose={() => setActiveOfferId(null)}
          onAcceptCounter={() => acceptCounter(activeOffer.id)}
          onCounterBack={(fee) => counterBack(activeOffer.id, fee)}
          onSubmitTerms={(terms) => submitPersonalTerms(activeOffer.id, terms)}
          onWithdraw={() => { withdrawBid(activeOffer.id); setActiveOfferId(null); }}
          onMatchRival={() => matchRivalBid(activeOffer.id)}
        />
      )}

      {/* ============ Loan-out modal ============ */}
      {loanTarget && (
        <LoanModal
          player={loanTarget}
          onClose={() => setLoanTarget(null)}
          onSubmit={(toTeamId, months, contrib) => {
            loanOut(loanTarget.id, toTeamId, months, contrib);
            setLoanTarget(null);
          }}
        />
      )}
    </div>
  );
}

// ============ Bid modal ============

function BidModal({
  player,
  onClose,
  onSubmit,
  onTriggerBuyout,
}: {
  player: Player;
  onClose: () => void;
  onSubmit: (fee: number) => void;
  onTriggerBuyout: () => void;
}) {
  const [fee, setFee] = useState(Math.round(player.askingPrice * 0.85));
  const buyout = player.contract?.buyout ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Open negotiation — {player.nickname}</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>
        <div className="modal-body">
          <p className="muted small">
            {player.firstName} {player.lastName} · {player.role} · {player.age} yrs ·
            CA {player.currentAbility} · Reputation {playerReputation(player, undefined)}
          </p>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Asking price: <strong>{money(player.askingPrice)}</strong> · Release clause: <strong>{money(buyout)}</strong>
          </div>
          <label className="field">
            <span className="field-label">Your fee</span>
            <input
              type="number"
              className="input"
              value={fee}
              step={50000}
              onChange={(e) => setFee(Math.max(0, Math.round(Number(e.target.value))))}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-accent" onClick={() => onSubmit(fee)}>
              Submit bid: {money(fee)}
            </button>
            {buyout > 0 && (
              <button className="btn btn-danger" onClick={onTriggerBuyout} title={`Pay the full release clause ${money(buyout)} for an automatic Stage-1 pass`}>
                Trigger buyout: {money(buyout)}
              </button>
            )}
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Negotiation panel ============

function IncomingOfferCard({
  offer,
  onAccept,
  onReject,
  onCounter,
  onOpenPlayer,
}: {
  offer: TransferOffer;
  onAccept: () => void;
  onReject: () => void;
  onCounter: (fee: number) => void;
  onOpenPlayer: () => void;
}) {
  const game = useGame((s) => s.game)!;
  const player = game.players[offer.playerId];
  const bidder = game.teams[offer.fromTeamId];
  // Suggest a counter at +20% over their bid as a starting point.
  const [counter, setCounter] = useState(Math.round((offer.fee * 1.2) / 5000) * 5000);

  if (!player || !bidder) return null;

  return (
    <div className="incoming-offer-card panel-alt">
      <div className="incoming-offer-head">
        <div>
          <span className="clickable" onClick={onOpenPlayer}>
            <strong>{player.nickname}</strong>
          </span>{' '}
          <span className="muted small">· {player.role} · CA {player.currentAbility}</span>
        </div>
        <div className="muted small">Expires {fmtDate(offer.expiresOn)}</div>
      </div>

      <div className="incoming-offer-body">
        <div className="incoming-offer-stat">
          <span className="stat-label">Bidder</span>
          <span className="stat-value">{bidder.name} <span className="muted small">#{bidder.worldRanking}</span></span>
        </div>
        <div className="incoming-offer-stat">
          <span className="stat-label">Their fee</span>
          <span className="stat-value" style={{ color: '#facc15' }}>{money(offer.fee)}</span>
        </div>
        <div className="incoming-offer-stat">
          <span className="stat-label">Player wage</span>
          <span className="stat-value">{money(offer.wage)}/mo</span>
        </div>
        <div className="incoming-offer-stat">
          <span className="stat-label">Round</span>
          <span className="stat-value">{offer.feeRound ?? 1} / 3</span>
        </div>
      </div>

      {(offer.log ?? []).length > 0 && (
        <details className="nego-log-details">
          <summary className="muted small">Negotiation log ({(offer.log ?? []).length})</summary>
          <ul className="nego-log">
            {(offer.log ?? []).map((l, i) => (
              <li key={i} className="muted small">{fmtDate(l.date)} — {l.line}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="incoming-offer-actions">
        <input
          type="number"
          className="input incoming-offer-counter-input"
          value={counter}
          step={25000}
          onChange={(e) => setCounter(Math.max(0, Number(e.target.value)))}
        />
        <button className="btn" onClick={() => onCounter(counter)}>
          Counter at {money(counter)}
        </button>
        <button className="btn btn-accent" onClick={onAccept}>
          Accept {money(offer.fee)}
        </button>
        <button className="btn btn-danger" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}

function NegotiationPanel({
  offer,
  onClose,
  onAcceptCounter,
  onCounterBack,
  onSubmitTerms,
  onWithdraw,
  onMatchRival,
}: {
  offer: TransferOffer;
  onClose: () => void;
  onAcceptCounter: () => void;
  onCounterBack: (fee: number) => void;
  onSubmitTerms: (terms: PersonalTerms) => void;
  onWithdraw: () => void;
  onMatchRival: () => void;
}) {
  const game = useGame((s) => s.game)!;
  const player = game.players[offer.playerId];
  const [counter, setCounter] = useState(offer.counterFee ?? offer.fee);
  const agentMul = offer.agent?.demandMultiplier ?? 1.0;
  const expected = previewExpectedTerms(player, game.teams, agentMul);
  // Use the player's counter terms as the base if they've come back at us — keeps the haggle visible.
  const baseTerms: PersonalTerms = offer.playerCounterTerms ?? offer.personalTerms ?? {
    wage: expected.wage,
    contractYears: 2,
  };
  const [wage, setWage] = useState(baseTerms.wage);
  const [years, setYears] = useState(baseTerms.contractYears);
  const [signing, setSigning] = useState<number>(baseTerms.signingBonus ?? 0);
  const [buyoutClause, setBuyoutClause] = useState<number>(
    baseTerms.buyoutClause ?? Math.round(offer.fee * 1.5),
  );
  const [sellOnPercent, setSellOnPercent] = useState<number>(baseTerms.sellOnPercent ?? 0);
  const [perMajorBonus, setPerMajorBonus] = useState<number>(baseTerms.perMajorBonus ?? 0);
  const [wageRisePct, setWageRisePct] = useState<number>(baseTerms.wageRisePct ?? 0);
  const [loyaltyBonus, setLoyaltyBonus] = useState<number>(baseTerms.loyaltyBonus ?? 0);
  const [agentFee, setAgentFee] = useState<number>(baseTerms.agentFee ?? 0);
  const [squadStatus, setSquadStatus] = useState<SquadStatusPromise>(baseTerms.squadStatus ?? expected.status);

  const isFeeStage = offer.status === 'pending' || offer.status === 'club-counter';
  const isTermsStage = offer.status === 'personal-terms' || offer.status === 'player-counter';

  void playerWageDemand; // kept for legacy import

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{player.nickname} — {statusLabel(offer.status)}</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>
        <div className="modal-body">
          {offer.agent && (
            <p className="muted small">
              Agent: <strong>{offer.agent.name}</strong>
              {offer.agent.demandMultiplier > 1.1 && ' (known to drive a hard bargain)'}
            </p>
          )}

          {offer.rivalBid && (
            <div className="rival-bid-banner">
              ⚠ <strong>{game.teams[offer.rivalBid.teamId]?.name}</strong> have entered a competing bid of{' '}
              <strong>{money(offer.rivalBid.fee)}</strong>.
              <button className="btn btn-tiny btn-accent" onClick={onMatchRival} style={{ marginLeft: 10 }}>
                Match: {money(offer.rivalBid.fee)}
              </button>
            </div>
          )}

          {/* Stage 1: Fee */}
          {isFeeStage && (
            <div className="stage-block">
              <h4>Stage 1 — Club Fee</h4>
              <p className="muted small">
                Your bid: <strong>{money(offer.fee)}</strong>
                {offer.counterFee && (
                  <> · Their counter: <strong>{money(offer.counterFee)}</strong></>
                )}
              </p>
              {offer.counterReason && <p className="quote">"{offer.counterReason}"</p>}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <input
                  type="number"
                  className="input"
                  value={counter}
                  step={50000}
                  onChange={(e) => setCounter(Math.max(0, Math.round(Number(e.target.value))))}
                  style={{ width: 180 }}
                />
                <button className="btn" onClick={() => onCounterBack(counter)}>Counter at {money(counter)}</button>
                {offer.counterFee && (
                  <button className="btn btn-accent" onClick={onAcceptCounter}>Accept their {money(offer.counterFee)}</button>
                )}
              </div>
            </div>
          )}

          {/* Stage 2: Personal terms */}
          {isTermsStage && (
            <div className="stage-block">
              <h4>Stage 2 — Personal Terms</h4>
              {offer.playerCounterReason && <p className="quote">"{offer.playerCounterReason}"</p>}
              {offer.playerCounterTerms && (
                <p className="muted small">
                  Player counters: <strong>{money(offer.playerCounterTerms.wage)}/mo</strong>
                  {offer.playerCounterTerms.signingBonus ? ` + ${money(offer.playerCounterTerms.signingBonus)} signing` : ''}
                  {offer.playerCounterTerms.wageRisePct ? ` · ${offer.playerCounterTerms.wageRisePct}% rises` : ''}
                  {offer.playerCounterTerms.squadStatus ? ` · status: ${offer.playerCounterTerms.squadStatus}` : ''}
                </p>
              )}

              <div className="terms-expected">
                Player's camp expects ≥ <strong>{money(expected.wage)}/mo</strong>,
                ≥ <strong>{money(expected.signingBonus)}</strong> signing,
                <strong> {expected.wageRisePct}%</strong> rises, status: <strong>{expected.status}</strong>.
              </div>

              <div className="terms-grid">
                <label className="field">
                  <span className="field-label">Wage / month</span>
                  <input type="number" className="input" value={wage} step={500}
                    onChange={(e) => setWage(Math.max(0, Number(e.target.value)))} />
                </label>
                <label className="field">
                  <span className="field-label">Contract length</span>
                  <select className="input" value={years} onChange={(e) => setYears(Number(e.target.value))}>
                    <option value={1}>1 year</option>
                    <option value={2}>2 years</option>
                    <option value={3}>3 years</option>
                    <option value={4}>4 years</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Signing bonus</span>
                  <input type="number" className="input" value={signing} step={5000}
                    onChange={(e) => setSigning(Math.max(0, Number(e.target.value)))} />
                </label>
                <label className="field">
                  <span className="field-label">Squad status</span>
                  <select className="input" value={squadStatus} onChange={(e) => setSquadStatus(e.target.value as SquadStatusPromise)}>
                    <option value="star">Star Player</option>
                    <option value="first-team">First Team</option>
                    <option value="rotation">Rotation</option>
                    <option value="backup">Backup</option>
                    <option value="prospect">Prospect (youth)</option>
                  </select>
                </label>
              </div>

              <details className="advanced-terms" style={{ marginTop: 10 }}>
                <summary className="muted small">Advanced terms — clauses & bonuses</summary>
                <div className="terms-grid" style={{ marginTop: 8 }}>
                  <label className="field">
                    <span className="field-label">Release clause</span>
                    <input type="number" className="input" value={buyoutClause} step={100000}
                      onChange={(e) => setBuyoutClause(Math.max(0, Number(e.target.value)))} />
                  </label>
                  <label className="field">
                    <span className="field-label">Wage rises / year (%)</span>
                    <input type="number" className="input" value={wageRisePct} step={1} min={0} max={25}
                      onChange={(e) => setWageRisePct(Math.max(0, Math.min(25, Number(e.target.value))))} />
                  </label>
                  <label className="field">
                    <span className="field-label">Loyalty bonus (end of contract)</span>
                    <input type="number" className="input" value={loyaltyBonus} step={5000}
                      onChange={(e) => setLoyaltyBonus(Math.max(0, Number(e.target.value)))} />
                  </label>
                  <label className="field">
                    <span className="field-label">Agent fee (one-time)</span>
                    <input type="number" className="input" value={agentFee} step={5000}
                      onChange={(e) => setAgentFee(Math.max(0, Number(e.target.value)))} />
                  </label>
                  <label className="field">
                    <span className="field-label">Per-Major bonus</span>
                    <input type="number" className="input" value={perMajorBonus} step={5000}
                      onChange={(e) => setPerMajorBonus(Math.max(0, Number(e.target.value)))} />
                  </label>
                  <label className="field">
                    <span className="field-label">Sell-on % (next sale)</span>
                    <input type="number" className="input" value={sellOnPercent} step={5} min={0} max={50}
                      onChange={(e) => setSellOnPercent(Math.max(0, Math.min(50, Number(e.target.value))))} />
                  </label>
                </div>
              </details>

              <div style={{ marginTop: 10 }}>
                <button className="btn btn-accent" onClick={() => onSubmitTerms({
                  wage,
                  contractYears: years,
                  signingBonus: signing || undefined,
                  buyoutClause,
                  sellOnPercent: sellOnPercent || undefined,
                  perMajorBonus: perMajorBonus || undefined,
                  wageRisePct: wageRisePct || undefined,
                  loyaltyBonus: loyaltyBonus || undefined,
                  agentFee: agentFee || undefined,
                  squadStatus,
                })}>
                  Offer terms
                </button>
              </div>
            </div>
          )}

          {/* Negotiation log */}
          <details open style={{ marginTop: 12 }}>
            <summary className="muted small">Negotiation log</summary>
            <ul className="nego-log">
              {(offer.log ?? []).map((l, i) => (
                <li key={i} className="muted small">{fmtDate(l.date)} — {l.line}</li>
              ))}
            </ul>
          </details>

          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-danger" onClick={onWithdraw}>Withdraw from negotiation</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Loan modal ============

function LoanModal({
  player,
  onClose,
  onSubmit,
}: {
  player: Player;
  onClose: () => void;
  onSubmit: (toTeamId: string, months: number, contrib: number) => void;
}) {
  const game = useGame((s) => s.game)!;
  const candidateTeams = Object.values(game.teams)
    .filter((t) => !t.isUser && t.worldRanking > 15)
    .sort((a, b) => a.worldRanking - b.worldRanking);
  const [toTeamId, setToTeamId] = useState(candidateTeams[0]?.id ?? '');
  const [months, setMonths] = useState(6);
  const [contrib, setContrib] = useState(0.5);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Loan out {player.nickname}</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Loan to</span>
            <select className="input" value={toTeamId} onChange={(e) => setToTeamId(e.target.value)}>
              {candidateTeams.map((t) => (
                <option key={t.id} value={t.id}>#{t.worldRanking} {t.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Loan length (months)</span>
            <input type="number" min={1} max={12} className="input" value={months}
              onChange={(e) => setMonths(Math.max(1, Math.min(12, Number(e.target.value))))} />
          </label>
          <label className="field">
            <span className="field-label">Wage coverage by recipient ({Math.round(contrib * 100)}%, max 70%)</span>
            <input type="range" min={0} max={0.7} step={0.05} value={contrib}
              onChange={(e) => setContrib(Number(e.target.value))} />
          </label>
          <div className="muted small" style={{ marginBottom: 6 }}>
            You keep paying the uncovered share of {player.nickname}'s wage each month. A small admin
            fee is charged on signing (scales with wage and loan length).
          </div>
          <button className="btn btn-accent" onClick={() => onSubmit(toTeamId, months, contrib)}>
            Send on loan
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ helpers ============

function statusLabel(s: string): string {
  switch (s) {
    case 'pending': return 'Awaiting club response';
    case 'club-counter': return 'Counter offered';
    case 'personal-terms': return 'Personal terms';
    case 'player-counter': return 'Player counters';
    case 'accepted': return 'Deal closed ✓';
    case 'rejected': return 'Rejected';
    case 'withdrawn': return 'Withdrawn';
    default: return s;
  }
}
