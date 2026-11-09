# AGENTS — أدوار الفريق الهندسي

> تنبيه صدق: المشروع يُنفَّذ عبر جلسة Claude واحدة (مع وكلاء فرعيين عند الطلب). الأدوار أدناه قبعات مسؤولية تُنفَّذ بالتتابع، وكل مخرج يمر بمراجعة CTO. لا تعديل متزامن لنفس الملف.

| # | الدور | نطاق الملفات | مخرجات المرحلة الحالية | الحالة |
|---|---|---|---|---|
| 01 | CTO | كل المستودع (مراجعة) | اعتماد البنية، ADR-001..011 | ✅ Gate A |
| 02 | PM & BA | docs/SRS.md, DEVELOPMENT_ROADMAP.md | SRS، خارطة الطريق | ✅ مسودة |
| 03 | Reverse Engineering | docs/REVERSE_ENGINEERING_REPORT.md | تحليل وظيفي مصنّف | ✅ |
| 04 | UX/UI | apps/web/src/styles.css, src/shell | تصميم متكيّف (UI/UX Pro Max): شريط جانبي/سفلي، تباين WCAG، PWA، 4 أغلفة، Hairline | ✅ |
| 05 | Database Architect | infrastructure/database | migration 001 + اختبارات | ✅ |
| 06 | Backend | apps/api | Auth، الجمعيات، القرعة، الأقساط | ✅ جزئي (Phase 2–3) |
| 07 | Frontend | apps/web | كل رحلات العضو والمنظم ومراجع المنصة | ✅ |
| 08 | Mobile | apps/mobile (Flutter) | — | Phase 7 |
| 09 | AI Engineer | packages/ai-core | سلسلة مزودين مجانية، حارس الأرقام، مستشار الادخار | ✅ جزئي (Phase 5) |
| 10 | Financial Systems | packages/financial-core | المال، الجدولة، الرسوم، القرعة، الدفتر | ✅ مختبر |
| 11 | Cybersecurity | SECURITY.md | نموذج تهديد أولي | Phase 1b |
| 12 | QA Automation | tests/, */test | 14 مالية + 8 ذكاء + 9 SQL + 30 API + رحلة متصفح (3 أعضاء + مراجع) | ✅ |
| 13 | Integration | packages/notification-core, apps/api/payments | — | Phase 4/6 |
| 14 | DevOps | infrastructure/, .github/ | — | Phase 2 |
| 15 | Documentation | docs/ | التقارير | ✅ |

## بروتوكول التسليم
1. كل دور يكتب مخرجه ويضيف سطراً في `docs/CHANGELOG.md`.
2. شروط القبول: الاختبارات ناجحة + لا أسرار في الشيفرة + توثيق القرار.
3. CTO يراجع ثم يعتمد الدمج.
