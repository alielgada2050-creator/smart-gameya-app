import type { ChatMessage, ChainEvent, ProviderChain } from './providers.ts';

/**
 * Savings advisor narration. The model receives ONLY aggregated, de-identified facts (no names, phones,
 * IDs, circle names) and must explain them in Arabic. Its output passes a numeric guard: any number
 * not present in the facts rejects the text, and the deterministic template is used instead.
 */
export interface AdvisorFacts {
  status: 'RECOMMENDED' | 'STRETCH' | 'NOT_ADVISED';
  currency: string;
  disposableIncome: string;
  comfortableMonthlyCapacity: string;
  existingMonthlyCommitments: string;
  remainingCapacity: string;
  goalAmount: string;
  targetMonths: number | null;
  recommended: { members: number; months: number; monthlyContribution: string; payout: string } | null;
  scenarios: { members: number; months: number; monthlyContribution: string; payout: string; affordable: boolean; fitsTarget: boolean }[];
  comfortableSharePercent: number;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/[٬,]/g, '').replace(/٫/g, '.');
const canon = (n: string) => { const v = Number(n); return Number.isFinite(v) ? String(v) : n; };

/** Every number a narration may mention: values in the facts (in any common format). */
export function allowedNumbers(f: AdvisorFacts): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'number') out.add(canon(String(v)));
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) out.add(canon(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(f);
  return out;
}

export function numbersIn(text: string): string[] {
  return (toLatin(text).match(/\d+(\.\d+)?/g) ?? []).map(canon);
}

export function guardNumbers(text: string, f: AdvisorFacts): { ok: boolean; unknown: string[] } {
  const allowed = allowedNumbers(f);
  const unknown = numbersIn(text).filter((n) => !allowed.has(n));
  return { ok: unknown.length === 0, unknown: [...new Set(unknown)] };
}

const fmt = (amount: string) => {
  const [w, d] = amount.split('.');
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return d && d !== '00' ? `${grouped}.${d}` : grouped;
};

/** Deterministic Arabic explanation. Always available; also the fallback when every provider fails. */
export function templateNarration(f: AdvisorFacts): string {
  const c = f.currency === 'SAR' ? 'ريال' : f.currency;
  const lines: string[] = [];
  if (f.status === 'NOT_ADVISED') {
    lines.push(`بحسب ما أدخلته، المتبقي من دخلك بعد المصاريف ${fmt(f.disposableIncome)} ${c}، والقدرة المريحة المتبقية للجمعيات ${fmt(f.remainingCapacity)} ${c} شهرياً.`);
    lines.push('لا ننصح بالانضمام إلى جمعية جديدة بهذا المبلغ الآن. جرّب هدفاً أصغر أو انتظر حتى تنتهي التزاماتك الحالية.');
    return lines.join('\n');
  }
  const r = f.recommended!;
  lines.push(`قدرتك المريحة للجمعيات هي ${f.comfortableSharePercent}% من المتبقي بعد المصاريف، أي ${fmt(f.comfortableMonthlyCapacity)} ${c} شهرياً، ويتبقى منها ${fmt(f.remainingCapacity)} ${c} بعد التزاماتك الحالية.`);
  lines.push(`الخيار الأنسب: جمعية من ${r.members} أعضاء لمدة ${r.months} أشهر، بمساهمة ${fmt(r.monthlyContribution)} ${c} شهرياً، وقيمة القبض ${fmt(r.payout)} ${c}.`);
  if (f.status === 'STRETCH') lines.push('تنبيه: هذا الخيار لا يحقق هدفك في المدة التي حددتها ضمن قدرتك المريحة؛ إما أن تمدّد المدة أو تخفّض الهدف.');
  lines.push('تذكير: المنصة لا تستلم الأموال؛ تحوّل مساهمتك مباشرة لمستلم كل دورة.');
  return lines.join('\n');
}

export function buildMessages(f: AdvisorFacts): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'أنت مساعد ادخار في تطبيق جمعيات سعودي. اشرح الحقائق المعطاة بالعربية الفصحى المبسطة في 3 إلى 5 جمل.',
        'قواعد صارمة:',
        '- استخدم الأرقام الموجودة في الحقائق فقط كما هي. لا تحسب ولا تقرّب ولا تضف أي رقم جديد، ولا نسباً مئوية جديدة.',
        '- لا ترقّم الجمل ولا تستخدم تواريخ.',
        '- لا تقدّم نصيحة استثمارية أو قانونية، ولا تعد بعوائد.',
        '- اذكر أن المنصة لا تستلم الأموال وأن التحويل يتم مباشرة بين الأعضاء.',
        '- إذا كانت الحالة NOT_ADVISED فانصح بعدم الانضمام الآن بلطف.',
      ].join('\n'),
    },
    { role: 'user', content: `الحقائق (JSON):\n${JSON.stringify(f)}` },
  ];
}

export interface Narration {
  text: string;
  source: 'llm' | 'template';
  provider: string | null;
  model: string | null;
  guard: { passed: boolean; unknownNumbers: string[] } | null;
  events: ChainEvent[];
}

export async function narrate(f: AdvisorFacts, chain: ProviderChain | null): Promise<Narration> {
  // A 'do not join' message is sensitive and fully determined by the rules: never delegate it to a model.
  if (!chain || chain.providers.length === 0 || f.status === 'NOT_ADVISED') return { text: templateNarration(f), source: 'template', provider: null, model: null, guard: null, events: [] };
  const { result, events } = await chain.complete(buildMessages(f), { maxTokens: 400, temperature: 0.2 });
  if (!result) return { text: templateNarration(f), source: 'template', provider: null, model: null, guard: null, events };
  const g = guardNumbers(result.text, f);
  if (!g.ok) return { text: templateNarration(f), source: 'template', provider: result.provider, model: result.model, guard: { passed: false, unknownNumbers: g.unknown }, events };
  return { text: result.text, source: 'llm', provider: result.provider, model: result.model, guard: { passed: true, unknownNumbers: [] }, events };
}
