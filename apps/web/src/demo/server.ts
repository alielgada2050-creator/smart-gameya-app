/**
 * In-browser demo server (demo build only). Mirrors apps/api's endpoints, response shapes and rules closely enough to try
 * every journey without a backend, and reuses the real business logic from packages/financial-core and ai-core:
 * schedule, tiers, verifiable lottery, priority ordering, transfer reference + matching, savings advisor.
 * State lives in this browser only (localStorage), so each visitor gets their own sandbox. No money, no real people.
 */
import { generateSchedule, validateConfig, type Frequency } from '../../../../packages/financial-core/src/schedule.ts';
import { classifyPot } from '../../../../packages/financial-core/src/tiers.ts';
import { formatMoney, parseMoney } from '../../../../packages/financial-core/src/money.ts';
import { COUNTRIES, METHODS, methodsFor, normalizeMethodValue, type Country } from '../../../../packages/financial-core/src/payout-methods.ts';
import { executeDraw, prepareDraw, selectionProbability, verifyDraw, type DrawRecord } from '../../../../packages/financial-core/src/lottery.ts';
import { isPermutation, suggestOrder } from '../../../../packages/financial-core/src/ordering.ts';
import { matchDeclaration, transferGuide, transferReference } from '../../../../packages/financial-core/src/transfer.ts';
import { monthlyEquivalent, SAVINGS_POLICY, savingsFacts } from '../../../../packages/financial-core/src/savings.ts';
import { narrate, type AdvisorFacts } from '../../../../packages/ai-core/src/advisor.ts';
import { PLEDGE_VERSION, pledgeClauses, pledgeHash, pledgeText, signatureMatches, type PledgeTerms } from '../../../../packages/financial-core/src/pledge.ts';
import { planCircle } from '../../../../packages/financial-core/src/planner.ts';
import { seed, type DB } from './seed.ts';

export class DemoError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const bad = (code: string, m = code) => new DemoError(400, code, m);
const conflict = (code: string, m = code) => new DemoError(409, code, m);
const forbidden = (m = 'forbidden') => new DemoError(403, 'FORBIDDEN', m);
const notFound = (what = 'resource') => new DemoError(404, 'NOT_FOUND', `${what} not found`);

const KEY = 'sg.demo.v3';
let db: DB;
export function load(): DB {
  try { const raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); return db; } } catch { /* storage unavailable */ }
  db = seed(); save(); return db;
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage unavailable: state lasts this tab */ } }
export function reset() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } db = seed(); save(); }
export const users = () => db.users;

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dec = (minor: bigint, cur: string) => formatMoney(minor, cur).split(' ')[0];
const tierAr: Record<string, string> = { SMALL: 'صغيرة', MEDIUM: 'متوسطة', LARGE: 'كبيرة' };
const user = (id: string) => db.users.find((u) => u.id === id)!;

// ---------- chat & notifications ----------
function post(gamiyaId: string, kind: 'USER' | 'SYSTEM' | 'ASSISTANT', body: string, senderUserId: string | null = null, refEntity: string | null = null, refId: string | null = null) {
  const m = { id: ++db.seq, gamiyaId, kind, body, senderUserId, refEntity, refId, at: now() };
  db.chat.push(m); return m;
}
function notify(userIds: string[], n: { gamiyaId?: string; kind: string; body: string }) {
  for (const u of new Set(userIds)) db.notifications.push({ id: ++db.seq, userId: u, gamiyaId: n.gamiyaId ?? null, kind: n.kind, body: n.body, at: now(), read: false });
}

// ---------- circles ----------
function membership(gamiyaId: string, userId: string) {
  const g = db.circles.find((c) => c.id === gamiyaId);
  const m = g && db.members.find((x) => x.gamiyaId === gamiyaId && x.userId === userId && x.status !== 'WITHDRAWN');
  if (!g || !m) throw notFound('gamiya');
  return { g, m };
}
const membersOf = (gamiyaId: string) => db.members.filter((m) => m.gamiyaId === gamiyaId && m.status !== 'WITHDRAWN');
const mstatus = (m: { status?: string }) => m.status ?? 'ACTIVE';
const manager = (gamiyaId: string) => membersOf(gamiyaId).find((m) => m.role === 'MANAGER')!;
function schedOf(g: DB['circles'][number]) {
  return generateSchedule({ members: g.memberCount, contribution: parseMoney(g.contribution, g.currency), currency: g.currency, frequency: g.frequency as Frequency, startDate: g.startDate });
}
function summary(g: DB['circles'][number], userId: string) {
  const m = db.members.find((x) => x.gamiyaId === g.id && x.userId === userId && x.status !== 'WITHDRAWN');
  const myCycle = m && db.cycles.find((c) => c.gamiyaId === g.id && c.recipientMemberId === m.id);
  return {
    id: g.id, name: g.name, currency: g.currency, country: g.country, tier: g.tier, platformApproval: g.platformApproval, frequency: g.frequency, contribution: g.contribution,
    memberCount: g.memberCount, joined: membersOf(g.id).length, startDate: g.startDate, status: g.status, category: g.category ?? 'OTHER',
    myRole: m?.role ?? null, myPayoutPosition: m?.payoutPosition ?? null, myMemberStatus: m ? mstatus(m) : null,
    potPerCycle: dec(parseMoney(g.contribution, g.currency) * BigInt(g.memberCount), g.currency), myPayoutDate: myCycle?.dueDate ?? null,
  };
}
function details(gamiyaId: string, userId: string) {
  const { g, m } = membership(gamiyaId, userId);
  const s = schedOf(g);
  const ms = [...membersOf(g.id)].sort((a, b) => (a.payoutPosition ?? 999) - (b.payoutPosition ?? 999) || a.joinedAt.localeCompare(b.joinedAt));
  return {
    ...summary(g, userId), myMemberId: m.id, platformReviewNote: g.platformReviewNote,
    notes: g.tier === 'LARGE' ? ms.filter((x) => x.role !== 'MANAGER').map((x) => {
      const n = db.notes.find((nn) => nn.memberId === x.id);
      return { memberId: x.id, status: n?.status ?? 'MISSING', reference: x.id === m.id || m.role === 'MANAGER' ? n?.reference ?? null : null };
    }) : null,
    graceDays: g.graceDays, orderingMethod: g.ordering, potPerCycle: dec(s.potPerCycle, g.currency), endDate: s.endDate, termsVersion: g.termsVersion ?? 1,
    members: ms.map((x) => ({ memberId: x.id, fullName: user(x.userId).fullName, role: x.role, payoutPosition: x.payoutPosition, status: mstatus(x),
      pledged: db.pledges.some((p) => p.userId === x.userId && p.gamiyaId === g.id && p.termsVersion === (g.termsVersion ?? 1)) })),
  };
}
function assess(input: any) {
  const country = COUNTRIES[input.country as Country];
  if (!country) throw bad('COUNTRY_NOT_SUPPORTED', 'unsupported country');
  const currency = country.currency;
  let contribution: bigint;
  try { contribution = parseMoney(String(input.contribution), currency); } catch { throw bad('INVALID_CIRCLE', 'invalid amount'); }
  const errors = validateConfig({ members: input.memberCount, contribution, currency, frequency: input.frequency, startDate: input.startDate, cycles: input.memberCount });
  if (errors.length) throw bad('INVALID_CIRCLE', errors.join('; '));
  const s = generateSchedule({ members: input.memberCount, contribution, currency, frequency: input.frequency, startDate: input.startDate });
  const t = classifyPot(s.potPerCycle, currency);
  if (!t.ok && t.reason === 'CURRENCY_NOT_ENABLED') throw bad('COUNTRY_NOT_ENABLED', `circles in ${input.country} are not enabled yet`);
  if (!t.ok) throw bad('ABOVE_MAXIMUM', `payout value is above the maximum ${dec(t.limits!.largeMax, currency)} ${currency}`);
  return { currency, contribution, schedule: s, tier: t };
}
function activate(g: DB['circles'][number], order: string[], method: string) {
  order.forEach((id, i) => { db.members.find((m) => m.id === id)!.payoutPosition = i + 1; });
  const s = schedOf(g);
  for (const cy of s.cycles) {
    const rec = db.members.find((m) => m.gamiyaId === g.id && m.payoutPosition === cy.payoutPosition)!;
    const cycle = { id: uuid(), gamiyaId: g.id, index: cy.index, dueDate: cy.dueDate, recipientMemberId: rec.id };
    db.cycles.push(cycle);
    for (const m of membersOf(g.id)) if (m.id !== rec.id) db.installments.push({ id: uuid(), cycleId: cycle.id, memberId: m.id, amountDue: g.contribution, s: null });
  }
  g.status = 'ACTIVE'; g.ordering = method;
}

// ---------- installments (mirrors EFFECTIVE_STATUS) ----------
function row(i: DB['installments'][number]) {
  const cy = db.cycles.find((c) => c.id === i.cycleId)!;
  const g = db.circles.find((c) => c.id === cy.gamiyaId)!;
  const payer = db.members.find((m) => m.id === i.memberId)!;
  const rcp = db.members.find((m) => m.id === cy.recipientMemberId)!;
  const mgr = manager(g.id);
  const needsOrganizer = mgr.userId !== payer.userId && mgr.userId !== rcp.userId;
  const s = i.s; const live = !!s && !s.voided;
  const t = today();
  const status = s?.confirmedAt ? 'PAID' : live && s!.disputed ? 'DISPUTED' : live && needsOrganizer && !s!.organizerApprovedAt ? 'AWAITING_ORGANIZER' : live ? 'AWAITING_CONFIRMATION'
    : addDays(cy.dueDate, g.graceDays) < t ? 'LATE' : cy.dueDate < t ? 'IN_GRACE' : cy.dueDate === t ? 'DUE' : 'SCHEDULED';
  return { i, cy, g, payer, rcp, mgr, needsOrganizer, status };
}
function view(r: ReturnType<typeof row>, me: string) {
  const s = r.i.s;
  return {
    installmentId: r.i.id, gamiyaId: r.g.id, gamiyaName: r.g.name, cycle: r.cy.index, dueDate: r.cy.dueDate, amount: r.i.amountDue, currency: r.g.currency, country: r.g.country,
    payer: user(r.payer.userId).fullName, recipient: user(r.rcp.userId).fullName,
    direction: r.payer.userId === me ? 'I_PAY' : r.rcp.userId === me ? 'I_RECEIVE' : 'I_ORGANIZE', status: r.status,
    reference: s?.reference ?? null, methodKind: s?.methodKind ?? null, receiptFileId: s?.receiptFileId ?? null, needsOrganizer: r.needsOrganizer, attempts: s?.attempts ?? 0,
    transferReference: transferReference(r.i.id), declaredAmount: s?.declaredAmount ?? null, transferDate: s?.transferDate ?? null, match: s?.match ?? null,
  };
}
function loadInst(id: string, me: string) {
  const i = db.installments.find((x) => x.id === id);
  if (!i) throw notFound('installment');
  const r = row(i);
  if (![r.payer.userId, r.rcp.userId, r.mgr.userId].includes(me)) throw notFound('installment');
  return r;
}
const money = (r: ReturnType<typeof row>) => `${r.i.amountDue} ${r.g.currency}`;

