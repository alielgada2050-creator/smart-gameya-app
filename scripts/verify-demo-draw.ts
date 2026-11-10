// Verifies a draw produced by the in-browser demo with the real lottery code and Node's crypto.
import { readFileSync } from 'node:fs';
import { verifyDraw } from '../packages/financial-core/src/lottery.ts';
const rec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const v = verifyDraw(rec);
console.log(JSON.stringify({ valid: v.valid, reason: v.reason ?? null, order: rec.order.map((o: any) => o.position) }));
process.exit(v.valid ? 0 : 1);
