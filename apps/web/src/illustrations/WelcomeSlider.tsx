/**
 * Sign-in slider: a woman, a man, a young man and a girl take turns welcoming you (every 3.6 s). Pausable (WCAG 2.2.2),
 * stops while the tab is hidden, and does not auto-advance under reduced motion — the dots still switch by hand.
 */
import { useEffect, useState } from 'react';
import { useT } from '../i18n.ts';
import { GREETERS, WelcomeScene } from './Scenes.tsx';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function WelcomeSlider() {
  const { t } = useT();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(reduced);
  useEffect(() => {
    if (paused) return;
    const h = setInterval(() => { if (!document.hidden) setI((x) => (x + 1) % GREETERS.length); }, 3600);
    return () => clearInterval(h);
  }, [paused]);
  const who = GREETERS[i];
  return (
    <div className="welcome-slider" data-testid="welcome-slider" data-who={who}>
      <WelcomeScene label={t.greet.art(who)} who={who} />
      <div className="welcome-controls" role="group" aria-label={t.greet.label}>
        {GREETERS.map((g, j) => (
          <button key={g} type="button" className={`welcome-dot${j === i ? ' on' : ''}`} aria-pressed={j === i} aria-label={t.greet.show(t.greet.who[g])}
            onClick={() => { setI(j); setPaused(true); }}>
            <span className="welcome-dot-label">{t.greet.who[g]}</span>
          </button>
        ))}
        <button type="button" className="welcome-pause" onClick={() => setPaused(!paused)} aria-label={paused ? t.greet.play : t.greet.pause}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            {paused ? <path d="M8 5.5v13l10.5-6.5z" /> : <><rect x="6.5" y="5.5" width="4" height="13" rx="1" /><rect x="13.5" y="5.5" width="4" height="13" rx="1" /></>}
          </svg>
        </button>
      </div>
      <p className="muted small welcome-line">{t.greet.line}</p>
    </div>
  );
}
