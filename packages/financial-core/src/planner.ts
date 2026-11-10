/**
 * Circle planner ("المخطط الذكي"): from a goal (amount, date it is needed by, how many relatives/friends will join, optional
 * budget) to ready circle plans. Deterministic and explainable; a language model may only rephrase the explanation.
 * No fees, no discounts: every member pays the same and receives the same pot, whatever their turn.
 */
import { addPeriods } from './schedule.ts';

export type PlanFrequency = 'WEEKLY' | 'MONTHLY';
export interface PlanInput {
  targetAmount: number;          // in currency units, e.g. 30000
  neededBy?: string | null;      // ISO date
  people?: number | null;        // members including the user
  monthlyBudget?: number | null; // what the user can pay per month
  frequency?: PlanFrequency;     // WEEKLY = "جمعية الجمعة"
  today: string;                 // ISO date (Riyadh)
  maxPot: number;                // largest pot allowed (e.g. 100000 SAR)
}
export interface Plan {
  members: number; frequency: PlanFrequency; contribution: number; pot: number; cycles: number; startDate: string; endDate: string;
  /** Latest turn whose payout still arrives by neededBy (null when no date was given). */
  latestTurnForGoal: number | null; latestTurnDate: string | null;
  monthlyEquivalent: number; fitsBudget: boolean | null; tier: 'SMALL' | 'MEDIUM' | 'LARGE';
}
export interface PlanResult { plans: Plan[]; reason?: 'TARGET_TOO_LARGE' | 'DATE_TOO_SOON' }

const roundUp = (v: number, step: number) => Math.ceil(v / step) * step;
const tierOf = (pot: number) => (pot <= 10000 ? 'SMALL' : pot <= 50000 ? 'MEDIUM' : 'LARGE') as Plan['tier'];

/** Next start: the coming 1st of the month for monthly circles, the coming Friday for weekly ones. */
export function nextStart(today: string, frequency: PlanFrequency) {
  const d = new Date(`${today}T12:00:00Z`);
  if (frequency === 'WEEKLY') { const add = ((5 - d.getUTCDay() + 7) % 7) || 7; d.setUTCDate(d.getUTCDate() + add); }
  else { d.setUTCMonth(d.getUTCMonth() + 1, 1); }
  return d.toISOString().slice(0, 10);
}

export function planCircle(input: PlanInput): PlanResult {
  const freq = input.frequency ?? 'MONTHLY';
  if (input.targetAmount > input.maxPot) return { plans: [], reason: 'TARGET_TOO_LARGE' };
  const counts = input.people ? [input.people] : freq === 'WEEKLY' ? [4, 6, 8, 10] : [4, 5, 6, 8, 10, 12];
  const start = nextStart(input.today, freq);
  const plans: Plan[] = [];
  for (const n of counts) {
    if (n < 2 || n > 60) continue;
    const step = input.targetAmount / n >= 1000 ? 100 : 50;
    const contribution = roundUp(input.targetAmount / n, step);          // pot >= goal
    const pot = contribution * n;
    if (pot > input.maxPot) continue;
    const dates = Array.from({ length: n }, (_, i) => addPeriods(start, freq, i));
    let latest: number | null = null;
    if (input.neededBy) { for (let i = n - 1; i >= 0; i--) if (dates[i] <= input.neededBy) { latest = i + 1; break; } }
    const monthly = freq === 'WEEKLY' ? Math.round((contribution * 52) / 12) : contribution;
    plans.push({
      members: n, frequency: freq, contribution, pot, cycles: n, startDate: start, endDate: dates[n - 1],
      latestTurnForGoal: input.neededBy ? latest : null, latestTurnDate: latest ? dates[latest - 1] : null,
      monthlyEquivalent: monthly, fitsBudget: input.monthlyBudget ? monthly <= input.monthlyBudget : null, tier: tierOf(pot),
    });
  }
  if (input.neededBy && plans.length && plans.every((p) => p.latestTurnForGoal === null)) return { plans: [], reason: 'DATE_TOO_SOON' };
  // usable for the date first, then within budget, then the smallest instalment
  const score = (p: Plan) => (input.neededBy && p.latestTurnForGoal === null ? 100 : 0) + (p.fitsBudget === false ? 10 : 0);
  plans.sort((a, b) => score(a) - score(b) || a.contribution - b.contribution);
  return { plans: plans.slice(0, 3) };
}
