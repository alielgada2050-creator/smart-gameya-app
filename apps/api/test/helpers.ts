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

/**
 * Since 0.11 every create/join needs the signed pledge. Older tests are about other rules, so their `api` helper signs
 * automatically (typed name = the person's registered name, hash = the text the server shows). A test that wants to
 * exercise the pledge itself passes `pledge` explicitly (or `pledge: undefined` to send none).
 */
type Raw = (p: any, method: 'get' | 'post', url: string, body?: object) => any;
export function withPledge(raw: Raw): Raw {
  return async (p, method, url, body) => {
    if (p && method === 'post' && body && !('pledge' in body)) {
      let preview: any = null;
      if (url === '/api/v1/gamiyas') {
        const r = await raw(p, 'post', '/api/v1/gamiyas/pledge-preview', { country: 'SA', ...body });
        if (r.status === 200) preview = r.body;
      }
      const m = url.match(/^\/api\/v1\/invitations\/([^/]+)\/accept$/);
      if (m) { const r = await raw(p, 'get', `/api/v1/invitations/${m[1]}`); if (r.status === 200) preview = r.body.pledge; }
      if (preview) body = { ...body, pledge: { typedName: p.name, textSha256: preview.textSha256 } };
    }
    return raw(p, method, url, body);
  };
}