// ---------- assistant (same intents as the server, answered from the same data) ----------
function assistant(gamiyaId: string, me: string, text: string): string {
  const t = text.replace(/^@?(مساعد|assistant)\s*/i, '');
  const { g, m } = membership(gamiyaId, me);
  const rows = db.installments.map(row).filter((r) => r.g.id === gamiyaId);
  if (/(الترتيب|ترتيب|الأولوية|أولوية|اولوية|order|priority)/.test(t)) return orderLine(gamiyaId, me);
  if (/(اعتراض|نزاع|dispute)/.test(t)) {
    const open = rows.filter((r) => r.status === 'DISPUTED');
    return open.length ? `اعتراضات مفتوحة: ${open.map((r) => `الدورة ${r.cy.index} (${user(r.payer.userId).fullName} ← ${user(r.rcp.userId).fullName})`).join('، ')}.` : 'لا توجد اعتراضات مفتوحة.';
  }
  if (/(حسابي|دوري|mine)/.test(t)) {
    const mine = rows.filter((r) => r.payer.userId === me && r.status !== 'PAID');
    return `${m.payoutPosition ? `دورك في القبض: ${m.payoutPosition}. ` : 'لم يُحدَّد دورك بعد. '}عليك ${mine.length} أقساط غير مكتملة${mine[0] ? `، أقربها ${mine[0].cy.dueDate} بمبلغ ${money(mine[0])}` : ''}.`;
  }
  if (/(القادم|الموعد|موعد|next|due)/.test(t)) {
    const next = db.cycles.filter((c) => c.gamiyaId === gamiyaId && c.dueDate >= today()).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return next ? `الدورة القادمة رقم ${next.index} بتاريخ ${next.dueDate}، والمستلم ${user(db.members.find((x) => x.id === next.recipientMemberId)!.userId).fullName}.` : 'لا توجد دورات قادمة.';
  }
  if (/(تقرير|الحالة|report|status)/.test(t)) {
    const done = db.cycles.filter((c) => c.gamiyaId === gamiyaId && rows.filter((r) => r.cy.id === c.id).every((r) => r.status === 'PAID')).length;
    return `تقرير ${g.name}: اكتمل ${done} من ${g.memberCount} دورات، وتأكد ${rows.filter((r) => r.status === 'PAID').length} من ${rows.length} أقساط. متأخر: ${rows.filter((r) => r.status === 'LATE').length}. بانتظار تأكيد: ${rows.filter((r) => r.status === 'AWAITING_CONFIRMATION').length}.`;
  }
  return 'أستطيع: تقرير — الحالة العامة، القادم — موعد الدورة التالية، حسابي — دورك وأقساطك، الترتيب — حالة ترتيب القبض، اعتراضات — الاعتراضات المفتوحة.';
}

// ---------- ordering ----------
function orderState(gamiyaId: string, me: string) {
  const { g, m } = membership(gamiyaId, me);
  const isOrg = m.role === 'MANAGER';
  const ms = membersOf(gamiyaId).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const proposals = db.proposals.filter((p) => p.gamiyaId === gamiyaId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = proposals.find((p) => p.status === 'OPEN');
  const dates = schedOf(g).cycles.map((c) => c.dueDate);
  const votes = open ? db.votes.filter((v) => v.proposalId === open.id) : [];
  return {
    status: g.status, orderingMethod: g.ordering, memberCount: g.memberCount, isOrganizer: isOrg, myMemberId: m.id, lotteryStarted: !!db.lottery[gamiyaId], cycleDates: dates,
    requests: ms.map((x) => {
      const p = db.priority[x.id]; const mine = x.id === m.id;
      return { memberId: x.id, fullName: user(x.userId).fullName, declared: !!p, preference: p?.preference ?? 'NONE', neededBy: p?.neededBy ?? null,
        reason: mine || isOrg || p?.shareReason ? p?.reason ?? 'NONE' : null, shareReason: !!p?.shareReason, note: mine || isOrg ? p?.note ?? null : null };
    }),
    openProposal: open ? {
      id: open.id, mode: open.mode, aiAssisted: open.aiAssisted, rationale: open.rationale, createdAt: open.createdAt,
      order: open.order.map((id, i) => ({ position: i + 1, memberId: id, fullName: user(db.members.find((x) => x.id === id)!.userId).fullName, payoutDate: dates[i] })),
      votes: ms.map((x) => ({ memberId: x.id, fullName: user(x.userId).fullName, vote: votes.find((v) => v.memberId === x.id)?.vote ?? null })),
      approvals: votes.filter((v) => v.vote === 'APPROVE').length, needed: ms.length, myVote: votes.find((v) => v.memberId === m.id)?.vote ?? null,
    } : null,
    history: proposals.filter((p) => p.status !== 'OPEN').map((p) => ({ id: p.id, mode: p.mode, status: p.status, closedAt: p.closedAt })),
  };
}
function computeSuggestion(g: DB['circles'][number]) {
  return suggestOrder(g.id, membersOf(g.id).map((x) => ({ memberId: x.id, preference: db.priority[x.id]?.preference ?? 'NONE', neededBy: db.priority[x.id]?.neededBy ?? null })), schedOf(g).cycles.map((c) => c.dueDate));
}
function orderLine(gamiyaId: string, me: string) {
  const st = orderState(gamiyaId, me);
  if (st.status === 'ACTIVE' || st.status === 'COMPLETED') return 'ترتيب القبض معتمد. اكتب «@مساعد حسابي» لمعرفة دورك وموعده.';
  if (st.openProposal) { const w = st.openProposal.votes.filter((v) => !v.vote).map((v) => v.fullName); return `اقتراح ترتيب مفتوح: وافق ${st.openProposal.approvals} من ${st.openProposal.needed}.${w.length ? ` بانتظار: ${w.join('، ')}.` : ''}`; }
  const p = st.requests.filter((r) => !r.declared).map((r) => r.fullName);
  return `لا يوجد اقتراح ترتيب بعد. يمكن اختيار القرعة، أو ترتيب بالاتفاق، أو بالأولوية مع اقتراح المساعد.${p.length ? ` لم يعلن أولويته: ${p.join('، ')}.` : ''}`;
}
function maybeAdopt(gamiyaId: string, proposalId: string) {
  const ms = membersOf(gamiyaId);
  const approvals = db.votes.filter((v) => v.proposalId === proposalId && v.vote === 'APPROVE').length;
  if (approvals < ms.length) return 'OPEN';
  const p = db.proposals.find((x) => x.id === proposalId)!;
  p.status = 'ADOPTED'; p.closedAt = now();
  const g = db.circles.find((c) => c.id === gamiyaId)!;
  activate(g, p.order, p.mode === 'AGREED' ? 'CONSENSUS' : 'PREFERENCE');
  post(gamiyaId, 'SYSTEM', `وافق جميع الأعضاء. اعتُمد ترتيب القبض وبدأت الجمعية: ${p.order.map((id, i) => `${i + 1}. ${user(db.members.find((x) => x.id === id)!.userId).fullName}`).join('، ')}.`, null, 'order_proposal', proposalId);
  notify(ms.map((x) => x.userId), { gamiyaId, kind: 'INFO', body: 'اعتُمد ترتيب القبض بموافقة الجميع وبدأت الجمعية' });
  return 'ADOPTED';
}

// ---------- router ----------
type Handler = (ctx: { me: string; body: any; params: string[]; query: URLSearchParams }) => unknown | Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, pattern: string, h: Handler) => routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), h]);
const PUBLIC = /^\/(config\/public|agreements\/current|auth\/otp\/|auth\/refresh|auth\/logout|gamiyas\/preview|payout-methods\/directory)/;

export async function handle(method: string, path: string, query: URLSearchParams, body: any, token: string | null): Promise<{ status: number; data: unknown }> {
  if (!db) load();
  const me = token?.startsWith('demo-at.') ? token.slice(8) : '';
  if (!PUBLIC.test(path) && !db.users.some((u) => u.id === me)) return { status: 401, data: { error: { code: 'UNAUTHORIZED', message: 'sign in' } } };
  for (const [m, re, h] of routes) {
    const hit = m === method && re.exec(path);
    if (!hit) continue;
    try {
      const data = await h({ me, body: body ?? {}, params: hit.slice(1).map(decodeURIComponent), query });
      save();
      return { status: method === 'POST' && /^\/(gamiyas|gamiyas\/[^/]+\/(invitations|chat|files|order\/proposals)|gamiyas\/[^/]+\/lottery\/prepare)$/.test(path) ? 201 : 200, data };
    } catch (e) {
      if (e instanceof DemoError) return { status: e.status, data: { error: { code: e.code, message: e.message } } };
      return { status: 500, data: { error: { code: 'DEMO_ERROR', message: String((e as Error).message) } } };
    }
  }
  return { status: 404, data: { error: { code: 'NOT_FOUND', message: `${method} ${path} is not part of the demo` } } };
}

/** Files (receipts, notes) are kept as data URLs in this browser. */
export function fileBlob(id: string, me: string): Blob {
  const f = db.files.find((x) => x.id === id);
  if (!f) throw notFound('file');
  const allowed = f.ownerId === me || db.members.some((m) => m.gamiyaId === f.gamiyaId && m.userId === me) || user(me).platformRole !== 'NONE';
  if (!allowed) throw notFound('file');
  const [head, b64] = f.dataUrl.split(',');
  const bin = head.includes('base64') ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(b64));
  return new Blob([bin], { type: f.mime });
}
export async function upload(gamiyaId: string, me: string, purpose: string, file: File) {
  membership(gamiyaId, me);
  if (!['RECEIPT', 'PROMISSORY_NOTE'].includes(purpose)) throw bad('PURPOSE');
  if (file.size > 5 * 1024 * 1024) throw new DemoError(413, 'TOO_LARGE', 'max 5 MB');
  if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.type)) throw new DemoError(415, 'UNSUPPORTED_TYPE', 'PNG, JPEG, WEBP or PDF');
  const buf = new Uint8Array(await file.arrayBuffer());
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), (b) => b.toString(16).padStart(2, '0')).join('');
  let s = ''; for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
  const f = { id: uuid(), ownerId: me, gamiyaId, purpose, mime: file.type, sha256: sha, dataUrl: `data:${file.type};base64,${btoa(s)}` };
  db.files.push(f); save();
  return { fileId: f.id, mime: f.mime, sizeBytes: buf.length, sha256: sha };
}

