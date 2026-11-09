import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { OpenAICompatibleProvider, ProviderChain, chainFromEnv } from '../src/providers.ts';
import { narrate, guardNumbers, templateNarration, allowedNumbers, type AdvisorFacts } from '../src/advisor.ts';
import { savingsFacts, monthlyEquivalent } from '../../financial-core/src/savings.ts';
import { parseMoney } from '../../financial-core/src/money.ts';

const SAR = (s: string) => parseMoney(s, 'SAR');

/** Local mock of an OpenAI-compatible endpoint; behaviour chosen per path. */
const seen: { auth?: string; body?: any }[] = [];
const servers: Server[] = [];
async function mock(handler: (body: any) => { status: number; json?: any; delayMs?: number }): Promise<string> {
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}');
      seen.push({ auth: req.headers.authorization, body });
      const r = handler(body);
      if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.json ?? {}));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return `http://127.0.0.1:${(srv.address() as any).port}/v1`;
}
after(() => servers.forEach((s) => s.close()));

const reply = (content: string) => ({ status: 200, json: { choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 60 } } });
const prov = (name: string, baseUrl: string, timeoutMs = 2000) => new OpenAICompatibleProvider({ name, baseUrl, apiKey: `test-key-${name}`, model: `${name}-model`, timeoutMs });

function facts(): AdvisorFacts {
  const f = savingsFacts({ monthlyIncome: SAR('15000'), monthlyExpenses: SAR('9000'), goalAmount: SAR('12000'), targetMonths: 12, existingMonthlyCommitments: SAR('500') });
  const d = (m: bigint) => (Number(m) / 100).toFixed(2);
  return {
    status: f.status, currency: 'SAR', disposableIncome: d(f.disposableIncome), comfortableMonthlyCapacity: d(f.comfortableMonthlyCapacity),
    existingMonthlyCommitments: d(f.existingMonthlyCommitments), remainingCapacity: d(f.remainingCapacity), goalAmount: '12000.00', targetMonths: 12,
    recommended: f.recommended && { members: f.recommended.members, months: f.recommended.months, monthlyContribution: d(f.recommended.monthlyContribution), payout: d(f.recommended.payout) },
    scenarios: f.scenarios.map((s) => ({ members: s.members, months: s.months, monthlyContribution: d(s.monthlyContribution), payout: d(s.payout), affordable: s.affordable, fitsTarget: s.fitsTarget })),
    comfortableSharePercent: 30,
  };
}

test('savings facts: deterministic, rounded to 50 SAR, respects capacity and target', () => {
  const f = savingsFacts({ monthlyIncome: SAR('15000'), monthlyExpenses: SAR('9000'), goalAmount: SAR('12000'), targetMonths: 12, existingMonthlyCommitments: SAR('500') });
  assert.equal(f.disposableIncome, SAR('6000'));
  assert.equal(f.comfortableMonthlyCapacity, SAR('1800'));
  assert.equal(f.remainingCapacity, SAR('1300'));
  assert.deepEqual(f.scenarios.map((s) => s.monthlyContribution), [SAR('2400'), SAR('2000'), SAR('1200'), SAR('1000')]);
  assert.equal(f.recommended?.members, 12);
  assert.equal(f.status, 'RECOMMENDED');

  const tight = savingsFacts({ monthlyIncome: SAR('8000'), monthlyExpenses: SAR('7000'), goalAmount: SAR('12000'), targetMonths: 6, existingMonthlyCommitments: 0n });
  assert.equal(tight.status, 'NOT_ADVISED'); // 300 capacity < 1000 smallest
  const stretch = savingsFacts({ monthlyIncome: SAR('10000'), monthlyExpenses: SAR('6000'), goalAmount: SAR('12000'), targetMonths: 6, existingMonthlyCommitments: 0n });
  assert.equal(stretch.status, 'STRETCH'); // 1200 capacity fits 10-member (1200) but not within 6 months
  assert.equal(stretch.recommended?.members, 10);
  const broke = savingsFacts({ monthlyIncome: SAR('5000'), monthlyExpenses: SAR('6000'), goalAmount: SAR('1000'), existingMonthlyCommitments: 0n });
  assert.equal(broke.status, 'NOT_ADVISED');
  assert.equal(broke.recommended, null);
  assert.equal(monthlyEquivalent(SAR('300'), 'WEEKLY'), SAR('1300'));
  assert.throws(() => savingsFacts({ monthlyIncome: 1n, monthlyExpenses: 0n, goalAmount: 0n, existingMonthlyCommitments: 0n }));
});

