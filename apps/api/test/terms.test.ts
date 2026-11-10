import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main.ts';
import { ProviderChain } from '../../../packages/ai-core/src/providers.ts';
import { testConfigExtras } from './helpers.ts';

/** Owner request 2026-11-10 (17:50): payment pledge before joining, editing amount / member count / members, goals, circle planner. */
let app: INestApplication, http: any, db: pg.Client;
let ipSeq = 10;
const config: any = {
  databaseUrl: process.env.DATABASE_URL!, jwtSecret: randomBytes(32).toString('hex'), otpPepper: 'p', lotterySeedKey: randomBytes(32),
  exposeOtpInResponse: true, isProduction: false, ai: { chain: new ProviderChain([]), skipped: [] }, ...testConfigExtras(),
};
interface Person { name: string; ip: string; token: string; id: string }
const api = (p: Person, method: 'get' | 'post', url: string, body?: object) => {
  const r = http[method](url).set('X-Forwarded-For', p.ip).set('Authorization', `Bearer ${p.token}`).set('User-Agent', 'terms-test/1.0');
  return body ? r.send(body) : r;
};
async function login(name: string, phone: string): Promise<Person> {
  const ip = `10.8.0.${ipSeq++}`;
  const req = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone });
  const ver = await http.post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code: req.body.devCode, fullName: name });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return { name, ip, token: ver.body.accessToken, id: ver.body.user.id };
}
const sign = (p: Person, pledge: { textSha256: string }) => ({ typedName: p.name, textSha256: pledge.textSha256 });

before(async () => {
  app = await createApp(config); await app.init(); http = request(app.getHttpServer());
  db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
});
after(async () => { await db.end(); await app.close(); });

