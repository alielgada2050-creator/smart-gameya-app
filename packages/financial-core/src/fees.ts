import { type Minor, MoneyError, allocateEvenly, applyBps } from './money.ts';

/**
 * Position-based service fee / incentive policy.
 * Functional pattern observed on the reference site (VERIFIED, public "how it works"): early turns pay a fee,
 * middle turns pay little or none, late turns receive a discount; the fee is spread over the installments
 * paid up to the member's payout turn. Values here are configurable policy, not copied figures, and
 * MUST pass legal/Sharia review before production (COMPLIANCE_ASSESSMENT.md).
 */
export interface FeePolicy {
  version: string;
  /** bps of the pot charged per payout position (index 0 = position 1). Negative not allowed; use discountBps. */
  feeBps: number[];
  /** bps of one contribution credited back to late positions (index 0 = position 1). */
  discountBps: number[];
  maxFeeBps: number; // hard cap, enforced
}

export interface FeePlan {
  position: number;
  totalFee: Minor;
  feePerInstallment: Minor[]; // length == position (spread over installments up to payout)
  discount: Minor; // credited on the final installment
  installments: Minor[]; // contribution + fee share - discount, per cycle (length == members)
}

export function validatePolicy(p: FeePolicy, members: number): string[] {
  const e: string[] = [];
  if (p.feeBps.length !== members || p.discountBps.length !== members) e.push('policy arrays must have one entry per position');
  p.feeBps.forEach((b, i) => {
    if (!Number.isInteger(b) || b < 0) e.push(`feeBps[${i}] invalid`);
    if (b > p.maxFeeBps) e.push(`feeBps[${i}] exceeds cap ${p.maxFeeBps}`);
  });
  p.discountBps.forEach((b, i) => {
    if (!Number.isInteger(b) || b < 0 || b > 10000) e.push(`discountBps[${i}] invalid`);
    if (b > 0 && p.feeBps[i] > 0) e.push(`position ${i + 1} cannot have both a fee and a discount`);
  });
  return e;
}

export function computeFeePlan(contribution: Minor, members: number, position: number, policy: FeePolicy): FeePlan {
  const errors = validatePolicy(policy, members);
  if (errors.length) throw new MoneyError(errors.join('; '));
  if (!Number.isInteger(position) || position < 1 || position > members) throw new MoneyError('position out of range');
  const pot = contribution * BigInt(members);
  const totalFee = applyBps(pot, policy.feeBps[position - 1]);
  const feePerInstallment = allocateEvenly(totalFee, position);
  const discount = applyBps(contribution, policy.discountBps[position - 1]);
  const installments = Array.from({ length: members }, (_, i) => {
    let v = contribution + (i < position ? feePerInstallment[i] : 0n);
    if (i === members - 1) v -= discount;
    return v < 0n ? 0n : v;
  });
  return { position, totalFee, feePerInstallment, discount, installments };
}
