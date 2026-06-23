import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { ATTRIBUTE_KEYS } from '../../types';
import type { Player } from '../../types';
import { ATTR_SHORT, attrClass, daysUntil, fmtShortDate, kdRatio, money } from '../util';
import { FormationPitch } from '../FormationPitch';
import { familiarityTier, roleFamiliarityPoints } from '../../sim/playerAnalytics';

type Tier = 'first' | 'reserve' | 'youth';

export default function SquadScreen() {
  const game = useGame((s) => s.game)!;
  const openPlayer = useGame((s) => s.openPlayer);
  const setPlayerSquadTier = useGame((s) => s.setPlayerSquadTier);
  const setRoleSlot = useGame((s) => s.setRoleSlot);

  const team = game.teams[game.userTeamId];
  const players = team.playerIds.map((id) => game.players[id]).filter(Boolean);
  const slots = game.tactics.roleSlots ?? [];

  // FM-style click-to-pick: click any slot on the formation pitch, then pick
  // any healthy squad player. Reserves/youth auto-promote. No "↑ First" dance.
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);

  function pickPlayerForSlot(slotIdx: number, playerId: string) {
    const player = game.players[playerId];
    if (!player) return;
    // Assign to the slot first — setRoleSlot's swap-protection keeps the lineup unique.
    setRoleSlot(slotIdx, { playerId });
    // If they came from reserves/youth, promote so the engine treats them as eligible.
    if ((player.squadTier ?? 'first') !== 'first') {
      setPlayerSquadTier(playerId, 'first');
    }
    setPickingSlot(null);
  }

  function tierOf(p: Player): Tier {
    return p.squadTier ?? 'first';
  }

  const firstTeam = players.filter((p) => tierOf(p) === 'first');
  const reserves = players.filter((p) => tierOf(p) === 'reserve');
  const youth = players.filter((p) => tierOf(p) === 'youth');

  const go = useGame((s) => s.go);

  return (
    <div className="screen">
      <h2 className="screen-title">Squad</h2>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-title">
          Starting Lineup
          <span className="muted small"> — click any slot to swap in a player. Reserves auto-promote.</span>
          <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => go('tactics')}>
            Roles & duties →
          </button>
        </div>
        <FormationPitch
          team={team}
          slots={slots}
          selectedIdx={pickingSlot}
          onSlotClick={(idx) => setPickingSlot(pickingSlot === idx ? null : idx)}
          compact
        />
        {pickingSlot !== null && slots[pickingSlot] && (
          <SlotPicker
            slotRole={slots[pickingSlot].role}
            currentPlayerId={slots[pickingSlot].playerId}
            allPlayers={players}
            onPick={(pid) => pickPlayerForSlot(pickingSlot, pid)}
            onCancel={() => setPickingSlot(null)}
          />
        )}
      </div>

      <TierSection
        title="First Team"
        subtitle={`${firstTeam.length} players — first 5 are your starting lineup`}
        tier="first"
        players={firstTeam}
        startersCount={5}
        openPlayer={openPlayer}
        currentDate={game.currentDate}
      />

      <TierSection
        title="Reserves"
        subtitle={`${reserves.length} players — train under your staff but ineligible for matches. Promote to play.`}
        tier="reserve"
        players={reserves}
        startersCount={0}
        openPlayer={openPlayer}
        currentDate={game.currentDate}
      />

      <TierSection
        title="Youth Academy"
        subtitle={`${youth.length} players — wonderkids in development. Same training, no match risk.`}
        tier="youth"
        players={youth}
        startersCount={0}
        openPlayer={openPlayer}
        currentDate={game.currentDate}
      />

      <p className="muted small">
        Only first-team players can be slotted into matches. Reserves and Youth still benefit from monthly training and
        develop over time — buy young, train, then promote or sell.
      </p>
    </div>
  );
}

interface TierSectionProps {
  title: string;
  subtitle: string;
  tier: Tier;
  players: Player[];
  startersCount: number;
  openPlayer: (id: string) => void;
  currentDate: string;
}

