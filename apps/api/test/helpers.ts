import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { TIER_LIMITS } from '../../../packages/financial-core/src/tiers.ts';

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
export const PDF = Buffer.from('%PDF-1.4\n% test promissory note\n%%EOF');

export function testConfigExtras(overrides: Record<string, unknown> = {}) {
  return {
    payoutKey: randomBytes(32),
    uploadDir: mkdtempSync(join(tmpdir(), 'sg-uploads-')),
    tierLimits: { ...TIER_LIMITS },
    platformAdminPhones: ['+966500000900'],
    remindersEveryMinutes: 0,
    ...overrides,
  };
}

/** Each call uploads a distinct file (random tail), like real receipts; pass the same fileId to test receipt reuse. */
export async function uploadFile(http: any, p: { ip: string; token: string }, gamiyaId: string, purpose: string, bytes: Buffer, name = 'receipt.png') {
  bytes = Buffer.concat([bytes, randomBytes(16)]);
  const r = await http.post(`/api/v1/gamiyas/${gamiyaId}/files`).set('X-Forwarded-For', p.ip).set('Authorization', `Bearer ${p.token}`)
    .field('purpose', purpose).attach('file', bytes, name);
  if (r.status !== 201) throw new Error(`upload failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { fileId: string };
}
