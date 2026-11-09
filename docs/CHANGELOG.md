# CHANGELOG

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
