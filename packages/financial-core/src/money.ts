/**
 * Money is represented as bigint minor units (halalas for SAR: 1 SAR = 100 halalas).
 * Floating point is never used for balances (MASTER PROMPT §5.3, §9 rule 5).
 */
export type Minor = bigint;

export const CURRENCY_EXPONENT: Record<string, number> = { SAR: 2, EGP: 2, AED: 2, KWD: 3, USD: 2 };

export class MoneyError extends Error {}

export function exponentOf(currency: string): number {
  const e = CURRENCY_EXPONENT[currency];
  if (e === undefined) throw new MoneyError(`Unsupported currency: ${currency}`);
  return e;
}

/** Parse a decimal string ("1000", "1000.5", "1000.50") into minor units. Rejects excess precision. */
export function parseMoney(value: string, currency = 'SAR'): Minor {
  const exp = exponentOf(currency);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new MoneyError(`Invalid amount: ${value}`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > exp) throw new MoneyError(`Too many decimal places for ${currency}: ${value}`);
  const minor = BigInt(whole) * 10n ** BigInt(exp) + BigInt(frac.padEnd(exp, '0') || '0');
  return sign ? -minor : minor;
}

export function formatMoney(amount: Minor, currency = 'SAR'): string {
  const exp = exponentOf(currency);
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(exp);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(exp, '0');
  return `${neg ? '-' : ''}${whole}${exp ? '.' + frac : ''} ${currency}`;
}

/**
 * Split `total` into `parts` integer shares that sum exactly to `total`.
 * The remainder goes to the earliest shares (deterministic, documented).
 */
export function allocateEvenly(total: Minor, parts: number): Minor[] {
  if (!Number.isInteger(parts) || parts <= 0) throw new MoneyError('parts must be a positive integer');
  if (total < 0n) throw new MoneyError('total must be non-negative');
  const n = BigInt(parts);
  const base = total / n;
  const rem = Number(total % n);
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1n : 0n));
}

/** amount * bps / 10000, rounded half-up. Basis points avoid floats for percentages. */
export function applyBps(amount: Minor, bps: number): Minor {
  if (!Number.isInteger(bps) || bps < 0) throw new MoneyError('bps must be a non-negative integer');
  return (amount * BigInt(bps) * 2n + 10000n) / 20000n;
}
