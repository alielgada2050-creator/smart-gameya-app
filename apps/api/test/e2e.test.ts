import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main.ts';

/**
 * End-to-end scenarios against a real PostgreSQL (run via scripts/test-api.sh, which recreates the DB).
 * Each simulated person uses a distinct client IP so per-IP rate limits behave like production.
 */
let app: INestApplication;
let http: any;
let db: pg.Client;
let ipSeq = 10;

const config = {
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: randomBytes(32).toString('hex'),
  otpPepper: 'test-pepper',
  lotterySeedKey: randomBytes(32),
  exposeOtpInResponse: true,
  isProduction: false,
};

interface Person { name: string; phone: string; ip: string; token: string; id: string }
const api = (p: Person | null, method: 'get' | 'post', url: string, body?: object) => {
  let r = http[method](url).set('X-Forwarded-For', p?.ip ?? '10.0.0.250');
  if (p) r = r.set('Authorization', `Bearer ${p.token}`);
  return body ? r.send(body) : r;
};

async function login(name: string, phone: string): Promise<Person> {
  const ip = `10.0.0.${ipSeq++}`;
  const req = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone });
  assert.equal(req.status, 202, JSON.stringify(req.body));
  const ver = await http.post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code: req.body.devCode, fullName: name });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return { name, phone, ip, token: ver.body.accessToken, id: ver.body.user.id };
}

before(async () => {
  app = await createApp(config);
  await app.init();
  http = request(app.getHttpServer());
  db = new pg.Client({ connectionString: config.databaseUrl });
  await db.connect();
});
after(async () => { await db.end(); await app.close(); });

describe('auth', () => {
  test('rejects missing/invalid tokens with the standard error envelope', async () => {
    const r = await api(null, 'get', '/api/v1/gamiyas');
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'UNAUTHENTICATED');
    assert.ok(r.body.error.correlationId);
    assert.equal(r.headers['x-correlation-id'], r.body.error.correlationId);
    const bad = await http.get('/api/v1/gamiyas').set('Authorization', 'Bearer abc.def.ghi');
    assert.equal(bad.status, 401);
  });

  test('OTP: wrong code rejected, per-phone request limit enforced, non-Saudi number rejected', async () => {
    const phone = '+966500000099';
    const ip = '10.0.1.1';
    const first = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone });
    const wrong = first.body.devCode === '000000' ? '111111' : '000000';
    const v = await http.post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code: wrong });
    assert.equal(v.status, 401);
    assert.equal(v.body.error.code, 'OTP_INVALID');
    const { rows } = await db.query('SELECT attempts FROM otp_challenges WHERE phone_e164=$1 ORDER BY created_at DESC LIMIT 1', [phone]);
    assert.equal(rows[0].attempts, 1, 'failed attempt is counted even though the request failed');
    let last: any;
    for (let i = 0; i < 5; i++) last = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', `10.0.2.${i}`).send({ phone });
    assert.equal(last.status, 429);
    const intl = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone: '+201000000000' });
    assert.equal(intl.status, 400);
    assert.equal(intl.body.error.code, 'VALIDATION_FAILED');
    const stored = await db.query('SELECT code_hash FROM otp_challenges WHERE phone_e164=$1', [phone]);
    assert.ok(stored.rows.every((r) => r.code_hash.length === 64), 'only hashes are stored');
  });
});

