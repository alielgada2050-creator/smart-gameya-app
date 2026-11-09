import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../common/config.ts';
import { Db, type Queryable } from '../common/db.ts';
import { ChatService } from '../chat/chat.service.ts';
import { guardNumbers } from '../../../../packages/ai-core/src/advisor.ts';

/**
 * The circle assistant ("المساعد"). Every figure it states comes from SQL over the ledger of installments;
 * a language model (free provider chain) is used only to phrase answers to free-form questions, and only with
 * numeric facts (no names, phones or accounts), behind the same numeric guard as the savings advisor.
 */
const TODAY = `(now() AT TIME ZONE 'Asia/Riyadh')::date`;

export type Intent = 'help' | 'report' | 'statement' | 'late' | 'next' | 'disputes' | 'remind' | 'question';

export function detectIntent(text: string): Intent {
  const t = text.replace(/^\s*(@مساعد|@المساعد|@assistant|\/)\s*/i, '').trim().toLowerCase();
  if (!t || /^(مساعدة|help|\?|؟)$/.test(t)) return 'help';
  if (/(تقرير|حالة الجمعية|الحالة|report|status)/.test(t)) return 'report';
  if (/(حسابي|كشف|رصيدي|statement|balance|my account)/.test(t)) return 'statement';
  if (/(متأخر|المتأخرين|late|overdue)/.test(t)) return 'late';
  if (/(القادم|الموعد|موعد|next|due)/.test(t)) return 'next';
  if (/(اعتراض|نزاع|اعتراضات|dispute)/.test(t)) return 'disputes';
  if (/(ذكّر|ذكر|تذكير|remind)/.test(t)) return 'remind';
  return 'question';
}

export const isForAssistant = (text: string) => /^\s*(@مساعد|@المساعد|@assistant|\/)/i.test(text);

const HELP = [
  'أنا مساعد الجمعية. اكتب @مساعد ثم أحد الأوامر:',
  'تقرير — حالة الجمعية والدورة الحالية',
  'حسابي — ما دفعته وما عليك وما ستستلمه',
  'المتأخرين — من تأخر عن موعده',
  'القادم — الموعد القادم ومستلمه',
  'اعتراضات — الاعتراضات المفتوحة',
  'تذكير — يرسل تذكيراً الآن (للمنظم)',
].join('\n');

