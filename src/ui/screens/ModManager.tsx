import { useMemo, useRef, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { TeamLogo } from '../TeamLogo';
import { ATTRIBUTE_KEYS, ALL_MAPS } from '../../types';
import type {
  AttributeKey,
  Player,
  PlayerAttributes,
  PlayerRole,
  Region,
  Sponsor,
  SponsorCategory,
  SponsorTier,
  Team,
} from '../../types';

type Tab = 'teams' | 'players' | 'sponsors' | 'io';

const REGIONS: Region[] = ['Europe', 'CIS', 'Americas', 'Asia'];
const ROLES: PlayerRole[] = ['IGL', 'AWPer', 'Entry', 'Lurker', 'Support', 'Rifler', 'Anchor'];
const SPONSOR_TIERS: SponsorTier[] = ['title', 'premium', 'standard', 'minor'];
const SPONSOR_CATEGORIES: SponsorCategory[] = [
  'peripherals', 'energy', 'apparel', 'tech', 'gambling', 'auto', 'finance', 'food',
];

export default function ModManager() {
  const [tab, setTab] = useState<Tab>('teams');

  return (
    <div className="screen">
      <h2 className="screen-title">Mod Manager</h2>
      <p className="muted small">
        Edit teams, players, and sponsors on a live save. Imports merge into the current career
        and never overwrite your own team / players. Export to JSON to share your modded database.
      </p>
      <div className="tab-row">
        <button className={`tab ${tab === 'teams' ? 'active' : ''}`} onClick={() => setTab('teams')}>
          Teams
        </button>
        <button className={`tab ${tab === 'players' ? 'active' : ''}`} onClick={() => setTab('players')}>
          Players
        </button>
        <button className={`tab ${tab === 'sponsors' ? 'active' : ''}`} onClick={() => setTab('sponsors')}>
          Sponsors
        </button>
        <button className={`tab ${tab === 'io' ? 'active' : ''}`} onClick={() => setTab('io')}>
          Import / Export
        </button>
      </div>
      {tab === 'teams' && <TeamsTab />}
      {tab === 'players' && <PlayersTab />}
      {tab === 'sponsors' && <SponsorsTab />}
      {tab === 'io' && <IOTab />}
    </div>
  );
}

// ============ Teams tab ============

function TeamsTab() {
  const game = useGame((s) => s.game)!;
  const editTeam = useGame((s) => s.editTeam);
  const addCustomTeam = useGame((s) => s.addCustomTeam);
  const removeCustomTeam = useGame((s) => s.removeCustomTeam);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const teams = Object.values(game.teams).sort((a, b) => a.worldRanking - b.worldRanking);
  const selected = selectedId ? game.teams[selectedId] : null;

  return (
    <div className="mod-layout">
      <div className="panel mod-list-panel">
        <div className="panel-title">
          Teams ({teams.length})
          <button className="btn btn-tiny" style={{ marginLeft: 'auto' }} onClick={() => { setAdding(true); setSelectedId(null); }}>
            + Add Team
          </button>
        </div>
        <div className="mod-list">
          {teams.map((t) => (
            <button
              key={t.id}
              className={`mod-list-row ${selectedId === t.id ? 'selected' : ''}`}
              onClick={() => { setSelectedId(t.id); setAdding(false); }}
            >
              <TeamLogo team={t} size="sm" />
              <span className="mod-list-name">{t.name}</span>
              <span className="muted small">#{t.worldRanking}</span>
              {t.id === game.userTeamId && <span className="muted small">(you)</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="panel mod-detail-panel">
        {adding && (
          <AddTeamForm
            onCancel={() => setAdding(false)}
            onSubmit={(team) => { addCustomTeam(team); setAdding(false); setSelectedId(team.id); }}
          />
        )}
        {!adding && selected && (
          <TeamEditor
            team={selected}
            isUser={selected.id === game.userTeamId}
            onPatch={(patch) => editTeam(selected.id, patch)}
            onDelete={() => {
              if (confirm(`Delete team "${selected.name}"? Players become free agents.`)) {
                removeCustomTeam(selected.id);
                setSelectedId(null);
              }
            }}
          />
        )}
        {!adding && !selected && <p className="muted">Select a team on the left to edit.</p>}
      </div>
    </div>
  );
}

function TeamEditor({ team, isUser, onPatch, onDelete }: {
  team: Team;
  isUser: boolean;
  onPatch: (patch: Partial<Team>) => void;
  onDelete: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleLogoFile(file: File) {
    if (file.size > 500_000) {
      alert('Logo too large (max 500 KB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onPatch({ customLogoUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <div className="panel-title">
        Editing: {team.name}
        {isUser && <span className="muted small"> (your team — limited fields)</span>}
      </div>
      <div className="mod-edit-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={team.name} onChange={(e) => onPatch({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Tag (abbrev)</span>
          <input className="input" value={team.tag} maxLength={6} onChange={(e) => onPatch({ tag: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Region</span>
          <select className="input" value={team.region} onChange={(e) => onPatch({ region: e.target.value as Region })}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Budget (USD)</span>
          <input className="input" type="number" value={team.budget} onChange={(e) => onPatch({ budget: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-label">Reputation (1-200)</span>
          <input className="input" type="number" min={1} max={200} value={team.reputation} onChange={(e) => onPatch({ reputation: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-label">Coach Skill (1-20)</span>
          <input className="input" type="number" min={1} max={20} value={team.coachSkill} onChange={(e) => onPatch({ coachSkill: Number(e.target.value) })} />
        </label>
        <label className="field" style={{ gridColumn: 'span 2' }}>
          <span className="field-label">Custom Logo URL or data: URI</span>
          <input
            className="input"
            placeholder="Leave blank to use public/teams/<id>.png"
            value={team.customLogoUrl ?? ''}
            onChange={(e) => onPatch({ customLogoUrl: e.target.value || undefined })}
          />
        </label>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <span className="field-label">Upload Logo (PNG/JPG ≤500 KB)</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])}
          />
          {team.customLogoUrl && (
            <button className="btn btn-tiny" style={{ marginTop: 6 }} onClick={() => onPatch({ customLogoUrl: undefined })}>
              Clear Custom Logo
            </button>
          )}
        </div>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <span className="field-label">Preview</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <TeamLogo team={team} size="lg" />
            <span style={{ fontWeight: 700 }}>{team.name}</span>
            <span className="muted small">{team.tag} · {team.region}</span>
          </div>
        </div>
      </div>
      {!isUser && (
        <div style={{ marginTop: 14 }}>
          <button className="btn" style={{ color: '#e88578' }} onClick={onDelete}>
            Delete Team
          </button>
        </div>
      )}
    </div>
  );
}

function AddTeamForm({ onSubmit, onCancel }: { onSubmit: (t: Team) => void; onCancel: () => void }) {
  const [name, setName] = useState('Custom Team');
  const [tag, setTag] = useState('CSTM');
  const [region, setRegion] = useState<Region>('Europe');
  const [budget, setBudget] = useState(500_000);

  function submit() {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || `team-${Date.now()}`;
    const team: Team = {
      id,
      name,
      tag: tag.toUpperCase(),
      region,
      reputation: 80,
      budget,
      playerIds: [],
      coachName: 'TBD',
      coachSkill: 10,
      mapPool: ALL_MAPS.map((map) => ({ map, proficiency: 10 })),
      worldRanking: 99,
      rankingPoints: 0,
    };
    onSubmit(team);
  }

  return (
    <div>
      <div className="panel-title">Add New Team</div>
      <div className="mod-edit-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Tag</span>
          <input className="input" value={tag} maxLength={6} onChange={(e) => setTag(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Region</span>
          <select className="input" value={region} onChange={(e) => setRegion(e.target.value as Region)}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Budget (USD)</span>
          <input className="input" type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        </label>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="btn btn-accent" onClick={submit} disabled={!name.trim() || !tag.trim()}>Create Team</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ============ Players tab ============

function PlayersTab() {
  const game = useGame((s) => s.game)!;
  const editPlayer = useGame((s) => s.editPlayer);
  const addCustomPlayer = useGame((s) => s.addCustomPlayer);
  const removeCustomPlayer = useGame((s) => s.removeCustomPlayer);

  const [filter, setFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return Object.values(game.players)
      .filter((p) => {
        if (q && !p.nickname.toLowerCase().includes(q) && !p.lastName.toLowerCase().includes(q)) return false;
        if (teamFilter === 'free') return p.teamId === null;
        if (teamFilter !== 'all' && p.teamId !== teamFilter) return false;
        return true;
      })
      .sort((a, b) => b.currentAbility - a.currentAbility)
      .slice(0, 200);
  }, [game.players, filter, teamFilter]);

  const selected = selectedId ? game.players[selectedId] : null;

  return (
    <div className="mod-layout">
      <div className="panel mod-list-panel">
        <div className="panel-title">
          Players
          <button className="btn btn-tiny" style={{ marginLeft: 'auto' }} onClick={() => { setAdding(true); setSelectedId(null); }}>
            + Add Player
          </button>
        </div>
        <div className="mod-filter-row">
          <input className="input input-tight" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select className="input input-tight" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="all">All teams</option>
            <option value="free">Free agents</option>
            {Object.values(game.teams).sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="mod-list">
          {filtered.map((p) => (
            <button
              key={p.id}
              className={`mod-list-row ${selectedId === p.id ? 'selected' : ''}`}
              onClick={() => { setSelectedId(p.id); setAdding(false); }}
            >
              <span className="mod-list-name">{p.nickname}</span>
              <span className="muted small">{p.role}</span>
              <span className="muted small">CA {p.currentAbility}</span>
            </button>
          ))}
          {filtered.length === 200 && (
            <div className="muted small" style={{ padding: 6, textAlign: 'center' }}>Showing first 200 — narrow your search.</div>
          )}
        </div>
      </div>
      <div className="panel mod-detail-panel">
        {adding && <AddPlayerForm onCancel={() => setAdding(false)} onSubmit={(p) => { addCustomPlayer(p); setAdding(false); setSelectedId(p.id); }} />}
        {!adding && selected && (
          <PlayerEditor
            player={selected}
            game={game}
            onPatch={(patch) => editPlayer(selected.id, patch)}
            onDelete={() => {
              if (selected.teamId === game.userTeamId) { alert('Cannot delete one of your own players.'); return; }
              if (confirm(`Delete player "${selected.nickname}"?`)) {
                removeCustomPlayer(selected.id);
                setSelectedId(null);
              }
            }}
          />
        )}
        {!adding && !selected && <p className="muted">Select a player on the left to edit.</p>}
      </div>
    </div>
  );
}

function PlayerEditor({ player, game, onPatch, onDelete }: {
  player: Player;
  game: import('../../types').GameState;
  onPatch: (patch: Partial<Player>) => void;
  onDelete: () => void;
}) {
  function patchAttr(k: AttributeKey, v: number) {
    onPatch({ attributes: { ...player.attributes, [k]: Math.max(1, Math.min(20, v)) } });
  }

  return (
    <div>
      <div className="panel-title">
        Editing: {player.nickname} ({player.firstName} {player.lastName})
      </div>
      <div className="mod-edit-grid">
        <label className="field">
          <span className="field-label">Nickname</span>
          <input className="input" value={player.nickname} onChange={(e) => onPatch({ nickname: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">First Name</span>
          <input className="input" value={player.firstName} onChange={(e) => onPatch({ firstName: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Last Name</span>
          <input className="input" value={player.lastName} onChange={(e) => onPatch({ lastName: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Nationality (ISO-2)</span>
          <input className="input" value={player.nationality} maxLength={2} onChange={(e) => onPatch({ nationality: e.target.value.toUpperCase() })} />
        </label>
        <label className="field">
          <span className="field-label">Age</span>
          <input className="input" type="number" min={16} max={45} value={player.age} onChange={(e) => onPatch({ age: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-label">Role</span>
          <select className="input" value={player.role} onChange={(e) => onPatch({ role: e.target.value as PlayerRole })}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Team</span>
          <select className="input" value={player.teamId ?? ''} onChange={(e) => onPatch({ teamId: e.target.value || null })}>
            <option value="">— Free Agent —</option>
            {Object.values(game.teams).sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Current Ability</span>
          <input className="input" type="number" min={40} max={200} value={player.currentAbility} onChange={(e) => onPatch({ currentAbility: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-label">Potential Ability</span>
          <input className="input" type="number" min={40} max={200} value={player.potentialAbility} onChange={(e) => onPatch({ potentialAbility: Number(e.target.value) })} />
        </label>
        <label className="field" style={{ gridColumn: 'span 2' }}>
          <span className="field-label">Custom Photo URL (optional)</span>
          <input
            className="input"
            placeholder="https://… or data:image/png;base64,…"
            value={player.customPhotoUrl ?? ''}
            onChange={(e) => onPatch({ customPhotoUrl: e.target.value || undefined })}
          />
        </label>
      </div>
      <div className="panel-title small-title" style={{ marginTop: 14 }}>Attributes</div>
      <div className="mod-attr-grid">
        {ATTRIBUTE_KEYS.map((k) => (
          <label key={k} className="mod-attr-row">
            <span className="mod-attr-name">{k}</span>
            <input
              className="input input-tight"
              type="number"
              min={1}
              max={20}
              value={player.attributes[k as keyof PlayerAttributes]}
              onChange={(e) => patchAttr(k as AttributeKey, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" style={{ color: '#e88578' }} onClick={onDelete}>
          Delete Player
        </button>
      </div>
    </div>
  );
}

function AddPlayerForm({ onSubmit, onCancel }: { onSubmit: (p: Player) => void; onCancel: () => void }) {
  const game = useGame((s) => s.game)!;
  const [nickname, setNickname] = useState('newproPlayer');
  const [first, setFirst] = useState('New');
  const [last, setLast] = useState('Player');
  const [nationality, setNationality] = useState('XX');
  const [age, setAge] = useState(20);
  const [role, setRole] = useState<PlayerRole>('Rifler');
  const [teamId, setTeamId] = useState<string>('');
  const [ca, setCa] = useState(120);

  function submit() {
    const id = nickname.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || `player-${Date.now()}`;
    if (game.players[id]) {
      alert('A player with this nickname id already exists. Pick another nickname.');
      return;
    }
    const balanced = Math.round(ca / 14);
    const attrs: PlayerAttributes = {
      aim: balanced, reflexes: balanced, positioning: balanced, utility: balanced,
      clutch: balanced, gameSense: balanced, communication: balanced, leadership: balanced,
      consistency: balanced, composure: balanced, aggression: 10, teamwork: balanced,
      resilience: balanced, discipline: balanced, loyalty: 12, endurance: balanced,
    };
    const player: Player = {
      id,
      nickname,
      firstName: first,
      lastName: last,
      nationality: nationality.toUpperCase().slice(0, 2),
      age,
      role,
      attributes: attrs,
      currentAbility: ca,
      potentialAbility: Math.min(200, ca + 20),
      form: 10,
      morale: 12,
      fatigue: 0,
      contract: null,
      teamId: teamId || null,
      stats: { maps: 0, kills: 0, deaths: 0, assists: 0, rating: 1.0, clutchesWon: 0, openingKills: 0, utilityDamage: 0 },
      transferListed: false,
      askingPrice: Math.max(50_000, ca * 1500),
      roleExperience: { [role]: 150 },
    };
    onSubmit(player);
  }

  return (
    <div>
      <div className="panel-title">Add New Player</div>
      <div className="mod-edit-grid">
        <label className="field">
          <span className="field-label">Nickname</span>
          <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">First Name</span>
          <input className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Last Name</span>
          <input className="input" value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Nationality</span>
          <input className="input" value={nationality} maxLength={2} onChange={(e) => setNationality(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Age</span>
          <input className="input" type="number" min={16} max={45} value={age} onChange={(e) => setAge(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as PlayerRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Team (optional)</span>
          <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">— Free Agent —</option>
            {Object.values(game.teams).sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Current Ability</span>
          <input className="input" type="number" min={40} max={200} value={ca} onChange={(e) => setCa(Number(e.target.value))} />
        </label>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="btn btn-accent" onClick={submit} disabled={!nickname.trim()}>Create Player</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ============ Sponsors tab ============

function SponsorsTab() {
  const game = useGame((s) => s.game)!;
  const editSponsor = useGame((s) => s.editCustomSponsor);
  const addSponsor = useGame((s) => s.addCustomSponsor);
  const removeSponsor = useGame((s) => s.removeCustomSponsor);

  const sponsors = Object.values(game.sponsors ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const selected = selectedId ? (game.sponsors ?? {})[selectedId] : null;

  return (
    <div className="mod-layout">
      <div className="panel mod-list-panel">
        <div className="panel-title">
          Sponsors ({sponsors.length})
          <button className="btn btn-tiny" style={{ marginLeft: 'auto' }} onClick={() => { setAdding(true); setSelectedId(null); }}>
            + Add Sponsor
          </button>
        </div>
        <div className="mod-list">
          {sponsors.map((s) => (
            <button
              key={s.id}
              className={`mod-list-row ${selectedId === s.id ? 'selected' : ''}`}
              onClick={() => { setSelectedId(s.id); setAdding(false); }}
            >
              <span className="mod-list-name">{s.brand}</span>
              <span className="muted small">{s.tier}</span>
              <span className="muted small">${(s.baseMonthly / 1000).toFixed(0)}k/mo</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel mod-detail-panel">
        {adding && <AddSponsorForm onCancel={() => setAdding(false)} onSubmit={(s) => { addSponsor(s); setAdding(false); setSelectedId(s.id); }} />}
        {!adding && selected && (
          <SponsorEditor
            sponsor={selected}
            onPatch={(patch) => editSponsor(selected.id, patch)}
            onDelete={() => {
              if (confirm(`Delete sponsor "${selected.name}"? Active deals will be removed.`)) {
                removeSponsor(selected.id);
                setSelectedId(null);
              }
            }}
          />
        )}
        {!adding && !selected && <p className="muted">Select a sponsor on the left to edit.</p>}
      </div>
    </div>
  );
}

function SponsorEditor({ sponsor, onPatch, onDelete }: {
  sponsor: Sponsor;
  onPatch: (patch: Partial<Sponsor>) => void;
  onDelete: () => void;
}) {
  return (
    <div>
      <div className="panel-title">Editing: {sponsor.name}</div>
      <div className="mod-edit-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={sponsor.name} onChange={(e) => onPatch({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Brand label</span>
          <input className="input" value={sponsor.brand} onChange={(e) => onPatch({ brand: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Tier</span>
          <select className="input" value={sponsor.tier} onChange={(e) => onPatch({ tier: e.target.value as SponsorTier })}>
            {SPONSOR_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Category</span>
          <select className="input" value={sponsor.category} onChange={(e) => onPatch({ category: e.target.value as SponsorCategory })}>
            {SPONSOR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Base Monthly (USD)</span>
          <input className="input" type="number" value={sponsor.baseMonthly} onChange={(e) => onPatch({ baseMonthly: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-label">Length (months)</span>
          <input className="input" type="number" value={sponsor.baseLengthMonths} onChange={(e) => onPatch({ baseLengthMonths: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-label">Min Rank (smaller = higher)</span>
          <input className="input" type="number" value={sponsor.minRank} onChange={(e) => onPatch({ minRank: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-label">Bonus per Major</span>
          <input className="input" type="number" value={sponsor.bonusPerMajor ?? 0} onChange={(e) => onPatch({ bonusPerMajor: Number(e.target.value) || undefined })} />
        </label>
        <label className="field">
          <span className="field-label">Bonus per Podium</span>
          <input className="input" type="number" value={sponsor.bonusPerPodium ?? 0} onChange={(e) => onPatch({ bonusPerPodium: Number(e.target.value) || undefined })} />
        </label>
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn" style={{ color: '#e88578' }} onClick={onDelete}>Delete Sponsor</button>
      </div>
    </div>
  );
}

function AddSponsorForm({ onSubmit, onCancel }: { onSubmit: (s: Sponsor) => void; onCancel: () => void }) {
  const [name, setName] = useState('Custom Sponsor');
  const [brand, setBrand] = useState('Brand');
  const [tier, setTier] = useState<SponsorTier>('standard');
  const [category, setCategory] = useState<SponsorCategory>('tech');
  const [monthly, setMonthly] = useState(50_000);
  const [length, setLength] = useState(12);
  const [minRank, setMinRank] = useState(30);

  function submit() {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || `sponsor-${Date.now()}`;
    onSubmit({
      id, name, brand, tier, category,
      baseMonthly: monthly,
      baseLengthMonths: length,
      minRank,
    });
  }

  return (
    <div>
      <div className="panel-title">Add Sponsor</div>
      <div className="mod-edit-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Brand label</span>
          <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Tier</span>
          <select className="input" value={tier} onChange={(e) => setTier(e.target.value as SponsorTier)}>
            {SPONSOR_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as SponsorCategory)}>
            {SPONSOR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Monthly (USD)</span>
          <input className="input" type="number" value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Length (months)</span>
          <input className="input" type="number" value={length} onChange={(e) => setLength(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Min Rank</span>
          <input className="input" type="number" value={minRank} onChange={(e) => setMinRank(Number(e.target.value))} />
        </label>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button className="btn btn-accent" onClick={submit} disabled={!name.trim()}>Create Sponsor</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ============ Import / Export tab ============

function IOTab() {
  const exportModPack = useGame((s) => s.exportModPack);
  const importModPack = useGame((s) => s.importModPack);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function doExport() {
    const json = exportModPack();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cs2manager-modpack-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported mod pack to download.');
  }

  function handleImport(file: File) {
    if (!confirm(`Import "${file.name}" into the current save? Your own team/players are preserved but other teams may be overwritten.`)) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = importModPack(String(reader.result));
      setStatus(result.ok ? 'Mod pack imported.' : `Import failed: ${result.error ?? 'unknown error'}`);
    };
    reader.readAsText(file);
  }

  return (
    <div className="panel">
      <div className="panel-title">Import / Export Mod Pack</div>
      <p className="muted small">
        A mod pack is a JSON file containing teams, players, and sponsors. Imports merge into
        your current save — your own team and roster are always preserved.
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn btn-accent" onClick={doExport}>Export Mod Pack (JSON)</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import Mod Pack (JSON)</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
        />
      </div>
      {status && <div className="muted small" style={{ marginTop: 10 }}>{status}</div>}
      <div className="panel-title small-title" style={{ marginTop: 18 }}>Pack format</div>
      <pre className="mod-pack-format">{`{
  "version": 1,
  "teams":   { "<id>": Team, ... },
  "players": { "<id>": Player, ... },
  "sponsors":{ "<id>": Sponsor, ... }
}`}</pre>
    </div>
  );
}
