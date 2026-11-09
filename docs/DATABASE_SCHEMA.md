# DATABASE SCHEMA (migration 001 — النواة)

الملف المنفّذ: `infrastructure/database/migrations/001_core.sql` — مُختبر على PostgreSQL 16 (انظر TESTING_REPORT.md).
الجداول الباقية من PART 9 (الإشعارات، AI، الاشتراكات، النزاعات...) مجدولة في migrations لاحقة.

```mermaid
erDiagram
  organizations ||--o{ users : has
  users ||--o{ user_documents : uploads
  users ||--o{ gamiyas : creates
  gamiyas ||--o{ gamiya_members : has
  users ||--o{ gamiya_members : joins
  gamiyas ||--o{ gamiya_cycles : schedules
  gamiya_cycles ||--o{ gamiya_installments : bills
  gamiya_members ||--o{ gamiya_installments : owes
  gamiya_members ||--o| gamiya_cycles : "receives pot"
  gamiyas ||--o{ lottery_sessions : draws
  lottery_sessions ||--o| lottery_results : reveals
  gamiya_installments ||--o{ payment_intents : paid_by
  ledger_transactions ||--|{ ledger_entries : contains
  financial_accounts ||--o{ ledger_entries : posts
  ledger_transactions ||--o| ledger_transactions : reverses
  agreement_versions ||--o{ agreement_acceptances : accepted
  users ||--o{ agreement_acceptances : accepts
```

## القيود المفروضة في قاعدة البيانات
| القيد | الآلية |
|---|---|
| عدد الدورات = عدد الأعضاء | `CHECK cycles_equal_members` |
| دور قبض واحد لكل عضو، وعضو واحد لكل دور | `UNIQUE (gamiya_id, payout_position)` |
| توازن القيد المزدوج | `CONSTRAINT TRIGGER ledger_balanced` (مؤجل لنهاية المعاملة) |
| عدم تعديل/حذف السجلات المالية والتدقيق | `forbid_mutation()` triggers |
| منع تكرار المعاملة | `UNIQUE idempotency_key` |
| منع إعادة Webhook | `UNIQUE (provider, provider_event_id)` |
| قرعة رسمية واحدة لكل جمعية | partial unique index |
| البذرة تطابق الالتزام | trigger `check_lottery_seed` (pgcrypto sha256) |
| Maker–Checker للقرعة | `CHECK executed_by <> approved_by` |
| المبالغ | `numeric(18,2)`؛ التواريخ `timestamptz` (UTC) |