describe('full circle lifecycle (model A)', () => {
  let A: Person, B: Person, C: Person, D: Person, X: Person;
  let agreementId: string;
  let circleId: string;
  let inviteCode: string;

  test('setup: five people sign in', async () => {
    A = await login('مدير الجمعية', '+966500000001');
    B = await login('عضو ب', '+966500000002');
    C = await login('عضو ج', '+966500000003');
    D = await login('عضو د', '+966500000004');
    X = await login('شخص خارجي', '+966500000005');
    const ag = await api(A, 'get', '/api/v1/agreements/current');
    assert.equal(ag.status, 200);
    assert.equal(ag.body.body_sha256, createHash('sha256').update(ag.body.body).digest('hex'));
    agreementId = ag.body.id;
  });

  test('Scenario 01 via API: 12 × 1,000 SAR monthly → pot 12,000, 12 cycles, ends after 11 months', async () => {
    const r = await api(A, 'post', '/api/v1/gamiyas', { name: 'جمعية الاثني عشر', frequency: 'MONTHLY', contribution: '1000', memberCount: 12, startDate: '2027-01-01', agreementVersionId: agreementId });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.potPerCycle, '12000.00');
    assert.equal(r.body.endDate, '2027-12-01');
    assert.equal(r.body.status, 'RECRUITING');
    assert.equal(r.body.myRole, 'MANAGER');
  });

  test('validation: excess precision, too many members, missing agreement', async () => {
    const base = { name: 'x جمعية', frequency: 'MONTHLY', memberCount: 4, startDate: '2027-01-01', agreementVersionId: agreementId };
    assert.equal((await api(A, 'post', '/api/v1/gamiyas', { ...base, contribution: '10.005' })).status, 400);
    assert.equal((await api(A, 'post', '/api/v1/gamiyas', { ...base, contribution: '100', memberCount: 61 })).status, 400);
    const noAg = await api(A, 'post', '/api/v1/gamiyas', { ...base, contribution: '100', agreementVersionId: '00000000-0000-0000-0000-000000000000' });
    assert.equal(noAg.status, 400);
    assert.equal(noAg.body.error.code, 'AGREEMENT_REQUIRED');
  });

  test('Scenario 02: create a 4-member circle (started in the past), invite, join with agreement, auto-lock when full', async () => {
    const r = await api(A, 'post', '/api/v1/gamiyas', { name: 'جمعية الأصدقاء', frequency: 'MONTHLY', contribution: '1000', memberCount: 4, startDate: '2026-08-01', graceDays: 3, agreementVersionId: agreementId });
    assert.equal(r.status, 201);
    circleId = r.body.id;

    assert.equal((await api(B, 'post', `/api/v1/gamiyas/${circleId}/invitations`, {})).status, 404, 'non-member cannot invite');
    const inv = await api(A, 'post', `/api/v1/gamiyas/${circleId}/invitations`, { maxUses: 3 });
    assert.equal(inv.status, 201);
    inviteCode = inv.body.code;

    const noAgreement = await api(B, 'post', `/api/v1/invitations/${inviteCode}/accept`, {});
    assert.equal(noAgreement.status, 400);
    for (const p of [B, C]) assert.equal((await api(p, 'post', `/api/v1/invitations/${inviteCode}/accept`, { agreementVersionId: agreementId })).status, 200);
    const again = await api(B, 'post', `/api/v1/invitations/${inviteCode}/accept`, { agreementVersionId: agreementId });
    assert.equal(again.body.error.code, 'ALREADY_MEMBER');
    const last = await api(D, 'post', `/api/v1/invitations/${inviteCode}/accept`, { agreementVersionId: agreementId });
    assert.equal(last.status, 200);
    assert.equal(last.body.status, 'LOCKED');
    assert.equal(last.body.members.length, 4);
    assert.ok(!JSON.stringify(last.body).includes('+9665'), 'phone numbers are never exposed to other members');

    const late = await api(X, 'post', `/api/v1/invitations/${inviteCode}/accept`, { agreementVersionId: agreementId });
    assert.equal(late.status, 404, 'exhausted invitation');
    const acc = await db.query('SELECT count(*)::int AS n FROM agreement_acceptances WHERE gamiya_id=$1', [circleId]);
    assert.equal(acc.rows[0].n, 4);
  });

  test('Scenario 08: an outsider cannot see or touch the circle', async () => {
    for (const url of [`/api/v1/gamiyas/${circleId}`, `/api/v1/gamiyas/${circleId}/schedule`, `/api/v1/gamiyas/${circleId}/lottery`]) {
      const r = await api(X, 'get', url);
      assert.equal(r.status, 404, url);
    }
    assert.equal((await api(X, 'post', `/api/v1/gamiyas/${circleId}/lottery/trial`)).status, 404);
    assert.equal((await api(X, 'get', '/api/v1/gamiyas')).body.length, 0);
    assert.equal((await api(X, 'get', '/api/v1/gamiyas/not-a-uuid')).status, 404);
  });

  test('Scenario 03: trial draw, then commit–reveal official draw with maker–checker', async () => {
    const trial = await api(C, 'post', `/api/v1/gamiyas/${circleId}/lottery/trial`);
    assert.equal(trial.status, 200);
    assert.equal(trial.body.isTrial, true);
    assert.equal(trial.body.verification.valid, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM lottery_sessions')).rows[0].n, 0, 'trial is not persisted');

    assert.equal((await api(B, 'post', `/api/v1/gamiyas/${circleId}/lottery/prepare`)).status, 403, 'only the manager prepares');
    const prep = await api(A, 'post', `/api/v1/gamiyas/${circleId}/lottery/prepare`);
    assert.equal(prep.status, 201);
    const commitment = prep.body.commitment;
    assert.match(commitment, /^[0-9a-f]{64}$/);
    assert.equal(prep.body.probabilities[0].perSlot, '1/4');
    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${circleId}/lottery/prepare`)).body.error.code, 'LOTTERY_EXISTS');

    const sealed = (await db.query('SELECT seed_ciphertext FROM lottery_sessions')).rows[0].seed_ciphertext;
    assert.ok(!/^[0-9a-f]{64}$/.test(sealed), 'seed is stored encrypted before the reveal');
    const before = await api(B, 'get', `/api/v1/gamiyas/${circleId}/lottery`);
    assert.equal(before.body.state, 'PREPARED');
    assert.ok(!JSON.stringify(before.body).includes('Seed'), 'seed not revealed before execution');

    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${circleId}/lottery/approve`)).status, 403, 'preparer cannot approve');
    const early = await api(A, 'post', `/api/v1/gamiyas/${circleId}/lottery/execute`, { publicEntropy: 'announced-2026-11-09' });
    assert.equal(early.body.error.code, 'APPROVAL_REQUIRED');
    assert.equal((await api(B, 'post', `/api/v1/gamiyas/${circleId}/lottery/approve`)).status, 200);
    assert.equal((await api(B, 'post', `/api/v1/gamiyas/${circleId}/lottery/execute`, { publicEntropy: 'announced-2026-11-09' })).status, 403);

    const exec = await api(A, 'post', `/api/v1/gamiyas/${circleId}/lottery/execute`, { publicEntropy: 'announced-2026-11-09' });
    assert.equal(exec.status, 200, JSON.stringify(exec.body));
    assert.equal(exec.body.verification.valid, true);
    assert.equal(exec.body.record.commitment, commitment, 'commitment unchanged between announcement and reveal');
    assert.deepEqual(exec.body.record.order.map((o: any) => o.position), [1, 2, 3, 4]);

    // Any member can independently verify the commitment
    const seen = await api(D, 'get', `/api/v1/gamiyas/${circleId}/lottery`);
    assert.equal(seen.body.state, 'EXECUTED');
    assert.equal(createHash('sha256').update(Buffer.from(seen.body.record.revealedSeedHex, 'hex')).digest('hex'), commitment);
    assert.equal(seen.body.verification.valid, true);
    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${circleId}/lottery/execute`, { publicEntropy: 'again-again' })).body.error.code, 'LOTTERY_DONE');

    const details = await api(A, 'get', `/api/v1/gamiyas/${circleId}`);
    assert.equal(details.body.status, 'ACTIVE');
    assert.deepEqual(details.body.members.map((m: any) => m.payoutPosition), [1, 2, 3, 4]);
  });

  test('schedule: 4 cycles × 3 payers; recipient never owes themselves', async () => {
    const s = await api(B, 'get', `/api/v1/gamiyas/${circleId}/schedule`);
    assert.equal(s.status, 200);
    assert.deepEqual(s.body.map((c: any) => c.dueDate), ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
    for (const c of s.body) {
      assert.equal(c.total, 3);
      assert.ok(!c.installments.some((i: any) => i.payer === c.recipient));
      assert.ok(c.installments.every((i: any) => i.amount === '1000.00'));
    }
  });

  test('Scenario 05: overdue past the grace period shows as LATE, computed on the server', async () => {
    const o = await api(B, 'get', '/api/v1/me/obligations');
    assert.equal(o.status, 200);
    assert.ok(o.body.late.length >= 2);
    assert.ok(o.body.toPay.every((i: any) => i.direction === 'I_PAY'));
  });

  test('Scenarios 06–07: declare → recipient confirms → circle completes; wrong parties rejected; dispute flow', async () => {
    const people = [A, B, C, D];
    const byName = new Map(people.map((p) => [p.name, p]));
    const sched = (await api(A, 'get', `/api/v1/gamiyas/${circleId}/schedule`)).body;
    let disputedOnce = false;
    let lastResult: any;
    for (const cycle of sched) {
      const recipient = byName.get(cycle.recipient)!;
      for (const inst of cycle.installments) {
        const payer = byName.get(inst.payer)!;
        const url = `/api/v1/installments/${inst.installmentId}`;
        assert.equal((await api(X, 'post', `${url}/declare-paid`, {})).status, 404, 'outsider');
        assert.equal((await api(recipient, 'post', `${url}/confirm-received`)).body.error.code, 'NOT_DECLARED');
        assert.equal((await api(recipient, 'post', `${url}/declare-paid`, {})).status, 403, 'recipient cannot declare for the payer');
        const d = await api(payer, 'post', `${url}/declare-paid`, { reference: 'تحويل 1234' });
        assert.equal(d.status, 200, JSON.stringify(d.body));
        assert.equal(d.body.status, 'AWAITING_CONFIRMATION');
        assert.equal((await api(payer, 'post', `${url}/declare-paid`, {})).body.error.code, 'ALREADY_DECLARED');
        assert.equal((await api(payer, 'post', `${url}/confirm-received`)).status, 403, 'payer cannot confirm their own payment');
        if (!disputedOnce) {
          const dis = await api(recipient, 'post', `${url}/dispute`);
          assert.equal(dis.body.status, 'DISPUTED');
          disputedOnce = true;
        }
        lastResult = await api(recipient, 'post', `${url}/confirm-received`);
        assert.equal(lastResult.status, 200);
        assert.equal(lastResult.body.status, 'PAID');
        assert.equal((await api(recipient, 'post', `${url}/confirm-received`)).body.error.code, 'ALREADY_CONFIRMED');
      }
    }
    assert.equal(lastResult.body.circleCompleted, true);
    assert.equal((await api(A, 'get', `/api/v1/gamiyas/${circleId}`)).body.status, 'COMPLETED');
    const o = await api(B, 'get', '/api/v1/me/obligations');
    assert.equal(o.body.late.filter((i: any) => i.gamiyaId === circleId).length, 0);
  });

  test('integrity: confirmed settlements and audit logs are immutable in the database', async () => {
    await assert.rejects(db.query(`UPDATE installment_settlements SET payer_reference='x'`), /immutable/);
    await assert.rejects(db.query(`DELETE FROM audit_logs`), /append-only/);
    const actions = (await db.query(`SELECT DISTINCT action FROM audit_logs`)).rows.map((r) => r.action);
    for (const a of ['USER_REGISTERED', 'GAMIYA_CREATED', 'MEMBER_JOINED', 'GAMIYA_LOCKED', 'LOTTERY_PREPARED', 'LOTTERY_APPROVED', 'LOTTERY_EXECUTED', 'PAYMENT_DECLARED', 'PAYMENT_DISPUTED', 'PAYMENT_CONFIRMED', 'GAMIYA_COMPLETED'])
      assert.ok(actions.includes(a), `audit has ${a}`);
    const otpRows = (await db.query(`SELECT entity_id, details FROM audit_logs WHERE action='OTP_REQUESTED'`)).rows;
    assert.ok(otpRows.length > 0);
    assert.ok(otpRows.every((r) => r.details === null && /^\+9665\d\*{4}$/.test(r.entity_id)), 'OTP audit rows hold no code and a masked phone');
  });
});
