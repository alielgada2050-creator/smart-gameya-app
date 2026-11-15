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
| POST | `/auth/google` | `{ idToken }` ← جلسة إن كان مرتبطاً. إن كان الدخول بالجوال مغلقاً (`phoneSignIn=false`، الإنتاج بلا SMS) يُنشأ الحساب من Google مباشرة؛ وإلا `{ needsPhone, linkToken }` |
| POST | `/auth/otp/request`, `/auth/otp/verify` | 404 `PHONE_SIGN_IN_DISABLED` حين يكون الدخول بالجوال مغلقاً |
| GET | `/config/public` | `{ googleClientId, phoneSignIn, circleCountries }` |
| GET | `/admin/stats` | مراجعو المنصة فقط: `{ users: { total, last7Days, last30Days }, circles: { total, byStatus }, memberships, activeMembers, pendingReviews }` |
| POST | `/gamiyas/:id/invitations/direct` | `{ phones?: E.164[], userIds?: uuid[] }` (واحد على الأقل). `userIds` لحسابات يشاركها المنظم جمعية فقط |
| POST | `/auth/otp/verify` | يقبل `linkToken` لربط Google بالجوال |
| GET | `/auth/me` | الملف والدور وحالة ربط Google |
| GET | `/config/public` | `googleClientId` (عام بطبيعته) والدول المفعّلة |

أرقام الجوال المقبولة: السعودية `+9665…`، مصر `+201[0125]…`، الإمارات `+9715…`.

## ترتيب القبض (بالاتفاق / بالأولوية)
| الطريقة | المسار | من | ملاحظات |
|---|---|---|---|
| GET | `/api/v1/gamiyas/:id/order` | عضو | الحالة، الأولويات (الملاحظة للمنظم وصاحبها فقط)، الاقتراح المفتوح والأصوات |
| POST | `/api/v1/gamiyas/:id/order/priority` | عضو | `{preference: EARLY\|NONE\|LATE, neededBy?, reason?, shareReason?, note?}` — قبل بدء الجمعية |
| GET | `/api/v1/gamiyas/:id/order/suggestion` | عضو | اقتراح المساعد مع الشرح؛ 409 `NOT_FULL` قبل اكتمال العدد |
| POST | `/api/v1/gamiyas/:id/order/proposals` | المنظم | `{mode: AGREED\|PRIORITY, order: memberId[], rationale?}`؛ 409 `ORDER_PROPOSAL_OPEN`/`LOTTERY_EXISTS`، 400 `INVALID_ORDER` |
| POST | `/api/v1/gamiyas/:id/order/proposals/:pid/vote` | عضو | `{vote: APPROVE\|OBJECT, reason}` (السبب إلزامي للاعتراض)؛ يُعتمد ويبدأ عند موافقة الجميع |
| POST | `/api/v1/gamiyas/:id/order/proposals/:pid/withdraw` | المنظم | سحب اقتراح مفتوح |

## التحويلات الذكية
- `GET /installments/:id/pay-to` يعيد الآن `reference` (رقم مرجعي ثابت مثل `JM-7KQ4-P2XD`) و`guide` لكل وسيلة (خطوات، رابط طالب الهاتف لفودافون كاش، تنبيه الحدود).
- `POST /installments/:id/declare-paid` يقبل `amount` و`transferDate` (اختياريان للتوافق، والواجهة ترسلهما)، ويعيد `match` (فحوص: AMOUNT, DATE, METHOD, RECEIPT_UNIQUE, BANK_REF_UNIQUE). 409 `RECEIPT_ALREADY_USED` عند إرفاق إيصال استُخدم لدفعة أخرى.

## الصحة
`GET /health` (عام).

## 0.11.0 — الإقرار، التعديل، الأهداف، المخطط
| الطريقة والمسار | الوصف |
|---|---|
| `POST /gamiyas/pledge-preview` | نص الإقرار وبصمته للمنشئ من شروط النموذج (`name, country, frequency, contribution, memberCount, startDate`). |
| `POST /gamiyas` | يقبل الآن `category` و`pledge: {typedName, textSha256}` (مطلوب: `PLEDGE_REQUIRED` / `PLEDGE_OUTDATED` / `SIGNATURE_MISMATCH`). |
| `GET /invitations/:code` | ملخص الجمعية ومنظّمها وإقرار حامل الدعوة قبل الانضمام. |
| `POST /invitations/:code/accept` | يقبل `pledge`؛ العضو المنسحب يستطيع العودة. |
| `GET /gamiyas/:id/pledge` | إقرار العضو على الشروط الحالية و`signedAt`. |
| `POST /gamiyas/:id/edit/preview` · `POST /gamiyas/:id/edit` | تعديل الاسم/النوع/القسط/العدد/الدورية/البدء (المنظم، قبل البدء والقرعة). التغيير المالي يتطلب `pledge` جديداً ويعيد الأعضاء إلى `PENDING_APPROVAL`. أخطاء: `BELOW_JOINED`, `LOTTERY_PREPARED`, `PROPOSAL_OPEN`, `ALREADY_STARTED`. |
| `POST /gamiyas/:id/reconfirm` | العضو يوقّع الشروط الجديدة (`NOTHING_TO_CONFIRM` إن لم يلزم). |
| `POST /gamiyas/:id/leave` · `POST /gamiyas/:id/members/:memberId/remove {reason}` | انسحاب قبل البدء / إزالة بسبب يراه الجميع. |
| `GET /me/pledges` | إقرارات المستخدم بكل إصدارات الشروط. |
| `GET/POST /me/goals` · `POST /me/goals/:id` · `POST /me/goals/:id/remove` | الأهداف وربطها بجمعية والتقدّم. |
| `POST /ai/circle-plan` | المخطط الذكي: `{targetAmount, neededBy?, people?, monthlyBudget?, frequency, category}` ← حتى 3 خطط. |
| `GET /gamiyas/:id/order` | يعيد الآن `cycleDates` لبطاقات «اختر دورك». |

## 0.12.0 — الدعوة المباشرة
| الطريقة والمسار | الوصف |
|---|---|
| `GET /gamiyas/:id/invite-suggestions` | من يشارك المنظم جمعيات أخرى وليس عضواً هنا (للمنظم). |
| `POST /gamiyas/:id/invitations/direct {phones[]}` | أرقام E.164 (حتى 30). يرد `{code, notified[], toShare[], skipped[], seatsLeft}`. |
| `GET /me/invitations` | دعواتي المعلّقة (لحسابي أو لرقمي قبل التسجيل). |
| `POST /me/invitations/:id/decline` | اعتذار، ويصل المنظم إشعار. |
