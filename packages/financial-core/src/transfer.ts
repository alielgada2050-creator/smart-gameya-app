/**
 * Smart transfers without holding funds (Model A, owner choice 2026-11-10).
 * The platform prepares everything the payer needs to transfer from their own bank or wallet, and checks the declaration
 * against what was due. It never initiates, receives or moves money.
 */
import { createHash } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O/1/I/L/U to avoid misreading

/** Short reference the payer writes in the transfer note, e.g. "JM-7KQ4-P2XD". Stable per installment. */
export function transferReference(installmentId: string): string {
  const h = createHash('sha256').update(`sg-ref:${installmentId}`).digest();
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[h[i] % ALPHABET.length];
  return `JM-${s.slice(0, 4)}-${s.slice(4)}`;
}

export interface TransferGuide {
  /** Steps in Arabic and English, from the provider's own published instructions. */
  steps: { ar: string; en: string }[];
  /** Optional link that opens a dialer or app, only when the provider documents it officially. */
  action?: { href: string; label: { ar: string; en: string } };
  /** Bank-dependent limits, shown as guidance, never enforced by the platform. */
  limitNote?: { ar: string; en: string };
}

/** Guidance per method. Sources: Vodafone Egypt money-transfer page (*9*7#); Riyad Bank Sarie page (limits vary by bank). */
export function transferGuide(kind: string, amount: number, currency: string): TransferGuide {
  switch (kind) {
    case 'VODAFONE_CASH':
      return {
        steps: [
          { ar: 'اطلب ‎*9*7#‎ من خط فودافون كاش المسجّل.', en: 'Dial *9*7# from your registered Vodafone Cash line.' },
          { ar: 'اختر خدمة تحويل الأموال وأدخل رقم محفظة المستلم والمبلغ.', en: 'Choose money transfer, then enter the recipient wallet number and the amount.' },
          { ar: 'أكّد بالرقم السري واحتفظ برسالة التأكيد كإيصال.', en: 'Confirm with your PIN and keep the confirmation SMS as your receipt.' },
        ],
        action: { href: 'tel:*9*7%23', label: { ar: 'افتح الطالب بـ ‎*9*7#‎', en: 'Open dialer with *9*7#' } },
      };
    case 'INSTAPAY':
      return {
        steps: [
          { ar: 'افتح تطبيق إنستاباي واختر «تحويل».', en: 'Open the InstaPay app and choose Send.' },
          { ar: 'ألصق عنوان الدفع أو رقم الموبايل المنسوخ، ثم المبلغ، واكتب الرقم المرجعي في الملاحظة.', en: 'Paste the copied payment address or mobile number, enter the amount, and put the reference in the note.' },
          { ar: 'احفظ لقطة شاشة التأكيد وارفعها هنا.', en: 'Save the confirmation screenshot and upload it here.' },
        ],
      };
    case 'STC_PAY': case 'BARQ': case 'URPAY':
      return {
        steps: [
          { ar: 'افتح تطبيق المحفظة واختر التحويل إلى رقم جوال.', en: 'Open the wallet app and choose transfer to a mobile number.' },
          { ar: 'ألصق الرقم المنسوخ والمبلغ، واكتب الرقم المرجعي في الملاحظة إن أمكن.', en: 'Paste the copied number and amount, and add the reference in the note if the app allows.' },
          { ar: 'احفظ لقطة شاشة التأكيد وارفعها هنا.', en: 'Save the confirmation screenshot and upload it here.' },
        ],
      };
    case 'IBAN_SA':
      return {
        steps: [
          { ar: 'من تطبيق بنكك اختر «تحويل فوري (سريع)» إلى آيبان.', en: 'In your bank app choose an instant (Sarie) transfer to an IBAN.' },
          { ar: 'ألصق الآيبان واسم المستلم كما هو، ثم المبلغ، واكتب الرقم المرجعي في الملاحظة.', en: 'Paste the IBAN and recipient name exactly, the amount, and the reference in the note.' },
          { ar: 'نزّل إيصال التحويل (PDF أو صورة) وارفعه هنا.', en: 'Download the transfer receipt (PDF or image) and upload it here.' },
        ],
        limitNote: currency === 'SAR' && amount > 2500 ? {
          ar: 'المبلغ أعلى من حد التحويل السريع دون مستفيد في كثير من البنوك (2,500 ريال). أضف المستلم كمستفيد أولاً؛ الحدود تختلف حسب البنك.',
          en: 'This is above the quick-transfer limit without a saved beneficiary at many banks (SAR 2,500). Add the recipient as a beneficiary first; limits vary by bank.',
        } : undefined,
      };
    default:
      return {
        steps: [
          { ar: 'حوّل من تطبيق بنكك إلى بيانات المستلم المنسوخة.', en: 'Transfer from your bank app to the copied recipient details.' },
          { ar: 'اكتب الرقم المرجعي في ملاحظة التحويل، ثم ارفع الإيصال هنا.', en: 'Put the reference in the transfer note, then upload the receipt here.' },
        ],
      };
  }
}

export type MatchCheck = 'AMOUNT' | 'DATE' | 'METHOD' | 'RECEIPT_UNIQUE' | 'BANK_REF_UNIQUE';
export interface MatchResult { check: MatchCheck; ok: boolean; detail?: string }

/**
 * Automatic matching of a payment declaration against what was due. Advisory for the organizer and the recipient:
 * a failed check is shown prominently, it does not replace their approval. A reused receipt is blocked by the caller.
 */
export function matchDeclaration(input: {
  amountDue: string; declaredAmount: string;
  transferDate: string; earliest: string; today: string;
  methodKind: string; recipientKinds: string[];
  receiptUsedElsewhere: boolean; bankRefUsedElsewhere: boolean;
}): { score: number; checks: MatchResult[] } {
  const cents = (v: string) => Math.round(Number(v) * 100);
  const checks: MatchResult[] = [
    { check: 'AMOUNT', ok: cents(input.declaredAmount) === cents(input.amountDue), detail: `${input.declaredAmount} / ${input.amountDue}` },
    { check: 'DATE', ok: input.transferDate >= input.earliest && input.transferDate <= input.today, detail: input.transferDate },
    { check: 'METHOD', ok: input.recipientKinds.includes(input.methodKind) },
    { check: 'RECEIPT_UNIQUE', ok: !input.receiptUsedElsewhere },
    { check: 'BANK_REF_UNIQUE', ok: !input.bankRefUsedElsewhere },
  ];
  return { score: checks.filter((c) => c.ok).length, checks };
}
