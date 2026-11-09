import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestOrder, isPermutation } from '../src/ordering.ts';
import { transferReference, transferGuide, matchDeclaration } from '../src/transfer.ts';

const dates = ['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'];

test('priority: need dates first (earliest first), then EARLY, NONE, LATE last', () => {
  const s = suggestOrder('c1', [
    { memberId: 'late', preference: 'LATE' },
    { memberId: 'none', preference: 'NONE' },
    { memberId: 'feb', preference: 'EARLY', neededBy: '2027-02-15' },
    { memberId: 'dec', preference: 'NONE', neededBy: '2026-12-20' },
  ], dates);
  assert.deepEqual(s.order.map((o) => o.memberId), ['dec', 'feb', 'none', 'late']);
  assert.equal(s.metNeeds, 2); assert.equal(s.declaredNeeds, 2); assert.deepEqual(s.unmet, []);
});

test('priority: unmet needs are reported, not hidden', () => {
  const s = suggestOrder('c1', [
    { memberId: 'a', preference: 'EARLY', neededBy: '2026-12-05' },
    { memberId: 'b', preference: 'EARLY', neededBy: '2026-12-10' },
    { memberId: 'c', preference: 'NONE' }, { memberId: 'd', preference: 'NONE' },
  ], dates);
  assert.deepEqual(s.order.slice(0, 2).map((o) => o.memberId), ['a', 'b']);
  assert.deepEqual(s.unmet, ['b']);
});

test('priority: ties do not depend on input (join) order, and it is deterministic', () => {
  const m = ['m1', 'm2', 'm3', 'm4'].map((id) => ({ memberId: id, preference: 'NONE' as const }));
  const a = suggestOrder('circle-x', m, dates).order.map((o) => o.memberId);
  const b = suggestOrder('circle-x', [...m].reverse(), dates).order.map((o) => o.memberId);
  assert.deepEqual(a, b);
  assert.throws(() => suggestOrder('c', m.slice(0, 3), dates));
  assert.ok(isPermutation(a, ['m4', 'm3', 'm2', 'm1']));
  assert.ok(!isPermutation(['m1', 'm1', 'm2', 'm3'], ['m1', 'm2', 'm3', 'm4']));
});

test('transfer: stable unambiguous reference, guides, matching', () => {
  const r = transferReference('7b0c3c1e-0000-4000-8000-000000000001');
  assert.match(r, /^JM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(r, transferReference('7b0c3c1e-0000-4000-8000-000000000001'));
  assert.notEqual(r, transferReference('7b0c3c1e-0000-4000-8000-000000000002'));
  assert.equal(transferGuide('VODAFONE_CASH', 500, 'EGP').action?.href, 'tel:*9*7%23');
  assert.ok(transferGuide('IBAN_SA', 5000, 'SAR').limitNote);
  assert.equal(transferGuide('IBAN_SA', 2000, 'SAR').limitNote, undefined);
  const m = matchDeclaration({ amountDue: '5000.00', declaredAmount: '5000', transferDate: '2026-11-09', earliest: '2026-10-01', today: '2026-11-10',
    methodKind: 'IBAN_SA', recipientKinds: ['IBAN_SA'], receiptUsedElsewhere: false, bankRefUsedElsewhere: false });
  assert.equal(m.score, 5);
  const bad = matchDeclaration({ amountDue: '5000.00', declaredAmount: '4500', transferDate: '2026-12-01', earliest: '2026-10-01', today: '2026-11-10',
    methodKind: 'STC_PAY', recipientKinds: ['IBAN_SA'], receiptUsedElsewhere: false, bankRefUsedElsewhere: true });
  assert.deepEqual(bad.checks.filter((c) => !c.ok).map((c) => c.check), ['AMOUNT', 'DATE', 'METHOD', 'BANK_REF_UNIQUE']);
});
