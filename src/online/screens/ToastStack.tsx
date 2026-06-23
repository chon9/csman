// Floating toast notifications stacked in the bottom-right. Each auto-
// dismisses after 5s (handled in the store) but can be clicked away early.

import { useOnline } from '../onlineStore';

export default function ToastStack() {
  const toasts = useOnline((s) => s.toasts);
  const dismiss = useOnline((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
          title="Dismiss"
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
