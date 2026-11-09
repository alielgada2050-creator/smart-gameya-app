import { Hub, Padlock, Plot, Relay, Settle, Vault } from '@lucasmarkes/hairline/react';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api.ts';
import { useT } from './i18n.ts';

export interface RingMember { label: string; position: number | null; me?: boolean }

/**
 * The rotation ring: one bead per payout turn, read clockwise from the top.
 * Done turns are filled, the current turn is saffron, empty seats are dashed.
 */
export function Ring({ total, members, currentPosition, completedThrough, center, caption }: {
  total: number; members: RingMember[]; currentPosition?: number | null; completedThrough?: number; center?: ReactNode; caption?: string;
}) {
  const size = 300, c = size / 2, r = 112, br = total > 20 ? 9 : total > 12 ? 12 : 15;
  const byPos = new Map(members.filter((m) => m.position).map((m) => [m.position!, m]));
  const seats = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <figure className="ring-wrap" style={{ margin: 0 }}>
      <svg className="ring" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={caption}>
        <circle className="track" cx={c} cy={c} r={r} />
        {seats.map((pos) => {
          const a = ((pos - 1) / total) * 2 * Math.PI - Math.PI / 2;
          const x = c + r * Math.cos(a), y = c + r * Math.sin(a);
          const m = byPos.get(pos);
          const cls = ['bead', !m && members.length < total && pos > members.length ? 'empty' : '', completedThrough && pos <= completedThrough ? 'done' : '', currentPosition === pos ? 'current' : '', m?.me ? 'me' : ''].join(' ');
          return (
            <g key={pos}>
              <circle className={cls} cx={x} cy={y} r={br}><title>{m ? `${pos}. ${m.label}` : String(pos)}</title></circle>
              {br >= 12 && <text className="bead-num" x={x} y={y + 4} textAnchor="middle">{pos}</text>}
            </g>
          );
        })}
        {center}
      </svg>
      {caption && <figcaption className="sr-only">{caption}</figcaption>}
    </figure>
  );
}

export function Pill({ status, label }: { status: string; label: string }) {
  return <span className={`pill ${status}`}>{label}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useT();
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : t.error;
  return <p className="notice error" role="alert">{msg}</p>;
}

/** Load data with loading/error states and a reload handle. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fn().then((d) => live && setData(d)).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((x) => x + 1) };
}

/** Skeleton placeholder: reserves space (no layout shift) and announces a busy state. */
export function Loading({ lines = 4 }: { lines?: number }) {
  const { t } = useT();
  return (
    <div className="panel skeleton" role="status" aria-busy="true" aria-label={t.loading}>
      {Array.from({ length: lines }, (_, i) => <span key={i} />)}
    </div>
  );
}


const FIGURES = { vault: Vault, plot: Plot, settle: Settle, relay: Relay, padlock: Padlock, hub: Hub } as const;

/**
 * Hairline line figure (MIT, @lucasmarkes/hairline). Colours come from our skin tokens via --hairline-* on .figure-box;
 * --hairline-plate always equals the background behind the figure so no plate box shows.
 */
export function Figure({ name, label, hero = false, play = false }: { name: keyof typeof FIGURES; label: string; hero?: boolean; play?: boolean }) {
  const F = FIGURES[name];
  return <div className={`figure-box${hero ? ' hero' : ''}`}><F label={label} play={play} intensity={0.55} theme="light" /></div>;
}

export function TierChip({ tier, label }: { tier: string; label: string }) {
  return <span className={`tier ${tier}`}>{label}</span>;
}

export function EmptyState({ figure, text, children }: { figure: keyof typeof FIGURES; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Figure name={figure} label={text} />
      <p className="muted">{text}</p>
      {children}
    </div>
  );
}
