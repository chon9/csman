import { useEffect, useState } from 'react';

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 2200);
    const t2 = setTimeout(onDone, 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div className={`splash ${fading ? 'splash-fade' : ''}`} onClick={onDone}>
      <div className="splash-bg" />
      <div className="splash-content">
        <div className="splash-mark">
          <span className="splash-mark-cs">CS2</span>
          <span className="splash-mark-mgr">MANAGER</span>
        </div>
        <div className="splash-tagline">An esports management simulation</div>
        <div className="splash-skip">Click anywhere to continue</div>
      </div>
    </div>
  );
}