@Injectable()
export class AssistantService implements OnModuleInit, OnModuleDestroy {
  #timer: NodeJS.Timeout | null = null;
  constructor(private readonly db: Db, private readonly chat: ChatService, @Inject(CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    const every = this.config.remindersEveryMinutes ?? 0;
    if (every > 0) this.#timer = setInterval(() => { this.runReminders().catch((e) => console.error('reminders', e)); }, every * 60_000);
  }
  onModuleDestroy() { if (this.#timer) clearInterval(this.#timer); }

  /** Circle-level numbers. */
  async report(q: Queryable, gamiyaId: string) {
    const g = (await q.query(`SELECT id, name, currency, member_count, status, contribution FROM gamiyas WHERE id=$1`, [gamiyaId])).rows[0];
    const cycles = (await q.query(
      `SELECT cy.cycle_index, cy.due_date, cy.pot_amount, ru.full_name AS recipient,
              count(i.id)::int AS total, count(i.id) FILTER (WHERE i.status='PAID')::int AS paid
       FROM gamiya_cycles cy JOIN gamiya_members rc ON rc.id = cy.recipient_member_id JOIN users ru ON ru.id = rc.user_id
       LEFT JOIN gamiya_installments i ON i.cycle_id = cy.id
       WHERE cy.gamiya_id=$1 GROUP BY cy.id, ru.full_name ORDER BY cy.cycle_index`, [gamiyaId])).rows;
    const late = await this.lateList(q, gamiyaId);
    const counts = (await q.query(
      `SELECT count(*) FILTER (WHERE d.status='OPEN')::int AS open_disputes FROM disputes d WHERE d.gamiya_id=$1`, [gamiyaId])).rows[0];
    const totalInst = cycles.reduce((a: number, c: any) => a + c.total, 0);
    const paidInst = cycles.reduce((a: number, c: any) => a + c.paid, 0);
    const current = cycles.find((c: any) => c.paid < c.total) ?? null;
    return {
      name: g.name, currency: g.currency, status: g.status, cycles: cycles.length, completedCycles: cycles.filter((c: any) => c.total > 0 && c.paid === c.total).length,
      installmentsPaid: paidInst, installmentsTotal: totalInst, percentPaid: totalInst ? Math.floor((paidInst * 100) / totalInst) : 0,
      current: current && { cycle: current.cycle_index, dueDate: current.due_date, recipient: current.recipient, paid: current.paid, total: current.total, pot: current.pot_amount },
      late, openDisputes: counts.open_disputes,
    };
  }

  async lateList(q: Queryable, gamiyaId: string) {
    return (await q.query(
      `SELECT pu.full_name AS payer, cy.cycle_index, cy.due_date, i.amount_due
       FROM gamiya_installments i JOIN gamiya_cycles cy ON cy.id = i.cycle_id JOIN gamiyas g ON g.id = cy.gamiya_id
       JOIN gamiya_members p ON p.id = i.member_id JOIN users pu ON pu.id = p.user_id
       LEFT JOIN installment_settlements s ON s.installment_id = i.id
       WHERE cy.gamiya_id=$1 AND i.status <> 'PAID' AND (s.installment_id IS NULL OR s.voided_at IS NOT NULL)
         AND cy.due_date + g.grace_days < ${TODAY}
       ORDER BY cy.cycle_index, pu.full_name`, [gamiyaId])).rows
      .map((r) => ({ payer: r.payer, cycle: r.cycle_index, dueDate: r.due_date, amount: r.amount_due }));
  }

  /** One member's account in one circle. Sums are computed in PostgreSQL numeric (exact). */
  async statement(q: Queryable, gamiyaId: string, userId: string) {
    const r = (await q.query(
      `WITH me AS (SELECT id, payout_position FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2)
       SELECT
         (SELECT coalesce(sum(i.amount_due) FILTER (WHERE i.status='PAID'),0)::numeric(18,2) FROM gamiya_installments i JOIN me ON i.member_id = me.id) AS paid,
         (SELECT coalesce(sum(i.amount_due) FILTER (WHERE i.status<>'PAID'),0)::numeric(18,2) FROM gamiya_installments i JOIN me ON i.member_id = me.id) AS remaining_to_pay,
         (SELECT coalesce(sum(i.amount_due) FILTER (WHERE i.status='PAID'),0)::numeric(18,2) FROM gamiya_installments i JOIN gamiya_cycles cy ON cy.id=i.cycle_id JOIN me ON cy.recipient_member_id = me.id) AS received,
         (SELECT coalesce(sum(i.amount_due) FILTER (WHERE i.status<>'PAID'),0)::numeric(18,2) FROM gamiya_installments i JOIN gamiya_cycles cy ON cy.id=i.cycle_id JOIN me ON cy.recipient_member_id = me.id) AS to_receive,
         (SELECT payout_position FROM me) AS my_position,
         (SELECT cy.due_date FROM gamiya_cycles cy JOIN me ON cy.recipient_member_id = me.id) AS my_payout_date`, [gamiyaId, userId])).rows[0];
    const g = (await q.query(`SELECT currency FROM gamiyas WHERE id=$1`, [gamiyaId])).rows[0];
    return { currency: g.currency, paid: r.paid, remainingToPay: r.remaining_to_pay, received: r.received, toReceive: r.to_receive, myPosition: r.my_position, myPayoutDate: r.my_payout_date };
  }

  private fmt(v: string) { const [w, d] = String(v).split('.'); return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${d && d !== '00' ? '.' + d : ''}`; }

  /** Reply to a chat message addressed to the assistant. */
  async answer(gamiyaId: string, userId: string, text: string): Promise<string> {
    const intent = detectIntent(text);
    if (intent === 'help') return HELP;
    if (intent === 'report') {
      const r = await this.report(this.db, gamiyaId);
      if (!r.cycles) return 'لم تبدأ الدورات بعد. تبدأ بعد اكتمال العدد وإجراء القرعة.';
      const lines = [`تقرير ${r.name}: اكتمل ${r.completedCycles} من ${r.cycles} دورات، وتأكد ${r.installmentsPaid} من ${r.installmentsTotal} قسطاً (${r.percentPaid}%).`];
      if (r.current) lines.push(`الدورة الحالية ${r.current.cycle}: المستلم ${r.current.recipient}، الموعد ${r.current.dueDate}، المؤكد ${r.current.paid} من ${r.current.total}.`);
      lines.push(r.late.length ? `متأخرون: ${r.late.map((l) => `${l.payer} (الدورة ${l.cycle})`).join('، ')}.` : 'لا يوجد متأخرون.');
      if (r.openDisputes) lines.push(`اعتراضات مفتوحة: ${r.openDisputes}.`);
      return lines.join('\n');
    }
    if (intent === 'statement') {
      const s = await this.statement(this.db, gamiyaId, userId);
      const c = s.currency;
      return [
        `دفعت ${this.fmt(s.paid)} ${c}، والمتبقي عليك ${this.fmt(s.remainingToPay)} ${c}.`,
        s.myPosition ? `دورك رقم ${s.myPosition} بتاريخ ${s.myPayoutDate}: استلمت ${this.fmt(s.received)} ${c}، وبقي لك ${this.fmt(s.toReceive)} ${c}.` : 'لم يُحدَّد دورك بعد؛ يُحدَّد بالقرعة.',
      ].join('\n');
    }
    if (intent === 'late') {
      const l = await this.lateList(this.db, gamiyaId);
      return l.length ? `المتأخرون بعد فترة السماح:\n${l.map((x) => `${x.payer}: ${this.fmt(x.amount)} (الدورة ${x.cycle}، موعدها ${x.dueDate})`).join('\n')}` : 'لا يوجد متأخرون. أحسنتم.';
    }
    if (intent === 'next') {
      const r = await this.report(this.db, gamiyaId);
      return r.current ? `الدورة القادمة ${r.current.cycle}: يستلم ${r.current.recipient} قبض ${this.fmt(r.current.pot)} ${r.currency} في ${r.current.dueDate}.` : 'لا توجد دورة قادمة.';
    }
    if (intent === 'disputes') {
      const d = (await this.db.query(`SELECT count(*)::int AS n FROM disputes WHERE gamiya_id=$1 AND status='OPEN'`, [gamiyaId])).rows[0].n;
      return d ? `يوجد ${d} اعتراض مفتوح. يحسمه المنظم من صفحة الجمعية، وكل خطوة تُسجَّل هنا.` : 'لا توجد اعتراضات مفتوحة.';
    }
    if (intent === 'remind') {
      const isOrg = (await this.db.query(`SELECT 1 FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2 AND role='MANAGER'`, [gamiyaId, userId])).rows[0];
      if (!isOrg) return 'إرسال التذكير متاح لمنظم الجمعية.';
      const n = await this.runReminders(gamiyaId);
      return n ? `أرسلت ${n} تذكيراً.` : 'لا توجد تذكيرات جديدة اليوم؛ أُرسلت سابقاً أو لا توجد مستحقات.';
    }
    // Free-form question: numeric facts only, guarded.
    const r = await this.report(this.db, gamiyaId);
    const facts = { cycles: r.cycles, completedCycles: r.completedCycles, installmentsPaid: r.installmentsPaid, installmentsTotal: r.installmentsTotal, percentPaid: r.percentPaid, lateCount: r.late.length, openDisputes: r.openDisputes, currentCycle: r.current?.cycle ?? 0 };
    const chain = this.config.ai.chain;
    if (chain.providers.length) {
      const { result } = await chain.complete([
        { role: 'system', content: 'أنت مساعد جمعية ادخار. أجب بالعربية في جملتين أو ثلاث من الحقائق المعطاة فقط. لا تخترع أرقاماً ولا أسماء ولا تواريخ. إن لم تكفِ الحقائق فقل ذلك واقترح أمراً من: تقرير، حسابي، المتأخرين، القادم.' },
        { role: 'user', content: `الحقائق: ${JSON.stringify(facts)}\nالسؤال: ${text.slice(0, 300)}` },
      ], { maxTokens: 200 });
      if (result && guardNumbers(result.text, facts as any).ok) return result.text;
    }
    return `لم أفهم السؤال بدقة.\n${HELP}`;
  }

  /**
   * Reminders, idempotent per installment/kind/day (reminder_log primary key), whatever triggers them:
   *  DUE_SOON  two days before the due date · DUE_TODAY on the due date · LATE after the grace period (daily).
   * Posts one assistant message per circle and kind, and an in-app notification to each payer. Returns how many were new.
   */
  async runReminders(gamiyaId?: string): Promise<number> {
    return this.db.tx(async (c) => {
      const rows = (await c.query(
        `SELECT i.id, g.id AS gamiya_id, g.currency, cy.cycle_index, cy.due_date, i.amount_due, p.user_id, pu.full_name,
                CASE WHEN cy.due_date = ${TODAY} THEN 'DUE_TODAY'
                     WHEN cy.due_date BETWEEN ${TODAY} + 1 AND ${TODAY} + 2 THEN 'DUE_SOON'
                     WHEN cy.due_date + g.grace_days < ${TODAY} THEN 'LATE' END AS kind
         FROM gamiya_installments i JOIN gamiya_cycles cy ON cy.id = i.cycle_id JOIN gamiyas g ON g.id = cy.gamiya_id
         JOIN gamiya_members p ON p.id = i.member_id JOIN users pu ON pu.id = p.user_id
         LEFT JOIN installment_settlements s ON s.installment_id = i.id
         WHERE g.status = 'ACTIVE' AND i.status <> 'PAID' AND (s.installment_id IS NULL OR s.voided_at IS NOT NULL)
           AND ($1::uuid IS NULL OR g.id = $1)`, [gamiyaId ?? null])).rows.filter((r) => r.kind);
      const fresh: any[] = [];
      for (const r of rows) {
        const ins = await c.query(`INSERT INTO reminder_log (installment_id, kind, sent_on) VALUES ($1,$2,${TODAY}) ON CONFLICT DO NOTHING RETURNING 1`, [r.id, r.kind]);
        if (ins.rowCount) fresh.push(r);
      }
      const groups = new Map<string, any[]>();
      for (const r of fresh) groups.set(`${r.gamiya_id}|${r.kind}|${r.cycle_index}`, [...(groups.get(`${r.gamiya_id}|${r.kind}|${r.cycle_index}`) ?? []), r]);
      for (const list of groups.values()) {
        const f = list[0];
        const names = list.map((x) => x.full_name).join('، ');
        const what = f.kind === 'DUE_TODAY' ? 'مستحق اليوم' : f.kind === 'DUE_SOON' ? `مستحق في ${f.due_date}` : `متأخر منذ ${f.due_date}`;
        await this.chat.post(c, { gamiyaId: f.gamiya_id, kind: 'ASSISTANT', body: `تذكير: قسط الدورة ${f.cycle_index} (${this.fmt(f.amount_due)} ${f.currency}) ${what} على: ${names}. بعد التحويل أرفقوا الإيصال من صفحة الجمعية.`, refEntity: 'reminder', refId: f.kind });
        await this.chat.notify(c, list.map((x) => x.user_id), { gamiyaId: f.gamiya_id, kind: `REMINDER_${f.kind}`, body: `قسط الدورة ${f.cycle_index} ${what}` });
      }
      return fresh.length;
    });
  }
}
