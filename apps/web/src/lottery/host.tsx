import { useEffect, useState } from 'react';
import { DrawStage, type DrawResult } from './DrawStage.tsx';
import type { Slice } from './wheel.ts';

export interface StageRequest { circleName: string; slices: Slice[]; mode: 'live' | 'replay'; getResult: () => Promise<DrawResult>; onClose?: (r: DrawResult | null) => void }

/** Opens the draw scene at app level, so the circle page can reload underneath without cutting the wheel off mid-spin. */
export function openDrawStage(req: StageRequest) { dispatchEvent(new CustomEvent<StageRequest>('sg:draw-stage', { detail: req })); }

export function DrawStageHost() {
  const [req, setReq] = useState<StageRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<StageRequest>).detail);
    addEventListener('sg:draw-stage', on);
    return () => removeEventListener('sg:draw-stage', on);
  }, []);
  if (!req) return null;
  return <DrawStage key={req.mode + req.circleName} {...req} onClose={(r) => { setReq(null); req.onClose?.(r); }} />;
}
