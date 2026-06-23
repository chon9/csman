import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { addDays } from '../../sim/calendar';
import { ATTRIBUTE_GROUPS } from '../../types';
import type { AttributeKey, Player, PlayerRole, ReputationTier } from '../../types';
import { ATTR_LABEL, attrClass, attrRange, daysUntil, fmtDate, kdRatio, money } from '../util';
import { allRoleStars, familiarityTier, playerReputation, roleFamiliarityPoints, topAttrsForRole } from '../../sim/playerAnalytics';
import type { FamiliarityTier } from '../../sim/playerAnalytics';
import { AWARD_LABEL } from '../../sim/awards';

const ROLE_DISPLAY_ORDER: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler', 'Anchor'];

function StarRating({ stars }: { stars: number }) {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return (
    <span className="star-rating" title={`${stars.toFixed(1)} / 5`}>
      {'★'.repeat(full)}
      {half ? '⯨' : ''}
      <span className="star-empty">{'★'.repeat(empty)}</span>
    </span>
  );
}

function tierClass(tier: ReputationTier): string {
  switch (tier) {
    case 'Superstar': return 'tier-superstar';
    case 'Star': return 'tier-star';
    case 'Established': return 'tier-established';
    case 'Hot Prospect': return 'tier-prospect';
    case 'Journeyman': return 'tier-journeyman';
    case 'Unknown': return 'tier-unknown';
  }
}

function famClass(tier: FamiliarityTier): string {
  switch (tier) {
    case 'Natural': return 'fam-natural';
    case 'Accomplished': return 'fam-accomplished';
    case 'Competent': return 'fam-competent';
    case 'Unconvincing': return 'fam-unconvincing';
    case 'Awkward': return 'fam-awkward';
  }
}

function AttrCell({ p, k, revealed }: { p: Player; k: AttributeKey; revealed: boolean }) {
  const v = Math.round(p.attributes[k]);
  return (
    <div className="attr-row">
      <span className="attr-name">{ATTR_LABEL[k]}</span>
      {revealed ? (
        <span className={`attr-value ${attrClass(v)}`}>{v}</span>
      ) : (
        <span className="attr-value attr-hidden" title="Scout to reveal">
          {attrRange(p.id, k, v)}
        </span>
      )}
    </div>
  );
}

