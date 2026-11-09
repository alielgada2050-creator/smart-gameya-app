import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Db, type Queryable } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { conflict, CorrelationId, CurrentUser, forbidden, notFound, parseBody, parseId, uuid, type AuthUser } from '../common/http.ts';
import { GamiyasService } from '../gamiyas/gamiyas.service.ts';
import { ChatService } from '../chat/chat.service.ts';
import { METHODS } from '../../../../packages/financial-core/src/payout-methods.ts';
import { matchDeclaration, transferReference } from '../../../../packages/financial-core/src/transfer.ts';

/**
 * Model A settlement with three approvals (owner request 2026-11-09):
 *   1. the PAYER transfers outside the app (IBAN / STC Pay / Barq / InstaPay / Vodafone Cash …) and declares it with the receipt;
 *   2. the ORGANIZER reviews the receipt and approves it (skipped when the organizer is the payer or the recipient);
 *   3. the RECIPIENT confirms the money arrived — only then is the installment PAID.
 * The organizer may reject a receipt and the recipient may dispute; both send the payer back to declare again.
 * Every step is an append-only settlement event and a SYSTEM chat message, which together form the transaction record.
 */
const TODAY = `(now() AT TIME ZONE 'Asia/Riyadh')::date`;
const LIVE = `(s.payer_declared_at IS NOT NULL AND s.voided_at IS NULL)`;
const NEEDS_ORGANIZER = `(mgr.user_id <> payer.user_id AND mgr.user_id <> rcp.user_id)`;
const EFFECTIVE_STATUS = `
  CASE
    WHEN s.recipient_confirmed_at IS NOT NULL THEN 'PAID'
    WHEN ${LIVE} AND s.disputed THEN 'DISPUTED'
    WHEN ${LIVE} AND ${NEEDS_ORGANIZER} AND s.organizer_approved_at IS NULL THEN 'AWAITING_ORGANIZER'
    WHEN ${LIVE} THEN 'AWAITING_CONFIRMATION'
    WHEN cy.due_date + g.grace_days < ${TODAY} THEN 'LATE'
    WHEN cy.due_date < ${TODAY} THEN 'IN_GRACE'
    WHEN cy.due_date = ${TODAY} THEN 'DUE'
    ELSE 'SCHEDULED'
  END`;

const BASE = `
  FROM gamiya_installments i
  JOIN gamiya_cycles cy ON cy.id = i.cycle_id
  JOIN gamiyas g ON g.id = cy.gamiya_id
  JOIN gamiya_members payer ON payer.id = i.member_id
  JOIN users pu ON pu.id = payer.user_id
  JOIN gamiya_members rcp ON rcp.id = cy.recipient_member_id
  JOIN users ru ON ru.id = rcp.user_id
  JOIN gamiya_members mgr ON mgr.gamiya_id = g.id AND mgr.role = 'MANAGER'
  LEFT JOIN installment_settlements s ON s.installment_id = i.id`;

const FIELDS = `i.id, g.id AS gamiya_id, g.name AS gamiya_name, g.currency, g.country, cy.cycle_index, cy.due_date, i.amount_due,
  pu.full_name AS payer_name, ru.full_name AS recipient_name, payer.user_id AS payer_user_id, rcp.user_id AS recipient_user_id, mgr.user_id AS organizer_user_id,
  s.payer_reference, s.method_kind, s.receipt_file_id, s.attempts, s.declared_amount, s.transfer_date, s.match_result, ${NEEDS_ORGANIZER} AS needs_organizer, ${EFFECTIVE_STATUS} AS status`;

