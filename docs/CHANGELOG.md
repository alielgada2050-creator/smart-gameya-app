# CHANGELOG

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