// auth
on('GET', '/config/public', () => ({ googleClientId: null, circleCountries: ['SA', 'EG', 'AE'], model: 'A', demo: true }));
on('GET', '/agreements/current', () => db.agreement);
on('POST', '/auth/otp/request', ({ body }) => {
  if (!/^\+(9665\d{8}|201[0125]\d{8}|9715\d{8})$/.test(body.phone ?? '')) throw bad('INVALID_PHONE', 'invalid phone');
  const code = String(Math.floor(100000 + Math.random() * 900000)); db.otp[body.phone] = code;
  return { sent: true, expiresInSeconds: 300, devCode: code };
});
on('POST', '/auth/otp/verify', ({ body }) => {
  if (db.otp[body.phone] !== body.code) throw new DemoError(401, 'INVALID_CODE', 'wrong or expired code');
  delete db.otp[body.phone];
  let u = db.users.find((x) => x.phone === body.phone);
  if (!u) { u = { id: uuid(), phone: body.phone, fullName: (body.fullName || 'عضو جديد').slice(0, 100), platformRole: 'NONE' }; db.users.push(u); }
  else if (body.fullName && !db.seeded.includes(u.id)) u.fullName = body.fullName;
  return tokens(u.id);
});
export function tokens(userId: string) {
  const u = user(userId);
  return { accessToken: `demo-at.${userId}`, tokenType: 'Bearer', expiresInSeconds: 900, refreshToken: `demo-rt.${userId}`, refreshExpiresInSeconds: 2592000, user: { id: u.id, fullName: u.fullName, kycStatus: 'UNVERIFIED' } };
}
on('POST', '/auth/refresh', ({ body }) => {
  const id = String(body.refreshToken ?? '').replace(/^demo-rt\./, '');
  if (!db.users.some((u) => u.id === id)) throw new DemoError(401, 'INVALID_REFRESH', 'sign in again');
  const { user: _u, ...t } = tokens(id); return t;
});
on('POST', '/auth/logout', () => ({ loggedOut: true }));
on('GET', '/auth/me', ({ me }) => { const u = user(me); return { id: u.id, fullName: u.fullName, phone: u.phone, email: null, platformRole: u.platformRole, googleLinked: false, kycStatus: 'UNVERIFIED' }; });

// circles
on('POST', '/gamiyas/preview', ({ body }) => {
  const { currency, schedule: s, tier } = assess(body);
  if (!tier.ok) throw bad('INVALID_CIRCLE');
  return { currency, tier: tier.tier, requiresPlatformApproval: tier.requiresPlatformApproval, requiresPromissoryNotes: tier.requiresPromissoryNotes,
    tierLimits: { smallMax: dec(tier.limits.smallMax, currency), mediumMax: dec(tier.limits.mediumMax, currency), largeMax: dec(tier.limits.largeMax, currency) },
    potPerCycle: dec(s.potPerCycle, currency), totalVolume: dec(s.totalVolume, currency), endDate: s.endDate, cycles: s.cycles.map((c) => ({ cycle: c.index, dueDate: c.dueDate })) };
});
on('GET', '/gamiyas', ({ me }) => db.circles.filter((g) => db.members.some((m) => m.gamiyaId === g.id && m.userId === me)).reverse().map((g) => summary(g, me)));
on('POST', '/gamiyas', ({ me, body }) => {
  if (!body.name || String(body.name).trim().length < 2) throw bad('INVALID_NAME', 'name is required');
  const a = assess(body);
  if (!a.tier.ok) throw bad('INVALID_CIRCLE');
  const g = { id: uuid(), name: String(body.name).trim(), currency: a.currency, country: body.country, frequency: body.frequency, contribution: dec(a.contribution, a.currency),
    memberCount: body.memberCount, startDate: body.startDate, graceDays: body.graceDays ?? 3, status: 'RECRUITING', tier: a.tier.tier,
    platformApproval: a.tier.requiresPlatformApproval ? 'AWAITING_NOTES' : 'NOT_REQUIRED', platformReviewNote: null, ordering: 'LOTTERY', createdAt: now(),
    category: body.category ?? 'OTHER', termsVersion: 1 };
  signPledge(me, g.id, pledgeTerms(g, user(me).fullName, user(me).fullName), body.pledge);
  db.circles.push(g);
  post(g.id, 'SYSTEM', `أُنشئت الجمعية (${tierAr[g.tier]}). القبض لكل دورة ${dec(a.schedule.potPerCycle, a.currency)} ${a.currency}.`, null, 'gamiya', g.id);
  db.members.push({ id: uuid(), gamiyaId: g.id, userId: me, role: 'MANAGER', payoutPosition: null, joinedAt: now(), status: 'ACTIVE' });
  return details(g.id, me);
});
on('GET', '/gamiyas/:id', ({ me, params }) => details(params[0], me));
on('POST', '/gamiyas/:id/invitations', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the organizer can invite');
  if (g.status !== 'RECRUITING') throw conflict('NOT_RECRUITING', 'circle is not accepting members');
  const code = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[b % 56]).join('');
  db.invitations.push({ code, gamiyaId: g.id, maxUses: body.maxUses ?? g.memberCount - 1, uses: 0, expiresAt: new Date(Date.now() + (body.expiresInHours ?? 72) * 3600e3).toISOString() });
  return { code, maxUses: body.maxUses ?? g.memberCount - 1, expiresInHours: body.expiresInHours ?? 72 };
});
on('POST', '/invitations/:code/accept', ({ me, params, body }) => {
  const inv = db.invitations.find((x) => x.code === params[0]);
  if (!inv || inv.uses >= inv.maxUses || inv.expiresAt < now()) throw notFound('invitation');
  const g = db.circles.find((c) => c.id === inv.gamiyaId)!;
  if (g.status !== 'RECRUITING') throw conflict('NOT_RECRUITING', 'circle is not accepting members');
  const prev = db.members.find((m) => m.gamiyaId === g.id && m.userId === me);
  if (prev && prev.status !== 'WITHDRAWN') throw conflict('ALREADY_MEMBER', 'you are already a member of this circle');
  const count = membersOf(g.id).length;
  if (count >= g.memberCount) throw conflict('CIRCLE_FULL', 'circle is full');
  signPledge(me, g.id, pledgeTerms(g, user(manager(g.id).userId).fullName, user(me).fullName), body.pledge);
  if (prev) Object.assign(prev, { status: 'ACTIVE', joinedAt: now(), payoutPosition: null });
  else db.members.push({ id: uuid(), gamiyaId: g.id, userId: me, role: 'MEMBER', payoutPosition: null, joinedAt: now(), status: 'ACTIVE' });
  for (const d of db.directInvites) if (d.gamiyaId === g.id && d.phone === user(me).phone && d.status === 'PENDING') d.status = 'ACCEPTED';
  inv.uses++;
  post(g.id, 'SYSTEM', `انضم ${user(me).fullName} إلى الجمعية ووقّع إقرار وتعهّد السداد.`, null, 'member', me);
  if (count + 1 === g.memberCount) {
    g.status = 'LOCKED';
    post(g.id, 'SYSTEM', g.tier === 'LARGE' ? 'اكتمل العدد. جمعية كبيرة: على كل عضو رفع سند لأمر لصالح المنظم، ثم يطلب المنظم اعتماد إدارة المنصة قبل القرعة.' : 'اكتمل العدد. يمكن للمنظم تجهيز القرعة الآن.', null, 'gamiya', g.id);
  }
  return details(g.id, me);
});

// ---------- pledge, editing, membership (mirrors apps/api/src/gamiyas/membership.ts) ----------
type G = DB['circles'][number];
function pledgeTerms(g: Pick<G, 'name' | 'currency' | 'contribution' | 'memberCount' | 'frequency' | 'startDate'> & { termsVersion?: number }, organizerName: string, memberName: string): PledgeTerms {
  const contribution = parseMoney(String(g.contribution), g.currency);
  const s = generateSchedule({ members: g.memberCount, contribution, currency: g.currency, frequency: g.frequency as Frequency, startDate: g.startDate });
  return { circleName: g.name, organizerName, memberName, currency: g.currency, contribution: dec(contribution, g.currency), memberCount: g.memberCount,
    frequency: g.frequency as PledgeTerms['frequency'], installments: g.memberCount - 1, startDate: g.startDate, endDate: s.endDate,
    potPerCycle: dec(s.potPerCycle, g.currency), totalCommitment: dec(contribution * BigInt(g.memberCount - 1), g.currency), termsVersion: g.termsVersion ?? 1 };
}
const pledgeView = (t: PledgeTerms) => ({ pledgeVersion: PLEDGE_VERSION, terms: t, clauses: pledgeClauses(t), text: pledgeText(t), textSha256: pledgeHash(t) });
function signPledge(userId: string, gamiyaId: string, t: PledgeTerms, p: any) {
  if (!p) throw bad('PLEDGE_REQUIRED', 'read and sign the payment pledge first');
  if (p.textSha256 !== pledgeHash(t)) throw conflict('PLEDGE_OUTDATED', 'the circle terms changed; read the pledge again');
  if (!signatureMatches(String(p.typedName ?? ''), t.memberName)) throw bad('SIGNATURE_MISMATCH', 'type your full name exactly as registered');
  if (db.pledges.some((x) => x.userId === userId && x.gamiyaId === gamiyaId && x.termsVersion === t.termsVersion)) return;
  db.pledges.push({ id: uuid(), userId, gamiyaId, termsVersion: t.termsVersion, pledgeVersion: PLEDGE_VERSION, textSha256: pledgeHash(t), typedName: String(p.typedName).trim(), terms: t, signedAt: now() });
}
function assertChangeable(g: G) {
  if (!['RECRUITING', 'LOCKED'].includes(g.status)) throw conflict('ALREADY_STARTED', 'the circle has started; its terms can no longer change');
  if (db.lottery[g.id]) throw conflict('LOTTERY_PREPARED', 'a draw is already prepared for this circle');
  if (db.proposals.some((p) => p.gamiyaId === g.id && p.status === 'OPEN')) throw conflict('PROPOSAL_OPEN', 'an order proposal is open; withdraw it first');
}
function settleStatus(g: G) {
  const ms = membersOf(g.id);
  const next = ms.length === g.memberCount && ms.every((m) => mstatus(m) === 'ACTIVE') ? 'LOCKED' : 'RECRUITING';
  if (next !== g.status) { g.status = next; if (next === 'LOCKED') post(g.id, 'SYSTEM', 'اكتمل العدد ووقّع الجميع على الشروط الحالية. يمكن ترتيب القبض أو تجهيز القرعة الآن.', null, 'gamiya', g.id); }
}
function merged(g: G, b: any) {
  return { name: b.name ?? g.name, category: b.category ?? g.category ?? 'OTHER', contribution: b.contribution ?? g.contribution, memberCount: b.memberCount ?? g.memberCount,
    frequency: b.frequency ?? g.frequency, startDate: b.startDate ?? g.startDate };
}
const moneyChanged = (g: G, n: ReturnType<typeof merged>) => parseMoney(String(n.contribution), g.currency) !== parseMoney(g.contribution, g.currency)
  || n.memberCount !== g.memberCount || n.frequency !== g.frequency || n.startDate !== g.startDate;

