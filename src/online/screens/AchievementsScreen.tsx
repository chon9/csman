// Full-page Achievements — dedicated screen accessed from the sidebar.
// Renders the entire catalogue grouped by category, each entry shown as
// a proper AAA-game badge card (tier ring, category glyph, description,
// cash reward, unlocked timestamp). Replaces the collapsible chip strip
// that used to live on the home screen — that panel now just links here.

import { useEffect, useMemo } from 'react';
import { useOnline } from '../onlineStore';
import { ACHIEVEMENT_LABELS, achievementReward } from '../protocol';
import ToastStack from './ToastStack';
import Icon, { type IconName } from '../../ui/Icon';

// ---------------------------------------------------------------------
// Category grouping
// ---------------------------------------------------------------------

interface CategoryDef {
  id: string;
  label: string;
  icon: IconName;
  kinds: string[];
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'combat', label: 'Combat', icon: 'crosshair',
    kinds: ['first_blood', 'ten_wins', 'fifty_wins', 'hundred_wins', 'two_fifty_wins', 'five_hundred_wins'],
  },
  {
    id: 'pvp', label: 'PvP', icon: 'users',
    kinds: ['pvp_first_blood', 'pvp_ten_wins', 'pvp_fifty_wins', 'pvp_hundred_wins'],
  },
  {
    id: 'streaks', label: 'Streaks & Domination', icon: 'zap',
    kinds: ['streak_5', 'streak_10', 'perfect_map', 'giant_slayer', 'underdog_win'],
  },
  {
    id: 'tournament', label: 'Tournament', icon: 'trophy',
    kinds: ['first_tournament', 'five_tournaments', 'twenty_tournaments'],
  },
  {
    id: 'economy', label: 'Economy', icon: 'cash',
    kinds: ['bankroll_100k', 'bankroll_500k', 'millionaire', 'big_money', 'mogul'],
  },
  {
    id: 'roster', label: 'Roster & Management', icon: 'squad',
    kinds: [
      'first_fa_sign', 'full_roster', 'first_goal_reached', 'first_retire',
      'coached_up', 'first_sponsor', 'first_loan', 'first_market_sale',
    ],
  },
  {
    id: 'cases', label: 'Cases & Skins', icon: 'cases',
    kinds: [
      'case_opener', 'case_addict', 'covert_drop', 'rare_special_drop',
      'white_float_drop', 'first_trade_up', 'skin_seller_5',
    ],
  },
  {
    id: 'streaming', label: 'Streaming', icon: 'stream',
    kinds: ['first_stream', 'streamer_50', 'famous'],
  },
  {
    id: 'minigames', label: 'Mini Games', icon: 'mini-games',
    kinds: ['crash_cashout_10x', 'mines_perfect', 'dragon_in_between'],
  },
  {
    id: 'social', label: 'Social', icon: 'mail',
    kinds: ['first_profile_edit', 'first_dm'],
  },
  {
    id: 'meta', label: 'Completionist', icon: 'star',
    kinds: ['collector_5', 'collector_15', 'collector_30'],
  },
];

// ---------------------------------------------------------------------
// Tier metadata — driven by cash reward tier
// ---------------------------------------------------------------------

interface Tier { label: string; color: string; ring: string }
const TIERS = {
  bronze:   { label: 'BRONZE',   color: '#cd7f32', ring: 'rgba(205, 127, 50, 0.55)' },
  silver:   { label: 'SILVER',   color: '#c0c0c0', ring: 'rgba(192, 192, 192, 0.55)' },
  gold:     { label: 'GOLD',     color: '#ffd166', ring: 'rgba(255, 209, 102, 0.65)' },
  platinum: { label: 'PLATINUM', color: '#4dd4b0', ring: 'rgba(77, 212, 176, 0.65)' },
  mythic:   { label: 'MYTHIC',   color: '#b47ef7', ring: 'rgba(180, 126, 247, 0.65)' },
} as const satisfies Record<string, Tier>;
type TierId = keyof typeof TIERS;

function tierForReward(cash: number): TierId {
  if (cash >= 250_000) return 'mythic';
  if (cash >= 100_000) return 'platinum';
  if (cash >= 50_000) return 'gold';
  if (cash >= 15_000) return 'silver';
  return 'bronze';
}

// ---------------------------------------------------------------------
// Icon per kind — falls back to the category glyph.
// ---------------------------------------------------------------------

