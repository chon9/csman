// Send a loan offer for one of your players to another team. Lender keeps
// the player's contract; borrower pays the fee upfront + gets the player
// on their roster for N days. Auto-returns at end of term.

import { useEffect, useState } from 'react';
import type { Player } from '../../types';
import { MAX_LOAN_DAYS } from '../protocol';
import { useOnline } from '../onlineStore';

export default function LoanOfferModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const directory = useOnline((s) => s.directory);
  const list = useOnline((s) => s.listOnlineTeams);
  const offer = useOnline((s) => s.offerLoan);
  const team = useOnline((s) => s.team);

  const [toTeamId, setToTeamId] = useState('');
  const [fee, setFee] = useState(Math.max(1000, Math.round(player.currentAbility * 80)));
  const [days, setDays] = useState(7);

  useEffect(() => { list(); }, [list]);

  if (!team) return null;
  const candidates = directory.filter((t) => t.id !== team.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>Loan {player.nickname}</h3>
          <button className="link-btn" onClick={onClose}>close ✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
          <p className="muted small" style={{ margin: 0 }}>
            You keep the contract; the recipient pays the fee upfront and gets {player.nickname} on their roster
            for the chosen duration. Auto-returns when the timer expires.
          </p>
          <label className="field">
            <span className="field-label">Borrower</span>
            <select className="input" value={toTeamId} onChange={(e) => setToTeamId(e.target.value)}>
              <option value="">— pick a team —</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>{t.tag} · {t.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Fee ${fee.toLocaleString()}</span>
            <input type="range" min={0} max={20_000} step={500} value={fee} onChange={(e) => setFee(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="field-label">Length {days}d <span className="muted small">(max {MAX_LOAN_DAYS})</span></span>
            <input type="range" min={1} max={MAX_LOAN_DAYS} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
        </div>
        <div className="modal-foot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-accent"
            disabled={!toTeamId}
            onClick={() => { offer(toTeamId, player.id, fee, days); onClose(); }}
          >Send offer</button>
        </div>
      </div>
    </div>
  );
}