on('POST', '/gamiyas/pledge-preview', ({ me, body }) => {
  const a = assess(body);
  return pledgeView(pledgeTerms({ name: String(body.name ?? ''), currency: a.currency, contribution: dec(a.contribution, a.currency), memberCount: body.memberCount, frequency: body.frequency, startDate: body.startDate }, user(me).fullName, user(me).fullName));
});
on('GET', '/gamiyas/:id/pledge', ({ me, params }) => {
  const { g } = membership(params[0], me);
  const signed = db.pledges.find((p) => p.userId === me && p.gamiyaId === g.id && p.termsVersion === (g.termsVersion ?? 1));
  return { ...pledgeView(pledgeTerms(g, user(manager(g.id).userId).fullName, user(me).fullName)), signedAt: signed?.signedAt ?? null };
});
on('GET', '/invitations/:code', ({ me, params }) => {
  const inv = db.invitations.find((x) => x.code === params[0]);
  const g = inv && db.circles.find((c) => c.id === inv.gamiyaId);
  if (!inv || !g || inv.uses >= inv.maxUses || inv.expiresAt < now() || g.status !== 'RECRUITING') throw notFound('invitation');
  const t = pledgeTerms(g, user(manager(g.id).userId).fullName, user(me).fullName);
  const mine = db.members.find((m) => m.gamiyaId === g.id && m.userId === me);
  return {
    circle: { name: g.name, organizerName: t.organizerName, category: g.category ?? 'OTHER', tier: g.tier, currency: g.currency, contribution: t.contribution, memberCount: g.memberCount,
      joined: membersOf(g.id).length, frequency: g.frequency, startDate: g.startDate, endDate: t.endDate, potPerCycle: t.potPerCycle },
    alreadyMember: !!mine && mine.status !== 'WITHDRAWN', pledge: pledgeView(t),
  };
});
on('POST', '/gamiyas/:id/edit/preview', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the circle manager can do this');
  const n = merged(g, body);
  const a = assess({ ...n, country: g.country });
  const changed = moneyChanged(g, n);
  const t = pledgeTerms({ ...n, currency: g.currency, termsVersion: (g.termsVersion ?? 1) + (changed ? 1 : 0) }, user(me).fullName, user(me).fullName);
  return { moneyChanged: changed, seatsTaken: membersOf(g.id).length, tier: a.tier.ok ? a.tier.tier : null, membersToReconfirm: changed ? membersOf(g.id).length - 1 : 0,
    requiresPlatformApproval: a.tier.ok ? a.tier.requiresPlatformApproval : false, pledge: changed ? pledgeView(t) : null, terms: t };
});
on('POST', '/gamiyas/:id/edit', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the circle manager can do this');
  assertChangeable(g);
  const n = merged(g, body);
  const a = assess({ ...n, country: g.country });
  if (!a.tier.ok) throw bad('INVALID_CIRCLE');
  if (n.startDate <= today()) throw bad('INVALID_CIRCLE', 'start date must be in the future');
  const taken = membersOf(g.id).length;
  if (n.memberCount < taken) throw conflict('BELOW_JOINED', `${taken} members have already joined; remove members first or keep at least ${taken}`);
  const changed = moneyChanged(g, n);
  const changes: string[] = [];
  if (n.name !== g.name) changes.push(`الاسم: «${n.name}»`);
  if (n.category !== (g.category ?? 'OTHER')) changes.push('نوع الجمعية');
  if (parseMoney(String(n.contribution), g.currency) !== parseMoney(g.contribution, g.currency)) changes.push(`القسط: ${n.contribution} ${g.currency}`);
  if (n.memberCount !== g.memberCount) changes.push(`عدد الأعضاء: ${n.memberCount}`);
  if (n.frequency !== g.frequency) changes.push('دورية الدفع');
  if (n.startDate !== g.startDate) changes.push(`تاريخ البدء: ${n.startDate}`);
  if (!changes.length) return details(g.id, me);
  const version = (g.termsVersion ?? 1) + (changed ? 1 : 0);
  if (changed) signPledge(me, g.id, pledgeTerms({ ...n, currency: g.currency, termsVersion: version }, user(me).fullName, user(me).fullName), body.pledge);
  Object.assign(g, { name: n.name, category: n.category, contribution: dec(a.contribution, g.currency), memberCount: n.memberCount, frequency: n.frequency, startDate: n.startDate,
    tier: a.tier.tier, termsVersion: version,
    platformApproval: a.tier.requiresPlatformApproval ? (changed || g.tier !== 'LARGE' ? 'AWAITING_NOTES' : g.platformApproval) : 'NOT_REQUIRED' });
  if (changed) {
    for (const x of membersOf(g.id)) if (x.role !== 'MANAGER' && mstatus(x) === 'ACTIVE') x.status = 'PENDING_APPROVAL';
    for (const nt of db.notes) if (nt.gamiyaId === g.id) nt.status = 'REJECTED';
  }
  post(g.id, 'SYSTEM', `عدّل المنظم الجمعية: ${changes.join('، ')}.` + (changed ? ' تغيّرت الشروط المالية: على كل عضو مراجعة الشروط الجديدة وتوقيع إقرار السداد مرة أخرى، أو الانسحاب دون أي التزام.' : ''), null, 'gamiya', g.id);
  if (changed) notify(membersOf(g.id).filter((x) => mstatus(x) === 'PENDING_APPROVAL').map((x) => x.userId), { gamiyaId: g.id, kind: 'ACTION_NEEDED', body: `تغيّرت شروط «${g.name}»: راجعها ووقّع من جديد` });
  settleStatus(g);
  return details(g.id, me);
});
on('POST', '/gamiyas/:id/reconfirm', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (mstatus(m) !== 'PENDING_APPROVAL') throw conflict('NOTHING_TO_CONFIRM', 'you already agreed to the current terms');
  signPledge(me, g.id, pledgeTerms(g, user(manager(g.id).userId).fullName, user(me).fullName), body.pledge);
  m.status = 'ACTIVE';
  post(g.id, 'SYSTEM', `وافق ${user(me).fullName} على الشروط الجديدة ووقّع إقرار السداد.`, null, 'member', me);
  settleStatus(g);
  return details(g.id, me);
});
function withdraw(g: G, x: DB['members'][number]) { x.status = 'WITHDRAWN'; x.payoutPosition = null; delete db.priority[x.id]; settleStatus(g); }
on('POST', '/gamiyas/:id/leave', ({ me, params }) => {
  const { g, m } = membership(params[0], me);
  if (m.role === 'MANAGER') throw forbidden('the organizer cannot leave their own circle');
  assertChangeable(g);
  withdraw(g, m);
  post(g.id, 'SYSTEM', `انسحب ${user(me).fullName} من الجمعية قبل بدئها، ولا التزام عليه.`, null, 'member', me);
  notify([manager(g.id).userId], { gamiyaId: g.id, kind: 'INFO', body: `انسحب ${user(me).fullName} من «${g.name}»` });
  return { left: true };
});
on('POST', '/gamiyas/:id/members/:memberId/remove', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the circle manager can do this');
  assertChangeable(g);
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 3) throw bad('VALIDATION', 'reason is required');
  const x = membersOf(g.id).find((y) => y.id === params[1]);
  if (!x) throw notFound('member');
  if (x.role === 'MANAGER') throw bad('CANNOT_REMOVE_ORGANIZER', 'the organizer cannot be removed');
  withdraw(g, x);
  post(g.id, 'SYSTEM', `أزال المنظم ${user(x.userId).fullName} من الجمعية قبل بدئها. السبب: ${reason}`, null, 'member', x.userId);
  notify([x.userId], { gamiyaId: g.id, kind: 'INFO', body: `أُزلت من «${g.name}» قبل بدئها: ${reason}` });
  return details(g.id, me);
});
on('GET', '/me/pledges', ({ me }) => db.pledges.filter((p) => p.userId === me).sort((a, b) => b.signedAt.localeCompare(a.signedAt)).map((p) => ({
  id: p.id, gamiyaId: p.gamiyaId, circleName: db.circles.find((c) => c.id === p.gamiyaId)?.name ?? '', termsVersion: p.termsVersion, pledgeVersion: p.pledgeVersion,
  textSha256: p.textSha256, typedName: p.typedName, signedAt: p.signedAt, totalCommitment: p.terms.totalCommitment, currency: p.terms.currency })));

// ---------- direct invitations (mirrors apps/api/src/gamiyas/direct.ts) ----------
on('GET', '/gamiyas/:id/invite-suggestions', ({ me, params }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the circle manager can do this');
  const seen = new Map<string, any>();
  for (const mine of db.members.filter((x) => x.userId === me && x.status !== 'WITHDRAWN' && x.gamiyaId !== g.id)) {
    for (const o of membersOf(mine.gamiyaId)) {
      if (o.userId === me || seen.has(o.userId) || membersOf(g.id).some((x) => x.userId === o.userId)) continue;
      const u = user(o.userId);
      seen.set(o.userId, { userId: u.id, fullName: u.fullName, phone: u.phone, phoneLast4: u.phone.slice(-4), via: db.circles.find((c) => c.id === mine.gamiyaId)!.name,
        invited: db.directInvites.find((d) => d.gamiyaId === g.id && d.phone === u.phone)?.status ?? null });
    }
  }
  return [...seen.values()];
});
on('POST', '/gamiyas/:id/invitations/direct', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the circle manager can do this');
  if (g.status !== 'RECRUITING') throw conflict('NOT_RECRUITING', 'circle is not accepting members');
  const phones: string[] = [...new Set<string>(body.phones ?? [])];
  if (!phones.length || phones.some((p) => !/^(\+9665\d{8}|\+201[0125]\d{8}|\+9715\d{8})$/.test(p))) throw bad('VALIDATION', 'phones must be E.164 mobile numbers');
  const code = 'DI' + uuid().replace(/-/g, '').slice(0, 10);
  db.invitations.push({ code, gamiyaId: g.id, maxUses: phones.length, uses: 0, expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() });
  const notified: any[] = [], toShare: string[] = [], skipped: any[] = [];
  for (const p of phones) {
    const u = db.users.find((x) => x.phone === p);
    if (u?.id === me) { skipped.push({ phone: p, reason: 'SELF' }); continue; }
    if (u && membersOf(g.id).some((x) => x.userId === u.id)) { skipped.push({ phone: p, reason: 'ALREADY_MEMBER' }); continue; }
    db.directInvites = db.directInvites.filter((d) => !(d.gamiyaId === g.id && d.phone === p));
    db.directInvites.push({ id: uuid(), gamiyaId: g.id, code, phone: p, invitedBy: me, status: 'PENDING', createdAt: now() });
    if (u) { notify([u.id], { gamiyaId: g.id, kind: 'ACTION_NEEDED', body: `${user(me).fullName} يدعوك للانضمام إلى «${g.name}». افتح «دعوات لك» لمراجعة الشروط.` }); notified.push({ phone: p, fullName: u.fullName }); }
    else toShare.push(p);
  }
  if (notified.length) post(g.id, 'SYSTEM', `دعا المنظم ${notified.length} أشخاص مباشرة: ${notified.map((n) => n.fullName).join('، ')}.`, null, 'gamiya', g.id);
  return { code, notified, toShare, skipped, seatsLeft: Math.max(0, g.memberCount - membersOf(g.id).length) };
});
on('GET', '/me/invitations', ({ me }) => {
  const phone = user(me).phone;
  return db.directInvites.filter((d) => d.status === 'PENDING' && d.phone === phone).flatMap((d) => {
    const g = db.circles.find((c) => c.id === d.gamiyaId)!;
    const inv = db.invitations.find((i) => i.code === d.code);
    if (g.status !== 'RECRUITING' || !inv || inv.uses >= inv.maxUses || membersOf(g.id).some((x) => x.userId === me)) return [];
    return [{ id: d.id, code: d.code, gamiyaId: g.id, name: g.name, category: g.category ?? 'OTHER', currency: g.currency, contribution: g.contribution, memberCount: g.memberCount,
      frequency: g.frequency, startDate: g.startDate, organizerName: user(d.invitedBy).fullName, invitedAt: d.createdAt }];
  });
});
on('POST', '/me/invitations/:id/decline', ({ me, params }) => {
  const d = db.directInvites.find((x) => x.id === params[0] && x.phone === user(me).phone && x.status === 'PENDING');
  if (!d) throw notFound('invitation');
  d.status = 'DECLINED';
  notify([d.invitedBy], { gamiyaId: d.gamiyaId, kind: 'INFO', body: `اعتذر ${user(me).fullName} عن الدعوة.` });
  return { declined: true };
});

