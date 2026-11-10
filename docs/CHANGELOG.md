# CHANGELOG

## 0.9.0 — 2026-11-10 — رسوم توضيحية متحركة وموشن جرافيك في مواضعها
- **رسمان توضيحيان أصليان** بأسلوب فلات مع خط محيطي (`apps/web/src/illustrations/Scenes.tsx`)، SVG مضمّن بألوان من رموز المظهر (فاتح/داكن/ساطع):
  - **شاشة الدخول**: عضوة بحجاب ترحّب بك وحولها شارات مزايا التطبيق الحقيقية (القرعة، الاعتماد، الإيصال، المحادثة، التذكيرات، الخصوصية)، تظهر الشارات واحدة تلو الأخرى ثم تطفو بهدوء، واليد تلوّح، والنجوم تتلألأ.
  - **لحظات الإنجاز**: عضو بالغترة والعقال يرفع يديه والعملات تتطاير، في بطاقة احتفال بعد: تنفيذ القرعة، اعتماد الترتيب بموافقة الجميع، تأكيد استلام الدفعة، إنشاء جمعية، الانضمام لجمعية. القرعة والترتيب المعتمد تُكشف أسماؤهما اسماً بعد اسم.
- **حركات دقيقة ذات معنى**: خطوة التسوية الجارية عليها مسحة بطيئة (بانتظار طرف)، وانتقال قصير بين الشاشات (View Transitions حيث يدعمها المتصفح)، واهتزاز خفيف في التطبيقين عند الاحتفال.
- القواعد: عنصر أو اثنان متحركان في كل شاشة، الدخول أبطأ من الخروج، transform/opacity فقط، وكل الحركة تتوقف مع «تقليل الحركة». بطاقة الاحتفال لا تحجز التركيز وتُغلق وحدها.

## 0.8.0 — 2026-11-10 — تطبيقات أندرويد و iPhone/iPad من نفس الشيفرة
- `apps/mobile`: مشروعا Capacitor 8 لأندرويد (جوال وتابلت، minSdk 24، targetSdk 36) و iOS/iPadOS، بمعرّف `sa.refers.jamiyati`، أيقونات وشاشات بداية فاتحة وداكنة.
- طبقة `platform.ts`: عنوان الخادم في التطبيقين، شريط الحالة حسب المظهر، زر الرجوع في أندرويد، المشاركة الأصلية للدعوات، اهتزاز التأكيد، عارض إيصالات داخلي وفتح PDF عبر المشاركة، تحديث البيانات عند العودة للتطبيق.
- الخادم: CORS لأصلي التطبيقين فقط (`CORS_ORIGINS`) دون ملفات تعريف ارتباط.
- الخطوط مضمّنة (IBM Plex عبر fontsource) بدل Google Fonts، وCSP صار ذاتي المصدر للخطوط والأنماط.
- أندرويد: تعطيل النسخ الاحتياطي ونقل البيانات، توقيع الإصدار من متغيرات البيئة فقط. iOS: أوصاف استخدام الكاميرا والصور بالعربية والإنجليزية.
- GitHub Actions: `mobile.yml` (APK + AAB، وبناء iOS للمحاكي) و`ci.yml` (اختبارات النواة والبناء).
- اختبار جديد `scripts/test-native.sh`: تشغيل الواجهة كتطبيق أندرويد على جوال وتابلت مع خادم بأصل مختلف.
- دليل `docs/MOBILE_APPS.md`.

