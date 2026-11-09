import { Body, Controller, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../common/config.ts';
import { Db } from '../common/db.ts';
import { CurrentUser, badRequest, parseBody, type AuthUser } from '../common/http.ts';
import { formatMoney, parseMoney, type Minor } from '../../../../packages/financial-core/src/money.ts';
import { SAVINGS_POLICY, monthlyEquivalent, savingsFacts } from '../../../../packages/financial-core/src/savings.ts';
import { narrate, type AdvisorFacts } from '../../../../packages/ai-core/src/advisor.ts';

const amount = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'decimal string, e.g. "15000"');
const AdviceSchema = z.object({
  monthlyIncome: amount,
  monthlyExpenses: amount,
  goalAmount: amount,
  targetMonths: z.number().int().min(1).max(60).optional(),
});

const dec = (m: Minor) => formatMoney(m, 'SAR').split(' ')[0];

/**
 * AI Savings Advisor (MASTER PROMPT §7-A). Numbers: financial-core. Words: the provider chain, guarded.
 * The user's income/expense inputs are used for this response only and are never stored.
 */
@Injectable()
export class AiService {
  constructor(private readonly db: Db, @Inject(CONFIG) private readonly config: AppConfig) {}

  async savingsAdvice(userId: string, input: z.infer<typeof AdviceSchema>) {
    const rows = (await this.db.query(
      `SELECT g.contribution, g.frequency FROM gamiya_members m JOIN gamiyas g ON g.id = m.gamiya_id
       WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND g.status IN ('RECRUITING','LOCKED','ACTIVE')`, [userId])).rows;
    const existing = rows.reduce((sum, r) => sum + monthlyEquivalent(parseMoney(r.contribution, 'SAR'), r.frequency), 0n);

    let f;
    try {
      f = savingsFacts({
        monthlyIncome: parseMoney(input.monthlyIncome, 'SAR'), monthlyExpenses: parseMoney(input.monthlyExpenses, 'SAR'),
        goalAmount: parseMoney(input.goalAmount, 'SAR'), targetMonths: input.targetMonths, existingMonthlyCommitments: existing,
      });
    } catch (e) {
      throw badRequest('INVALID_INPUT', (e as Error).message);
    }

    const facts: AdvisorFacts = {
      status: f.status, currency: 'SAR',
      disposableIncome: dec(f.disposableIncome), comfortableMonthlyCapacity: dec(f.comfortableMonthlyCapacity),
      existingMonthlyCommitments: dec(f.existingMonthlyCommitments), remainingCapacity: dec(f.remainingCapacity),
      goalAmount: dec(parseMoney(input.goalAmount, 'SAR')), targetMonths: input.targetMonths ?? null,
      recommended: f.recommended && { members: f.recommended.members, months: f.recommended.months, monthlyContribution: dec(f.recommended.monthlyContribution), payout: dec(f.recommended.payout) },
      scenarios: f.scenarios.map((s) => ({ members: s.members, months: s.months, monthlyContribution: dec(s.monthlyContribution), payout: dec(s.payout), affordable: s.affordable, fitsTarget: s.fitsTarget })),
      comfortableSharePercent: SAVINGS_POLICY.comfortableShareBps / 100,
    };

    const n = await narrate(facts, this.config.ai.chain);
    for (const e of n.events) {
      const guard = e.outcome === 'OK' ? n.guard?.passed ?? null : null;
      await this.db.query(
        `INSERT INTO ai_model_usage (user_id, feature, provider, model, outcome, guard_passed, latency_ms, input_tokens, output_tokens)
         VALUES ($1,'savings_advice',$2,$3,$4,$5,$6,$7,$8)`,
        [userId, e.provider, e.model, e.outcome, guard, e.latencyMs, e.inputTokens ?? null, e.outputTokens ?? null]);
    }

    return {
      facts,
      explanation: { text: n.text, source: n.source, provider: n.source === 'llm' ? n.provider : null, model: n.source === 'llm' ? n.model : null },
      policyVersion: f.policyVersion,
      dataSources: ['المدخلات التي قدّمتها الآن (لا تُحفظ)', 'جمعياتك النشطة في المنصة'],
      generatedAt: new Date().toISOString(),
      disclaimer: 'إرشاد عام مبني على قاعدة ثابتة (30% من المتبقي بعد المصاريف)، وليس استشارة مالية. الأرقام محسوبة بمحرك المنصة لا بنموذج الذكاء الاصطناعي.',
    };
  }
}

@Controller('api/v1/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('savings-advice') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  advice(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.ai.savingsAdvice(u.id, parseBody(AdviceSchema, body));
  }
}
