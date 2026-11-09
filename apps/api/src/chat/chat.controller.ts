import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Db } from '../common/db.ts';
import { CurrentUser, parseBody, parseId, type AuthUser } from '../common/http.ts';
import { ChatService } from './chat.service.ts';
import { GamiyasService } from '../gamiyas/gamiyas.service.ts';
import { AssistantService, isForAssistant } from '../assistant/assistant.ts';

const MessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

@Controller('api/v1')
export class ChatController {
  constructor(private readonly db: Db, private readonly chat: ChatService, private readonly gamiyas: GamiyasService, private readonly assistant: AssistantService) {}

  @Get('gamiyas/:id/chat')
  async list(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('after') after?: string) {
    const gamiyaId = parseId(id);
    await this.gamiyas.membership(this.db, gamiyaId, u.id);
    const afterId = /^\d{1,18}$/.test(after ?? '') ? after : '0';
    const { rows } = await this.db.query(
      `SELECT c.id, c.kind, c.body, c.ref_entity, c.ref_id, c.created_at, c.sender_user_id, u.full_name
       FROM chat_messages c LEFT JOIN users u ON u.id = c.sender_user_id
       WHERE c.gamiya_id=$1 AND c.id > $2 ORDER BY c.id LIMIT 200`, [gamiyaId, afterId]);
    return rows.map((r) => ({ id: Number(r.id), kind: r.kind, body: r.body, sender: r.full_name ?? null, mine: r.sender_user_id === u.id, refEntity: r.ref_entity, refId: r.ref_id, at: r.created_at }));
  }

  @Post('gamiyas/:id/chat')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async send(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const gamiyaId = parseId(id);
    await this.gamiyas.membership(this.db, gamiyaId, u.id);
    const text = parseBody(MessageSchema, body).body;
    const mine = await this.chat.post(this.db, { gamiyaId, kind: 'USER', senderUserId: u.id, body: text });
    let reply = null;
    if (isForAssistant(text)) {
      const answer = await this.assistant.answer(gamiyaId, u.id, text);
      reply = await this.chat.post(this.db, { gamiyaId, kind: 'ASSISTANT', body: answer, refEntity: 'reply', refId: String(mine.id) });
      reply = { id: Number(reply.id), body: answer };
    }
    return { id: Number(mine.id), reply };
  }

  @Get('gamiyas/:id/assistant/report')
  async report(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const gamiyaId = parseId(id);
    await this.gamiyas.membership(this.db, gamiyaId, u.id);
    return { report: await this.assistant.report(this.db, gamiyaId), statement: await this.assistant.statement(this.db, gamiyaId, u.id) };
  }

  @Post('gamiyas/:id/reminders/run') @HttpCode(200)
  async remind(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const gamiyaId = parseId(id);
    const g = await this.gamiyas.membership(this.db, gamiyaId, u.id);
    if (g.role !== 'MANAGER') return { sent: 0, note: 'organizer only' };
    return { sent: await this.assistant.runReminders(gamiyaId) };
  }

  @Get('me/notifications')
  async notifications(@CurrentUser() u: AuthUser) {
    const { rows } = await this.db.query(
      `SELECT n.id, n.kind, n.body, n.gamiya_id, n.created_at, n.read_at, g.name AS gamiya_name FROM notifications n LEFT JOIN gamiyas g ON g.id = n.gamiya_id
       WHERE n.user_id=$1 ORDER BY n.id DESC LIMIT 50`, [u.id]);
    return { unread: rows.filter((r) => !r.read_at).length, items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, body: r.body, gamiyaId: r.gamiya_id, gamiyaName: r.gamiya_name, at: r.created_at, read: !!r.read_at })) };
  }

  @Post('me/notifications/read') @HttpCode(200)
  async read(@CurrentUser() u: AuthUser) {
    await this.db.query(`UPDATE notifications SET read_at = now() WHERE user_id=$1 AND read_at IS NULL`, [u.id]);
    return { ok: true };
  }
}