// ---------- goals and the circle planner (mirrors apps/api/src/goals/goals.ts) ----------
function goalView(gl: DB['goals'][number]) {
  const g = gl.gamiyaId ? db.circles.find((c) => c.id === gl.gamiyaId) : null;
  const m = g && db.members.find((x) => x.gamiyaId === g.id && x.userId === gl.userId && x.status !== 'WITHDRAWN');
  const pot = g ? Number(g.contribution) * g.memberCount : null;
  const payout = m ? db.cycles.find((c) => c.gamiyaId === g!.id && c.recipientMemberId === m.id)?.dueDate ?? null : null;
  const paid = m ? db.installments.filter((i) => i.memberId === m.id && i.s?.confirmedAt).reduce((a, i) => a + Number(i.amountDue), 0) : 0;
  return { id: gl.id, category: gl.category, title: gl.title, targetAmount: gl.targetAmount, currency: gl.currency, targetDate: gl.targetDate, status: gl.status,
    circle: g ? { id: g.id, name: g.name, status: g.status, pot: pot != null ? pot.toFixed(2) : null, myPayoutDate: payout, paid: paid.toFixed(2),
      coversTarget: pot != null ? pot >= Number(gl.targetAmount) : null, onTime: payout && gl.targetDate ? payout <= gl.targetDate : null } : null };
}
const myGoals = (me: string) => db.goals.filter((x) => x.userId === me && x.status !== 'ARCHIVED').map(goalView);
function assertGoalCircle(me: string, gamiyaId: string | null | undefined) { if (gamiyaId && !db.members.some((m) => m.gamiyaId === gamiyaId && m.userId === me && m.status !== 'WITHDRAWN')) throw notFound('gamiya'); }
on('GET', '/me/goals', ({ me }) => myGoals(me));
on('POST', '/me/goals', ({ me, body }) => {
  assertGoalCircle(me, body.gamiyaId);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(String(body.targetAmount ?? ''))) throw bad('VALIDATION', 'targetAmount must be a decimal string');
  const gl = { id: uuid(), userId: me, category: body.category ?? 'OTHER', title: String(body.title ?? '').trim() || 'هدف', targetAmount: Number(body.targetAmount).toFixed(2), currency: body.currency ?? 'SAR',
    targetDate: body.targetDate ?? null, gamiyaId: body.gamiyaId ?? null, status: 'ACTIVE', createdAt: now() };
  db.goals.push(gl);
  return goalView(gl);
});
on('POST', '/me/goals/:id', ({ me, params, body }) => {
  const gl = db.goals.find((x) => x.id === params[0] && x.userId === me);
  if (!gl) throw notFound('goal');
  assertGoalCircle(me, body.gamiyaId);
  for (const k of ['category', 'title', 'targetDate', 'gamiyaId', 'status'] as const) if (body[k] !== undefined) (gl as any)[k] = body[k];
  if (body.targetAmount !== undefined) gl.targetAmount = Number(body.targetAmount).toFixed(2);
  return goalView(gl);
});
on('POST', '/me/goals/:id/remove', ({ me, params }) => {
  const gl = db.goals.find((x) => x.id === params[0] && x.userId === me);
  if (!gl) throw notFound('goal');
  gl.status = 'ARCHIVED';
  return goalView(gl);
});
on('POST', '/ai/circle-plan', ({ body }) => {
  const r = planCircle({ targetAmount: Number(body.targetAmount), neededBy: body.neededBy, people: body.people, monthlyBudget: body.monthlyBudget, frequency: body.frequency ?? 'MONTHLY', today: today(), maxPot: 100000 });
  const fmt = (n: number) => n.toLocaleString('en-US');
  return {
    today: today(), reason: r.reason ?? null,
    plans: r.plans.map((p) => ({ ...p, category: body.category ?? 'OTHER',
      explanation: `${p.members} أعضاء × ${fmt(p.contribution)} ريال ${p.frequency === 'WEEKLY' ? 'كل جمعة' : 'شهرياً'} = ${fmt(p.pot)} ريال يقبضها كل عضو في دوره.` })),
    note: 'كل الأعضاء يدفعون القسط نفسه ويقبضون المبلغ نفسه أياً كان الدور: لا رسوم على الأدوار الأولى ولا خصومات على الأخيرة.', source: 'rules', policyVersion: 'sg-planner/1.0',
  };
});

// lottery (real algorithm: commit–reveal, HMAC-SHA256 Fisher–Yates, maker–checker)
on('GET', '/gamiyas/:id/lottery', ({ me, params }) => {
  membership(params[0], me);
  const L = db.lottery[params[0]];
  if (!L) return { state: 'NOT_PREPARED' };
  if (!L.result) return { state: 'PREPARED', sessionId: L.sessionId, commitment: L.prep.commitment, algorithmVersion: L.prep.algorithmVersion, approvals: L.approvals.length, preparedByMe: L.preparedBy === me, approvedByMe: L.approvals.includes(me) };
  return { state: 'EXECUTED', record: { ...L.result, howToVerify: 'sha256(revealedSeedHex) must equal commitment; recompute order with sg-lottery/1.0.0 (packages/financial-core/src/lottery.ts verifyDraw)' }, verification: verifyDraw(L.result) };
});
const candidates = (gamiyaId: string) => membersOf(gamiyaId).map((m) => ({ memberId: m.id, eligible: true }));
on('POST', '/gamiyas/:id/lottery/trial', ({ me, params }) => {
  const { g } = membership(params[0], me);
  const rec = executeDraw(prepareDraw(g.id, candidates(g.id)), { publicEntropy: `trial:${Date.now()}`, executedBy: me, approvedBy: me, isTrial: true });
  return { isTrial: true, note: 'trial result only — not binding and not stored', order: rec.order, verification: verifyDraw(rec) };
});
on('POST', '/gamiyas/:id/lottery/prepare', ({ me, params }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the organizer can do this');
  if (g.status !== 'LOCKED') throw conflict('NOT_LOCKED', 'the circle must be full before the official draw');
  if (g.tier === 'LARGE' && g.platformApproval !== 'APPROVED') throw conflict('PLATFORM_APPROVAL_REQUIRED', 'large circles need platform approval of the promissory notes before the draw');
  if (db.lottery[g.id]) throw conflict('LOTTERY_EXISTS', 'the official draw was already prepared');
  if (db.proposals.some((p) => p.gamiyaId === g.id && p.status === 'OPEN')) throw conflict('ORDER_PROPOSAL_OPEN', 'withdraw the open order proposal before choosing the lottery');
  const prep = prepareDraw(g.id, candidates(g.id));
  db.lottery[g.id] = { sessionId: uuid(), prep, preparedBy: me, approvals: [], result: null };
  post(g.id, 'SYSTEM', `جُهّزت القرعة. البصمة المعلنة: ${prep.commitment}`, null, 'lottery_session', db.lottery[g.id].sessionId);
  return { sessionId: db.lottery[g.id].sessionId, algorithmVersion: prep.algorithmVersion, commitment: prep.commitment, probabilities: selectionProbability(prep.candidates), nextStep: 'another member must approve, then the manager executes with public entropy announced at draw time' };
});
on('POST', '/gamiyas/:id/lottery/approve', ({ me, params }) => {
  membership(params[0], me);
  const L = db.lottery[params[0]];
  if (!L) throw conflict('NO_LOTTERY', 'no prepared draw');
  if (L.result) throw conflict('LOTTERY_DONE', 'draw already executed');
  if (L.preparedBy === me) throw forbidden('maker–checker: the preparer cannot approve their own draw');
  if (!L.approvals.includes(me)) L.approvals.push(me);
  return { approved: true };
});
on('POST', '/gamiyas/:id/lottery/execute', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the organizer can do this');
  const L = db.lottery[g.id];
  if (!L) throw conflict('NO_LOTTERY', 'no prepared draw');
  if (L.result) throw conflict('LOTTERY_DONE', 'draw already executed');
  if (!L.approvals.length) throw conflict('NEEDS_APPROVAL', 'another member must approve first');
  const entropy = String(body.publicEntropy ?? '').trim();
  if (entropy.length < 8) throw bad('ENTROPY', 'announce a public phrase of at least 8 characters');
  const rec: DrawRecord = executeDraw(L.prep, { publicEntropy: entropy, executedBy: me, approvedBy: L.approvals[0] });
  L.result = rec;
  activate(g, [...rec.order].sort((a, b) => a.position - b.position).map((o) => o.memberId), 'LOTTERY');
  post(g.id, 'SYSTEM', `تمت القرعة وتحقق النظام من مطابقتها للبصمة. الترتيب: ${[...rec.order].sort((a, b) => a.position - b.position).map((o) => `${o.position}. ${user(db.members.find((x) => x.id === o.memberId)!.userId).fullName}`).join('، ')}`, null, 'lottery_session', L.sessionId);
  notify(membersOf(g.id).map((x) => x.userId), { gamiyaId: g.id, kind: 'LOTTERY_DONE', body: `تمت قرعة «${g.name}». افتح الجمعية لمشاهدة العجلة والنتيجة.` });
  return { record: { ...rec, howToVerify: 'sha256(revealedSeedHex) must equal commitment' }, verification: verifyDraw(rec) };
});

on('POST', '/gamiyas/:id/lottery/invite', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the organizer can do this');
  if (g.status !== 'LOCKED') throw conflict('NOT_LOCKED', 'invite members once the circle is full and before the draw');
  if (body.at) { const t = new Date(body.at).getTime(); if (!(t > Date.now() - 60_000 && t < Date.now() + 30 * 86400_000)) throw bad('INVALID_TIME', 'choose a time within the next 30 days'); }
  const L = db.lottery[g.id];
  if (L?.result) throw conflict('LOTTERY_DONE', 'draw already executed');
  const when = body.at ? new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(body.at)) : null;
  post(g.id, 'SYSTEM', `دعوة لمشاهدة القرعة الرسمية${when ? ` ${when}` : ' الآن'}. افتحوا صفحة «${g.name}» لتشاهدوا العجلة معاً.` + (L ? ` النتيجة محسومة سلفاً بالبصمة المعلنة ${L.prep.commitment.slice(0, 16)}… ويمكن لأي عضو التحقق منها.` : ''), null, 'lottery_invite', L?.sessionId ?? g.id);
  const others = membersOf(g.id).filter((x) => x.userId !== me).map((x) => x.userId);
  notify(others, { gamiyaId: g.id, kind: 'LOTTERY_INVITE', body: when ? `قرعة «${g.name}» ${when}: شاهدها مباشرة` : `قرعة «${g.name}» الآن: شاهدها مباشرة` });
  return { invited: others.length, at: body.at ?? null };
});

