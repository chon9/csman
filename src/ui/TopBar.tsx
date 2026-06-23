import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../store/gameStore';
import { fmtDate, money } from './util';
import { play as playSound, unlockAudio } from '../sound/soundManager';

/** Day-tick speed when auto-advancing through quiet stretches (ms per day). */
const TICK_MS = 70;
/** Hard cap on days to skip in one Continue click — prevents runaway loops. */
const MAX_SKIP = 60;

export default function TopBar() {
  const game = useGame((s) => s.game)!;
  const advanceDay = useGame((s) => s.advanceDay);
  const go = useGame((s) => s.go);

  const team = game.teams[game.userTeamId];
  const unattached = !!game.managerUnattached;
  // While unattached the manager has no club, so no "match day" can trigger.
  const matchToday = !unattached && game.schedule.some(
    (m) =>
      m.date === game.currentDate &&
      m.status === 'scheduled' &&
      (m.teamAId === game.userTeamId || m.teamBId === game.userTeamId),
  );

  // ===== Unresolved-matter detection (FM-style "Respond Required" gating) =====
  // Highest-priority unresolved item is what the button jumps to. Match day
  // still trumps everything (already its own branch above).
  const respond = (() => {
    const pendingPress = (game.pressConferences ?? []).length;
    if (pendingPress > 0) return { label: 'Press Awaiting', count: pendingPress, screen: 'home' as const };
    const concerns = (game.playerConcerns ?? []).length;
    if (concerns > 0) return { label: 'Player Wants Talk', count: concerns, screen: 'home' as const };
    const jobOffers = (game.managerJobOffers ?? []).length;
    if (jobOffers > 0) return { label: 'Job Offer', count: jobOffers, screen: 'manager' as const };
    const negotiationsNeedingMove = game.offers.filter(
      (o) => o.status === 'club-counter' || o.status === 'player-counter' || o.status === 'personal-terms',
    ).length;
    if (negotiationsNeedingMove > 0) return { label: 'Negotiation', count: negotiationsNeedingMove, screen: 'transfers' as const };
    const incomingBids = game.offers.filter((o) => o.direction === 'in' && o.status === 'pending').length;
    if (incomingBids > 0) return { label: 'Bid Received', count: incomingBids, screen: 'transfers' as const };
    const sponsorOffers = (game.sponsorOffers ?? []).length;
    if (sponsorOffers > 0) return { label: 'Sponsor Offer', count: sponsorOffers, screen: 'finances' as const };
    return null;
  })();

  // Auto-advance state
  const [advancing, setAdvancing] = useState(false);
  const [daysSkipped, setDaysSkipped] = useState(0);
  const advanceRef = useRef<number | null>(null);

  // Snapshot stop-condition signals so we know when something new happened.
  const inboxLenRef = useRef(game.inbox.length);
  const concernsLenRef = useRef((game.playerConcerns ?? []).length);
  const pressLenRef = useRef((game.pressConferences ?? []).length);
  const offersLenRef = useRef((game.sponsorOffers ?? []).length);
  const startSeasonRef = useRef(game.seasonYear);
  // Count of tournaments that have STARTED (have a tournamentState entry).
  // We pause auto-advance when a new tournament kicks off so the user can browse
  // Bc Gaming and place pre-tournament bets.
  const tournamentsStartedRef = useRef(Object.keys(game.tournamentStates ?? {}).length);

  function stopAdvance() {
    if (advanceRef.current != null) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
    setAdvancing(false);
  }

  function shouldStop(): boolean {
    const st = useGame.getState();
    if (!st.game) return true;
    const g = st.game;
    // Match day: immediate stop (skip while between jobs — no club to manage).
    if (!g.managerUnattached) {
      const todayMatch = g.schedule.some(
        (m) =>
          m.date === g.currentDate &&
          m.status === 'scheduled' &&
          (m.teamAId === g.userTeamId || m.teamBId === g.userTeamId),
      );
      if (todayMatch) return true;
    }
    // Pending press conference / concerns require attention
    if ((g.pressConferences ?? []).length > pressLenRef.current) return true;
    if ((g.playerConcerns ?? []).length > concernsLenRef.current) return true;
    // New sponsor offers (only meaningful ones)
    if ((g.sponsorOffers ?? []).length > offersLenRef.current) return true;
    // Season rollover happened
    if (g.seasonYear !== startSeasonRef.current) return true;
    // A new tournament just kicked off — pause so the user can place bets on
    // the fresh slate of matches in Bc Gaming.
    const startedNow = Object.keys(g.tournamentStates ?? {}).length;
    if (startedNow > tournamentsStartedRef.current) return true;
    // New high-priority inbox (>= 3 new messages in a stretch = enough to read)
    if (g.inbox.length - inboxLenRef.current >= 5) return true;
    return false;
  }

  function tick() {
    advanceDay();
    setDaysSkipped((n) => n + 1);
    playSound('tick');
    // Stop check
    const st = useGame.getState();
    const newDate = st.game?.currentDate;
    if (newDate !== game.currentDate && shouldStop()) {
      stopAdvance();
      return;
    }
    // Date didn't change (stuck on match day etc.) — bail
    if (newDate === game.currentDate) {
      stopAdvance();
      return;
    }
    if (daysSkipped + 1 >= MAX_SKIP) {
      stopAdvance();
      return;
    }
    advanceRef.current = window.setTimeout(tick, TICK_MS);
  }

  function handleClick() {
    unlockAudio();
    if (matchToday) {
      // Match day: single advance, takes us to matchday screen
      advanceDay();
      return;
    }
    if (advancing) {
      stopAdvance();
      return;
    }
    // Respond Required mode: jump to the relevant screen instead of advancing.
    if (respond) {
      go(respond.screen);
      return;
    }
    // Start auto-advance
    inboxLenRef.current = game.inbox.length;
    concernsLenRef.current = (game.playerConcerns ?? []).length;
    pressLenRef.current = (game.pressConferences ?? []).length;
    offersLenRef.current = (game.sponsorOffers ?? []).length;
    startSeasonRef.current = game.seasonYear;
    tournamentsStartedRef.current = Object.keys(game.tournamentStates ?? {}).length;
    setDaysSkipped(0);
    setAdvancing(true);
    advanceRef.current = window.setTimeout(tick, TICK_MS);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (advanceRef.current != null) window.clearTimeout(advanceRef.current);
    };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-date" key={game.currentDate}>
        <span className="date-tick">{fmtDate(game.currentDate)}</span>
        {advancing && daysSkipped > 0 && (
          <span className="advance-counter">advancing… +{daysSkipped}d</span>
        )}
      </div>
      <div className="topbar-stats">
        {unattached ? (
          <div className="topbar-stat">
            <span className="stat-label">Status</span>
            <span className="stat-value" style={{ color: '#f59e0b' }}>Between jobs · awaiting offer</span>
          </div>
        ) : (
          <>
            <div className="topbar-stat">
              <span className="stat-label">Team</span>
              <span className="stat-value">{team.name}</span>
            </div>
            <div className="topbar-stat">
              <span className="stat-label">Budget</span>
              <span className="stat-value">{money(team.budget)}</span>
            </div>
            <div className="topbar-stat">
              <span className="stat-label">World Rank</span>
              <span className="stat-value">#{team.worldRanking}</span>
            </div>
          </>
        )}
      </div>
      <SearchPalette />
      <button
        className={`btn btn-continue ${matchToday ? 'btn-matchday' : ''} ${advancing ? 'btn-advancing' : ''} ${respond && !matchToday && !advancing ? 'btn-respond' : ''}`}
        onClick={handleClick}
        title={
          respond && !matchToday && !advancing
            ? `Action required — jump to ${respond.label.toLowerCase()}`
            : matchToday
              ? 'Match Day — play your fixture'
              : advancing
                ? 'Click to stop auto-advancing'
                : 'Advance the clock'
        }
      >
        {matchToday
          ? 'Match Day'
          : advancing
            ? `Stop (+${daysSkipped}d)`
            : respond
              ? `Respond Required · ${respond.label}${respond.count > 1 ? ` (${respond.count})` : ''}`
              : 'Continue'}
      </button>
    </header>
  );
}

