/**
 * Direct invitations (دعوة مباشرة): the organizer invites people by phone number, or in one tap everyone they already
 * share another circle with. Registered people get the invitation in the app (notification + «دعوات لك» on Home);
 * other numbers get a WhatsApp link to send, and see the invitation once they sign up with that number.
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Db, type Queryable } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { ChatService } from '../chat/chat.service.ts';
import { CorrelationId, CurrentUser, conflict, notFound, parseBody, parseId, type AuthUser } from '../common/http.ts';
import { GamiyasService, iso } from './gamiyas.service.ts';

const phone = z.string().regex(/^(\+9665\d{8}|\+201[0125]\d{8}|\+9715\d{8})$/);
const DirectSchema = z.object({ phones: z.array(phone).max(30).default([]), userIds: z.array(z.string().uuid()).max(30).default([]) })
  .refine((b) => b.phones.length + b.userIds.length > 0, { message: 'choose at least one person' });

@Injectable()
export class DirectInvitesService {
  constructor(private readonly db: Db, private readonly audit: Audit, private readonly chat: ChatService, private readonly gamiyas: GamiyasService) {}

  /** People the organizer shares another circle with, who are not in this one (yet). */
  async suggestions(gamiyaId: string, userId: string) {
    const g = await this.gamiyas.membership(this.db, gamiyaId, userId);
    this.gamiyas.requireManager(g);
    const rows = await this.suggestionsIn(this.db, gamiyaId, userId);
    return rows.map((r) => ({ userId: r.id, fullName: r.full_name, phoneLast4: r.phone_e164?.slice(-4) ?? null, phone: r.phone_e164 ?? null, via: r.via, invited: r.invited }));
  }

  private async suggestionsIn(c: Queryable, gamiyaId: string, userId: string) {
    const { rows } = await c.query(
      `SELECT DISTINCT ON (u.id) u.id, u.full_name, u.phone_e164, og.name AS via,
              (SELECT d.status FROM direct_invitations d WHERE d.gamiya_id = $1 AND (d.phone_e164 = u.phone_e164 OR d.invited_user_id = u.id)
                ORDER BY d.created_at DESC LIMIT 1) AS invited
       FROM gamiya_members mine
       JOIN gamiya_members other ON other.gamiya_id = mine.gamiya_id AND other.user_id <> mine.user_id AND other.status <> 'WITHDRAWN'
       JOIN users u ON u.id = other.user_id AND u.deleted_at IS NULL
       JOIN gamiyas og ON og.id = mine.gamiya_id
       WHERE mine.user_id = $2 AND mine.status <> 'WITHDRAWN' AND mine.gamiya_id <> $1
         AND NOT EXISTS (SELECT 1 FROM gamiya_members x WHERE x.gamiya_id = $1 AND x.user_id = u.id AND x.status <> 'WITHDRAWN')
       ORDER BY u.id, og.created_at DESC LIMIT 60`, [gamiyaId, userId]);
    return rows as any[];
  }

  async invite(gamiyaId: string, userId: string, phones: string[], cid: string, userIds: string[] = []) {
    return this.db.tx(async (c) => {
      const g = await this.gamiyas.membership(c, gamiyaId, userId, true);
      this.gamiyas.requireManager(g);
      if (g.status !== 'RECRUITING') throw conflict('NOT_RECRUITING', 'circle is not accepting members');
      // Accounts picked from «people from your other circles»: only people the organizer really shares a circle with.
      const known = new Map((await this.suggestionsIn(c, gamiyaId, userId)).map((r) => [r.id, r]));
      const byAccount = [...new Set(userIds)].map((id) => known.get(id)).filter(Boolean) as { id: string; full_name: string; phone_e164: string | null }[];
      const unique = [...new Set([...phones, ...byAccount.flatMap((u) => (u.phone_e164 ? [u.phone_e164] : []))])];
      const accountsOnly = byAccount.filter((u) => !u.phone_e164);
      const seats = Number((await c.query(`SELECT count(*) FROM gamiya_members WHERE gamiya_id=$1 AND status IN ('ACTIVE','PENDING_APPROVAL')`, [gamiyaId])).rows[0].count);
      const code = randomBytes(9).toString('base64url');
      const inv = (await c.query(
        `INSERT INTO gamiya_invitations (gamiya_id, code, invited_by, expires_at, max_uses) VALUES ($1,$2,$3, now() + interval '7 days', $4) RETURNING id`,
        [gamiyaId, code, userId, Math.max(1, unique.length + accountsOnly.length)])).rows[0];
      const organizer = (await c.query(`SELECT full_name FROM users WHERE id=$1`, [userId])).rows[0].full_name;
      const notified: { phone: string; fullName: string }[] = [];
      const toShare: string[] = [];
      const skipped: { phone: string; reason: 'ALREADY_MEMBER' | 'SELF' }[] = [];
      for (const p of unique) {
        const u = (await c.query(`SELECT id, full_name FROM users WHERE phone_e164=$1 AND deleted_at IS NULL`, [p])).rows[0];
        if (u?.id === userId) { skipped.push({ phone: p, reason: 'SELF' }); continue; }
        if (u && (await c.query(`SELECT 1 FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2 AND status <> 'WITHDRAWN'`, [gamiyaId, u.id])).rows[0]) {
          skipped.push({ phone: p, reason: 'ALREADY_MEMBER' }); continue;
        }
        // re-inviting the same number refreshes the invitation (new code, pending again)
        await c.query(
          `INSERT INTO direct_invitations (gamiya_id, invitation_id, phone_e164, invited_user_id, invited_by) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (gamiya_id, phone_e164) DO UPDATE SET invitation_id = EXCLUDED.invitation_id, invited_user_id = EXCLUDED.invited_user_id,
             status = 'PENDING', created_at = now(), responded_at = NULL`,
          [gamiyaId, inv.id, p, u?.id ?? null, userId]);
        if (u) {
          await this.chat.notify(c, [u.id], { gamiyaId, kind: 'ACTION_NEEDED', body: `${organizer} يدعوك للانضمام إلى «${g.name}». افتح «دعوات لك» لمراجعة الشروط.` });
          notified.push({ phone: p, fullName: u.full_name });
        } else toShare.push(p);
      }
      for (const u of accountsOnly) {
        await c.query(
          `INSERT INTO direct_invitations (gamiya_id, invitation_id, phone_e164, invited_user_id, invited_by) VALUES ($1,$2,NULL,$3,$4)
           ON CONFLICT (gamiya_id, invited_user_id) WHERE phone_e164 IS NULL DO UPDATE SET invitation_id = EXCLUDED.invitation_id,
             status = 'PENDING', created_at = now(), responded_at = NULL`, [gamiyaId, inv.id, u.id, userId]);
        await this.chat.notify(c, [u.id], { gamiyaId, kind: 'ACTION_NEEDED', body: `${organizer} يدعوك للانضمام إلى «${g.name}». افتح «دعوات لك» لمراجعة الشروط.` });
        notified.push({ phone: '', fullName: u.full_name });
      }
      if (notified.length) await this.chat.post(c, { gamiyaId, kind: 'SYSTEM', body: `دعا المنظم ${notified.length} أشخاص مباشرة: ${notified.map((n) => n.fullName).join('، ')}.`, refEntity: 'gamiya', refId: gamiyaId });
      await this.audit.log(c, { actorId: userId, action: 'DIRECT_INVITES_SENT', entity: 'gamiya', entityId: gamiyaId, correlationId: cid,
        details: { notified: notified.length, toShare: toShare.length, skipped: skipped.length } });
      return { code, notified, toShare, skipped, seatsLeft: Math.max(0, g.member_count - seats) };
    });
  }

  /** Invitations waiting for me: sent to my account, or to my number before I signed up. */
  async mine(userId: string) {
    const { rows } = await this.db.query(
      `SELECT d.id, i.code, g.id AS gamiya_id, g.name, g.category, g.currency, g.contribution, g.member_count, g.frequency, g.start_date, u.full_name AS organizer, d.created_at
       FROM direct_invitations d JOIN users me ON me.id = $1
       JOIN gamiya_invitations i ON i.id = d.invitation_id JOIN gamiyas g ON g.id = d.gamiya_id JOIN users u ON u.id = d.invited_by
       WHERE d.status = 'PENDING' AND (d.invited_user_id = me.id OR d.phone_e164 = me.phone_e164)
         AND g.status = 'RECRUITING' AND i.expires_at > now() AND i.uses < i.max_uses
         AND NOT EXISTS (SELECT 1 FROM gamiya_members x WHERE x.gamiya_id = g.id AND x.user_id = me.id AND x.status <> 'WITHDRAWN')
       ORDER BY d.created_at DESC`, [userId]);
    return rows.map((r) => ({ id: r.id, code: r.code, gamiyaId: r.gamiya_id, name: r.name, category: r.category, currency: r.currency, contribution: r.contribution,
      memberCount: r.member_count, frequency: r.frequency, startDate: iso(r.start_date), organizerName: r.organizer, invitedAt: r.created_at }));
  }

  async decline(id: string, userId: string) {
    const r = await this.db.query(
      `UPDATE direct_invitations d SET status='DECLINED', responded_at=now() FROM users me
       WHERE d.id=$1 AND me.id=$2 AND d.status='PENDING' AND (d.invited_user_id = me.id OR d.phone_e164 = me.phone_e164) RETURNING d.gamiya_id, d.invited_by`, [id, userId]);
    if (!r.rows[0]) throw notFound('invitation');
    const me = (await this.db.query(`SELECT full_name FROM users WHERE id=$1`, [userId])).rows[0].full_name;
    await this.chat.notify(this.db, [r.rows[0].invited_by], { gamiyaId: r.rows[0].gamiya_id, kind: 'INFO', body: `اعتذر ${me} عن الدعوة.` });
    return { declined: true };
  }
}

@Controller('api/v1')
export class DirectInvitesController {
  constructor(private readonly svc: DirectInvitesService) {}

  @Get('gamiyas/:id/invite-suggestions')
  suggestions(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.suggestions(parseId(id), u.id); }

  @Post('gamiyas/:id/invitations/direct') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  invite(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @CorrelationId() cid: string) {
    const b = parseBody(DirectSchema, body);
    return this.svc.invite(parseId(id), u.id, b.phones, cid, b.userIds);
  }

  @Get('me/invitations')
  mine(@CurrentUser() u: AuthUser) { return this.svc.mine(u.id); }

  @Post('me/invitations/:id/decline') @HttpCode(200)
  decline(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.decline(parseId(id), u.id); }
}