// ordering
on('GET', '/gamiyas/:id/order', ({ me, params }) => orderState(params[0], me));
on('POST', '/gamiyas/:id/order/priority', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (g.status === 'ACTIVE' || g.status === 'COMPLETED') throw conflict('ORDER_FIXED', 'the payout order is already fixed');
  if (body.preference === 'LATE' && body.neededBy) throw bad('LATE_WITH_DATE', 'a need date means you want an early payout');
  db.priority[m.id] = { preference: body.preference, neededBy: body.neededBy ?? null, reason: body.reason ?? 'NONE', shareReason: !!body.shareReason, note: body.note || null };
  return { saved: true };
});
on('GET', '/gamiyas/:id/order/suggestion', ({ me, params }) => {
  const { g } = membership(params[0], me);
  const ms = membersOf(g.id);
  if (ms.length !== g.memberCount) throw conflict('NOT_FULL', 'the suggestion needs every member; wait until the circle is full');
  const s = computeSuggestion(g);
  const name = (id: string) => user(db.members.find((x) => x.id === id)!.userId).fullName;
  const declared = ms.filter((x) => db.priority[x.id]).length;
  const lines = [
    'يرتّب الاقتراح الأعضاء حسب تاريخ الحاجة المعلن (الأقرب أولاً)، ثم من طلب القبض مبكراً، ثم بلا تفضيل، ثم من طلب التأخير.',
    'لا يفاضل بين الأسباب (زواج، تعليم، علاج…)؛ هي للنقاش بينكم فقط، والملاحظات الخاصة لا تُرسل لأي نموذج ذكاء اصطناعي.',
    'عند التساوي يُكسر التعادل ببصمة ثابتة لكل عضو، لا بترتيب الانضمام، والمنظم بلا أفضلية.',
    s.declaredNeeds ? `من أعلنوا تاريخ حاجة: تحقق الموعد لـ ${s.metNeeds} من ${s.declaredNeeds}.` : 'لم يعلن أحد تاريخ حاجة بعد.',
    ...s.order.filter((o) => o.needMet === false).map((o) => `لم يتسع الجدول لموعد ${name(o.memberId)}: يحتاجه قبل ${o.neededBy} وأقرب دورة له ${o.payoutDate}. يمكن الاتفاق على تبديل مع عضو آخر.`),
    declared < ms.length ? (ms.length - declared === 1 ? 'عضو واحد لم يعلن أولويته بعد؛ اعتُبر «بلا تفضيل».' : `لم يعلن ${ms.length - declared} أعضاء أولويتهم بعد؛ اعتُبروا «بلا تفضيل».`) : '',
    'تذكير: من يقبض مبكراً يبقى ملتزماً بسداد كل أقساطه حتى آخر دورة.',
  ].filter(Boolean);
  return { algorithmVersion: s.algorithmVersion, metNeeds: s.metNeeds, declaredNeeds: s.declaredNeeds, order: s.order.map((o) => ({ ...o, fullName: name(o.memberId) })), explanation: lines, summary: { text: lines[3], source: 'template' } };
});
on('POST', '/gamiyas/:id/order/proposals', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the circle organizer can propose the payout order');
  if (g.status === 'ACTIVE' || g.status === 'COMPLETED') throw conflict('ORDER_FIXED', 'the payout order is already fixed');
  if (g.status !== 'LOCKED') throw conflict('NOT_FULL', 'the circle must be full before the order is proposed');
  if (g.tier === 'LARGE' && g.platformApproval !== 'APPROVED') throw conflict('PLATFORM_APPROVAL_REQUIRED', 'large circles need platform approval first');
  if (db.lottery[g.id]) throw conflict('LOTTERY_EXISTS', 'the lottery was already prepared for this circle');
  if (db.proposals.some((p) => p.gamiyaId === g.id && p.status === 'OPEN')) throw conflict('ORDER_PROPOSAL_OPEN', 'a proposal is already waiting for votes');
  if (!isPermutation(body.order ?? [], membersOf(g.id).map((x) => x.id))) throw bad('INVALID_ORDER', 'the order must list every member exactly once');
  const s = computeSuggestion(g);
  const aiAssisted = body.mode === 'PRIORITY' && s.order.every((o, i) => o.memberId === body.order[i]);
  const p = { id: uuid(), gamiyaId: g.id, mode: body.mode, order: body.order as string[], aiAssisted, rationale: body.rationale || null, status: 'OPEN', createdAt: now(), closedAt: null as string | null };
  db.proposals.push(p);
  db.votes.push({ proposalId: p.id, memberId: m.id, vote: 'APPROVE', reason: null });
  const label = body.mode === 'AGREED' ? 'ترتيب بالاتفاق' : aiAssisted ? 'ترتيب بالأولوية (اقتراح المساعد)' : 'ترتيب بالأولوية';
  post(g.id, 'SYSTEM', `اقترح المنظم ${label}: ${p.order.map((id, i) => `${i + 1}. ${user(db.members.find((x) => x.id === id)!.userId).fullName}`).join('، ')}. يُعتمد عند موافقة جميع الأعضاء، وأي اعتراض بسبب يعيده للنقاش.`, null, 'order_proposal', p.id);
  notify(membersOf(g.id).filter((x) => x.id !== m.id).map((x) => x.userId), { gamiyaId: g.id, kind: 'ACTION_NEEDED', body: `صوّت على ترتيب القبض في «${g.name}»` });
  maybeAdopt(g.id, p.id);
  return { proposalId: p.id, aiAssisted };
});
on('POST', '/gamiyas/:id/order/proposals/:pid/vote', ({ me, params, body }) => {
  const { m } = membership(params[0], me);
  const p = db.proposals.find((x) => x.id === params[1] && x.gamiyaId === params[0]);
  if (!p) throw notFound('proposal');
  if (p.status !== 'OPEN') throw conflict('PROPOSAL_CLOSED', `this proposal is ${p.status}`);
  if (body.vote === 'OBJECT' && String(body.reason ?? '').trim().length < 3) throw bad('REASON_REQUIRED', 'tell the members why you object');
  if (db.votes.some((v) => v.proposalId === p.id && v.memberId === m.id)) throw conflict('ALREADY_VOTED', 'your vote is already recorded');
  db.votes.push({ proposalId: p.id, memberId: m.id, vote: body.vote, reason: body.reason ?? null });
  const who = user(me).fullName;
  if (body.vote === 'OBJECT') {
    p.status = 'REJECTED'; p.closedAt = now();
    post(params[0], 'SYSTEM', `اعترض ${who} على ترتيب القبض: ${body.reason}. أُغلق الاقتراح؛ يمكن للمنظم اقتراح ترتيب جديد بعد النقاش.`, null, 'order_proposal', p.id);
    notify([manager(params[0]).userId], { gamiyaId: params[0], kind: 'ACTION_NEEDED', body: `اعترض ${who} على الترتيب: ${body.reason}` });
    return { status: 'REJECTED' };
  }
  post(params[0], 'SYSTEM', `وافق ${who} على ترتيب القبض.`, null, 'order_proposal', p.id);
  return { status: maybeAdopt(params[0], p.id) };
});
on('POST', '/gamiyas/:id/order/proposals/:pid/withdraw', ({ me, params }) => {
  const { m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the organizer can withdraw a proposal');
  const p = db.proposals.find((x) => x.id === params[1] && x.status === 'OPEN');
  if (!p) throw conflict('PROPOSAL_CLOSED', 'no open proposal with this id');
  p.status = 'WITHDRAWN'; p.closedAt = now();
  post(params[0], 'SYSTEM', 'سحب المنظم اقتراح الترتيب.', null, 'order_proposal', p.id);
  return { status: 'WITHDRAWN' };
});

// schedule & obligations
on('GET', '/gamiyas/:id/schedule', ({ me, params }) => {
  membership(params[0], me);
  return db.cycles.filter((c) => c.gamiyaId === params[0]).sort((a, b) => a.index - b.index).map((cy) => {
    const items = db.installments.filter((i) => i.cycleId === cy.id).map(row).sort((a, b) => user(a.payer.userId).fullName.localeCompare(user(b.payer.userId).fullName));
    return { cycle: cy.index, dueDate: cy.dueDate, recipient: user(db.members.find((m) => m.id === cy.recipientMemberId)!.userId).fullName,
      installments: items.map((r) => ({ installmentId: r.i.id, payer: user(r.payer.userId).fullName, amount: r.i.amountDue, status: r.status })),
      paid: items.filter((r) => r.status === 'PAID').length, total: items.length };
  });
});
on('GET', '/me/obligations', ({ me }) => {
  const items = db.installments.map(row).filter((r) => [r.payer.userId, r.rcp.userId, r.mgr.userId].includes(me))
    .sort((a, b) => a.cy.dueDate.localeCompare(b.cy.dueDate) || a.g.name.localeCompare(b.g.name)).map((r) => view(r, me));
  return { asOf: now(), toPay: items.filter((i) => i.direction === 'I_PAY' && i.status !== 'PAID'), toApprove: items.filter((i) => i.direction === 'I_ORGANIZE' && i.status === 'AWAITING_ORGANIZER'),
    toConfirm: items.filter((i) => i.direction === 'I_RECEIVE' && i.status === 'AWAITING_CONFIRMATION'), late: items.filter((i) => i.direction === 'I_PAY' && i.status === 'LATE') };
});
on('GET', '/installments/:id/pay-to', ({ me, params }) => {
  const r = loadInst(params[0], me);
  if (r.payer.userId !== me) throw forbidden('only the payer can see where to transfer');
  const reference = transferReference(r.i.id);
  if (r.status === 'PAID') return { recipient: user(r.rcp.userId).fullName, amount: r.i.amountDue, currency: r.g.currency, reference, methods: [], note: 'already confirmed' };
  const ms = db.payoutMethods.filter((p) => p.userId === r.rcp.userId && p.country === r.g.country).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return { recipient: user(r.rcp.userId).fullName, amount: r.i.amountDue, currency: r.g.currency, reference,
    methods: ms.map((p) => ({ kind: p.kind, name: METHODS.find((s) => s.kind === p.kind)!.name, value: p.value, isDefault: p.isDefault, guide: transferGuide(p.kind, Number(r.i.amountDue), r.g.currency) })) };
});
on('POST', '/installments/:id/declare-paid', ({ me, params, body }) => {
  const r = loadInst(params[0], me);
  if (r.payer.userId !== me) throw forbidden('only the payer can declare this payment');
  if (r.i.s?.confirmedAt) throw conflict('ALREADY_CONFIRMED', 'already confirmed');
  if (r.i.s && !r.i.s.voided) throw conflict('ALREADY_DECLARED', 'payment already declared');
  if (!METHODS.some((m) => m.kind === body.methodKind && m.country === r.g.country) && body.methodKind !== 'OTHER') throw conflict('UNKNOWN_METHOD', 'choose a transfer method available in this circle’s country');
  const f = db.files.find((x) => x.id === body.receiptFileId && x.ownerId === me && x.gamiyaId === r.g.id && x.purpose === 'RECEIPT');
  if (!f) throw notFound('receipt');
  const reused = db.installments.some((x) => x.id !== r.i.id && x.s && !x.s.voided && db.files.find((ff) => ff.id === x.s!.receiptFileId)?.sha256 === f.sha256);
  if (reused) throw conflict('RECEIPT_ALREADY_USED', 'this receipt is already attached to another payment');
  const refUsed = !!body.reference && db.installments.some((x) => x.id !== r.i.id && x.s && !x.s.voided && row(x).g.id === r.g.id && (x.s.reference ?? '').toLowerCase() === String(body.reference).toLowerCase());
  const m = matchDeclaration({ amountDue: r.i.amountDue, declaredAmount: body.amount ?? '0', transferDate: body.transferDate ?? '0000-00-00', earliest: r.g.createdAt.slice(0, 10), today: today(),
    methodKind: body.methodKind, recipientKinds: db.payoutMethods.filter((p) => p.userId === r.rcp.userId && p.country === r.g.country).map((p) => p.kind), receiptUsedElsewhere: false, bankRefUsedElsewhere: refUsed });
  const attempts = (r.i.s?.attempts ?? 0) + 1;
  r.i.s = { declaredAt: now(), reference: body.reference ?? null, methodKind: body.methodKind, receiptFileId: f.id, attempts, declaredAmount: body.amount ? Number(body.amount).toFixed(2) : null,
    transferDate: body.transferDate ?? null, match: { ...m, provided: { amount: !!body.amount, transferDate: !!body.transferDate } }, organizerApprovedAt: null, confirmedAt: null, voided: false, disputed: false };
  const next = r.needsOrganizer ? 'بانتظار اعتماد المنظم' : 'بانتظار تأكيد المستلم';
  const flagged = m.checks.filter((x) => !x.ok).length;
  post(r.g.id, 'SYSTEM', `أعلن ${user(me).fullName} تحويل ${money(r)} إلى ${user(r.rcp.userId).fullName} (الدورة ${r.cy.index}) وأرفق الإيصال. ${next}.${flagged ? ` المطابقة التلقائية: ${flagged} ملاحظة للمراجعة.` : ' المطابقة التلقائية: كل الفحوص سليمة.'}`, null, 'installment', r.i.id);
  notify([r.needsOrganizer ? r.mgr.userId : r.rcp.userId], { gamiyaId: r.g.id, kind: 'ACTION_NEEDED', body: r.needsOrganizer ? `راجع إيصال ${user(me).fullName}` : `أكّد استلام ${money(r)} من ${user(me).fullName}` });
  return view(row(r.i), me);
});
on('POST', '/installments/:id/organizer-approve', ({ me, params }) => decide(params[0], me, true));
on('POST', '/installments/:id/organizer-reject', ({ me, params, body }) => decide(params[0], me, false, body.reason));
function decide(id: string, me: string, approve: boolean, reason?: string) {
  const r = loadInst(id, me);
  if (r.mgr.userId !== me) throw forbidden('only the circle organizer can review receipts');
  if (!r.needsOrganizer) throw conflict('NOT_REQUIRED', 'the organizer is a party to this transfer');
  if (r.status !== 'AWAITING_ORGANIZER') throw conflict('NOT_AWAITING_ORGANIZER', `current status is ${r.status}`);
  if (!approve && String(reason ?? '').trim().length < 3) throw bad('REASON_REQUIRED', 'give a reason');
  const payer = user(r.payer.userId).fullName, rcp = user(r.rcp.userId).fullName;
  if (approve) {
    r.i.s!.organizerApprovedAt = now();
    post(r.g.id, 'SYSTEM', `اعتمد المنظم إيصال ${payer} (الدورة ${r.cy.index}). بانتظار تأكيد ${rcp}.`, null, 'installment', id);
    notify([r.rcp.userId], { gamiyaId: r.g.id, kind: 'ACTION_NEEDED', body: `أكّد استلام ${money(r)} من ${payer}` });
  } else {
    r.i.s!.voided = true;
    post(r.g.id, 'SYSTEM', `رفض المنظم إيصال ${payer} (الدورة ${r.cy.index}): ${reason}. على ${payer} إعادة الإرسال.`, null, 'installment', id);
    notify([r.payer.userId], { gamiyaId: r.g.id, kind: 'ACTION_NEEDED', body: `رُفض إيصالك: ${reason}` });
  }
  return view(row(r.i), me);
}
on('POST', '/installments/:id/confirm-received', ({ me, params }) => {
  const r = loadInst(params[0], me);
  if (r.rcp.userId !== me) throw forbidden('only the cycle recipient can confirm receipt');
  if (r.i.s?.confirmedAt) throw conflict('ALREADY_CONFIRMED', 'already confirmed');
  if (!r.i.s || r.i.s.voided) throw conflict('NOT_DECLARED', 'the payer has not declared this payment yet');
  if (r.status === 'AWAITING_ORGANIZER') throw conflict('AWAITING_ORGANIZER', 'the organizer must approve the receipt first');
  r.i.s.confirmedAt = now(); r.i.s.disputed = false;
  for (const d of db.disputes) if (d.installmentId === r.i.id && d.status === 'OPEN') Object.assign(d, { status: 'RESOLVED', outcome: 'RECEIPT_VALID', note: 'أكد المستلم الاستلام' });
  post(r.g.id, 'SYSTEM', `أكّد ${user(me).fullName} استلام ${money(r)} من ${user(r.payer.userId).fullName} (الدورة ${r.cy.index}). اكتملت المعاملة.`, null, 'installment', r.i.id);
  const left = db.installments.map(row).filter((x) => x.g.id === r.g.id && x.status !== 'PAID').length;
  if (left === 0) { r.g.status = 'COMPLETED'; post(r.g.id, 'SYSTEM', 'اكتملت الجمعية: كل الأقساط مؤكدة من مستلميها.', null, 'gamiya', r.g.id); }
  return { ...view(row(r.i), me), circleCompleted: left === 0 };
});
on('POST', '/installments/:id/dispute', ({ me, params, body }) => {
  const r = loadInst(params[0], me);
  if (r.rcp.userId !== me) throw forbidden('only the cycle recipient can dispute');
  if (!r.i.s || r.i.s.voided) throw conflict('NOT_DECLARED', 'nothing to dispute');
  if (r.i.s.confirmedAt) throw conflict('ALREADY_CONFIRMED', 'confirmed payments cannot be disputed here');
  if (r.i.s.disputed) throw conflict('ALREADY_DISPUTED', 'a dispute is already open');
  if (String(body.reason ?? '').trim().length < 3) throw bad('REASON_REQUIRED', 'give a reason');
  r.i.s.disputed = true;
  const d = { id: uuid(), gamiyaId: r.g.id, installmentId: r.i.id, openedBy: me, reason: body.reason, openedAt: now(), status: 'OPEN', outcome: null as string | null, note: null as string | null };
  db.disputes.push(d);
  post(r.g.id, 'SYSTEM', `اعترض ${user(me).fullName} على تحويل ${user(r.payer.userId).fullName} (الدورة ${r.cy.index}): ${body.reason}. ${r.needsOrganizer ? 'سيراجعه المنظم.' : 'ستراجعه إدارة المنصة.'}`, null, 'dispute', d.id);
  notify([r.payer.userId, r.mgr.userId], { gamiyaId: r.g.id, kind: 'DISPUTE_OPENED', body: `اعتراض على تحويل الدورة ${r.cy.index}` });
  return { ...view(row(r.i), me), disputeId: d.id };
});
on('POST', '/disputes/:id/resolve', ({ me, params, body }) => {
  const d = db.disputes.find((x) => x.id === params[0]);
  if (!d) throw notFound('dispute');
  const r = row(db.installments.find((i) => i.id === d.installmentId)!);
  const reviewer = user(me).platformRole !== 'NONE';
  const allowed = r.needsOrganizer ? r.mgr.userId === me : reviewer && ![r.payer.userId, r.rcp.userId].includes(me);
  if (!allowed) throw forbidden('you cannot resolve this dispute');
  if (d.status !== 'OPEN') throw conflict('DISPUTE_CLOSED', 'dispute already resolved');
  if (String(body.note ?? '').trim().length < 3) throw bad('NOTE_REQUIRED', 'explain the decision');
  Object.assign(d, { status: 'RESOLVED', outcome: body.outcome, note: body.note });
  if (body.outcome === 'PAYER_TO_RESEND') { r.i.s!.voided = true; r.i.s!.disputed = false; } else r.i.s!.disputed = false;
  const msg = body.outcome === 'PAYER_TO_RESEND' ? `حُسم الاعتراض: على ${user(r.payer.userId).fullName} إعادة التحويل أو إرسال إيصال صحيح. السبب: ${body.note}`
    : `حُسم الاعتراض: الإيصال صحيح. نرجو من ${user(r.rcp.userId).fullName} مراجعة حسابه وتأكيد الاستلام. ${body.note}`;
  post(r.g.id, 'SYSTEM', msg, null, 'dispute', d.id);
  notify([r.payer.userId, r.rcp.userId], { gamiyaId: r.g.id, kind: 'DISPUTE_RESOLVED', body: msg });
  return view(row(r.i), me);
});
on('GET', '/gamiyas/:id/disputes', ({ me, params }) => {
  membership(params[0], me);
  return db.disputes.filter((d) => d.gamiyaId === params[0] && d.status === 'OPEN').map((d) => {
    const r = row(db.installments.find((i) => i.id === d.installmentId)!);
    return { disputeId: d.id, installmentId: d.installmentId, reason: d.reason, openedAt: d.openedAt, cycle: r.cy.index, payer: user(r.payer.userId).fullName, recipient: user(r.rcp.userId).fullName, organizerDecides: r.needsOrganizer };
  });
});

// promissory notes & platform review (LARGE circles)
on('POST', '/gamiyas/:id/promissory-notes', ({ me, params, body }) => {
  const { g, m } = membership(params[0], me);
  if (g.tier !== 'LARGE') throw conflict('NOT_LARGE', 'promissory notes are only required for large circles');
  if (m.role === 'MANAGER') throw forbidden('the organizer is the beneficiary and does not submit a note');
  if (!['AWAITING_NOTES', 'REJECTED'].includes(g.platformApproval)) throw conflict('REVIEW_LOCKED', 'notes cannot change while under review or after approval');
  if (!db.files.some((f) => f.id === body.fileId && f.ownerId === me && f.gamiyaId === g.id && f.purpose === 'PROMISSORY_NOTE')) throw notFound('file');
  if (String(body.reference ?? '').trim().length < 2) throw bad('REFERENCE', 'enter the note reference');
  const amount = dec(parseMoney(g.contribution, g.currency) * BigInt(g.memberCount), g.currency);
  db.notes = db.notes.filter((n) => n.memberId !== m.id);
  db.notes.push({ id: uuid(), gamiyaId: g.id, memberId: m.id, fileId: body.fileId, reference: body.reference, amount, status: 'SUBMITTED' });
  if (g.platformApproval === 'REJECTED') g.platformApproval = 'AWAITING_NOTES';
  post(g.id, 'SYSTEM', `رفع ${user(me).fullName} سند لأمر لصالح المنظم بقيمة ${amount} ${g.currency} (مرجع ${body.reference}).`, null, 'promissory_note', m.id);
  return { submitted: true, amount, beneficiary: 'ORGANIZER' };
});
on('POST', '/gamiyas/:id/platform-review', ({ me, params }) => {
  const { g, m } = membership(params[0], me);
  if (m.role !== 'MANAGER') throw forbidden('only the organizer can request review');
  if (g.tier !== 'LARGE') throw conflict('NOT_LARGE', 'only large circles need platform review');
  if (g.status !== 'LOCKED') throw conflict('NOT_LOCKED', 'the circle must be full first');
  if (g.platformApproval !== 'AWAITING_NOTES') throw conflict('REVIEW_STATE', `review is ${g.platformApproval}`);
  const missing = membersOf(g.id).filter((x) => x.role !== 'MANAGER' && !db.notes.some((n) => n.memberId === x.id && n.status === 'SUBMITTED')).length;
  if (missing) throw conflict('NOTES_MISSING', `${missing} member(s) have not submitted a promissory note`);
  g.platformApproval = 'PENDING'; g.platformReviewNote = null;
  post(g.id, 'SYSTEM', 'طلب المنظم اعتماد إدارة المنصة. ستصلكم النتيجة هنا.', null, 'gamiya', g.id);
  return { platformApproval: 'PENDING' };
});
const requireReviewer = (me: string) => { if (user(me).platformRole === 'NONE') throw notFound(); };
on('GET', '/admin/reviews', ({ me }) => {
  requireReviewer(me);
  return db.circles.filter((g) => g.platformApproval === 'PENDING').map((g) => ({
    id: g.id, name: g.name, organizer: user(manager(g.id).userId).fullName, currency: g.currency, potPerCycle: dec(parseMoney(g.contribution, g.currency) * BigInt(g.memberCount), g.currency),
    memberCount: g.memberCount, startDate: g.startDate,
    notes: db.notes.filter((n) => n.gamiyaId === g.id).map((n) => ({ id: n.id, member: user(db.members.find((x) => x.id === n.memberId)!.userId).fullName, reference: n.reference, amount: n.amount, fileId: n.fileId, status: n.status })),
  }));
});
on('POST', '/admin/gamiyas/:id/review', ({ me, params, body }) => {
  requireReviewer(me);
  const g = db.circles.find((c) => c.id === params[0]);
  if (!g) throw notFound('gamiya');
  if (g.platformApproval !== 'PENDING') throw conflict('REVIEW_STATE', `review is ${g.platformApproval}`);
  if (db.members.some((m) => m.gamiyaId === g.id && m.userId === me)) throw forbidden('a reviewer cannot review a circle they belong to');
  const approve = body.decision === 'APPROVE';
  for (const n of db.notes) if (n.gamiyaId === g.id) n.status = approve ? 'ACCEPTED' : 'REJECTED';
  g.platformApproval = approve ? 'APPROVED' : 'REJECTED'; g.platformReviewNote = body.note ?? null;
  post(g.id, 'SYSTEM', approve ? 'اعتمدت إدارة المنصة الجمعية والسندات. يمكن للمنظم تجهيز القرعة.' : `لم تعتمد إدارة المنصة الجمعية${body.note ? `: ${body.note}` : ''}. يرجى إعادة رفع السندات المطلوبة.`, null, 'gamiya', g.id);
  notify(membersOf(g.id).map((x) => x.userId), { gamiyaId: g.id, kind: approve ? 'PLATFORM_APPROVED' : 'PLATFORM_REJECTED', body: approve ? 'اعتُمدت جمعيتك الكبيرة.' : 'لم تُعتمد جمعيتك الكبيرة بعد.' });
  return { platformApproval: g.platformApproval };
});
on('GET', '/admin/disputes', ({ me }) => {
  requireReviewer(me);
  return db.disputes.filter((d) => d.status === 'OPEN').map((d) => ({ d, r: row(db.installments.find((i) => i.id === d.installmentId)!) }))
    .filter(({ r }) => !r.needsOrganizer && !db.members.some((m) => m.gamiyaId === r.g.id && m.userId === me))
    .map(({ d, r }) => ({ disputeId: d.id, gamiyaName: r.g.name, amount: r.i.amountDue, currency: r.g.currency, payer: user(r.payer.userId).fullName, recipient: user(r.rcp.userId).fullName, reason: d.reason, openedAt: d.openedAt, receiptFileId: r.i.s?.receiptFileId ?? null }));
});

// chat & notifications
on('GET', '/gamiyas/:id/chat', ({ me, params, query }) => {
  membership(params[0], me);
  const after = Number(query.get('after') ?? 0);
  return db.chat.filter((c) => c.gamiyaId === params[0] && c.id > after).map((c) => ({ id: c.id, kind: c.kind, body: c.body, sender: c.senderUserId ? user(c.senderUserId).fullName : null, mine: c.senderUserId === me, refEntity: c.refEntity, refId: c.refId, at: c.at }));
});
on('POST', '/gamiyas/:id/chat', ({ me, params, body }) => {
  membership(params[0], me);
  const text = String(body.body ?? '').trim();
  if (!text || text.length > 2000) throw bad('INVALID_MESSAGE', 'write 1–2000 characters');
  const mine = post(params[0], 'USER', text, me);
  let reply = null;
  if (/^@?(مساعد|assistant)\b/i.test(text)) { const a = assistant(params[0], me, text); const r = post(params[0], 'ASSISTANT', a, null, 'reply', String(mine.id)); reply = { id: r.id, body: a }; }
  return { id: mine.id, reply };
});
on('GET', '/me/notifications', ({ me }) => {
  const rows = db.notifications.filter((n) => n.userId === me).sort((a, b) => b.id - a.id).slice(0, 50);
  return { unread: rows.filter((r) => !r.read).length, items: rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, gamiyaId: r.gamiyaId, gamiyaName: db.circles.find((c) => c.id === r.gamiyaId)?.name ?? null, at: r.at, read: r.read })) };
});
on('POST', '/me/notifications/read', ({ me }) => { for (const n of db.notifications) if (n.userId === me) n.read = true; return { ok: true }; });

