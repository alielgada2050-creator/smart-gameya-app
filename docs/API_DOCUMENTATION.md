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
| POST | `/auth/otp/verify` | `{ phone, code, fullName? }` | ينشئ المستخدم عند أول دخول؛ 5 محاولات؛ يعيد `accessToken` (15 د) و`refreshToken` (30 يوماً) |
| POST | `/auth/refresh` | `{ refreshToken }` | يعيد زوجاً جديداً ويُبطل القديم؛ إعادة استخدام رمز قديم → `REFRESH_REUSED` وإلغاء كل جلسات العائلة |
| POST | `/auth/logout` | `{ refreshToken }` | يلغي الجلسة؛ الرد نفسه سواء وُجد الرمز أم لا |

## الجمعيات
| الطريقة | المسار | من | الوصف |
|---|---|---|---|
| GET | `/agreements/current` | أي مستخدم | نص اتفاقية الانضمام + المعرف + بصمة SHA-256 |
| POST | `/gamiyas` | أي مستخدم | `{ name, frequency: WEEKLY\|BIWEEKLY\|MONTHLY, contribution: "1000", memberCount, startDate, graceDays?, agreementVersionId }` — المنشئ يصبح المدير |
| POST | `/gamiyas/preview` | أي مستخدم | `{ frequency, contribution, memberCount, startDate }` → `potPerCycle`، `totalVolume`، `endDate`، `cycles` (للمعاينة في نموذج الإنشاء) |
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

## الذكاء الاصطناعي
| الطريقة | المسار | الجسم | الرد |
|---|---|---|---|
| POST | `/ai/savings-advice` | `{ monthlyIncome, monthlyExpenses, goalAmount, targetMonths? }` (نصوص عشرية) | `facts` (الأرقام الرسمية من المحرك، تشمل التزاماتك الحالية)، `explanation { text, source: llm\|template, provider, model }`، `dataSources`، `disclaimer` |

المدخلات لا تُحفظ. حد 10 طلبات/دقيقة. انظر `docs/AI_PROVIDERS.md`.

## الفئات والسندات والاعتماد
| الطريقة | المسار | من | الوصف |
|---|---|---|---|
| POST | `/gamiyas/preview` | أي مستخدم | يعيد أيضاً `tier`، `requiresPlatformApproval`، `requiresPromissoryNotes`، `tierLimits` |
| POST | `/gamiyas/:id/files` | عضو | multipart: `file` + `purpose` (`RECEIPT` \| `PROMISSORY_NOTE`)؛ PDF/PNG/JPEG/WEBP ≤ 5MB، النوع يُحدد من البايتات |
| GET | `/files/:id` | الأطراف فقط | الإيصال: الرافع والمنظم ومستلم القسط (ومراجع المنصة عند اعتراض مفتوح)؛ السند: الرافع والمنظم ومراجعو المنصة |
| POST | `/gamiyas/:id/promissory-notes` | عضو غير المنظم | `{ fileId, reference }` — القيمة = قيمة القبض، لصالح المنظم |
| POST | `/gamiyas/:id/platform-review` | المنظم | بعد اكتمال العدد وكل السندات |
| GET | `/admin/reviews` · POST `/admin/gamiyas/:id/review` | مراجع المنصة | `{ decision: APPROVE\|REJECT, note? }`؛ لا يراجع جمعية هو عضو فيها |

## وسائل الاستلام والتحويل
| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/payout-methods/directory?country=` | الوسائل المتاحة لكل دولة |
| GET/POST | `/me/payout-methods` | قائمتي (مقنّعة) / إضافة `{ country, kind, value, isDefault }` مع تحقق الآيبان mod-97 وصيغ المحافظ |
| POST | `/me/payout-methods/:id/remove` | حذف منطقي |
| GET | `/installments/:id/pay-to` | لدافع هذا القسط فقط: وسائل المستلم كاملة (مسجل في التدقيق) |
| GET | `/installments/:id` | الخط الزمني للمعاملة لأطرافها الثلاثة |
| POST | `/installments/:id/declare-paid` | `{ methodKind, receiptFileId, reference? }` (يتطلب إيصالاً؛ يُعاد بعد الرفض) |
| POST | `/installments/:id/organizer-approve` · `/organizer-reject` | المنظم (`{ reason }` للرفض) |
| POST | `/installments/:id/dispute` | المستلم `{ reason }` |
| POST | `/disputes/:id/resolve` | `{ outcome: PAYER_TO_RESEND\|RECEIPT_VALID, note }` — المنظم، أو مراجع المنصة إن كان المنظم طرفاً |
| GET | `/gamiyas/:id/disputes` · `/admin/disputes` | الاعتراضات المفتوحة |
| GET | `/me/obligations` | يضيف `toApprove` للمنظم |

## المحادثة والمساعد والإشعارات
| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/gamiyas/:id/chat?after=` | الرسائل بعد المعرّف (حتى 200) |
| POST | `/gamiyas/:id/chat` | `{ body }`؛ الرسائل التي تبدأ بـ `@مساعد` أو `/` يرد عليها المساعد |
| GET | `/gamiyas/:id/assistant/report` | التقرير وكشف الحساب بصيغة منظمة |
| POST | `/gamiyas/:id/reminders/run` | المنظم: تذكير فوري (لا يتكرر في اليوم نفسه) |
| GET | `/me/notifications` · POST `/me/notifications/read` | الإشعارات داخل التطبيق |

## الدخول بـ Google والإعداد العام
| الطريقة | المسار | الوصف |
|---|---|---|
| POST | `/auth/google` | `{ idToken }` ← جلسة إن كان مرتبطاً، وإلا `{ needsPhone, linkToken }` |
| POST | `/auth/otp/verify` | يقبل `linkToken` لربط Google بالجوال |
| GET | `/auth/me` | الملف والدور وحالة ربط Google |
| GET | `/config/public` | `googleClientId` (عام بطبيعته) والدول المفعّلة |

أرقام الجوال المقبولة: السعودية `+9665…`، مصر `+201[0125]…`، الإمارات `+9715…`.

## الصحة
`GET /health` (عام).
