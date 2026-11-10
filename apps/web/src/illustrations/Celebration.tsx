import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { tick } from '../platform.ts';
import { CelebrateScene } from './Scenes.tsx';

export interface CelebrateDetail { title: string; body?: string; items?: string[] }

/** Call after a milestone the user just caused (draw done, order adopted, payment confirmed, circle created/joined). */
export function celebrate(detail: CelebrateDetail) {
  dispatchEvent(new CustomEvent<CelebrateDetail>('sg:celebrate', { detail }));
  tick().catch(() => {});
}

/**
 * Non-blocking celebration card (role=status): slides up from the bottom, never traps focus, closes by itself.
 * Ordered results (the draw, an adopted order) are revealed one name at a time — that reveal is the meaning of the motion.
 */
export function Celebration({ closeLabel }: { closeLabel: string }) {
  const [d, setD] = useState<CelebrateDetail | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const close = () => { setLeaving(true); window.setTimeout(() => { setD(null); setLeaving(false); }, 180); };
  useEffect(() => {
    const on = (e: Event) => {
      window.clearTimeout(timer.current);
      const detail = (e as CustomEvent<CelebrateDetail>).detail;
      setLeaving(false); setD(detail);
      timer.current = window.setTimeout(close, 4500 + (detail.items?.length ?? 0) * 350);
    };
    addEventListener('sg:celebrate', on);
    return () => { removeEventListener('sg:celebrate', on); window.clearTimeout(timer.current); };
  }, []);
  if (!d) return null;
  return (
    <div className={`celebration${leaving ? ' leaving' : ''}`} role="status" aria-live="polite" data-testid="celebration"
      onMouseEnter={() => window.clearTimeout(timer.current)}>
      <CelebrateScene label="" />
      <div className="stack-sm">
        <h2>{d.title}</h2>
        {d.body && <p className="muted small">{d.body}</p>}
        {d.items && (
          <ol className="reveal-list">
            {d.items.map((n, k) => <li key={k} style={{ '--i': k } as CSSProperties}><span className="pos">{k + 1}</span>{n}</li>)}
          </ol>
        )}
      </div>
      <button className="icon-btn celebration-close" aria-label={closeLabel} onClick={close}>×</button>
    </div>
  );
}