## 0.7.0 — 2026-11-10 — ترتيب القبض بالاتفاق أو بالأولوية + تحويلات ذكية دون حيازة أموال
- **ترتيب القبض بثلاث طرق**: القرعة القابلة للتحقق (كما هي)، أو **بالاتفاق**، أو **بالأولوية مع اقتراح المساعد الذكي**. الطريقتان الأخيرتان لا تُعتمدان إلا **بموافقة جميع الأعضاء** (قرار المالك)، وأي اعتراض بسبب يغلق الاقتراح ويعيده للنقاش. الأصوات نهائية وغير قابلة للتعديل (append-only).
- **أولوية كل عضو**: مبكراً/بلا تفضيل/متأخراً، وتاريخ الحاجة، والسبب (يختار العضو إظهاره أو إخفاءه)، وملاحظة خاصة للمنظم فقط.
- **اقتراح المساعد**: يرتّب حسب تاريخ الحاجة ثم الرغبة، **لا يفاضل بين الأسباب**، ولا يمنح المنظم أفضلية، ويكسر التعادل ببصمة ثابتة لا بترتيب الانضمام، ويشرح نفسه ويذكر من لم يتسع الجدول لموعده. الملاحظات والأسباب لا تُرسل لأي نموذج لغوي؛ النموذج المجاني (إن وُجد) يلخص من أرقام مجهولة الهوية فقط مع حارس الأرقام.
- **التحويلات الذكية (النموذج A)**: رقم مرجعي ثابت لكل قسط يُكتب في ملاحظة التحويل، ونسخ البيانات بضغطة، وخطوات التحويل لكل وسيلة (فودافون كاش ‎*9*7#‎ من صفحة فودافون الرسمية، وتنبيه حد التحويل السريع في البنوك السعودية)، ومبلغ وتاريخ التحويل عند التسجيل.
- **مطابقة تلقائية** تظهر للمنظم والمستلم: المبلغ، التاريخ، الوسيلة، تكرار رقم العملية. **منع إعادة استخدام الإيصال نفسه** لدفعة أخرى (بصمة الملف).
- المساعد في المحادثة: أمر جديد «@مساعد الترتيب».

## 0.6.0 — 2026-11-10 — تصميم عصري متكيّف للمتصفح والكمبيوتر والجوال (مهارة «تصميم UX UI»)
- غلاف متكيّف: شريط جانبي ثابت من 1024px فأعلى، وشريط تنقل سفلي (4–5 عناصر، أهداف لمس ≥ 44px) على الجوال والتابلت، مع مراعاة حواف الشاشة (safe areas) ونسخة مضغوطة للجوال الأفقي.
- نظام ألوان جديد: كحلي #0F172A مع ذهبي ثقة #F59E0B (نص كحلي فوقه)، وثلاثة أغلفة (فاتح/داكن/ساطع) كلها ناجحة في فحص التباين WCAG (‏`scripts/contrast.py`، 39 زوجاً).
- خطوط IBM Plex Sans Arabic / IBM Plex Sans، هياكل تحميل (skeleton) بدل «جاري التحميل»، حالات ضغط 80–150ms، واحترام «تقليل الحركة».
- تطبيق قابل للتثبيت (PWA): أيقونات PNG ‏192/512/maskable/Apple، اختصارات (جمعياتي، جمعية جديدة، المستشار)، Service Worker يخزّن واجهة التطبيق فقط ولا يلمس ‎/api/ أو ‎/files/، شريط «غير متصل»، زر تثبيت في الرأس ولوحة «التطبيق على أجهزتك» في حسابي (مع إرشاد الآيفون).
- الخادم: `Cache-Control: no-cache` لـ index.html وsw.js والـ manifest، وتخزين دائم للملفات المُجزّأة.
- اختبار المتصفح: لقطات عند 375/768/1024/1440 والجوال الأفقي 844×390، والتحقق من ظهور الشريط الجانبي/السفلي حسب العرض وعدم وجود تمرير أفقي.

## 0.5.0 — 2026-11-09
- ADR-007 tiers by payout value (small/medium/large ≤ 100,000 SAR); large circles: promissory notes to the organizer + platform-admin approval before the draw; admin review page.
- ADR-008 Sign in with Google (server-verified ID token) with mandatory mobile registration; Egyptian and UAE mobiles accepted.
- ADR-009 payout methods per country (IBAN, STC Pay, Barq, urpay, InstaPay, Vodafone Cash), encrypted at rest, revealed only to the payer; receipts upload; three-party approval; organizer rejection; disputes with organizer or platform resolution; platform dispute queue.
- ADR-010 circle chat with an automatic transaction record, assistant commands, guarded free-form answers, idempotent reminders, in-app notifications.
- ADR-011 redesign with the Wathiq shell identity (4 skins, Alexandria + Readex Pro, two-tier header, mobile sheet, business logos) and Hairline figures.
- migration 004; tests: financial-core 14, ai-core 8, API 30, browser journey (3 members + reviewer).

## 0.4.0 — 2026-11-09
- ADR-006: apps/web — installable web app (React + Vite), Arabic RTL first + English, light/dark; rotation ring as the signature view.
- Screens: sign-in with OTP, home (what to pay / confirm), my circles, create with server preview, join by invite link, circle (ring, invite, draw with verification, my actions, schedule), savings advisor.
- API: POST /gamiyas/preview, myMemberId, lottery preparedByMe/approvedByMe; same-origin static serving with strict CSP and security headers (WEB_DIST).
- Real-browser two-user journey test (scripts/test-ui.sh) with screenshots in docs/screenshots.

## 0.3.0 — 2026-11-09
- ADR-004: AI on free providers (Groq → Cloudflare Workers AI → deterministic Arabic template) via packages/ai-core.
- Savings rules engine in financial-core (savings.ts); numeric hallucination guard; NOT_ADVISED never sent to a model.
- POST /api/v1/ai/savings-advice; ai_model_usage telemetry without prompt content.
- ADR-005: refresh-token rotation with reuse detection; /auth/refresh, /auth/logout.
- migration 003; tests: ai-core 8, API E2E 17.

## 0.2.0 — 2026-11-09
- ADR-001: operating Model A approved (organization tool; members pay each other directly).
- apps/api (NestJS 11): OTP auth + JWT, rate limits, correlation IDs, standard errors, audit trail.
- Circles: create, invite, join with versioned agreement, auto-lock, trial draw, commit–reveal official draw with maker–checker and sealed seed, schedule materialization.
- Installments: payer declares, recipient confirms or disputes, server-computed LATE status, auto-completion.
- migration 002_model_a; 12 end-to-end tests passing against PostgreSQL 16.

## 0.1.0 — 2026-11-09
- Phase 0: environment audit, REA 6.8.0 verified, app-recloning skill packaged.
- Phase 1 draft: SRS, architecture, ERD, compliance assessment.
- financial-core: money, schedule, fees, verifiable lottery, double-entry ledger (11 tests).
- DB migration 001 with integrity triggers (8 SQL checks).
