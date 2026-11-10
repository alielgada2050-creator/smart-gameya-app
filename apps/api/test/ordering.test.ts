import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main.ts';
import { ProviderChain } from '../../../packages/ai-core/src/providers.ts';
import { testConfigExtras, uploadFile, PNG, withPledge } from './helpers.ts';

/** Owner request 2026-11-10: payout order by agreement or priority (every member approves) + smart transfers without holding funds. */
let app: INestApplication, http: any;
let ipSeq = 10;
const config: any = {
  databaseUrl: process.env.DATABASE_URL!, jwtSecret: randomBytes(32).toString('hex'), otpPepper: 'p', lotterySeedKey: randomBytes(32),
  exposeOtpInResponse: true, isProduction: false, ai: { chain: new ProviderChain([]), skipped: [] }, ...testConfigExtras(),
};
interface Person { name: string; ip: string; token: string; id: string }
const rawApi = (p: Person, method: 'get' | 'post', url: string, body?: object) => {
  const r = http[method](url).set('X-Forwarded-For', p.ip).set('Authorization', `Bearer ${p.token}`);
  return body ? r.send(body) : r;
};
const api = withPledge(rawApi) as typeof rawApi;
async function login(name: string, phone: string): Promise<Person> {
  const ip = `10.7.0.${ipSeq++}`;
  const req = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone });
  const ver = await http.post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code: req.body.devCode, fullName: name });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return { name, ip, token: ver.body.accessToken, id: ver.body.user.id };
}

before(async () => { app = await createApp(config); await app.init(); http = request(app.getHttpServer()); });
after(async () => { await app.close(); });

