import { createContext, useContext } from 'react';

export type Lang = 'ar' | 'en';

const ar = {
  appName: 'جمعيتي',
  tagline: 'نظّم جمعيتك مع من تثق بهم. المنصة لا تستلم أموالكم؛ كل عضو يحوّل مباشرة لصاحب الدور.',
  phone: 'رقم الجوال', phoneHint: 'مثال: 0551234567', sendCode: 'أرسل الرمز', code: 'رمز التحقق', fullName: 'اسمك كما يراه أعضاء الجمعية',
  signIn: 'دخول', changePhone: 'تغيير الرقم', devCode: (c: string) => `بيئة التطوير: الرمز ${c}`, invalidPhone: 'أدخل رقم جوال سعودياً يبدأ بـ 05',
  home: 'الرئيسية', circles: 'جمعياتي', advisor: 'المستشار', signOut: 'خروج',
  hello: (n: string) => `أهلاً ${n}`,
  toPay: 'عليك تحويله', toConfirm: 'بانتظار تأكيدك', nothingToPay: 'لا شيء عليك الآن.', late: 'متأخر',
  newCircle: 'جمعية جديدة', join: 'انضم بدعوة', noCircles: 'ليست لديك جمعيات بعد. أنشئ واحدة وادعُ من تثق بهم، أو انضم برمز دعوة.',
  members: (j: number, t: number) => `${j} من ${t} أعضاء`,
  perMonth: { MONTHLY: 'شهرياً', BIWEEKLY: 'كل أسبوعين', WEEKLY: 'أسبوعياً' } as Record<string, string>,
  status: { RECRUITING: 'يستقبل أعضاء', LOCKED: 'اكتمل العدد', ACTIVE: 'جارية', COMPLETED: 'منتهية', CANCELLED: 'ملغاة', DRAFT: 'مسودة' } as Record<string, string>,
  instStatus: { SCHEDULED: 'لاحقاً', DUE: 'مستحق اليوم', IN_GRACE: 'في فترة السماح', LATE: 'متأخر', AWAITING_CONFIRMATION: 'بانتظار التأكيد', DISPUTED: 'معترض عليه', PAID: 'مؤكد' } as Record<string, string>,
  name: 'اسم الجمعية', contribution: 'مساهمة كل عضو (ريال)', memberCount: 'عدد الأعضاء', frequency: 'الدورية', startDate: 'تاريخ أول دورة', graceDays: 'أيام السماح بعد الموعد',
  freq: { MONTHLY: 'شهرية', BIWEEKLY: 'كل أسبوعين', WEEKLY: 'أسبوعية' } as Record<string, string>,
  pot: 'قيمة القبض لكل دورة', endsOn: 'آخر دورة', agreementTitle: 'اتفاقية الانضمام', acceptAgreement: 'قرأت الاتفاقية وأوافق عليها', createCircle: 'أنشئ الجمعية',
  readAgreement: 'اقرأ الاتفاقية', inviteCode: 'رمز الدعوة', joinCircle: 'انضم إلى الجمعية', joined: 'انضممت إلى الجمعية',
  invite: 'ادعُ أعضاء', inviteLink: 'شارك هذا الرابط مع من تدعوهم', copy: 'انسخ الرابط', copied: 'نُسخ الرابط', inviteUses: (n: number) => `صالح لـ ${n} أشخاص خلال 3 أيام`,
  ring: 'ترتيب القبض', yourTurn: 'دورك', turnShort: 'دورك',
  myTurnLine: (p: number, d: string) => `تستلم القبض في الدورة رقم ${p}، بتاريخ ${d}`,
  themeNames: { system: 'تلقائي', dark: 'داكن', light: 'فاتح' } as Record<string, string>, you: 'أنت', manager: 'المدير', waitingDraw: 'يُحدَّد الترتيب بالقرعة بعد اكتمال العدد.',
  lottery: 'القرعة', trial: 'جرّب قرعة تجريبية', trialNote: 'نتيجة تجريبية غير ملزمة ولا تُحفظ.',
  prepare: 'جهّز القرعة الرسمية', prepared: 'القرعة جاهزة. هذا البصمة تثبت أن النتيجة لن تتغير:', approve: 'أوافق على إجراء القرعة', approvedWait: 'وافقت. بانتظار تنفيذ المدير.',
  needApproval: 'بانتظار موافقة عضو آخر قبل التنفيذ.', entropy: 'عبارة يعلنها المدير للأعضاء الآن', execute: 'نفّذ القرعة', executed: 'تمت القرعة',
  verified: 'تحققنا: النتيجة تطابق البصمة المعلنة قبل القرعة', notVerified: 'تعذر التحقق من النتيجة', verifyDetails: 'تفاصيل التحقق',
  commitment: 'البصمة المعلنة', seed: 'البذرة بعد الكشف', publicEntropy: 'العبارة المعلنة',
  schedule: 'جدول الدورات', recipient: 'المستلم', paidCount: (p: number, t: number) => `${p} من ${t} مؤكد`,
  myActions: 'مطلوب منك', declare: 'حوّلت المبلغ', reference: 'مرجع التحويل (اختياري)', confirm: 'وصلني المبلغ', dispute: 'لم يصلني', to: 'إلى', from: 'من',
  declared: 'سجّلنا تحويلك. بانتظار تأكيد المستلم.', confirmedMsg: 'تم التأكيد.', disputedMsg: 'سجّلنا اعتراضك. تواصل مع العضو مباشرة.',
  circleDone: 'اكتملت الجمعية. كل الأقساط مؤكدة.',
  advisorTitle: 'كم تستطيع أن تدخر بجمعية؟', advisorIntro: 'أدخل أرقامك الشهرية. لا نحفظها، ونستخدمها لهذه الإجابة فقط.',
  income: 'الدخل الشهري (ريال)', expenses: 'المصاريف الشهرية (ريال)', goal: 'المبلغ الذي تريد جمعه (ريال)', targetMonths: 'خلال كم شهراً؟ (اختياري)', ask: 'احسب',
  capacity: 'تستطيع تخصيصه شهرياً', existing: 'التزاماتك الحالية', remaining: 'المتبقي للجمعيات', recommendation: 'الخيار المقترح',
  scenarioRow: (m: number) => `${m} أعضاء`, affordable: 'ضمن قدرتك', notAffordable: 'أعلى من قدرتك', outsideTarget: 'أطول من مدتك',
  aiWrote: (p: string) => `صاغ الشرح نموذج ذكاء اصطناعي (${p}) من أرقام المنصة`, templateWrote: 'شرح ثابت من المنصة',
  sep: '، ', sar: 'ريال', back: 'رجوع', retry: 'أعد المحاولة', loading: 'جارٍ التحميل', error: 'حدث خطأ',
  language: 'English', theme: 'المظهر',
};
type Dict = typeof ar;

