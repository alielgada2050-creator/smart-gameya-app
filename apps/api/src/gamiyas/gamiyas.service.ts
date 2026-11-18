import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { seal, unseal } from '../common/crypto.ts';
import { ChatService } from '../chat/chat.service.ts';
import { classifyPot } from '../../../../packages/financial-core/src/tiers.ts';
import { COUNTRIES, type Country } from '../../../../packages/financial-core/src/payout-methods.ts';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { CONFIG, type AppConfig } from '../common/config.ts';
import { Db, type Queryable } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { badRequest, conflict, forbidden, notFound } from '../common/http.ts';
import { parseMoney, formatMoney } from '../../../../packages/financial-core/src/money.ts';
import { generateSchedule, validateConfig, type Frequency } from '../../../../packages/financial-core/src/schedule.ts';
import {
  prepareDraw, executeDraw, verifyDraw, selectionProbability, type Candidate, type DrawRecord,
} from '../../../../packages/financial-core/src/lottery.ts';
import { PLEDGE_VERSION, pledgeClauses, pledgeHash, pledgeText, signatureMatches, type PledgeTerms } from '../../../../packages/financial-core/src/pledge.ts';

const AGREEMENT_FILE = new URL('../../../../../agreements/join-v1.ar.md', import.meta.url) // dist/apps/api/src/gamiyas → apps/api;
const dec = (minor: bigint, currency: string) => formatMoney(minor, currency).split(' ')[0];

export interface CreateGamiyaInput {
  name: string; currency: string; frequency: Frequency; contribution: string;
  memberCount: number; startDate: string; graceDays: number; agreementVersionId: string; country: Country;
  category?: string; pledge?: PledgeInput;
}
export interface PledgeInput { typedName: string; textSha256: string }
export interface Signer { ip: string | null; userAgent: string | null }
export const CATEGORIES = ['FAMILY', 'FRIENDS', 'WORK', 'SCHOOL', 'HAJJ', 'WEDDING', 'RAMADAN', 'FRIDAY', 'TRAVEL', 'HOME', 'CAR', 'OTHER'] as const;