test('guard: rejects invented numbers, accepts facts in Arabic-Indic digits and comma format', () => {
  const f = facts();
  assert.ok(allowedNumbers(f).has('1300'));
  assert.ok(guardNumbers('يتبقى لك ١٬٣٠٠ ريال، والقبض 12,000 ريال على 12 شهراً.', f).ok);
  const bad = guardNumbers('ستوفر 15,500 ريال وتحصل على عائد 7%.', f);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unknown.sort(), ['15500', '7']);
  assert.ok(guardNumbers(templateNarration(f), f).ok, 'the template itself passes the guard');
});

test('chain: primary rate-limited → backup answers; key sent as bearer; payload carries no personal data', async () => {
  const groq = await mock(() => ({ status: 429 }));
  const cf = await mock(() => reply('قدرتك المتبقية 1,300 ريال شهرياً، والأنسب جمعية من 12 عضواً بمساهمة 1,000 ريال وقبض 12,000 ريال. المنصة لا تستلم الأموال.'));
  const n = await narrate(facts(), new ProviderChain([prov('groq', groq), prov('cloudflare', cf)]));
  assert.equal(n.source, 'llm');
  assert.equal(n.provider, 'cloudflare');
  assert.deepEqual(n.events.map((e) => e.outcome), ['RATE_LIMITED', 'OK']);
  assert.equal(seen.at(-1)!.auth, 'Bearer test-key-cloudflare');
  const sent = JSON.stringify(seen.at(-1)!.body);
  assert.ok(!/\+966|@|name/i.test(sent.replace('"model"', '')), 'no phones, emails or names in the prompt');
});

test('chain: hallucinated figures are discarded and the template is used', async () => {
  const liar = await mock(() => reply('ننصحك بجمعية 15 عضواً ومساهمة 800 ريال ستحقق لك ربحاً 3%.'));
  const n = await narrate(facts(), new ProviderChain([prov('groq', liar)]));
  assert.equal(n.source, 'template');
  assert.equal(n.guard?.passed, false);
  assert.ok(n.guard!.unknownNumbers.includes('15'));
  assert.equal(n.text, templateNarration(facts()));
});

test('chain: timeouts, outages, auth errors and empty answers all fall through to the template', async () => {
  const slow = await mock(() => ({ ...reply('x'), delayMs: 500 }));
  const down = await mock(() => ({ status: 503 }));
  const authErr = await mock(() => ({ status: 401 }));
  const empty = await mock(() => ({ status: 200, json: { choices: [] } }));
  const n = await narrate(facts(), new ProviderChain([prov('a', slow, 100), prov('b', down), prov('c', authErr), prov('d', empty)]));
  assert.equal(n.source, 'template');
  assert.deepEqual(n.events.map((e) => e.outcome), ['TIMEOUT', 'UNAVAILABLE', 'AUTH', 'BAD_RESPONSE']);
});

test('chainFromEnv: missing keys are skipped, no chain is valid, https enforced', () => {
  const { chain, skipped } = chainFromEnv({ AI_PROVIDERS: 'groq,cloudflare,unknownx', GROQ_API_KEY: 'k' });
  assert.deepEqual(chain.providers.map((p) => `${p.name}:${p.model}`), ['groq:llama-3.3-70b-versatile']);
  assert.deepEqual(skipped, ['cloudflare (missing CLOUDFLARE_ACCOUNT_ID)', 'unknownx (unknown)']);
  const cf = chainFromEnv({ AI_PROVIDERS: 'cloudflare', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc1' });
  assert.equal(cf.chain.providers.length, 1);
  assert.equal(chainFromEnv({}).chain.providers.length, 0);
  assert.throws(() => new OpenAICompatibleProvider({ name: 'x', baseUrl: 'http://evil.example/v1', apiKey: 'k', model: 'm' }));
});

test('NOT_ADVISED never calls a provider', async () => {
  let called = false;
  const spy = await mock(() => { called = true; return reply('x'); });
  const f = { ...facts(), status: 'NOT_ADVISED' as const, recommended: null };
  const n = await narrate(f, new ProviderChain([prov('groq', spy)]));
  assert.equal(n.source, 'template');
  assert.equal(called, false);
  assert.match(n.text, /لا ننصح/);
});

test('no providers configured → template narration, app keeps working', async () => {
  const n = await narrate(facts(), null);
  assert.equal(n.source, 'template');
  assert.match(n.text, /12 أعضاء/);
});
