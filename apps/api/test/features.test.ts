import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import pg from 'pg';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main.ts';
import { ProviderChain } from '../../../packages/ai-core/src/providers.ts';
import { testConfigExtras, uploadFile, PNG, PDF, withPledge } from './helpers.ts';

/** Features from the 2026-11-09 request: tiers, large-circle approval, payout methods, receipts, chat, assistant, reminders, Google sign-in. */
let app: INestApplication, http: any, db: pg.Client, jwks: Server;
let ipSeq = 100;
let signKey: CryptoKey;
const config: any = {
  databaseUrl: process.env.DATABASE_URL!, jwtSecret: randomBytes(32).toString('hex'), otpPepper: 'p', lotterySeedKey: randomBytes(32),
  exposeOtpInResponse: true, isProduction: false, ai: { chain: new ProviderChain([]), skipped: [] }, ...testConfigExtras(),
};

interface Person { name: string; phone: string; ip: string; token: string; id: string }
const rawApi = (p: Person | null, method: 'get' | 'post', url: string, body?: object) => {
  let r = http[method](url).set('X-Forwarded-For', p?.ip ?? '10.1.0.250');
  if (p) r = r.set('Authorization', `Bearer ${p.token}`);
  return body ? r.send(body) : r;
};
const api = withPledge(rawApi) as typeof rawApi;
async function login(name: string, phone: string, linkToken?: string): Promise<Person> {
  const ip = `10.1.0.${ipSeq++}`;
  const req = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone });
  const ver = await http.post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone, code: req.body.devCode, fullName: name, linkToken });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return { name, phone, ip, token: ver.body.accessToken, id: ver.body.user.id };
}
async function agreementId(p: Person) { return (await api(p, 'get', '/api/v1/agreements/current')).body.id; }
async function circle(p: Person, body: object) {
  const r = await api(p, 'post', '/api/v1/gamiyas', { frequency: 'MONTHLY', startDate: '2027-03-01', agreementVersionId: await agreementId(p), ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function invite(org: Person, id: string, members: Person[]) {
  const code = (await api(org, 'post', `/api/v1/gamiyas/${id}/invitations`, { maxUses: members.length })).body.code;
  for (const m of members) assert.equal((await api(m, 'post', `/api/v1/invitations/${code}/accept`, { agreementVersionId: await agreementId(m) })).status, 200);
}
async function googleToken(claims: Record<string, unknown>, aud = 'test-client.apps.googleusercontent.com') {
  return new SignJWT({ email_verified: true, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com').setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(signKey);
}

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  signKey = privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  jwks = createServer((_q, s) => s.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] })));
  await new Promise<void>((ok) => jwks.listen(0, '127.0.0.1', ok));
  config.google = { clientId: 'test-client.apps.googleusercontent.com', jwksUrl: `http://127.0.0.1:${(jwks.address() as any).port}/certs`, issuers: ['https://accounts.google.com'] };
  app = await createApp(config);
  await app.init();
  http = request(app.getHttpServer());
  db = new pg.Client({ connectionString: config.databaseUrl });
  await db.connect();
});
after(async () => { await db.end(); await app.close(); jwks.close(); });

describe('tiers (by payout value)', () => {
  test('preview classifies small / medium / large and rejects above 100,000 and disabled countries', async () => {
    const u = await login('مختبر الفئات', '+966500000301');
    const pv = (body: object) => api(u, 'post', '/api/v1/gamiyas/preview', { country: 'SA', frequency: 'MONTHLY', startDate: '2027-01-01', ...body });
    assert.equal((await pv({ contribution: '1000', memberCount: 10 })).body.tier, 'SMALL');
    const med = (await pv({ contribution: '1000', memberCount: 12 })).body;
    assert.deepEqual([med.tier, med.potPerCycle, med.requiresPlatformApproval], ['MEDIUM', '12000.00', false]);
    const big = (await pv({ contribution: '5000', memberCount: 12 })).body;
    assert.deepEqual([big.tier, big.requiresPlatformApproval, big.requiresPromissoryNotes], ['LARGE', true, true]);
    assert.equal((await pv({ contribution: '10000', memberCount: 12 })).body.error.code, 'ABOVE_MAXIMUM');
    assert.equal((await pv({ contribution: '1000', memberCount: 10, country: 'EG' })).body.error.code, 'COUNTRY_NOT_ENABLED');
    const pub = await http.get('/api/v1/config/public');
    assert.deepEqual(pub.body.circleCountries, ['SA']);
    assert.equal(pub.body.googleClientId, 'test-client.apps.googleusercontent.com');
  });
});

