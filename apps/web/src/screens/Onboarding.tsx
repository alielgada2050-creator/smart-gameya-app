/**
 * First-run introduction (signed out): four slides with original flat illustrations. Swipe, arrow keys, or the buttons.
 * Shown once per device (sg.onboarded); the sign-in page can open it again.
 */
import { useRef, useState, type ReactElement } from 'react';
import { useT } from '../i18n.ts';

export const ONBOARDED_KEY = 'sg.onboarded';
export const markOnboarded = () => { try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* storage unavailable */ } };
export const wasOnboarded = () => { try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch { return true; } };

const people = [[100, 30], [160, 62], [160, 128], [100, 160], [40, 128], [40, 62]];
const scenes: ReactElement[] = [
  // 1. your people around one circle
  <g key="a">
    <circle cx="100" cy="95" r="62" className="o-track" />
    {people.map(([x, y], i) => <g key={i} className="o-float" style={{ animationDelay: `${i * 0.25}s` }}>
      <circle cx={x} cy={y} r="17" className={`o-p o-p${i % 3}`} /><circle cx={x} cy={y - 4} r="6" className="o-face" /><path d={`M${x - 9} ${y + 10}q9-9 18 0`} className="o-face" />
    </g>)}
    <circle cx="100" cy="95" r="26" className="o-coin" /><path d="M93 95h14M100 88v14" className="o-coin-mark" />
  </g>,
  // 2. a goal with a date and the planner's path
  <g key="b">
    <rect x="28" y="40" width="70" height="66" rx="10" className="o-card" /><path d="M28 58h70" className="o-line" /><path d="M44 32v14M82 32v14" className="o-line" />
    <circle cx="63" cy="82" r="11" className="o-coin" />
    <path d="M100 120c18-2 30-20 44-44" className="o-path" />
    <circle cx="150" cy="66" r="30" className="o-target" /><circle cx="150" cy="66" r="18" className="o-target2" /><circle cx="150" cy="66" r="7" className="o-coin" />
    <path d="M150 66 172 38" className="o-line" /><path d="M172 38l8-2-2 8z" className="o-flag" />
    <g className="o-float"><rect x="36" y="128" width="128" height="34" rx="17" className="o-chip" /><path d="M58 145h84" className="o-chip-line" /></g>
  </g>,
  // 3. early / middle / late, same pot
  <g key="c">
    {[0, 1, 2].map((i) => <g key={i} className="o-float" style={{ animationDelay: `${i * 0.3}s` }}>
      <rect x={22 + i * 56} y={46 + (i === 1 ? -10 : 0)} width="44" height="96" rx="12" className={`o-turn o-turn${i}`} />
      <circle cx={44 + i * 56} cy={70 + (i === 1 ? -10 : 0)} r="10" className="o-face" />
      <circle cx={44 + i * 56} cy={118 + (i === 1 ? -10 : 0)} r="12" className="o-coin" />
    </g>)}
    <path d="M30 168h140" className="o-line" /><path d="M44 162v12M100 162v12M156 162v12" className="o-line" />
  </g>,
  // 4. the pledge: a document, a seal and a signature
  <g key="d">
    <rect x="48" y="24" width="104" height="138" rx="10" className="o-card" />
    {[48, 62, 76, 90].map((y) => <path key={y} d={`M64 ${y}h${y === 90 ? 44 : 72}`} className="o-line" />)}
    <path d="M64 130c8-10 14 6 22-4s12 8 22-2" className="o-sign" />
    <g className="o-float"><path d="M150 112 132 120v13c0 11 8 20 18 24 10-4 18-13 18-24v-13z" className="o-shield" /><path d="m142 136 6 6 10-11" className="o-check" /></g>
  </g>,
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const slides = t.onb.slides;
  const [i, setI] = useState(0);
  const touch = useRef<number | null>(null);
  const rtl = document.documentElement.dir === 'rtl';
  const last = i === slides.length - 1;
  const finish = () => { markOnboarded(); onDone(); };
  const go = (d: number) => setI((x) => Math.max(0, Math.min(slides.length - 1, x + d)));

  return (
    <section className="onboarding" aria-roledescription="carousel" aria-label={t.onb.label} data-testid="onboarding"
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') go(rtl ? 1 : -1); if (e.key === 'ArrowRight') go(rtl ? -1 : 1); }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (touch.current == null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) go((dx < 0) === rtl ? -1 : 1); touch.current = null; }}>
      <div className="onb-top"><button className="btn btn-ghost" onClick={finish}>{t.onb.skip}</button></div>
      <div className="onb-slide" key={i} role="group" aria-roledescription="slide" aria-label={t.onb.slideOf(i + 1, slides.length)}>
        <svg className={`onb-art s${i}`} viewBox="0 0 200 190" role="img" aria-label={slides[i].title}>{scenes[i]}</svg>
        <h1 className="display">{slides[i].title}</h1>
        <p className="muted">{slides[i].body}</p>
      </div>
      <div className="onb-dots" aria-hidden="true">{slides.map((_: unknown, j: number) => <span key={j} className={j === i ? 'on' : ''} />)}</div>
      <div className="onb-actions">
        {i > 0 && <button className="btn btn-ghost" onClick={() => go(-1)}>{t.wiz.back}</button>}
        <button className="btn btn-primary btn-wide" onClick={() => (last ? finish() : go(1))} autoFocus>{last ? t.onb.start : t.onb.next}</button>
      </div>
    </section>
  );
}
