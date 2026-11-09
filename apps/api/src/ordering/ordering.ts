import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../common/config.ts';
import { Db, type Queryable } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { badRequest, conflict, CorrelationId, CurrentUser, forbidden, notFound, parseBody, parseId, uuid, type AuthUser } from '../common/http.ts';
import { GamiyasService } from '../gamiyas/gamiyas.service.ts';
import { ChatService } from '../chat/chat.service.ts';
import { isPermutation, suggestOrder, type OrderSuggestion } from '../../../../packages/financial-core/src/ordering.ts';
import { guardNumbers } from '../../../../packages/ai-core/src/advisor.ts';

/**
 * Payout order by members' agreement or by priority (owner request 2026-11-10), alongside the verifiable lottery.
 *  - Each member may declare a priority: early/late/none, the date they need the money by, a reason category and a private note.
 *  - The assistant suggests an order from the declared dates and preferences only (reasons are not ranked; notes never leave the server).
 *  - The organizer proposes an order (the suggestion or their own). It takes effect only when EVERY member approves;
 *    one objection (with a reason) closes the proposal and the organizer may propose again. Votes are final and append-only.
 */
const REASONS = ['NONE', 'WEDDING', 'EDUCATION', 'HEALTH', 'HOUSING', 'BUSINESS', 'DEBT', 'TRAVEL', 'OTHER'] as const;
const PrioritySchema = z.object({
  preference: z.enum(['EARLY', 'LATE', 'NONE']),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.enum(REASONS).default('NONE'),
  shareReason: z.boolean().default(false),
  note: z.string().trim().max(300).optional(),
});
const ProposeSchema = z.object({
  mode: z.enum(['AGREED', 'PRIORITY']),
  order: z.array(uuid).min(2).max(60),
  rationale: z.string().trim().max(1000).optional(),
});
const VoteSchema = z.object({ vote: z.enum(['APPROVE', 'OBJECT']), reason: z.string().trim().max(500).optional() });

const reasonAr: Record<string, string> = { NONE: 'بدون', WEDDING: 'زواج', EDUCATION: 'تعليم', HEALTH: 'علاج', HOUSING: 'سكن', BUSINESS: 'مشروع', DEBT: 'سداد دين', TRAVEL: 'سفر', OTHER: 'أخرى' };

@Injectable()
export class OrderingService {
  constructor(private readonly db: Db, private readonly audit: Audit, private readonly gamiyas: GamiyasService, private readonly chat: ChatService,
              @Inject(CONFIG) private readonly config: AppConfig) {}

  private async members(q: Queryable, gamiyaId: string) {
    return (await q.query(
      `SELECT m.id, m.user_id, m.role, u.full_name, p.preference, p.needed_by, p.reason, p.share_reason, p.note
       FROM gamiya_members m JOIN users u ON u.id = m.user_id LEFT JOIN priority_requests p ON p.member_id = m.id
       WHERE m.gamiya_id=$1 AND m.status='ACTIVE' ORDER BY m.joined_at`, [gamiyaId])).rows;
  }

  private assertOpenForOrdering(g: any) {
    if (g.status === 'ACTIVE' || g.status === 'COMPLETED') throw conflict('ORDER_FIXED', 'the payout order is already fixed');
  }

