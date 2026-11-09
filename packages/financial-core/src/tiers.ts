import { type Minor, parseMoney } from './money.ts';

/**
 * Circle tiers by payout value (pot = contribution × members), approved by the owner 2026-11-09.
 *   SMALL  : pot ≤ 10,000 SAR
 *   MEDIUM : 10,000 < pot ≤ 50,000 SAR   (owner wrote "11 to 50 thousand"; made contiguous so no pot falls in a gap)
 *   LARGE  : 50,000 < pot ≤ 100,000 SAR  → platform-admin approval + a promissory note from every member to the organizer
 *   above 100,000 SAR: not allowed.
 * Limits are per currency. A currency without configured limits cannot be used for circles yet.
 */
export type Tier = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface TierLimits { smallMax: Minor; mediumMax: Minor; largeMax: Minor }

export const TIER_LIMITS: Record<string, TierLimits | undefined> = {
  SAR: { smallMax: parseMoney('10000', 'SAR'), mediumMax: parseMoney('50000', 'SAR'), largeMax: parseMoney('100000', 'SAR') },
  // EGP / AED: to be set by the owner before circles in those countries are enabled.
};

export type TierResult =
  | { ok: true; tier: Tier; requiresPlatformApproval: boolean; requiresPromissoryNotes: boolean; limits: TierLimits }
  | { ok: false; reason: 'CURRENCY_NOT_ENABLED' | 'ABOVE_MAXIMUM'; limits?: TierLimits };

export function classifyPot(pot: Minor, currency: string, limits = TIER_LIMITS[currency]): TierResult {
  if (!limits) return { ok: false, reason: 'CURRENCY_NOT_ENABLED' };
  if (pot > limits.largeMax) return { ok: false, reason: 'ABOVE_MAXIMUM', limits };
  const tier: Tier = pot <= limits.smallMax ? 'SMALL' : pot <= limits.mediumMax ? 'MEDIUM' : 'LARGE';
  return { ok: true, tier, requiresPlatformApproval: tier === 'LARGE', requiresPromissoryNotes: tier === 'LARGE', limits };
}

/** Parse "TIER_LIMITS_EGP=20000,100000,200000" style overrides (whole units). */
export function limitsFromEnv(currency: string, raw: string | undefined): TierLimits | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 3) throw new Error(`TIER_LIMITS_${currency} needs three values: small,medium,large`);
  const [a, b, c] = parts.map((p) => parseMoney(p, currency));
  if (!(a > 0n && a < b && b < c)) throw new Error(`TIER_LIMITS_${currency} must be increasing and positive`);
  return { smallMax: a, mediumMax: b, largeMax: c };
}
