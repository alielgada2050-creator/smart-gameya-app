/**
 * The member's pledge (إقرار وتعهد بالسداد). One text, built from the circle's actual terms, used by the web app (to show)
 * and the server (to verify the hash of what was shown and store it as evidence). Draft wording for legal review: it relies on
 * the Saudi Electronic Transactions Law for electronic signature, and complements — does not replace — the promissory
 * note required for large circles.
 */
import { createHash } from 'node:crypto';

export const PLEDGE_VERSION = 'sg-pledge/1.0';

export interface PledgeTerms {
  circleName: string; organizerName: string; memberName: string;
  currency: string; contribution: string; memberCount: number; frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  installments: number; startDate: string; endDate: string; potPerCycle: string; totalCommitment: string; termsVersion: number;
  /** Set when the signer takes over another member's seat: whom they replace, the turn, and how many overdue payments they take on. */
  replaces?: { memberName: string; payoutPosition: number | null; overdue: number };
}

const curAr: Record<string, string> = { SAR: 'ريال', EGP: 'جنيه', AED: 'درهم' };
const cur = (t: PledgeTerms) => curAr[t.currency] ?? t.currency;
const freqAr = { WEEKLY: 'أسبوعياً', BIWEEKLY: 'كل أسبوعين', MONTHLY: 'شهرياً' } as const;

/** Clauses the member ticks one by one (the UI shows each as its own checkbox). */
export function pledgeClauses(t: PledgeTerms): string[] {
  return [
    `أتعهّد بسداد ${t.installments} أقساط قيمة كل منها ${t.contribution} ${cur(t)} ${freqAr[t.frequency]}، بإجمالي ${t.totalCommitment} ${cur(t)}، في مواعيدها من ${t.startDate} حتى ${t.endDate}، سواء قبضتُ دوري أو لم أقبضه بعد.`,
    'أتحمّل مسؤولية السداد مسؤولية كاملة وشخصية، ولا يسقط التزامي بقبضي المبكر أو بخروجي من الجمعية بعد بدئها، ويبقى ديناً في ذمتي لبقية الأعضاء حتى أوفيه.',
    'أعلم أن المنصة أداة تنظيم وتوثيق فقط ولا تحتفظ بالأموال، وأن التحويل يتم مني مباشرة إلى مستلم كل دورة، وأن إيصالاتي وتأكيدات الأعضاء ومحادثة الجمعية سجلّ موثّق يجوز الاحتجاج به.',
    'أقرّ بأن هذا التعهد الإلكتروني الموقّع باسمي مُلزم لي نظاماً، ويجوز لأي عضو متضرر المطالبة بحقه عبر الجهات المختصة، وأوافق على مشاركة بياناتي اللازمة لذلك.',
  ];
}

/** Full text as signed: header with the terms in numbers, the clauses, the closing. Hash this exact string. */
export function pledgeText(t: PledgeTerms): string {
  const head = [
    `إقرار وتعهّد بالسداد — ${PLEDGE_VERSION} — شروط الإصدار ${t.termsVersion}`,
    `أنا ${t.memberName}، عضو في جمعية «${t.circleName}» التي ينظّمها ${t.organizerName}:`,
    `عدد الأعضاء ${t.memberCount}، القسط ${t.contribution} ${cur(t)} ${freqAr[t.frequency]}، القبض لكل دورة ${t.potPerCycle} ${cur(t)}.`,
  ];
  if (t.replaces) {
    head.push(`أحلّ محلّ ${t.replaces.memberName}${t.replaces.payoutPosition ? ` في الدور رقم ${t.replaces.payoutPosition}` : ''}، وأتحمّل الأقساط التي لم يسددها${t.replaces.overdue ? `، ومنها ${t.replaces.overdue} متأخرة أسددها فوراً` : ''}. ما سدّده قبلي يبقى في سجله، وأي تسوية بيني وبينه شأن خاص بنا لا تتدخل فيه المنصة.`);
  }
  const clauses = pledgeClauses(t).map((c, i) => `${i + 1}. ${c}`);
  return [...head, ...clauses, 'وأُوقّع على ذلك بكتابة اسمي، وأنا بكامل أهليتي واختياري، والله على ما أقول شهيد.'].join('\n');
}

export const pledgeHash = (t: PledgeTerms) => createHash('sha256').update(pledgeText(t)).digest('hex');

/** The typed signature must be the member's own name (spacing and Arabic letter variants normalised). */
export function signatureMatches(typed: string, fullName: string) {
  const norm = (s: string) => s.normalize('NFKC').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(typed).length >= 2 && norm(typed) === norm(fullName);
}
