// Cross-team transfer market. Shows every active listing, sortable by price
// or CA. Owners can list their non-essential players (squad-of-6+ rule)
// and unlist their own listings.

import { useEffect, useMemo, useState } from 'react';
import { useOnline } from '../onlineStore';
import ToastStack from './ToastStack';

type SortKey = 'price' | 'ca' | 'age' | 'pa';
type Tab = 'listings' | 'free-agents';

export default function OnlineMarketScreen() {
  const team = useOnline((s) => s.team);
  const players = useOnline((s) => s.players);
  const listings = useOnline((s) => s.marketListings);
  const marketPlayers = useOnline((s) => s.marketPlayers);
  const freeAgents = useOnline((s) => s.freeAgents);
  const freeAgentWages = useOnline((s) => s.freeAgentWages);
  const refreshMarket = useOnline((s) => s.refreshMarket);
  const refreshFreeAgents = useOnline((s) => s.refreshFreeAgents);
  const signFreeAgent = useOnline((s) => s.signFreeAgent);
  const listPlayer = useOnline((s) => s.listPlayer);
  const unlistPlayer = useOnline((s) => s.unlistPlayer);
  const buyListedPlayer = useOnline((s) => s.buyListedPlayer);
  const go = useOnline((s) => s.go);

  const [tab, setTab] = useState<Tab>('listings');
  const [sort, setSort] = useState<SortKey>('price');
  const [faSort, setFaSort] = useState<SortKey>('ca');
  // Quick-list dialog state.
  const [listingPlayerId, setListingPlayerId] = useState<string | null>(null);
  const [askingPrice, setAskingPrice] = useState(50_000);

  useEffect(() => {
    refreshMarket();
    refreshFreeAgents();
  }, [refreshMarket, refreshFreeAgents]);

  const sortedFAs = useMemo(() => {
    const arr = [...freeAgents];
    arr.sort((a, b) => {
      switch (faSort) {
        case 'price': return (freeAgentWages[a.id] ?? 0) - (freeAgentWages[b.id] ?? 0);
        case 'ca': return b.currentAbility - a.currentAbility;
        case 'pa': return b.potentialAbility - a.potentialAbility;
        case 'age': return a.age - b.age;
      }
    });
    return arr;
  }, [freeAgents, freeAgentWages, faSort]);

  const sortedListings = useMemo(() => {
    const arr = [...listings];
    arr.sort((a, b) => {
      const pa = marketPlayers[a.playerId];
      const pb = marketPlayers[b.playerId];
      switch (sort) {
        case 'price': return a.askingPrice - b.askingPrice;
        case 'ca': return (pb?.currentAbility ?? 0) - (pa?.currentAbility ?? 0);
        case 'pa': return (pb?.potentialAbility ?? 0) - (pa?.potentialAbility ?? 0);
        case 'age': return (pa?.age ?? 0) - (pb?.age ?? 0);
      }
    });
    return arr;
  }, [listings, marketPlayers, sort]);

  if (!team) return null;

  const myRoster = team.playerIds
    .map((id) => players[id])
    .filter((p): p is NonNullable<typeof p> => !!p);
  // Only list if you have 6+ — protects the engine floor (need 5 to duel).
  const canList = myRoster.length > 5;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Transfer Market</h2>
          <div className="muted small">
            Cross-team listings · instant buy at asking price · {listings.length} active
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={refreshMarket}>Refresh</button>
          <button className="btn" onClick={() => go('home')}>← Back</button>
        </div>
      </div>

      <div className="panel" style={{ padding: 12, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={`btn ${tab === 'listings' ? 'btn-accent' : ''}`} onClick={() => setTab('listings')}>
          Team Listings <span className="muted small">{listings.length}</span>
        </button>
        <button className={`btn ${tab === 'free-agents' ? 'btn-accent' : ''}`} onClick={() => setTab('free-agents')}>
          Free Agents <span className="muted small">{freeAgents.length}</span>
        </button>
        <span className="muted small" style={{ marginLeft: 12 }}>Sort by:</span>
        {(['price', 'ca', 'pa', 'age'] as SortKey[]).map((k) => (
          <button
            key={k}
            className={`btn btn-tiny ${(tab === 'listings' ? sort : faSort) === k ? 'btn-accent' : ''}`}
            onClick={() => (tab === 'listings' ? setSort(k) : setFaSort(k))}
          >
            {k.toUpperCase()}
          </button>
        ))}
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          Your cash: <strong>${team.money.toLocaleString()}</strong>
        </span>
      </div>

      {tab === 'free-agents' && (<>
        <div className="panel" style={{ padding: 14 }}>
          <div className="panel-title">
            Free Agents
            <span className="muted small"> — signing fee = 2× monthly wage</span>
          </div>
          {sortedFAs.length === 0 ? (
            <div className="muted small">No free agents in the pool — server is refilling…</div>
          ) : (
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Role</th>
                  <th>Nat</th>
                  <th>Age</th>
                  <th className="num">CA</th>
                  <th className="num">PA</th>
                  <th className="num">Wage</th>
                  <th className="num">Sign fee</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedFAs.map((p) => {
                  const wage = freeAgentWages[p.id] ?? 10000;
                  const fee = wage * 2;
                  const canAfford = team.money >= fee;
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.nickname}</strong> <span className="muted small">{p.firstName} {p.lastName}</span></td>
                      <td>{p.role}</td>
                      <td className="muted">{p.nationality}</td>
                      <td>{p.age}</td>
                      <td className="num">{p.currentAbility}</td>
                      <td className="num">{p.potentialAbility}</td>
                      <td className="num">${wage.toLocaleString()}/mo</td>
                      <td className="num">${fee.toLocaleString()}</td>
                      <td>
                        <button
                          className="btn btn-tiny btn-accent"
                          disabled={!canAfford}
                          onClick={() => signFreeAgent(p.id, wage)}
                          title={canAfford ? '' : 'Insufficient funds'}
                        >
                          Sign
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </>)}

      {tab === 'listings' && <>
      {/* ===== Active listings ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Active Listings</div>
        {sortedListings.length === 0 ? (
          <div className="muted small">No players on the market. Be the first to list — buyers tend to circle pretty fast.</div>
        ) : (
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th>
                <th>Seller</th>
                <th>Role</th>
                <th>Nat</th>
                <th>Age</th>
                <th className="num">CA</th>
                <th className="num">PA</th>
                <th className="num">Asking</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedListings.map((l) => {
                const p = marketPlayers[l.playerId];
                const isMine = l.sellerTeamId === team.id;
                const canAfford = team.money >= l.askingPrice;
                return (
                  <tr key={l.id}>
                    <td>
                      <strong>{p?.nickname ?? l.playerId}</strong>{' '}
                      <span className="muted small">{p?.firstName} {p?.lastName}</span>
                    </td>
                    <td className="muted">{l.sellerTeamTag}</td>
                    <td>{p?.role ?? '—'}</td>
                    <td className="muted">{p?.nationality ?? '—'}</td>
                    <td>{p?.age ?? '—'}</td>
                    <td className="num">{p?.currentAbility ?? '—'}</td>
                    <td className="num">{p?.potentialAbility ?? '—'}</td>
                    <td className="num">${l.askingPrice.toLocaleString()}</td>
                    <td>
                      {isMine ? (
                        <button className="btn btn-tiny btn-danger" onClick={() => unlistPlayer(l.id)}>
                          Unlist
                        </button>
                      ) : (
                        <button
                          className="btn btn-tiny btn-accent"
                          disabled={!canAfford}
                          onClick={() => buyListedPlayer(l.id)}
                          title={canAfford ? '' : 'Insufficient funds'}
                        >
                          Buy
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== List one of your players ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">List a Player <span className="muted small">— needs squad of 6+</span></div>
        {!canList && (
          <div className="muted small">
            Roster only has {myRoster.length} players. Sign one more before listing — duels need 5 minimum.
          </div>
        )}
        {canList && (
          <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Role</th>
                  <th className="num">CA</th>
                  <th className="num">PA</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {myRoster.map((p) => {
                  const alreadyListed = listings.some((l) => l.playerId === p.id);
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.nickname}</strong></td>
                      <td>{p.role}</td>
                      <td className="num">{p.currentAbility}</td>
                      <td className="num">{p.potentialAbility}</td>
                      <td>
                        {alreadyListed ? (
                          <span className="muted small">already listed</span>
                        ) : (
                          <button
                            className="btn btn-tiny"
                            onClick={() => {
                              setListingPlayerId(p.id);
                              setAskingPrice(Math.max(50_000, Math.round((p.currentAbility - 80) ** 2 * 300)));
                            }}
                          >
                            List…
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>}

      {listingPlayerId && (
        <div className="modal-backdrop" onClick={() => setListingPlayerId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <h3>List {players[listingPlayerId]?.nickname}</h3>
              <button className="link-btn" onClick={() => setListingPlayerId(null)}>close ✕</button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span className="field-label">Asking price (USD)</span>
                <input
                  type="number"
                  className="input"
                  value={askingPrice}
                  min={1000}
                  step={1000}
                  onChange={(e) => setAskingPrice(Math.max(1000, Math.round(Number(e.target.value))))}
                />
                <span className="muted small">
                  Buyers can purchase instantly at this price. No counters — set it sharp.
                </span>
              </label>
            </div>
            <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setListingPlayerId(null)}>Cancel</button>
              <button
                className="btn btn-accent"
                onClick={() => {
                  listPlayer(listingPlayerId, askingPrice);
                  setListingPlayerId(null);
                }}
              >
                List for ${askingPrice.toLocaleString()}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastStack />
    </div>
  );
}