const en: Dict = {
  appName: 'Jamiyati',
  tagline: 'Run your savings circle with people you trust. The app never holds your money; each member transfers directly to whoever’s turn it is.',
  phone: 'Mobile number', phoneHint: 'e.g. 0551234567', sendCode: 'Send code', code: 'Verification code', fullName: 'Your name as members will see it',
  signIn: 'Sign in', changePhone: 'Change number', devCode: (c) => `Development: code ${c}`, invalidPhone: 'Enter a Saudi mobile number starting with 05',
  home: 'Home', circles: 'My circles', advisor: 'Advisor', signOut: 'Sign out',
  hello: (n) => `Hello, ${n}`,
  toPay: 'To transfer', toConfirm: 'Waiting for your confirmation', nothingToPay: 'Nothing due right now.', late: 'Late',
  newCircle: 'New circle', join: 'Join with invite', noCircles: 'You have no circles yet. Create one and invite people you trust, or join with an invite code.',
  members: (j, t) => `${j} of ${t} members`,
  perMonth: { MONTHLY: 'monthly', BIWEEKLY: 'every two weeks', WEEKLY: 'weekly' },
  status: { RECRUITING: 'Open to members', LOCKED: 'Full', ACTIVE: 'Running', COMPLETED: 'Completed', CANCELLED: 'Cancelled', DRAFT: 'Draft' },
  instStatus: { SCHEDULED: 'Upcoming', DUE: 'Due today', IN_GRACE: 'In grace period', LATE: 'Late', AWAITING_CONFIRMATION: 'Awaiting confirmation', DISPUTED: 'Disputed', PAID: 'Confirmed' },
  name: 'Circle name', contribution: 'Contribution per member (SAR)', memberCount: 'Members', frequency: 'Frequency', startDate: 'First cycle date', graceDays: 'Grace days after due date',
  freq: { MONTHLY: 'Monthly', BIWEEKLY: 'Every two weeks', WEEKLY: 'Weekly' },
  pot: 'Payout per cycle', endsOn: 'Last cycle', agreementTitle: 'Joining agreement (Arabic)', acceptAgreement: 'I have read and accept the agreement', createCircle: 'Create circle',
  readAgreement: 'Read the agreement', inviteCode: 'Invite code', joinCircle: 'Join circle', joined: 'You joined the circle',
  invite: 'Invite members', inviteLink: 'Share this link with the people you invite', copy: 'Copy link', copied: 'Link copied', inviteUses: (n) => `Valid for ${n} people for 3 days`,
  ring: 'Payout order', yourTurn: 'Your turn', turnShort: 'your turn',
  myTurnLine: (p, d) => `You receive the payout in cycle ${p}, on ${d}`,
  themeNames: { system: 'Automatic', dark: 'Dark', light: 'Light' }, you: 'You', manager: 'Manager', waitingDraw: 'The order is drawn once the circle is full.',
  lottery: 'Draw', trial: 'Run a practice draw', trialNote: 'Practice result. Not binding and not saved.',
  prepare: 'Prepare the official draw', prepared: 'The draw is ready. This fingerprint proves the result can’t change:', approve: 'Approve the draw', approvedWait: 'Approved. Waiting for the manager to run it.',
  needApproval: 'Waiting for another member to approve before running.', entropy: 'Phrase the manager announces to members now', execute: 'Run the draw', executed: 'Draw completed',
  verified: 'Verified: the result matches the fingerprint published before the draw', notVerified: 'The result could not be verified', verifyDetails: 'Verification details',
  commitment: 'Published fingerprint', seed: 'Revealed seed', publicEntropy: 'Announced phrase',
  schedule: 'Cycle schedule', recipient: 'Recipient', paidCount: (p, t) => `${p} of ${t} confirmed`,
  myActions: 'Waiting on you', declare: 'I transferred it', reference: 'Transfer reference (optional)', confirm: 'I received it', dispute: 'Not received', to: 'to', from: 'from',
  declared: 'Transfer recorded. Waiting for the recipient to confirm.', confirmedMsg: 'Confirmed.', disputedMsg: 'Dispute recorded. Contact the member directly.',
  circleDone: 'The circle is complete. Every installment is confirmed.',
  advisorTitle: 'How much can you save with a circle?', advisorIntro: 'Enter your monthly figures. We don’t store them; they’re used for this answer only.',
  income: 'Monthly income (SAR)', expenses: 'Monthly expenses (SAR)', goal: 'Amount you want to collect (SAR)', targetMonths: 'Within how many months? (optional)', ask: 'Calculate',
  capacity: 'You can set aside monthly', existing: 'Your current commitments', remaining: 'Left for circles', recommendation: 'Suggested option',
  scenarioRow: (m) => `${m} members`, affordable: 'Within reach', notAffordable: 'Above your capacity', outsideTarget: 'Longer than your target',
  aiWrote: (p) => `Explanation written by an AI model (${p}) from the app’s figures`, templateWrote: 'Standard explanation from the app',
  sep: ', ', sar: 'SAR', back: 'Back', retry: 'Try again', loading: 'Loading', error: 'Something went wrong',
  language: 'العربية', theme: 'Theme',
};

export const dictionaries: Record<Lang, Dict> = { ar, en };
export const I18n = createContext<{ t: Dict; lang: Lang }>({ t: ar, lang: 'ar' });
export const useT = () => useContext(I18n);

/** Display formatting only (grouping). Values are already exact strings from the server. */
export function money(v: string | null | undefined, lang: Lang): string {
  if (v == null) return '—';
  const [w, d] = v.split('.');
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${d && d !== '00' ? `${grouped}.${d}` : grouped} ${lang === 'ar' ? 'ريال' : 'SAR'}`;
}

export function date(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
