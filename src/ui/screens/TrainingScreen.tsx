import { useGame } from '../../store/gameStore';
import { ALL_MAPS } from '../../types';
import type { MapName, StaffRole, TrainingFocus, TrainingSetup } from '../../types';
import { forecastWeeklyTraining } from '../../sim/daily';
import { staffForRole } from '../../data/staffPool';

const FOCUSES: { value: TrainingFocus; label: string; desc: string }[] = [
  { value: 'aim', label: 'Aim', desc: 'Deathmatch and aim drills. Improves aim and reflexes.' },
  { value: 'utility', label: 'Utility', desc: 'Grenade lineups and execute timings. Improves utility usage.' },
  { value: 'tactics', label: 'Tactics', desc: 'Demo review and strat work. Improves game sense and positioning.' },
  { value: 'teamplay', label: 'Teamplay', desc: 'Scrims and set pieces. Improves teamwork and communication.' },
  { value: 'rest', label: 'Rest', desc: 'Recovery week. Reduces fatigue and lifts morale slightly.' },
  { value: 'map-prep', label: 'Map Prep', desc: 'Dedicated prep on one map. Raises team proficiency there.' },
];

interface FaceitTier {
  value: 'none' | 'basic' | 'pro' | 'premium';
  label: string;
  cost: number;
  boost: string;
  desc: string;
}

const FACEIT_TIERS: FaceitTier[] = [
  { value: 'none', label: 'None', cost: 0, boost: 'baseline', desc: 'No Faceit subscription. Standard training only.' },
  { value: 'basic', label: 'Basic', cost: 5_000, boost: '+15%', desc: 'Faceit Basic — extra reps on the public ladder.' },
  { value: 'pro', label: 'Pro', cost: 20_000, boost: '+35%', desc: 'Faceit Pro hub — tournaments, anti-cheat, FACEIT Points.' },
  { value: 'premium', label: 'Premium', cost: 60_000, boost: '+65%', desc: 'Faceit Pro EU/NA — top hubs, big rooms, top tier exposure.' },
];

