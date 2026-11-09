import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatMoney, allocateEvenly, applyBps } from '../src/money.ts';
import { generateSchedule, addPeriods, progressAsOf, validateConfig } from '../src/schedule.ts';
import { computeFeePlan, type FeePolicy } from '../src/fees.ts';
import { prepareDraw, executeDraw, verifyDraw, selectionProbability, type Candidate } from '../src/lottery.ts';
import { Ledger } from '../src/ledger.ts';

const SAR = (s: string) => parseMoney(s, 'SAR');

test('money: parse/format without floating point', () => {
  assert.equal(SAR('1000'), 100000n);
  assert.equal(SAR('0.10') + SAR('0.20'), SAR('0.30')); // the classic float bug cannot happen
  assert.equal(formatMoney(SAR('12000.05')), '12000.05 SAR');
  assert.throws(() => SAR('1.005'));
  assert.equal(parseMoney('1.005', 'KWD'), 1005n);
});

test('money: allocation always sums exactly', () => {
  for (const [t, n] of [[100n, 3], [1n, 7], [120000n, 12], [99999n, 11]] as const) {
    const parts = allocateEvenly(t, n);
    assert.equal(parts.reduce((a, b) => a + b, 0n), t);
    assert.ok(parts[0] - parts[n - 1] <= 1n);
  }
  assert.equal(applyBps(SAR('12000'), 1000), SAR('1200')); // 10%
  assert.equal(applyBps(5n, 1000), 1n); // 0.5 → rounds half up
});

test('Scenario 01: 12 members × 1,000 SAR monthly × 12 months', () => {
  const s = generateSchedule({ members: 12, contribution: SAR('1000'), currency: 'SAR', frequency: 'MONTHLY', startDate: '2027-01-01', cycles: 12 });
  assert.equal(s.cycles.length, 12);
  assert.equal(s.potPerCycle, SAR('12000'));
  assert.equal(s.totalVolume, SAR('144000'));
  assert.equal(s.cycles[0].dueDate, '2027-01-01');
  assert.equal(s.endDate, '2027-12-01');
  assert.deepEqual(s.cycles.map((c) => c.payoutPosition), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const p = progressAsOf(s, '2027-04-15');
  assert.equal(p.completedCycles, 4);
  assert.equal(p.remainingToCollect, SAR('96000'));
});

test('schedule: rejects cycles ≠ members and bad dates', () => {
  assert.ok(validateConfig({ members: 12, contribution: SAR('1000'), currency: 'SAR', frequency: 'MONTHLY', startDate: '2027-01-01', cycles: 10 }).length);
  assert.ok(validateConfig({ members: 12, contribution: SAR('1000'), currency: 'SAR', frequency: 'MONTHLY', startDate: '2027-02-30' }).length);
  assert.ok(validateConfig({ members: 1, contribution: SAR('1000'), currency: 'SAR', frequency: 'MONTHLY', startDate: '2027-01-01' }).length);
});

test('schedule: month-end clamping and weekly cadence', () => {
  assert.equal(addPeriods('2027-01-31', 'MONTHLY', 1), '2027-02-28');
  assert.equal(addPeriods('2028-01-31', 'MONTHLY', 1), '2028-02-29');
  assert.equal(addPeriods('2027-01-31', 'MONTHLY', 2), '2027-03-31'); // anchor day preserved
  assert.equal(addPeriods('2027-12-15', 'MONTHLY', 1), '2028-01-15');
  assert.equal(addPeriods('2027-01-01', 'WEEKLY', 3), '2027-01-22');
  assert.equal(addPeriods('2027-01-01', 'BIWEEKLY', 2), '2027-01-29');
});

const policy: FeePolicy = {
  version: 'demo-policy-v1',
  maxFeeBps: 1000,
  feeBps:      [1000, 800, 600, 400, 200, 0, 0, 0, 0, 0, 0, 0],
  discountBps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2500, 5000, 10000],
};

test('fees: early position fee is spread over installments up to payout', () => {
  const plan = computeFeePlan(SAR('1000'), 12, 3, policy); // 6% of 12,000 = 720
  assert.equal(plan.totalFee, SAR('720'));
  assert.deepEqual(plan.feePerInstallment, [SAR('240'), SAR('240'), SAR('240')]);
  assert.equal(plan.installments[0], SAR('1240'));
  assert.equal(plan.installments[3], SAR('1000'));
  assert.equal(plan.installments.reduce((a, b) => a + b, 0n), SAR('12720'));
});

