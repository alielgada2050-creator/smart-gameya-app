# SYSTEM ARCHITECTURE

## القرار: Modular Monolith (NestJS) + PostgreSQL + Redis/BullMQ
مبرر: فريق صغير، معاملات مالية تحتاج ACID في قاعدة واحدة، لا مبرر حالي لـ Microservices (PART 4).

```mermaid
flowchart TB
  subgraph Clients
    M[Flutter: Android / iOS / Desktop]
    W[Next.js: موقع تعريفي + SEO]
    A[Admin Web]
  end
  subgraph API[NestJS API /api/v1]
    ID[Identity & KYC]
    GM[Gam'eya Engine]
    LT[Lottery Engine]
    FN[Financial Engine / Ledger]
    PY[Payment Provider Adapter]
    NT[Notification Orchestrator]
    AI[AI Advisor - provider abstraction]
    AU[Audit]
  end
  FC[(packages/financial-core\nأرقام وقرعة ودفتر)]
  DB[(PostgreSQL 16)]
  RQ[(Redis + BullMQ)]
  S3[(S3-compatible private bucket)]
  PSP[[مزود دفع مرخص]]
  WA[[WhatsApp Business Platform]]
  M & W & A --> API
  GM & LT & FN --> FC
  API --> DB
  NT --> RQ --> WA
  ID --> S3
  PY <--> PSP
```

## مبادئ حاكمة
1. **مصدر الحقيقة للأرقام = financial-core + قاعدة البيانات.** الذكاء الاصطناعي يقرأ فقط ويصيغ؛ لا يولد مبالغ أو مواعيد أو نتائج قرعة.
2. **قرعة commit–reveal**: الالتزام يُنشر قبل القرعة، البذرة تُكشف بعدها، قاعدة البيانات ترفض أي بذرة لا تطابق الالتزام.
3. **Webhooks هي الحقيقة للدفع**: تحقق التوقيع، فهرس فريد على `provider_event_id` ضد الإعادة، idempotency keys على كل عملية.
4. **Append-only**: الدفتر، نتائج القرعة، قبول الاتفاقيات، سجل التدقيق — محمية بـ triggers.
5. **Jobs**: idempotent، قابلة لإعادة المحاولة، بأقفال موزعة، وتوقيت الخادم فقط.

## Monorepo
```
apps/{api,web,admin,mobile}     # Phase 2+
packages/financial-core         # ✅ منفّذ ومختبر
packages/{shared-types,design-system,api-client,ai-core,notification-core}
infrastructure/database         # ✅ migration 001 + اختبارات SQL
docs/  agents/  tests/
```
