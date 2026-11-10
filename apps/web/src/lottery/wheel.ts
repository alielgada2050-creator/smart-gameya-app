/**
 * Canvas drawing for the draw wheel and the shareable result card.
 * The wheel never decides anything: it is rotated to land on the position-1 member of a draw the server already made
 * (commit–reveal, verifiable). Pure functions of their inputs so the same picture can be drawn live, replayed or exported.
 */
export interface Slice { memberId: string; name: string }

// Brand palette, three-way cycle so neighbours never match (also for odd member counts): navy, gold, blue-slate.
const FILLS = ['#0F172A', '#F59E0B', '#2B4A7E'];
const INKS = ['#FFFFFF', '#0F172A', '#FFFFFF'];
export const FONT = '"IBM Plex Sans Arabic", "IBM Plex Sans", Tahoma, sans-serif';

const TAU = Math.PI * 2;
export const sliceAngle = (n: number) => TAU / n;

/** Rotation that puts the centre of slice `index` (plus a small in-slice offset) under the pointer at 12 o'clock. */
export function landingAngle(n: number, index: number, offset = 0) {
  const seg = sliceAngle(n);
  return -Math.PI / 2 - (index + 0.5) * seg - offset * seg;
}

/** Index of the slice under the pointer for a given rotation. */
export function sliceAtPointer(n: number, rotation: number) {
  const seg = sliceAngle(n);
  const a = (((-Math.PI / 2 - rotation) % TAU) + TAU) % TAU;
  return Math.floor(a / seg) % n;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/**
 * Draws the wheel centred at (cx, cy). `lit` lights the rim bulbs (animated while spinning); `highlight` brightens one slice.
 */
export function drawWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, slices: Slice[], rotation: number,
  opts: { lit?: number; highlight?: number | null; hubLabel?: string; hubSub?: string } = {}) {
  const n = Math.max(slices.length, 1);
  const seg = sliceAngle(n);
  ctx.save();
  // soft shadow + outer gold rim
  ctx.shadowColor = 'rgba(2, 6, 23, .45)'; ctx.shadowBlur = r * 0.12; ctx.shadowOffsetY = r * 0.04;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.07, 0, TAU); ctx.fillStyle = '#B45309'; ctx.fill();
  ctx.shadowColor = 'transparent';
  const rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  rim.addColorStop(0, '#FCD34D'); rim.addColorStop(0.5, '#F59E0B'); rim.addColorStop(1, '#B45309');
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.055, 0, TAU); ctx.fillStyle = rim; ctx.fill();

  // slices
  for (let i = 0; i < n; i++) {
    const a0 = rotation + i * seg, a1 = a0 + seg;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    const k = n === 1 ? 0 : (n % 3 === 1 && i === n - 1 ? 2 : i % 3); // avoid same colour across the seam
    ctx.fillStyle = FILLS[k]; ctx.fill();
    const dim = opts.highlight != null && opts.highlight !== i;
    if (dim) { ctx.fillStyle = 'rgba(2, 6, 23, .55)'; ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, r * 0.006); ctx.stroke();
    // name along the radius, ending near the rim; flipped on the left half so it never reads upside down
    ctx.save();
    const mid = a0 + seg / 2;
    const norm = ((mid % TAU) + TAU) % TAU;
    const left = norm > Math.PI / 2 && norm < (3 * Math.PI) / 2;
    ctx.translate(cx, cy); ctx.rotate(mid + (left ? Math.PI : 0));
    ctx.fillStyle = INKS[k]; ctx.globalAlpha = dim ? 0.55 : 1;
    const size = Math.max(11, Math.min(r * 0.11, (r * seg) / 2.4));
    ctx.font = `700 ${size}px ${FONT}`; ctx.textAlign = left ? 'left' : 'right'; ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillText(fitText(ctx, slices[i]?.name ?? '', r * 0.58), left ? -r * 0.9 : r * 0.9, 0);
    ctx.restore();
  }

  // the winner's slice: a gold frame on top of everything else
  if (opts.highlight != null) {
    const a0 = rotation + opts.highlight * seg;
    ctx.save(); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r * 0.995, a0, a0 + seg); ctx.closePath();
    ctx.shadowColor = 'rgba(251, 191, 36, .9)'; ctx.shadowBlur = r * 0.08;
    ctx.strokeStyle = '#FDE68A'; ctx.lineWidth = Math.max(3, r * 0.022); ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
  }

  // rim bulbs
  const bulbs = Math.max(12, n * 4);
  for (let i = 0; i < bulbs; i++) {
    const a = rotation + (i / bulbs) * TAU;
    const on = opts.lit === undefined ? i % 2 === 0 : (i + opts.lit) % 2 === 0;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 1.028, cy + Math.sin(a) * r * 1.028, r * 0.016, 0, TAU);
    ctx.fillStyle = on ? '#FFFBEB' : '#92400E'; ctx.fill();
  }

  // hub
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.24, 0, TAU); ctx.fillStyle = '#FBBF24'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.21, 0, TAU); ctx.fillStyle = '#0F172A'; ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  if (opts.hubLabel) {
    ctx.font = `700 ${r * (opts.hubLabel.length > 2 ? 0.075 : 0.16)}px ${FONT}`;
    ctx.fillText(opts.hubLabel, cx, cy - (opts.hubSub ? r * 0.03 : 0));
  }
  if (opts.hubSub) { ctx.font = `500 ${r * 0.045}px ${FONT}`; ctx.fillStyle = '#FCD34D'; ctx.fillText(opts.hubSub, cx, cy + r * 0.1); }
  ctx.restore();
}

