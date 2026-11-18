import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main.ts';
import { ProviderChain } from '../../../packages/ai-core/src/providers.ts';
import { testConfigExtras, uploadFile, PNG, withPledge } from './helpers.ts';

/** Owner request 2026-11-18: rename yourself, and replace one member with another (before or after the start). */
let app: INestApplication, http: any, db: pg.Client;
let ipSeq = 10;
const config: any = {
  databaseUrl: process.env.DATABASE_URL!, jwtSecret: randomBytes(32).toString('hex'), otpPepper: 'p', lotterySeedKey: randomBytes(32),
  exposeOtpInResponse: true, isProduction: false, ai: { chain: new ProviderChain([]), skipped: [] }, ...testConfigExtras(),
};
interface Person { name: string; ip: string; token: string; id: string }
const rawApi = (p: Person | null, method: 'get' | 'post', url: string, body?: object) => {
  let r = http[method](url).set('X-Forwarded-For', p?.ip ?? '10.9.9.250');
  if (p) r = r.set('Authorization', `Bearer ${p.token}`);
  return body ? r.send(body) : r;
};
const api = withPledge(rawApi as any) as typeof rawApi;
async function login(name: string, phone: string): Promise<Person> {
  const ip = `10.9.0.${ipSeq++}`;
  const req = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone });
  const ver = await http.post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code: req.body.devCode, fullName: name });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return { name, ip, token: ver.body.accessToken, id: ver.body.user.id };
}
const ag = async (p: Person) => (await api(p, 'get', '/api/v1/agreements/current')).body.id;
async function circle(o: Person, members: Person[], body: object) {
  const r = await api(o, 'post', '/api/v1/gamiyas', { frequency: 'MONTHLY', country: 'SA', agreementVersionId: await ag(o), ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const code = (await api(o, 'post', `/api/v1/gamiyas/${r.body.id}/invitations`, { maxUses: members.length })).body.code;
  for (const m of members) assert.equal((await api(m, 'post', `/api/v1/invitations/${code}/accept`, { agreementVersionId: await ag(m) })).status, 200);
  return r.body.id as string;
}
async function draw(o: Person, approver: Person, gid: string) {
  assert.equal((await api(o, 'post', `/api/v1/gamiyas/${gid}/lottery/prepare`)).status, 201);
  await api(approver, 'post', `/api/v1/gamiyas/${gid}/lottery/approve`);
  assert.equal((await api(o, 'post', `/api/v1/gamiyas/${gid}/lottery/execute`, { publicEntropy: 'substitute-test' })).status, 200);
}
const memberOf = async (p: Person, gid: string, name: string) => (await api(p, 'get', `/api/v1/gamiyas/${gid}`)).body.members.find((m: any) => m.fullName === name);

before(async () => {
  app = await createApp(config); await app.init(); http = request(app.getHttpServer());
  db = new pg.Client({ connectionString: config.databaseUrl }); await db.connect();
});
after(async () => { await db.end(); await app.close(); });

describe('names and replacing members', () => {
  let O: Person, A: Person, B: Person, D: Person, E: Person;
  before(async () => {
    O = await login('أم فهد', '+966500000801'); A = await login('عبدالله', '+966500000802'); B = await login('بدرية', '+966500000803');
    D = await login('دانة', '+966500000804'); E = await login('عيسى', '+966500000805');
  });

  test('a member edits their own name; pledges keep the name typed when signing', async () => {
    assert.equal((await api(D, 'post', '/api/v1/auth/me/name', { fullName: 'x' })).status, 400);
    assert.equal((await api(D, 'post', '/api/v1/auth/me/name', { fullName: '<b>' })).status, 400);
    const r = await api(D, 'post', '/api/v1/auth/me/name', { fullName: '  دانة   العتيبي ' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.fullName, 'دانة العتيبي');
    assert.equal((await api(D, 'get', '/api/v1/auth/me')).body.fullName, 'دانة العتيبي');
    D.name = 'دانة العتيبي';
  });

  test('after the start: the member asks, the organizer approves, the newcomer signs for the unpaid installments and takes the turn', async () => {
    const gid = await circle(O, [A, B], { name: 'جمعية البيت', contribution: '500', memberCount: 3, startDate: '2027-03-01' });
    await draw(O, B, gid);
    const a = await memberOf(O, gid, A.name);
    // A pays one installment to the organizer's cycle before leaving: that payment stays on A's record.
    const sched = (await api(A, 'get', `/api/v1/gamiyas/${gid}/schedule`)).body;
    const toOrg = sched.find((cy: any) => cy.recipient === O.name)?.installments.find((i: any) => i.payer === A.name);
    if (toOrg) {
      const f = await uploadFile(http, A, gid, 'RECEIPT', PNG);
      await api(A, 'post', `/api/v1/installments/${toOrg.installmentId}/declare-paid`, { methodKind: 'IBAN_SA', receiptFileId: f.fileId });
      assert.equal((await api(O, 'post', `/api/v1/installments/${toOrg.installmentId}/confirm-received`)).body.status, 'PAID');
    }
    const aOwes = sched.flatMap((cy: any) => cy.installments).filter((i: any) => i.payer === A.name).length;

    assert.equal((await api(B, 'post', `/api/v1/gamiyas/${gid}/members/${a.memberId}/replace`, { reason: 'ليس له' })).status, 403, 'only the member or the organizer');
    const om = await memberOf(O, gid, O.name);
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/members/${om.memberId}/replace`, { reason: 'سبب ما' })).body.error?.code, 'CANNOT_REPLACE_ORGANIZER');
    const started = await api(A, 'post', `/api/v1/gamiyas/${gid}/members/${a.memberId}/replace`, { reason: 'سفر طويل' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.deepEqual([started.body[0].outgoingConsent, started.body[0].organizerApproved, started.body[0].code], [true, false, null]);
    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${gid}/members/${a.memberId}/replace`, { reason: 'مرة ثانية' })).body.error?.code, 'TRANSFER_OPEN');
    assert.equal((await api(B, 'get', `/api/v1/gamiyas/${gid}/seat-transfers`)).body.length, 0, 'other members do not see it');
    const tid = started.body[0].id;
    assert.equal((await api(A, 'post', `/api/v1/seat-transfers/${tid}/approve`)).status, 403, 'A already consented');
    const ok = (await api(O, 'post', `/api/v1/seat-transfers/${tid}/approve`)).body;
    assert.equal(ok[0].ready, true);
    const code = ok[0].code;
    assert.ok(code);

    const pv = await api(D, 'get', `/api/v1/seat-transfers/code/${code}`);
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    assert.equal(pv.body.seat.replaces, A.name);
    assert.equal(pv.body.seat.payoutPosition, a.payoutPosition);
    assert.equal(pv.body.seat.installments, aOwes - (toOrg ? 1 : 0));
    assert.equal(pv.body.pledge.terms.installments, pv.body.seat.installments);
    assert.match(pv.body.pledge.text, new RegExp(`أحلّ محلّ ${A.name}`));
    assert.match(pv.body.pledge.text, /دانة العتيبي/);
    const accept = (body: object) => rawApi(D, 'post', `/api/v1/seat-transfers/code/${code}/accept`, body);
    assert.equal((await accept({ agreementVersionId: await ag(D) })).body.error?.code, 'PLEDGE_REQUIRED');
    assert.equal((await rawApi(B, 'post', `/api/v1/seat-transfers/code/${code}/accept`, { agreementVersionId: await ag(B), pledge: { typedName: B.name, textSha256: pv.body.pledge.textSha256 } })).body.error?.code, 'ALREADY_MEMBER');
    assert.equal((await rawApi(E, 'post', `/api/v1/seat-transfers/code/${code}/accept`, { agreementVersionId: await ag(E), pledge: { typedName: E.name, textSha256: pv.body.pledge.textSha256 } })).body.error?.code, 'PLEDGE_OUTDATED', 'the pledge names the signer');
    const done = await accept({ agreementVersionId: await ag(D), pledge: { typedName: D.name, textSha256: pv.body.pledge.textSha256 } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const d = done.body.members.find((m: any) => m.fullName === D.name);
    assert.equal(d.payoutPosition, a.payoutPosition, 'the newcomer takes the same turn');
    assert.ok(!done.body.members.some((m: any) => m.fullName === A.name));
    assert.equal(done.body.members.length, 3);
    assert.equal((await api(A, 'get', `/api/v1/gamiyas/${gid}`)).status, 404, 'the outgoing member no longer has the seat');
    assert.equal((await rawApi(E, 'get', `/api/v1/seat-transfers/code/${code}`)).status, 404, 'a link works once');

    const after = (await api(O, 'get', `/api/v1/gamiyas/${gid}/schedule`)).body;
    assert.equal(after.find((cy: any) => cy.recipient === D.name)?.cycle, sched.find((cy: any) => cy.recipient === A.name).cycle, 'A’s turn is now D’s');
    const payers = after.flatMap((cy: any) => cy.installments.map((i: any) => i.payer));
    assert.equal(payers.filter((n: string) => n === D.name).length, aOwes - (toOrg ? 1 : 0));
    assert.equal(payers.filter((n: string) => n === A.name).length, toOrg ? 1 : 0, 'what A paid stays on A’s record');
    const chat = (await api(B, 'get', `/api/v1/gamiyas/${gid}/chat`)).body;
    assert.ok(chat.some((m: any) => m.kind === 'SYSTEM' && /حلّ دانة العتيبي محلّ عبدالله/.test(m.body)));
    const logged = (await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='SEAT_TRANSFERRED' AND entity_id=$1`, [gid])).rows[0].n;
    assert.equal(logged, 1);
  });

  test('the organizer starts it after the start: the member must agree; a seat whose turn was received cannot move', async () => {
    const gid = await circle(O, [A, B], { name: 'جمعية الأصدقاء', contribution: '300', memberCount: 3, startDate: '2027-05-01' });
    await draw(O, A, gid);
    const b = await memberOf(O, gid, B.name);
    const s = (await api(O, 'post', `/api/v1/gamiyas/${gid}/members/${b.memberId}/replace`, { reason: 'تأخر متكرر' })).body;
    assert.deepEqual([s[0].outgoingConsent, s[0].organizerApproved, s[0].code], [false, true, null]);
    const mine = (await api(B, 'get', `/api/v1/gamiyas/${gid}/seat-transfers`)).body;
    assert.equal(mine[0].mine, true);
    assert.equal((await api(B, 'post', `/api/v1/seat-transfers/${mine[0].id}/cancel`)).status, 200, 'the member can refuse');
    assert.equal((await api(O, 'get', `/api/v1/gamiyas/${gid}/seat-transfers`)).body.length, 0);

    // A seat whose payout date has passed has received its turn.
    const r = (await db.query(`SELECT recipient_member_id FROM gamiya_cycles WHERE gamiya_id=$1 AND cycle_index=1`, [gid])).rows[0];
    await db.query(`UPDATE gamiya_cycles SET due_date='2026-01-01' WHERE gamiya_id=$1 AND cycle_index=1`, [gid]);
    const first = (await db.query(`SELECT u.full_name FROM gamiya_members m JOIN users u ON u.id=m.user_id WHERE m.id=$1`, [r.recipient_member_id])).rows[0].full_name;
    if (first !== O.name) {
      const m = await memberOf(O, gid, first);
      assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/members/${m.memberId}/replace`, { reason: 'لا يصح' })).body.error?.code, 'TURN_RECEIVED');
    }
  });

  test('before the start: the organizer replaces a member in one step, the newcomer signs the full terms', async () => {
    const gid = await circle(O, [A], { name: 'جمعية رمضان', contribution: '200', memberCount: 3, startDate: '2027-06-01' });
    const a = await memberOf(O, gid, A.name);
    const s = (await api(O, 'post', `/api/v1/gamiyas/${gid}/members/${a.memberId}/replace`, { reason: 'اعتذر عن المشاركة' })).body;
    assert.equal(s[0].ready, true, 'before the start the organizer could remove the member anyway');
    const pv = (await api(E, 'get', `/api/v1/seat-transfers/code/${s[0].code}`)).body;
    assert.equal(pv.pledge.terms.installments, 2);
    assert.equal(pv.seat.payoutPosition, null);
    const done = await rawApi(E, 'post', `/api/v1/seat-transfers/code/${s[0].code}/accept`, { agreementVersionId: await ag(E), pledge: { typedName: E.name, textSha256: pv.pledge.textSha256 } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual(done.body.members.map((m: any) => m.fullName).sort(), [O.name, E.name].sort());
    assert.equal(done.body.status, 'RECRUITING');
    assert.equal((await rawApi(A, 'get', `/api/v1/seat-transfers/code/${s[0].code}`)).status, 404);
  });
});
