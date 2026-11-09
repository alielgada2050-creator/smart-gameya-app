/**
 * Where members can receive their payout, per country. The app never moves money (ADR-001): payers see the
 * recipient's chosen method and transfer through their own bank or wallet app, then upload the receipt.
 * Validation is structural (format/checksum) only; it cannot prove the account belongs to the member.
 */
export type Country = 'SA' | 'EG' | 'AE';

export interface MethodSpec {
  kind: string;
  country: Country;
  name: { ar: string; en: string };
  input: 'iban' | 'mobile' | 'handle_or_mobile';
  hint: { ar: string; en: string };
}

export const COUNTRIES: Record<Country, { currency: string; name: { ar: string; en: string } }> = {
  SA: { currency: 'SAR', name: { ar: 'السعودية', en: 'Saudi Arabia' } },
  EG: { currency: 'EGP', name: { ar: 'مصر', en: 'Egypt' } },
  AE: { currency: 'AED', name: { ar: 'الإمارات', en: 'UAE' } },
};

export const METHODS: MethodSpec[] = [
  { kind: 'IBAN_SA', country: 'SA', name: { ar: 'تحويل بنكي (آيبان)', en: 'Bank transfer (IBAN)' }, input: 'iban', hint: { ar: 'SA ثم 22 رقماً', en: 'SA followed by 22 digits' } },
  { kind: 'STC_PAY', country: 'SA', name: { ar: 'STC Pay', en: 'STC Pay' }, input: 'mobile', hint: { ar: 'رقم الجوال المسجل في المحفظة', en: 'Wallet mobile number' } },
  { kind: 'BARQ', country: 'SA', name: { ar: 'برق', en: 'Barq' }, input: 'mobile', hint: { ar: 'رقم الجوال المسجل في المحفظة', en: 'Wallet mobile number' } },
  { kind: 'URPAY', country: 'SA', name: { ar: 'urpay', en: 'urpay' }, input: 'mobile', hint: { ar: 'رقم الجوال المسجل في المحفظة', en: 'Wallet mobile number' } },
  { kind: 'IBAN_EG', country: 'EG', name: { ar: 'تحويل بنكي (آيبان)', en: 'Bank transfer (IBAN)' }, input: 'iban', hint: { ar: 'EG ثم 27 رقماً', en: 'EG followed by 27 digits' } },
  { kind: 'INSTAPAY', country: 'EG', name: { ar: 'إنستاباي', en: 'InstaPay' }, input: 'handle_or_mobile', hint: { ar: 'عنوان الدفع مثل name@instapay أو رقم الجوال', en: 'Payment address like name@instapay, or mobile' } },
  { kind: 'VODAFONE_CASH', country: 'EG', name: { ar: 'فودافون كاش', en: 'Vodafone Cash' }, input: 'mobile', hint: { ar: 'رقم فودافون يبدأ بـ 010', en: 'Vodafone number starting 010' } },
  { kind: 'IBAN_AE', country: 'AE', name: { ar: 'تحويل بنكي (آيبان)', en: 'Bank transfer (IBAN)' }, input: 'iban', hint: { ar: 'AE ثم 21 رقماً', en: 'AE followed by 21 digits' } },
];

const IBAN_LENGTH: Record<string, number> = { SA: 24, EG: 29, AE: 23 };
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** ISO 13616 mod-97 check. */
export function ibanValid(raw: string, country: Country): boolean {
  const iban = toLatin(raw).replace(/\s+/g, '').toUpperCase();
  if (!iban.startsWith(country) || iban.length !== IBAN_LENGTH[country] || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Normalise and validate a value for a method kind. Returns the canonical value or an error code. */
export function normalizeMethodValue(kind: string, raw: string): { ok: true; value: string; last4: string } | { ok: false; error: string } {
  const spec = METHODS.find((m) => m.kind === kind);
  if (!spec) return { ok: false, error: 'UNKNOWN_METHOD' };
  const v = toLatin(raw).trim();
  if (spec.input === 'iban') {
    const iban = v.replace(/\s+/g, '').toUpperCase();
    return ibanValid(iban, spec.country) ? { ok: true, value: iban, last4: iban.slice(-4) } : { ok: false, error: 'INVALID_IBAN' };
  }
  const digits = v.replace(/[\s-]/g, '');
  if (spec.country === 'SA') {
    const m = /^(?:\+?966|0)?(5\d{8})$/.exec(digits);
    return m ? { ok: true, value: `+966${m[1]}`, last4: m[1].slice(-4) } : { ok: false, error: 'INVALID_MOBILE' };
  }
  if (spec.country === 'EG') {
    if (spec.input === 'handle_or_mobile' && /^[a-z0-9._-]{3,40}@instapay$/i.test(v)) return { ok: true, value: v.toLowerCase(), last4: v.toLowerCase().slice(0, 4) };
    const re = kind === 'VODAFONE_CASH' ? /^(?:\+?20|0)?(10\d{8})$/ : /^(?:\+?20|0)?(1[0125]\d{8})$/;
    const m = re.exec(digits);
    return m ? { ok: true, value: `+20${m[1]}`, last4: m[1].slice(-4) } : { ok: false, error: kind === 'INSTAPAY' ? 'INVALID_INSTAPAY' : 'INVALID_MOBILE' };
  }
  return { ok: false, error: 'UNSUPPORTED' };
}

export const methodsFor = (country: Country) => METHODS.filter((m) => m.country === country);
