# API v1 — Smart Gam'eya (النموذج A)

الأساس: `/api/v1` · المصادقة: `Authorization: Bearer <accessToken>` (HS256، 15 دقيقة) · كل استجابة تحمل `x-correlation-id`.

صيغة الخطأ الموحدة:
```json
{ "error": { "code": "NOT_FOUND", "message": "gamiya not found", "correlationId": "…" } }
```
الأكواد: `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 (يُستخدم أيضاً لإخفاء وجود موارد لا تخص المستخدم) · `VALIDATION_FAILED` 400 · `RATE_LIMITED` 429 · أكواد تعارض 409: `ALREADY_MEMBER`, `CIRCLE_FULL`, `NOT_RECRUITING`, `NOT_LOCKED`, `LOTTERY_EXISTS`, `APPROVAL_REQUIRED`, `LOTTERY_DONE`, `ALREADY_DECLARED`, `NOT_DECLARED`, `ALREADY_CONFIRMED`.

## المصادقة
| الطريقة | المسار | الجسم | ملاحظات |
|---|---|---|---|
| POST | `/auth/otp/request` | `{ phone: "+9665XXXXXXXX" }` | 202؛ 5 رموز/15 دقيقة لكل رقم، 5/دقيقة لكل IP؛ `devCode` يظهر فقط في التطوير |
| POST | `/auth/otp/verify` | `{ phone, code, fullName? }` | ينشئ المستخدم عند أول دخول؛ 5 محاولات للرمز |

## الجمعيات
| الطريقة | المسار | من | الوصف |
|---|---|---|---|
| GET | `/agreements/current` | أي مستخدم | نص اتفاقية الانضمام + المعرف + بصمة SHA-256 |
| POST | `/gamiyas` | أي مستخدم | `{ name, frequency: WEEKLY\|BIWEEKLY\|MONTHLY, contribution: "1000", memberCount, startDate, graceDays?, agreementVersionId }` — المنشئ يصبح المدير |
| GET | `/gamiyas` | — | جمعياتي |
| GET | `/gamiyas/:id` | عضو | التفاصيل، الأعضاء بالأسماء فقط، قيمة القبض، تاريخ الانتهاء |
| POST | `/gamiyas/:id/invitations` | المدير | `{ maxUses?, expiresInHours? }` → `code` |
| POST | `/invitations/:code/accept` | مدعو | `{ agreementVersionId }` — تُقفل الجمعية تلقائياً عند الاكتمال |

## القرعة
| الطريقة | المسار | من | الوصف |
|---|---|---|---|
| POST | `/gamiyas/:id/lottery/trial` | عضو | قرعة تجريبية غير ملزمة ولا تُحفظ |
| POST | `/gamiyas/:id/lottery/prepare` | المدير (جمعية مكتملة) | يُعلن `commitment` واحتمالات الاختيار |
| POST | `/gamiyas/:id/lottery/approve` | عضو غير المُعِدّ | موافقة Maker–Checker |
| POST | `/gamiyas/:id/lottery/execute` | المدير | `{ publicEntropy }` معلنة وقت القرعة → الترتيب + كشف البذرة + جدول الأقساط |
| GET | `/gamiyas/:id/lottery` | عضو | الحالة؛ بعد التنفيذ: السجل الكامل ونتيجة التحقق |

**التحقق المستقل:** `sha256(revealedSeedHex) == commitment`، ثم إعادة حساب الترتيب بـ `verifyDraw` من `packages/financial-core/src/lottery.ts`.

## الأقساط (تسوية مباشرة بين الأعضاء)
| الطريقة | المسار | من | الوصف |
|---|---|---|---|
| GET | `/gamiyas/:id/schedule` | عضو | الدورات، المستلم، حالة كل قسط |
| GET | `/me/obligations` | — | `toPay`، `toConfirm`، `late` |
| POST | `/installments/:id/declare-paid` | الدافع | `{ reference? }` → `AWAITING_CONFIRMATION` |
| POST | `/installments/:id/confirm-received` | مستلم الدورة | → `PAID`؛ آخر تأكيد يُكمل الجمعية |
| POST | `/installments/:id/dispute` | مستلم الدورة | → `DISPUTED` (قبل التأكيد) |

حالات القسط المحسوبة على الخادم بتقويم الرياض: `SCHEDULED` · `DUE` · `IN_GRACE` · `LATE` · `AWAITING_CONFIRMATION` · `DISPUTED` · `PAID`.

## الصحة
`GET /health` (عام).
