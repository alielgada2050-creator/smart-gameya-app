import { type Minor, MoneyError } from './money.ts';

/** Schedule engine (MASTER PROMPT §5.2–5.3). All dates are calendar dates in UTC (YYYY-MM-DD). */
export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface CircleConfig {
  members: number;
  contribution: Minor; // per member, per cycle
  currency: string;
  frequency: Frequency;
  startDate: string; // first collection date, YYYY-MM-DD
  cycles?: number; // must equal members in a standard circle
}

export interface Cycle {
  index: number; // 1-based
  dueDate: string;
  payoutPosition: number; // which turn receives the pot this cycle (== index)
  expectedCollection: Minor; // contribution * members
}

export interface Schedule {
  cycles: Cycle[];
  potPerCycle: Minor;
  totalVolume: Minor;
  endDate: string;
}

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 60;

export function validateConfig(c: CircleConfig): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(c.members) || c.members < MIN_MEMBERS || c.members > MAX_MEMBERS)
    errors.push(`members must be an integer between ${MIN_MEMBERS} and ${MAX_MEMBERS}`);
  if (c.contribution <= 0n) errors.push('contribution must be positive');
  if (c.cycles !== undefined && c.cycles !== c.members)
    errors.push('cycles must equal members: each member receives the pot exactly once');
  if (!parseDate(c.startDate)) errors.push('startDate must be a valid YYYY-MM-DD date');
  return errors;
}

function parseDate(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

const iso = (dt: Date) => dt.toISOString().slice(0, 10);
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Add `k` periods. Monthly keeps the anchor day and clamps to month end (Jan 31 → Feb 28/29 → Mar 31). */
export function addPeriods(start: string, frequency: Frequency, k: number): string {
  const p = parseDate(start);
  if (!p) throw new MoneyError(`Invalid date ${start}`);
  if (frequency === 'MONTHLY') {
    const totalMonths = p.m - 1 + k;
    const y = p.y + Math.floor(totalMonths / 12);
    const m0 = ((totalMonths % 12) + 12) % 12;
    return iso(new Date(Date.UTC(y, m0, Math.min(p.d, daysInMonth(y, m0)))));
  }
  const step = frequency === 'WEEKLY' ? 7 : 14;
  return iso(new Date(Date.UTC(p.y, p.m - 1, p.d + step * k)));
}

export function generateSchedule(c: CircleConfig): Schedule {
  const errors = validateConfig(c);
  if (errors.length) throw new MoneyError(errors.join('; '));
  const pot = c.contribution * BigInt(c.members);
  const cycles: Cycle[] = Array.from({ length: c.members }, (_, i) => ({
    index: i + 1,
    dueDate: addPeriods(c.startDate, c.frequency, i),
    payoutPosition: i + 1,
    expectedCollection: pot,
  }));
  return { cycles, potPerCycle: pot, totalVolume: pot * BigInt(c.members), endDate: cycles[cycles.length - 1].dueDate };
}

export interface ProgressSnapshot {
  completedCycles: number;
  remainingCycles: number;
  collectedSoFar: Minor;
  remainingToCollect: Minor;
}

/** Progress as of a server-side date (never the client clock — §16). A cycle counts once its due date has passed. */
export function progressAsOf(s: Schedule, asOf: string): ProgressSnapshot {
  const completed = s.cycles.filter((c) => c.dueDate < asOf).length;
  const collected = s.potPerCycle * BigInt(completed);
  return {
    completedCycles: completed,
    remainingCycles: s.cycles.length - completed,
    collectedSoFar: collected,
    remainingToCollect: s.totalVolume - collected,
  };
}
