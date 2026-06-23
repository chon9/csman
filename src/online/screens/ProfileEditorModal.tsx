// Modal to edit team profile fields (bio + color + social links).
// Server enforces hex format on primaryColor + length caps on text fields.

import { useState } from 'react';
import type { TeamProfileFields } from '../protocol';
import { useOnline } from '../onlineStore';

export default function ProfileEditorModal({ onClose }: { onClose: () => void }) {
  const team = useOnline((s) => s.team);
  const update = useOnline((s) => s.updateProfile);

  const [bio, setBio] = useState(team?.bio ?? '');
  const [color, setColor] = useState(team?.primaryColor ?? '#de9b35');
  const [twitch, setTwitch] = useState(team?.twitchUrl ?? '');
  const [twitter, setTwitter] = useState(team?.twitterUrl ?? '');
  const [youtube, setYoutube] = useState(team?.youtubeUrl ?? '');

  if (!team) return null;

  function save(): void {
    const fields: TeamProfileFields = { bio, primaryColor: color, twitchUrl: twitch, twitterUrl: twitter, youtubeUrl: youtube };
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
