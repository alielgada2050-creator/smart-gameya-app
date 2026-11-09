import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { conflict, CorrelationId, CurrentUser, forbidden, notFound, parseBody, parseId, type AuthUser } from '../common/http.ts';
import { GamiyasService } from '../gamiyas/gamiyas.service.ts';

/**
 * Model A settlement: the payer transfers directly to the cycle recipient (outside the platform), then
 *   1) the payer declares the payment (optional own reference, never account numbers), and
 *   2) the recipient confirms receipt — only then is the installment PAID. The recipient may dispute instead.
 * Effective status is computed on the server in the circle's local calendar (Asia/Riyadh), never the client clock.
 */
const EFFECTIVE_STATUS = `
  CASE
    WHEN s.recipient_confirmed_at IS NOT NULL THEN 'PAID'
    WHEN s.disputed THEN 'DISPUTED'
    WHEN s.payer_declared_at IS NOT NULL THEN 'AWAITING_CONFIRMATION'
    WHEN cy.due_date + g.grace_days < (now() AT TIME ZONE 'Asia/Riyadh')::date THEN 'LATE'
    WHEN cy.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date THEN 'IN_GRACE'
    WHEN cy.due_date = (now() AT TIME ZONE 'Asia/Riyadh')::date THEN 'DUE'
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
  LEFT JOIN installment_settlements s ON s.installment_id = i.id`;

const FIELDS = `i.id, g.id AS gamiya_id, g.name AS gamiya_name, g.currency, cy.cycle_index, cy.due_date, i.amount_due,
  pu.full_name AS payer_name, ru.full_name AS recipient_name, payer.user_id AS payer_user_id, rcp.user_id AS recipient_user_id,
  s.payer_reference, ${EFFECTIVE_STATUS} AS status`;

const DeclareSchema = z.object({ reference: z.string().trim().max(64).regex(/^[\p{L}\p{N} _\-#/]*$/u).optional() });

function view(r: any, me: string) {
  return {
    installmentId: r.id, gamiyaId: r.gamiya_id, gamiyaName: r.gamiya_name, cycle: r.cycle_index, dueDate: r.due_date,
    amount: r.amount_due, currency: r.currency, payer: r.payer_name, recipient: r.recipient_name,
    direction: r.payer_user_id === me ? 'I_PAY' : 'I_RECEIVE', status: r.status, reference: r.payer_reference ?? null,
  };
}

@Injectable()
export class InstallmentsService {
  constructor(private readonly db: Db, private readonly audit: Audit, private readonly gamiyas: GamiyasService) {}

  async myObligations(userId: string) {
    const { rows } = await this.db.query(
      `SELECT ${FIELDS} ${BASE} WHERE (payer.user_id = $1 OR rcp.user_id = $1) ORDER BY cy.due_date, g.name`, [userId]);
    const items = rows.map((r) => view(r, userId));
    return {
      asOf: new Date().toISOString(),
      toPay: items.filter((i) => i.direction === 'I_PAY' && i.status !== 'PAID'),
      toConfirm: items.filter((i) => i.direction === 'I_RECEIVE' && i.status === 'AWAITING_CONFIRMATION'),
      late: items.filter((i) => i.status === 'LATE'),
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

  private async load(c: any, id: string) {
    const r = (await c.query(`SELECT ${FIELDS}, s.installment_id AS has_settlement, s.recipient_confirmed_at ${BASE} WHERE i.id=$1 FOR UPDATE OF i`, [id])).rows[0];
    if (!r) throw notFound('installment');
    return r;
  }

  async declarePaid(id: string, userId: string, reference: string | undefined, cid: string) {
    return this.db.tx(async (c) => {
      const r = await this.load(c, id);
      if (r.payer_user_id !== userId && r.recipient_user_id !== userId) throw notFound('installment');
      if (r.payer_user_id !== userId) throw forbidden('only the payer can declare this payment');
      if (r.has_settlement) throw conflict('ALREADY_DECLARED', 'payment already declared');
      await c.query(`INSERT INTO installment_settlements (installment_id, payer_declared_at, payer_reference) VALUES ($1, now(), $2)`, [id, reference ?? null]);
      await this.audit.log(c, { actorId: userId, action: 'PAYMENT_DECLARED', entity: 'installment', entityId: id, correlationId: cid });
      return view(await this.load(c, id), userId);
    });
  }

  async confirmReceived(id: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const r = await this.load(c, id);
      if (r.payer_user_id !== userId && r.recipient_user_id !== userId) throw notFound('installment');
      if (r.recipient_user_id !== userId) throw forbidden('only the cycle recipient can confirm receipt');
      if (!r.has_settlement) throw conflict('NOT_DECLARED', 'the payer has not declared this payment yet');
      if (r.recipient_confirmed_at) throw conflict('ALREADY_CONFIRMED', 'already confirmed');
      await c.query(`UPDATE installment_settlements SET recipient_confirmed_at = now(), recipient_confirmed_by = $2, disputed = false WHERE installment_id = $1`, [id, userId]);
      await c.query(`UPDATE gamiya_installments SET status = 'PAID' WHERE id = $1`, [id]);
      await this.audit.log(c, { actorId: userId, action: 'PAYMENT_CONFIRMED', entity: 'installment', entityId: id, correlationId: cid });
      const left = Number((await c.query(
        `SELECT count(*) FROM gamiya_installments i JOIN gamiya_cycles cy ON cy.id = i.cycle_id WHERE cy.gamiya_id = $1 AND i.status <> 'PAID'`, [r.gamiya_id])).rows[0].count);
      if (left === 0) {
        await c.query(`UPDATE gamiyas SET status = 'COMPLETED' WHERE id = $1`, [r.gamiya_id]);
        await this.audit.log(c, { actorId: userId, action: 'GAMIYA_COMPLETED', entity: 'gamiya', entityId: r.gamiya_id, correlationId: cid });
      }
      return { ...view(await this.load(c, id), userId), circleCompleted: left === 0 };
    });
  }

  async dispute(id: string, userId: string, cid: string) {
    return this.db.tx(async (c) => {
      const r = await this.load(c, id);
      if (r.payer_user_id !== userId && r.recipient_user_id !== userId) throw notFound('installment');
      if (r.recipient_user_id !== userId) throw forbidden('only the cycle recipient can dispute');
      if (!r.has_settlement) throw conflict('NOT_DECLARED', 'nothing to dispute');
      if (r.recipient_confirmed_at) throw conflict('ALREADY_CONFIRMED', 'confirmed payments cannot be disputed here; open a support case');
      await c.query(`UPDATE installment_settlements SET disputed = true WHERE installment_id = $1`, [id]);
      await this.audit.log(c, { actorId: userId, action: 'PAYMENT_DISPUTED', entity: 'installment', entityId: id, correlationId: cid });
      return view(await this.load(c, id), userId);
    });
  }
}

@Controller('api/v1')
export class InstallmentsController {
  constructor(private readonly svc: InstallmentsService) {}

  @Get('me/obligations')
  mine(@CurrentUser() u: AuthUser) { return this.svc.myObligations(u.id); }

  @Get('gamiyas/:id/schedule')
  schedule(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.schedule(parseId(id), u.id); }

  @Post('installments/:id/declare-paid') @HttpCode(200)
  declare(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.declarePaid(parseId(id), u.id, parseBody(DeclareSchema, body ?? {}).reference, cid);
  }

  @Post('installments/:id/confirm-received') @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.confirmReceived(parseId(id), u.id, cid); }

  @Post('installments/:id/dispute') @HttpCode(200)
  dispute(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.dispute(parseId(id), u.id, cid); }
}
