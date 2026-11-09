import { createContext, useContext } from 'react';

export type Lang = 'ar' | 'en';

const ar = {
  appName: 'جمعيتي',
  tagline: 'نظّم جمعيتك مع من تثق بهم. المنصة لا تستلم أموالكم: كل عضو يحوّل مباشرة لصاحب الدور ويرفع الإيصال، ويوثّق التطبيق كل خطوة.',
  phone: 'رقم الجوال', phoneHint: 'مثال: 0551234567 أو 01012345678', sendCode: 'أرسل الرمز', code: 'رمز التحقق', fullName: 'اسمك كما يراه أعضاء الجمعية',
  signIn: 'دخول', changePhone: 'تغيير الرقم', devCode: (c: string) => `بيئة التطوير: الرمز ${c}`, invalidPhone: 'أدخل رقم جوال سعودياً أو مصرياً أو إماراتياً صحيحاً',
  orDivider: 'أو', googleContinue: 'المتابعة بحساب Google', googleNeedsPhone: 'خطوة أخيرة: سجّل برقم جوالك ليرتبط بحساب Google.',
  home: 'الرئيسية', circles: 'جمعياتي', advisor: 'المستشار', account: 'حسابي', admin: 'الإدارة', signOut: 'خروج', menu: 'القائمة', notifications: 'الإشعارات', noNotifications: 'لا إشعارات جديدة.', markRead: 'تعليم الكل كمقروء',
  hello: (n: string) => `أهلاً ${n}`,
  toPay: 'عليك تحويله', toApprove: 'إيصالات بانتظار اعتمادك', toConfirm: 'بانتظار تأكيد استلامك', nothingToPay: 'لا شيء مطلوب منك الآن.', late: 'متأخر',
  newCircle: 'جمعية جديدة', join: 'انضم بدعوة', noCircles: 'ليست لديك جمعيات بعد. أنشئ واحدة وادعُ من تثق بهم، أو انضم برمز دعوة.',
  members: (j: number, t: number) => `${j} من ${t} أعضاء`,
  perMonth: { MONTHLY: 'شهرياً', BIWEEKLY: 'كل أسبوعين', WEEKLY: 'أسبوعياً' } as Record<string, string>,
  status: { RECRUITING: 'يستقبل أعضاء', LOCKED: 'اكتمل العدد', ACTIVE: 'جارية', COMPLETED: 'منتهية', CANCELLED: 'ملغاة', DRAFT: 'مسودة' } as Record<string, string>,
  instStatus: { SCHEDULED: 'لاحقاً', DUE: 'مستحق اليوم', IN_GRACE: 'في فترة السماح', LATE: 'متأخر', AWAITING_ORGANIZER: 'بانتظار المنظم', AWAITING_CONFIRMATION: 'بانتظار المستلم', DISPUTED: 'معترض عليه', PAID: 'مكتمل' } as Record<string, string>,
  tierName: { SMALL: 'صغيرة', MEDIUM: 'متوسطة', LARGE: 'كبيرة' } as Record<string, string>,
  tierRule: { SMALL: 'قيمة القبض حتى 10,000 ريال', MEDIUM: 'قيمة القبض من 10,001 إلى 50,000 ريال', LARGE: 'قيمة القبض من 50,001 إلى 100,000 ريال: تحتاج سند لأمر من كل عضو لصالح المنظم واعتماد إدارة المنصة قبل القرعة' } as Record<string, string>,
  country: 'الدولة', countries: { SA: 'السعودية', EG: 'مصر', AE: 'الإمارات' } as Record<string, string>,
  name: 'اسم الجمعية', contribution: 'مساهمة كل عضو', memberCount: 'عدد الأعضاء', frequency: 'الدورية', startDate: 'تاريخ أول دورة', graceDays: 'أيام السماح بعد الموعد',
  freq: { MONTHLY: 'شهرية', BIWEEKLY: 'كل أسبوعين', WEEKLY: 'أسبوعية' } as Record<string, string>,
  pot: 'قيمة القبض لكل دورة', endsOn: 'آخر دورة', agreementTitle: 'اتفاقية الانضمام', acceptAgreement: 'قرأت الاتفاقية وأوافق عليها', createCircle: 'أنشئ الجمعية',
  inviteCode: 'رمز الدعوة', joinCircle: 'انضم إلى الجمعية',
  invite: 'ادعُ أعضاء', inviteLink: 'شارك هذا الرابط مع من تدعوهم', copy: 'انسخ', copied: 'نُسخ', inviteUses: (n: number) => `صالح لـ ${n} أشخاص خلال 3 أيام`,
  ring: 'ترتيب القبض', yourTurn: 'دورك', turnShort: 'دورك', you: 'أنت', manager: 'المنظم', waitingDraw: 'يُحدَّد الترتيب بالقرعة بعد اكتمال العدد.',
  myTurnLine: (p: number, d: string) => `تستلم القبض في الدورة رقم ${p}، بتاريخ ${d}`,
  tabOverview: 'نظرة عامة', tabPayments: 'المدفوعات', tabChat: 'المحادثة',
  lottery: 'القرعة', trial: 'جرّب قرعة تجريبية', trialNote: 'نتيجة تجريبية غير ملزمة ولا تُحفظ.',
  prepare: 'جهّز القرعة الرسمية', prepared: 'القرعة جاهزة. هذه البصمة تثبت أن النتيجة لن تتغير:', approve: 'أوافق على إجراء القرعة', approvedWait: 'وافقت. بانتظار تنفيذ المنظم.',
  needApproval: 'بانتظار موافقة عضو آخر قبل التنفيذ.', entropy: 'عبارة يعلنها المنظم للأعضاء الآن', execute: 'نفّذ القرعة',
  verified: 'تحققنا: النتيجة تطابق البصمة المعلنة قبل القرعة', notVerified: 'تعذر التحقق من النتيجة', verifyDetails: 'تفاصيل التحقق',
  commitment: 'البصمة المعلنة', seed: 'البذرة بعد الكشف', publicEntropy: 'العبارة المعلنة',
  largeTitle: 'السندات والاعتماد', notesStatus: { MISSING: 'لم يُرفع', SUBMITTED: 'مرفوع', ACCEPTED: 'مقبول', REJECTED: 'مرفوض' } as Record<string, string>,
  approvalStatus: { NOT_REQUIRED: 'لا يلزم', AWAITING_NOTES: 'بانتظار السندات', PENDING: 'قيد مراجعة إدارة المنصة', APPROVED: 'معتمدة', REJECTED: 'لم تُعتمد' } as Record<string, string>,
  noteExplain: (amount: string) => `ارفع سند لأمر (مثلاً من منصة نافذ) لصالح منظم الجمعية بقيمة ${amount}، مع رقمه المرجعي.`,
  noteFile: 'ملف السند (PDF أو صورة)', noteRef: 'رقم السند المرجعي', submitNote: 'ارفع السند', noteSent: 'رُفع السند.', requestReview: 'اطلب اعتماد إدارة المنصة', reviewNote: 'ملاحظة المراجع',
  schedule: 'جدول الدورات', recipient: 'المستلم', paidCount: (p: number, t: number) => `${p} من ${t} مكتمل`,
  myActions: 'مطلوب منك', to: 'إلى', from: 'من',
  showPayTo: 'اعرض بيانات التحويل', payToTitle: (n: string) => `حوّل إلى ${n} عبر`, noPayTo: 'لم يضف المستلم وسيلة استلام بعد. تواصل معه في المحادثة.',
  method: 'وسيلة التحويل', receipt: 'إيصال التحويل (PDF أو صورة)', reference: 'رقم العملية (اختياري)', declare: 'أرسل الإيصال للاعتماد', recordTransfer: 'سجّل تحويلك', other: 'أخرى',
  viewReceipt: 'اعرض الإيصال', approveReceipt: 'اعتمد الإيصال', rejectReceipt: 'ارفض', rejectReason: 'سبب الرفض', confirm: 'وصلني المبلغ', dispute: 'لم يصلني', disputeReason: 'ما المشكلة؟',
  declared: 'أُرسل الإيصال. سيصلك إشعار عند الاعتماد.', approvedMsg: 'اعتُمد الإيصال وأُبلغ المستلم.', rejectedMsg: 'رُفض الإيصال وأُبلغ الدافع.', confirmedMsg: 'تم التأكيد واكتملت المعاملة.', disputedMsg: 'سُجّل اعتراضك وأُبلغ المنظم.',
  stepsLabel: 'المرسل، المنظم، المستلم',
  disputes: 'الاعتراضات المفتوحة', resolve: 'احسم', outcome: 'القرار', resendOutcome: 'على الدافع إعادة التحويل', validOutcome: 'الإيصال صحيح', resolutionNote: 'سبب القرار', resolvedMsg: 'حُسم الاعتراض.', platformDecides: 'المنظم طرف في هذا التحويل، لذلك تحسمه إدارة المنصة.', platformDisputes: 'اعتراضات تحسمها المنصة', noDisputes: 'لا اعتراضات بانتظار المنصة.',
  circleDone: 'اكتملت الجمعية. كل الأقساط مؤكدة.',
  chatPlaceholder: 'اكتب رسالة… أو @مساعد تقرير', send: 'أرسل', assistant: 'المساعد', system: 'سجل الجمعية',
  quick: { report: '@مساعد تقرير', statement: '@مساعد حسابي', late: '@مساعد المتأخرين', next: '@مساعد القادم' } as Record<string, string>,
  quickLabel: { report: 'تقرير', statement: 'حسابي', late: 'المتأخرون', next: 'القادم' } as Record<string, string>,
  emptyChat: 'لا رسائل بعد. كل تحويل واعتماد يُسجَّل هنا تلقائياً.',
  advisorTitle: 'كم تستطيع أن تدخر بجمعية؟', advisorIntro: 'أدخل أرقامك الشهرية. لا نحفظها، ونستخدمها لهذه الإجابة فقط.',
  income: 'الدخل الشهري (ريال)', expenses: 'المصاريف الشهرية (ريال)', goal: 'المبلغ الذي تريد جمعه (ريال)', targetMonths: 'خلال كم شهراً؟ (اختياري)', ask: 'احسب',
  capacity: 'تستطيع تخصيصه شهرياً', existing: 'التزاماتك الحالية', remaining: 'المتبقي للجمعيات', recommendation: 'الخيار المقترح',
  scenarioRow: (m: number) => `${m} أعضاء`, affordable: 'ضمن قدرتك', notAffordable: 'أعلى من قدرتك', outsideTarget: 'أطول من مدتك',
  aiWrote: (p: string) => `صاغ الشرح نموذج ذكاء اصطناعي (${p}) من أرقام المنصة`, templateWrote: 'شرح ثابت من المنصة',
  accountTitle: 'حسابي', payoutMethods: 'وسائل استلام القبض', payoutExplain: 'تظهر بياناتك كاملة فقط لمن عليه تحويل لك في دورك، ويُسجَّل كل اطلاع.',
  addMethod: 'أضف وسيلة', value: 'الرقم أو الآيبان', makeDefault: 'اجعلها الأساسية لهذه الدولة', remove: 'احذف', defaultTag: 'أساسية',
  googleLinked: 'مرتبط بحساب Google', googleNotLinked: 'غير مرتبط بحساب Google',
  identity: 'هوية الأعمال', identityExplain: 'أضف شعار جهتك ليظهر في رأس التطبيق على خلفية محايدة في كل المظاهر.',
  logoName: 'اسم الجهة', logoFile: 'ملف الشعار (PNG شفاف)', addLogo: 'أضف الشعار', showInHeader: 'اعرضه في الرأس', up: 'للأعلى',
  appearance: 'المظهر', skins: { auto: 'تلقائي', light: 'فاتح', dark: 'داكن', bright: 'ساطع' } as Record<string, string>, language: 'English',
  adminTitle: 'مراجعة الجمعيات الكبيرة', noPending: 'لا توجد جمعيات بانتظار المراجعة.', openNote: 'افتح السند', approveCircle: 'اعتمد الجمعية', rejectCircle: 'ارفض مع ملاحظة', organizer: 'المنظم',
  sep: '، ', sar: 'ريال', back: 'رجوع', retry: 'أعد المحاولة', loading: 'جارٍ التحميل', error: 'حدث خطأ', cancel: 'إلغاء', save: 'احفظ',
};
type Dict = typeof ar;

