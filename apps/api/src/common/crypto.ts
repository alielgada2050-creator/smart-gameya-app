import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM sealing for small secrets at rest (lottery seeds, payout account values). Format: iv.tag.ciphertext (base64). */
export function seal(key: Buffer, plaintext: string, aad?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

export function unseal(key: Buffer, sealed: string, aad?: string): string {
  const [iv, tag, ct] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key, iv);
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
