import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n.ts';
import { shareImage, tick } from '../platform.ts';
import { drawPointer, drawWheel, FONT, landingAngle, renderResultCard, sliceAtPointer, type Slice } from './wheel.ts';

export interface DrawResult { order: { position: number; memberId: string }[]; commitment: string; verified: boolean; executedAt: string }

const COUNT_FROM = 10;        // owner request: count down 10 → 1, one per second
const SPIN_MS = 7000;
const TAU = Math.PI * 2;

/**
 * Full-screen draw scene. Live (organizer runs the draw: the server result is requested as the countdown starts) or
 * replay (members who open the circle afterwards watch the same record). The wheel only shows the server's result.
 */
export function DrawStage({ circleName, slices, getResult, mode, onClose }: {
  circleName: string; slices: Slice[]; getResult: () => Promise<DrawResult>; mode: 'live' | 'replay'; onClose: (r: DrawResult | null) => void;
}) {
  const { t } = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const ticker = useRef<HTMLParagraphElement>(null);
  const [phase, setPhase] = useState<'countdown' | 'waiting' | 'spin' | 'reveal'>('countdown');
  const [count, setCount] = useState(COUNT_FROM);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const skip = useRef(false);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const n = slices.length;
  const winner = result ? slices.findIndex((s) => s.memberId === result.order.find((o) => o.position === 1)?.memberId) : -1;
  const nameOf = (id: string) => slices.find((s) => s.memberId === id)?.name ?? '?';
  const ordered = result ? [...result.order].sort((a, b) => a.position - b.position) : [];

  // fetch / execute as the countdown starts, so the result is fixed before anything spins
  useEffect(() => {
    let live = true;
    getResult().then((r) => live && setResult(r)).catch((e) => live && setError((e as Error).message || 'error'));
    return () => { live = false; };
  }, []);

  // countdown 10 → 1
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count === 0) { setPhase('waiting'); return; }
    const id = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, count]);

  // once the countdown is over and the result is in, spin (or jump straight to the result with reduced motion / skip)
  useEffect(() => {
    if (phase === 'waiting' && result) setPhase(reduced || skip.current ? 'reveal' : 'spin');
  }, [phase, result]);

  // one animation loop for the whole scene
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0, rotation = -Math.PI / 2 - Math.PI / Math.max(n, 1), last = performance.now(), spinStart = 0, from = 0, to = 0;
    let lastIdx = -1, kick = 0;
    const chips: { x: number; y: number; vx: number; vy: number; a: number; life: number; name: string; size: number }[] = [];
    const confetti: { x: number; y: number; vx: number; vy: number; r: number; spin: number; w: number; h: number; color: string }[] = [];
    let spawn = 0, confettiStarted = false, landed = false;

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const box = c.getBoundingClientRect();
      if (c.width !== Math.round(box.width * dpr) || c.height !== Math.round(box.height * dpr)) { c.width = Math.round(box.width * dpr); c.height = Math.round(box.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: box.width, h: box.height };
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const { w, h } = size();
      const r = Math.min(w * 0.44, h * 0.38), cx = w / 2, cy = Math.min(h * 0.47, r * 1.25 + 24);
      ctx.clearRect(0, 0, w, h);
      const p = phaseRef.current;

      if (p === 'countdown' || p === 'waiting') {
        if (!reduced) rotation += dt * 0.35;
        // names fly up around the wheel while we count down
        spawn -= dt;
        if (!reduced && spawn <= 0 && n) {
          spawn = 0.26;
          const s = slices[Math.floor(Math.random() * n)];
          chips.push({ x: Math.random() * w, y: h + 20, vx: (Math.random() - 0.5) * 40, vy: -(70 + Math.random() * 90), a: (Math.random() - 0.5) * 0.4, life: 1, name: s.name, size: 13 + Math.random() * 9 });
        }
      }
      if (p === 'spin') {
        if (!spinStart) {
          spinStart = now; from = rotation;
          const offset = (Math.random() - 0.5) * 0.6; // land anywhere inside the winner's slice, not always dead centre
          const base = landingAngle(n, winnerRef.current, offset);
          to = base + Math.ceil((from - base) / TAU) * TAU + 7 * TAU;
        }
        const k = Math.min(1, (now - spinStart) / SPIN_MS);
        const ease = 1 - Math.pow(1 - k, 4);
        rotation = from + (to - from) * ease;
        const idx = sliceAtPointer(n, rotation);
        if (idx !== lastIdx) {
          lastIdx = idx; kick = -0.45;
          if (ticker.current) ticker.current.textContent = slices[idx]?.name ?? '';
          if (k > 0.75) void tick();
        }
        if (k >= 1) { phaseRef.set('reveal'); }
      }
      if (p === 'reveal') {
        if (!landed) { rotation = spinStart ? to : landingAngle(n, winnerRef.current); landed = true; } // skip mid-spin still lands on the winner
        if (!confettiStarted && !reduced) {
          confettiStarted = true;
          const colors = ['#F59E0B', '#FBBF24', '#FFFFFF', '#2B4A7E', '#16A34A', '#F472B6'];
          for (let i = 0; i < 220; i++) confetti.push({ x: cx + (Math.random() - 0.5) * 60, y: cy - r * 0.2, vx: (Math.random() - 0.5) * 900, vy: -300 - Math.random() * 700, r: Math.random() * TAU, spin: (Math.random() - 0.5) * 12, w: 6 + Math.random() * 6, h: 10 + Math.random() * 8, color: colors[i % colors.length] });
        }
      }

      // flying name chips (behind the wheel)
      for (let i = chips.length - 1; i >= 0; i--) {
        const ch = chips[i];
        ch.x += ch.vx * dt; ch.y += ch.vy * dt; ch.life -= dt * 0.28;
        if (ch.life <= 0 || ch.y < -30 || p === 'spin' || p === 'reveal') { chips.splice(i, 1); continue; }
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, ch.life)) * 0.85; ctx.translate(ch.x, ch.y); ctx.rotate(ch.a);
        ctx.font = `700 ${ch.size}px ${FONT}`; ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(ch.name).width + 20;
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect(-tw / 2, -ch.size * 0.9, tw, ch.size * 1.8, ch.size); ctx.fill();
        ctx.fillStyle = '#FDE68A'; ctx.fillText(ch.name, 0, 1); ctx.restore();
      }

      const counting = p === 'countdown';
      const pulse = counting ? 1 + 0.12 * Math.max(0, 1 - ((now % 1000) / 380)) : 1;
      drawWheel(ctx, cx, cy, r, slices, rotation, {
        lit: p === 'spin' ? Math.floor(now / 90) : p === 'reveal' ? Math.floor(now / 300) : Math.floor(now / 600),
        highlight: p === 'reveal' ? winnerRef.current : null,
        hubLabel: counting ? String(countRef.current) : p === 'waiting' ? '…' : p === 'reveal' ? '1' : '',
        hubSub: p === 'reveal' ? labelsRef.current.first : undefined,
      });
      if (counting && !reduced && pulse > 1) { // pulse ring on each second
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.24 * pulse, 0, TAU); ctx.strokeStyle = `rgba(251,191,36,${(pulse - 1) * 5})`; ctx.lineWidth = 4; ctx.stroke();
      }
      kick *= 0.82;
      drawPointer(ctx, cx, cy - r * 1.07 - r * 0.07, r * 0.2, kick);

      // confetti (in front)
      for (let i = confetti.length - 1; i >= 0; i--) {
        const f = confetti[i];
        f.vy += 1100 * dt; f.vx *= 0.99; f.x += f.vx * dt; f.y += f.vy * dt; f.r += f.spin * dt;
        if (f.y > h + 40) { confetti.splice(i, 1); continue; }
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.r); ctx.fillStyle = f.color; ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h * Math.abs(Math.cos(f.r))); ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // refs the animation loop reads without re-subscribing
  const phaseRef = useRefState(phase, setPhase);
  const countRef = useRef(count); countRef.current = count;
  const winnerRef = useRef(winner); winnerRef.current = Math.max(winner, 0);
  const labelsRef = useRef({ first: t.draw.firstTurn }); labelsRef.current = { first: t.draw.firstTurn };

  async function saveCard() {
    if (!result) return;
    setImgBusy(true);
    try {
      const blob = await renderResultCard({
        circleName, slices, winnerIndex: Math.max(winner, 0), commitment: result.commitment, verified: result.verified, executedAt: result.executedAt,
        order: ordered.map((o) => ({ position: o.position, name: nameOf(o.memberId) })),
        labels: { title: t.draw.cardTitle, first: t.draw.firstTurn, fingerprint: t.draw.fingerprint, verified: result.verified ? t.draw.verifiedBadge : t.notVerified, brand: t.appName },
      });
      await shareImage(blob, 'jamiyati-draw.png', `${t.draw.cardTitle} ${circleName}`);
    } finally { setImgBusy(false); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase === 'reveal') onClose(result); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [phase, result]);

  return (
    <div className="draw-stage" role="dialog" aria-modal="true" aria-label={t.draw.title} data-testid="draw-stage" data-phase={phase}>
      <header className="draw-head">
        <div>
          <p className="draw-kicker">{mode === 'live' ? t.draw.live : t.draw.replay}</p>
          <h2>{circleName}</h2>
        </div>
        {phase !== 'reveal' && !error && (
          <button className="btn draw-ghost" onClick={() => { skip.current = true; if (phase === 'countdown') setPhase('waiting'); else if (phase === 'spin') setPhase(result ? 'reveal' : phase); }}>{t.draw.skip}</button>
        )}
      </header>
      <canvas ref={canvas} className="draw-canvas" aria-hidden="true" />
      <div className="draw-foot" aria-live="polite">
        {error ? (
          <div className="stack-sm"><p className="notice error">{error}</p><button className="btn btn-secondary" onClick={() => onClose(null)}>{t.cele.close}</button></div>
        ) : phase === 'countdown' ? (
          <p className="draw-status">{t.draw.startsIn(count)}<span className="sr-only">{count === COUNT_FROM ? t.draw.title : ''}</span></p>
        ) : phase === 'waiting' ? (
          <p className="draw-status">{t.draw.waiting}</p>
        ) : phase === 'spin' ? (
          <p className="draw-ticker" ref={ticker} aria-hidden="true" />
        ) : result && (
          <div className="draw-result">
            <p className="draw-kicker">{t.draw.firstTurn}</p>
            <p className="draw-winner" data-testid="draw-winner">{nameOf(ordered[0].memberId)}</p>
            <ol className="draw-order">
              {ordered.map((o, i) => <li key={o.memberId} style={{ '--i': i } as CSSProperties}><span>{o.position}</span>{nameOf(o.memberId)}</li>)}
            </ol>
            <p className={result.verified ? 'draw-verified' : 'notice error'}>{result.verified ? t.draw.verifiedLine : t.notVerified}</p>
            <div className="draw-actions">
              <button className="btn btn-primary" disabled={imgBusy} onClick={saveCard}>{t.draw.saveImage}</button>
              <button className="btn draw-ghost" onClick={() => onClose(result)}>{t.cele.close}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A ref that mirrors state and can also push a new state from inside the animation loop. */
function useRefState<T>(value: T, set: (v: T) => void) {
  const r = useRef({ current: value, set });
  r.current.current = value; r.current.set = set;
  return r.current;
}