@Injectable()
export class GamiyasService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: Audit, private readonly chat: ChatService, @Inject(CONFIG) private readonly config: AppConfig) {}

  /** Validate amounts + schedule and classify the tier from the payout value. Throws a 400 with a clear code. */
  assess(input: { country: Country; frequency: Frequency; contribution: string; memberCount: number; startDate: string }) {
    const country = COUNTRIES[input.country];
    if (!country) throw badRequest('COUNTRY_NOT_SUPPORTED', 'unsupported country');
    const currency = country.currency;
    const contribution = parseMoney(input.contribution, currency);
    const errors = validateConfig({ members: input.memberCount, contribution, currency, frequency: input.frequency, startDate: input.startDate, cycles: input.memberCount });
    if (errors.length) throw badRequest('INVALID_CIRCLE', errors.join('; '));
    const s = generateSchedule({ members: input.memberCount, contribution, currency, frequency: input.frequency, startDate: input.startDate });
    const t = classifyPot(s.potPerCycle, currency, this.config.tierLimits?.[currency]);
    if (!t.ok && t.reason === 'CURRENCY_NOT_ENABLED') throw badRequest('COUNTRY_NOT_ENABLED', `circles in ${input.country} are not enabled yet`);
    if (!t.ok) throw badRequest('ABOVE_MAXIMUM', `payout value is above the maximum ${dec(t.limits!.largeMax, currency)} ${currency}`);
    return { currency, contribution, schedule: s, tier: t };
  }

  // ---------- agreements ----------
  async onModuleInit() {
    const body = await readFile(AGREEMENT_FILE, 'utf8');
    const sha = createHash('sha256').update(body).digest('hex');
    await this.db.query(
      `INSERT INTO agreement_versions (template_code, version, locale, body_sha256, storage_key)
       VALUES ('JOIN','1.0','ar',$1,'agreements/join-v1.ar.md') ON CONFLICT (template_code, version, locale) DO NOTHING`, [sha]);
  }

  async currentAgreement() {
    const body = await readFile(AGREEMENT_FILE, 'utf8');
    const { rows } = await this.db.query(
      `SELECT id, template_code, version, locale, body_sha256 FROM agreement_versions WHERE template_code='JOIN' ORDER BY published_at DESC LIMIT 1`);
    return { ...rows[0], body };
  }

  async acceptAgreement(c: Queryable, userId: string, gamiyaId: string, versionId: string, ip: string | null) {
    const { rows } = await c.query(`SELECT id FROM agreement_versions WHERE id=$1 AND template_code='JOIN'`, [versionId]);
    if (!rows[0]) throw badRequest('AGREEMENT_REQUIRED', 'a valid JOIN agreement version must be accepted');
    await c.query(
      `INSERT INTO agreement_acceptances (agreement_version_id, user_id, gamiya_id, verification_method, ip_address)
       VALUES ($1,$2,$3,'OTP_SESSION',$4) ON CONFLICT DO NOTHING`, [versionId, userId, gamiyaId, ip]);
  }

  // ---------- membership & access ----------
  /** Returns the caller's membership or a 404 — non-members cannot even learn the circle exists (Scenario 08). */
  async membership(q: Queryable, gamiyaId: string, userId: string, lock = false) {
    const { rows } = await q.query(
      `SELECT m.id AS member_id, m.role, m.status AS member_status, g.* FROM gamiyas g JOIN gamiya_members m ON m.gamiya_id = g.id
       WHERE g.id=$1 AND m.user_id=$2 AND m.status <> 'WITHDRAWN' ${lock ? 'FOR UPDATE OF g' : ''}`, [gamiyaId, userId]);
    if (!rows[0]) throw notFound('gamiya');
    return rows[0];
  }

  requireManager(m: { role: string }) {
    if (m.role !== 'MANAGER') throw forbidden('only the circle manager can do this');
  }

  // ---------- pledge (إقرار وتعهد بالسداد) ----------
  /** The terms a member signs, rebuilt from stored values only (never from what the client sends). */
  pledgeTerms(g: { name: string; currency: string; contribution: string | number; member_count: number; frequency: Frequency; start_date: Date | string; terms_version: number },
    organizerName: string, memberName: string): PledgeTerms {
    const contribution = parseMoney(String(g.contribution), g.currency);
    const s = generateSchedule({ members: g.member_count, contribution, currency: g.currency, frequency: g.frequency, startDate: iso(g.start_date) });
    return {
      circleName: g.name, organizerName, memberName, currency: g.currency, contribution: dec(contribution, g.currency), memberCount: g.member_count,
      frequency: g.frequency as PledgeTerms['frequency'], installments: g.member_count - 1, startDate: iso(g.start_date), endDate: s.endDate,
      potPerCycle: dec(s.potPerCycle, g.currency), totalCommitment: dec(contribution * BigInt(g.member_count - 1), g.currency), termsVersion: g.terms_version,
    };
  }

  pledgeView(t: PledgeTerms) {
    return { pledgeVersion: PLEDGE_VERSION, terms: t, clauses: pledgeClauses(t), text: pledgeText(t), textSha256: pledgeHash(t) };
  }

  async names(q: Queryable, gamiyaId: string, userId: string) {
    const r = (await q.query(
      `SELECT (SELECT u.full_name FROM gamiya_members m JOIN users u ON u.id = m.user_id WHERE m.gamiya_id=$1 AND m.role='MANAGER') AS organizer,
              (SELECT full_name FROM users WHERE id=$2) AS me`, [gamiyaId, userId])).rows[0];
    return { organizer: r.organizer as string, me: r.me as string };
  }

  /** Verify the member signed exactly the text built from the current terms, then keep it as evidence (append-only). */
  async signPledge(c: Queryable, userId: string, gamiyaId: string, t: PledgeTerms, p: PledgeInput | undefined, who: Signer) {
    if (!p) throw badRequest('PLEDGE_REQUIRED', 'read and sign the payment pledge first');
    if (p.textSha256 !== pledgeHash(t)) throw conflict('PLEDGE_OUTDATED', 'the circle terms changed; read the pledge again');
    if (!signatureMatches(p.typedName, t.memberName)) throw badRequest('SIGNATURE_MISMATCH', 'type your full name exactly as registered');
    await c.query(
      `INSERT INTO pledges (user_id, gamiya_id, terms_version, pledge_version, text_sha256, typed_name, terms, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id, gamiya_id, terms_version) DO NOTHING`,
      [userId, gamiyaId, t.termsVersion, PLEDGE_VERSION, pledgeHash(t), p.typedName.trim(), JSON.stringify(t), who.ip, who.userAgent?.slice(0, 300) ?? null]);
  }

  /** Pledge for a circle that does not exist yet (the create wizard): the creator is organizer and member. */
  async createPledgePreview(userId: string, input: Omit<CreateGamiyaInput, 'agreementVersionId' | 'graceDays' | 'currency'>) {
    const a = this.assess(input);
    const me = (await this.db.query(`SELECT full_name FROM users WHERE id=$1`, [userId])).rows[0].full_name;
    return this.pledgeView(this.pledgeTerms({ name: input.name, currency: a.currency, contribution: dec(a.contribution, a.currency), member_count: input.memberCount,
      frequency: input.frequency, start_date: input.startDate, terms_version: 1 }, me, me));
  }

  async currentPledge(gamiyaId: string, userId: string) {
    const g = await this.membership(this.db, gamiyaId, userId);
    const n = await this.names(this.db, gamiyaId, userId);
    const signed = (await this.db.query(`SELECT signed_at FROM pledges WHERE user_id=$1 AND gamiya_id=$2 AND terms_version=$3`, [userId, gamiyaId, g.terms_version])).rows[0];
    return { ...this.pledgeView(this.pledgeTerms(g, n.organizer, n.me)), signedAt: signed?.signed_at ?? null };
  }

  /** What a person holding an invite code sees before joining: the circle in numbers and the pledge they would sign. */
  async invitationPreview(code: string, userId: string) {
    const inv = (await this.db.query(
      `SELECT i.*, g.name, g.currency, g.contribution, g.member_count, g.frequency, g.start_date, g.terms_version, g.status, g.category, g.tier,
              (SELECT count(*)::int FROM gamiya_members x WHERE x.gamiya_id = g.id AND x.status IN ('ACTIVE','PENDING_APPROVAL')) AS joined,
              (SELECT x.status FROM gamiya_members x WHERE x.gamiya_id = g.id AND x.user_id = $2) AS my_status
       FROM gamiya_invitations i JOIN gamiyas g ON g.id = i.gamiya_id WHERE i.code=$1`, [code, userId])).rows[0];
    if (!inv || inv.uses >= inv.max_uses || new Date(inv.expires_at) < new Date() || inv.status !== 'RECRUITING') throw notFound('invitation');
    const n = await this.names(this.db, inv.gamiya_id, userId);
    const t = this.pledgeTerms(inv, n.organizer, n.me);
    return {
      circle: { name: inv.name, organizerName: n.organizer, category: inv.category, tier: inv.tier, currency: inv.currency, contribution: t.contribution, memberCount: inv.member_count,
        joined: inv.joined, frequency: inv.frequency, startDate: t.startDate, endDate: t.endDate, potPerCycle: t.potPerCycle },
      alreadyMember: inv.my_status != null && inv.my_status !== 'WITHDRAWN',
      pledge: this.pledgeView(t),
    };
  }

  // ---------- circles ----------
  async create(userId: string, input: CreateGamiyaInput, who: Signer, cid: string) {
    const ip = who.ip;
    const a = this.assess(input);
    if (!a.tier.ok) throw badRequest('INVALID_CIRCLE', 'invalid tier');
    return this.db.tx(async (c) => {
      const g = (await c.query(
        `INSERT INTO gamiyas (creator_id, name, currency, country, frequency, contribution, member_count, cycle_count, start_date, grace_days, ordering, status, tier, platform_approval, category)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,'LOTTERY','RECRUITING',$10,$11,$12) RETURNING *`,
        [userId, input.name, a.currency, input.country, input.frequency, dec(a.contribution, a.currency), input.memberCount, input.startDate, input.graceDays,
         a.tier.tier, a.tier.requiresPlatformApproval ? 'AWAITING_NOTES' : 'NOT_REQUIRED', input.category ?? 'OTHER'])).rows[0];
      const me = (await c.query(`SELECT full_name FROM users WHERE id=$1`, [userId])).rows[0].full_name;
      await this.signPledge(c, userId, g.id, this.pledgeTerms(g, me, me), input.pledge, who);
      await this.chat.post(c, { gamiyaId: g.id, kind: 'SYSTEM', body: `أُنشئت الجمعية (${tierAr[a.tier.tier]}). القبض لكل دورة ${dec(a.schedule.potPerCycle, a.currency)} ${a.currency}.`, refEntity: 'gamiya', refId: g.id });
      await c.query(`INSERT INTO gamiya_members (gamiya_id, user_id, role, status, joined_at) VALUES ($1,$2,'MANAGER','ACTIVE',now())`, [g.id, userId]);
      await this.acceptAgreement(c, userId, g.id, input.agreementVersionId, ip);
      await this.audit.log(c, { actorId: userId, action: 'GAMIYA_CREATED', entity: 'gamiya', entityId: g.id, correlationId: cid });
      return this.details(c, g.id, userId);
    });
  }

  /** Server-side preview for the create form: the UI never computes amounts or dates itself. */
  preview(input: Omit<CreateGamiyaInput, 'name' | 'agreementVersionId' | 'graceDays' | 'currency'>) {
    const { currency, schedule: s, tier } = this.assess(input);
    if (!tier.ok) throw badRequest('INVALID_CIRCLE', 'invalid tier');
    return {
      currency, tier: tier.tier, requiresPlatformApproval: tier.requiresPlatformApproval, requiresPromissoryNotes: tier.requiresPromissoryNotes,
      tierLimits: { smallMax: dec(tier.limits.smallMax, currency), mediumMax: dec(tier.limits.mediumMax, currency), largeMax: dec(tier.limits.largeMax, currency) },
      potPerCycle: dec(s.potPerCycle, currency), totalVolume: dec(s.totalVolume, currency), endDate: s.endDate,
      cycles: s.cycles.map((c) => ({ cycle: c.index, dueDate: c.dueDate })),
    };
  }

  async listMine(userId: string) {
    const { rows } = await this.db.query(
      `SELECT g.id, g.name, g.currency, g.country, g.tier, g.platform_approval, g.frequency, g.contribution, g.member_count, g.start_date, g.status, g.category, m.role, m.payout_position, m.status AS member_status,
              (SELECT count(*)::int FROM gamiya_members x WHERE x.gamiya_id = g.id AND x.status IN ('ACTIVE','PENDING_APPROVAL')) AS joined,
              (SELECT c.due_date FROM gamiya_cycles c WHERE c.gamiya_id = g.id AND c.recipient_member_id = m.id) AS my_payout_date
       FROM gamiyas g JOIN gamiya_members m ON m.gamiya_id = g.id WHERE m.user_id=$1 AND m.status <> 'WITHDRAWN' ORDER BY g.created_at DESC`, [userId]);
    return rows.map(toCircleSummary);
  }

  async details(q: Queryable, gamiyaId: string, userId: string) {
    const g = await this.membership(q, gamiyaId, userId);
    const members = (await q.query(
      `SELECT m.id, u.full_name, m.role, m.payout_position, m.status,
              EXISTS (SELECT 1 FROM pledges p WHERE p.user_id = m.user_id AND p.gamiya_id = m.gamiya_id AND p.terms_version = $2) AS pledged
       FROM gamiya_members m JOIN users u ON u.id = m.user_id
       WHERE m.gamiya_id=$1 AND m.status <> 'WITHDRAWN' ORDER BY m.payout_position NULLS LAST, m.joined_at`, [gamiyaId, g.terms_version])).rows;
    const contribution = parseMoney(g.contribution, g.currency);
    const sched = generateSchedule({ members: g.member_count, contribution, currency: g.currency, frequency: g.frequency, startDate: iso(g.start_date) });
    return {
      ...toCircleSummary({ ...g, joined: members.length, member_status: g.member_status, payout_position: members.find((m) => m.id === g.member_id)?.payout_position }),
      myMemberId: g.member_id,
      platformReviewNote: g.platform_review_note,
      notes: g.tier === 'LARGE' ? (await q.query(
        `SELECT m.id AS member_id, n.status, n.reference FROM gamiya_members m LEFT JOIN promissory_notes n ON n.member_id = m.id
         WHERE m.gamiya_id = $1 AND m.role <> 'MANAGER' AND m.status <> 'WITHDRAWN'`, [gamiyaId])).rows.map((r) => ({ memberId: r.member_id, status: r.status ?? 'MISSING', reference: r.member_id === g.member_id || g.role === 'MANAGER' ? r.reference : null })) : null,
      graceDays: g.grace_days, category: g.category, termsVersion: g.terms_version, myMemberStatus: g.member_status,
      orderingMethod: g.ordering,
      potPerCycle: dec(sched.potPerCycle, g.currency),
      endDate: sched.endDate,
      // phone numbers and documents of other members are never exposed here
      members: members.map((m) => ({ memberId: m.id, fullName: m.full_name, role: m.role, payoutPosition: m.payout_position, status: m.status, pledged: m.pledged })),
    };
  }

  async createInvitation(gamiyaId: string, userId: string, maxUses: number, expiresInHours: number, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.membership(c, gamiyaId, userId);
      this.requireManager(g);
      if (g.status !== 'RECRUITING') throw conflict('NOT_RECRUITING', 'circle is not accepting members');
      const code = randomBytes(9).toString('base64url');
      await c.query(
        `INSERT INTO gamiya_invitations (gamiya_id, code, invited_by, expires_at, max_uses) VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5)`,
        [gamiyaId, code, userId, expiresInHours, maxUses]);
      await this.audit.log(c, { actorId: userId, action: 'INVITATION_CREATED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid });
      return { code, maxUses, expiresInHours };
    });
  }

  async acceptInvitation(code: string, userId: string, agreementVersionId: string, pledge: PledgeInput | undefined, who: Signer, cid: string) {
    const ip = who.ip;
    return this.db.tx(async (c) => {
      const inv = (await c.query(`SELECT * FROM gamiya_invitations WHERE code=$1 FOR UPDATE`, [code])).rows[0];
      if (!inv || inv.uses >= inv.max_uses || new Date(inv.expires_at) < new Date()) throw notFound('invitation');
      const g = (await c.query(`SELECT * FROM gamiyas WHERE id=$1 FOR UPDATE`, [inv.gamiya_id])).rows[0];
      if (g.status !== 'RECRUITING') throw conflict('NOT_RECRUITING', 'circle is not accepting members');
      const already = (await c.query(`SELECT status FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2`, [g.id, userId])).rows[0];
      if (already && already.status !== 'WITHDRAWN') throw conflict('ALREADY_MEMBER', 'you are already a member of this circle');
      const count = Number((await c.query(`SELECT count(*) FROM gamiya_members WHERE gamiya_id=$1 AND status IN ('ACTIVE','PENDING_APPROVAL')`, [g.id])).rows[0].count);
      if (count >= g.member_count) throw conflict('CIRCLE_FULL', 'circle is full');
      const n = await this.names(c, g.id, userId);
      await this.signPledge(c, userId, g.id, this.pledgeTerms(g, n.organizer, n.me), pledge, who);
      await this.acceptAgreement(c, userId, g.id, agreementVersionId, ip);
      if (already) await c.query(`UPDATE gamiya_members SET status='ACTIVE', joined_at=now(), payout_position=NULL WHERE gamiya_id=$1 AND user_id=$2`, [g.id, userId]);
      else await c.query(`INSERT INTO gamiya_members (gamiya_id, user_id, role, status, joined_at) VALUES ($1,$2,'MEMBER','ACTIVE',now())`, [g.id, userId]);
      await c.query(`UPDATE direct_invitations d SET status='ACCEPTED', responded_at=now() FROM users me
                     WHERE me.id=$2 AND d.gamiya_id=$1 AND d.status='PENDING' AND (d.invited_user_id = me.id OR d.phone_e164 = me.phone_e164)`, [g.id, userId]);
      await c.query(`UPDATE gamiya_invitations SET uses = uses + 1 WHERE id=$1`, [inv.id]);
      const joiner = (await c.query(`SELECT full_name FROM users WHERE id=$1`, [userId])).rows[0];
      await this.chat.post(c, { gamiyaId: g.id, kind: 'SYSTEM', body: `انضم ${joiner.full_name} إلى الجمعية ووقّع إقرار وتعهّد السداد.`, refEntity: 'member', refId: userId });
      if (count + 1 === g.member_count) {
        await c.query(`UPDATE gamiyas SET status='LOCKED' WHERE id=$1`, [g.id]);
        await this.chat.post(c, { gamiyaId: g.id, kind: 'SYSTEM', body: g.tier === 'LARGE'
          ? 'اكتمل العدد. جمعية كبيرة: على كل عضو رفع سند لأمر لصالح المنظم، ثم يطلب المنظم اعتماد إدارة المنصة قبل القرعة.'
          : 'اكتمل العدد. يمكن للمنظم تجهيز القرعة الآن.', refEntity: 'gamiya', refId: g.id });
        await this.audit.log(c, { actorId: userId, action: 'GAMIYA_LOCKED', entity: 'gamiya', entityId: g.id, correlationId: cid });
      }
      await this.audit.log(c, { actorId: userId, action: 'MEMBER_JOINED', entity: 'gamiya', entityId: g.id, correlationId: cid });
      return this.details(c, g.id, userId);
    });
  }

  // ---------- lottery ----------
  private async candidates(q: Queryable, gamiyaId: string): Promise<Candidate[]> {
    const { rows } = await q.query(`SELECT id FROM gamiya_members WHERE gamiya_id=$1 AND status='ACTIVE'`, [gamiyaId]);
    return rows.map((r) => ({ memberId: r.id, eligible: true }));
  }

  private seal(seedHex: string): string { return seal(this.config.lotterySeedKey, seedHex, 'lottery-seed'); }
  private unseal(sealed: string): string { return unseal(this.config.lotterySeedKey, sealed, 'lottery-seed'); }

  /** Trial draw: same algorithm, nothing persisted, clearly labelled. */
  async trialDraw(gamiyaId: string, userId: string) {
    const g = await this.membership(this.db, gamiyaId, userId);
    const cands = await this.candidates(this.db, gamiyaId);
    const rec = executeDraw(prepareDraw(g.id, cands), { publicEntropy: `trial:${Date.now()}`, executedBy: userId, approvedBy: userId, isTrial: true });
    return { isTrial: true, note: 'trial result only — not binding and not stored', order: rec.order, verification: verifyDraw(rec) };
  }

  async prepareLottery(gamiyaId: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.membership(c, gamiyaId, userId, true);
      this.requireManager(g);
      if (g.status !== 'LOCKED') throw conflict('NOT_LOCKED', 'the circle must be full before the official draw');
      if (g.tier === 'LARGE' && g.platform_approval !== 'APPROVED') throw conflict('PLATFORM_APPROVAL_REQUIRED', 'large circles need platform approval of the promissory notes before the draw');
      const existing = (await c.query(`SELECT id FROM lottery_sessions WHERE gamiya_id=$1 AND NOT is_trial`, [gamiyaId])).rows[0];
      if (existing) throw conflict('LOTTERY_EXISTS', 'the official draw was already prepared');
      const open = (await c.query(`SELECT 1 FROM order_proposals WHERE gamiya_id=$1 AND status='OPEN'`, [gamiyaId])).rows[0];
      if (open) throw conflict('ORDER_PROPOSAL_OPEN', 'withdraw the open order proposal before choosing the lottery');
      const prep = prepareDraw(gamiyaId, await this.candidates(c, gamiyaId));
      const s = (await c.query(
        `INSERT INTO lottery_sessions (gamiya_id, algorithm_version, commitment_sha256, candidates, seed_ciphertext, prepared_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, prepared_at`,
        [gamiyaId, prep.algorithmVersion, prep.commitment, JSON.stringify(prep.candidates), this.seal(prep.seedHex), userId])).rows[0];
      await this.audit.log(c, { actorId: userId, action: 'LOTTERY_PREPARED', entity: 'lottery_session', entityId: s.id, correlationId: cid, details: { commitment: prep.commitment } });
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: `جُهّزت القرعة. البصمة المعلنة: ${prep.commitment}`, refEntity: 'lottery_session', refId: s.id });
      return {
        sessionId: s.id, algorithmVersion: prep.algorithmVersion, commitment: prep.commitment,
        probabilities: selectionProbability(prep.candidates),
        nextStep: 'another member must approve, then the manager executes with public entropy announced at draw time',
      };
    });
  }

  async approveLottery(gamiyaId: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      await this.membership(c, gamiyaId, userId);
      const s = (await c.query(`SELECT s.id, s.prepared_by, r.session_id AS done FROM lottery_sessions s LEFT JOIN lottery_results r ON r.session_id = s.id
                                WHERE s.gamiya_id=$1 AND NOT s.is_trial`, [gamiyaId])).rows[0];
      if (!s) throw conflict('NO_LOTTERY', 'no prepared draw');
      if (s.done) throw conflict('LOTTERY_DONE', 'draw already executed');
      if (s.prepared_by === userId) throw forbidden('maker–checker: the preparer cannot approve their own draw');
      await c.query(`INSERT INTO lottery_approvals (session_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [s.id, userId]);
      await this.audit.log(c, { actorId: userId, action: 'LOTTERY_APPROVED', entity: 'lottery_session', entityId: s.id, correlationId: cid });
      return { approved: true };
    });
  }

  async executeLottery(gamiyaId: string, userId: string, publicEntropy: string, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.membership(c, gamiyaId, userId, true);
      this.requireManager(g);
      const s = (await c.query(`SELECT * FROM lottery_sessions WHERE gamiya_id=$1 AND NOT is_trial`, [gamiyaId])).rows[0];
      if (!s) throw conflict('NO_LOTTERY', 'no prepared draw');
      if ((await c.query(`SELECT 1 FROM lottery_results WHERE session_id=$1`, [s.id])).rows[0]) throw conflict('LOTTERY_DONE', 'draw already executed');
      const approver = (await c.query(`SELECT user_id FROM lottery_approvals WHERE session_id=$1 AND user_id <> $2 ORDER BY approved_at LIMIT 1`, [s.id, userId])).rows[0];
      if (!approver) throw conflict('APPROVAL_REQUIRED', 'at least one other member must approve the draw first');

      const rec = executeDraw(
        { circleId: gamiyaId, algorithmVersion: s.algorithm_version, candidates: s.candidates, commitment: s.commitment_sha256, seedHex: this.unseal(s.seed_ciphertext), preparedAt: s.prepared_at },
        { publicEntropy, executedBy: userId, approvedBy: approver.user_id });
      await c.query(
        `INSERT INTO lottery_results (session_id, revealed_seed_hex, public_entropy, result_order, executed_by, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [s.id, rec.revealedSeedHex, publicEntropy, JSON.stringify(rec.order), userId, approver.user_id]);

      for (const o of rec.order) await c.query(`UPDATE gamiya_members SET payout_position=$1 WHERE id=$2`, [o.position, o.memberId]);
      await this.materializeSchedule(c, g);
      await c.query(`UPDATE gamiyas SET status='ACTIVE' WHERE id=$1`, [gamiyaId]);
      const names = new Map((await c.query(`SELECT m.id, u.full_name FROM gamiya_members m JOIN users u ON u.id = m.user_id WHERE m.gamiya_id=$1`, [gamiyaId])).rows.map((r) => [r.id, r.full_name]));
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: `تمت القرعة وتحقق النظام من مطابقتها للبصمة. الترتيب: ${rec.order.map((o) => `${o.position}. ${names.get(o.memberId)}`).join('، ')}`, refEntity: 'lottery_session', refId: s.id });
      // Everyone hears about it, not only those watching: the result card in the chat replays the wheel from this record.
      const everyone = (await c.query(`SELECT user_id FROM gamiya_members WHERE gamiya_id=$1 AND status <> 'WITHDRAWN'`, [gamiyaId])).rows.map((r) => r.user_id);
      await this.chat.notify(c, everyone, { gamiyaId, kind: 'LOTTERY_DONE', body: `تمت قرعة «${g.name}». افتح الجمعية لمشاهدة العجلة والنتيجة.` });
      await this.audit.log(c, { actorId: userId, action: 'LOTTERY_EXECUTED', entity: 'lottery_session', entityId: s.id, correlationId: cid, details: { approvedBy: approver.user_id } });
      return { record: this.publicRecord(rec), verification: verifyDraw(rec) };
    });
  }

  /**
   * Invite all members to watch the official draw live. Transparency only: it changes nothing about the draw itself,
   * whose result is fixed by the published fingerprint and the organizer's public phrase.
   */
  async inviteToDraw(gamiyaId: string, userId: string, at: string | undefined, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.membership(c, gamiyaId, userId, true);
      this.requireManager(g);
      if (g.status !== 'LOCKED') throw conflict('NOT_LOCKED', 'invite members once the circle is full and before the draw');
      if (at) {
        const t = new Date(at).getTime();
        if (t < Date.now() - 60_000 || t > Date.now() + 30 * 86400_000) throw badRequest('INVALID_TIME', 'choose a time within the next 30 days');
      }
      const s = (await c.query(`SELECT s.id, s.commitment_sha256, r.session_id AS done FROM lottery_sessions s LEFT JOIN lottery_results r ON r.session_id = s.id
                                WHERE s.gamiya_id=$1 AND NOT s.is_trial`, [gamiyaId])).rows[0];
      if (s?.done) throw conflict('LOTTERY_DONE', 'draw already executed');
      const when = at ? new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(at)) : null;
      const body = `دعوة لمشاهدة القرعة الرسمية${when ? ` ${when}` : ' الآن'}. افتحوا صفحة «${g.name}» لتشاهدوا العجلة معاً.`
        + (s ? ` النتيجة محسومة سلفاً بالبصمة المعلنة ${s.commitment_sha256.slice(0, 16)}… ويمكن لأي عضو التحقق منها.` : '');
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body, refEntity: 'lottery_invite', refId: s?.id ?? gamiyaId });
      const others = (await c.query(`SELECT user_id FROM gamiya_members WHERE gamiya_id=$1 AND user_id <> $2 AND status <> 'WITHDRAWN'`, [gamiyaId, userId])).rows.map((r) => r.user_id);
      await this.chat.notify(c, others, { gamiyaId, kind: 'LOTTERY_INVITE', body: when ? `قرعة «${g.name}» ${when}: شاهدها مباشرة` : `قرعة «${g.name}» الآن: شاهدها مباشرة` });
      await this.audit.log(c, { actorId: userId, action: 'LOTTERY_INVITE', entity: 'gamiya', entityId: gamiyaId, correlationId: cid, details: { at: at ?? null } });
      return { invited: others.length, at: at ?? null };
    });
  }

  /** Start the circle with an order the members agreed on (see ordering module). Positions follow the array order. */
  async activateWithOrder(c: pg.PoolClient, gamiyaId: string, memberOrder: string[], method: 'CONSENSUS' | 'PREFERENCE') {
    const g = (await c.query(`SELECT * FROM gamiyas WHERE id=$1 FOR UPDATE`, [gamiyaId])).rows[0];
    if (g.status !== 'LOCKED') throw conflict('NOT_LOCKED', 'the circle must be full and not yet started');
    for (const [i, id] of memberOrder.entries()) await c.query(`UPDATE gamiya_members SET payout_position=$1 WHERE id=$2 AND gamiya_id=$3`, [i + 1, id, gamiyaId]);
    await this.materializeSchedule(c, g);
    await c.query(`UPDATE gamiyas SET status='ACTIVE', ordering=$2 WHERE id=$1`, [gamiyaId, method]);
  }

  /** Due date of each cycle, in order. */
  cycleDates(g: any): string[] {
    const sched = generateSchedule({ members: g.member_count, contribution: parseMoney(g.contribution, g.currency), currency: g.currency, frequency: g.frequency, startDate: iso(g.start_date) });
    return sched.cycles.map((c) => c.dueDate);
  }

  /** Cycles + installments. In model A each member pays the cycle recipient directly; the recipient owes no installment to themselves. */
  private async materializeSchedule(c: pg.PoolClient, g: any) {
    const contribution = parseMoney(g.contribution, g.currency);
    const sched = generateSchedule({ members: g.member_count, contribution, currency: g.currency, frequency: g.frequency, startDate: iso(g.start_date) });
    const members = (await c.query(`SELECT id, payout_position FROM gamiya_members WHERE gamiya_id=$1 AND status = 'ACTIVE'`, [g.id])).rows;
    for (const cy of sched.cycles) {
      const recipient = members.find((m) => m.payout_position === cy.payoutPosition);
      const cycle = (await c.query(
        `INSERT INTO gamiya_cycles (gamiya_id, cycle_index, due_date, pot_amount, recipient_member_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [g.id, cy.index, cy.dueDate, dec(cy.expectedCollection, g.currency), recipient.id])).rows[0];
      for (const m of members) {
        if (m.id === recipient.id) continue;
        await c.query(`INSERT INTO gamiya_installments (cycle_id, member_id, amount_due) VALUES ($1,$2,$3)`, [cycle.id, m.id, dec(contribution, g.currency)]);
      }
    }
  }

  async lotteryStatus(gamiyaId: string, userId: string) {
    await this.membership(this.db, gamiyaId, userId);
    const s = (await this.db.query(
      `SELECT s.id, s.algorithm_version, s.commitment_sha256, s.candidates, s.prepared_at,
              r.revealed_seed_hex, r.public_entropy, r.result_order, r.executed_by, r.approved_by, r.executed_at,
              (SELECT count(*)::int FROM lottery_approvals a WHERE a.session_id = s.id) AS approvals,
              s.prepared_by = $2 AS prepared_by_me,
              EXISTS (SELECT 1 FROM lottery_approvals a WHERE a.session_id = s.id AND a.user_id = $2) AS approved_by_me
       FROM lottery_sessions s LEFT JOIN lottery_results r ON r.session_id = s.id WHERE s.gamiya_id=$1 AND NOT s.is_trial`, [gamiyaId, userId])).rows[0];
    if (!s) return { state: 'NOT_PREPARED' };
    if (!s.revealed_seed_hex) return { state: 'PREPARED', sessionId: s.id, commitment: s.commitment_sha256, algorithmVersion: s.algorithm_version, approvals: s.approvals, preparedByMe: s.prepared_by_me, approvedByMe: s.approved_by_me };
    const rec: DrawRecord = {
      circleId: gamiyaId, algorithmVersion: s.algorithm_version, candidates: s.candidates, commitment: s.commitment_sha256,
      revealedSeedHex: s.revealed_seed_hex, publicEntropy: s.public_entropy, order: s.result_order,
      executedAt: new Date(s.executed_at).toISOString(), executedBy: s.executed_by, approvedBy: s.approved_by, isTrial: false,
    };
    return { state: 'EXECUTED', record: this.publicRecord(rec), verification: verifyDraw(rec) };
  }

  private publicRecord(r: DrawRecord) {
    return { ...r, howToVerify: 'sha256(revealedSeedHex) must equal commitment; recompute order with sg-lottery/1.0.0 (packages/financial-core/src/lottery.ts verifyDraw)' };
  }
}

export const tierAr: Record<string, string> = { SMALL: 'صغيرة', MEDIUM: 'متوسطة', LARGE: 'كبيرة' };

export function iso(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  // pg returns DATE as a local-midnight Date; format with local components to avoid a TZ shift
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toCircleSummary(g: any) {
  return {
    id: g.id, name: g.name, currency: g.currency, country: g.country, tier: g.tier, platformApproval: g.platform_approval, frequency: g.frequency, contribution: g.contribution,
    memberCount: g.member_count, joined: g.joined, startDate: iso(g.start_date), status: g.status, category: g.category ?? 'OTHER',
    myRole: g.role, myPayoutPosition: g.payout_position ?? null, myMemberStatus: g.member_status ?? null,
    potPerCycle: dec(parseMoney(String(g.contribution), g.currency) * BigInt(g.member_count), g.currency),
    myPayoutDate: g.my_payout_date ? iso(g.my_payout_date) : null,
  };
}
