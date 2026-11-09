import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
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

const AGREEMENT_FILE = new URL('../../../../../agreements/join-v1.ar.md', import.meta.url) // dist/apps/api/src/gamiyas → apps/api;
const dec = (minor: bigint, currency: string) => formatMoney(minor, currency).split(' ')[0];

export interface CreateGamiyaInput {
  name: string; currency: string; frequency: Frequency; contribution: string;
  memberCount: number; startDate: string; graceDays: number; agreementVersionId: string;
}

@Injectable()
export class GamiyasService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: Audit, @Inject(CONFIG) private readonly config: AppConfig) {}

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

  private async acceptAgreement(c: Queryable, userId: string, gamiyaId: string, versionId: string, ip: string | null) {
    const { rows } = await c.query(`SELECT id FROM agreement_versions WHERE id=$1 AND template_code='JOIN'`, [versionId]);
    if (!rows[0]) throw badRequest('AGREEMENT_REQUIRED', 'a valid JOIN agreement version must be accepted');
    await c.query(
      `INSERT INTO agreement_acceptances (agreement_version_id, user_id, gamiya_id, verification_method, ip_address)
       VALUES ($1,$2,$3,'OTP_SESSION',$4)`, [versionId, userId, gamiyaId, ip]);
  }

  // ---------- membership & access ----------
  /** Returns the caller's membership or a 404 — non-members cannot even learn the circle exists (Scenario 08). */
  async membership(q: Queryable, gamiyaId: string, userId: string, lock = false) {
    const { rows } = await q.query(
      `SELECT m.id AS member_id, m.role, g.* FROM gamiyas g JOIN gamiya_members m ON m.gamiya_id = g.id
       WHERE g.id=$1 AND m.user_id=$2 ${lock ? 'FOR UPDATE OF g' : ''}`, [gamiyaId, userId]);
    if (!rows[0]) throw notFound('gamiya');
    return rows[0];
  }

  private requireManager(m: { role: string }) {
    if (m.role !== 'MANAGER') throw forbidden('only the circle manager can do this');
  }

  // ---------- circles ----------
  async create(userId: string, input: CreateGamiyaInput, ip: string | null, cid: string) {
    const contribution = parseMoney(input.contribution, input.currency);
    const errors = validateConfig({ members: input.memberCount, contribution, currency: input.currency, frequency: input.frequency, startDate: input.startDate, cycles: input.memberCount });
    if (errors.length) throw badRequest('INVALID_CIRCLE', errors.join('; '));
    return this.db.tx(async (c) => {
      const g = (await c.query(
        `INSERT INTO gamiyas (creator_id, name, currency, frequency, contribution, member_count, cycle_count, start_date, grace_days, ordering, status)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'LOTTERY','RECRUITING') RETURNING id`,
        [userId, input.name, input.currency, input.frequency, dec(contribution, input.currency), input.memberCount, input.startDate, input.graceDays])).rows[0];
      await c.query(`INSERT INTO gamiya_members (gamiya_id, user_id, role, status, joined_at) VALUES ($1,$2,'MANAGER','ACTIVE',now())`, [g.id, userId]);
      await this.acceptAgreement(c, userId, g.id, input.agreementVersionId, ip);
      await this.audit.log(c, { actorId: userId, action: 'GAMIYA_CREATED', entity: 'gamiya', entityId: g.id, correlationId: cid });
      return this.details(c, g.id, userId);
    });
  }

  async listMine(userId: string) {
    const { rows } = await this.db.query(
      `SELECT g.id, g.name, g.currency, g.frequency, g.contribution, g.member_count, g.start_date, g.status, m.role, m.payout_position,
              (SELECT count(*)::int FROM gamiya_members x WHERE x.gamiya_id = g.id) AS joined
       FROM gamiyas g JOIN gamiya_members m ON m.gamiya_id = g.id WHERE m.user_id=$1 ORDER BY g.created_at DESC`, [userId]);
    return rows.map(toCircleSummary);
  }

  async details(q: Queryable, gamiyaId: string, userId: string) {
    const g = await this.membership(q, gamiyaId, userId);
    const members = (await q.query(
      `SELECT m.id, u.full_name, m.role, m.payout_position, m.status FROM gamiya_members m JOIN users u ON u.id = m.user_id
       WHERE m.gamiya_id=$1 ORDER BY m.payout_position NULLS LAST, m.joined_at`, [gamiyaId])).rows;
    const contribution = parseMoney(g.contribution, g.currency);
    const sched = generateSchedule({ members: g.member_count, contribution, currency: g.currency, frequency: g.frequency, startDate: iso(g.start_date) });
    return {
      ...toCircleSummary({ ...g, joined: members.length, payout_position: members.find((m) => m.id === g.member_id)?.payout_position }),
      graceDays: g.grace_days,
      orderingMethod: g.ordering,
      potPerCycle: dec(sched.potPerCycle, g.currency),
      endDate: sched.endDate,
      // phone numbers and documents of other members are never exposed here
      members: members.map((m) => ({ memberId: m.id, fullName: m.full_name, role: m.role, payoutPosition: m.payout_position, status: m.status })),
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

  async acceptInvitation(code: string, userId: string, agreementVersionId: string, ip: string | null, cid: string) {
    return this.db.tx(async (c) => {
      const inv = (await c.query(`SELECT * FROM gamiya_invitations WHERE code=$1 FOR UPDATE`, [code])).rows[0];
      if (!inv || inv.uses >= inv.max_uses || new Date(inv.expires_at) < new Date()) throw notFound('invitation');
      const g = (await c.query(`SELECT * FROM gamiyas WHERE id=$1 FOR UPDATE`, [inv.gamiya_id])).rows[0];
      if (g.status !== 'RECRUITING') throw conflict('NOT_RECRUITING', 'circle is not accepting members');
      const already = (await c.query(`SELECT 1 FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2`, [g.id, userId])).rows[0];
      if (already) throw conflict('ALREADY_MEMBER', 'you are already a member of this circle');
      const count = Number((await c.query(`SELECT count(*) FROM gamiya_members WHERE gamiya_id=$1`, [g.id])).rows[0].count);
      if (count >= g.member_count) throw conflict('CIRCLE_FULL', 'circle is full');
      await this.acceptAgreement(c, userId, g.id, agreementVersionId, ip);
      await c.query(`INSERT INTO gamiya_members (gamiya_id, user_id, role, status, joined_at) VALUES ($1,$2,'MEMBER','ACTIVE',now())`, [g.id, userId]);
      await c.query(`UPDATE gamiya_invitations SET uses = uses + 1 WHERE id=$1`, [inv.id]);
      if (count + 1 === g.member_count) {
        await c.query(`UPDATE gamiyas SET status='LOCKED' WHERE id=$1`, [g.id]);
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

  private seal(seedHex: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.lotterySeedKey, iv);
    const ct = Buffer.concat([cipher.update(seedHex, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
  }

  private unseal(sealed: string): string {
    const [iv, tag, ct] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = createDecipheriv('aes-256-gcm', this.config.lotterySeedKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  }

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
      const existing = (await c.query(`SELECT id FROM lottery_sessions WHERE gamiya_id=$1 AND NOT is_trial`, [gamiyaId])).rows[0];
      if (existing) throw conflict('LOTTERY_EXISTS', 'the official draw was already prepared');
      const prep = prepareDraw(gamiyaId, await this.candidates(c, gamiyaId));
      const s = (await c.query(
        `INSERT INTO lottery_sessions (gamiya_id, algorithm_version, commitment_sha256, candidates, seed_ciphertext, prepared_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, prepared_at`,
        [gamiyaId, prep.algorithmVersion, prep.commitment, JSON.stringify(prep.candidates), this.seal(prep.seedHex), userId])).rows[0];
      await this.audit.log(c, { actorId: userId, action: 'LOTTERY_PREPARED', entity: 'lottery_session', entityId: s.id, correlationId: cid, details: { commitment: prep.commitment } });
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
      await this.audit.log(c, { actorId: userId, action: 'LOTTERY_EXECUTED', entity: 'lottery_session', entityId: s.id, correlationId: cid, details: { approvedBy: approver.user_id } });
      return { record: this.publicRecord(rec), verification: verifyDraw(rec) };
    });
  }

  /** Cycles + installments. In model A each member pays the cycle recipient directly; the recipient owes no installment to themselves. */
  private async materializeSchedule(c: pg.PoolClient, g: any) {
    const contribution = parseMoney(g.contribution, g.currency);
    const sched = generateSchedule({ members: g.member_count, contribution, currency: g.currency, frequency: g.frequency, startDate: iso(g.start_date) });
    const members = (await c.query(`SELECT id, payout_position FROM gamiya_members WHERE gamiya_id=$1`, [g.id])).rows;
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
              (SELECT count(*)::int FROM lottery_approvals a WHERE a.session_id = s.id) AS approvals
       FROM lottery_sessions s LEFT JOIN lottery_results r ON r.session_id = s.id WHERE s.gamiya_id=$1 AND NOT s.is_trial`, [gamiyaId])).rows[0];
    if (!s) return { state: 'NOT_PREPARED' };
    if (!s.revealed_seed_hex) return { state: 'PREPARED', sessionId: s.id, commitment: s.commitment_sha256, algorithmVersion: s.algorithm_version, approvals: s.approvals };
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

export function iso(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  // pg returns DATE as a local-midnight Date; format with local components to avoid a TZ shift
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toCircleSummary(g: any) {
  return {
    id: g.id, name: g.name, currency: g.currency, frequency: g.frequency, contribution: g.contribution,
    memberCount: g.member_count, joined: g.joined, startDate: iso(g.start_date), status: g.status,
    myRole: g.role, myPayoutPosition: g.payout_position ?? null,
  };
}
