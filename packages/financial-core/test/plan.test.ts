import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCircle, nextStart } from '../src/planner.ts';
import { pledgeText, pledgeHash, pledgeClauses, signatureMatches, type PledgeTerms } from '../src/pledge.ts';

test('planner: pot covers the goal, latest usable turn, budget and ordering', () => {
  const r = planCircle({ targetAmount: 30000, neededBy: '2027-04-20', people: 6, monthlyBudget: 6000, today: '2026-11-10', maxPot: 100000 });
  const p = r.plans[0];
  assert.equal(p.members, 6); assert.equal(p.contribution, 5000); assert.equal(p.pot, 30000);
  assert.equal(p.startDate, '2026-12-01'); assert.equal(p.endDate, '2027-05-01');
  assert.equal(p.latestTurnForGoal, 5); assert.equal(p.latestTurnDate, '2027-04-01');
  assert.equal(p.fitsBudget, true); assert.equal(p.tier, 'MEDIUM');
  assert.ok(planCircle({ targetAmount: 7000, people: 3, today: '2026-11-10', maxPot: 100000 }).plans[0].pot >= 7000);
});

test('planner: weekly Friday circle starts on the coming Friday; impossible cases say why', () => {
  assert.equal(nextStart('2026-11-10', 'WEEKLY'), '2026-11-13');     // Tuesday → Friday
  assert.equal(nextStart('2026-11-13', 'WEEKLY'), '2026-11-20');     // a Friday → next Friday
  const w = planCircle({ targetAmount: 4000, frequency: 'WEEKLY', today: '2026-11-10', maxPot: 100000 });
  assert.ok(w.plans.length > 0 && w.plans.every((p) => p.startDate === '2026-11-13'));
  assert.equal(planCircle({ targetAmount: 200000, today: '2026-11-10', maxPot: 100000 }).reason, 'TARGET_TOO_LARGE');
  assert.equal(planCircle({ targetAmount: 10000, neededBy: '2026-11-15', today: '2026-11-10', maxPot: 100000 }).reason, 'DATE_TOO_SOON');
});

test('pledge: terms in the text, stable hash, typed-name signature', () => {
  const t: PledgeTerms = { circleName: 'جمعية العائلة', organizerName: 'سارة', memberName: 'خالد', currency: 'SAR', contribution: '1500.00', memberCount: 3, frequency: 'MONTHLY',
    installments: 2, startDate: '2026-12-01', endDate: '2027-02-01', potPerCycle: '4500.00', totalCommitment: '3000.00', termsVersion: 1 };
  const text = pledgeText(t);
  assert.ok(text.includes('1500.00 ريال') && text.includes('3000.00') && text.includes('خالد'));
  assert.equal(pledgeClauses(t).length, 4);
  assert.match(pledgeHash(t), /^[0-9a-f]{64}$/);
  assert.equal(pledgeHash(t), pledgeHash({ ...t }));
  assert.notEqual(pledgeHash(t), pledgeHash({ ...t, contribution: '1600.00' }), 'changing the amount changes what is signed');
  assert.ok(signatureMatches('  خالد ', 'خالد'));
  assert.ok(signatureMatches('فاطمة الزهراء', 'فاطمه  الزهراء'));
  assert.ok(signatureMatches('أحمد', 'احمد'));
  assert.ok(!signatureMatches('سارة', 'خالد'));
});