  /** Everything the order page needs. Private notes: owner and organizer only. Reason categories: as each member chose. */
  async state(gamiyaId: string, userId: string) {
    const g = await this.gamiyas.membership(this.db, gamiyaId, userId);
    const isOrg = g.role === 'MANAGER';
    const ms = await this.members(this.db, gamiyaId);
    const lottery = (await this.db.query(`SELECT id FROM lottery_sessions WHERE gamiya_id=$1 AND NOT is_trial`, [gamiyaId])).rows[0];
    const proposals = (await this.db.query(`SELECT * FROM order_proposals WHERE gamiya_id=$1 ORDER BY created_at DESC LIMIT 10`, [gamiyaId])).rows;
    const open = proposals.find((p) => p.status === 'OPEN');
    const name = new Map(ms.map((m) => [m.id, m.full_name]));
    const dates = this.gamiyas.cycleDates(g);
    const votes = open ? (await this.db.query(`SELECT member_id, vote, reason, at FROM order_votes WHERE proposal_id=$1`, [open.id])).rows : [];
    return {
      status: g.status, orderingMethod: g.ordering, memberCount: g.member_count, isOrganizer: isOrg, myMemberId: g.member_id,
      lotteryStarted: !!lottery,
      requests: ms.map((m) => {
        const mine = m.id === g.member_id;
        return {
          memberId: m.id, fullName: m.full_name, declared: !!m.preference, preference: m.preference ?? 'NONE', neededBy: m.needed_by ? iso(m.needed_by) : null,
          reason: mine || isOrg || m.share_reason ? m.reason ?? 'NONE' : null, shareReason: !!m.share_reason,
          note: mine || isOrg ? m.note ?? null : null,
        };
      }),
      openProposal: open ? {
        id: open.id, mode: open.mode, aiAssisted: open.ai_assisted, rationale: open.rationale, createdAt: open.created_at,
        order: open.member_order.map((id: string, i: number) => ({ position: i + 1, memberId: id, fullName: name.get(id), payoutDate: dates[i] })),
        votes: ms.map((m) => { const v = votes.find((x) => x.member_id === m.id); return { memberId: m.id, fullName: m.full_name, vote: v?.vote ?? null }; }),
        approvals: votes.filter((v) => v.vote === 'APPROVE').length, needed: ms.length,
        myVote: votes.find((v) => v.member_id === g.member_id)?.vote ?? null,
      } : null,
      history: proposals.filter((p) => p.status !== 'OPEN').map((p) => ({ id: p.id, mode: p.mode, status: p.status, closedAt: p.closed_at })),
    };
  }

