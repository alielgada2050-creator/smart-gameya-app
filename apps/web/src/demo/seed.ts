/**
 * Demo starting state, built relative to today so statuses (late, in grace, upcoming) always make sense.
 * Every person, circle, IBAN and receipt here is invented for the demo.
 */
import { generateSchedule } from '../../../../packages/financial-core/src/schedule.ts';
import { matchDeclaration } from '../../../../packages/financial-core/src/transfer.ts';
import agreementBody from '../../../api/agreements/join-v1.ar.md?raw';

export interface DB {
  seq: number; seeded: string[];
  users: { id: string; phone: string; fullName: string; platformRole: string }[];
  otp: Record<string, string>;
  agreement: { id: string; template_code: string; version: string; locale: string; body_sha256: string; body: string };
  circles: { id: string; name: string; currency: string; country: string; frequency: string; contribution: string; memberCount: number; startDate: string; graceDays: number;
    status: string; tier: string; platformApproval: string; platformReviewNote: string | null; ordering: string; createdAt: string; category?: string; termsVersion?: number }[];
  members: { id: string; gamiyaId: string; userId: string; role: string; payoutPosition: number | null; joinedAt: string; status?: string }[];
  cycles: { id: string; gamiyaId: string; index: number; dueDate: string; recipientMemberId: string }[];
  installments: { id: string; cycleId: string; memberId: string; amountDue: string; s: null | {
    declaredAt: string; reference: string | null; methodKind: string; receiptFileId: string; attempts: number; declaredAmount: string | null; transferDate: string | null;
    match: any; organizerApprovedAt: string | null; confirmedAt: string | null; voided: boolean; disputed: boolean } }[];
  disputes: { id: string; gamiyaId: string; installmentId: string; openedBy: string; reason: string; openedAt: string; status: string; outcome: string | null; note: string | null }[];
  files: { id: string; ownerId: string; gamiyaId: string; purpose: string; mime: string; sha256: string; dataUrl: string }[];
  invitations: { code: string; gamiyaId: string; maxUses: number; uses: number; expiresAt: string }[];
  chat: { id: number; gamiyaId: string; kind: 'USER' | 'SYSTEM' | 'ASSISTANT'; body: string; senderUserId: string | null; refEntity: string | null; refId: string | null; at: string }[];
  notifications: { id: number; userId: string; gamiyaId: string | null; kind: string; body: string; at: string; read: boolean }[];
  lottery: Record<string, { sessionId: string; prep: any; preparedBy: string; approvals: string[]; result: any }>;
  priority: Record<string, { preference: 'EARLY' | 'LATE' | 'NONE'; neededBy: string | null; reason: string; shareReason: boolean; note: string | null }>;
  proposals: { id: string; gamiyaId: string; mode: string; order: string[]; aiAssisted: boolean; rationale: string | null; status: string; createdAt: string; closedAt: string | null }[];
  votes: { proposalId: string; memberId: string; vote: string; reason: string | null }[];
  notes: { id: string; gamiyaId: string; memberId: string; fileId: string; reference: string; amount: string; status: string }[];
  payoutMethods: { id: string; userId: string; country: string; kind: string; value: string; last4: string; isDefault: boolean }[];
  pledges: { id: string; userId: string; gamiyaId: string; termsVersion: number; pledgeVersion: string; textSha256: string; typedName: string; terms: any; signedAt: string }[];
  goals: { id: string; userId: string; category: string; title: string; targetAmount: string; currency: string; targetDate: string | null; gamiyaId: string | null; status: string; createdAt: string }[];
}

