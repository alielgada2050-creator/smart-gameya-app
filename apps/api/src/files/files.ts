import { Controller, Get, Inject, Injectable, Param, Post, Res, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../common/config.ts';
import { Db, type Queryable } from '../common/db.ts';
import { Audit } from '../common/audit.ts';
import { badRequest, CorrelationId, CurrentUser, notFound, parseBody, parseId, type AuthUser } from '../common/http.ts';

export const MAX_UPLOAD = 5 * 1024 * 1024;

/** Identify the file by its bytes, never by the name or the client-sent type. */
export function sniff(b: Buffer): string | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const UploadSchema = z.object({ purpose: z.enum(['RECEIPT', 'PROMISSORY_NOTE']) });

@Injectable()
export class FilesService {
  constructor(private readonly db: Db, private readonly audit: Audit, @Inject(CONFIG) private readonly config: AppConfig) {}

  async store(userId: string, gamiyaId: string, purpose: string, buf: Buffer | undefined, cid: string) {
    if (!buf || buf.length === 0) throw badRequest('FILE_REQUIRED', 'attach a PDF or image (field "file")');
    if (buf.length > MAX_UPLOAD) throw badRequest('FILE_TOO_LARGE', 'maximum 5 MB');
    const mime = sniff(buf);
    if (!mime) throw badRequest('FILE_TYPE', 'only PDF, PNG, JPEG or WEBP files are accepted');
    const member = (await this.db.query(`SELECT 1 FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2`, [gamiyaId, userId])).rows[0];
    if (!member) throw notFound('gamiya');
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const key = `${gamiyaId}/${randomUUID()}`;
    await mkdir(join(this.config.uploadDir!, gamiyaId), { recursive: true });
    await writeFile(join(this.config.uploadDir!, key), buf, { mode: 0o600 });
    const row = (await this.db.query(
      `INSERT INTO uploaded_files (owner_id, gamiya_id, purpose, mime, size_bytes, sha256, storage_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [userId, gamiyaId, purpose, mime, buf.length, sha256, key])).rows[0];
    await this.audit.log(this.db, { actorId: userId, action: 'FILE_UPLOADED', entity: 'file', entityId: row.id, correlationId: cid, details: { purpose, mime, size: buf.length } });
    return { fileId: row.id, mime, sizeBytes: buf.length, sha256 };
  }

  /**
   * Who may open a file:
   *  RECEIPT          → its uploader, the circle organizer, and the recipient of the installment it is attached to
   *  PROMISSORY_NOTE  → its uploader, the circle organizer (the beneficiary), and platform reviewers
   */
  async canRead(q: Queryable, fileId: string, userId: string): Promise<any | null> {
    const f = (await q.query(`SELECT * FROM uploaded_files WHERE id=$1`, [fileId])).rows[0];
    if (!f) return null;
    if (f.owner_id === userId) return f;
    const isOrganizer = (await q.query(`SELECT 1 FROM gamiya_members WHERE gamiya_id=$1 AND user_id=$2 AND role='MANAGER'`, [f.gamiya_id, userId])).rows[0];
    if (isOrganizer) return f;
    if (f.purpose === 'RECEIPT') {
      const rcp = (await q.query(
        `SELECT 1 FROM installment_settlements s JOIN gamiya_installments i ON i.id = s.installment_id JOIN gamiya_cycles cy ON cy.id = i.cycle_id
         JOIN gamiya_members r ON r.id = cy.recipient_member_id
         WHERE r.user_id = $2 AND (s.receipt_file_id = $1 OR EXISTS (SELECT 1 FROM settlement_events e WHERE e.installment_id = i.id AND e.receipt_file_id = $1))`, [fileId, userId])).rows[0];
      if (rcp) return f;
      const reviewerOnDispute = (await q.query(
        `SELECT 1 FROM users u JOIN disputes d ON d.status = 'OPEN' JOIN installment_settlements s ON s.installment_id = d.installment_id AND s.receipt_file_id = $1
         WHERE u.id = $2 AND u.platform_role IN ('PLATFORM_ADMIN','COMPLIANCE_OFFICER')`, [fileId, userId])).rows[0];
      return reviewerOnDispute ? f : null;
    }
    const reviewer = (await q.query(`SELECT 1 FROM users WHERE id=$1 AND platform_role IN ('PLATFORM_ADMIN','COMPLIANCE_OFFICER')`, [userId])).rows[0];
    return reviewer ? f : null;
  }

  async open(fileId: string, userId: string, cid: string) {
    const f = await this.canRead(this.db, fileId, userId);
    if (!f) throw notFound('file');
    await this.audit.log(this.db, { actorId: userId, action: 'FILE_VIEWED', entity: 'file', entityId: fileId, correlationId: cid });
    return { mime: f.mime as string, bytes: await readFile(join(this.config.uploadDir!, f.storage_key)) };
  }
}

@Controller('api/v1')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('gamiyas/:id/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD + 1, files: 1 } }))
  upload(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFile() file: { buffer: Buffer } | undefined, @Body() body: unknown, @CorrelationId() cid: string) {
    return this.files.store(u.id, parseId(id), parseBody(UploadSchema, body).purpose, file?.buffer, cid);
  }

  @Get('files/:id')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response, @CorrelationId() cid: string) {
    const f = await this.files.open(parseId(id), u.id, cid);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.send(f.bytes);
  }
}
