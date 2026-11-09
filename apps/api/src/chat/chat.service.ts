import { Injectable } from '@nestjs/common';
import type { Queryable } from '../common/db.ts';

/**
 * Circle chat log. Three kinds share one append-only timeline:
 *  USER      — a member's message
 *  SYSTEM    — automatic record of a transaction step (declared, approved, confirmed, disputed, resolved, joined, drawn)
 *  ASSISTANT — replies and reminders from the circle assistant
 * Messages are plain text; clients render them as text, never HTML.
 */
@Injectable()
export class ChatService {
  async post(q: Queryable, m: { gamiyaId: string; kind: 'USER' | 'SYSTEM' | 'ASSISTANT'; body: string; senderUserId?: string | null; refEntity?: string; refId?: string }) {
    const body = m.body.length > 2000 ? m.body.slice(0, 1997) + '…' : m.body;
    const { rows } = await q.query(
      `INSERT INTO chat_messages (gamiya_id, kind, sender_user_id, body, ref_entity, ref_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [m.gamiyaId, m.kind, m.kind === 'USER' ? m.senderUserId : null, body, m.refEntity ?? null, m.refId ?? null]);
    return rows[0];
  }

  async notify(q: Queryable, userIds: string[], n: { gamiyaId?: string; kind: string; body: string }) {
    for (const u of new Set(userIds)) {
      await q.query(`INSERT INTO notifications (user_id, gamiya_id, kind, body) VALUES ($1,$2,$3,$4)`, [u, n.gamiyaId ?? null, n.kind, n.body]);
    }
  }
}
