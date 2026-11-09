import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Verifiable payout-order lottery (MASTER PROMPT §5.4). The lottery is NOT an AI decision.
 *
 * Protocol (commit–reveal):
 *  1. prepareDraw(): server generates a 256-bit CSPRNG seed and publishes ONLY sha256(seed) (the commitment)
 *     to every member before the draw, together with the canonical candidate list.
 *  2. executeDraw(): mixes the seed with public entropy unknown at commit time (e.g. a value announced at draw
 *     time, or a hash of members' submitted nonces), derives a keystream with HMAC-SHA256 and runs an unbiased
 *     Fisher–Yates shuffle (rejection sampling, no modulo bias).
 *  3. The seed is revealed in the record; anyone can run verifyDraw() to recompute the exact result and check
 *     the commitment. The operator cannot pick a seed after seeing the entropy, and cannot change the result
 *     without breaking the commitment.
 */
export const LOTTERY_ALGORITHM_VERSION = 'sg-lottery/1.0.0-hmac-sha256-fy';

export interface Candidate {
  memberId: string;
  eligible: boolean; // false → excluded (conflict of interest, withdrawn, agreed restriction)
  fixedPosition?: number; // mixed mode: pre-agreed position, approved by all members
}

export interface PreparedDraw {
  circleId: string;
  algorithmVersion: string;
  candidates: Candidate[]; // canonical order (sorted by memberId)
  commitment: string; // hex sha256(seed) — publish this
  seedHex: string; // SECRET until execution; store encrypted, never send to clients before the draw
  preparedAt: string;
}

export interface DrawRecord {
  circleId: string;
  algorithmVersion: string;
  candidates: Candidate[];
  commitment: string;
  revealedSeedHex: string;
  publicEntropy: string;
  order: { position: number; memberId: string; source: 'FIXED' | 'DRAWN' }[];
  executedAt: string;
  executedBy: string;
  approvedBy: string; // maker–checker: must differ from executedBy
  isTrial: boolean;
}

export class LotteryError extends Error {}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function canonical(cands: Candidate[]): Candidate[] {
  const ids = new Set<string>();
  for (const c of cands) {
    if (!c.memberId) throw new LotteryError('memberId required');
    if (ids.has(c.memberId)) throw new LotteryError(`duplicate member ${c.memberId}`);
    ids.add(c.memberId);
  }
  return [...cands].sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0)).map((c) => ({ ...c }));
}

export function prepareDraw(circleId: string, candidates: Candidate[], now = new Date(), seed = randomBytes(32)): PreparedDraw {
  if (seed.length !== 32) throw new LotteryError('seed must be 32 bytes');
  const cands = canonical(candidates);
  assignSlots(cands); // validate early
  return {
    circleId,
    algorithmVersion: LOTTERY_ALGORITHM_VERSION,
    candidates: cands,
    commitment: sha256(seed),
    seedHex: seed.toString('hex'),
    preparedAt: now.toISOString(),
  };
}

/** Validates fixed positions and returns the free slots to be filled by the draw. */
function assignSlots(cands: Candidate[]) {
  const eligible = cands.filter((c) => c.eligible);
  if (eligible.length < 2) throw new LotteryError('at least 2 eligible members are required');
  const n = eligible.length;
  const taken = new Set<number>();
  for (const c of eligible) {
    if (c.fixedPosition === undefined) continue;
    if (!Number.isInteger(c.fixedPosition) || c.fixedPosition < 1 || c.fixedPosition > n)
      throw new LotteryError(`fixed position ${c.fixedPosition} out of range 1..${n}`);
    if (taken.has(c.fixedPosition)) throw new LotteryError(`position ${c.fixedPosition} assigned twice`);
    taken.add(c.fixedPosition);
  }
  const freeSlots = Array.from({ length: n }, (_, i) => i + 1).filter((p) => !taken.has(p));
  const drawn = eligible.filter((c) => c.fixedPosition === undefined);
  return { eligible, freeSlots, drawn };
}

