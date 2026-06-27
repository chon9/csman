// Modal to edit team profile fields (bio + color + social links).
// Server enforces hex format on primaryColor + length caps on text fields.

import { useMemo, useState } from 'react';
import { LOGO_PACK, type TeamProfileFields } from '../protocol';
import { useOnline } from '../onlineStore';

export default function ProfileEditorModal({ onClose }: { onClose: () => void }) {
  const team = useOnline((s) => s.team);
  const update = useOnline((s) => s.updateProfile);

  const [bio, setBio] = useState(team?.bio ?? '');
  const [color, setColor] = useState(team?.primaryColor ?? '#de9b35');
  const [twitch, setTwitch] = useState(team?.twitchUrl ?? '');
  const [twitter, setTwitter] = useState(team?.twitterUrl ?? '');
  const [youtube, setYoutube] = useState(team?.youtubeUrl ?? '');
  const [logoId, setLogoId] = useState(team?.logoId ?? '');

  // Group LOGO_PACK by category for the picker so the gallery scans cleanly.
  const grouped = useMemo(() => {
    const out: Record<string, typeof LOGO_PACK> = {};
    for (const l of LOGO_PACK) (out[l.category] ??= []).push(l);
    return out;
  }, []);

  if (!team) return null;

  function save(): void {
    const fields: TeamProfileFields = { bio, primaryColor: color, twitchUrl: twitch, twitterUrl: twitter, youtubeUrl: youtube, logoId };
    update(fields);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3>Edit Team Profile</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
          <p className="muted small" style={{ margin: 0 }}>
            These fields show up on your public team profile page (the 🔗 link in the header).
          </p>
          <label className="field">
            <span className="field-label">Bio (max 500 chars)</span>
            <textarea
              className="input"
              rows={4}
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 500))}
              placeholder="Brief team description — who you are, what you're playing for."
            />
          </label>
          {/* Logo picker — curated emoji pack the user picks from. */}
          <div className="field">
            <span className="field-label">Logo</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div
                style={{
                  width: 48, height: 48, borderRadius: 10,
                  background: `linear-gradient(135deg, ${color}, ${color}88)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, color: '#0a0d12', fontWeight: 800,
                  boxShadow: `0 0 12px ${color}55`,
                }}
              >
                {logoId || team.tag.slice(0, 2).toUpperCase()}
              </div>
              <div className="muted small">
                Preview · {logoId ? <button className="link-btn" style={{ float: 'none', display: 'inline' }} onClick={() => setLogoId('')}>clear (use tag)</button> : 'default initials'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', padding: 6, background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <div className="muted small" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{cat}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {items.map((opt) => {
                      const picked = opt.id === logoId;
                      return (
                        <button
                          key={opt.id}
                          title={opt.label}
                          onClick={() => setLogoId(opt.id)}
                          style={{
                            width: 36, height: 36, borderRadius: 6,
                            background: picked ? `${color}40` : 'rgba(255,255,255,0.04)',
                            border: picked ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.10)',
                            cursor: 'pointer', fontSize: 22, padding: 0,
                          }}
                        >
                          {opt.id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="field-label">Primary color</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              <span className="muted small">{color}</span>
              <div style={{ flex: 1, height: 24, background: color, borderRadius: 4 }} />
            </div>
          </label>
          <label className="field">
            <span className="field-label">Twitch URL</span>
            <input className="input" type="url" value={twitch} onChange={(e) => setTwitch(e.target.value)} placeholder="https://twitch.tv/yourteam" />
          </label>
          <label className="field">
            <span className="field-label">Twitter / X URL</span>
            <input className="input" type="url" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/yourteam" />
          </label>
          <label className="field">
            <span className="field-label">YouTube URL</span>
            <input className="input" type="url" value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="https://youtube.com/@yourteam" />
          </label>
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={save}>Save profile</button>
        </div>
      </div>
    </div>
  );
}
