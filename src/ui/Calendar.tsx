import { useMemo } from 'react';
import { useGame } from '../store/gameStore';

/**
 * Mini-calendar — shows the current month with markers for:
 *  - Today (highlighted ring)
 *  - User matches (orange dot)
 *  - Tournament boundaries (blue dot)
 *  - Major-tier events (gold star)
 *
 * Compact 7-column grid that fits in a Home panel.
 */
export default function Calendar() {
  const game = useGame((s) => s.game)!;
  const userId = game.userTeamId;

  const { year, month } = useMemo(() => {
    const [y, m] = game.currentDate.split('-');
    return { year: parseInt(y), month: parseInt(m) };
  }, [game.currentDate]);

  // Build event index for the visible month
  const eventsByDay = useMemo(() => {
    const map = new Map<string, { match?: boolean; tournamentStart?: boolean; major?: boolean }>();
    for (const m of game.schedule) {
      if (!m.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) continue;
      if (m.teamAId !== userId && m.teamBId !== userId) continue;
      const day = m.date.slice(8, 10);
      const entry = map.get(day) ?? {};
      entry.match = true;
      const t = game.tournaments[m.tournamentId];
      if (t?.isMajor) entry.major = true;
      map.set(day, entry);
    }
    for (const t of Object.values(game.tournaments)) {
      if (t.startDate.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
        const day = t.startDate.slice(8, 10);
        const entry = map.get(day) ?? {};
        entry.tournamentStart = true;
        if (t.isMajor) entry.major = true;
        map.set(day, entry);
      }
    }
    return map;
  }, [game.schedule, game.tournaments, userId, year, month]);

  // First-of-month + days-in-month (UTC to match our date logic)
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startWeekday = firstDay.getUTCDay(); // 0=Sun
  const monthName = firstDay.toLocaleString('en', { month: 'long' });
  const today = parseInt(game.currentDate.slice(8, 10));

  const cells: ({ day: number; events?: { match?: boolean; tournamentStart?: boolean; major?: boolean } } | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = String(d).padStart(2, '0');
    cells.push({ day: d, events: eventsByDay.get(key) });
  }

  return (
    <div className="mini-cal">
      <div className="mini-cal-head">{monthName} {year}</div>
      <div className="mini-cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={`h${i}`} className="mini-cal-dayhead">{d}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="mini-cal-cell empty" />;
          const isToday = cell.day === today;
          const e = cell.events;
          return (
            <div
              key={i}
              className={`mini-cal-cell ${isToday ? 'today' : ''} ${e?.match ? 'has-match' : ''} ${e?.major ? 'has-major' : ''} ${e?.tournamentStart ? 'has-tour' : ''}`}
              title={
                e?.match ? `Your match on ${cell.day}` :
                e?.tournamentStart ? `Tournament starts on ${cell.day}` :
                isToday ? 'Today' : `${cell.day}`
              }
            >
              <span className="mini-cal-day-num">{cell.day}</span>
              {(e?.match || e?.tournamentStart || e?.major) && (
                <span className="mini-cal-dots">
                  {e?.match && <span className="cal-dot dot-match" />}
                  {e?.tournamentStart && <span className="cal-dot dot-tour" />}
                  {e?.major && <span className="cal-dot dot-major">★</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mini-cal-legend">
        <span><span className="cal-dot dot-match" /> Your match</span>
        <span><span className="cal-dot dot-tour" /> Tournament start</span>
        <span><span className="cal-dot dot-major">★</span> Major</span>
      </div>
    </div>
  );
}