// payout methods
on('GET', '/payout-methods/directory', ({ query }) => {
  const c = query.get('country') as Country | null;
  return { countries: COUNTRIES, methods: c ? methodsFor(c) : METHODS };
});
on('GET', '/me/payout-methods', ({ me }) => db.payoutMethods.filter((p) => p.userId === me).map((p) => ({ id: p.id, country: p.country, kind: p.kind, masked: `••••${p.last4}`, isDefault: p.isDefault })));
on('POST', '/me/payout-methods', ({ me, body }) => {
  const spec = METHODS.find((m) => m.kind === body.kind && m.country === body.country);
  if (!spec) throw bad('UNKNOWN_METHOD', 'choose a method for this country');
  const n = normalizeMethodValue(body.kind, String(body.value ?? ''));
  if (!n.ok) throw bad(n.error, 'check the number or IBAN and try again');
  const makeDefault = !!body.isDefault || !db.payoutMethods.some((p) => p.userId === me && p.country === body.country);
  if (makeDefault) for (const p of db.payoutMethods) if (p.userId === me && p.country === body.country) p.isDefault = false;
  const p = { id: uuid(), userId: me, country: body.country, kind: body.kind, value: n.value, last4: n.last4, isDefault: makeDefault };
  db.payoutMethods.push(p);
  return { id: p.id, country: p.country, kind: p.kind, masked: `••••${p.last4}`, isDefault: p.isDefault };
});
on('POST', '/me/payout-methods/:id/remove', ({ me, params }) => {
  const before = db.payoutMethods.length;
  db.payoutMethods = db.payoutMethods.filter((p) => !(p.id === params[0] && p.userId === me));
  if (before === db.payoutMethods.length) throw notFound('method');
  return { removed: true };
});