const ref = z.string().trim().max(64).regex(/^[\p{L}\p{N} _\-#/]*$/u);
const DeclareSchema = z.object({
  methodKind: z.string().max(32), receiptFileId: uuid, reference: ref.optional(),
  // Smart transfers: what was actually sent and when; checked automatically against what was due.
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).optional(),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const ResolveSchema = z.object({ outcome: z.enum(['PAYER_TO_RESEND', 'RECEIPT_VALID']), note: z.string().trim().min(3).max(500) });

function view(r: any, me: string) {
  const role = r.payer_user_id === me ? 'I_PAY' : r.recipient_user_id === me ? 'I_RECEIVE' : 'I_ORGANIZE';
  return {
    installmentId: r.id, gamiyaId: r.gamiya_id, gamiyaName: r.gamiya_name, cycle: r.cycle_index, dueDate: r.due_date,
    amount: r.amount_due, currency: r.currency, country: r.country, payer: r.payer_name, recipient: r.recipient_name, direction: role,
    status: r.status, reference: r.payer_reference ?? null, methodKind: r.method_kind ?? null, receiptFileId: r.receipt_file_id ?? null,
    needsOrganizer: r.needs_organizer, attempts: r.attempts ?? 0,
    transferReference: transferReference(r.id),
    declaredAmount: r.declared_amount ?? null, transferDate: r.transfer_date ? isoDate(r.transfer_date) : null, match: r.match_result ?? null,
  };
}

function isoDate(d: Date | string) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const money = (r: any) => `${r.amount_due} ${r.currency}`;

@Injectable()
export class InstallmentsService {
  constructor(private readonly db: Db, private readonly audit: Audit, private readonly gamiyas: GamiyasService, private readonly chat: ChatService) {}

  async myObligations(userId: string) {
    const { rows } = await this.db.query(
      `SELECT ${FIELDS} ${BASE} WHERE (payer.user_id = $1 OR rcp.user_id = $1 OR mgr.user_id = $1) ORDER BY cy.due_date, g.name`, [userId]);
    const items = rows.map((r) => view(r, userId));
    return {
      asOf: new Date().toISOString(),
      toPay: items.filter((i) => i.direction === 'I_PAY' && i.status !== 'PAID'),
      toApprove: items.filter((i) => i.direction === 'I_ORGANIZE' && i.status === 'AWAITING_ORGANIZER'),
      toConfirm: items.filter((i) => i.direction === 'I_RECEIVE' && i.status === 'AWAITING_CONFIRMATION'),
      late: items.filter((i) => i.direction === 'I_PAY' && i.status === 'LATE'),
    };
  }

  async schedule(gamiyaId: string, userId: string) {
    await this.gamiyas.membership(this.db, gamiyaId, userId);
    const { rows } = await this.db.query(`SELECT ${FIELDS} ${BASE} WHERE g.id=$1 ORDER BY cy.cycle_index, pu.full_name`, [gamiyaId]);
    const cycles = new Map<number, any>();
    for (const r of rows) {
      const c = cycles.get(r.cycle_index) ?? { cycle: r.cycle_index, dueDate: r.due_date, recipient: r.recipient_name, installments: [] as any[] };
      c.installments.push({ installmentId: r.id, payer: r.payer_name, amount: r.amount_due, status: r.status });
      cycles.set(r.cycle_index, c);
    }
    return [...cycles.values()].map((c) => ({ ...c, paid: c.installments.filter((i: any) => i.status === 'PAID').length, total: c.installments.length }));
  }

  private async load(c: Queryable, id: string, lock = true) {
    const r = (await c.query(`SELECT ${FIELDS}, s.installment_id AS has_settlement, s.voided_at, s.recipient_confirmed_at, s.organizer_approved_at, s.disputed
      ${BASE} WHERE i.id=$1 ${lock ? 'FOR UPDATE OF i' : ''}`, [id])).rows[0];
    if (!r) throw notFound('installment');
    return r;
  }

  private party(r: any, userId: string) {
    if (![r.payer_user_id, r.recipient_user_id, r.organizer_user_id].includes(userId)) throw notFound('installment');
  }

  private async event(c: Queryable, installmentId: string, actorId: string, event: string, extra: { receiptFileId?: string | null; note?: string | null } = {}) {
    await c.query(`INSERT INTO settlement_events (installment_id, actor_id, event, receipt_file_id, note) VALUES ($1,$2,$3,$4,$5)`,
      [installmentId, actorId, event, extra.receiptFileId ?? null, extra.note ?? null]);
  }

  /** Timeline of one installment for its three parties: events, receipts, open dispute. */
  async detail(id: string, userId: string) {
    const r = await this.load(this.db, id, false);
    this.party(r, userId);
    const events = (await this.db.query(
      `SELECT e.event, e.at, e.note, e.receipt_file_id, u.full_name AS actor FROM settlement_events e JOIN users u ON u.id = e.actor_id WHERE e.installment_id=$1 ORDER BY e.id`, [id])).rows;
    const dispute = (await this.db.query(`SELECT id, reason, status, outcome, resolution_note, opened_at FROM disputes WHERE installment_id=$1 ORDER BY opened_at DESC LIMIT 1`, [id])).rows[0] ?? null;
    return { ...view(r, userId), events: events.map((e) => ({ event: e.event, at: e.at, actor: e.actor, note: e.note, receiptFileId: e.receipt_file_id })), dispute };
  }

  async declarePaid(id: string, userId: string, input: z.infer<typeof DeclareSchema>, cid: string) {
    return this.db.tx(async (c) => {
      const r = await this.load(c, id);
      this.party(r, userId);
      if (r.payer_user_id !== userId) throw forbidden('only the payer can declare this payment');
      if (r.recipient_confirmed_at) throw conflict('ALREADY_CONFIRMED', 'already confirmed');
      if (r.has_settlement && !r.voided_at) throw conflict('ALREADY_DECLARED', 'payment already declared');
      if (!METHODS.some((m) => m.kind === input.methodKind && m.country === r.country) && input.methodKind !== 'OTHER')
        throw conflict('UNKNOWN_METHOD', 'choose a transfer method available in this circle’s country');
      const f = (await c.query(`SELECT sha256 FROM uploaded_files WHERE id=$1 AND owner_id=$2 AND gamiya_id=$3 AND purpose='RECEIPT'`, [input.receiptFileId, userId, r.gamiya_id])).rows[0];
      if (!f) throw notFound('receipt');
      // A transfer can't predate the circle or be in the future (DATE check). One transfer pays one installment: the same receipt file (by content hash) cannot be attached to another installment.
      const reused = (await c.query(
        `SELECT 1 FROM installment_settlements s JOIN uploaded_files uf ON uf.id = s.receipt_file_id
         WHERE uf.sha256=$1 AND s.installment_id <> $2 AND s.voided_at IS NULL LIMIT 1`, [f.sha256, id])).rows[0];
      if (reused) throw conflict('RECEIPT_ALREADY_USED', 'this receipt is already attached to another payment');
      const bankRefUsed = input.reference ? !!(await c.query(
        `SELECT 1 FROM installment_settlements s JOIN gamiya_installments i ON i.id = s.installment_id JOIN gamiya_cycles cy ON cy.id = i.cycle_id
         WHERE cy.gamiya_id=$1 AND s.installment_id <> $2 AND s.voided_at IS NULL AND lower(s.payer_reference) = lower($3) LIMIT 1`, [r.gamiya_id, id, input.reference])).rows[0] : false;
      const recipientKinds = (await c.query(`SELECT kind FROM payout_methods WHERE user_id=$1 AND country=$2 AND deleted_at IS NULL`, [r.recipient_user_id, r.country])).rows.map((x) => x.kind);
      const today = (await c.query(`SELECT ${TODAY}::text AS d, (g.created_at AT TIME ZONE 'Asia/Riyadh')::date::text AS earliest FROM gamiya_cycles cy JOIN gamiya_installments i ON i.cycle_id = cy.id JOIN gamiyas g ON g.id = cy.gamiya_id WHERE i.id=$1`, [id])).rows[0];
      const m = matchDeclaration({
        amountDue: String(r.amount_due), declaredAmount: input.amount ?? '0', transferDate: input.transferDate ?? '0000-00-00', earliest: today.earliest, today: today.d,
        methodKind: input.methodKind, recipientKinds, receiptUsedElsewhere: false, bankRefUsedElsewhere: bankRefUsed,
      });
      const match = { ...m, provided: { amount: !!input.amount, transferDate: !!input.transferDate } };
      if (r.has_settlement) {
        await c.query(`UPDATE installment_settlements SET payer_declared_at=now(), payer_reference=$2, method_kind=$3, receipt_file_id=$4, voided_at=NULL,
                         disputed=false, organizer_approved_at=NULL, organizer_approved_by=NULL, attempts=attempts+1,
                         declared_amount=$5, transfer_date=$6, match_result=$7 WHERE installment_id=$1`,
          [id, input.reference ?? null, input.methodKind, input.receiptFileId, input.amount ?? null, input.transferDate ?? null, JSON.stringify(match)]);
      } else {
        await c.query(`INSERT INTO installment_settlements (installment_id, payer_declared_at, payer_reference, method_kind, receipt_file_id, declared_amount, transfer_date, match_result)
                       VALUES ($1, now(), $2, $3, $4, $5, $6, $7)`,
          [id, input.reference ?? null, input.methodKind, input.receiptFileId, input.amount ?? null, input.transferDate ?? null, JSON.stringify(match)]);
      }
      await c.query(`UPDATE gamiya_installments SET status='DUE' WHERE id=$1 AND status <> 'PAID'`, [id]);
      await this.event(c, id, userId, r.has_settlement ? 'REDECLARED' : 'DECLARED', { receiptFileId: input.receiptFileId, note: input.reference ?? null });
      const next = r.needs_organizer ? 'بانتظار اعتماد المنظم' : 'بانتظار تأكيد المستلم';
      const flagged = m.checks.filter((x) => !x.ok).length;
      const matchLine = flagged ? ` المطابقة التلقائية: ${flagged} ملاحظة للمراجعة.` : ' المطابقة التلقائية: كل الفحوص سليمة.';
      await this.chat.post(c, { gamiyaId: r.gamiya_id, kind: 'SYSTEM', body: `سجّل ${r.payer_name} تحويل ${money(r)} إلى ${r.recipient_name} (الدورة ${r.cycle_index}) وأرفق الإيصال. ${next}.${matchLine}`, refEntity: 'installment', refId: id });
      await this.chat.notify(c, [r.needs_organizer ? r.organizer_user_id : r.recipient_user_id], { gamiyaId: r.gamiya_id, kind: 'ACTION_NEEDED', body: `${r.payer_name}: تحويل ${money(r)} ${next}` });
      await this.audit.log(c, { actorId: userId, action: 'PAYMENT_DECLARED', entity: 'installment', entityId: id, correlationId: cid, details: { method: input.methodKind, matchScore: m.score } });
      return view(await this.load(c, id), userId);
    });
  }

  async organizerDecision(id: string, userId: string, approve: boolean, reason: string | undefined, cid: string) {
    return this.db.tx(async (c) => {
      const r = await this.load(c, id);
      this.party(r, userId);
      if (r.organizer_user_id !== userId) throw forbidden('only the circle organizer can review receipts');
      if (!r.needs_organizer) throw conflict('NOT_REQUIRED', 'the organizer is a party to this transfer; no separate approval is needed');
      if (r.status !== 'AWAITING_ORGANIZER') throw conflict('NOT_AWAITING_ORGANIZER', `current status is ${r.status}`);
      if (approve) {
        await c.query(`UPDATE installment_settlements SET organizer_approved_at=now(), organizer_approved_by=$2 WHERE installment_id=$1`, [id, userId]);
        await this.event(c, id, userId, 'ORGANIZER_APPROVED');
        await this.chat.post(c, { gamiyaId: r.gamiya_id, kind: 'SYSTEM', body: `اعتمد المنظم إيصال ${r.payer_name} (الدورة ${r.cycle_index}). بانتظار تأكيد ${r.recipient_name}.`, refEntity: 'installment', refId: id });
        await this.chat.notify(c, [r.recipient_user_id], { gamiyaId: r.gamiya_id, kind: 'ACTION_NEEDED', body: `أكّد استلام ${money(r)} من ${r.payer_name}` });
      } else {
        await c.query(`UPDATE installment_settlements SET voided_at=now() WHERE installment_id=$1`, [id]);
        await this.event(c, id, userId, 'ORGANIZER_REJECTED', { note: reason });
        await this.chat.post(c, { gamiyaId: r.gamiya_id, kind: 'SYSTEM', body: `رفض المنظم إيصال ${r.payer_name} (الدورة ${r.cycle_index}): ${reason}. على ${r.payer_name} إعادة الإرسال.`, refEntity: 'installment', refId: id });
        await this.chat.notify(c, [r.payer_user_id], { gamiyaId: r.gamiya_id, kind: 'ACTION_NEEDED', body: `رُفض إيصالك: ${reason}` });
      }
      await this.audit.log(c, { actorId: userId, action: approve ? 'RECEIPT_APPROVED' : 'RECEIPT_REJECTED', entity: 'installment', entityId: id, correlationId: cid });
      return view(await this.load(c, id), userId);
    });
  }

  async confirmReceived(id: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const r = await this.load(c, id);
      this.party(r, userId);
      if (r.recipient_user_id !== userId) throw forbidden('only the cycle recipient can confirm receipt');
      if (r.recipient_confirmed_at) throw conflict('ALREADY_CONFIRMED', 'already confirmed');
      if (!r.has_settlement || r.voided_at) throw conflict('NOT_DECLARED', 'the payer has not declared this payment yet');
      if (r.status === 'AWAITING_ORGANIZER') throw conflict('AWAITING_ORGANIZER', 'the organizer must approve the receipt first');
      await c.query(`UPDATE installment_settlements SET recipient_confirmed_at = now(), recipient_confirmed_by = $2, disputed = false WHERE installment_id = $1`, [id, userId]);
      await c.query(`UPDATE gamiya_installments SET status = 'PAID' WHERE id = $1`, [id]);
      await c.query(`UPDATE disputes SET status='RESOLVED', outcome='RECEIPT_VALID', resolution_note='أكد المستلم الاستلام', resolved_by=$2, resolved_at=now() WHERE installment_id=$1 AND status='OPEN'`, [id, userId]);
      await this.event(c, id, userId, 'RECIPIENT_CONFIRMED');
      await this.chat.post(c, { gamiyaId: r.gamiya_id, kind: 'SYSTEM', body: `أكّد ${r.recipient_name} استلام ${money(r)} من ${r.payer_name} (الدورة ${r.cycle_index}). اكتملت المعاملة.`, refEntity: 'installment', refId: id });
      await this.audit.log(c, { actorId: userId, action: 'PAYMENT_CONFIRMED', entity: 'installment', entityId: id, correlationId: cid });
      const left = Number((await c.query(
        `SELECT count(*) FROM gamiya_installments i JOIN gamiya_cycles cy ON cy.id = i.cycle_id WHERE cy.gamiya_id = $1 AND i.status <> 'PAID'`, [r.gamiya_id])).rows[0].count);
      if (left === 0) {
        await c.query(`UPDATE gamiyas SET status = 'COMPLETED' WHERE id = $1`, [r.gamiya_id]);
        await this.chat.post(c, { gamiyaId: r.gamiya_id, kind: 'SYSTEM', body: 'اكتملت الجمعية: كل الأقساط مؤكدة من مستلميها.', refEntity: 'gamiya', refId: r.gamiya_id });
        await this.audit.log(c, { actorId: userId, action: 'GAMIYA_COMPLETED', entity: 'gamiya', entityId: r.gamiya_id, correlationId: cid });
      }
      return { ...view(await this.load(c, id), userId), circleCompleted: left === 0 };
    });
  }

  async dispute(id: string, userId: string, reason: string, cid: string) {
    return this.db.tx(async (c) => {
      const r = await this.load(c, id);
      this.party(r, userId);
      if (r.recipient_user_id !== userId) throw forbidden('only the cycle recipient can dispute');
      if (!r.has_settlement || r.voided_at) throw conflict('NOT_DECLARED', 'nothing to dispute');
      if (r.recipient_confirmed_at) throw conflict('ALREADY_CONFIRMED', 'confirmed payments cannot be disputed here; open a support case');
      if (r.disputed) throw conflict('ALREADY_DISPUTED', 'a dispute is already open');
      await c.query(`UPDATE installment_settlements SET disputed = true WHERE installment_id = $1`, [id]);
      const d = (await c.query(`INSERT INTO disputes (gamiya_id, installment_id, opened_by, reason) VALUES ($1,$2,$3,$4) RETURNING id`, [r.gamiya_id, id, userId, reason])).rows[0];
      await this.event(c, id, userId, 'DISPUTED', { note: reason });
      await this.chat.post(c, { gamiyaId: r.gamiya_id, kind: 'SYSTEM', body: `اعترض ${r.recipient_name} على تحويل ${r.payer_name} (الدورة ${r.cycle_index}): ${reason}. ${r.needs_organizer ? 'سيراجعه المنظم.' : 'ستراجعه إدارة المنصة.'}`, refEntity: 'dispute', refId: d.id });
      await this.chat.notify(c, [r.payer_user_id, r.organizer_user_id], { gamiyaId: r.gamiya_id, kind: 'DISPUTE_OPENED', body: `اعتراض على تحويل الدورة ${r.cycle_index}` });
      await this.audit.log(c, { actorId: userId, action: 'PAYMENT_DISPUTED', entity: 'installment', entityId: id, correlationId: cid });
      return { ...view(await this.load(c, id), userId), disputeId: d.id };
    });
  }

  /**
   * Resolve a dispute. The organizer decides unless they are a party (then a platform reviewer decides).
   *  PAYER_TO_RESEND — the declaration is voided; the payer must transfer/declare again with a valid receipt.
   *  RECEIPT_VALID   — the receipt stands; the dispute closes and the recipient is asked to confirm again.
   * Nobody can mark money as received on the recipient's behalf.
   */
  async resolve(disputeId: string, userId: string, input: z.infer<typeof ResolveSchema>, cid: string) {
    return this.db.tx(async (c) => {
      const d = (await c.query(`SELECT * FROM disputes WHERE id=$1 FOR UPDATE`, [disputeId])).rows[0];
      if (!d) throw notFound('dispute');
      const r = await this.load(c, d.installment_id);
      const reviewer = (await c.query(`SELECT 1 FROM users WHERE id=$1 AND platform_role IN ('PLATFORM_ADMIN','COMPLIANCE_OFFICER')`, [userId])).rows[0];
      const allowed = r.needs_organizer ? r.organizer_user_id === userId : !!reviewer && ![r.payer_user_id, r.recipient_user_id].includes(userId);
      if (!allowed) { if (![r.payer_user_id, r.recipient_user_id, r.organizer_user_id].includes(userId) && !reviewer) throw notFound('dispute'); throw forbidden('you cannot resolve this dispute'); }
      if (d.status !== 'OPEN') throw conflict('DISPUTE_CLOSED', 'dispute already resolved');
      await c.query(`UPDATE disputes SET status='RESOLVED', outcome=$2, resolution_note=$3, resolved_by=$4, resolved_at=now() WHERE id=$1`, [disputeId, input.outcome, input.note, userId]);
      if (input.outcome === 'PAYER_TO_RESEND') await c.query(`UPDATE installment_settlements SET voided_at=now(), disputed=false WHERE installment_id=$1`, [d.installment_id]);
      else await c.query(`UPDATE installment_settlements SET disputed=false WHERE installment_id=$1`, [d.installment_id]);
      await this.event(c, d.installment_id, userId, 'DISPUTE_RESOLVED', { note: `${input.outcome}: ${input.note}` });
      const msg = input.outcome === 'PAYER_TO_RESEND'
        ? `حُسم الاعتراض: على ${r.payer_name} إعادة التحويل أو إرسال إيصال صحيح. السبب: ${input.note}`
        : `حُسم الاعتراض: الإيصال صحيح. نرجو من ${r.recipient_name} مراجعة حسابه وتأكيد الاستلام. ${input.note}`;
      await this.chat.post(c, { gamiyaId: r.gamiya_id, kind: 'SYSTEM', body: msg, refEntity: 'dispute', refId: disputeId });
      await this.chat.notify(c, [r.payer_user_id, r.recipient_user_id], { gamiyaId: r.gamiya_id, kind: 'DISPUTE_RESOLVED', body: msg });
      await this.audit.log(c, { actorId: userId, action: 'DISPUTE_RESOLVED', entity: 'dispute', entityId: disputeId, correlationId: cid, details: { outcome: input.outcome } });
      return view(await this.load(c, d.installment_id), userId);
    });
  }

  async openDisputes(gamiyaId: string, userId: string) {
    await this.gamiyas.membership(this.db, gamiyaId, userId);
    return (await this.db.query(
      `SELECT d.id, d.installment_id, d.reason, d.opened_at, cy.cycle_index, pu.full_name AS payer, ru.full_name AS recipient,
              (mg.user_id <> p.user_id AND mg.user_id <> rc.user_id) AS organizer_decides
       FROM disputes d JOIN gamiya_installments i ON i.id = d.installment_id JOIN gamiya_cycles cy ON cy.id = i.cycle_id
       JOIN gamiya_members p ON p.id = i.member_id JOIN users pu ON pu.id = p.user_id JOIN gamiya_members rc ON rc.id = cy.recipient_member_id JOIN users ru ON ru.id = rc.user_id
       JOIN gamiya_members mg ON mg.gamiya_id = d.gamiya_id AND mg.role = 'MANAGER'
       WHERE d.gamiya_id=$1 AND d.status='OPEN' ORDER BY d.opened_at`, [gamiyaId])).rows
      .map((x) => ({ disputeId: x.id, installmentId: x.installment_id, reason: x.reason, openedAt: x.opened_at, cycle: x.cycle_index, payer: x.payer, recipient: x.recipient, organizerDecides: x.organizer_decides }));
  }

  /** Disputes the platform must decide: the organizer is the payer or the recipient. Reviewers only. */
  async platformDisputes(userId: string) {
    const reviewer = (await this.db.query(`SELECT 1 FROM users WHERE id=$1 AND platform_role IN ('PLATFORM_ADMIN','COMPLIANCE_OFFICER')`, [userId])).rows[0];
    if (!reviewer) throw notFound();
    return (await this.db.query(
      `SELECT d.id, d.installment_id, d.reason, d.opened_at, g.name AS gamiya_name, i.amount_due, g.currency, pu.full_name AS payer, ru.full_name AS recipient, s.receipt_file_id
       FROM disputes d JOIN gamiyas g ON g.id = d.gamiya_id JOIN gamiya_installments i ON i.id = d.installment_id JOIN gamiya_cycles cy ON cy.id = i.cycle_id
       JOIN gamiya_members p ON p.id = i.member_id JOIN users pu ON pu.id = p.user_id JOIN gamiya_members rc ON rc.id = cy.recipient_member_id JOIN users ru ON ru.id = rc.user_id
       JOIN gamiya_members mg ON mg.gamiya_id = d.gamiya_id AND mg.role = 'MANAGER' LEFT JOIN installment_settlements s ON s.installment_id = i.id
       WHERE d.status='OPEN' AND (mg.user_id = p.user_id OR mg.user_id = rc.user_id) AND NOT EXISTS (SELECT 1 FROM gamiya_members x WHERE x.gamiya_id = d.gamiya_id AND x.user_id = $1)
       ORDER BY d.opened_at`, [userId])).rows
      .map((x) => ({ disputeId: x.id, gamiyaName: x.gamiya_name, amount: x.amount_due, currency: x.currency, payer: x.payer, recipient: x.recipient, reason: x.reason, openedAt: x.opened_at, receiptFileId: x.receipt_file_id }));
  }
}

@Controller('api/v1')
export class InstallmentsController {
  constructor(private readonly svc: InstallmentsService) {}

  @Get('me/obligations')
  mine(@CurrentUser() u: AuthUser) { return this.svc.myObligations(u.id); }

  @Get('gamiyas/:id/schedule')
  schedule(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.schedule(parseId(id), u.id); }

  @Get('gamiyas/:id/disputes')
  disputes(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.openDisputes(parseId(id), u.id); }

  @Get('admin/disputes')
  platformDisputes(@CurrentUser() u: AuthUser) { return this.svc.platformDisputes(u.id); }

  @Get('installments/:id')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.detail(parseId(id), u.id); }

  @Post('installments/:id/declare-paid') @HttpCode(200)
  declare(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.declarePaid(parseId(id), u.id, parseBody(DeclareSchema, body), cid);
  }

  @Post('installments/:id/organizer-approve') @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.organizerDecision(parseId(id), u.id, true, undefined, cid); }

  @Post('installments/:id/organizer-reject') @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.organizerDecision(parseId(id), u.id, false, parseBody(ReasonSchema, body).reason, cid);
  }

  @Post('installments/:id/confirm-received') @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.confirmReceived(parseId(id), u.id, cid); }

  @Post('installments/:id/dispute') @HttpCode(200)
  dispute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.dispute(parseId(id), u.id, parseBody(ReasonSchema, body).reason, cid);
  }

  @Post('disputes/:id/resolve') @HttpCode(200)
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.resolve(parseId(id), u.id, parseBody(ResolveSchema, body), cid);
  }
}