const KIND_ICON: Partial<Record<string, IconName>> = {
  // Combat
  first_blood: 'target', ten_wins: 'crosshair', fifty_wins: 'shield',
  hundred_wins: 'shield-check', two_fifty_wins: 'trophy', five_hundred_wins: 'star',
  // PvP
  pvp_first_blood: 'target', pvp_ten_wins: 'crosshair', pvp_fifty_wins: 'shield',
  pvp_hundred_wins: 'shield-check',
  // Streaks
  streak_5: 'zap', streak_10: 'zap',
  perfect_map: 'target', giant_slayer: 'trending-up', underdog_win: 'sparkle',
  // Tournament
  first_tournament: 'trophy', five_tournaments: 'trophy', twenty_tournaments: 'trophy',
  // Economy
  bankroll_100k: 'trending-up', bankroll_500k: 'trending-up',
  millionaire: 'money-bag', big_money: 'money-bag', mogul: 'money-bag',
  // Roster
  first_fa_sign: 'user', full_roster: 'users', first_goal_reached: 'target',
  first_retire: 'clock', coached_up: 'coach', first_sponsor: 'sponsor',
  first_loan: 'briefcase', first_market_sale: 'market',
  // Cases
  case_opener: 'cases', case_addict: 'cases', covert_drop: 'sparkle',
  rare_special_drop: 'star', white_float_drop: 'sparkle',
  first_trade_up: 'refresh', skin_seller_5: 'market',
  // Streaming
  first_stream: 'stream', streamer_50: 'stream', famous: 'users',
  // Mini-games
  crash_cashout_10x: 'trending-up', mines_perfect: 'shield-check', dragon_in_between: 'flag',
  // Social
  first_profile_edit: 'user', first_dm: 'mail',
  // Meta
  collector_5: 'star', collector_15: 'star', collector_30: 'trophy',
};

// ---------------------------------------------------------------------
// Label parsing — strip the leading emoji from the stored label and
// split on the em-dash separator to get title + description.
// ---------------------------------------------------------------------

function parseLabel(raw: string): { title: string; description: string } {
  // Strip a leading emoji-plus-space run. The labels start with 1-3
  // emoji glyphs (some are variation-selector composed) so we can't
  // just strip one char.
  const withoutEmoji = raw.replace(/^\p{Extended_Pictographic}(\p{Extended_Pictographic}|[☀-➿️])*\s*/u, '').trim();
  const [title, ...rest] = withoutEmoji.split(' — ');
  return { title: title.trim(), description: rest.join(' — ').trim() };
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

// ---------------------------------------------------------------------

export default function AchievementsScreen(): React.ReactElement | null {
  const team = useOnline((s) => s.team);
  const list = useOnline((s) => s.listAchievements);
  const unlocked = useOnline((s) => s.achievements);
  const go = useOnline((s) => s.go);

  useEffect(() => { list(); }, [list]);

  const unlockedMap = useMemo(() => {
    const m = new Map<string, typeof unlocked[number]>();
    for (const a of unlocked) m.set(a.kind, a);
    return m;
  }, [unlocked]);

  const totalKinds = Object.keys(ACHIEVEMENT_LABELS).length;
  const gotCount = unlocked.length;
  const pct = totalKinds > 0 ? Math.round((gotCount / totalKinds) * 100) : 0;
  const totalReward = unlocked.reduce((s, a) => s + (a.rewardCash ?? achievementReward(a.kind)), 0);

  if (!team) return null;

  return (
    <div className="screen" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="hero-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="hero-icon"><Icon name="trophy" size={20} /></div>
          <div>
            <h2 style={{ margin: 0 }}>Achievements</h2>
            <div className="hero-sub">
              {gotCount} of {totalKinds} unlocked · {pct}% complete · ${totalReward.toLocaleString()} earned in rewards
            </div>
          </div>
        </div>
        <button className="btn" onClick={() => go('home')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="chevron-left" size={13} /> Back
        </button>
      </div>

      {/* Overall progress bar */}
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="panel-title" style={{ margin: 0 }}>Overall progress</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 700 }}>
            {gotCount}/{totalKinds}
          </span>
        </div>
        <div style={{
          position: 'relative', height: 6, borderRadius: 999,
          background: 'var(--panel-2)', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0, width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--accent-dark), var(--accent))',
            borderRadius: 999,
          }} />
        </div>
      </div>

      {/* Categories */}
      {CATEGORIES.map((cat) => {
        const catGot = cat.kinds.filter((k) => unlockedMap.has(k)).length;
        return (
          <div key={cat.id} className="panel" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 30, height: 30, borderRadius: 6,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--border-accent)',
                }}><Icon name={cat.icon} size={16} /></span>
                <span style={{
                  fontSize: 12.5, fontWeight: 700,
                  letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
                  color: 'var(--text)',
                }}>{cat.label}</span>
              </div>
              <span className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {catGot}/{cat.kinds.length}
              </span>
            </div>
            <div style={{
              display: 'grid', gap: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            }}>
              {cat.kinds.map((kind) => (
                <BadgeCard
                  key={kind}
                  kind={kind}
                  categoryIcon={cat.icon}
                  entry={unlockedMap.get(kind)}
                />
              ))}
            </div>
          </div>
        );
      })}

      <ToastStack />
    </div>
  );
}