export default function TrainingScreen() {
  const game = useGame((s) => s.game)!;
  const setTraining = useGame((s) => s.setTraining);

  const tr = game.training;
  const team = game.teams[game.userTeamId];
  const players = team.playerIds.map((id) => game.players[id]).filter(Boolean);
  const history = game.trainingHistory ?? [];
  const streak = tr.focusStreak ?? 1;
  const avgFatigue = players.length
    ? players.reduce((s, p) => s + p.fatigue, 0) / players.length
    : 0;
  const overtrainingRisk = tr.intensity === 3 && avgFatigue > 65;

  // ----- Next-week forecast (mirrors applyWeeklyTraining math) -----
  const FOCUS_TO_COACH: Record<TrainingSetup['focus'], StaffRole | null> = {
    aim: 'AimCoach',
    utility: 'UtilityCoach',
    tactics: 'TacticsCoach',
    teamplay: 'TacticsCoach',
    rest: null,
    'map-prep': 'TacticsCoach',
  };
  const forecast = forecastWeeklyTraining(team, game.players, tr, (focus) => {
    const role = FOCUS_TO_COACH[focus];
    if (!role) return null;
    const c = staffForRole(game, game.userTeamId, role);
    return c ? { skill: c.skill } : null;
  });
  const teamExpectedGains = forecast.players.reduce((s, f) => s + f.expectedGains, 0);
  const teamRegressionRisk = forecast.players.reduce((s, f) => s + f.regressionChance, 0);

  return (
    <div className="screen">
      <h2 className="screen-title">Training</h2>

      {(streak >= 3 || overtrainingRisk) && (
        <div className="panel training-warnings">
          {streak >= 3 && tr.focus !== 'rest' && tr.focus !== 'map-prep' && (
            <div className="training-warn">
              ⚠ <strong>Stale focus:</strong> {streak} weeks on <em>{tr.focus}</em> — diminishing returns kicking in
              ({Math.round(Math.max(30, 100 - (streak - 2) * 18))}% of normal gain rate). Rotate to another focus or
              take a rest week.
            </div>
          )}
          {overtrainingRisk && (
            <div className="training-warn warn-danger">
              🚑 <strong>Overtraining risk:</strong> Heavy intensity with squad avg fatigue {avgFatigue.toFixed(0)}% —
              fatigued players may <em>regress</em> in attributes and lose morale this week. Drop to Normal/Light or
              schedule a rest week.
            </div>
          )}
        </div>
      )}

      <div className="training-grid">
        <div className="panel">
          <div className="panel-title">Weekly Focus</div>
          <div className="focus-cards">
            {FOCUSES.map((f) => (
              <button
                key={f.value}
                className={`focus-card ${tr.focus === f.value ? 'selected' : ''}`}
                onClick={() =>
                  setTraining({
                    ...tr,
                    focus: f.value,
                    mapPrep: f.value === 'map-prep' ? (tr.mapPrep ?? ALL_MAPS[0]) : null,
                  })
                }
              >
                <div className="focus-card-label">{f.label}</div>
                <div className="focus-card-desc">{f.desc}</div>
              </button>
            ))}
          </div>

          {tr.focus === 'map-prep' && (
            <label className="field" style={{ marginTop: 12 }}>
              <span className="field-label">Map to prepare</span>
              <select
                className="input"
                value={tr.mapPrep ?? ALL_MAPS[0]}
                onChange={(e) => setTraining({ ...tr, mapPrep: e.target.value as MapName })}
              >
                {ALL_MAPS.map((m) => (
                  <option key={m} value={m}>
                    {m} (prof {team.mapPool.find((mp) => mp.map === m)?.proficiency ?? '-'})
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="panel-title" style={{ marginTop: 14 }}>Intensity</div>
          <div className="intensity-row">
            {[1, 2, 3].map((i) => (
              <button
                key={i}
                className={`btn ${tr.intensity === i ? 'btn-accent' : ''}`}
                onClick={() => setTraining({ ...tr, intensity: i })}
              >
                {i === 1 ? 'Light' : i === 2 ? 'Normal' : 'Heavy'}
              </button>
            ))}
          </div>
          <p className="muted small">
            Heavier training develops attributes faster but builds fatigue. Training is applied every Monday.
          </p>

          <div className="panel-title" style={{ marginTop: 18 }}>Faceit Hub Subscription</div>
          <p className="muted small">
            Faceit hubs give your squad extra reps outside official scrims — boosting monthly youth development for
            every player on the roster (first-team, reserves, and academy). Deducted on the 1st of each month.
          </p>
          <div className="focus-cards">
            {FACEIT_TIERS.map((t) => (
              <button
                key={t.value}
                className={`focus-card ${(tr.faceitTier ?? 'none') === t.value ? 'selected' : ''}`}
                onClick={() => setTraining({ ...tr, faceitTier: t.value })}
              >
                <div className="focus-card-label">
                  {t.label}{' '}
                  <span className="muted small" style={{ marginLeft: 6 }}>
                    {t.cost > 0 ? `$${(t.cost / 1000).toFixed(0)}k/mo` : 'free'}
                  </span>
                </div>
                <div className="focus-card-desc">
                  <strong>{t.boost} dev rate</strong> · {t.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            Recent Training Weeks
            <span className="muted small"> — last {Math.min(8, history.length)} weeks</span>
          </div>
          {history.length === 0 ? (
            <p className="muted small">No training history yet — advance past a Monday to see your first weekly report.</p>
          ) : (
            <div className="training-history">
              {history.map((w, i) => (
                <div key={i} className="training-week">
                  <div className="training-week-head">
                    <span className="training-week-date">{w.date}</span>
                    <span className="training-week-focus">{w.focus}</span>
                    <span className="muted small">
                      {w.intensity === 1 ? 'Light' : w.intensity === 2 ? 'Normal' : 'Heavy'}
                    </span>
                    <span className="training-week-tally">
                      {w.gains > 0 && <span className="text-win">+{w.gains}</span>}
                      {w.gains > 0 && w.regressions > 0 && ' · '}
                      {w.regressions > 0 && <span className="text-loss">−{w.regressions}</span>}
                      {w.gains === 0 && w.regressions === 0 && (
                        <span className="muted small">no change</span>
                      )}
                    </span>
                  </div>
                  {w.notes.length > 0 && (
                    <details>
                      <summary className="muted small">{w.notes.length} note{w.notes.length === 1 ? '' : 's'}</summary>
                      <ul className="training-week-notes">
                        {w.notes.map((n, j) => (
                          <li key={j} className="small">{n}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel table-panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title">
            Next Week Forecast
            <span className="muted small" style={{ marginLeft: 8 }}>
              — {tr.focus === 'rest' ? 'Rest' : tr.focus === 'map-prep' ? 'Map Prep' : tr.focus} ·{' '}
              {tr.intensity === 1 ? 'Light' : tr.intensity === 2 ? 'Normal' : 'Heavy'}
            </span>
          </div>

          <div className="forecast-summary">
            <div className="forecast-chip">
              <span className="forecast-chip-k">Team gains</span>
              <span className="forecast-chip-v">≈ {teamExpectedGains.toFixed(2)} attr pts</span>
              <span className="muted small">expected this week</span>
            </div>
            <div className={`forecast-chip ${teamRegressionRisk > 0.15 ? 'warn' : ''}`}>
              <span className="forecast-chip-k">Regression risk</span>
              <span className="forecast-chip-v">{(teamRegressionRisk * 100).toFixed(0)}%</span>
              <span className="muted small">≥1 player loses an attr</span>
            </div>
            <div className={`forecast-chip ${forecast.staleMul < 1 ? 'warn' : ''}`}>
              <span className="forecast-chip-k">Staleness</span>
              <span className="forecast-chip-v">×{forecast.staleMul.toFixed(2)}</span>
              <span className="muted small">week {forecast.streak} on this focus</span>
            </div>
            <div className={`forecast-chip ${forecast.specialistMul > 1.05 ? 'ok' : forecast.specialistMul < 0.95 ? 'warn' : ''}`}>
              <span className="forecast-chip-k">Specialist</span>
              <span className="forecast-chip-v">×{forecast.specialistMul.toFixed(2)}</span>
              <span className="muted small">{forecast.specialistMul === 1 ? 'no coach assigned' : 'assigned coach'}</span>
            </div>
          </div>

          {forecast.focusAttrs.length === 0 ? (
            <div className="muted small" style={{ padding: '8px 4px' }}>
              {tr.focus === 'rest'
                ? 'Rest week — no attribute training. Squad-wide −18 fatigue, +0.5 morale.'
                : 'Map prep week — squad-wide proficiency work on the chosen map. No individual attribute growth.'}
            </div>
          ) : (
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Age</th>
                  <th className="num">CA/PA</th>
                  <th>Focus attrs</th>
                  <th className="num" title="Probability each focus attr ticks up (+1) this week. Two rolls = two target attrs.">+1 chance</th>
                  <th className="num" title="Sum of probabilities across the focus attrs — roughly how many attribute points to expect.">Expected</th>
                  <th>Risk</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {forecast.players.map((f) => {
                  const p = game.players[f.playerId];
                  if (!p) return null;
                  const grow = f.perAttrGrowChance;
                  const growPct = (grow * 100).toFixed(0);
                  const regPct = (f.regressionChance * 100).toFixed(0);
                  const focusAttrLabels = f.focusAttrs.map((a) => {
                    const v = p.attributes[a];
                    const at20 = v >= 20;
                    return (
                      <span key={a} className={`attr-pill ${at20 ? 'attr-pill-cap' : ''}`}>
                        {a} {v}
                      </span>
                    );
                  });
                  const status = f.blocker
                    ? <span className="muted small">{f.blocker}</span>
                    : grow >= 0.20
                      ? <span className="text-win">strong growth window</span>
                      : grow >= 0.08
                        ? <span>steady progression</span>
                        : <span className="muted small">slow — limited upside</span>;
                  const focusBadge =
                    f.focusSource === 'role'
                      ? <span className="focus-source-pill src-role" title="Personal Development Role overrides team focus">ROLE</span>
                      : f.focusSource === 'individual'
                        ? <span className="focus-source-pill src-individual" title="Personal Focus overrides team focus (-15% efficiency, no specialist coach boost)">PERSONAL</span>
                        : null;
                  return (
                    <tr key={f.playerId}>
                      <td><span className="player-nick">{p.nickname}</span></td>
                      <td>{p.age}</td>
                      <td className={`num ${f.capReached ? 'text-loss' : ''}`}>
                        {p.currentAbility}/{p.potentialAbility}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          {focusAttrLabels}
                          {focusBadge}
                        </div>
                      </td>
                      <td className={`num ${grow >= 0.15 ? 'text-win' : grow < 0.05 ? 'text-loss' : ''}`}>
                        {f.capReached ? '—' : `${growPct}%`}
                      </td>
                      <td className="num">{f.expectedGains.toFixed(2)}</td>
                      <td>
                        {f.regressionChance > 0 ? (
                          <span className="text-loss" title="Heavy intensity + fatigue >80 → may lose an attr">
                            🚑 {regPct}% regress
                          </span>
                        ) : f.veteranWearChance > 0 ? (
                          <span className="muted small" title="30+ player on heavy intensity — may lose form">
                            veteran wear
                          </span>
                        ) : (
                          <span className="muted small">low</span>
                        )}
                      </td>
                      <td>{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <details className="forecast-howto">
            <summary className="muted small">How training works (click to expand)</summary>
            <div className="forecast-howto-body">
              <p>
                Training focus is <strong>team-wide by default</strong> — every player works on the same two attributes
                ({tr.focus === 'rest' || tr.focus === 'map-prep' ? '—' : forecast.focusAttrs.join(' + ')}).
                Each player gets <strong>independent rolls</strong> for those attrs every Monday.
              </p>
              <p>
                <strong>Personal Training overrides this per player.</strong> On the player's profile, setting a
                <em> Focus group</em> (PERSONAL badge) or <em>Development Role</em> (ROLE badge) makes that player
                train their own attributes instead — useful for retraining a Support into a Lurker, or pushing a
                young AWPer's aim while the squad drills utility. Personal sessions pay a small efficiency tax
                (0.85×) and don't benefit from the specialist coach.
              </p>
              <ul className="forecast-howto-list">
                <li><strong>Growth chance</strong> = 5% × intensity × age-factor × (coach skill / 12) × specialist × staleness × personal-tax.</li>
                <li><strong>Age factor:</strong> ≤21 → 1.0×, ≤25 → 0.6×, ≤29 → 0.3×, 30+ → 0.1×. Past 30, gains are rare.</li>
                <li><strong>Cap:</strong> a player at CA = PA <em>can't grow</em>. Individual attrs cap at 20.</li>
                <li><strong>Regression:</strong> heavy intensity + fatigue &gt; 80 → 6% chance to <em>lose</em> an attr and morale.</li>
                <li><strong>Veteran wear:</strong> heavy intensity on age 30+ → 35% chance of −1 form (no attr loss).</li>
                <li><strong>Stale focus:</strong> same focus 3+ weeks running shaves 18% off growth per extra week (floor 30%).</li>
                <li><strong>Specialist coach</strong> (Aim/Utility/Tactics): 0.5× → 1.8× — only helps players on the team focus.</li>
                <li><strong>Personal training tax:</strong> 0.85× per-attr chance vs. team-focus drillers; no specialist bonus.</li>
                <li><strong>Rest week:</strong> no growth; −18 fatigue, +0.5 morale squad-wide.</li>
                <li><strong>Map Prep:</strong> single roll for map proficiency (50% + coach/40), other maps decay slowly.</li>
              </ul>
            </div>
          </details>
        </div>

        <div className="panel table-panel">
          <div className="panel-title">Squad Condition</div>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th className="num">Form</th>
                <th className="num">Morale</th>
                <th className="num">Fatigue</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="player-nick">{p.nickname}</span>
                  </td>
                  <td>{p.role}</td>
                  <td className="num">{p.form.toFixed(1)}</td>
                  <td className={`num ${p.morale >= 14 ? 'text-win' : p.morale <= 7 ? 'text-loss' : ''}`}>
                    {p.morale.toFixed(1)}
                  </td>
                  <td className={`num ${p.fatigue >= 60 ? 'text-loss' : p.fatigue <= 25 ? 'text-win' : ''}`}>
                    {p.fatigue.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