describe('large circle: promissory notes + platform approval', () => {
  let O: Person, M1: Person, M2: Person, ADMIN: Person, gid: string;
  test('setup: 3 × 20,000 = 60,000 SAR → LARGE, awaiting notes', async () => {
    O = await login('منظم كبير', '+966500000311'); M1 = await login('عضو ك1', '+966500000312'); M2 = await login('عضو ك2', '+966500000313');
    const c = await circle(O, { name: 'جمعية كبيرة', contribution: '20000', memberCount: 3 });
    gid = c.id;
    assert.deepEqual([c.tier, c.platformApproval], ['LARGE', 'AWAITING_NOTES']);
    await invite(O, gid, [M1, M2]);
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/lottery/prepare`)).body.error.code, 'PLATFORM_APPROVAL_REQUIRED');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/platform-review`)).body.error.code, 'NOTES_MISSING');
  });

  test('members upload notes payable to the organizer; organizer does not', async () => {
    const f0 = await uploadFile(http, O, gid, 'PROMISSORY_NOTE', PDF, 'note.pdf');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/promissory-notes`, { fileId: f0.fileId, reference: 'NFTH-0' })).status, 403);
    for (const [m, ref] of [[M1, 'NFTH-1001'], [M2, 'NFTH-1002']] as const) {
      const f = await uploadFile(http, m, gid, 'PROMISSORY_NOTE', PDF, 'note.pdf');
      const r = await api(m, 'post', `/api/v1/gamiyas/${gid}/promissory-notes`, { fileId: f.fileId, reference: ref });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.amount, '60000.00');
    }
    const otherNote = (await db.query(`SELECT file_id FROM promissory_notes n JOIN gamiya_members m ON m.id=n.member_id WHERE m.user_id=$1`, [M2.id])).rows[0].file_id;
    assert.equal((await api(M1, 'get', `/api/v1/files/${otherNote}`)).status, 404, "a member cannot open another member's note");
    assert.equal((await api(O, 'get', `/api/v1/files/${otherNote}`)).status, 200, 'the beneficiary organizer can');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/platform-review`)).body.platformApproval, 'PENDING');
  });

  test('only platform reviewers see the queue; reject then approve; draw unlocked', async () => {
    assert.equal((await api(M1, 'get', '/api/v1/admin/reviews')).status, 404);
    ADMIN = await login('مراجع المنصة', '+966500000900');
    const me = await api(ADMIN, 'get', '/api/v1/auth/me');
    assert.equal(me.body.platformRole, 'PLATFORM_ADMIN');
    const q = (await api(ADMIN, 'get', '/api/v1/admin/reviews')).body;
    const item = q.find((x: any) => x.id === gid);
    assert.equal(item.notes.length, 2);
    assert.equal(item.potPerCycle, '60000.00');
    const file = await api(ADMIN, 'get', `/api/v1/files/${item.notes[0].fileId}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'application/pdf');
    assert.match(file.headers['content-security-policy'], /sandbox/);
    assert.equal((await api(ADMIN, 'post', `/api/v1/admin/gamiyas/${gid}/review`, { decision: 'REJECT', note: 'السند الثاني غير واضح' })).body.platformApproval, 'REJECTED');
    const f = await uploadFile(http, M2, gid, 'PROMISSORY_NOTE', PDF, 'note.pdf');
    await api(M2, 'post', `/api/v1/gamiyas/${gid}/promissory-notes`, { fileId: f.fileId, reference: 'NFTH-1002B' });
    assert.equal((await api(O, 'get', `/api/v1/gamiyas/${gid}`)).body.platformApproval, 'AWAITING_NOTES');
    // M1's rejected note must be resubmitted too
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/platform-review`)).body.error.code, 'NOTES_MISSING');
    const f1 = await uploadFile(http, M1, gid, 'PROMISSORY_NOTE', PDF, 'note.pdf');
    await api(M1, 'post', `/api/v1/gamiyas/${gid}/promissory-notes`, { fileId: f1.fileId, reference: 'NFTH-1001B' });
    await api(O, 'post', `/api/v1/gamiyas/${gid}/platform-review`);
    assert.equal((await api(ADMIN, 'post', `/api/v1/admin/gamiyas/${gid}/review`, { decision: 'APPROVE' })).body.platformApproval, 'APPROVED');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/lottery/prepare`)).status, 201);
    const notes = (await db.query(`SELECT status FROM promissory_notes WHERE gamiya_id=$1`, [gid])).rows.map((r) => r.status);
    assert.deepEqual(notes, ['ACCEPTED', 'ACCEPTED']);
  });
});

describe('payout methods, receipts, chat, assistant and reminders (medium circle, started in the past)', () => {
  let O: Person, B: Person, C: Person, X: Person, gid: string;
  const IBAN = 'SA0380000000608010167519';

  test('setup + payout methods: validation, encryption at rest, masked to the owner', async () => {
    O = await login('منظمة', '+966500000321'); B = await login('بدر', '+966500000322'); C = await login('جود', '+966500000323'); X = await login('غريب', '+966500000324');
    assert.equal((await api(B, 'post', '/api/v1/me/payout-methods', { country: 'SA', kind: 'IBAN_SA', value: 'SA0480000000608010167519' })).body.error.code, 'INVALID_IBAN');
    assert.equal((await api(B, 'post', '/api/v1/me/payout-methods', { country: 'SA', kind: 'VODAFONE_CASH', value: '01012345678' })).body.error.code, 'UNKNOWN_METHOD');
    for (const p of [O, B, C]) {
      assert.equal((await api(p, 'post', '/api/v1/me/payout-methods', { country: 'SA', kind: 'IBAN_SA', value: IBAN })).status, 201);
    }
    assert.equal((await api(B, 'post', '/api/v1/me/payout-methods', { country: 'SA', kind: 'STC_PAY', value: '0551234567', isDefault: false })).status, 201);
    const mine = (await api(B, 'get', '/api/v1/me/payout-methods')).body;
    assert.deepEqual(mine.map((m: any) => m.masked), ['••••7519', '••••4567']);
    const raw = (await db.query(`SELECT value_ciphertext FROM payout_methods`)).rows;
    assert.ok(raw.every((r) => !r.value_ciphertext.includes('SA03') && !r.value_ciphertext.includes('0551234567')), 'stored encrypted');

    const c = await circle(O, { name: 'جمعية الحي', contribution: '5000', memberCount: 3, startDate: '2026-09-01' });
    gid = c.id;
    assert.equal(c.tier, 'MEDIUM');
    await invite(O, gid, [B, C]);
    await api(O, 'post', `/api/v1/gamiyas/${gid}/lottery/prepare`);
    await api(B, 'post', `/api/v1/gamiyas/${gid}/lottery/approve`);
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/lottery/execute`, { publicEntropy: 'announced-features-test' })).status, 200);
  });

  test('reminders: idempotent per day, organizer only, notifications to payers', async () => {
    assert.equal((await api(B, 'post', `/api/v1/gamiyas/${gid}/reminders/run`)).body.sent, 0);
    const first = (await api(O, 'post', `/api/v1/gamiyas/${gid}/reminders/run`)).body.sent;
    assert.ok(first > 0, 'past-due installments produce LATE reminders');
    assert.equal((await api(O, 'post', `/api/v1/gamiyas/${gid}/reminders/run`)).body.sent, 0, 'not sent twice the same day');
    const n = (await api(B, 'get', '/api/v1/me/notifications')).body;
    assert.ok(n.unread > 0 && n.items.some((i: any) => i.kind === 'REMINDER_LATE'));
    await api(B, 'post', '/api/v1/me/notifications/read');
    assert.equal((await api(B, 'get', '/api/v1/me/notifications')).body.unread, 0);
  });

  test('pay-to reveals the recipient account only to that payer, audited', async () => {
    const ob = (await api(B, 'get', '/api/v1/me/obligations')).body.toPay.find((i: any) => i.gamiyaId === gid);
    const pay = await api(B, 'get', `/api/v1/installments/${ob.installmentId}/pay-to`);
    assert.equal(pay.status, 200);
    assert.equal(pay.body.methods[0].value, IBAN);
    assert.equal((await api(C, 'get', `/api/v1/installments/${ob.installmentId}/pay-to`)).status, 404, 'not the payer');
    assert.equal((await api(X, 'get', `/api/v1/installments/${ob.installmentId}/pay-to`)).status, 404);
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='PAYOUT_DETAILS_VIEWED' AND entity_id=$1`, [ob.installmentId]);
    assert.equal(audit.rows[0].n, 1);
  });

  test('uploads: type sniffed from bytes, 5 MB cap, members only, receipt visible to its parties', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), randomBytes(100)]);
    const bad = await http.post(`/api/v1/gamiyas/${gid}/files`).set('Authorization', `Bearer ${B.token}`).field('purpose', 'RECEIPT').attach('file', exe, 'receipt.png');
    assert.equal(bad.body.error.code, 'FILE_TYPE');
    const big = await http.post(`/api/v1/gamiyas/${gid}/files`).set('Authorization', `Bearer ${B.token}`).field('purpose', 'RECEIPT').attach('file', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png');
    assert.ok([400, 413].includes(big.status), `got ${big.status}`);
    const out = await http.post(`/api/v1/gamiyas/${gid}/files`).set('Authorization', `Bearer ${X.token}`).field('purpose', 'RECEIPT').attach('file', PNG, 'r.png');
    assert.equal(out.status, 404);

    const ob = (await api(B, 'get', '/api/v1/me/obligations')).body.toPay.find((i: any) => i.gamiyaId === gid);
    const rcpt = await uploadFile(http, B, gid, 'RECEIPT', PNG);
    const d = await api(B, 'post', `/api/v1/installments/${ob.installmentId}/declare-paid`, { methodKind: 'STC_PAY', receiptFileId: rcpt.fileId });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    const recipient = [O, C].find((p) => p.name === ob.recipient)!;
    const other = [O, C].find((p) => p !== recipient && p !== O);
    assert.equal((await api(recipient, 'get', `/api/v1/files/${rcpt.fileId}`)).status, 200, 'recipient sees the receipt');
    assert.equal((await api(O, 'get', `/api/v1/files/${rcpt.fileId}`)).status, 200, 'organizer sees the receipt');
    if (other) assert.equal((await api(other, 'get', `/api/v1/files/${rcpt.fileId}`)).status, 404, 'other members do not');
  });

  test('chat: members only, assistant commands, system record of every step, append-only', async () => {
    assert.equal((await api(X, 'get', `/api/v1/gamiyas/${gid}/chat`)).status, 404);
    assert.equal((await api(X, 'post', `/api/v1/gamiyas/${gid}/chat`, { body: 'مرحبا' })).status, 404);
    const hi = await api(B, 'post', `/api/v1/gamiyas/${gid}/chat`, { body: 'السلام عليكم، حوّلت قسطي.' });
    assert.equal(hi.status, 201);
    assert.equal(hi.body.reply, null);
    const rep = await api(C, 'post', `/api/v1/gamiyas/${gid}/chat`, { body: '@مساعد تقرير' });
    assert.match(rep.body.reply.body, /تقرير جمعية الحي/);
    assert.match(rep.body.reply.body, /متأخرون|لا يوجد متأخرون/);
    const st = await api(B, 'post', `/api/v1/gamiyas/${gid}/chat`, { body: '@مساعد حسابي' });
    assert.match(st.body.reply.body, /دفعت 0 SAR/);
    const help = await api(B, 'post', `/api/v1/gamiyas/${gid}/chat`, { body: '@مساعد ما رأيك في الطقس؟' });
    assert.match(help.body.reply.body, /تقرير/, 'no provider configured → help text, no invented facts');
    assert.equal((await api(B, 'post', `/api/v1/gamiyas/${gid}/chat`, { body: '@مساعد تذكير' })).body.reply.body, 'إرسال التذكير متاح لمنظم الجمعية.');
    const all = (await api(O, 'get', `/api/v1/gamiyas/${gid}/chat`)).body;
    const kinds = new Set(all.map((m: any) => m.kind));
    assert.ok(kinds.has('USER') && kinds.has('SYSTEM') && kinds.has('ASSISTANT'));
    assert.ok(all.some((m: any) => m.kind === 'SYSTEM' && /وأرفق الإيصال/.test(m.body)), 'declaration recorded');
    assert.ok(all.some((m: any) => m.kind === 'SYSTEM' && /تمت القرعة/.test(m.body)), 'draw recorded');
    assert.ok(all.some((m: any) => m.kind === 'ASSISTANT' && /تذكير/.test(m.body)), 'reminder posted');
    const after = (await api(O, 'get', `/api/v1/gamiyas/${gid}/chat?after=${all.at(-2).id}`)).body;
    assert.equal(after.length, 1);
    await assert.rejects(db.query(`DELETE FROM chat_messages`), /append-only/);
    await assert.rejects(db.query(`UPDATE settlement_events SET note='x'`), /append-only/);
    const r = (await api(B, 'get', `/api/v1/gamiyas/${gid}/assistant/report`)).body;
    assert.equal(r.report.cycles, 3);
    assert.equal(r.statement.paid, '0.00');
  });

  test('organizer reviews receipts; disputes where the organizer is a party go to platform reviewers', async () => {
    const sched = (await api(O, 'get', `/api/v1/gamiyas/${gid}/schedule`)).body;
    const people = new Map([[O.name, O], [B.name, B], [C.name, C]]);
    const declare = async (payer: Person, id: string) => {
      const f = await uploadFile(http, payer, gid, 'RECEIPT', PNG);
      return api(payer, 'post', `/api/v1/installments/${id}/declare-paid`, { methodKind: 'IBAN_SA', receiptFileId: f.fileId });
    };
    // (a) an installment between two non-organizers: organizer must review; rejection sends it back
    const third = sched.flatMap((cy: any) => cy.installments.map((i: any) => ({ ...i, recipient: cy.recipient })))
      .find((i: any) => i.payer !== O.name && i.recipient !== O.name && i.status !== 'AWAITING_ORGANIZER');
    const payer = people.get(third.payer)!;
    assert.equal((await declare(payer, third.installmentId)).body.status, 'AWAITING_ORGANIZER');
    const rej = await api(O, 'post', `/api/v1/installments/${third.installmentId}/organizer-reject`, { reason: 'الإيصال غير مقروء' });
    assert.notEqual(rej.body.status, 'AWAITING_ORGANIZER');
    assert.equal((await declare(payer, third.installmentId)).body.attempts, 2);
    const ev = (await api(O, 'get', `/api/v1/installments/${third.installmentId}`)).body.events.map((e: any) => e.event);
    assert.deepEqual(ev, ['DECLARED', 'ORGANIZER_REJECTED', 'REDECLARED']);

    // (b) the organizer is the recipient: no organizer step; a dispute is resolved by a platform reviewer, not the organizer
    const toOrg = sched.find((cy: any) => cy.recipient === O.name).installments.find((i: any) => i.status !== 'AWAITING_ORGANIZER' && i.status !== 'AWAITING_CONFIRMATION');
    const p2 = people.get(toOrg.payer)!;
    assert.equal((await declare(p2, toOrg.installmentId)).body.status, 'AWAITING_CONFIRMATION');
    const dis = await api(O, 'post', `/api/v1/installments/${toOrg.installmentId}/dispute`, { reason: 'المبلغ ناقص' });
    assert.equal(dis.body.status, 'DISPUTED');
    assert.equal((await api(O, 'post', `/api/v1/disputes/${dis.body.disputeId}/resolve`, { outcome: 'RECEIPT_VALID', note: 'أنا المنظم' })).status, 403);
    assert.equal((await api(p2, 'post', `/api/v1/disputes/${dis.body.disputeId}/resolve`, { outcome: 'RECEIPT_VALID', note: 'أنا الدافع' })).status, 403);
    const ADMIN = await login('مراجع المنصة', '+966500000900');
    const r = await api(ADMIN, 'post', `/api/v1/disputes/${dis.body.disputeId}/resolve`, { outcome: 'RECEIPT_VALID', note: 'الإيصال يطابق المبلغ' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'AWAITING_CONFIRMATION', 'the reviewer cannot mark it received; the recipient still confirms');
    assert.equal((await api(O, 'post', `/api/v1/installments/${toOrg.installmentId}/confirm-received`)).body.status, 'PAID');
    assert.ok((await api(B, 'get', `/api/v1/gamiyas/${gid}/chat`)).body.some((m: any) => /حُسم الاعتراض/.test(m.body)));
  });
});

describe('Sign in with Google + mobile registration', () => {
  test('first Google sign-in requires a verified mobile; then links; later signs in directly', async () => {
    const tok = await googleToken({ sub: 'g-123', email: 'reem@example.com', name: 'ريم' });
    const first = await http.post('/api/v1/auth/google').send({ idToken: tok });
    assert.equal(first.status, 200);
    assert.equal(first.body.needsPhone, true);
    assert.equal(first.body.accessToken, undefined, 'no session from Google alone');
    const R = await login('ريم', '+966500000331', first.body.linkToken);
    const me = (await api(R, 'get', '/api/v1/auth/me')).body;
    assert.deepEqual([me.googleLinked, me.email], [true, 'reem@example.com']);
    const again = await http.post('/api/v1/auth/google').send({ idToken: await googleToken({ sub: 'g-123', email: 'reem@example.com' }) });
    assert.equal(again.body.user.id, R.id);
    assert.ok(again.body.accessToken && again.body.refreshToken);
  });

  test('rejects wrong audience, unverified email, forged signature, and double-linking', async () => {
    assert.equal((await http.post('/api/v1/auth/google').send({ idToken: await googleToken({ sub: 'g-9' }, 'someone-else') })).body.error.code, 'GOOGLE_TOKEN_INVALID');
    assert.equal((await http.post('/api/v1/auth/google').send({ idToken: await googleToken({ sub: 'g-9', email_verified: false }) })).body.error.code, 'GOOGLE_EMAIL_UNVERIFIED');
    const { privateKey: other } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: 'g-9', email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer('https://accounts.google.com')
      .setAudience('test-client.apps.googleusercontent.com').setExpirationTime('5m').sign(other);
    assert.equal((await http.post('/api/v1/auth/google').send({ idToken: forged })).status, 401);
    const link = (await http.post('/api/v1/auth/google').send({ idToken: await googleToken({ sub: 'g-123' }) })).body;
    assert.ok(link.accessToken, 'already linked → direct sign-in');
    // a different Google account cannot hijack an already-linked mobile number
    const other2 = (await http.post('/api/v1/auth/google').send({ idToken: await googleToken({ sub: 'g-456' }) })).body.linkToken;
    const ip = '10.1.9.9';
    const req = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', ip).send({ phone: '+966500000331' });
    const v = await http.post('/api/v1/auth/otp/verify').set('X-Forwarded-For', ip).send({ phone: '+966500000331', code: req.body.devCode, linkToken: other2 });
    assert.equal(v.body.error.code, 'GOOGLE_ALREADY_LINKED');
    assert.equal((await http.post('/api/v1/auth/otp/verify').send({ phone: '+966500000331', code: '000000', linkToken: 'garbage.token.here' })).body.error.code, 'LINK_EXPIRED');
  });

  test('Egyptian and UAE mobiles are accepted for registration', async () => {
    for (const phone of ['+201012345678', '+971501234567']) {
      const r = await http.post('/api/v1/auth/otp/request').set('X-Forwarded-For', `10.1.8.${phone.length}`).send({ phone });
      assert.equal(r.status, 202, phone);
    }
  });
});
