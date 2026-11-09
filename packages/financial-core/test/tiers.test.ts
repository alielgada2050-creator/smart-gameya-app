import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney } from '../src/money.ts';
import { classifyPot, limitsFromEnv } from '../src/tiers.ts';
import { ibanValid, normalizeMethodValue, methodsFor } from '../src/payout-methods.ts';

const SAR = (s: string) => parseMoney(s, 'SAR');

test('tiers: boundaries on the payout value', () => {
  const t = (s: string) => { const r = classifyPot(SAR(s), 'SAR'); return r.ok ? r.tier : r.reason; };
  assert.equal(t('5000'), 'SMALL');
  assert.equal(t('10000'), 'SMALL');
  assert.equal(t('10000.01'), 'MEDIUM');
  assert.equal(t('12000'), 'MEDIUM');      // 1,000 × 12
  assert.equal(t('50000'), 'MEDIUM');
  assert.equal(t('50000.01'), 'LARGE');
  assert.equal(t('100000'), 'LARGE');
  assert.equal(t('100000.01'), 'ABOVE_MAXIMUM');
  const large = classifyPot(SAR('60000'), 'SAR');
  assert.ok(large.ok && large.requiresPlatformApproval && large.requiresPromissoryNotes);
  const med = classifyPot(SAR('20000'), 'SAR');
  assert.ok(med.ok && !med.requiresPlatformApproval);
  assert.deepEqual(classifyPot(100n, 'EGP'), { ok: false, reason: 'CURRENCY_NOT_ENABLED' });
  const egp = limitsFromEnv('EGP', '50000,250000,500000');
  const r = classifyPot(parseMoney('300000', 'EGP'), 'EGP', egp);
  assert.ok(r.ok && r.tier === 'LARGE');
  assert.throws(() => limitsFromEnv('EGP', '5,4,3'));
});

test('IBAN mod-97 and per-country formats', () => {
  assert.ok(ibanValid('SA03 8000 0000 6080 1016 7519', 'SA'));     // published example IBAN format
  assert.ok(!ibanValid('SA04 8000 0000 6080 1016 7519', 'SA'));    // bad check digits
  assert.ok(!ibanValid('SA03800000006080101675', 'SA'));           // too short
  assert.ok(!ibanValid('SA0380000000608010167519', 'EG'));         // wrong country
  assert.ok(ibanValid('AE070331234567890123456', 'AE'));
  assert.ok(ibanValid('EG380019000500000000263180002', 'EG'));
  const ok = normalizeMethodValue('IBAN_SA', 'sa03 8000 0000 6080 1016 7519');
  assert.deepEqual(ok, { ok: true, value: 'SA0380000000608010167519', last4: '7519' });
});

test('wallets: STC Pay / Barq (SA), Vodafone Cash / InstaPay (EG)', () => {
  assert.deepEqual(normalizeMethodValue('STC_PAY', '٠٥٥١٢٣٤٥٦٧'), { ok: true, value: '+966551234567', last4: '4567' });
  assert.equal(normalizeMethodValue('BARQ', '0451234567').ok, false);
  assert.deepEqual(normalizeMethodValue('VODAFONE_CASH', '01012345678'), { ok: true, value: '+201012345678', last4: '5678' });
  assert.equal(normalizeMethodValue('VODAFONE_CASH', '01112345678').ok, false, 'Etisalat prefix is not Vodafone');
  assert.deepEqual(normalizeMethodValue('INSTAPAY', 'Ahmed.Ali@instapay'), { ok: true, value: 'ahmed.ali@instapay', last4: 'ahme' });
  assert.equal(normalizeMethodValue('INSTAPAY', '01112345678').ok, true);
  assert.equal(normalizeMethodValue('PAYPAL', 'x').ok, false);
  assert.deepEqual(methodsFor('SA').map((m) => m.kind), ['IBAN_SA', 'STC_PAY', 'BARQ', 'URPAY']);
});