/** Deterministic keystream of uint32 values derived from seed + context. */
function* keystream(seedHex: string, context: string): Generator<number> {
  const key = Buffer.from(seedHex, 'hex');
  for (let counter = 0; ; counter++) {
    const block = createHmac('sha256', key).update(`${context}|${counter}`).digest();
    for (let i = 0; i < block.length; i += 4) yield block.readUInt32BE(i);
  }
}

/** Unbiased integer in [0, n) via rejection sampling. */
function uniformInt(ks: Generator<number>, n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  for (;;) {
    const v = ks.next().value as number;
    if (v < limit) return v % n;
  }
}

function computeOrder(p: { circleId: string; algorithmVersion: string; candidates: Candidate[] }, seedHex: string, publicEntropy: string) {
  if (p.algorithmVersion !== LOTTERY_ALGORITHM_VERSION) throw new LotteryError(`unsupported algorithm ${p.algorithmVersion}`);
  const { eligible, freeSlots, drawn } = assignSlots(p.candidates);
  const context = `${p.algorithmVersion}|${p.circleId}|${sha256(publicEntropy)}|${p.candidates.map((c) => c.memberId).join(',')}`;
  const ks = keystream(seedHex, context);
  const pool = drawn.map((c) => c.memberId);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = uniformInt(ks, i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const order: DrawRecord['order'] = [
    ...eligible.filter((c) => c.fixedPosition !== undefined).map((c) => ({ position: c.fixedPosition!, memberId: c.memberId, source: 'FIXED' as const })),
    ...pool.map((memberId, i) => ({ position: freeSlots[i], memberId, source: 'DRAWN' as const })),
  ];
  return order.sort((a, b) => a.position - b.position);
}

export function executeDraw(
  p: PreparedDraw,
  opts: { publicEntropy: string; executedBy: string; approvedBy: string; isTrial?: boolean; now?: Date },
): DrawRecord {
  if (!opts.publicEntropy) throw new LotteryError('publicEntropy is required');
  if (!opts.isTrial && opts.executedBy === opts.approvedBy) throw new LotteryError('maker–checker: executor and approver must differ');
  if (sha256(Buffer.from(p.seedHex, 'hex')) !== p.commitment) throw new LotteryError('seed does not match commitment');
  return {
    circleId: p.circleId,
    algorithmVersion: p.algorithmVersion,
    candidates: p.candidates,
    commitment: p.commitment,
    revealedSeedHex: p.seedHex,
    publicEntropy: opts.publicEntropy,
    order: computeOrder(p, p.seedHex, opts.publicEntropy),
    executedAt: (opts.now ?? new Date()).toISOString(),
    executedBy: opts.executedBy,
    approvedBy: opts.approvedBy,
    isTrial: opts.isTrial ?? false,
  };
}

/** Independent verification any member/auditor can run. */
export function verifyDraw(r: DrawRecord): { valid: boolean; reason?: string } {
  try {
    const seed = Buffer.from(r.revealedSeedHex, 'hex');
    const a = Buffer.from(sha256(seed), 'hex');
    const b = Buffer.from(r.commitment, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'commitment mismatch' };
    const expected = computeOrder(r, r.revealedSeedHex, r.publicEntropy);
    const same = expected.length === r.order.length && expected.every((e, i) => e.memberId === r.order[i].memberId && e.position === r.order[i].position);
    return same ? { valid: true } : { valid: false, reason: 'order does not match recomputation' };
  } catch (e) {
    return { valid: false, reason: (e as Error).message };
  }
}

/** Probability each drawn member lands in any given free slot — shown to members before the draw (§5.4). */
export function selectionProbability(candidates: Candidate[]): { memberId: string; perSlot: string }[] {
  const { drawn } = assignSlots(canonical(candidates));
  return drawn.map((c) => ({ memberId: c.memberId, perSlot: `1/${drawn.length}` }));
}
