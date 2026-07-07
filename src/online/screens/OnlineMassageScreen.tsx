// Massage Center — gacha-style spa session. Pay flat, roll a random
// 1-10 class masseuse, get a fatigue dump (always) + morale swing
// (negative class 1-5, positive 6-10). One booking per in-game day.

import { useOnline } from '../onlineStore';
import {
  MASSAGE_COOLDOWN_GAME_DAYS,
  MASSAGE_COST,
  massageEffects,
} from '../protocol';
import ToastStack from './ToastStack';
import Icon from '../../ui/Icon';

const PREVIEW_ROWS: Array<{ band: string; sample: number; tone: string; note: string }> = [
  { band: 'Class 1-3', sample: 2, tone: '#e25555', note: 'Cheap parlour. Players grumble — fatigue drops anyway.' },
  { band: 'Class 4-5', sample: 5, tone: '#d8956c', note: 'Mid-tier. Decent fatigue dump, small morale dip.' },
  { band: 'Class 6-7', sample: 6, tone: '#9ed18a', note: 'Pleasant clinic — fatigue and morale both move the right way.' },
  { band: 'Class 8-10', sample: 10, tone: '#f2c443', note: 'Award-winning therapists. Big recovery, big morale lift.' },
];

export default function OnlineMassageScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const bookMassage = useOnline((s) => s.bookMassage);
  const reveal = useOnline((s) => s.massageReveal);
  const dismissReveal = useOnline((s) => s.dismissMassageReveal);
  const nextEligibleDay = useOnline((s) => s.massageNextEligibleDay);
  const go = useOnline((s) => s.go);

  if (!team) return null;
  const onCooldown = nextEligibleDay > team.day;
  const canBook = !onCooldown && team.money >= MASSAGE_COST;
  const bookDisabledReason =
    onCooldown ? `Already booked — wait until in-game day ${nextEligibleDay} (next auto-tick).` :
    team.money < MASSAGE_COST ? `Need $${MASSAGE_COST.toLocaleString()} — you have $${team.money.toLocaleString()}.` :
    '';

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="sparkle" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Recovery Suite</h2>
            <div className="hero-sub">
              Book a spa session for the starting 5. Random class 1-10 — always knocks down fatigue, morale swings ± by class.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="cash" size={13} /> ${team.money.toLocaleString()}
          </span>
          <button className="btn" onClick={() => go('home')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="chevron-left" size={13} /> Back
          </button>
        </div>
      </div>

      {/* ===== Booking ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">Book session <span className="muted small">— ${MASSAGE_COST.toLocaleString()} · once per in-game day · top 5 starters</span></div>
        <button
          className="btn btn-accent"
          disabled={!canBook}
          onClick={bookMassage}
          title={bookDisabledReason}
          style={{ marginTop: 12, padding: '12px 18px', fontSize: 14 }}
        >
          💆 Book a session — ${MASSAGE_COST.toLocaleString()}
        </button>
        {onCooldown && (
          <div className="muted small" style={{ marginTop: 8, color: '#f2c443' }}>
            On cooldown until in-game day {nextEligibleDay} (your team is on day {team.day}).
          </div>
        )}
      </div>

      {/* ===== Outcome preview ===== */}
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-title">What to expect</div>
        <table className="table table-dense" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Tier</th>
              <th className="num">Fatigue Δ</th>
              <th className="num">Morale Δ</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {PREVIEW_ROWS.map((r) => {
              const fx = massageEffects(r.sample);
              return (
                <tr key={r.band}>
                  <td style={{ color: r.tone, fontWeight: 700 }}>{r.band}</td>
                  <td className="num text-win">{fx.fatigueDelta}</td>
                  <td className={`num ${fx.moraleDelta > 0 ? 'text-win' : fx.moraleDelta < 0 ? 'text-loss' : ''}`}>
                    {fx.moraleDelta > 0 ? `+${fx.moraleDelta}` : fx.moraleDelta}
                  </td>
                  <td className="muted small">{r.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: 8 }}>
          Uniform roll across class 1-10 — every visit is its own draw. Effects apply to all 5 starters.
        </div>
      </div>

      {/* ===== Reveal modal ===== */}
      {reveal && (
        <div className="modal-backdrop" onClick={dismissReveal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, padding: 18 }}>
            <div style={{ textAlign: 'center' }}>
              <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>
                Today's masseuse
              </div>
              <div
                style={{
                  border: `3px solid ${ratingColor(reveal.masseuse.rating)}`,
                  borderRadius: 12,
                  padding: 18,
                  background: `linear-gradient(135deg, ${ratingColor(reveal.masseuse.rating)}22, transparent)`,
                  boxShadow: `0 0 24px ${ratingColor(reveal.masseuse.rating)}44`,
                }}
              >
                <div style={{ fontSize: 56, marginBottom: 6 }}>{reveal.masseuse.emoji}</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{reveal.masseuse.name}</div>
                <div style={{ fontSize: 11, color: ratingColor(reveal.masseuse.rating), textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700, marginTop: 4 }}>
                  Class {reveal.masseuse.rating} / 10
                </div>
                <div className="muted small" style={{ marginTop: 10, fontStyle: 'italic', opacity: 0.85 }}>
                  "{reveal.masseuse.flavor}"
                </div>

                {/* Effect breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '8px 10px' }}>
                    <div className="muted small" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 }}>Fatigue</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#6ed09a' }}>{reveal.fatigueDelta}</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '8px 10px' }}>
                    <div className="muted small" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 }}>Morale</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: reveal.moraleDelta >= 0 ? '#6ed09a' : '#e25555' }}>
                      {reveal.moraleDelta > 0 ? `+${reveal.moraleDelta}` : reveal.moraleDelta}
                    </div>
                  </div>
                </div>
                <div className="muted small" style={{ marginTop: 8, fontSize: 10.5 }}>
                  Applied to {reveal.affectedPlayerIds.length} starter{reveal.affectedPlayerIds.length === 1 ? '' : 's'}.
                </div>
              </div>
              <button className="btn btn-accent" onClick={dismissReveal} style={{ marginTop: 14 }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastStack />
    </div>
  );
}

/** Match the colour ramp to the rating band so the reveal feels graded. */
function ratingColor(rating: number): string {
  if (rating <= 2) return '#e25555';
  if (rating <= 4) return '#d8956c';
  if (rating <= 5) return '#c2b46a';
  if (rating <= 7) return '#9ed18a';
  if (rating <= 9) return '#f2c443';
  return '#ffd700'; // class 10 — gold
}

// Cooldown helper kept inline if needed elsewhere.
export const MASSAGE_COOLDOWN_DAYS = MASSAGE_COOLDOWN_GAME_DAYS;