describe('payout order by agreement / priority', () => {
  let O: Person, A: Person, B: Person, C: Person, gid: string, url: string;
  const ids: Record<string, string> = {};

  before(async () => {
    O = await login('منظمة الترتيب', '+966500000501'); A = await login('عضو أ', '+966500000502');
    B = await login('عضو ب', '+966500000503'); C = await login('عضو ج', '+966500000504');
    const ag = (await api(O, 'get', '/api/v1/agreements/current')).body.id;
    const g = await api(O, 'post', '/api/v1/gamiyas', { name: 'جمعية الترتيب', country: 'SA', frequency: 'MONTHLY', contribution: '1000', memberCount: 4, startDate: '2027-01-01', agreementVersionId: ag });
    assert.equal(g.status, 201);
    gid = g.body.id; url = `/api/v1/gamiyas/${gid}/order`;
    // members can declare priority while recruiting
    assert.equal((await api(O, 'post', `${url}/priority`, { preference: 'NONE' })).status, 200);
    const code = (await api(O, 'post', `/api/v1/gamiyas/${gid}/invitations`, { maxUses: 3 })).body.code;
    for (const m of [A, B, C]) assert.equal((await api(m, 'post', `/api/v1/invitations/${code}/accept`, { agreementVersionId: ag })).status, 200);
    for (const m of (await api(O, 'get', `/api/v1/gamiyas/${gid}`)).body.members) ids[m.fullName] = m.memberId;
  });

  test('priority requests: validation and privacy of reasons and notes', async () => {
    assert.equal((await api(A, 'post', `${url}/priority`, { preference: 'LATE', neededBy: '2027-02-01' })).body.error.code, 'LATE_WITH_DATE');
    assert.equal((await api(A, 'post', `${url}/priority`, { preference: 'EARLY', neededBy: '2027-02-15', reason: 'HEALTH', shareReason: false, note: 'موعد عملية' })).status, 200);
    assert.equal((await api(B, 'post', `${url}/priority`, { preference: 'LATE', reason: 'NONE' })).status, 200);
    assert.equal((await api(C, 'post', `${url}/priority`, { preference: 'EARLY', neededBy: '2027-01-10', reason: 'WEDDING', shareReason: true })).status, 200);
    const asB = (await api(B, 'get', url)).body;
    const a = asB.requests.find((r: any) => r.memberId === ids['عضو أ']);
    assert.deepEqual([a.reason, a.note, a.neededBy], [null, null, '2027-02-15'], 'private reason + note hidden from other members');
    assert.equal(asB.requests.find((r: any) => r.memberId === ids['عضو ج']).reason, 'WEDDING', 'shared reason visible');
    const asO = (await api(O, 'get', url)).body;
    assert.equal(asO.requests.find((r: any) => r.memberId === ids['عضو أ']).note, 'موعد عملية', 'organizer sees the note');
  });

  test('suggestion: by need date then preference, explained, no reason ranking', async () => {
    const s = (await api(B, 'get', `${url}/suggestion`)).body;
    assert.deepEqual(s.order.map((o: any) => o.fullName).slice(0, 2), ['عضو ج', 'عضو أ']);
    assert.equal(s.order[3].fullName, 'عضو ب', 'LATE goes last');
    assert.deepEqual([s.metNeeds, s.declaredNeeds], [2, 2]);
    assert.ok(s.explanation.some((l: string) => l.includes('لا يفاضل بين الأسباب')));
    assert.equal(s.summary.source, 'template');
  });

  test('propose → objection closes it → re-propose → every member approves → circle starts', async () => {
    const s = (await api(O, 'get', `${url}/suggestion`)).body;
    const order = s.order.map((o: any) => o.memberId);
    assert.equal((await api(A, 'post', `${url}/proposals`, { mode: 'PRIORITY', order })).status, 403, 'members cannot propose');
    assert.equal((await api(O, 'post', `${url}/proposals`, { mode: 'AGREED', order: order.slice(0, 3).concat(order[0]) })).body.error.code, 'INVALID_ORDER');
    const p1 = await api(O, 'post', `${url}/proposals`, { mode: 'PRIORITY', order });
    assert.equal(p1.status, 201); assert.equal(p1.body.aiAssisted, true);
    assert.equal((await api(O, 'post', `${url}/proposals`, { mode: 'AGREED', order })).body.error.code, 'ORDER_PROPOSAL_OPEN');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/lottery/prepare`)).body.error.code, 'ORDER_PROPOSAL_OPEN', 'no lottery while a proposal is open');
    const v = `${url}/proposals/${p1.body.proposalId}/vote`;
    assert.equal((await api(A, 'post', v, { vote: 'APPROVE' })).body.status, 'OPEN');
    assert.equal((await api(A, 'post', v, { vote: 'OBJECT', reason: 'غيرت رأيي' })).body.error.code, 'ALREADY_VOTED', 'votes are final');
    assert.equal((await api(B, 'post', v, { vote: 'OBJECT' })).body.error.code, 'REASON_REQUIRED');
    assert.equal((await api(B, 'post', v, { vote: 'OBJECT', reason: 'أفضّل أن أكون الثالث' })).body.status, 'REJECTED');
    assert.equal((await api(C, 'post', v, { vote: 'APPROVE' })).body.error.code, 'PROPOSAL_CLOSED');

    // agreed order after discussion: B third, the rest as suggested
    const agreed = [ids['عضو ج'], ids['عضو أ'], ids['عضو ب'], ids['منظمة الترتيب']];
    const p2 = await api(O, 'post', `${url}/proposals`, { mode: 'AGREED', order: agreed, rationale: 'بعد النقاش في المحادثة' });
    assert.equal(p2.body.aiAssisted, false);
    const v2 = `${url}/proposals/${p2.body.proposalId}/vote`;
    for (const m of [A, B]) assert.equal((await api(m, 'post', v2, { vote: 'APPROVE' })).body.status, 'OPEN');
    const st = (await api(C, 'get', url)).body.openProposal;
    assert.deepEqual([st.approvals, st.needed, st.myVote], [3, 4, null]);
    assert.equal((await api(C, 'post', v2, { vote: 'APPROVE' })).body.status, 'ADOPTED');

    const g = (await api(A, 'get', `/api/v1/gamiyas/${gid}`)).body;
    assert.deepEqual([g.status, g.orderingMethod], ['ACTIVE', 'CONSENSUS']);
    assert.deepEqual(g.members.map((m: any) => m.fullName), ['عضو ج', 'عضو أ', 'عضو ب', 'منظمة الترتيب']);
    assert.equal((await api(A, 'post', `${url}/priority`, { preference: 'NONE' })).body.error.code, 'ORDER_FIXED');
    const sched = (await api(A, 'get', `/api/v1/gamiyas/${gid}/schedule`)).body;
    assert.equal(sched.length, 4); assert.equal(sched[0].recipient, 'عضو ج');
    const chat = (await api(B, 'get', `/api/v1/gamiyas/${gid}/chat`)).body;
    const text = JSON.stringify(chat);
    assert.ok(text.includes('أفضّل أن أكون الثالث') && text.includes('وافق جميع الأعضاء'), 'objection and adoption are in the chat record');
    const reply = await api(A, 'post', `/api/v1/gamiyas/${gid}/chat`, { body: '@مساعد الترتيب' });
    assert.equal(reply.status, 201);
  });

  test('smart transfers: transfer card, automatic matching, one receipt per transfer', async () => {
    await api(C, 'post', '/api/v1/me/payout-methods', { country: 'SA', kind: 'IBAN_SA', value: 'SA0380000000608010167519', isDefault: true });
    const toPay = (await api(A, 'get', '/api/v1/me/obligations')).body.toPay.filter((i: any) => i.gamiyaId === gid);
    const first = toPay.find((i: any) => i.cycle === 1);
    assert.match(first.transferReference, /^JM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const card = (await api(A, 'get', `/api/v1/installments/${first.installmentId}/pay-to`)).body;
    assert.equal(card.reference, first.transferReference);
    assert.equal(card.methods[0].guide.steps.length, 3);
    assert.equal(card.methods[0].guide.limitNote, undefined, '1,000 SAR is under the quick-transfer limit');

    const r1 = await uploadFile(http, A, gid, 'RECEIPT', PNG);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date()); // server dates are Riyadh dates
    const d = await api(A, 'post', `/api/v1/installments/${first.installmentId}/declare-paid`, { methodKind: 'STC_PAY', receiptFileId: r1.fileId, reference: 'BNK-77', amount: '900', transferDate: today });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    const failed = d.body.match.checks.filter((c: any) => !c.ok).map((c: any) => c.check);
    assert.deepEqual(failed, ['AMOUNT', 'METHOD'], 'short amount and a method the recipient does not use are flagged');

    const second = toPay.find((i: any) => i.cycle === 3);
    const again = await api(A, 'post', `/api/v1/installments/${second.installmentId}/declare-paid`, { methodKind: 'IBAN_SA', receiptFileId: r1.fileId, amount: '1000', transferDate: today });
    assert.equal(again.body.error?.code, 'RECEIPT_ALREADY_USED');
    const r2 = await uploadFile(http, A, gid, 'RECEIPT', PNG);
    const ok = await api(A, 'post', `/api/v1/installments/${second.installmentId}/declare-paid`, { methodKind: 'IBAN_SA', receiptFileId: r2.fileId, reference: 'bnk-77', amount: '1000', transferDate: today });
    // cycle 3 goes to عضو ب, who has no saved method yet; the bank reference repeats (case-insensitive)
    assert.deepEqual(ok.body.match.checks.filter((c: any) => !c.ok).map((c: any) => c.check), ['METHOD', 'BANK_REF_UNIQUE']);
  });
});
