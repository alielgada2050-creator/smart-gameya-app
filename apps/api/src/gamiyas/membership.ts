/**
 * Changing a circle before it starts: the organizer edits the name, type, amount, member count, frequency or start date;
 * members re-confirm the new terms with a fresh pledge or leave; the organizer can remove a member with a reason.
 * Rule: nobody is ever bound by terms they did not sign. Any change to money terms bumps terms_version and moves every
 * other member to PENDING_APPROVAL until they sign again. Nothing can change once a draw is prepared or an order is proposed.
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type pg from 'pg';
import { Db, type Queryable } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { ChatService } from '../chat/chat.service.ts';
import { CorrelationId, CurrentUser, SignerInfo, badRequest, conflict, forbidden, notFound, parseBody, parseId, type AuthUser } from '../common/http.ts';
import { CATEGORIES, GamiyasService, iso, type PledgeInput, type Signer } from './gamiyas.service.ts';
import { PledgeSchema } from './gamiyas.controller.ts';
import { parseMoney } from '../../../../packages/financial-core/src/money.ts';
import type { Frequency } from '../../../../packages/financial-core/src/schedule.ts';

const EditSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  category: z.enum(CATEGORIES).optional(),
  contribution: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).optional(),
  memberCount: z.number().int().min(2).max(60).optional(),
  frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pledge: PledgeSchema.optional(),
});
const EditPreviewSchema = EditSchema.omit({ pledge: true });
const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });
const ReconfirmSchema = z.object({ pledge: PledgeSchema });

type EditInput = z.infer<typeof EditSchema>;

@Injectable()
export class MembershipService {
  constructor(private readonly db: Db, private readonly audit: Audit, private readonly chat: ChatService, private readonly gamiyas: GamiyasService) {}

  /** Terms can only change while recruiting/full, with no draw prepared and no order proposal open. */
  private async assertChangeable(c: Queryable, g: any) {
    if (!['RECRUITING', 'LOCKED'].includes(g.status)) throw conflict('ALREADY_STARTED', 'the circle has started; its terms can no longer change');
    const lot = (await c.query(`SELECT 1 FROM lottery_sessions WHERE gamiya_id=$1 AND NOT is_trial`, [g.id])).rows[0];
    if (lot) throw conflict('LOTTERY_PREPARED', 'a draw is already prepared for this circle');
    const prop = (await c.query(`SELECT 1 FROM order_proposals WHERE gamiya_id=$1 AND status='OPEN'`, [g.id])).rows[0];
    if (prop) throw conflict('PROPOSAL_OPEN', 'an order proposal is open; withdraw it first');
  }

  private async seats(c: Queryable, gamiyaId: string) {
    const r = (await c.query(
      `SELECT count(*) FILTER (WHERE status IN ('ACTIVE','PENDING_APPROVAL'))::int AS taken, count(*) FILTER (WHERE status = 'PENDING_APPROVAL')::int AS pending
       FROM gamiya_members WHERE gamiya_id=$1`, [gamiyaId])).rows[0];
    return { taken: r.taken as number, pending: r.pending as number };
  }

  /** LOCKED when every seat is taken by a member who signed the current terms; otherwise back to RECRUITING. */
  private async settleStatus(c: Queryable, gamiyaId: string) {
    const g = (await c.query(`SELECT member_count, status, tier FROM gamiyas WHERE id=$1`, [gamiyaId])).rows[0];
    const s = await this.seats(c, gamiyaId);
    const next = s.taken === g.member_count && s.pending === 0 ? 'LOCKED' : 'RECRUITING';
    if (next !== g.status) {
      await c.query(`UPDATE gamiyas SET status=$2 WHERE id=$1`, [gamiyaId, next]);
      if (next === 'LOCKED') await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: 'اكتمل العدد ووقّع الجميع على الشروط الحالية. يمكن ترتيب القبض أو تجهيز القرعة الآن.', refEntity: 'gamiya', refId: gamiyaId });
    }
    return next;
  }

  /** The new terms in numbers, before saving (the edit panel shows this live). */
  async editPreview(gamiyaId: string, userId: string, input: Omit<EditInput, 'pledge'>) {
    const g = await this.gamiyas.membership(this.db, gamiyaId, userId);
    this.gamiyas.requireManager(g);
    const next = this.merged(g, input);
    const a = this.gamiyas.assess({ country: g.country, frequency: next.frequency, contribution: next.contribution, memberCount: next.memberCount, startDate: next.startDate });
    const s = await this.seats(this.db, gamiyaId);
    const n = await this.gamiyas.names(this.db, gamiyaId, userId);
    const moneyChanged = this.moneyChanged(g, next);
    const terms = this.gamiyas.pledgeTerms({ ...this.row(g, next), terms_version: g.terms_version + (moneyChanged ? 1 : 0) }, n.organizer, n.me);
    return {
      moneyChanged, seatsTaken: s.taken, tier: a.tier.ok ? a.tier.tier : null,
      membersToReconfirm: moneyChanged ? Math.max(0, s.taken - 1) : 0,
      requiresPlatformApproval: a.tier.ok ? a.tier.requiresPlatformApproval : false,
      pledge: moneyChanged ? this.gamiyas.pledgeView(terms) : null,
      terms,
    };
  }

  private merged(g: any, input: Omit<EditInput, 'pledge'>) {
    return {
      name: input.name ?? g.name, category: input.category ?? g.category,
      contribution: input.contribution ?? String(g.contribution), memberCount: input.memberCount ?? g.member_count,
      frequency: (input.frequency ?? g.frequency) as Frequency, startDate: input.startDate ?? iso(g.start_date),
    };
  }
  private row(g: any, n: ReturnType<MembershipService['merged']>) {
    return { name: n.name, currency: g.currency, contribution: n.contribution, member_count: n.memberCount, frequency: n.frequency, start_date: n.startDate };
  }
  private moneyChanged(g: any, n: ReturnType<MembershipService['merged']>) {
    return parseMoney(n.contribution, g.currency) !== parseMoney(String(g.contribution), g.currency) || n.memberCount !== g.member_count
      || n.frequency !== g.frequency || n.startDate !== iso(g.start_date);
  }

  async edit(gamiyaId: string, userId: string, input: EditInput, who: Signer, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      this.gamiyas.requireManager(g);
      await this.assertChangeable(c, g);
      const next = this.merged(g, input);
      const a = this.gamiyas.assess({ country: g.country, frequency: next.frequency, contribution: next.contribution, memberCount: next.memberCount, startDate: next.startDate });
      if (!a.tier.ok) throw badRequest('INVALID_CIRCLE', 'invalid tier');
      if (next.startDate <= new Date().toISOString().slice(0, 10)) throw badRequest('INVALID_CIRCLE', 'start date must be in the future');
      const s = await this.seats(c, gamiyaId);
      if (next.memberCount < s.taken) throw conflict('BELOW_JOINED', `${s.taken} members have already joined; remove members first or keep at least ${s.taken}`);
      const moneyChanged = this.moneyChanged(g, next);
      const changes: string[] = [];
      if (next.name !== g.name) changes.push(`الاسم: «${next.name}»`);
      if (next.category !== g.category) changes.push('نوع الجمعية');
      if (parseMoney(next.contribution, g.currency) !== parseMoney(String(g.contribution), g.currency)) changes.push(`القسط: ${next.contribution} ${g.currency}`);
      if (next.memberCount !== g.member_count) changes.push(`عدد الأعضاء: ${next.memberCount}`);
      if (next.frequency !== g.frequency) changes.push('دورية الدفع');
      if (next.startDate !== iso(g.start_date)) changes.push(`تاريخ البدء: ${next.startDate}`);
      if (!changes.length) return this.gamiyas.details(c, gamiyaId, userId);

      const version = g.terms_version + (moneyChanged ? 1 : 0);
      const wasLarge = g.tier === 'LARGE';
      const approval = a.tier.requiresPlatformApproval ? (moneyChanged || !wasLarge ? 'AWAITING_NOTES' : g.platform_approval) : 'NOT_REQUIRED';
      await c.query(
        `UPDATE gamiyas SET name=$2, category=$3, contribution=$4, member_count=$5, cycle_count=$5, frequency=$6, start_date=$7, tier=$8, platform_approval=$9, terms_version=$10 WHERE id=$1`,
        [gamiyaId, next.name, next.category, next.contribution, next.memberCount, next.frequency, next.startDate, a.tier.tier, approval, version]);
      if (moneyChanged) {
        const n = await this.gamiyas.names(c, gamiyaId, userId);
        const fresh = (await c.query(`SELECT * FROM gamiyas WHERE id=$1`, [gamiyaId])).rows[0];
        await this.gamiyas.signPledge(c, userId, gamiyaId, this.gamiyas.pledgeTerms(fresh, n.organizer, n.me), input.pledge, who);
        await c.query(`UPDATE gamiya_members SET status='PENDING_APPROVAL' WHERE gamiya_id=$1 AND role <> 'MANAGER' AND status='ACTIVE'`, [gamiyaId]);
        // promissory notes were written for the old amounts
        await c.query(`UPDATE promissory_notes SET status='REJECTED', reviewed_at=now() WHERE gamiya_id=$1 AND status <> 'REJECTED'`, [gamiyaId]);
      }
      const body = `عدّل المنظم الجمعية: ${changes.join('، ')}.` + (moneyChanged ? ' تغيّرت الشروط المالية: على كل عضو مراجعة الشروط الجديدة وتوقيع إقرار السداد مرة أخرى، أو الانسحاب دون أي التزام.' : '');
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body, refEntity: 'gamiya', refId: gamiyaId });
      if (moneyChanged) {
        const others = (await c.query(`SELECT user_id FROM gamiya_members WHERE gamiya_id=$1 AND status='PENDING_APPROVAL'`, [gamiyaId])).rows.map((r) => r.user_id);
        await this.chat.notify(c, others, { gamiyaId, kind: 'ACTION_NEEDED', body: `تغيّرت شروط «${next.name}»: راجعها ووقّع من جديد` });
      }
      await this.settleStatus(c, gamiyaId);
      await this.audit.log(c, { actorId: userId, action: 'GAMIYA_EDITED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid, details: { changes, termsVersion: version } });
      return this.gamiyas.details(c, gamiyaId, userId);
    });
  }

  async reconfirm(gamiyaId: string, userId: string, pledge: PledgeInput, who: Signer, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      if (g.member_status !== 'PENDING_APPROVAL') throw conflict('NOTHING_TO_CONFIRM', 'you already agreed to the current terms');
      const n = await this.gamiyas.names(c, gamiyaId, userId);
      await this.gamiyas.signPledge(c, userId, gamiyaId, this.gamiyas.pledgeTerms(g, n.organizer, n.me), pledge, who);
      await c.query(`UPDATE gamiya_members SET status='ACTIVE' WHERE id=$1`, [g.member_id]);
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: `وافق ${n.me} على الشروط الجديدة ووقّع إقرار السداد.`, refEntity: 'member', refId: userId });
      await this.settleStatus(c, gamiyaId);
      await this.audit.log(c, { actorId: userId, action: 'TERMS_RECONFIRMED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid, details: { termsVersion: g.terms_version } });
      return this.gamiyas.details(c, gamiyaId, userId);
    });
  }

  private async withdraw(c: pg.PoolClient, gamiyaId: string, memberId: string) {
    await c.query(`UPDATE gamiya_members SET status='WITHDRAWN', payout_position=NULL WHERE id=$1`, [memberId]);
    await c.query(`DELETE FROM priority_requests WHERE member_id=$1`, [memberId]);
    await this.settleStatus(c, gamiyaId);
  }

  async leave(gamiyaId: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      if (g.role === 'MANAGER') throw forbidden('the organizer cannot leave their own circle');
      await this.assertChangeable(c, g);
      await this.withdraw(c, gamiyaId, g.member_id);
      const me = (await c.query(`SELECT full_name FROM users WHERE id=$1`, [userId])).rows[0].full_name;
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: `انسحب ${me} من الجمعية قبل بدئها، ولا التزام عليه.`, refEntity: 'member', refId: userId });
      const org = (await c.query(`SELECT user_id FROM gamiya_members WHERE gamiya_id=$1 AND role='MANAGER'`, [gamiyaId])).rows[0];
      await this.chat.notify(c, [org.user_id], { gamiyaId, kind: 'INFO', body: `انسحب ${me} من «${g.name}»` });
      await this.audit.log(c, { actorId: userId, action: 'MEMBER_LEFT', entity: 'gamiya', entityId: gamiyaId, correlationId: cid });
      return { left: true };
    });
  }

  async remove(gamiyaId: string, memberId: string, userId: string, reason: string, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      this.gamiyas.requireManager(g);
      await this.assertChangeable(c, g);
      const m = (await c.query(`SELECT m.id, m.role, m.user_id, u.full_name FROM gamiya_members m JOIN users u ON u.id = m.user_id
                                WHERE m.id=$1 AND m.gamiya_id=$2 AND m.status <> 'WITHDRAWN'`, [memberId, gamiyaId])).rows[0];
      if (!m) throw notFound('member');
      if (m.role === 'MANAGER') throw badRequest('CANNOT_REMOVE_ORGANIZER', 'the organizer cannot be removed');
      await this.withdraw(c, gamiyaId, m.id);
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: `أزال المنظم ${m.full_name} من الجمعية قبل بدئها. السبب: ${reason}`, refEntity: 'member', refId: m.user_id });
      await this.chat.notify(c, [m.user_id], { gamiyaId, kind: 'INFO', body: `أُزلت من «${g.name}» قبل بدئها: ${reason}` });
      await this.audit.log(c, { actorId: userId, action: 'MEMBER_REMOVED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid, details: { memberId, reason } });
      return this.gamiyas.details(c, gamiyaId, userId);
    });
  }

  async myPledges(userId: string) {
    const { rows } = await this.db.query(
      `SELECT p.id, p.gamiya_id, g.name, p.terms_version, p.pledge_version, p.text_sha256, p.typed_name, p.signed_at, p.terms
       FROM pledges p JOIN gamiyas g ON g.id = p.gamiya_id WHERE p.user_id=$1 ORDER BY p.signed_at DESC`, [userId]);
    return rows.map((r) => ({ id: r.id, gamiyaId: r.gamiya_id, circleName: r.name, termsVersion: r.terms_version, pledgeVersion: r.pledge_version,
      textSha256: r.text_sha256, typedName: r.typed_name, signedAt: r.signed_at, totalCommitment: r.terms.totalCommitment, currency: r.terms.currency }));
  }
}