  async setPriority(gamiyaId: string, userId: string, input: z.infer<typeof PrioritySchema>, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      this.assertOpenForOrdering(g);
      if (input.preference === 'LATE' && input.neededBy) throw badRequest('LATE_WITH_DATE', 'a need date means you want an early payout');
      await c.query(
        `INSERT INTO priority_requests (member_id, gamiya_id, preference, reason, share_reason, needed_by, note) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (member_id) DO UPDATE SET preference=$3, reason=$4, share_reason=$5, needed_by=$6, note=$7, updated_at=now()`,
        [g.member_id, gamiyaId, input.preference, input.reason, input.shareReason, input.neededBy ?? null, input.note || null]);
      await this.audit.log(c, { actorId: userId, action: 'PRIORITY_DECLARED', entity: 'gamiya', entityId: gamiyaId, correlationId: cid, details: { preference: input.preference } });
      return { saved: true };
    });
  }

  private compute(g: any, ms: any[]): OrderSuggestion {
    return suggestOrder(g.id, ms.map((m) => ({ memberId: m.id, preference: m.preference ?? 'NONE', neededBy: m.needed_by ? iso(m.needed_by) : null })), this.gamiyas.cycleDates(g));
  }

  /**
   * Suggested order + an explanation every member can read. The explanation is a fixed template built from the numbers;
   * when a free model is configured it may rephrase a short summary from anonymous counts only (no names, reasons or notes),
   * and the rephrasing is dropped if it introduces any number not in the facts.
   */
  async suggestion(gamiyaId: string, userId: string) {
    const g = await this.gamiyas.membership(this.db, gamiyaId, userId);
    const ms = await this.members(this.db, gamiyaId);
    if (ms.length !== g.member_count) throw conflict('NOT_FULL', 'the suggestion needs every member; wait until the circle is full');
    const s = this.compute(g, ms);
    const name = new Map(ms.map((m) => [m.id, m.full_name]));
    const declaredCount = ms.filter((m) => m.preference).length;
    const lines = [
      'يرتّب الاقتراح الأعضاء حسب تاريخ الحاجة المعلن (الأقرب أولاً)، ثم من طلب القبض مبكراً، ثم بلا تفضيل، ثم من طلب التأخير.',
      'لا يفاضل بين الأسباب (زواج، تعليم، علاج…)؛ هي للنقاش بينكم فقط، والملاحظات الخاصة لا تُرسل لأي نموذج ذكاء اصطناعي.',
      'عند التساوي يُكسر التعادل ببصمة ثابتة لكل عضو، لا بترتيب الانضمام، والمنظم بلا أفضلية.',
      s.declaredNeeds ? `من أعلنوا تاريخ حاجة: تحقق الموعد لـ ${s.metNeeds} من ${s.declaredNeeds}.` : 'لم يعلن أحد تاريخ حاجة بعد.',
      ...s.order.filter((o) => o.needMet === false).map((o) => `لم يتسع الجدول لموعد ${name.get(o.memberId)}: يحتاجه قبل ${o.neededBy} وأقرب دورة له ${o.payoutDate}. يمكن الاتفاق على تبديل مع عضو آخر.`),
      declaredCount < ms.length ? (ms.length - declaredCount === 1 ? 'عضو واحد لم يعلن أولويته بعد؛ اعتُبر «بلا تفضيل».' : `لم يعلن ${ms.length - declaredCount} أعضاء أولويتهم بعد؛ اعتُبروا «بلا تفضيل».`) : '',
      'تذكير: من يقبض مبكراً يبقى ملتزماً بسداد كل أقساطه حتى آخر دورة.',
    ].filter(Boolean);

    let summary: { text: string; source: 'model' | 'template' } = { text: lines[3], source: 'template' };
    const chain = this.config.ai.chain;
    if (chain.providers.length) {
      const facts = { members: ms.length, declaredNeeds: s.declaredNeeds, metNeeds: s.metNeeds, unmet: s.unmet.length, wantEarly: ms.filter((m) => m.preference === 'EARLY').length, wantLate: ms.filter((m) => m.preference === 'LATE').length };
      try {
        const { result } = await chain.complete([
          { role: 'system', content: 'أنت مساعد جمعية ادخار. اكتب جملتين بالعربية تلخصان اقتراح ترتيب القبض من الحقائق المعطاة فقط، بنبرة محايدة، وشجع الأعضاء على الموافقة أو الاعتراض بسبب واضح. لا تخترع أرقاماً أو أسماء أو تواريخ.' },
          { role: 'user', content: `الحقائق: ${JSON.stringify(facts)}` },
        ], { maxTokens: 160 });
        if (result && guardNumbers(result.text, facts as any).ok) summary = { text: result.text.trim(), source: 'model' };
      } catch { /* template stays */ }
    }
    return {
      algorithmVersion: s.algorithmVersion, metNeeds: s.metNeeds, declaredNeeds: s.declaredNeeds,
      order: s.order.map((o) => ({ ...o, fullName: name.get(o.memberId) })),
      explanation: lines, summary,
    };
  }

  async propose(gamiyaId: string, userId: string, input: z.infer<typeof ProposeSchema>, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      if (g.role !== 'MANAGER') throw forbidden('only the circle organizer can propose the payout order');
      this.assertOpenForOrdering(g);
      if (g.status !== 'LOCKED') throw conflict('NOT_FULL', 'the circle must be full before the order is proposed');
      if (g.tier === 'LARGE' && g.platform_approval !== 'APPROVED') throw conflict('PLATFORM_APPROVAL_REQUIRED', 'large circles need platform approval first');
      if ((await c.query(`SELECT 1 FROM lottery_sessions WHERE gamiya_id=$1 AND NOT is_trial`, [gamiyaId])).rows[0]) throw conflict('LOTTERY_EXISTS', 'the lottery was already prepared for this circle');
      if ((await c.query(`SELECT 1 FROM order_proposals WHERE gamiya_id=$1 AND status='OPEN'`, [gamiyaId])).rows[0]) throw conflict('ORDER_PROPOSAL_OPEN', 'a proposal is already waiting for votes');
      const ms = await this.members(c, gamiyaId);
      if (!isPermutation(input.order, ms.map((m) => m.id))) throw badRequest('INVALID_ORDER', 'the order must list every member exactly once');
      const s = this.compute(g, ms);
      const aiAssisted = input.mode === 'PRIORITY' && s.order.every((o, i) => o.memberId === input.order[i]);
      const p = (await c.query(
        `INSERT INTO order_proposals (gamiya_id, mode, member_order, ai_assisted, algorithm_version, rationale, proposed_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [gamiyaId, input.mode, input.order, aiAssisted, aiAssisted ? s.algorithmVersion : null, input.rationale || null, userId])).rows[0];
      await c.query(`INSERT INTO order_votes (proposal_id, member_id, vote) VALUES ($1,$2,'APPROVE')`, [p.id, g.member_id]);
      const name = new Map(ms.map((m) => [m.id, m.full_name]));
      const label = input.mode === 'AGREED' ? 'ترتيب بالاتفاق' : aiAssisted ? 'ترتيب بالأولوية (اقتراح المساعد)' : 'ترتيب بالأولوية';
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', refEntity: 'order_proposal', refId: p.id,
        body: `اقترح المنظم ${label}: ${input.order.map((id, i) => `${i + 1}. ${name.get(id)}`).join('، ')}. يُعتمد عند موافقة جميع الأعضاء، وأي اعتراض بسبب يعيده للنقاش.` });
      await this.chat.notify(c, ms.filter((m) => m.id !== g.member_id).map((m) => m.user_id), { gamiyaId, kind: 'ACTION_NEEDED', body: `صوّت على ترتيب القبض في «${g.name}»` });
      await this.audit.log(c, { actorId: userId, action: 'ORDER_PROPOSED', entity: 'order_proposal', entityId: p.id, correlationId: cid, details: { mode: input.mode, aiAssisted } });
      await this.maybeAdopt(c, gamiyaId, p.id, ms, userId, cid);
      return { proposalId: p.id, aiAssisted };
    });
  }

  async vote(gamiyaId: string, proposalId: string, userId: string, input: z.infer<typeof VoteSchema>, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      const p = (await c.query(`SELECT * FROM order_proposals WHERE id=$1 AND gamiya_id=$2 FOR UPDATE`, [proposalId, gamiyaId])).rows[0];
      if (!p) throw notFound('proposal');
      if (p.status !== 'OPEN') throw conflict('PROPOSAL_CLOSED', `this proposal is ${p.status}`);
      if (input.vote === 'OBJECT' && (input.reason ?? '').length < 3) throw badRequest('REASON_REQUIRED', 'tell the members why you object');
      if ((await c.query(`SELECT 1 FROM order_votes WHERE proposal_id=$1 AND member_id=$2`, [p.id, g.member_id])).rows[0]) throw conflict('ALREADY_VOTED', 'your vote is already recorded');
      await c.query(`INSERT INTO order_votes (proposal_id, member_id, vote, reason) VALUES ($1,$2,$3,$4)`, [p.id, g.member_id, input.vote, input.reason || null]);
      const me = (await c.query(`SELECT full_name FROM users WHERE id=$1`, [userId])).rows[0].full_name;
      await this.audit.log(c, { actorId: userId, action: input.vote === 'APPROVE' ? 'ORDER_APPROVED' : 'ORDER_OBJECTED', entity: 'order_proposal', entityId: p.id, correlationId: cid });
      const ms = await this.members(c, gamiyaId);
      const organizer = ms.find((m) => m.role === 'MANAGER');
      if (input.vote === 'OBJECT') {
        await c.query(`UPDATE order_proposals SET status='REJECTED', closed_at=now() WHERE id=$1`, [p.id]);
        await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', refEntity: 'order_proposal', refId: p.id, body: `اعترض ${me} على ترتيب القبض: ${input.reason}. أُغلق الاقتراح؛ يمكن للمنظم اقتراح ترتيب جديد بعد النقاش.` });
        if (organizer) await this.chat.notify(c, [organizer.user_id], { gamiyaId, kind: 'ACTION_NEEDED', body: `اعترض ${me} على الترتيب: ${input.reason}` });
        return { status: 'REJECTED' };
      }
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', refEntity: 'order_proposal', refId: p.id, body: `وافق ${me} على ترتيب القبض.` });
      return { status: await this.maybeAdopt(c, gamiyaId, p.id, ms, userId, cid) };
    });
  }

  private async maybeAdopt(c: any, gamiyaId: string, proposalId: string, ms: any[], userId: string, cid: string) {
    const approvals = Number((await c.query(`SELECT count(*) FROM order_votes WHERE proposal_id=$1 AND vote='APPROVE'`, [proposalId])).rows[0].count);
    if (approvals < ms.length) return 'OPEN';
    const p = (await c.query(`UPDATE order_proposals SET status='ADOPTED', closed_at=now() WHERE id=$1 RETURNING mode, member_order`, [proposalId])).rows[0];
    await this.gamiyas.activateWithOrder(c, gamiyaId, p.member_order, p.mode === 'AGREED' ? 'CONSENSUS' : 'PREFERENCE');
    const name = new Map(ms.map((m) => [m.id, m.full_name]));
    await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', refEntity: 'order_proposal', refId: proposalId,
      body: `وافق جميع الأعضاء. اعتُمد ترتيب القبض وبدأت الجمعية: ${p.member_order.map((id: string, i: number) => `${i + 1}. ${name.get(id)}`).join('، ')}.` });
    await this.chat.notify(c, ms.map((m) => m.user_id), { gamiyaId, kind: 'INFO', body: 'اعتُمد ترتيب القبض بموافقة الجميع وبدأت الجمعية' });
    await this.audit.log(c, { actorId: userId, action: 'ORDER_ADOPTED', entity: 'order_proposal', entityId: proposalId, correlationId: cid });
    return 'ADOPTED';
  }

  async withdraw(gamiyaId: string, proposalId: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      if (g.role !== 'MANAGER') throw forbidden('only the organizer can withdraw a proposal');
      const r = await c.query(`UPDATE order_proposals SET status='WITHDRAWN', closed_at=now() WHERE id=$1 AND gamiya_id=$2 AND status='OPEN' RETURNING id`, [proposalId, gamiyaId]);
      if (!r.rowCount) throw conflict('PROPOSAL_CLOSED', 'no open proposal with this id');
      await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', refEntity: 'order_proposal', refId: proposalId, body: 'سحب المنظم اقتراح الترتيب.' });
      await this.audit.log(c, { actorId: userId, action: 'ORDER_WITHDRAWN', entity: 'order_proposal', entityId: proposalId, correlationId: cid });
      return { status: 'WITHDRAWN' };
    });
  }

  /** One-line answer for the chat assistant ("@مساعد الترتيب"). */
  async assistantLine(gamiyaId: string, userId: string): Promise<string> {
    const st = await this.state(gamiyaId, userId);
    if (st.status === 'ACTIVE' || st.status === 'COMPLETED') return 'ترتيب القبض معتمد. اكتب «@مساعد حسابي» لمعرفة دورك وموعده.';
    if (st.openProposal) {
      const waiting = st.openProposal.votes.filter((v) => !v.vote).map((v) => v.fullName);
      return `اقتراح ترتيب مفتوح: وافق ${st.openProposal.approvals} من ${st.openProposal.needed}.${waiting.length ? ` بانتظار: ${waiting.join('، ')}.` : ''}`;
    }
    const pending = st.requests.filter((r) => !r.declared).map((r) => r.fullName);
    return `لا يوجد اقتراح ترتيب بعد. يمكن اختيار القرعة، أو ترتيب بالاتفاق، أو بالأولوية مع اقتراح المساعد.${pending.length ? ` لم يعلن أولويته: ${pending.join('، ')}.` : ''}`;
  }
}

function iso(d: Date | string) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const reasonLabelsAr = reasonAr;

@Controller('api/v1/gamiyas/:id/order')
export class OrderingController {
  constructor(private readonly svc: OrderingService) {}

  @Get()
  state(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.state(parseId(id), u.id); }

  @Post('priority') @HttpCode(200)
  priority(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.setPriority(parseId(id), u.id, parseBody(PrioritySchema, body), cid);
  }

  @Get('suggestion')
  suggestion(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.suggestion(parseId(id), u.id); }

  @Post('proposals')
  propose(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.propose(parseId(id), u.id, parseBody(ProposeSchema, body), cid);
  }

  @Post('proposals/:pid/vote') @HttpCode(200)
  vote(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.vote(parseId(id), parseId(pid), u.id, parseBody(VoteSchema, body), cid);
  }

  @Post('proposals/:pid/withdraw') @HttpCode(200)
  withdraw(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('pid') pid: string, @CorrelationId() cid: string) {
    return this.svc.withdraw(parseId(id), parseId(pid), u.id, cid);
  }
}