// savings advisor (real formula + template narration; no model is called in the demo)
on('POST', '/ai/savings-advice', async ({ me, body }) => {
  const rows = db.members.filter((m) => m.userId === me).map((m) => db.circles.find((c) => c.id === m.gamiyaId)!).filter((g) => ['RECRUITING', 'LOCKED', 'ACTIVE'].includes(g.status));
  const existing = rows.reduce((s, g) => s + monthlyEquivalent(parseMoney(g.contribution, 'SAR'), g.frequency as Frequency), 0n);
  let f;
  try {
    f = savingsFacts({ monthlyIncome: parseMoney(String(body.monthlyIncome), 'SAR'), monthlyExpenses: parseMoney(String(body.monthlyExpenses), 'SAR'), goalAmount: parseMoney(String(body.goalAmount), 'SAR'), targetMonths: body.targetMonths, existingMonthlyCommitments: existing });
  } catch (e) { throw bad('INVALID_INPUT', (e as Error).message); }
  const d = (v: bigint) => dec(v, 'SAR');
  const facts: AdvisorFacts = {
    status: f.status, currency: 'SAR', disposableIncome: d(f.disposableIncome), comfortableMonthlyCapacity: d(f.comfortableMonthlyCapacity), existingMonthlyCommitments: d(f.existingMonthlyCommitments),
    remainingCapacity: d(f.remainingCapacity), goalAmount: d(parseMoney(String(body.goalAmount), 'SAR')), targetMonths: body.targetMonths ?? null,
    recommended: f.recommended && { members: f.recommended.members, months: f.recommended.months, monthlyContribution: d(f.recommended.monthlyContribution), payout: d(f.recommended.payout) },
    scenarios: f.scenarios.map((s) => ({ members: s.members, months: s.months, monthlyContribution: d(s.monthlyContribution), payout: d(s.payout), affordable: s.affordable, fitsTarget: s.fitsTarget })),
    comfortableSharePercent: SAVINGS_POLICY.comfortableShareBps / 100,
  };
  const n = await narrate(facts, null);
  return { facts, explanation: { text: n.text, source: n.source, provider: null, model: null }, policyVersion: f.policyVersion,
    dataSources: ['المدخلات التي قدّمتها الآن (لا تُحفظ)', 'جمعياتك في هذه التجربة'], generatedAt: now(),
    disclaimer: 'إرشاد عام مبني على قاعدة ثابتة (30% من المتبقي بعد المصاريف)، وليس استشارة مالية. الأرقام محسوبة بمحرك المنصة لا بنموذج الذكاء الاصطناعي.' };
});