describe('pledge, editing and membership', () => {
  let O: Person, A: Person, B: Person, C: Person, gid: string, code: string, ag: string;
  const base = { name: 'جمعية العائلة الكبيرة', country: 'SA', frequency: 'MONTHLY', contribution: '1000', memberCount: 4, startDate: '2027-01-01' };

  before(async () => {
    O = await login('أم سعد', '+966500000601'); A = await login('سعد', '+966500000602');
    B = await login('هيفاء', '+966500000603'); C = await login('ناصر', '+966500000604');
    ag = (await api(O, 'get', '/api/v1/agreements/current')).body.id;
  });

  test('creating a circle needs the pledge built from its own terms, signed with the creator name', async () => {
    const pv = await api(O, 'post', '/api/v1/gamiyas/pledge-preview', base);
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    assert.equal(pv.body.terms.installments, 3);
    assert.equal(pv.body.terms.totalCommitment, '3000.00');
    assert.equal(pv.body.clauses.length, 4);
    assert.match(pv.body.text, /مسؤولية كاملة/);
    assert.match(pv.body.text, /أم سعد/);
    const body = { ...base, agreementVersionId: ag, category: 'FAMILY' };
    assert.equal((await api(O, 'post', '/api/v1/gamiyas', body)).body.error?.code, 'PLEDGE_REQUIRED');
    assert.equal((await api(O, 'post', '/api/v1/gamiyas', { ...body, pledge: { typedName: 'أم سعد', textSha256: '0'.repeat(64) } })).body.error?.code, 'PLEDGE_OUTDATED');
    assert.equal((await api(O, 'post', '/api/v1/gamiyas', { ...body, pledge: { typedName: 'شخص آخر', textSha256: pv.body.textSha256 } })).body.error?.code, 'SIGNATURE_MISMATCH');
    // Arabic letter variants and extra spaces are accepted
    const r = await api(O, 'post', '/api/v1/gamiyas', { ...body, pledge: { typedName: '  ام   سعد ', textSha256: pv.body.textSha256 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.category, 'FAMILY');
    assert.equal(r.body.termsVersion, 1);
    gid = r.body.id;
    const ev = (await db.query('SELECT * FROM pledges WHERE gamiya_id=$1', [gid])).rows;
    assert.equal(ev.length, 1);
    assert.equal(ev[0].text_sha256, pv.body.textSha256);
    assert.equal(ev[0].user_agent, 'terms-test/1.0');
    assert.ok(ev[0].ip_address);
    await assert.rejects(db.query('UPDATE pledges SET typed_name=$1 WHERE gamiya_id=$2', ['x', gid]), /append-only|not allowed|forbid/i);
  });

  test('a person with the invite sees the circle and their own pledge before joining', async () => {
    code = (await api(O, 'post', `/api/v1/gamiyas/${gid}/invitations`, { maxUses: 10 })).body.code;
    const pv = await api(A, 'get', `/api/v1/invitations/${code}`);
    assert.equal(pv.status, 200);
    assert.equal(pv.body.circle.organizerName, 'أم سعد');
    assert.equal(pv.body.circle.potPerCycle, '4000.00');
    assert.match(pv.body.pledge.text, /أنا سعد/);
    assert.equal((await api(A, 'get', '/api/v1/invitations/nope-code')).status, 404);
    assert.equal((await api(A, 'post', `/api/v1/invitations/${code}/accept`, { agreementVersionId: ag })).status, 400, 'pledge required to join');
    for (const p of [A, B]) {
      const t = (await api(p, 'get', `/api/v1/invitations/${code}`)).body.pledge;
      const r = await api(p, 'post', `/api/v1/invitations/${code}/accept`, { agreementVersionId: ag, pledge: sign(p, t) });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const d = (await api(O, 'get', `/api/v1/gamiyas/${gid}`)).body;
    assert.equal(d.joined, 3);
    assert.ok(d.members.every((m: any) => m.pledged));
  });

  test('editing the name only does not ask anyone to re-sign', async () => {
    const r = await api(O, 'post', `/api/v1/gamiyas/${gid}/edit`, { name: 'جمعية آل سعد' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.termsVersion, 1);
    assert.ok(r.body.members.every((m: any) => m.status === 'ACTIVE'));
    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${gid}/edit`, { name: 'x x' })).status, 403, 'only the organizer edits');
  });

  test('changing the amount and member count: organizer re-signs, members must re-confirm or leave', async () => {
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/edit`, { memberCount: 2 })).body.error?.code, 'BELOW_JOINED');
    const pv = await api(O, 'post', `/api/v1/gamiyas/${gid}/edit/preview`, { contribution: '2500', memberCount: 5 });
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    assert.equal(pv.body.moneyChanged, true);
    assert.equal(pv.body.membersToReconfirm, 2);
    assert.equal(pv.body.terms.totalCommitment, '10000.00');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/edit`, { contribution: '2500', memberCount: 5 })).body.error?.code, 'PLEDGE_REQUIRED');
    const r = await api(O, 'post', `/api/v1/gamiyas/${gid}/edit`, { contribution: '2500', memberCount: 5, pledge: sign(O, pv.body.pledge) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.termsVersion, 2);
    assert.equal(r.body.contribution, '2500.00');
    assert.equal(r.body.memberCount, 5);
    assert.equal(r.body.tier, 'MEDIUM');
    assert.deepEqual(r.body.members.filter((m: any) => m.role === 'MEMBER').map((m: any) => m.status), ['PENDING_APPROVAL', 'PENDING_APPROVAL']);
    const chat = (await api(A, 'get', `/api/v1/gamiyas/${gid}/chat`)).body;
    const msgs = (chat.messages ?? chat).map((m: any) => m.body).join('\n');
    assert.match(msgs, /القسط: 2500/);
    // a member re-confirms with the new pledge; the old hash is refused
    const old = (await db.query('SELECT text_sha256 FROM pledges WHERE user_id=$1 AND gamiya_id=$2', [A.id, gid])).rows[0].text_sha256;
    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${gid}/reconfirm`, { pledge: { typedName: 'سعد', textSha256: old } })).body.error?.code, 'PLEDGE_OUTDATED');
    const p2 = (await api(A, 'get', `/api/v1/gamiyas/${gid}/pledge`)).body;
    assert.equal(p2.terms.termsVersion, 2);
    assert.equal(p2.signedAt, null);
    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${gid}/reconfirm`, { pledge: sign(A, p2) })).status, 200);
    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${gid}/reconfirm`, { pledge: sign(A, p2) })).body.error?.code, 'NOTHING_TO_CONFIRM');
  });

  test('a member leaves before the start with no obligation; the organizer removes another with a reason', async () => {
    assert.equal((await api(B, 'post', `/api/v1/gamiyas/${gid}/leave`, {})).status, 200);
    assert.equal((await api(B, 'get', `/api/v1/gamiyas/${gid}`)).status, 404, 'a member who left no longer sees the circle');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/leave`, {})).status, 403, 'organizer cannot leave');
    // C joins, then is removed
    const t = (await api(C, 'get', `/api/v1/invitations/${code}`)).body.pledge;
    assert.equal((await api(C, 'post', `/api/v1/invitations/${code}/accept`, { agreementVersionId: ag, pledge: sign(C, t) })).status, 200);
    const cId = (await api(O, 'get', `/api/v1/gamiyas/${gid}`)).body.members.find((m: any) => m.fullName === 'ناصر').memberId;
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/members/${cId}/remove`, {})).status, 400, 'reason required');
    const rm = await api(O, 'post', `/api/v1/gamiyas/${gid}/members/${cId}/remove`, { reason: 'اتفقنا أن تكون للعائلة فقط' });
    assert.equal(rm.status, 200);
    assert.equal(rm.body.joined, 2);
    const n = (await api(C, 'get', '/api/v1/me/notifications')).body;
    assert.ok((n.items ?? n).some((x: any) => /اتفقنا أن تكون للعائلة فقط/.test(x.body)));
    // B can come back with the invite (signs the current terms again)
    const t2 = (await api(B, 'get', `/api/v1/invitations/${code}`)).body;
    assert.equal(t2.alreadyMember, false);
    assert.equal(t2.pledge.terms.termsVersion, 2);
    assert.equal((await api(B, 'post', `/api/v1/invitations/${code}/accept`, { agreementVersionId: ag, pledge: sign(B, t2.pledge) })).status, 200);
    assert.equal((await api(O, 'get', `/api/v1/gamiyas/${gid}`)).body.joined, 3);
  });

  test('my pledges list every signed version', async () => {
    const mine = (await api(A, 'get', '/api/v1/me/pledges')).body;
    assert.deepEqual(mine.filter((p: any) => p.gamiyaId === gid).map((p: any) => p.termsVersion), [2, 1]);
    assert.equal(mine[0].totalCommitment, '10000.00');
  });

  test('filling the circle locks it; terms cannot change once a draw is prepared', async () => {
    const pv = (await api(O, 'post', `/api/v1/gamiyas/${gid}/edit/preview`, { memberCount: 3 })).body;
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/edit`, { memberCount: 3, pledge: sign(O, pv.pledge) })).status, 200, 'shrink to the members who joined');
    assert.equal((await api(O, 'get', `/api/v1/gamiyas/${gid}`)).body.status, 'RECRUITING', 'full, but waiting for members to accept the new terms');
    for (const p of [A, B]) assert.equal((await api(p, 'post', `/api/v1/gamiyas/${gid}/reconfirm`, { pledge: sign(p, (await api(p, 'get', `/api/v1/gamiyas/${gid}/pledge`)).body) })).status, 200);
    const d = (await api(O, 'get', `/api/v1/gamiyas/${gid}`)).body;
    assert.equal(d.status, 'LOCKED');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/lottery/prepare`, {})).status, 201);
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/edit`, { name: 'اسم جديد' })).body.error?.code, 'LOTTERY_PREPARED');
    assert.equal((await api(A, 'post', `/api/v1/gamiyas/${gid}/leave`, {})).body.error?.code, 'LOTTERY_PREPARED');
  });
});

describe('goals and the circle planner', () => {
  let U: Person;
  before(async () => { U = await login('مريم', '+966500000611'); });

  test('planner: goal → plans with equal pots, latest turn for the date, Friday circles', async () => {
    const r = await api(U, 'post', '/api/v1/ai/circle-plan', { targetAmount: 30000, neededBy: '2027-09-01', monthlyBudget: 4000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.plans.length >= 1 && r.body.plans.length <= 3);
    for (const p of r.body.plans) { assert.ok(p.pot >= 30000); assert.equal(p.pot, p.contribution * p.members); }
    assert.match(r.body.note, /لا رسوم/);
    const fri = (await api(U, 'post', '/api/v1/ai/circle-plan', { targetAmount: 2000, frequency: 'WEEKLY', people: 8 })).body;
    assert.equal(fri.plans[0].frequency, 'WEEKLY');
    assert.equal(new Date(`${fri.plans[0].startDate}T12:00:00Z`).getUTCDay(), 5, 'weekly circles start on a Friday');
    assert.equal((await api(U, 'post', '/api/v1/ai/circle-plan', { targetAmount: 900000 })).body.reason, 'TARGET_TOO_LARGE');
  });

  test('goals: add, link to a circle, progress, archive', async () => {
    const g = await api(U, 'post', '/api/v1/me/goals', { category: 'HAJJ', title: 'حج 2027', targetAmount: '25000', targetDate: '2027-05-01' });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.equal(g.body.circle, null);
    const other = await api(U, 'post', '/api/v1/me/goals', { category: 'SCHOOL', title: 'رسوم المدرسة', targetAmount: '8000', gamiyaId: '00000000-0000-0000-0000-000000000000' });
    assert.equal(other.status, 404, 'cannot link a circle you are not in');
    const ag = (await api(U, 'get', '/api/v1/agreements/current')).body.id;
    const body = { name: 'جمعية الحج', country: 'SA', frequency: 'MONTHLY', contribution: '5000', memberCount: 5, startDate: '2027-01-01' };
    const pv = (await api(U, 'post', '/api/v1/gamiyas/pledge-preview', body)).body;
    const c = (await api(U, 'post', '/api/v1/gamiyas', { ...body, agreementVersionId: ag, category: 'HAJJ', pledge: sign(U, pv) })).body;
    const up = await api(U, 'post', `/api/v1/me/goals/${g.body.id}`, { gamiyaId: c.id });
    assert.equal(up.status, 200);
    assert.equal(up.body.circle.pot, '25000.00');
    assert.equal(up.body.circle.coversTarget, true);
    assert.equal((await api(U, 'post', `/api/v1/me/goals/${g.body.id}/remove`, {})).status, 200);
    assert.equal((await api(U, 'get', '/api/v1/me/goals')).body.length, 0);
  });
});