test('fees: late position discount, cap enforcement', () => {
  const last = computeFeePlan(SAR('1000'), 12, 12, policy);
  assert.equal(last.totalFee, 0n);
  assert.equal(last.installments[11], 0n);
  assert.throws(() => computeFeePlan(SAR('1000'), 12, 1, { ...policy, feeBps: [1600, ...policy.feeBps.slice(1)] }));
});

const members = (n: number): Candidate[] => Array.from({ length: n }, (_, i) => ({ memberId: `m${String(i + 1).padStart(2, '0')}`, eligible: true }));

test('Scenario 03: lottery is a permutation, verifiable, and tamper-evident', () => {
  const prep = prepareDraw('circle-1', members(12));
  assert.equal(prep.commitment.length, 64);
  const rec = executeDraw(prep, { publicEntropy: 'announced-at-draw-time:7f3a', executedBy: 'admin-a', approvedBy: 'admin-b' });
  assert.equal(rec.order.length, 12);
  assert.equal(new Set(rec.order.map((o) => o.memberId)).size, 12);
  assert.deepEqual(rec.order.map((o) => o.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(verifyDraw(rec), { valid: true });

  const swapped = structuredClone(rec);
  [swapped.order[0].memberId, swapped.order[1].memberId] = [swapped.order[1].memberId, swapped.order[0].memberId];
  assert.equal(verifyDraw(swapped).valid, false);
  assert.equal(verifyDraw({ ...rec, revealedSeedHex: 'ab'.repeat(32) }).valid, false);
  assert.equal(verifyDraw({ ...rec, publicEntropy: 'other' }).valid, false);
});

test('lottery: maker–checker, exclusions and mixed (fixed + drawn) mode', () => {
  const prep = prepareDraw('circle-2', [
    ...members(5),
    { memberId: 'm99', eligible: false },
    { memberId: 'm50', eligible: true, fixedPosition: 1 },
  ]);
  assert.throws(() => executeDraw(prep, { publicEntropy: 'x', executedBy: 'same', approvedBy: 'same' }));
  const rec = executeDraw(prep, { publicEntropy: 'x', executedBy: 'a', approvedBy: 'b' });
  assert.equal(rec.order.length, 6);
  assert.deepEqual(rec.order[0], { position: 1, memberId: 'm50', source: 'FIXED' });
  assert.ok(!rec.order.some((o) => o.memberId === 'm99'));
  assert.ok(verifyDraw(rec).valid);
  assert.equal(selectionProbability(prep.candidates)[0].perSlot, '1/5');
  assert.throws(() => prepareDraw('c', [...members(3), { memberId: 'x', eligible: true, fixedPosition: 9 }]));
  assert.throws(() => prepareDraw('c', [{ memberId: 'a', eligible: true }, { memberId: 'a', eligible: true }]));
});

test('lottery: no positional bias (statistical sanity, 6 members × 12,000 draws)', () => {
  const n = 6, runs = 12000;
  const counts = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let r = 0; r < runs; r++) {
    const rec = executeDraw(prepareDraw('bias', members(n)), { publicEntropy: String(r), executedBy: 'a', approvedBy: 'b' });
    rec.order.forEach((o) => counts[Number(o.memberId.slice(1)) - 1][o.position - 1]++);
  }
  const expected = runs / n; // 2000
  let chi = 0;
  for (const row of counts) for (const c of row) chi += (c - expected) ** 2 / expected;
  // 25 degrees of freedom; p=0.001 critical value ≈ 52.6
  assert.ok(chi < 52.6, `chi-square too high: ${chi.toFixed(1)}`);
});

test('ledger: balanced, idempotent, append-only with reversal and hash chain', () => {
  const L = new Ledger();
  const pay = { idempotencyKey: 'pay-m01-c1', currency: 'SAR', memo: 'installment m01 cycle 1', entries: [
    { account: 'psp_clearing', debit: SAR('1000'), credit: 0n },
    { account: 'member:m01:receivable', debit: 0n, credit: SAR('1000') },
  ] };
  const t1 = L.post(pay);
  assert.equal(L.post(pay), t1); // Scenario 04: duplicate webhook does not double-post
  assert.equal(L.transactions.length, 1);
  assert.throws(() => L.post({ ...pay, idempotencyKey: 'bad', entries: [pay.entries[0], { ...pay.entries[1], credit: SAR('999') }] }));
  assert.throws(() => { (t1 as any).memo = 'edited'; }); // frozen
  L.reverse(t1.id, 'rev-1', 'refund');
  assert.throws(() => L.reverse(t1.id, 'rev-2', 'again'));
  assert.equal(L.balance('psp_clearing', 'SAR'), 0n);
  assert.ok(L.verify());
});