// ---------------------------------------------------------------------
// Badge card
// ---------------------------------------------------------------------

function BadgeCard({
  kind, categoryIcon, entry,
}: {
  kind: string;
  categoryIcon: IconName;
  entry: { kind: string; achievedAt: number; rewardCash?: number } | undefined;
}): React.ReactElement {
  const raw = ACHIEVEMENT_LABELS[kind] ?? kind;
  const { title, description } = parseLabel(raw);
  const cash = achievementReward(kind);
  const tier = TIERS[tierForReward(cash)];
  const iconName = KIND_ICON[kind] ?? categoryIcon;
  const locked = !entry;

  return (
    <div
      style={{
        display: 'flex', gap: 10,
        padding: '12px 12px',
        borderRadius: 6,
        background: locked ? 'var(--panel-2)' : `linear-gradient(180deg, ${tier.color}0f 0%, var(--panel-2) 100%)`,
        border: `1px solid ${locked ? 'var(--border)' : tier.ring}`,
        boxShadow: locked ? 'none' : `0 0 0 1px ${tier.color}22 inset`,
        opacity: locked ? 0.72 : 1,
        transition: 'transform 120ms ease, box-shadow 120ms ease',
      }}
    >
      {/* Badge medallion */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div
          style={{
            width: 52, height: 52, borderRadius: '50%',
            background: locked
              ? 'linear-gradient(135deg, var(--panel), var(--bg-elev))'
              : `linear-gradient(135deg, ${tier.color}, ${tier.color}55)`,
            border: `2px solid ${locked ? 'var(--border-strong)' : tier.color}`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: locked ? 'var(--text-faint)' : '#06121c',
            boxShadow: locked ? 'none' : `0 0 12px ${tier.ring}`,
          }}
        >
          <Icon name={locked ? 'lock' : iconName} size={22} />
        </div>
        {/* Tier ribbon under medallion */}
        <div style={{
          position: 'absolute', bottom: -6, left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 7.5, fontWeight: 800,
          letterSpacing: '0.14em',
          padding: '2px 6px', borderRadius: 3,
          background: locked ? 'var(--panel)' : tier.color,
          color: locked ? 'var(--text-faint)' : '#06121c',
          border: `1px solid ${locked ? 'var(--border)' : tier.color}`,
          whiteSpace: 'nowrap',
        }}>
          {tier.label}
        </div>
      </div>

      {/* Text block */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{
          fontWeight: 700, fontSize: 13,
          color: locked ? 'var(--text-dim)' : 'var(--text)',
          letterSpacing: '-0.005em',
        }}>{title}</div>
        <div style={{
          fontSize: 11, color: 'var(--muted)', lineHeight: 1.4,
        }}>{description}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 6px', borderRadius: 3,
            background: locked ? 'var(--panel)' : 'var(--accent-soft)',
            color: locked ? 'var(--text-faint)' : 'var(--accent)',
            border: `1px solid ${locked ? 'var(--border)' : 'var(--border-accent)'}`,
            fontSize: 10, fontWeight: 700,
            letterSpacing: '0.04em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <Icon name="cash" size={10} />
            {cash >= 1000 ? `$${Math.round(cash / 1000)}k` : `$${cash}`}
          </span>
          {entry && (
            <span className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>
              Unlocked · {fmtDate(entry.achievedAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