const uuid = () => crypto.randomUUID();
const day = (offset: number) => { const d = new Date(); d.setUTCHours(9, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d; };
const iso = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(day(offset));
const at = (offset: number, minutes = 0) => new Date(day(offset).getTime() + minutes * 60e3).toISOString();

/** Valid-looking Saudi IBAN (ISO 13616 check digits) for an invented account. */
function iban(bank: string, account: string) {
  const bban = bank + account.padStart(18, '0');
  const num = (bban + 'SA00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const check = String(98n - (BigInt(num) % 97n)).padStart(2, '0');
  return `SA${check}${bban}`;
}

/** Simple illustrated receipt / note (SVG), clearly marked as a demo document. */
function doc(title: string, lines: string[], accent: string) {
  const rows = lines.map((l, i) => `<text x="300" y="${150 + i * 34}" font-size="20" text-anchor="end" fill="#334155">${l}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="${220 + lines.length * 34}" viewBox="0 0 340 ${220 + lines.length * 34}" direction="rtl" font-family="IBM Plex Sans Arabic, Tahoma, sans-serif">
<rect width="100%" height="100%" rx="18" fill="#FFFFFF"/><rect width="100%" height="70" rx="18" fill="${accent}"/><rect y="52" width="100%" height="18" fill="${accent}"/>
<text x="300" y="45" font-size="22" font-weight="700" text-anchor="end" fill="#FFFFFF">${title}</text>
<text x="300" y="108" font-size="15" text-anchor="end" fill="#B45309">مستند تجريبي — ليس إيصالاً حقيقياً</text>${rows}
<circle cx="56" cy="${170 + lines.length * 34}" r="26" fill="#DCFCE7"/><path d="M44 ${170 + lines.length * 34}l9 9 16-18" stroke="#16A34A" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function seed(): DB {
  const db: DB = {
    seq: 0, seeded: [], users: [], otp: {}, circles: [], members: [], cycles: [], installments: [], disputes: [], files: [], invitations: [], chat: [], notifications: [],
    lottery: {}, priority: {}, proposals: [], votes: [], notes: [], payoutMethods: [], pledges: [], goals: [],
    agreement: { id: '6a7f9de2-90e9-470d-8e95-12181b804a6e', template_code: 'JOIN', version: '1.0', locale: 'ar', body_sha256: 'demo', body: agreementBody },
  };
  const U = (fullName: string, phone: string, platformRole = 'NONE') => { const u = { id: uuid(), phone, fullName, platformRole }; db.users.push(u); db.seeded.push(u.id); return u.id; };
  const sara = U('سارة', '+966551110001'), khalid = U('خالد', '+966551110002'), noura = U('نورة', '+966551110003'), fahad = U('فهد', '+966551110004');
  const reem = U('ريم (مراجِعة المنصة)', '+966551110009', 'PLATFORM_ADMIN');

  const pm = (userId: string, kind: string, value: string, last4: string, isDefault = true) => db.payoutMethods.push({ id: uuid(), userId, country: 'SA', kind, value, last4, isDefault });
  pm(sara, 'IBAN_SA', iban('80', '608010167519'), '7519'); pm(khalid, 'IBAN_SA', iban('10', '233344455566'), '5566');
  pm(noura, 'IBAN_SA', iban('45', '120098761234'), '1234'); pm(noura, 'STC_PAY', '+966551110003', '0003', false); pm(fahad, 'IBAN_SA', iban('05', '700012340987'), '0987');

  const chat = (gamiyaId: string, kind: 'USER' | 'SYSTEM' | 'ASSISTANT', body: string, when: string, sender: string | null = null) =>
    db.chat.push({ id: ++db.seq, gamiyaId, kind, body, senderUserId: sender, refEntity: null, refId: null, at: when });
  const note = (userId: string, gamiyaId: string, kind: string, body: string, when: string) =>
    db.notifications.push({ id: ++db.seq, userId, gamiyaId, kind, body, at: when, read: false });
  const circle = (c: Partial<DB['circles'][number]> & { name: string; contribution: string; memberCount: number; startDate: string; createdAt: string }) => {
    const g = { id: uuid(), currency: 'SAR', country: 'SA', frequency: 'MONTHLY', graceDays: 3, status: 'RECRUITING', tier: 'SMALL', platformApproval: 'NOT_REQUIRED', platformReviewNote: null, ordering: 'LOTTERY', ...c };
    db.circles.push(g as DB['circles'][number]); return g as DB['circles'][number];
  };
  const join = (g: DB['circles'][number], userId: string, role: string, when: string) => {
    const m = { id: uuid(), gamiyaId: g.id, userId, role, payoutPosition: null as number | null, joinedAt: when, status: 'ACTIVE' }; db.members.push(m);
    // every seeded member signed the pledge when joining (evidence summary only; new signatures in the demo carry the full text hash)
    const u = db.users.find((x) => x.id === userId)!;
    const total = (Number(g.contribution) * (g.memberCount - 1)).toFixed(2);
    db.pledges.push({ id: uuid(), userId, gamiyaId: g.id, termsVersion: 1, pledgeVersion: 'sg-pledge/1.0', textSha256: 'seed'.padEnd(64, '0'), typedName: u.fullName, terms: { totalCommitment: total, currency: g.currency }, signedAt: when });
    return m.id;
  };
  const receipt = (owner: string, g: string, title: string, lines: string[]) => {
    const f = { id: uuid(), ownerId: owner, gamiyaId: g, purpose: 'RECEIPT', mime: 'image/svg+xml', sha256: uuid(), dataUrl: doc(title, lines, '#0F172A') };
    db.files.push(f); return f.id;
  };

  // ── 1) جمعية الأصدقاء — running; payments in every state ──
  const g1 = circle({ name: 'جمعية الأصدقاء', contribution: '2000.00', memberCount: 4, startDate: iso(-46), createdAt: at(-60), status: 'ACTIVE', ordering: 'CONSENSUS', category: 'FRIENDS' });
  const m1 = { sara: join(g1, sara, 'MANAGER', at(-60)), khalid: join(g1, khalid, 'MEMBER', at(-59)), noura: join(g1, noura, 'MEMBER', at(-59, 30)), fahad: join(g1, fahad, 'MEMBER', at(-58)) };
  const order1 = [m1.khalid, m1.sara, m1.noura, m1.fahad];
  order1.forEach((id, i) => { db.members.find((m) => m.id === id)!.payoutPosition = i + 1; });
  const p1 = { id: uuid(), gamiyaId: g1.id, mode: 'AGREED', order: order1, aiAssisted: false, rationale: 'كما اتفقنا في المحادثة', status: 'ADOPTED', createdAt: at(-57), closedAt: at(-56) };
  db.proposals.push(p1);
  for (const id of order1) db.votes.push({ proposalId: p1.id, memberId: id, vote: 'APPROVE', reason: null });
  const s1 = generateSchedule({ members: 4, contribution: 200000n, currency: 'SAR', frequency: 'MONTHLY', startDate: g1.startDate });
  const inst: Record<string, string> = {};
  for (const cy of s1.cycles) {
    const rec = order1[cy.payoutPosition - 1];
    const c = { id: uuid(), gamiyaId: g1.id, index: cy.index, dueDate: cy.dueDate, recipientMemberId: rec };
    db.cycles.push(c);
    for (const mid of order1) if (mid !== rec) { const id = uuid(); inst[`${cy.index}:${mid}`] = id; db.installments.push({ id, cycleId: c.id, memberId: mid, amountDue: '2000.00', s: null }); }
  }
  const settle = (key: string, payerUser: string, opts: { amount?: string; when: number; method?: string; ref?: string | null; approved?: boolean; confirmed?: boolean; disputed?: boolean; recipientKinds?: string[] }) => {
    const i = db.installments.find((x) => x.id === inst[key])!;
    const amount = opts.amount ?? '2000';
    const file = receipt(payerUser, g1.id, 'إيصال تحويل فوري', [`المبلغ: ${amount} ريال`, `التاريخ: ${iso(opts.when)}`, `المرجع: ${opts.ref ?? 'JM-DEMO'}`]);
    const m = matchDeclaration({ amountDue: '2000.00', declaredAmount: amount, transferDate: iso(opts.when), earliest: g1.createdAt.slice(0, 10), today: iso(0), methodKind: opts.method ?? 'IBAN_SA',
      recipientKinds: opts.recipientKinds ?? ['IBAN_SA'], receiptUsedElsewhere: false, bankRefUsedElsewhere: false });
    i.s = { declaredAt: at(opts.when, 20), reference: opts.ref ?? null, methodKind: opts.method ?? 'IBAN_SA', receiptFileId: file, attempts: 1, declaredAmount: Number(amount).toFixed(2), transferDate: iso(opts.when),
      match: { ...m, provided: { amount: true, transferDate: true } }, organizerApprovedAt: opts.approved ? at(opts.when, 90) : null, confirmedAt: opts.confirmed ? at(opts.when + 1) : null, voided: false, disputed: !!opts.disputed };
    return i.id;
  };
  // cycle 1 → خالد: all paid
  settle(`1:${m1.sara}`, sara, { when: -46, ref: 'SARIE-1001', confirmed: true });
  settle(`1:${m1.noura}`, noura, { when: -45, ref: 'SARIE-1002', approved: true, confirmed: true });
  settle(`1:${m1.fahad}`, fahad, { when: -45, ref: 'SARIE-1003', approved: true, confirmed: true });
  // cycle 2 → سارة (organizer is recipient): خالد waiting for her confirmation; فهد short by 200; نورة disputed → platform decides
  settle(`2:${m1.khalid}`, khalid, { when: -15, ref: 'SARIE-2001' });
  settle(`2:${m1.fahad}`, fahad, { when: -14, amount: '1800', ref: 'SARIE-2003' });
  const disputedId = settle(`2:${m1.noura}`, noura, { when: -14, ref: 'SARIE-2002', disputed: true });
  const d1 = { id: uuid(), gamiyaId: g1.id, installmentId: disputedId, openedBy: sara, reason: 'لم يظهر المبلغ في حسابي حتى الآن', openedAt: at(-12), status: 'OPEN', outcome: null, note: null };
  db.disputes.push(d1);
  // cycle 3 → نورة: خالد paid early, waiting for the organizer's approval
  settle(`3:${m1.khalid}`, khalid, { when: -1, ref: 'SARIE-3001' });

  chat(g1.id, 'SYSTEM', 'أُنشئت الجمعية (صغيرة). القبض لكل دورة 6000.00 SAR.', at(-60));
  chat(g1.id, 'SYSTEM', 'انضم خالد ونورة وفهد ووافقوا على الاتفاقية. اكتمل العدد.', at(-58));
  chat(g1.id, 'SYSTEM', 'وافق جميع الأعضاء. اعتُمد ترتيب القبض وبدأت الجمعية: 1. خالد، 2. سارة، 3. نورة، 4. فهد.', at(-56));
  chat(g1.id, 'SYSTEM', 'أكّد خالد استلام كل أقساط الدورة 1. اكتملت المعاملات.', at(-44));
  chat(g1.id, 'USER', 'السلام عليكم، حوّلت قسط الدورة الثانية لسارة وأرفقت الإيصال 🌷', at(-15, 30), khalid);
  chat(g1.id, 'SYSTEM', 'أعلن فهد تحويل 2000.00 SAR إلى سارة (الدورة 2). المطابقة التلقائية: 1 ملاحظة للمراجعة.', at(-14, 40));
  chat(g1.id, 'SYSTEM', 'اعترضت سارة على تحويل نورة (الدورة 2): لم يظهر المبلغ في حسابي حتى الآن. ستراجعه إدارة المنصة.', at(-12));
  chat(g1.id, 'USER', 'تم التحويل من حسابي في البنك الأهلي، الإيصال مرفق. ممكن تتأكدين مرة ثانية؟', at(-12, 15), noura);
  chat(g1.id, 'USER', '@مساعد تقرير', at(-1, 5), sara);
  chat(g1.id, 'ASSISTANT', 'تقرير جمعية الأصدقاء: اكتمل 1 من 4 دورات، وتأكد 3 من 12 أقساط. بانتظار تأكيد: 2. اعتراض مفتوح على الدورة 2.', at(-1, 6));
  note(sara, g1.id, 'ACTION_NEEDED', 'أكّد استلام 2000.00 SAR من خالد', at(-15, 21));
  note(sara, g1.id, 'ACTION_NEEDED', 'راجع إيصال خالد (الدورة 3)', at(-1, 21));
  note(reem, g1.id, 'ACTION_NEEDED', 'اعتراض بانتظار قرار المنصة في «جمعية الأصدقاء»', at(-12, 1));

  // ── 2) جمعية العائلة — full, choose the order (draw or priority) ──
  const g2 = circle({ name: 'جمعية العائلة', contribution: '1500.00', memberCount: 3, startDate: iso(20), createdAt: at(-5), status: 'LOCKED', category: 'FAMILY' });
  join(g2, sara, 'MANAGER', at(-5)); const k2 = join(g2, khalid, 'MEMBER', at(-4)); const n2 = join(g2, noura, 'MEMBER', at(-3));
  db.priority[k2] = { preference: 'EARLY', neededBy: iso(50), reason: 'WEDDING', shareReason: true, note: 'موعد الزواج بعد شهرين' };
  db.priority[n2] = { preference: 'LATE', neededBy: null, reason: 'NONE', shareReason: false, note: null };
  chat(g2.id, 'SYSTEM', 'أُنشئت الجمعية (صغيرة). القبض لكل دورة 3000.00 SAR.', at(-5));
  chat(g2.id, 'SYSTEM', 'اكتمل العدد. يمكن للمنظم تجهيز القرعة الآن، أو اقتراح ترتيب بالاتفاق أو بالأولوية.', at(-3));
  chat(g2.id, 'USER', 'لو ممكن آخذ دوري بدري، عندي زواج بعد شهرين 🙏', at(-3, 10), khalid);
  note(sara, g2.id, 'ACTION_NEEDED', 'اكتمل عدد «جمعية العائلة»: اختر طريقة ترتيب القبض', at(-3, 1));

  // ── 3) جمعية الحي — recruiting (medium tier); invite code for the other personas ──
  const g3 = circle({ name: 'جمعية الحي', contribution: '5000.00', memberCount: 4, startDate: iso(35), createdAt: at(-2), tier: 'MEDIUM', category: 'HAJJ' });
  join(g3, sara, 'MANAGER', at(-2)); join(g3, fahad, 'MEMBER', at(-1));
  db.invitations.push({ code: 'HAYY2026', gamiyaId: g3.id, maxUses: 2, uses: 0, expiresAt: at(30) });
  chat(g3.id, 'SYSTEM', 'أُنشئت الجمعية (متوسطة). القبض لكل دورة 20000.00 SAR.', at(-2));
  chat(g3.id, 'SYSTEM', 'انضم فهد إلى الجمعية ووافق على الاتفاقية.', at(-1));

  // ── 4) الجمعية الكبيرة — large: promissory notes submitted, waiting for platform review ──
  const g4 = circle({ name: 'الجمعية الكبيرة', contribution: '30000.00', memberCount: 3, startDate: iso(40), createdAt: at(-8), status: 'LOCKED', tier: 'LARGE', platformApproval: 'PENDING', category: 'HOME' });
  join(g4, khalid, 'MANAGER', at(-8)); const s4 = join(g4, sara, 'MEMBER', at(-7)); const n4 = join(g4, noura, 'MEMBER', at(-7, 40));
  for (const [mid, uid, ref] of [[s4, sara, 'NOTE-4101'], [n4, noura, 'NOTE-4102']] as const) {
    const f = { id: uuid(), ownerId: uid, gamiyaId: g4.id, purpose: 'PROMISSORY_NOTE', mime: 'image/svg+xml', sha256: uuid(), dataUrl: doc('سند لأمر', ['لأمر: خالد (منظم الجمعية)', 'المبلغ: 90,000 ريال', `المرجع: ${ref}`], '#B45309') };
    db.files.push(f);
    db.notes.push({ id: uuid(), gamiyaId: g4.id, memberId: mid, fileId: f.id, reference: ref, amount: '90000.00', status: 'SUBMITTED' });
  }
  chat(g4.id, 'SYSTEM', 'أُنشئت الجمعية (كبيرة). القبض لكل دورة 90000.00 SAR. تتطلب سنداً لأمر من كل عضو واعتماد إدارة المنصة.', at(-8));
  chat(g4.id, 'SYSTEM', 'رفعت سارة ونورة السندات لأمر لصالح المنظم. طلب المنظم اعتماد إدارة المنصة.', at(-6));
  note(reem, g4.id, 'ACTION_NEEDED', 'جمعية كبيرة بانتظار مراجعة السندات: «الجمعية الكبيرة»', at(-6, 1));

  // ── 5) جمعية الجمعة — weekly, recruiting; invite code for the pledge-before-joining journey ──
  const fri = (() => { const d = new Date(`${iso(0)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (((5 - d.getUTCDay() + 7) % 7) || 7)); return d.toISOString().slice(0, 10); })();
  const g5 = circle({ name: 'جمعية الجمعة', contribution: '200.00', memberCount: 6, startDate: fri, createdAt: at(-1), frequency: 'WEEKLY', category: 'FRIDAY' });
  join(g5, noura, 'MANAGER', at(-1)); join(g5, khalid, 'MEMBER', at(-1, 30));
  db.invitations.push({ code: 'JUMAA26', gamiyaId: g5.id, maxUses: 4, uses: 0, expiresAt: at(30) });
  chat(g5.id, 'SYSTEM', 'أُنشئت الجمعية (صغيرة). القبض لكل دورة 1200.00 SAR، كل جمعة.', at(-1));

  // ── goals ──
  const goal = (userId: string, category: string, title: string, targetAmount: string, targetDate: string | null, gamiyaId: string | null) =>
    db.goals.push({ id: uuid(), userId, category, title, targetAmount, currency: 'SAR', targetDate, gamiyaId, status: 'ACTIVE', createdAt: at(-3) });
  goal(sara, 'HAJJ', 'حج العائلة', '20000.00', iso(150), g3.id);
  goal(sara, 'SCHOOL', 'رسوم المدرسة', '12000.00', iso(120), null);
  goal(khalid, 'WEDDING', 'تجهيز الزواج', '4500.00', iso(60), g2.id);

  return db;
}
