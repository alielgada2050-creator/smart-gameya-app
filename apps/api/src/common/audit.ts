import { Injectable } from '@nestjs/common';
import type { Queryable } from './db.ts';

/** Append-only audit trail (DB trigger rejects UPDATE/DELETE). Never log OTP codes, ID numbers or tokens. */
@Injectable()
export class Audit {
  async log(q: Queryable, e: { actorId: string | null; action: string; entity: string; entityId: string; correlationId?: string; details?: object }) {
    await q.query(
      'INSERT INTO audit_logs (actor_id, action, entity, entity_id, correlation_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.actorId, e.action, e.entity, e.entityId, e.correlationId ?? null, e.details ? JSON.stringify(e.details) : null],
    );
  }
}
