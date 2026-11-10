/**
 * Personal goals (Hajj, school fees, a wedding, a car…) and the circle planner that turns a goal into ready circle plans.
 * A goal can be linked to one of the user's circles; progress then shows the payout date of the user's turn against the
 * date the money is needed, and what they have paid so far. Numbers come from financial-core, never from a model.
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Db } from '../common/db.ts';
import { CurrentUser, badRequest, notFound, parseBody, parseId, type AuthUser } from '../common/http.ts';
import { CATEGORIES, iso } from '../gamiyas/gamiyas.service.ts';
import { planCircle, type Plan } from '../../../../packages/financial-core/src/planner.ts';
import { TIER_LIMITS } from '../../../../packages/financial-core/src/tiers.ts';
import { formatMoney } from '../../../../packages/financial-core/src/money.ts';

const amount = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const GoalSchema = z.object({
  category: z.enum(CATEGORIES), title: z.string().trim().min(2).max(80), targetAmount: amount,
  currency: z.enum(['SAR', 'EGP', 'AED']).default('SAR'), targetDate: date.nullable().optional(), gamiyaId: z.string().uuid().nullable().optional(),
});
const GoalUpdateSchema = GoalSchema.partial().extend({ status: z.enum(['ACTIVE', 'DONE', 'ARCHIVED']).optional() });
const PlanSchema = z.object({
  targetAmount: z.number().int().min(500).max(10_000_000), neededBy: date.nullable().optional(),
  people: z.number().int().min(2).max(60).nullable().optional(), monthlyBudget: z.number().int().min(50).max(1_000_000).nullable().optional(),
  frequency: z.enum(['WEEKLY', 'MONTHLY']).default('MONTHLY'), category: z.enum(CATEGORIES).default('OTHER'),
});

const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const fmt = (n: number) => n.toLocaleString('en-US');

@Injectable()
export class GoalsService {
  constructor(private readonly db: Db) {}

  async list(userId: string) {
    const { rows } = await this.db.query(
      `SELECT gl.*, g.name AS gamiya_name, g.status AS gamiya_status, g.contribution, g.member_count, g.currency AS gamiya_currency,
              (SELECT c.due_date FROM gamiya_cycles c WHERE c.gamiya_id = g.id AND c.recipient_member_id = m.id) AS my_payout_date,
              (SELECT coalesce(sum(i.amount_due), 0) FROM gamiya_installments i WHERE i.member_id = m.id AND i.status = 'PAID') AS paid
       FROM goals gl LEFT JOIN gamiyas g ON g.id = gl.gamiya_id
       LEFT JOIN gamiya_members m ON m.gamiya_id = g.id AND m.user_id = gl.user_id AND m.status <> 'WITHDRAWN'
       WHERE gl.user_id=$1 AND gl.status <> 'ARCHIVED' ORDER BY gl.status, gl.target_date NULLS LAST, gl.created_at DESC`, [userId]);
    return rows.map((r) => {
      const pot = r.contribution ? Number(r.contribution) * r.member_count : null;
      const payout = r.my_payout_date ? iso(r.my_payout_date) : null;
      return {
        id: r.id, category: r.category, title: r.title, targetAmount: r.target_amount, currency: r.currency,
        targetDate: r.target_date ? iso(r.target_date) : null, status: r.status,
        circle: r.gamiya_id ? {
          id: r.gamiya_id, name: r.gamiya_name, status: r.gamiya_status, pot: pot != null ? pot.toFixed(2) : null,
          myPayoutDate: payout, paid: Number(r.paid).toFixed(2),
          coversTarget: pot != null ? pot >= Number(r.target_amount) : null,
          onTime: payout && r.target_date ? payout <= iso(r.target_date) : null,
        } : null,
      };
    });
  }

  private async assertCircle(userId: string, gamiyaId: string | null | undefined) {
    if (!gamiyaId) return;
    const ok = (await this.db.query(`SELECT 1 FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2 AND status <> 'WITHDRAWN'`, [gamiyaId, userId])).rows[0];
    if (!ok) throw notFound('gamiya');
  }

  async create(userId: string, b: z.infer<typeof GoalSchema>) {
    await this.assertCircle(userId, b.gamiyaId);
    const n = Number((await this.db.query(`SELECT count(*) FROM goals WHERE user_id=$1 AND status='ACTIVE'`, [userId])).rows[0].count);
    if (n >= 20) throw badRequest('TOO_MANY_GOALS', 'archive a goal before adding more');
    const r = (await this.db.query(
      `INSERT INTO goals (user_id, category, title, target_amount, currency, target_date, gamiya_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [userId, b.category, b.title, b.targetAmount, b.currency, b.targetDate ?? null, b.gamiyaId ?? null])).rows[0];
    return (await this.list(userId)).find((g) => g.id === r.id);
  }

  async update(userId: string, id: string, b: z.infer<typeof GoalUpdateSchema>) {
    await this.assertCircle(userId, b.gamiyaId);
    const cur = (await this.db.query(`SELECT * FROM goals WHERE id=$1 AND user_id=$2`, [id, userId])).rows[0];
    if (!cur) throw notFound('goal');
    await this.db.query(
      `UPDATE goals SET category=$3, title=$4, target_amount=$5, currency=$6, target_date=$7, gamiya_id=$8, status=$9, updated_at=now() WHERE id=$1 AND user_id=$2`,
      [id, userId, b.category ?? cur.category, b.title ?? cur.title, b.targetAmount ?? cur.target_amount, b.currency ?? cur.currency,
       b.targetDate !== undefined ? b.targetDate : cur.target_date, b.gamiyaId !== undefined ? b.gamiyaId : cur.gamiya_id, b.status ?? cur.status]);
    return (await this.list(userId)).find((g) => g.id === id) ?? { id, status: b.status };
  }

  /** "المخطط الذكي": goal → up to three circle plans, with a plain explanation built from the numbers. */
  plan(b: z.infer<typeof PlanSchema>) {
    const today = riyadhToday();
    const maxPot = Number(formatMoney(TIER_LIMITS.SAR!.largeMax, 'SAR').split(' ')[0]);
    const r = planCircle({ targetAmount: b.targetAmount, neededBy: b.neededBy, people: b.people, monthlyBudget: b.monthlyBudget, frequency: b.frequency, today, maxPot });
    const why = (p: Plan) => {
      const parts = [`${p.members} أعضاء × ${fmt(p.contribution)} ريال ${p.frequency === 'WEEKLY' ? 'كل جمعة' : 'شهرياً'} = ${fmt(p.pot)} ريال يقبضها كل عضو في دوره.`];
      if (p.latestTurnForGoal) parts.push(`لتصلك قبل ${b.neededBy} اطلب دوراً من 1 إلى ${p.latestTurnForGoal} (آخرها ${p.latestTurnDate}).`);
      if (p.fitsBudget === false) parts.push(`أعلى من ميزانيتك الشهرية (≈${fmt(p.monthlyEquivalent)} ريال شهرياً).`);
      if (p.fitsBudget === true) parts.push(`ضمن ميزانيتك (≈${fmt(p.monthlyEquivalent)} ريال شهرياً).`);
      if (p.tier === 'LARGE') parts.push('جمعية كبيرة: تحتاج سندات لأمر واعتماد المنصة.');
      return parts.join(' ');
    };
    return {
      today, reason: r.reason ?? null,
      plans: r.plans.map((p) => ({ ...p, category: b.category, explanation: why(p) })),
      note: 'كل الأعضاء يدفعون القسط نفسه ويقبضون المبلغ نفسه أياً كان الدور: لا رسوم على الأدوار الأولى ولا خصومات على الأخيرة.',
      source: 'rules', policyVersion: 'sg-planner/1.0',
    };
  }
}

@Controller('api/v1')
export class GoalsController {
  constructor(private readonly svc: GoalsService) {}

  @Get('me/goals')
  list(@CurrentUser() u: AuthUser) { return this.svc.list(u.id); }

  @Post('me/goals')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.create(u.id, parseBody(GoalSchema, body)); }

  @Post('me/goals/:id') @HttpCode(200)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.svc.update(u.id, parseId(id), parseBody(GoalUpdateSchema, body)); }

  @Post('me/goals/:id/remove') @HttpCode(200)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.update(u.id, parseId(id), { status: 'ARCHIVED' }); }

  @Post('ai/circle-plan') @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  plan(@Body() body: unknown) { return this.svc.plan(parseBody(PlanSchema, body)); }
}
