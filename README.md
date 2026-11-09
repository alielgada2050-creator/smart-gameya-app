# Smart Gam'eya — منصة الجمعيات الذكية (Refers Engineering)

منصة سعودية لإدارة الجمعيات الدورية، مبنية بأسلوب الغرفة النظيفة بعد تحليل وظيفي عام لنموذج Money Fellows عبر مهارة **إعادة استنساخ التطبيقات** (REA).

## الحالة: النموذج A معتمد — واجهة API للجمعيات تعمل ومختبرة

**النموذج A:** المنصة أداة تنظيم فقط؛ الأعضاء يحوّلون لبعضهم مباشرة، والقسط يُعتمد بإقرار الدافع وتأكيد المستلم (`docs/AGENT_DECISION_LOG.md`).

| ما أُنجز | أين |
|---|---|
| فحص البيئة وREA | `docs/ENVIRONMENT_AUDIT.md`, `docs/INITIALIZATION_REPORT.md` |
| الهندسة العكسية الوظيفية | `docs/REVERSE_ENGINEERING_REPORT.md` |
| المتطلبات والبنية | `docs/SRS.md`, `docs/SYSTEM_ARCHITECTURE.md` |
| قاعدة البيانات (ERD + قيود) | `docs/DATABASE_SCHEMA.md`, `infrastructure/database/` |
| الامتثال السعودي (أولي) | `docs/COMPLIANCE_ASSESSMENT.md` |
| النواة المالية: مال بلا float، جدولة، رسوم، قرعة قابلة للتحقق، دفتر مزدوج | `packages/financial-core/` |
| الاختبارات | `docs/TESTING_REPORT.md` |
| خارطة الطريق | `docs/DEVELOPMENT_ROADMAP.md` |
| واجهة NestJS: OTP وتجديد الجلسات، جمعيات، دعوات، اتفاقيات، قرعة، تسوية بين الأعضاء | `apps/api/`, `docs/API_DOCUMENTATION.md` |
| مستشار الادخار الذكي على مزودين مجانيين (Groq ← Cloudflare ← قالب ثابت) | `packages/ai-core/`, `docs/AI_PROVIDERS.md` |

## تشغيل الاختبارات
```bash
# النواة المالية (Node 22.18+، بلا تبعيات)
cd packages/financial-core && node --test test/core.test.ts

# قاعدة البيانات
createdb sg && psql -d sg -v ON_ERROR_STOP=1 -f infrastructure/database/migrations/001_core.sql
psql -d sg -f infrastructure/database/tests/001_core_checks.sql

# طبقة الذكاء الاصطناعي (خادم مزود وهمي محلي، بلا مفاتيح)
cd packages/ai-core && node --test test/ai.test.ts

# الواجهة البرمجية (يحتاج PostgreSQL على PGHOST/PGPORT)
scripts/test-api.sh                       # يعيد إنشاء قاعدة الاختبار ويشغل 17 اختبار E2E
cd apps/api && npm run build && npm start # مع متغيرات .env.example
```

## مثال: قرعة قابلة للتحقق
```ts
import { prepareDraw, executeDraw, verifyDraw } from './packages/financial-core/src/lottery.ts';
const prep = prepareDraw('circle-1', members);          // انشر prep.commitment للأعضاء قبل القرعة
const rec  = executeDraw(prep, { publicEntropy, executedBy: 'admin-a', approvedBy: 'admin-b' });
verifyDraw(rec);                                       // أي عضو يعيد الحساب: { valid: true }
```

## قواعد ثابتة
لا مسك أموال قبل اعتماد المسار القانوني · لا غرامات غير معلنة · لا نسخ لهوية أو شيفرة أو نصوص المرجع · الذكاء الاصطناعي لا يولّد أرقاماً.