/** The pointer at 12 o'clock; `kick` tilts it as pegs pass. */
export function drawPointer(ctx: CanvasRenderingContext2D, cx: number, top: number, size: number, kick = 0) {
  ctx.save();
  ctx.translate(cx, top); ctx.rotate(kick);
  ctx.shadowColor = 'rgba(2, 6, 23, .5)'; ctx.shadowBlur = size * 0.3; ctx.shadowOffsetY = size * 0.08;
  ctx.beginPath(); ctx.moveTo(-size * 0.42, -size * 0.2); ctx.lineTo(size * 0.42, -size * 0.2); ctx.lineTo(0, size * 0.75); ctx.closePath();
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath(); ctx.moveTo(-size * 0.3, -size * 0.12); ctx.lineTo(size * 0.3, -size * 0.12); ctx.lineTo(0, size * 0.58); ctx.closePath();
  ctx.fillStyle = '#DC2626'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, -size * 0.2, size * 0.16, 0, TAU); ctx.fillStyle = '#FBBF24'; ctx.fill();
  ctx.restore();
}

/**
 * Shareable result card (1080 × 1350, portrait for chat apps): the wheel at rest on the winner, the full order and the
 * fingerprint anyone can verify. Drawn on the member's own device from the server's record — nothing is uploaded.
 */
export async function renderResultCard(input: { circleName: string; slices: Slice[]; order: { position: number; name: string }[]; winnerIndex: number;
  commitment: string; verified: boolean; executedAt: string; labels: { title: string; first: string; fingerprint: string; verified: string; brand: string } }): Promise<Blob> {
  try { await Promise.all([document.fonts.load(`700 40px ${FONT}`), document.fonts.load(`500 28px ${FONT}`)]); } catch { /* fallback font */ }
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0F172A'); bg.addColorStop(1, '#1E2B4D');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // soft gold glow behind the wheel
  const glow = ctx.createRadialGradient(W / 2, 520, 60, W / 2, 520, 520); glow.addColorStop(0, 'rgba(245,158,11,.35)'); glow.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.fillStyle = '#FCD34D';
  ctx.font = `500 34px ${FONT}`; ctx.fillText(input.labels.title, W / 2, 92);
  ctx.fillStyle = '#FFFFFF'; ctx.font = `700 60px ${FONT}`; ctx.fillText(input.circleName, W / 2, 168);
  const rot = landingAngle(input.slices.length, input.winnerIndex);
  drawWheel(ctx, W / 2, 540, 300, input.slices, rot, { highlight: input.winnerIndex, hubLabel: '1', hubSub: input.labels.first });
  drawPointer(ctx, W / 2, 540 - 300 - 34, 62);
  // order list
  const top = 925, rowH = Math.min(62, 300 / Math.max(input.order.length, 1));
  const shown = input.order.slice(0, 8);
  ctx.font = `700 ${rowH * 0.5}px ${FONT}`;
  const nameW = Math.max(...shown.map((o) => ctx.measureText(o.name).width), 80);
  const right = W / 2 + (nameW + rowH * 1.3) / 2; // centre the whole list block
  shown.forEach((o, i) => {
    const y = top + i * rowH;
    ctx.fillStyle = i === 0 ? '#F59E0B' : 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(right - rowH * 0.36, y, rowH * 0.36, 0, TAU); ctx.fill();
    ctx.fillStyle = i === 0 ? '#0F172A' : '#FFFFFF'; ctx.textAlign = 'center'; ctx.font = `700 ${rowH * 0.42}px ${FONT}`; ctx.fillText(String(o.position), right - rowH * 0.36, y + 2);
    ctx.textAlign = 'right'; ctx.fillStyle = '#FFFFFF'; ctx.font = `${i === 0 ? 700 : 500} ${rowH * 0.5}px ${FONT}`; ctx.fillText(o.name, right - rowH * 1.0, y + 2);
  });
  if (input.order.length > 8) { ctx.fillStyle = '#A3B1C6'; ctx.font = `500 26px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText(`+${input.order.length - 8}`, right - rowH, top + 8 * rowH); }
  // footer: fingerprint + verification + date
  ctx.textAlign = 'center'; ctx.fillStyle = input.verified ? '#4ADE80' : '#F87171'; ctx.font = `700 30px ${FONT}`;
  ctx.fillText(input.labels.verified, W / 2, H - 150);
  ctx.fillStyle = '#A3B1C6'; ctx.font = `500 24px ${FONT}`;
  ctx.fillText(input.labels.fingerprint, W / 2, H - 110);
  ctx.direction = 'ltr'; ctx.font = `500 22px ui-monospace, Menlo, monospace`; ctx.fillText(input.commitment, W / 2, H - 76); ctx.direction = 'rtl';
  ctx.font = `500 24px ${FONT}`;
  ctx.fillText(`${input.labels.brand} · ${new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(input.executedAt))}`, W / 2, H - 38);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('image'))), 'image/png'));
}