const en: Dict = {
  appName: 'Jamiyati',
  tagline: 'Run your savings circle with people you trust. The app never holds your money: each member transfers directly to whoever’s turn it is and uploads the receipt, and every step is documented.',
  phone: 'Mobile number', phoneHint: 'e.g. 0551234567 or 01012345678', sendCode: 'Send code', code: 'Verification code', fullName: 'Your name as members will see it',
  signIn: 'Sign in', changePhone: 'Change number', devCode: (c) => `Development: code ${c}`, invalidPhone: 'Enter a valid Saudi, Egyptian or UAE mobile number',
  orDivider: 'or', googleContinue: 'Continue with Google', googleNeedsPhone: 'One last step: register your mobile number to link it to your Google account.',
  home: 'Home', circles: 'My circles', advisor: 'Advisor', account: 'Account', admin: 'Admin', signOut: 'Sign out', menu: 'Menu', notifications: 'Notifications', noNotifications: 'No new notifications.', markRead: 'Mark all as read',
  hello: (n) => `Hello, ${n}`,
  toPay: 'To transfer', toApprove: 'Receipts waiting for your approval', toConfirm: 'Waiting for you to confirm receipt', nothingToPay: 'Nothing needs you right now.', late: 'Late',
  newCircle: 'New circle', join: 'Join with invite', noCircles: 'You have no circles yet. Create one and invite people you trust, or join with an invite code.',
  members: (j, t) => `${j} of ${t} members`,
  perMonth: { MONTHLY: 'monthly', BIWEEKLY: 'every two weeks', WEEKLY: 'weekly' },
  status: { RECRUITING: 'Open to members', LOCKED: 'Full', ACTIVE: 'Running', COMPLETED: 'Completed', CANCELLED: 'Cancelled', DRAFT: 'Draft' },
  instStatus: { SCHEDULED: 'Upcoming', DUE: 'Due today', IN_GRACE: 'In grace period', LATE: 'Late', AWAITING_ORGANIZER: 'Awaiting organizer', AWAITING_CONFIRMATION: 'Awaiting recipient', DISPUTED: 'Disputed', PAID: 'Complete' },
  tierName: { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' },
  tierRule: { SMALL: 'Payout up to 10,000 SAR', MEDIUM: 'Payout 10,001 to 50,000 SAR', LARGE: 'Payout 50,001 to 100,000 SAR: needs a promissory note from every member to the organizer and platform approval before the draw' },
  country: 'Country', countries: { SA: 'Saudi Arabia', EG: 'Egypt', AE: 'UAE' },
  name: 'Circle name', contribution: 'Contribution per member', memberCount: 'Members', frequency: 'Frequency', startDate: 'First cycle date', graceDays: 'Grace days after due date',
  freq: { MONTHLY: 'Monthly', BIWEEKLY: 'Every two weeks', WEEKLY: 'Weekly' },
  pot: 'Payout per cycle', endsOn: 'Last cycle', agreementTitle: 'Joining agreement (Arabic)', acceptAgreement: 'I have read and accept the agreement', createCircle: 'Create circle',
  inviteCode: 'Invite code', joinCircle: 'Join circle',
  invite: 'Invite members', inviteLink: 'Share this link with the people you invite', copy: 'Copy', copied: 'Copied', inviteUses: (n) => `Valid for ${n} people for 3 days`,
  ring: 'Payout order', yourTurn: 'Your turn', turnShort: 'your turn', you: 'You', manager: 'Organizer', waitingDraw: 'The order is drawn once the circle is full.',
  myTurnLine: (p, d) => `You receive the payout in cycle ${p}, on ${d}`,
  tabOverview: 'Overview', tabPayments: 'Payments', tabChat: 'Chat',
  lottery: 'Draw', trial: 'Run a practice draw', trialNote: 'Practice result. Not binding and not saved.',
  prepare: 'Prepare the official draw', prepared: 'The draw is ready. This fingerprint proves the result can’t change:', approve: 'Approve the draw', approvedWait: 'Approved. Waiting for the organizer to run it.',
  needApproval: 'Waiting for another member to approve before running.', entropy: 'Phrase the organizer announces to members now', execute: 'Run the draw',
  verified: 'Verified: the result matches the fingerprint published before the draw', notVerified: 'The result could not be verified', verifyDetails: 'Verification details',
  commitment: 'Published fingerprint', seed: 'Revealed seed', publicEntropy: 'Announced phrase',
  largeTitle: 'Notes and approval', notesStatus: { MISSING: 'Not uploaded', SUBMITTED: 'Uploaded', ACCEPTED: 'Accepted', REJECTED: 'Rejected' },
  approvalStatus: { NOT_REQUIRED: 'Not required', AWAITING_NOTES: 'Waiting for notes', PENDING: 'Under platform review', APPROVED: 'Approved', REJECTED: 'Not approved' },
  noteExplain: (amount) => `Upload a promissory note (for example from Nafith) payable to the circle organizer for ${amount}, with its reference number.`,
  noteFile: 'Note file (PDF or image)', noteRef: 'Note reference number', submitNote: 'Upload note', noteSent: 'Note uploaded.', requestReview: 'Request platform approval', reviewNote: 'Reviewer note',
  schedule: 'Cycle schedule', recipient: 'Recipient', paidCount: (p, t) => `${p} of ${t} complete`,
  myActions: 'Waiting on you', to: 'to', from: 'from',
  showPayTo: 'Show transfer details', payToTitle: (n) => `Transfer to ${n} via`, noPayTo: 'The recipient hasn’t added a payout method yet. Message them in the chat.',
  method: 'Transfer method', receipt: 'Transfer receipt (PDF or image)', reference: 'Transaction number (optional)', declare: 'Send receipt for approval', recordTransfer: 'Record your transfer', other: 'Other',
  viewReceipt: 'View receipt', approveReceipt: 'Approve receipt', rejectReceipt: 'Reject', rejectReason: 'Reason for rejecting', confirm: 'I received it', dispute: 'Not received', disputeReason: 'What’s wrong?',
  declared: 'Receipt sent. You’ll be notified when it’s approved.', approvedMsg: 'Receipt approved; the recipient was notified.', rejectedMsg: 'Receipt rejected; the payer was notified.', confirmedMsg: 'Confirmed. The transaction is complete.', disputedMsg: 'Dispute recorded; the organizer was notified.',
  stepsLabel: 'Sender, organizer, recipient',
  disputes: 'Open disputes', resolve: 'Resolve', outcome: 'Decision', resendOutcome: 'Payer must transfer again', validOutcome: 'Receipt is valid', resolutionNote: 'Reason for the decision', resolvedMsg: 'Dispute resolved.', platformDecides: 'The organizer is a party to this transfer, so the platform decides.', platformDisputes: 'Disputes for the platform to decide', noDisputes: 'No disputes waiting for the platform.',
  circleDone: 'The circle is complete. Every installment is confirmed.',
  chatPlaceholder: 'Write a message… or @assistant report', send: 'Send', assistant: 'Assistant', system: 'Circle record',
  quick: { report: '@assistant report', statement: '@assistant statement', late: '@assistant late', next: '@assistant next' },
  quickLabel: { report: 'Report', statement: 'My account', late: 'Late', next: 'Next' },
  emptyChat: 'No messages yet. Every transfer and approval is recorded here automatically.',
  advisorTitle: 'How much can you save with a circle?', advisorIntro: 'Enter your monthly figures. We don’t store them; they’re used for this answer only.',
  income: 'Monthly income (SAR)', expenses: 'Monthly expenses (SAR)', goal: 'Amount you want to collect (SAR)', targetMonths: 'Within how many months? (optional)', ask: 'Calculate',
  capacity: 'You can set aside monthly', existing: 'Your current commitments', remaining: 'Left for circles', recommendation: 'Suggested option',
  scenarioRow: (m) => `${m} members`, affordable: 'Within reach', notAffordable: 'Above your capacity', outsideTarget: 'Longer than your target',
  aiWrote: (p) => `Explanation written by an AI model (${p}) from the app’s figures`, templateWrote: 'Standard explanation from the app',
  accountTitle: 'Account', payoutMethods: 'Where you receive your payout', payoutExplain: 'Your full details are shown only to members who owe you in your turn, and every view is recorded.',
  addMethod: 'Add method', value: 'Number or IBAN', makeDefault: 'Make it the main one for this country', remove: 'Remove', defaultTag: 'Main',
  googleLinked: 'Linked to Google', googleNotLinked: 'Not linked to Google',
  identity: 'Business identity', identityExplain: 'Add your organisation’s logo to show it in the app header on a neutral plate in every skin.',
  logoName: 'Organisation name', logoFile: 'Logo file (transparent PNG)', addLogo: 'Add logo', showInHeader: 'Show in header', up: 'Move up',
  appearance: 'Appearance', skins: { auto: 'Automatic', light: 'Light', dark: 'Dark', bright: 'Bright' }, language: 'العربية',
  adminTitle: 'Review large circles', noPending: 'No circles waiting for review.', openNote: 'Open note', approveCircle: 'Approve circle', rejectCircle: 'Reject with a note', organizer: 'Organizer',
  sep: ', ', sar: 'SAR', back: 'Back', retry: 'Try again', loading: 'Loading', error: 'Something went wrong', cancel: 'Cancel', save: 'Save',
};

export const dictionaries: Record<Lang, Dict> = { ar, en };
export const I18n = createContext<{ t: Dict; lang: Lang }>({ t: ar, lang: 'ar' });
export const useT = () => useContext(I18n);

const CURRENCY: Record<string, { ar: string; en: string }> = { SAR: { ar: 'ريال', en: 'SAR' }, EGP: { ar: 'جنيه', en: 'EGP' }, AED: { ar: 'درهم', en: 'AED' } };

/** Display formatting only (grouping). Values are already exact strings from the server. */
export function money(v: string | null | undefined, lang: Lang, currency = 'SAR'): string {
  if (v == null) return '—';
  const [w, d] = String(v).split('.');
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${d && d !== '00' ? `${grouped}.${d}` : grouped} ${(CURRENCY[currency] ?? { ar: currency, en: currency })[lang]}`;
}

export function date(iso: string, lang: Lang): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function time(isoTs: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(isoTs));
}
