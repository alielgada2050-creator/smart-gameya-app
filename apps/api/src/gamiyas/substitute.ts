/**
 * Replace one member with another («تبديل عضو بعضو»), before or after the circle starts.
 * The incoming person takes the outgoing member's seat: their turn and every installment not yet paid (overdue ones too).
 * Payments the outgoing member already made stay on their record; any compensation between the two is private (model A).
 * Three consents, none of them implied by the others:
 *   1. the outgoing member (implied only when the organizer starts it before the circle starts, as the organizer could remove them then);
 *   2. the organizer;
 *   3. the incoming person, by reading and signing a pledge built from the seat's real remaining payments.
 * A seat whose turn has already been received cannot be handed over: the newcomer would pay without ever receiving.
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Db, type Queryable } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { ChatService } from '../chat/chat.service.ts';
import { CorrelationId, CurrentUser, SignerInfo, conflict, forbidden, notFound, parseBody, parseId, type AuthUser } from '../common/http.ts';
import { GamiyasService, iso, type PledgeInput, type Signer } from './gamiyas.service.ts';
import { PledgeSchema } from './gamiyas.controller.ts';
import { formatMoney, parseMoney } from '../../../../packages/financial-core/src/money.ts';
import type { PledgeTerms } from '../../../../packages/financial-core/src/pledge.ts';

const dec = (minor: bigint, currency: string) => formatMoney(minor, currency).split(' ')[0];
const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });
const AcceptSchema = z.object({ agreementVersionId: z.string().uuid(), pledge: PledgeSchema.optional() });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

@Injectable()
export class SubstituteService {
  constructor(private readonly db: Db, private readonly audit: Audit, private readonly chat: ChatService, private readonly gamiyas: GamiyasService) {}

  /** The seat can change hands only when no draw is pending, no order vote is open, and its turn has not been received. */
  private async assertTransferable(c: Queryable, g: any, fromMemberId: string) {
    if (!['RECRUITING', 'LOCKED', 'ACTIVE'].includes(g.status)) throw conflict('NOT_TRANSFERABLE', 'this circle has ended');
    if (g.status !== 'ACTIVE') {
      const lot = (await c.query(`SELECT 1 FROM lottery_sessions s LEFT JOIN lottery_results r ON r.session_id = s.id
                                  WHERE s.gamiya_id=$1 AND NOT s.is_trial AND r.session_id IS NULL`, [g.id])).rows[0];
      if (lot) throw conflict('LOTTERY_PREPARED', 'a draw is prepared; replace members before preparing it or after it is done');
    }
    const prop = (await c.query(`SELECT 1 FROM order_proposals WHERE gamiya_id=$1 AND status='OPEN'`, [g.id])).rows[0];
    if (prop) throw conflict('PROPOSAL_OPEN', 'an order proposal is open; withdraw it first');
    const received = (await c.query(
      `SELECT 1 FROM gamiya_cycles cy WHERE cy.recipient_member_id = $1 AND (cy.due_date <= $2::date OR EXISTS (
         SELECT 1 FROM gamiya_installments i JOIN installment_settlements s ON s.installment_id = i.id
         WHERE i.cycle_id = cy.id AND s.recipient_confirmed_at IS NOT NULL))`, [fromMemberId, today()])).rows[0];
    if (received) throw conflict('TURN_RECEIVED', 'this member has already received their turn; the seat cannot be handed over');
  }

  private async seat(c: Queryable, gamiyaId: string, memberId: string) {
    const m = (await c.query(
      `SELECT m.id, m.user_id, m.role, m.status, m.payout_position, u.full_name FROM gamiya_members m JOIN users u ON u.id = m.user_id
       WHERE m.id=$1 AND m.gamiya_id=$2 AND m.status IN ('ACTIVE','PENDING_APPROVAL','DEFAULTED')`, [memberId, gamiyaId])).rows[0];
    if (!m) throw notFound('member');
    if (m.role === 'MANAGER') throw conflict('CANNOT_REPLACE_ORGANIZER', 'the organizer cannot be replaced');
    return m;
  }

  private async organizerId(c: Queryable, gamiyaId: string): Promise<string> {
    return (await c.query(`SELECT user_id FROM gamiya_members WHERE gamiya_id=$1 AND role='MANAGER'`, [gamiyaId])).rows[0].user_id;
  }

  /** Start a replacement: the organizer for any member, or a member for their own seat. */
  async start(gamiyaId: string, memberId: string, userId: string, reason: string, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      const m = await this.seat(c, gamiyaId, memberId);
      const isOrg = g.role === 'MANAGER';
      const isSelf = m.user_id === userId;
      if (!isOrg && !isSelf) throw forbidden('only the organizer or the member can start a replacement for this seat');
      await this.assertTransferable(c, g, m.id);
      if ((await c.query(`SELECT 1 FROM seat_transfers WHERE from_member_id=$1 AND status='OPEN'`, [m.id])).rows[0]) throw conflict('TRANSFER_OPEN', 'a replacement is already open for this seat');
      const consent = isSelf || (isOrg && g.status !== 'ACTIVE');
      const t = (await c.query(
        `INSERT INTO seat_transfers (gamiya_id, from_member_id, code, reason, created_by, outgoing_consent_at, organizer_approved_at)
         VALUES ($1,$2,$3,$4,$5, ${consent ? 'now()' : 'NULL'}, ${isOrg ? 'now()' : 'NULL'}) RETURNING id`,
        [gamiyaId, m.id, randomBytes(9).toString('base64url'), reason, userId])).rows[0];
      if (!isSelf) await this.chat.notify(c, [m.user_id], { gamiyaId, kind: 'ACTION_NEEDED', body: `يطلب المنظم استبدالك في «${g.name}» بعضو آخر: ${reason}. افتح الجمعية للموافقة أو الرفض.` });
      if (!isOrg) await this.chat.notify(c, [await this.organizerId(c, gamiyaId)], { gamiyaId, kind: 'ACTION_NEEDED', body: `طلب ${m.full_name} أن يحلّ محله عضو آخر في «${g.name}»: ${reason}` });
      await this.audit.log(c, { actorId: userId, action: 'SEAT_TRANSFER_STARTED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid, details: { memberId, reason } });
      return this.listIn(c, gamiyaId, userId);
    });
  }

  /** Open replacements this person can see: all of them for the organizer, their own seat for a member. */
  async list(gamiyaId: string, userId: string) { return this.listIn(this.db, gamiyaId, userId); }

  private async listIn(c: Queryable, gamiyaId: string, userId: string) {
    const g = await this.gamiyas.membership(c, gamiyaId, userId);
    const { rows } = await c.query(
      `SELECT t.id, t.code, t.reason, t.outgoing_consent_at, t.organizer_approved_at, t.created_at, t.expires_at, m.id AS member_id, m.user_id, u.full_name
       FROM seat_transfers t JOIN gamiya_members m ON m.id = t.from_member_id JOIN users u ON u.id = m.user_id
       WHERE t.gamiya_id=$1 AND t.status='OPEN' AND t.expires_at > now() ORDER BY t.created_at`, [gamiyaId]);
    return rows.filter((r) => g.role === 'MANAGER' || r.user_id === userId).map((r) => {
      const ready = !!r.outgoing_consent_at && !!r.organizer_approved_at;
      return {
        id: r.id, memberId: r.member_id, fullName: r.full_name, reason: r.reason, mine: r.user_id === userId,
        outgoingConsent: !!r.outgoing_consent_at, organizerApproved: !!r.organizer_approved_at, ready,
        code: ready ? r.code : null, expiresAt: r.expires_at,
      };
    });
  }

  private async open(c: Queryable, id: string) {
    const t = (await c.query(`SELECT * FROM seat_transfers WHERE id=$1 AND status='OPEN' FOR UPDATE`, [id])).rows[0];
    if (!t) throw notFound('replacement');
    return t;
  }

  /** The missing consent: the organizer approves, or the outgoing member agrees. */
  async approve(id: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const t = await this.open(c, id);
      const g = await this.gamiyas.membership(c, t.gamiya_id, userId, true);
      const m = (await c.query(`SELECT user_id FROM gamiya_members WHERE id=$1`, [t.from_member_id])).rows[0];
      if (g.role === 'MANAGER' && !t.organizer_approved_at) await c.query(`UPDATE seat_transfers SET organizer_approved_at=now() WHERE id=$1`, [id]);
      else if (m.user_id === userId && !t.outgoing_consent_at) await c.query(`UPDATE seat_transfers SET outgoing_consent_at=now() WHERE id=$1`, [id]);
      else throw forbidden('nothing for you to approve here');
      await this.audit.log(c, { actorId: userId, action: 'SEAT_TRANSFER_APPROVED', entity: 'gamiya', entityId: t.gamiya_id, correlationId: cid, details: { transferId: id } });
      return this.listIn(c, t.gamiya_id, userId);
    });
  }

  async cancel(id: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const t = await this.open(c, id);
      const g = await this.gamiyas.membership(c, t.gamiya_id, userId, true);
      const m = (await c.query(`SELECT user_id FROM gamiya_members WHERE id=$1`, [t.from_member_id])).rows[0];
      if (g.role !== 'MANAGER' && m.user_id !== userId) throw forbidden('only the organizer or the member can cancel');
      await c.query(`UPDATE seat_transfers SET status='CANCELLED', closed_at=now() WHERE id=$1`, [id]);
      await this.audit.log(c, { actorId: userId, action: 'SEAT_TRANSFER_CANCELLED', entity: 'gamiya', entityId: t.gamiya_id, correlationId: cid, details: { transferId: id } });
      return this.listIn(c, t.gamiya_id, userId);
    });
  }

  /** The pledge for this seat: the real remaining payments (or the full terms before the start), and whom the signer replaces. */
  private async seatTerms(c: Queryable, g: any, from: any, organizer: string, me: string): Promise<{ terms: PledgeTerms; overdue: number; pending: number }> {
    const base = this.gamiyas.pledgeTerms(g, organizer, me);
    if (g.status !== 'ACTIVE') return { terms: { ...base, replaces: { memberName: from.full_name, payoutPosition: from.payout_position, overdue: 0 } }, overdue: 0, pending: 0 };
    const r = (await c.query(
      `SELECT count(*)::int AS n, coalesce(sum(i.amount_due), 0)::text AS total, min(cy.due_date) AS first,
              count(*) FILTER (WHERE cy.due_date < $2::date)::int AS overdue,
              (SELECT count(*)::int FROM gamiya_installments x JOIN installment_settlements s ON s.installment_id = x.id
                WHERE x.member_id = $1 AND s.recipient_confirmed_at IS NULL) AS pending
       FROM gamiya_installments i JOIN gamiya_cycles cy ON cy.id = i.cycle_id
       WHERE i.member_id = $1 AND NOT EXISTS (SELECT 1 FROM installment_settlements s WHERE s.installment_id = i.id)`, [from.id, today()])).rows[0];
    return {
      terms: { ...base, installments: r.n, startDate: r.first ? iso(r.first) : base.startDate, totalCommitment: dec(parseMoney(r.total, g.currency), g.currency),
        replaces: { memberName: from.full_name, payoutPosition: from.payout_position, overdue: r.overdue } },
      overdue: r.overdue, pending: r.pending,
    };
  }

  private async byCode(c: Queryable, code: string, lock = false) {
    const t = (await c.query(`SELECT * FROM seat_transfers WHERE code=$1 ${lock ? 'FOR UPDATE' : ''}`, [code])).rows[0];
    if (!t || t.status !== 'OPEN' || new Date(t.expires_at) < new Date() || !t.outgoing_consent_at || !t.organizer_approved_at) throw notFound('replacement');
    return t;
  }

  /** What the incoming person sees before accepting: the seat in numbers and the pledge they would sign. */
  async preview(code: string, userId: string) {
    const t = await this.byCode(this.db, code);
    const g = (await this.db.query(`SELECT * FROM gamiyas WHERE id=$1`, [t.gamiya_id])).rows[0];
    const from = (await this.db.query(`SELECT m.*, u.full_name FROM gamiya_members m JOIN users u ON u.id = m.user_id WHERE m.id=$1`, [t.from_member_id])).rows[0];
    const n = await this.gamiyas.names(this.db, g.id, userId);
    const s = await this.seatTerms(this.db, g, from, n.organizer, n.me);
    const mine = (await this.db.query(`SELECT status FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2`, [g.id, userId])).rows[0];
    return {
      circle: { name: g.name, organizerName: n.organizer, category: g.category, tier: g.tier, currency: g.currency, status: g.status, frequency: g.frequency,
        contribution: s.terms.contribution, memberCount: g.member_count, potPerCycle: s.terms.potPerCycle, endDate: s.terms.endDate },
      seat: { replaces: from.full_name, payoutPosition: from.payout_position, installments: s.terms.installments, total: s.terms.totalCommitment,
        firstDue: s.terms.startDate, overdue: s.overdue, reason: t.reason },
      alreadyMember: !!mine && mine.status !== 'WITHDRAWN',
      pledge: this.gamiyas.pledgeView(s.terms),
    };
  }

  async accept(code: string, userId: string, agreementVersionId: string, pledge: PledgeInput | undefined, who: Signer, cid: string) {
    return this.db.tx(async (c) => {
      const t = await this.byCode(c, code, true);
      const g = (await c.query(`SELECT * FROM gamiyas WHERE id=$1 FOR UPDATE`, [t.gamiya_id])).rows[0];
      const from = await this.seat(c, g.id, t.from_member_id).catch(() => { throw conflict('SEAT_CHANGED', 'this seat has changed; ask the organizer for a new link'); });
      await this.assertTransferable(c, g, from.id);
      const old = (await c.query(`SELECT id, status FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2`, [g.id, userId])).rows[0];
      if (old && old.status !== 'WITHDRAWN') throw conflict('ALREADY_MEMBER', 'you are already a member of this circle');
      if (old) {
        const history = (await c.query(`SELECT 1 FROM gamiya_installments WHERE member_id=$1 UNION ALL SELECT 1 FROM gamiya_cycles WHERE recipient_member_id=$1 LIMIT 1`, [old.id])).rows[0];
        if (history) throw conflict('WAS_MEMBER', 'you held another seat in this circle before; the organizer can invite you to a new circle instead');
      }
      const n = await this.gamiyas.names(c, g.id, userId);
      const s = await this.seatTerms(c, g, from, n.organizer, n.me);
      await this.gamiyas.signPledge(c, userId, g.id, s.terms, pledge, who);
      await this.gamiyas.acceptAgreement(c, userId, g.id, agreementVersionId, who.ip);

      await c.query(`UPDATE gamiya_members SET status='WITHDRAWN', payout_position=NULL WHERE id=$1`, [from.id]);
      const to = old
        ? (await c.query(`UPDATE gamiya_members SET status='ACTIVE', role='MEMBER', payout_position=$2, joined_at=now() WHERE id=$1 RETURNING id`, [old.id, from.payout_position])).rows[0]
        : (await c.query(`INSERT INTO gamiya_members (gamiya_id, user_id, role, status, payout_position, joined_at) VALUES ($1,$2,'MEMBER','ACTIVE',$3,now()) RETURNING id`,
            [g.id, userId, from.payout_position])).rows[0];
      const moved = (await c.query(
        `UPDATE gamiya_installments i SET member_id=$2 WHERE i.member_id=$1 AND NOT EXISTS (SELECT 1 FROM installment_settlements s WHERE s.installment_id = i.id)`,
        [from.id, to.id])).rowCount ?? 0;
      await c.query(`UPDATE gamiya_cycles SET recipient_member_id=$2 WHERE recipient_member_id=$1`, [from.id, to.id]);
      await c.query(`DELETE FROM priority_requests WHERE member_id=$1`, [from.id]);
      await c.query(`UPDATE seat_transfers SET status='COMPLETED', to_user_id=$2, to_member_id=$3, moved_installments=$4, closed_at=now() WHERE id=$1`, [t.id, userId, to.id, moved]);
      // Before the start, the seat count is unchanged but the newcomer signed the current terms: the circle may now be full and confirmed.
      if (g.status !== 'ACTIVE') {
        const r = (await c.query(`SELECT count(*) FILTER (WHERE status IN ('ACTIVE','PENDING_APPROVAL'))::int AS taken, count(*) FILTER (WHERE status='PENDING_APPROVAL')::int AS pending
                                  FROM gamiya_members WHERE gamiya_id=$1`, [g.id])).rows[0];
        await c.query(`UPDATE gamiyas SET status=$2 WHERE id=$1`, [g.id, r.taken === g.member_count && r.pending === 0 ? 'LOCKED' : 'RECRUITING']);
      }

      const turn = from.payout_position ? ` في الدور ${from.payout_position}` : '';
      await this.chat.post(c, { gamiyaId: g.id, kind: 'SYSTEM', refEntity: 'member', refId: userId,
        body: `حلّ ${n.me} محلّ ${from.full_name}${turn} ووقّع إقرار السداد${moved ? `، وانتقلت إليه ${moved} أقساط لم تُسدَّد` : ''}. ما سدّده ${from.full_name} يبقى في سجله.` });
      if (g.tier === 'LARGE') await this.chat.post(c, { gamiyaId: g.id, kind: 'SYSTEM', body: `جمعية كبيرة: على ${n.me} رفع سند لأمر لصالح المنظم.` });
      await this.chat.notify(c, [from.user_id], { gamiyaId: g.id, kind: 'INFO', body: `حلّ ${n.me} محلك في «${g.name}». ما سدّدته يبقى في سجلك.` });
      await this.chat.notify(c, [await this.organizerId(c, g.id)], { gamiyaId: g.id, kind: 'INFO', body: `حلّ ${n.me} محلّ ${from.full_name} في «${g.name}».` });
      await this.audit.log(c, { actorId: userId, action: 'SEAT_TRANSFERRED', entity: 'gamiya', entityId: g.id, correlationId: cid,
        details: { transferId: t.id, fromMemberId: from.id, toMemberId: to.id, movedInstallments: moved } });
      return this.gamiyas.details(c, g.id, userId);
    });
  }
}

@Controller('api/v1')
export class SubstituteController {
  constructor(private readonly svc: SubstituteService) {}

  @Post('gamiyas/:id/members/:memberId/replace') @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('memberId') memberId: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.start(parseId(id), parseId(memberId), u.id, parseBody(ReasonSchema, body).reason, cid);
  }

  @Get('gamiyas/:id/seat-transfers')
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.list(parseId(id), u.id); }

  @Post('seat-transfers/:id/approve') @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.approve(parseId(id), u.id, cid); }

  @Post('seat-transfers/:id/cancel') @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.cancel(parseId(id), u.id, cid); }

  @Get('seat-transfers/code/:code')
  preview(@CurrentUser() u: AuthUser, @Param('code') code: string) { return this.svc.preview(String(code).slice(0, 40), u.id); }

  @Post('seat-transfers/code/:code/accept') @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() body: unknown, @SignerInfo() who: Signer, @CorrelationId() cid: string) {
    const b = parseBody(AcceptSchema, body);
    return this.svc.accept(String(code).slice(0, 40), u.id, b.agreementVersionId, b.pledge, who, cid);
  }
}