export default function PlayerProfile() {
  const game = useGame((s) => s.game)!;
  const playerId = useGame((s) => s.selectedPlayerId);
  const listPlayer = useGame((s) => s.listPlayer);
  const renewContract = useGame((s) => s.renewContract);
  const releasePlayer = useGame((s) => s.releasePlayer);
  const setPlayerSquadTier = useGame((s) => s.setPlayerSquadTier);
  const bidForPlayer = useGame((s) => s.bidForPlayer);
  const signFreeAgent = useGame((s) => s.signFreeAgent);
  const scoutPlayer = useGame((s) => s.scoutPlayer);
  const interactPlayer = useGame((s) => s.interactPlayer);
  const setPlayerFocus = useGame((s) => s.setPlayerFocus);
  const setPlayerDevelopmentTarget = useGame((s) => s.setPlayerDevelopmentTarget);
  const go = useGame((s) => s.go);

  const p = playerId ? game.players[playerId] : null;
  const lastTalk = p ? game.interactions?.[p.id] : undefined;
  const canInteract = !lastTalk || addDays(lastTalk, 7) <= game.currentDate;

  const [wage, setWage] = useState<number>(p?.contract?.wage ?? 10000);
  const [years, setYears] = useState<number>(2);
  const [fee, setFee] = useState<number>(p?.askingPrice ?? 100000);
  const [faWage, setFaWage] = useState<number>(p ? Math.round(80 * p.currentAbility) : 10000);

  if (!p) {
    return (
      <div className="screen">
        <div className="panel">
          <p className="muted">No player selected.</p>
          <button className="btn" onClick={() => go('squad')}>
            Back to Squad
          </button>
        </div>
      </div>
    );
  }

  const user = game.teams[game.userTeamId];
  const isOwn = p.teamId === game.userTeamId;
  const isFreeAgent = p.teamId === null;
  const revealed = isOwn || !!game.scoutReports[p.id];
  const teamName = p.teamId ? (game.teams[p.teamId]?.name ?? 'Unknown') : 'Free Agent';
  const repTier = playerReputation(p, game.teams);
  const roleFits = allRoleStars(p);
  // Find the slotted assignment for user team players (if any)
  const slottedRole = isOwn
    ? game.tactics.roleSlots?.find((s) => s.playerId === p.id)?.role
    : undefined;

  return (
    <div className="screen">
      <div className="profile-header panel">
        <div>
          <h2 className="profile-nick">{p.nickname}</h2>
          <div className="profile-realname">
            {p.firstName} {p.lastName}
          </div>
          <div className="profile-meta">
            <span>{p.nationality}</span>
            <span>{p.age} yrs</span>
            <span className="role-badge">{p.role}</span>
            <span>{teamName}</span>
            <span className={`reputation-badge ${tierClass(repTier)}`} title="Reputation tier — derived from current ability and rating">
              {repTier}
            </span>
            {p.transferListed && <span className="listed-badge">Transfer Listed</span>}
          </div>
        </div>
        <div className="profile-ability">
          {revealed ? (
            <>
              <div className="kv">
                <span>Current Ability</span>
                <span>{p.currentAbility}</span>
              </div>
              <div className="kv">
                <span>Potential</span>
                <span>{p.potentialAbility}</span>
              </div>
            </>
          ) : (
            <div className="muted small">Ability unknown — scout to reveal</div>
          )}
          <div className="kv">
            <span>Asking Price</span>
            <span>{money(p.askingPrice)}</span>
          </div>
        </div>
      </div>

      <div className="profile-grid">
        <div className="panel">
          <div className="panel-title">Attributes {!revealed && <span className="muted small">(estimated — scout to reveal)</span>}</div>
          <div className="attr-groups attr-groups-fm">
            {ATTRIBUTE_GROUPS.map((g) => (
              <div key={g.label} className="attr-group">
                <div className="attr-group-name">{g.label}</div>
                {g.keys.map((k) => (
                  <AttrCell key={k} p={p} k={k as AttributeKey} revealed={revealed} />
                ))}
              </div>
            ))}
          </div>
          <div className="panel-title" style={{ marginTop: 14 }}>Role Suitability</div>
          <p className="muted small">
            Star rating per role from this player's attribute spread. Slot them on a high-fit
            role for a skill bonus; mismatches cost duels.
          </p>
          <div className="role-fit-list">
            {ROLE_DISPLAY_ORDER.map((role) => {
              const fit = roleFits.find((r) => r.role === role);
              if (!fit) return null;
              const isNatural = p.role === role;
              const isSlotted = slottedRole === role;
              const famPoints = roleFamiliarityPoints(p, role);
              const fam = familiarityTier(famPoints);
              return (
                <div
                  key={role}
                  className={`role-fit-row ${isNatural ? 'natural' : ''} ${isSlotted ? 'slotted' : ''}`}
                  title={`Familiarity: ${fam} (${famPoints} exp from matches at this role)`}
                >
                  <span className="role-fit-name">{role}</span>
                  <StarRating stars={fit.stars} />
                  <span className="role-fit-score">{fit.stars.toFixed(1)}</span>
                  <span className={`role-fam-badge ${famClass(fam)}`}>{fam}</span>
                  {isSlotted && <span className="role-fit-tag">slotted</span>}
                  {isNatural && !isSlotted && <span className="role-fit-tag">natural</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          {(() => {
            const rels = (game.relationships ?? []).filter((r) => r.fromId === p.id || r.toId === p.id);
            if (rels.length === 0) return null;
            const lookup = (id: string) => game.players[id];
            const labelFor = (r: typeof rels[number]): { kind: string; other: string; note: string; tone: string } | null => {
              if (r.kind === 'mentor') {
                const isMentor = r.fromId === p.id;
                const otherP = lookup(isMentor ? r.toId : r.fromId);
                if (!otherP) return null;
                return {
                  kind: isMentor ? 'Mentoring' : 'Mentored by',
                  other: otherP.nickname,
                  note: r.source === 'age-gap' ? 'vet → rookie' : r.source,
                  tone: 'mentor',
                };
              }
              const otherId = r.fromId === p.id ? r.toId : r.fromId;
              const otherP = lookup(otherId);
              if (!otherP) return null;
              return {
                kind: r.kind === 'friend' ? 'Friend' : 'Rival',
                other: otherP.nickname,
                note: r.source,
                tone: r.kind,
              };
            };
            const display = rels.map(labelFor).filter((x): x is NonNullable<typeof x> => !!x);
            if (display.length === 0) return null;
            return (
              <>
                <div className="panel-title">🤝 Relationships <span className="muted small">— {display.length}</span></div>
                <div className="relationships-list">
                  {display.map((d, i) => (
                    <div key={i} className={`relation-row tone-${d.tone}`}>
                      <span className="relation-kind">{d.kind}</span>
                      <strong>{d.other}</strong>
                      <span className="muted small">— {d.note}</span>
                    </div>
                  ))}
                </div>
                <div style={{ height: 12 }} />
              </>
            );
          })()}
          {p.honours && p.honours.length > 0 && (
            <>
              <div className="panel-title">🏆 Career Honours <span className="muted small">— {p.honours.length}</span></div>
              <div className="honours-list">
                {[...p.honours].reverse().map((h, i) => (
                  <div key={i} className="honour-row">
                    <span className="honour-year">{h.year}</span>
                    <span className="honour-label">{AWARD_LABEL[h.kind]}</span>
                    {h.stat && <span className="muted small">— {h.stat}</span>}
                  </div>
                ))}
              </div>
              <div style={{ height: 12 }} />
            </>
          )}
          <div className="panel-title">Season Stats</div>
          <div className="kv-rows">
            <div className="kv"><span>Maps</span><span>{p.stats.maps}</span></div>
            <div className="kv"><span>Kills</span><span>{p.stats.kills}</span></div>
            <div className="kv"><span>Deaths</span><span>{p.stats.deaths}</span></div>
            <div className="kv"><span>Assists</span><span>{p.stats.assists}</span></div>
            <div className="kv"><span>K/D</span><span>{kdRatio(p)}</span></div>
            <div className="kv"><span>Rating</span><span>{p.stats.rating.toFixed(2)}</span></div>
            <div className="kv"><span>Opening Kills</span><span>{p.stats.openingKills}</span></div>
            <div className="kv"><span>Clutches Won</span><span>{p.stats.clutchesWon}</span></div>
            <div className="kv">
              <span>Utility Damage</span>
              <span>
                {p.stats.utilityDamage} {p.stats.maps > 0 && (
                  <span className="muted small">({(p.stats.utilityDamage / p.stats.maps).toFixed(1)} per map)</span>
                )}
              </span>
            </div>
          </div>
          {p.injury && (() => {
            const days = daysUntil(game.currentDate, p.injury.returnDate);
            return (
              <div className="injury-panel" style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, letterSpacing: 1, fontWeight: 800 }}>
                  🚑 INJURED — <strong>{p.injury.severity.toUpperCase()} {p.injury.type.replace('-', ' ').toUpperCase()}</strong>
                  <span style={{ marginLeft: 8, color: '#e88578' }}>· {days} {days === 1 ? 'day' : 'days'} left</span>
                </div>
                <p style={{ margin: '6px 0', fontSize: 12.5 }}>{p.injury.description}</p>
                <div className="muted small">
                  Out from {fmtDate(p.injury.startedOn)} → expected back <strong>{fmtDate(p.injury.returnDate)}</strong>.
                  Cannot be selected for matches until cleared.
                </div>
              </div>
            );
          })()}
          <div className="panel-title" style={{ marginTop: 12 }}>Condition</div>
          <div className="kv-rows">
            <div className="kv"><span>Form</span><span>{p.form.toFixed(1)} / 20</span></div>
            <div className="kv"><span>Morale</span><span>{p.morale.toFixed(1)} / 20</span></div>
            <div className="kv"><span>Fatigue</span><span>{p.fatigue.toFixed(0)}%</span></div>
          </div>
          {isOwn && (
            <>
              <div className="panel-title" style={{ marginTop: 12 }}>Individual Training</div>
              <p className="muted small">
                Overrides team training for this player only. <strong>Development Role</strong> retrains
                the player toward another role's key attrs (and grows role familiarity +3-5/month).
                <strong> Focus group</strong> picks an attr pair instead. Personal sessions cost ~15%
                efficiency and skip the specialist-coach bonus, but they let you steer one player
                independently of the squad's focus. The Training screen forecast tags affected players
                with a PERSONAL or ROLE badge.
              </p>
              <div className="kv">
                <span>Development Role</span>
                <select
                  className="select"
                  value={p.developmentTarget ?? ''}
                  onChange={(e) => setPlayerDevelopmentTarget(p.id, (e.target.value || null) as import('../../types').PlayerRole | null)}
                >
                  <option value="">— None (use Focus group below) —</option>
                  {ROLE_DISPLAY_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {r}{r === p.role ? ' (natural)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {p.developmentTarget && (
                <div className="muted small" style={{ marginTop: 4, paddingLeft: 4 }}>
                  Focus attrs: <strong>{topAttrsForRole(p.developmentTarget, 6).join(', ')}</strong>
                </div>
              )}
              <div className="kv" style={{ marginTop: 8 }}>
                <span>Focus (attr group)</span>
                <select
                  className="select"
                  value={p.individualFocus ?? 'auto'}
                  disabled={!!p.developmentTarget}
                  title={p.developmentTarget ? 'Development Role overrides Focus group' : ''}
                  onChange={(e) => setPlayerFocus(p.id, e.target.value as import('../../types').IndividualFocus)}
                >
                  <option value="auto">Auto (balanced)</option>
                  <option value="aim">Aim & Reflexes</option>
                  <option value="utility">Utility & Positioning</option>
                  <option value="tactics">Game Sense & Leadership</option>
                  <option value="teamplay">Teamwork & Communication</option>
                  <option value="composure">Composure & Clutch</option>
                </select>
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">Contract</div>
          {p.contract ? (
            <div className="kv-rows">
              <div className="kv"><span>Wage</span><span>{money(p.contract.wage)}/mo</span></div>
              <div className="kv"><span>Expires</span><span>{fmtDate(p.contract.expires)}</span></div>
              <div className="kv"><span>Buyout</span><span>{money(p.contract.buyout)}</span></div>
            </div>
          ) : (
            <div className="muted">No contract — free agent.</div>
          )}

          <div className="panel-title" style={{ marginTop: 14 }}>Actions</div>
          <div className="action-stack">
            {isOwn && (
              <>
                <div className="action-row">
                  <button
                    className="btn"
                    disabled={!canInteract}
                    title={canInteract ? 'Praise recent performances' : 'You already spoke with this player this week'}
                    onClick={() => interactPlayer(p.id, 'praise')}
                  >
                    Praise
                  </button>
                  <button
                    className="btn"
                    disabled={!canInteract}
                    title={canInteract ? 'Criticize recent performances' : 'You already spoke with this player this week'}
                    onClick={() => interactPlayer(p.id, 'criticize')}
                  >
                    Criticize
                  </button>
                </div>
                <div className="action-row tier-row">
                  <span className="muted small" style={{ alignSelf: 'center', marginRight: 4 }}>
                    Squad tier:
                  </span>
                  {(['first', 'reserve', 'youth'] as const).map((t) => {
                    const active = (p.squadTier ?? 'first') === t;
                    const label = t === 'first' ? '★ First Team' : t === 'reserve' ? 'Reserve' : 'Youth';
                    return (
                      <button
                        key={t}
                        className={`btn btn-tiny ${active ? 'btn-accent' : ''}`}
                        disabled={active}
                        onClick={() => setPlayerSquadTier(p.id, t)}
                        title={
                          t === 'first'
                            ? 'Eligible for matches — slot in via Squad formation pitch'
                            : t === 'reserve'
                              ? 'Trains under staff, but ineligible for matches'
                              : 'Wonderkid development — same training, no match risk'
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button className="btn" onClick={() => listPlayer(p.id, !p.transferListed)}>
                  {p.transferListed ? 'Remove from Transfer List' : 'Add to Transfer List'}
                </button>
                <div className="action-row">
                  <input
                    className="input input-num"
                    type="number"
                    value={wage}
                    min={0}
                    step={1000}
                    onChange={(e) => setWage(Number(e.target.value))}
                  />
                  <select className="input" value={years} onChange={(e) => setYears(Number(e.target.value))}>
                    <option value={1}>1 year</option>
                    <option value={2}>2 years</option>
                    <option value={3}>3 years</option>
                  </select>
                  <button className="btn btn-accent" onClick={() => renewContract(p.id, wage, years)}>
                    Offer Renewal
                  </button>
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    if (window.confirm(`Release ${p.nickname}? A settlement of ${money((p.contract?.wage ?? 0) * 2)} will be paid.`)) {
                      releasePlayer(p.id);
                      go('squad');
                    }
                  }}
                >
                  Release Player
                </button>
              </>
            )}
            {!isOwn && !isFreeAgent && (
              <div className="action-row">
                <input
                  className="input input-num"
                  type="number"
                  value={fee}
                  min={0}
                  step={25000}
                  onChange={(e) => setFee(Number(e.target.value))}
                />
                <button className="btn btn-accent" disabled={fee > user.budget} onClick={() => bidForPlayer(p.id, fee)}>
                  Submit Bid
                </button>
              </div>
            )}
            {isFreeAgent && (
              <div className="action-row">
                <input
                  className="input input-num"
                  type="number"
                  value={faWage}
                  min={0}
                  step={1000}
                  onChange={(e) => setFaWage(Number(e.target.value))}
                />
                <button className="btn btn-accent" onClick={() => signFreeAgent(p.id, faWage)}>
                  Sign Free Agent
                </button>
              </div>
            )}
            {!revealed && (
              <button className="btn" disabled={user.budget < 15000} onClick={() => scoutPlayer(p.id)}>
                Scout Player ({money(15000)})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
