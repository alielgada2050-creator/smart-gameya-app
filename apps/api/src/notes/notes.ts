import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { conflict, CorrelationId, CurrentUser, forbidden, notFound, parseBody, parseId, uuid, type AuthUser } from '../common/http.ts';
import { ChatService } from '../chat/chat.service.ts';
import { GamiyasService } from '../gamiyas/gamiyas.service.ts';
import { formatMoney, parseMoney } from '../../../../packages/financial-core/src/money.ts';

/**
 * LARGE circles (payout 50,001–100,000 SAR):
 *  1. every member except the organizer uploads a promissory note (سند لأمر) payable to the organizer, for the payout value;
 *  2. the organizer asks the platform to review once all notes are in and the circle is full;
 *  3. a platform reviewer (PLATFORM_ADMIN / COMPLIANCE_OFFICER) approves or rejects; only an approved circle can run its draw.
 * The platform checks that a document exists and matches; it does not issue, hold or enforce the notes.
 */
const NoteSchema = z.object({ fileId: uuid, reference: z.string().trim().min(4).max(64).regex(/^[\p{L}\p{N} _\-#/]+$/u) });
const ReviewSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(500).optional() });

@Injectable()
export class NotesService {
  constructor(private readonly db: Db, private readonly audit: Audit, private readonly chat: ChatService, private readonly gamiyas: GamiyasService) {}

  async submit(gamiyaId: string, userId: string, input: z.infer<typeof NoteSchema>, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      if (g.tier !== 'LARGE') throw conflict('NOT_LARGE', 'promissory notes are only required for large circles');
      if (g.role === 'MANAGER') throw forbidden('the organizer is the beneficiary and does not submit a note');
      if (!['AWAITING_NOTES', 'REJECTED'].includes(g.platform_approval)) throw conflict('REVIEW_LOCKED', 'notes cannot change while under review or after approval');
      const f = (await c.query(`SELECT id FROM uploaded_files WHERE id=$1 AND owner_id=$2 AND gamiya_id=$3 AND purpose='PROMISSORY_NOTE'`, [input.fileId, userId, gamiyaId])).rows[0];
      if (!f) throw notFound('file');
      const manager = (await c.query(`SELECT user_id FROM gamiya_members WHERE gamiya_id=$1 AND role='MANAGER'`, [gamiyaId])).rows[0];
      const pot = parseMoney(g.contribution, g.currency) * BigInt(g.member_count);
      const amount = formatMoney(pot, g.currency).split(' ')[0];
      await c.query(
        `INSERT INTO promissory_notes (gamiya_id, member_id, beneficiary_user_id, file_id, reference, amount)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (gamiya_id, member_id) DO UPDATE SET file_id = EXCLUDED.file_id, amount = EXCLUDED.amount, reference = EXCLUDED.reference, status = 'SUBMITTED', submitted_at = now(), reviewed_by = NULL, reviewed_at = NULL`,
        [gamiyaId, g.member_id, manager.user_id, input.fileId, input.reference, amount]);
      if (g.platform_approval === 'REJECTED') await c.query(`UPDATE gamiyas SET platform_approval='AWAITING_NOTES' WHERE id=$1`, [gamiyaId]);
      const who = (await c.query(`SELECT full_name FROM users WHERE id=$1`, [userId])).rows[0].full_name;
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: `رفع ${who} سند لأمر لصالح المنظم بقيمة ${amount} ${g.currency} (مرجع ${input.reference}).`, refEntity: 'promissory_note', refId: g.member_id });
      await this.audit.log(c, { actorId: userId, action: 'PROMISSORY_NOTE_SUBMITTED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid });
      return { submitted: true, amount, beneficiary: 'ORGANIZER' };
    });
  }

  async requestReview(gamiyaId: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      if (g.role !== 'MANAGER') throw forbidden('only the organizer can request review');
      if (g.tier !== 'LARGE') throw conflict('NOT_LARGE', 'only large circles need platform review');
      if (g.status !== 'LOCKED') throw conflict('NOT_LOCKED', 'the circle must be full first');
      if (g.platform_approval !== 'AWAITING_NOTES') throw conflict('REVIEW_STATE', `review is ${g.platform_approval}`);
      const missing = Number((await c.query(
        `SELECT count(*) FROM gamiya_members m LEFT JOIN promissory_notes n ON n.member_id = m.id AND n.status = 'SUBMITTED'
         WHERE m.gamiya_id=$1 AND m.role <> 'MANAGER' AND n.id IS NULL`, [gamiyaId])).rows[0].count);
      if (missing > 0) throw conflict('NOTES_MISSING', `${missing} member(s) have not submitted a promissory note`);
      await c.query(`UPDATE gamiyas SET platform_approval='PENDING', platform_review_note=NULL WHERE id=$1`, [gamiyaId]);
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: 'طلب المنظم اعتماد إدارة المنصة. ستصلكم النتيجة هنا.', refEntity: 'gamiya', refId: gamiyaId });
      await this.audit.log(c, { actorId: userId, action: 'PLATFORM_REVIEW_REQUESTED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid });
      return { platformApproval: 'PENDING' };
    });
  }

  private async requireReviewer(userId: string) {
    const r = (await this.db.query(`SELECT platform_role FROM users WHERE id=$1`, [userId])).rows[0];
    if (!r || !['PLATFORM_ADMIN', 'COMPLIANCE_OFFICER'].includes(r.platform_role)) throw notFound();
  }

  async pending(userId: string) {
    await this.requireReviewer(userId);
    const circles = (await this.db.query(
      `SELECT g.id, g.name, g.currency, g.contribution, g.member_count, g.start_date, u.full_name AS organizer
       FROM gamiyas g JOIN gamiya_members m ON m.gamiya_id = g.id AND m.role = 'MANAGER' JOIN users u ON u.id = m.user_id
       WHERE g.platform_approval = 'PENDING' ORDER BY g.created_at`)).rows;
    const out = [];
    for (const g of circles) {
      const notes = (await this.db.query(
        `SELECT n.id, u.full_name AS member, n.reference, n.amount, n.file_id, n.status, n.submitted_at
         FROM promissory_notes n JOIN gamiya_members m ON m.id = n.member_id JOIN users u ON u.id = m.user_id WHERE n.gamiya_id=$1 ORDER BY u.full_name`, [g.id])).rows;
      const pot = parseMoney(g.contribution, g.currency) * BigInt(g.member_count);
      out.push({ id: g.id, name: g.name, organizer: g.organizer, currency: g.currency, potPerCycle: formatMoney(pot, g.currency).split(' ')[0], memberCount: g.member_count, startDate: g.start_date,
        notes: notes.map((n) => ({ id: n.id, member: n.member, reference: n.reference, amount: n.amount, fileId: n.file_id, status: n.status })) });
    }
    return out;
  }

  async review(gamiyaId: string, userId: string, input: z.infer<typeof ReviewSchema>, cid: string) {
    await this.requireReviewer(userId);
    return this.db.tx(async (c) => {
      const g = (await c.query(`SELECT * FROM gamiyas WHERE id=$1 FOR UPDATE`, [gamiyaId])).rows[0];
      if (!g) throw notFound('gamiya');
      if (g.platform_approval !== 'PENDING') throw conflict('REVIEW_STATE', `review is ${g.platform_approval}`);
      const member = (await c.query(`SELECT 1 FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2`, [gamiyaId, userId])).rows[0];
      if (member) throw forbidden('a reviewer cannot review a circle they belong to');
      const approve = input.decision === 'APPROVE';
      await c.query(`UPDATE promissory_notes SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE gamiya_id=$1`, [gamiyaId, approve ? 'ACCEPTED' : 'REJECTED', userId]);
      await c.query(`UPDATE gamiyas SET platform_approval=$2, platform_reviewed_by=$3, platform_reviewed_at=now(), platform_review_note=$4 WHERE id=$1`,
        [gamiyaId, approve ? 'APPROVED' : 'REJECTED', userId, input.note ?? null]);
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: approve
        ? 'اعتمدت إدارة المنصة الجمعية والسندات. يمكن للمنظم تجهيز القرعة.'
        : `لم تعتمد إدارة المنصة الجمعية${input.note ? `: ${input.note}` : ''}. يرجى إعادة رفع السندات المطلوبة.`, refEntity: 'gamiya', refId: gamiyaId });
      const members = (await c.query(`SELECT user_id FROM gamiya_members WHERE gamiya_id=$1 AND status <> 'WITHDRAWN'`, [gamiyaId])).rows.map((r) => r.user_id);
      await this.chat.notify(c, members, { gamiyaId, kind: approve ? 'PLATFORM_APPROVED' : 'PLATFORM_REJECTED', body: approve ? 'اعتُمدت جمعيتك الكبيرة.' : 'لم تُعتمد جمعيتك الكبيرة بعد.' });
      await this.audit.log(c, { actorId: userId, action: approve ? 'PLATFORM_APPROVED' : 'PLATFORM_REJECTED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid, details: { note: input.note ?? null } });
      return { platformApproval: approve ? 'APPROVED' : 'REJECTED' };
    });
  }
}

@Controller('api/v1')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post('gamiyas/:id/promissory-notes') @HttpCode(200)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.notes.submit(parseId(id), u.id, parseBody(NoteSchema, body), cid);
  }

  @Post('gamiyas/:id/platform-review') @HttpCode(200)
  request(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.notes.requestReview(parseId(id), u.id, cid); }

  @Get('admin/reviews')
  pending(@CurrentUser() u: AuthUser) { return this.notes.pending(u.id); }

  @Post('admin/gamiyas/:id/review') @HttpCode(200)
  review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.notes.review(parseId(id), u.id, parseBody(ReviewSchema, body), cid);
  }
}