// ============ Global search (teams + players) ============
function SearchPalette() {
  const game = useGame((s) => s.game)!;
  const openTeam = useGame((s) => s.openTeam);
  const openPlayer = useGame((s) => s.openPlayer);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close dropdown on outside click + open on '/' or Ctrl+K shortcut.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!inField && (e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey)))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setFocused(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return { teams: [], players: [] };
    const teams = Object.values(game.teams)
      .filter((t) => t.name.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q))
      .sort((a, b) => a.worldRanking - b.worldRanking)
      .slice(0, 6);
    const players = Object.values(game.players)
      .filter((p) => {
        const full = `${p.firstName} ${p.lastName}`.toLowerCase();
        return p.nickname.toLowerCase().includes(q) || full.includes(q);
      })
      .sort((a, b) => b.currentAbility - a.currentAbility)
      .slice(0, 8);
    return { teams, players };
  }, [query, game.teams, game.players]);

  // Flat list for keyboard navigation.
  const flat = [
    ...results.teams.map((t) => ({ kind: 'team' as const, id: t.id })),
    ...results.players.map((p) => ({ kind: 'player' as const, id: p.id })),
  ];

  function pick(idx: number) {
    const hit = flat[idx];
    if (!hit) return;
    if (hit.kind === 'team') openTeam(hit.id);
    else openPlayer(hit.id);
    setQuery('');
    setFocused(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(activeIdx);
    }
  }

  const showDropdown = focused && query.length >= 1;

  return (
    <div className="search-wrap" ref={wrapRef}>
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        placeholder="Search teams or players (press /)"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
        onFocus={() => setFocused(true)}
        onKeyDown={onKeyDown}
      />
      {showDropdown && (
        <div className="search-dropdown">
          {flat.length === 0 ? (
            <div className="search-empty">No matches for "{query}"</div>
          ) : (
            <>
              {results.teams.length > 0 && <div className="search-section-label">Teams</div>}
              {results.teams.map((t, i) => (
                <button
                  key={t.id}
                  className={`search-result ${activeIdx === i ? 'focused' : ''}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => pick(i)}
                >
                  <strong>{t.name}</strong>
                  <span className="muted">{t.tag}</span>
                  <span className="search-result-meta">#{t.worldRanking} · {t.region}</span>
                </button>
              ))}
              {results.players.length > 0 && <div className="search-section-label">Players</div>}
              {results.players.map((p, i) => {
                const idx = results.teams.length + i;
                const teamName = p.teamId ? game.teams[p.teamId]?.tag ?? '—' : 'FA';
                return (
                  <button
                    key={p.id}
                    className={`search-result ${activeIdx === idx ? 'focused' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => pick(idx)}
                  >
                    <strong>{p.nickname}</strong>
                    <span className="muted">{p.firstName} {p.lastName}</span>
                    <span className="search-result-meta">{p.role} · {teamName} · CA {p.currentAbility}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