@Controller('api/v1')
export class MembershipController {
  constructor(private readonly svc: MembershipService) {}

  @Post('gamiyas/:id/edit/preview') @HttpCode(200)
  editPreview(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.svc.editPreview(parseId(id), u.id, parseBody(EditPreviewSchema, body ?? {})); }

  @Post('gamiyas/:id/edit') @HttpCode(200)
  edit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @SignerInfo() who: Signer, @CorrelationId() cid: string) {
    return this.svc.edit(parseId(id), u.id, parseBody(EditSchema, body ?? {}), who, cid);
  }

  @Post('gamiyas/:id/reconfirm') @HttpCode(200)
  reconfirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @SignerInfo() who: Signer, @CorrelationId() cid: string) {
    return this.svc.reconfirm(parseId(id), u.id, parseBody(ReconfirmSchema, body).pledge, who, cid);
  }

  @Post('gamiyas/:id/leave') @HttpCode(200)
  leave(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.leave(parseId(id), u.id, cid); }

  @Post('gamiyas/:id/members/:memberId/remove') @HttpCode(200)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('memberId') memberId: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.remove(parseId(id), parseId(memberId), u.id, parseBody(ReasonSchema, body).reason, cid);
  }

  @Get('me/pledges')
  pledges(@CurrentUser() u: AuthUser) { return this.svc.myPledges(u.id); }
}
