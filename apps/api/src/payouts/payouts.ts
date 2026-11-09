import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../common/config.ts';
import { Db } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { seal, unseal } from '../common/crypto.ts';
import { badRequest, CorrelationId, CurrentUser, notFound, parseBody, parseId, type AuthUser } from '../common/http.ts';
import { transferGuide, transferReference } from '../../../../packages/financial-core/src/transfer.ts';
import { COUNTRIES, METHODS, methodsFor, normalizeMethodValue, type Country } from '../../../../packages/financial-core/src/payout-methods.ts';

const AddSchema = z.object({ country: z.enum(['SA', 'EG', 'AE']), kind: z.string().max(32), value: z.string().trim().min(3).max(64), isDefault: z.boolean().default(true) });

const aad = (userId: string) => `payout:${userId}`;

@Injectable()
export class PayoutsService {
  constructor(private readonly db: Db, private readonly audit: Audit, @Inject(CONFIG) private readonly config: AppConfig) {}

  directory(country?: string) {
    const list = country ? methodsFor(country as Country) : METHODS;
    return { countries: COUNTRIES, methods: list };
  }

  /** The owner sees only masked values of their own methods. */
  async mine(userId: string) {
    const { rows } = await this.db.query(
      `SELECT id, country, kind, value_last4, is_default, created_at FROM payout_methods WHERE user_id=$1 AND deleted_at IS NULL ORDER BY country, is_default DESC, created_at`, [userId]);
    return rows.map((r) => ({ id: r.id, country: r.country, kind: r.kind, masked: `••••${r.value_last4}`, isDefault: r.is_default }));
  }

  async add(userId: string, input: z.infer<typeof AddSchema>, cid: string) {
    const spec = METHODS.find((m) => m.kind === input.kind && m.country === input.country);
    if (!spec) throw badRequest('UNKNOWN_METHOD', 'this method is not available in that country');
    const n = normalizeMethodValue(input.kind, input.value);
    if (!n.ok) throw badRequest(n.error, 'check the number or IBAN and try again');
    return this.db.tx(async (c) => {
      const count = Number((await c.query(`SELECT count(*) FROM payout_methods WHERE user_id=$1 AND deleted_at IS NULL`, [userId])).rows[0].count);
      if (count >= 10) throw badRequest('TOO_MANY_METHODS', 'remove a method before adding another');
      const hasDefault = (await c.query(`SELECT 1 FROM payout_methods WHERE user_id=$1 AND country=$2 AND is_default AND deleted_at IS NULL`, [userId, input.country])).rows[0];
      const makeDefault = input.isDefault || !hasDefault;
      if (makeDefault) await c.query(`UPDATE payout_methods SET is_default=false WHERE user_id=$1 AND country=$2 AND deleted_at IS NULL`, [userId, input.country]);
      const row = (await c.query(
        `INSERT INTO payout_methods (user_id, country, kind, value_ciphertext, value_last4, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [userId, input.country, input.kind, seal(this.config.payoutKey!, n.value, aad(userId)), n.last4, makeDefault])).rows[0];
      await this.audit.log(c, { actorId: userId, action: 'PAYOUT_METHOD_ADDED', entity: 'payout_method', entityId: row.id, correlationId: cid, details: { kind: input.kind } });
      return { id: row.id, country: input.country, kind: input.kind, masked: `••••${n.last4}`, isDefault: makeDefault };
    });
  }

  async remove(userId: string, id: string, cid: string) {
    const r = await this.db.query(`UPDATE payout_methods SET deleted_at=now(), is_default=false WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id`, [id, userId]);
    if (!r.rowCount) throw notFound('payout method');
    await this.audit.log(this.db, { actorId: userId, action: 'PAYOUT_METHOD_REMOVED', entity: 'payout_method', entityId: id, correlationId: cid });
    return { removed: true };
  }

  /**
   * Full details of the recipient's methods, shown only to the payer of this specific installment while it is unpaid.
   * Every reveal is audited. The platform never initiates the transfer.
   */
  async payTo(installmentId: string, userId: string, cid: string) {
    const r = (await this.db.query(
      `SELECT i.id, i.amount_due, g.currency, g.country, ru.id AS recipient_user_id, ru.full_name AS recipient_name, payer.user_id AS payer_user_id,
              (SELECT recipient_confirmed_at FROM installment_settlements s WHERE s.installment_id = i.id) AS confirmed
       FROM gamiya_installments i JOIN gamiya_cycles cy ON cy.id = i.cycle_id JOIN gamiyas g ON g.id = cy.gamiya_id
       JOIN gamiya_members payer ON payer.id = i.member_id JOIN gamiya_members rcp ON rcp.id = cy.recipient_member_id JOIN users ru ON ru.id = rcp.user_id
       WHERE i.id=$1`, [installmentId])).rows[0];
    if (!r || r.payer_user_id !== userId) throw notFound('installment');
    const reference = transferReference(r.id);
    if (r.confirmed) return { recipient: r.recipient_name, amount: r.amount_due, currency: r.currency, reference, methods: [], note: 'already confirmed' };
    const methods = (await this.db.query(
      `SELECT id, kind, value_ciphertext, is_default FROM payout_methods WHERE user_id=$1 AND country=$2 AND deleted_at IS NULL ORDER BY is_default DESC, created_at`,
      [r.recipient_user_id, r.country])).rows;
    await this.audit.log(this.db, { actorId: userId, action: 'PAYOUT_DETAILS_VIEWED', entity: 'installment', entityId: installmentId, correlationId: cid, details: { recipient: r.recipient_user_id, count: methods.length } });
    return {
      recipient: r.recipient_name, amount: r.amount_due, currency: r.currency,
      // Write this in the transfer note: it lets the organizer and the recipient match the transfer to this installment.
      reference,
      methods: methods.map((m) => {
        const spec = METHODS.find((s) => s.kind === m.kind)!;
        return { kind: m.kind, name: spec.name, value: unseal(this.config.payoutKey!, m.value_ciphertext, aad(r.recipient_user_id)), isDefault: m.is_default,
                 guide: transferGuide(m.kind, Number(r.amount_due), r.currency) };
      }),
    };
  }
}

@Controller('api/v1')
export class PayoutsController {
  constructor(private readonly svc: PayoutsService) {}

  @Get('payout-methods/directory')
  directory(@Query('country') country?: string) { return this.svc.directory(country); }

  @Get('me/payout-methods')
  mine(@CurrentUser() u: AuthUser) { return this.svc.mine(u.id); }

  @Post('me/payout-methods')
  add(@CurrentUser() u: AuthUser, @Body() body: unknown, @CorrelationId() cid: string) { return this.svc.add(u.id, parseBody(AddSchema, body), cid); }

  @Post('me/payout-methods/:id/remove') @HttpCode(200)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.remove(u.id, parseId(id), cid); }

  @Get('installments/:id/pay-to')
  payTo(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.payTo(parseId(id), u.id, cid); }
}
