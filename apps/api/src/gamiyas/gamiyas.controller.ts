import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ClientIp, CorrelationId, CurrentUser, parseBody, parseId, uuid, type AuthUser } from '../common/http.ts';
import { GamiyasService } from './gamiyas.service.ts';
import { Db } from '../common/db.ts';

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  country: z.enum(['SA', 'EG', 'AE']).default('SA'),
  frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  contribution: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'decimal string, e.g. "1000" or "1000.50"'),
  memberCount: z.number().int().min(2).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  graceDays: z.number().int().min(0).max(14).default(3),
  agreementVersionId: uuid,
});
const PreviewSchema = CreateSchema.pick({ country: true, frequency: true, contribution: true, memberCount: true, startDate: true });
const InviteSchema = z.object({ maxUses: z.number().int().min(1).max(60).default(1), expiresInHours: z.number().int().min(1).max(168).default(72) });
const AcceptSchema = z.object({ agreementVersionId: uuid });
const ExecuteSchema = z.object({ publicEntropy: z.string().trim().min(8).max(200) });

@Controller('api/v1')
export class GamiyasController {
  constructor(private readonly svc: GamiyasService, private readonly db: Db) {}

  @Get('agreements/current')
  agreement() { return this.svc.currentAgreement(); }

  @Post('gamiyas')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown, @ClientIp() ip: string | null, @CorrelationId() cid: string) {
    return this.svc.create(u.id, { ...parseBody(CreateSchema, body), currency: '' }, ip, cid);
  }

  @Post('gamiyas/preview') @HttpCode(200)
  preview(@Body() body: unknown) { return this.svc.preview(parseBody(PreviewSchema, body)); }

  @Get('gamiyas')
  mine(@CurrentUser() u: AuthUser) { return this.svc.listMine(u.id); }

  @Get('gamiyas/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.details(this.db, parseId(id), u.id); }

  @Post('gamiyas/:id/invitations')
  invite(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    const b = parseBody(InviteSchema, body ?? {});
    return this.svc.createInvitation(parseId(id), u.id, b.maxUses, b.expiresInHours, cid);
  }

  @Post('invitations/:code/accept') @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() body: unknown, @ClientIp() ip: string | null, @CorrelationId() cid: string) {
    return this.svc.acceptInvitation(code, u.id, parseBody(AcceptSchema, body).agreementVersionId, ip, cid);
  }

  @Post('gamiyas/:id/lottery/trial') @HttpCode(200)
  trial(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.trialDraw(parseId(id), u.id); }

  @Post('gamiyas/:id/lottery/prepare')
  prepare(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.prepareLottery(parseId(id), u.id, cid); }

  @Post('gamiyas/:id/lottery/approve') @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @CorrelationId() cid: string) { return this.svc.approveLottery(parseId(id), u.id, cid); }

  @Post('gamiyas/:id/lottery/execute') @HttpCode(200)
  execute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.svc.executeLottery(parseId(id), u.id, parseBody(ExecuteSchema, body).publicEntropy, cid);
  }

  @Get('gamiyas/:id/lottery')
  lottery(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.lotteryStatus(parseId(id), u.id); }
}
