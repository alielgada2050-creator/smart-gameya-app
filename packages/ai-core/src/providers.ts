/**
 * AI Provider Abstraction (MASTER PROMPT §4 AI): no lock-in to one vendor.
 * Every provider here speaks the OpenAI-compatible Chat Completions protocol, which Groq, Cloudflare
 * Workers AI, OpenRouter, Google AI Studio, Mistral and Anthropic-compatible gateways all expose.
 * Keys are read from environment variables only — never hard-coded, logged or stored.
 */
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface CompletionResult {
  provider: string;
  model: string;
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

export interface ChatProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<CompletionResult>;
}

export type ProviderErrorKind = 'RATE_LIMITED' | 'UNAVAILABLE' | 'TIMEOUT' | 'AUTH' | 'BAD_RESPONSE';
export class ProviderError extends Error {
  readonly provider: string;
  readonly kind: ProviderErrorKind;
  constructor(provider: string, kind: ProviderErrorKind, message: string) {
    super(`${provider}: ${kind} — ${message}`);
    this.provider = provider;
    this.kind = kind;
  }
}

export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly name: string;
  readonly model: string;
  readonly #o: OpenAICompatibleOptions;

  constructor(o: OpenAICompatibleOptions) {
    if (!o.apiKey) throw new Error(`${o.name}: missing API key`);
    if (!/^https:\/\//.test(o.baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(o.baseUrl))
      throw new Error(`${o.name}: baseUrl must be https (or localhost for tests)`);
    this.#o = o;
    this.name = o.name;
    this.model = o.model;
  }

  async complete(messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<CompletionResult> {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.#o.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await (this.#o.fetchImpl ?? fetch)(`${this.#o.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#o.apiKey}` },
        body: JSON.stringify({ model: this.#o.model, messages, max_tokens: opts.maxTokens ?? 500, temperature: opts.temperature ?? 0.2 }),
      });
    } catch (e) {
      throw new ProviderError(this.name, (e as Error).name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE', (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) throw new ProviderError(this.name, 'RATE_LIMITED', 'free quota or rate limit reached');
    if (res.status === 401 || res.status === 403) throw new ProviderError(this.name, 'AUTH', `HTTP ${res.status}`);
    if (!res.ok) throw new ProviderError(this.name, 'UNAVAILABLE', `HTTP ${res.status}`);
    const body: any = await res.json().catch(() => null);
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new ProviderError(this.name, 'BAD_RESPONSE', 'no message content');
    return {
      provider: this.name, model: this.model, text: text.trim(),
      inputTokens: body?.usage?.prompt_tokens, outputTokens: body?.usage?.completion_tokens,
      latencyMs: Date.now() - started,
    };
  }
}

/** Known presets. Limits are NOT encoded here — they change often; check the provider console. */
export const PRESETS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile' },
  cloudflare: { baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1', keyEnv: 'CLOUDFLARE_API_TOKEN', defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-flash' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY', defaultModel: 'mistral-small-latest' },
} as const;
export type PresetName = keyof typeof PRESETS;

export interface ChainEvent { provider: string; model: string; outcome: 'OK' | ProviderErrorKind; latencyMs: number; inputTokens?: number; outputTokens?: number }

/**
 * Tries providers in order; on rate limit / outage / timeout / bad response it moves to the next.
 * Returns null when every provider fails — callers must then use their deterministic fallback.
 */
export class ProviderChain {
  readonly providers: ChatProvider[];
  constructor(providers: ChatProvider[]) { this.providers = providers; }

  async complete(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<{ result: CompletionResult | null; events: ChainEvent[] }> {
    const events: ChainEvent[] = [];
    for (const p of this.providers) {
      const t = Date.now();
      try {
        const r = await p.complete(messages, opts);
        events.push({ provider: p.name, model: p.model, outcome: 'OK', latencyMs: r.latencyMs, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
        return { result: r, events };
      } catch (e) {
        const kind = e instanceof ProviderError ? e.kind : 'UNAVAILABLE';
        events.push({ provider: p.name, model: p.model, outcome: kind, latencyMs: Date.now() - t });
      }
    }
    return { result: null, events };
  }
}

/**
 * Build the chain from environment variables, e.g.
 *   AI_PROVIDERS=groq,cloudflare   GROQ_API_KEY=...   CLOUDFLARE_API_TOKEN=...   CLOUDFLARE_ACCOUNT_ID=...
 *   AI_MODEL_GROQ=llama-3.3-70b-versatile (optional override)
 * Providers whose key is missing are skipped (reported in `skipped`), so an empty chain is valid.
 */
export function chainFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): { chain: ProviderChain; skipped: string[] } {
  const names = (env.AI_PROVIDERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const providers: ChatProvider[] = [];
  const skipped: string[] = [];
  for (const n of names) {
    const preset = (PRESETS as Record<string, (typeof PRESETS)[PresetName]>)[n];
    if (!preset) { skipped.push(`${n} (unknown)`); continue; }
    const key = env[preset.keyEnv];
    let baseUrl: string = env[`AI_BASE_URL_${n.toUpperCase()}`] ?? preset.baseUrl;
    if (baseUrl.includes('{ACCOUNT_ID}')) {
      if (!env.CLOUDFLARE_ACCOUNT_ID) { skipped.push(`${n} (missing CLOUDFLARE_ACCOUNT_ID)`); continue; }
      baseUrl = baseUrl.replace('{ACCOUNT_ID}', encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID));
    }
    if (!key) { skipped.push(`${n} (missing ${preset.keyEnv})`); continue; }
    providers.push(new OpenAICompatibleProvider({ name: n, baseUrl, apiKey: key, model: env[`AI_MODEL_${n.toUpperCase()}`] ?? preset.defaultModel, fetchImpl }));
  }
  return { chain: new ProviderChain(providers), skipped };
}