function TierSection({ title, subtitle, tier, players, startersCount, openPlayer, currentDate }: TierSectionProps) {
  return (
    <div className="panel table-panel" style={{ marginBottom: 12 }}>
      <div className="panel-title">
        {title} <span className="muted small">— {subtitle}</span>
      </div>
      {players.length === 0 ? (
        <p className="muted small" style={{ padding: '6px 8px' }}>
          {tier === 'first' ? 'No first-team players! Promote from reserves to field a side.' : 'Empty.'}
        </p>
      ) : (
        <table className="table table-dense">
          <thead>
            <tr>
              <th></th>
              <th>Player</th>
              <th>Age</th>
              <th>Nat</th>
              <th>Role</th>
              <th className="num">CA</th>
              <th className="num">PA</th>
              {ATTRIBUTE_KEYS.map((k) => (
                <th key={k} className="num attr-col" title={k}>
                  {ATTR_SHORT[k]}
                </th>
              ))}
              <th className="num">Form</th>
              <th className="num">Mor</th>
              <th className="num">Fat</th>
              <th className="num">Wage</th>
              <th>Expires</th>
              <th className="num">Rtg</th>
              <th className="num">K/D</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, idx) => {
              const starter = tier === 'first' && idx < startersCount;
              const wonderkid = (p.potentialAbility - p.currentAbility) >= 25 && p.age <= 21;
              return (
                <tr key={p.id} className={starter ? 'row-starter' : 'row-bench'}>
                  <td className="muted small">
                    {tier === 'first' ? (starter ? `S${idx + 1}` : 'Sub') : tier === 'reserve' ? 'R' : 'Y'}
                  </td>
                  <td className="clickable cell-name" onClick={() => openPlayer(p.id)}>
                    <span className="player-nick">{p.nickname}</span>{' '}
                    {wonderkid && <span className="wonderkid-badge" title="High potential">★</span>}{' '}
                    {p.injury && (() => {
                      const days = daysUntil(currentDate, p.injury.returnDate);
                      return (
                        <span className="injury-badge" title={`${p.injury.description} — back ${p.injury.returnDate}`}>
                          🚑 INJ · {days}d
                        </span>
                      );
                    })()}{' '}
                    <span className="muted small">
                      {p.firstName} {p.lastName}
                    </span>
                  </td>
                  <td>{p.age}</td>
                  <td>{p.nationality}</td>
                  <td>{p.role}</td>
                  <td className="num">{p.currentAbility}</td>
                  <td className={`num ${wonderkid ? 'text-win' : ''}`}>{p.potentialAbility}</td>
                  {ATTRIBUTE_KEYS.map((k) => (
                    <td key={k} className={`num ${attrClass(p.attributes[k])}`}>
                      {Math.round(p.attributes[k])}
                    </td>
                  ))}
                  <td className="num">{p.form.toFixed(0)}</td>
                  <td className={`num ${p.morale >= 14 ? 'text-win' : p.morale <= 7 ? 'text-loss' : ''}`}>
                    {p.morale.toFixed(0)}
                  </td>
                  <td className={`num ${p.fatigue >= 60 ? 'text-loss' : ''}`}>{p.fatigue.toFixed(0)}</td>
                  <td className="num">{p.contract ? money(p.contract.wage) : '-'}</td>
                  <td className="muted small">{p.contract ? fmtShortDate(p.contract.expires) : '-'}</td>
                  <td className="num">{p.stats.rating.toFixed(2)}</td>
                  <td className="num">{kdRatio(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============ Slot picker popover ============
// Shows all healthy squad players sorted by familiarity with the slot's role.
// Click to assign. Injured / already-slotted-here players are marked.
function SlotPicker({
  slotRole,
  currentPlayerId,
  allPlayers,
  onPick,
  onCancel,
}: {
  slotRole: import('../../types').PlayerRole;
  currentPlayerId: string | null;
  allPlayers: Player[];
  onPick: (playerId: string) => void;
  onCancel: () => void;
}) {
  const ranked = [...allPlayers]
    .filter((p) => !p.injury)
    .map((p) => ({ p, pts: roleFamiliarityPoints(p, slotRole), tier: p.squadTier ?? 'first' }))
    .sort((a, b) => b.pts - a.pts || b.p.currentAbility - a.p.currentAbility);

  return (
    <div className="slot-picker-overlay" onClick={onCancel}>
      <div className="slot-picker" onClick={(e) => e.stopPropagation()}>
        <div className="slot-picker-head">
          <span className="muted small">Pick a player for the</span>
          <strong className="slot-picker-role">{slotRole}</strong>
          <span className="muted small">slot</span>
          <button className="link-btn" onClick={onCancel} style={{ marginLeft: 'auto' }}>close ✕</button>
        </div>
        <div className="slot-picker-list">
          {ranked.map(({ p, pts, tier }) => {
            const fam = familiarityTier(pts);
            const isCurrent = p.id === currentPlayerId;
            return (
              <button
                key={p.id}
                className={`slot-picker-row ${isCurrent ? 'is-current' : ''}`}
                onClick={() => onPick(p.id)}
                disabled={isCurrent}
              >
                <span className="slot-picker-nick">{p.nickname}</span>
                <span className="muted small">{p.role}</span>
                <span className={`slot-fam-pill fam-${fam.toLowerCase().replace(/[^a-z]/g, '')}`}>{fam}</span>
                <span className="muted small">CA {p.currentAbility}</span>
                <span className={`squad-tier-pill tier-${tier}`}>
                  {tier === 'first' ? '★ first' : tier === 'reserve' ? 'reserve' : 'youth'}
                </span>
                {isCurrent && <span className="muted small">(in this slot)</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
