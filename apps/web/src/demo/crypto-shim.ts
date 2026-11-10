/** Demo build only: the slice of node:crypto that financial-core uses, on @noble/hashes (pure JS, synchronous). */
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const toBytes = (d: string | Uint8Array) => (typeof d === 'string' ? utf8ToBytes(d) : d);
/** Node returns Buffers (hex toString, readUInt32BE…); the demo installs the buffer polyfill on globalThis first. */
const asBuffer = (u: Uint8Array) => { const B = (globalThis as any).Buffer; return B ? B.from(u.buffer, u.byteOffset, u.byteLength) : u; };
function digester(make: () => { update(b: Uint8Array): unknown; digest(): Uint8Array }) {
  const h = make();
  const api = {
    update(d: string | Uint8Array) { h.update(toBytes(d)); return api; },
    digest(enc?: 'hex') { const out = h.digest(); return (enc === 'hex' ? bytesToHex(out) : asBuffer(out)) as any; },
  };
  return api;
}
export const createHash = (_alg: string) => digester(() => sha256.create());
export const createHmac = (_alg: string, key: string | Uint8Array) => digester(() => hmac.create(sha256, toBytes(key)));
export const randomBytes = (n: number) => asBuffer(crypto.getRandomValues(new Uint8Array(n)));
export const randomUUID = () => crypto.randomUUID();
export function timingSafeEqual(a: Uint8Array, b: Uint8Array) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; }
export default { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual };
