import { type Minor, MoneyError, applyBps } from './money.ts';

/**
 * Deterministic savings facts (MASTER PROMPT §7-A). Every number shown to the user comes from here;
 * the language model may only explain these facts, never compute or invent figures.
 * Inputs are what the user chooses to share for this request; they are not persisted.
 */
export const SAVINGS_POLICY = {
  version: 'savings-rules/1.0.0',
  /** Share of disposable income considered comfortable for circle contributions (30%). Conservative heuristic, not financial advice. */
  comfortableShareBps: 3000,
  /** Circle sizes offered as scenarios. */
  circleSizes: [5, 6, 10, 12] as const,
  /** Contributions are rounded up to this step (50 SAR) so circles use friendly amounts. */
  roundingStep: 5000n,
};

export interface SavingsInput {
  monthlyIncome: Minor;
  monthlyExpenses: Minor;
  goalAmount: Minor;
  targetMonths?: number;
  existingMonthlyCommitments: Minor; // from the user's active circles (server-computed)
}

export interface Scenario {
  members: number;
  months: number;
  monthlyContribution: Minor;
  payout: Minor;
  affordable: boolean;
  fitsTarget: boolean;
}

export interface SavingsFacts {
  policyVersion: string;
  disposableIncome: Minor;
  comfortableMonthlyCapacity: Minor;
  existingMonthlyCommitments: Minor;
  remainingCapacity: Minor;
  scenarios: Scenario[];
  recommended: Scenario | null;
  status: 'RECOMMENDED' | 'STRETCH' | 'NOT_ADVISED';
}

const roundUp = (v: Minor, step: Minor) => ((v + step - 1n) / step) * step;
const ceilDiv = (a: Minor, b: Minor) => (a + b - 1n) / b;

export function savingsFacts(i: SavingsInput): SavingsFacts {
  for (const [k, v] of Object.entries({ monthlyIncome: i.monthlyIncome, monthlyExpenses: i.monthlyExpenses, goalAmount: i.goalAmount, existing: i.existingMonthlyCommitments }))
    if (v < 0n) throw new MoneyError(`${k} must be non-negative`);
  if (i.goalAmount === 0n) throw new MoneyError('goalAmount must be positive');
  if (i.targetMonths !== undefined && (!Number.isInteger(i.targetMonths) || i.targetMonths < 1 || i.targetMonths > 60)) throw new MoneyError('targetMonths must be 1..60');

  const disposable = i.monthlyIncome - i.monthlyExpenses;
  const comfortable = disposable > 0n ? applyBps(disposable, SAVINGS_POLICY.comfortableShareBps) : 0n;
  const remaining = comfortable > i.existingMonthlyCommitments ? comfortable - i.existingMonthlyCommitments : 0n;

  const scenarios: Scenario[] = SAVINGS_POLICY.circleSizes.map((n) => {
    const contribution = roundUp(ceilDiv(i.goalAmount, BigInt(n)), SAVINGS_POLICY.roundingStep);
    return {
      members: n, months: n, monthlyContribution: contribution, payout: contribution * BigInt(n),
      affordable: contribution <= remaining,
      fitsTarget: i.targetMonths === undefined || n <= i.targetMonths,
    };
  });

  const ideal = scenarios.filter((s) => s.affordable && s.fitsTarget).sort((a, b) => b.members - a.members)[0];
  const affordableOnly = scenarios.filter((s) => s.affordable).sort((a, b) => a.members - b.members)[0];
  let recommended: Scenario | null = ideal ?? affordableOnly ?? null;
  let status: SavingsFacts['status'] = ideal ? 'RECOMMENDED' : affordableOnly ? 'STRETCH' : 'NOT_ADVISED';
  // Prefer the lowest monthly burden that still meets the target: the largest circle within the target.
  if (disposable <= 0n) { recommended = null; status = 'NOT_ADVISED'; }

  return {
    policyVersion: SAVINGS_POLICY.version,
    disposableIncome: disposable,
    comfortableMonthlyCapacity: comfortable,
    existingMonthlyCommitments: i.existingMonthlyCommitments,
    remainingCapacity: remaining,
    scenarios,
    recommended,
    status,
  };
}

/** Normalize a circle contribution to a monthly-equivalent amount (floor). */
export function monthlyEquivalent(contribution: Minor, frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'): Minor {
  if (frequency === 'MONTHLY') return contribution;
  return (contribution * (frequency === 'WEEKLY' ? 52n : 26n)) / 12n;
}
