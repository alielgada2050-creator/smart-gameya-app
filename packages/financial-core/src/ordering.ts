/**
 * Payout-order suggestion for "priority" circles (owner request 2026-11-10).
 *
 * Inputs are what each member declared: an early/late/no preference and, optionally, the date they need the money by.
 * The suggestion is deterministic and explainable, and it is only a proposal: it takes effect after every member approves.
 *
 * Fairness rules (deliberate):
 *  - Reasons (wedding, school fees, health…) are NOT ranked against each other. The algorithm orders by declared need
 *    date and preference only; reasons are context for the members' own discussion.
 *  - The organizer gets no automatic advantage.
 *  - Ties are broken by a hash of (circle id, member id), not by join order, so joining first buys nothing.
 */
import { createHash } from 'node:crypto';

export type Preference = 'EARLY' | 'LATE' | 'NONE';

export interface PriorityInput {
  memberId: string;
  preference: Preference;
  /** ISO date the member needs the payout by, if any. */
  neededBy?: string | null;
}

export interface SlotAssignment {
  position: number;            // 1-based payout position
  memberId: string;
  payoutDate: string;          // the cycle's due date
  preference: Preference;
  neededBy: string | null;
  /** null when no date was declared; otherwise whether payoutDate <= neededBy. */
  needMet: boolean | null;
}

export interface OrderSuggestion {
  algorithmVersion: 'sg-priority/1.0.0';
  order: SlotAssignment[];
  metNeeds: number;
  declaredNeeds: number;
  unmet: string[];             // member ids whose date could not be met
}

const tieKey = (circleId: string, memberId: string) => createHash('sha256').update(`${circleId}:${memberId}`).digest('hex');

/**
 * @param cycleDates due date of each cycle, in order (cycle 1 first). Length must equal the number of members.
 */
export function suggestOrder(circleId: string, members: PriorityInput[], cycleDates: string[]): OrderSuggestion {
  if (members.length !== cycleDates.length) throw new Error('one cycle per member is required');
  if (new Set(members.map((m) => m.memberId)).size !== members.length) throw new Error('duplicate member');
  const group = (m: PriorityInput) => (m.preference === 'EARLY' ? 0 : m.preference === 'NONE' ? 1 : 2);
  const sorted = [...members].sort((a, b) => {
    // A declared need date is the strongest signal regardless of the stated preference word, except LATE.
    const ga = a.neededBy && a.preference !== 'LATE' ? -1 : group(a);
    const gb = b.neededBy && b.preference !== 'LATE' ? -1 : group(b);
    if (ga !== gb) return ga - gb;
    if (ga === -1 && a.neededBy !== b.neededBy) return a.neededBy! < b.neededBy! ? -1 : 1;
    return tieKey(circleId, a.memberId) < tieKey(circleId, b.memberId) ? -1 : 1;
  });
  const order: SlotAssignment[] = sorted.map((m, i) => {
    const neededBy = m.neededBy ?? null;
    return {
      position: i + 1, memberId: m.memberId, payoutDate: cycleDates[i], preference: m.preference, neededBy,
      needMet: neededBy ? cycleDates[i] <= neededBy : null,
    };
  });
  const declared = order.filter((o) => o.needMet !== null);
  return {
    algorithmVersion: 'sg-priority/1.0.0', order,
    metNeeds: declared.filter((o) => o.needMet).length, declaredNeeds: declared.length,
    unmet: declared.filter((o) => !o.needMet).map((o) => o.memberId),
  };
}

/** A proposed order must be a permutation of exactly the circle's members. */
export function isPermutation(order: string[], memberIds: string[]): boolean {
  return order.length === memberIds.length && new Set(order).size === order.length && memberIds.every((id) => order.includes(id));
}
