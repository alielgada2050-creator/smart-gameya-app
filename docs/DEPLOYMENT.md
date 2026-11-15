# النشر: GitHub ← الخادم ← قاعدة البيانات ← الدخول بحساب Google

هذا الدليل يأخذ المشروع من جهازك إلى موقع حقيقي يدخله الأهل والأصدقاء بحسابات Google، بلا حسابات تجريبية ولا بيانات افتراضية.

> النسخة المنشورة لا تحتوي أي مفتاح سري: كل المفاتيح في متغيرات بيئة على الخادم فقط (`.env` مستبعد من git).

## ما الذي يعمل في الإنتاج

| البند | الحال |
|---|---|
| الدخول | **حساب Google فقط** (مجاني). الدخول برمز الجوال يحتاج مزوّد رسائل SMS مدفوعاً لم يُربط بعد، فيبقى مغلقاً تلقائياً خارج بيئة التطوير. |
| البيانات | قاعدة PostgreSQL 16 فارغة: لا مستخدمين ولا جمعيات مزروعة. أول من يدخل ينشئ جمعيته ويدعو أهله. |
| المشرف | بريد Google في `PLATFORM_ADMIN_EMAILS` يصبح مراجع المنصة عند أول دخول، ويرى «حصر المنصة» (عدد المستخدمين والجمعيات والأعضاء). |
| الذكاء الاصطناعي | مفتاح Gemini المجاني من Google AI Studio (اختياري). بدونه يعمل المستشار بقالب ثابت. |
| النسخة التجريبية | تُبنى فقط بـ `vite build --mode demo` ولا تدخل في الصورة المنشورة (فُحصت الحزمة: لا أسماء ولا رموز تجريبية). |

## 1) رفع المشروع إلى GitHub

```bash
# على جهازك، داخل مجلد المشروع (المستودع مهيّأ ومحفوظ تاريخه)
gh repo create smart-gameya --private --source=. --remote=origin   # أو أنشئه من github.com/new ثم:
# git remote add origin https://github.com/<حسابك>/smart-gameya.git
git branch -M main
git push -u origin main
```

بعد الرفع يعمل تلقائياً:
- `.github/workflows/ci.yml`: اختبارات النواة والذكاء، فحص التباين، بناء الواجهة، واختبارات API كاملة على PostgreSQL 16 حقيقية.
- `.github/workflows/docker.yml`: عند وسم إصدار (`git tag v0.13.0 && git push --tags`) تُبنى صورة Docker وتُنشر في `ghcr.io/<حسابك>/smart-gameya`.
- `.github/workflows/mobile.yml`: بناء تطبيقي أندرويد و iOS.

## 2) معرّف Google للدخول (مجاني)

1. افتح [Google Cloud Console](https://console.cloud.google.com/) وأنشئ مشروعاً.
2. **APIs & Services → OAuth consent screen**: نوع External، اسم التطبيق، بريد الدعم. النطاقات الافتراضية تكفي (`openid`, `email`, `profile`).
3. أثناء الاختبار أضف بريد كل قريب أو صديق في **Test users**، أو انشر الشاشة (Publish app) ليدخل أي حساب.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
5. في **Authorized JavaScript origins** أضف عنوان موقعك بالضبط، مثل `https://jamiyati.example.com` (و`http://localhost:3000` للتجربة المحلية).
6. انسخ **Client ID** (ينتهي بـ `.apps.googleusercontent.com`) إلى `GOOGLE_CLIENT_ID`. لا حاجة إلى Client secret: الخادم يتحقق من توقيع الرمز بمفاتيح Google العامة.

## 3) مفتاح Gemini المجاني (اختياري)

1. من [Google AI Studio](https://aistudio.google.com/apikey) أنشئ مفتاحاً.
2. ضعه في `GEMINI_API_KEY` واجعل `AI_PROVIDERS=gemini` (أو `gemini,groq` لمزوّد احتياطي).
3. النموذج الافتراضي `gemini-flash-latest`؛ ثبّت نموذجاً محدداً بـ `AI_MODEL_GEMINI` إن أردت.
4. تنبيه: محتوى الطبقة المجانية قد تستخدمه Google لتحسين خدماتها. التطبيق يرسل أرقام الجمعية المجمّعة ونص السؤال فقط، ولا يرسل أسماء أو جوالات أو حسابات بنكية.

## 4) الأسرار (`.env` على الخادم)

```bash
cp .env.example .env
openssl rand -hex 32   # كرّرها لكل من: JWT_SECRET، OTP_PEPPER، LOTTERY_SEED_KEY، PAYOUT_ENCRYPTION_KEY، POSTGRES_PASSWORD
```

الحد الأدنى للإنتاج:

```
NODE_ENV=production
POSTGRES_PASSWORD=...
JWT_SECRET=...            # 64 حرفاً
OTP_PEPPER=...
LOTTERY_SEED_KEY=...      # 64 hex
PAYOUT_ENCRYPTION_KEY=... # 64 hex
UPLOAD_DIR=/app/uploads
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
PLATFORM_ADMIN_EMAILS=you@gmail.com
AI_PROVIDERS=gemini
GEMINI_API_KEY=...
DEV_EXPOSE_OTP=false
```

احفظ `LOTTERY_SEED_KEY` و`PAYOUT_ENCRYPTION_KEY` في مكان آمن: فقدانهما يمنع كشف بذور القرعة وفك أرقام الحسابات المحفوظة.

## 5) التشغيل على خادم (Docker)

على أي خادم Linux فيه Docker (VPS، أو خادم الشركة):

```bash
git clone https://github.com/<حسابك>/smart-gameya.git && cd smart-gameya
cp .env.example .env && nano .env        # الأسرار أعلاه
docker compose up -d --build
curl http://localhost:3000/api/v1/health  # {"status":"ok",...}
```

- `docker-compose.yml` يشغّل PostgreSQL 16 (بيانات دائمة في حجم `pgdata`) والتطبيق.
- عند كل تشغيل يطبّق `scripts/migrate.mjs` ملفات `infrastructure/database/migrations/*.sql` الجديدة فقط، مرة واحدة، ويسجّلها في `schema_migrations` (بقفل يمنع التطبيق المزدوج).
- ضع أمامه وكيلاً عكسياً بشهادة HTTPS (Caddy أو Nginx) على النطاق نفسه المسجّل في Google. مثال Caddy:

```
jamiyati.example.com {
  reverse_proxy localhost:3000
}
```

- الإيصالات والسندات المرفوعة محفوظة في حجم `uploads` الدائم، والتطبيق لا يُفتح إلا على `127.0.0.1` ليمر عبر الوكيل.

## 6) قاعدة بيانات مُدارة بدل الحاوية (اختياري)

أي PostgreSQL 16 مُدار يعمل (Supabase أو Neon أو RDS…): احذف خدمة `db` من `docker-compose.yml` وضع `DATABASE_URL` في `.env`، و`PGSSL=require` إن طلب المزوّد SSL. لتطبيق الترحيلات يدوياً:

```bash
DATABASE_URL=postgresql://... node scripts/migrate.mjs
```

خطط المزوّدين المجانية تتغيّر؛ راجع الحدود الحالية في صفحة المزوّد قبل الاعتماد عليها.

## 7) النسخ الاحتياطي

```bash
docker compose exec db pg_dump -U sg -Fc sg > backup-$(date +%F).dump        # نسخة
docker compose exec -T db pg_restore -U sg -d sg --clean < backup-YYYY-MM-DD.dump   # استعادة
```

جدولها يومياً (cron) واحفظ النسخ خارج الخادم.

## 8) قائمة فحص قبل دعوة الأهل

- [ ] `curl https://<نطاقك>/api/v1/health` يرد `ok`.
- [ ] زر «المتابعة باستخدام Google» يظهر في صفحة الدخول، والدخول ينجح من حساب غير حسابك.
- [ ] حساب المشرف يرى «حصر المنصة» في صفحة الإدارة.
- [ ] `DEV_EXPOSE_OTP=false` و`NODE_ENV=production` (الخادم يرفض الجمع بينهما مفعّلين).
- [ ] نسخة احتياطية أولى محفوظة.

## حدود معروفة

- تطبيقا أندرويد و iOS يعتمدان على الدخول برمز الجوال، لأن Google تمنع الدخول داخل عارض الويب المضمّن. إلى أن يُربط مزوّد SMS أو إضافة Google الأصلية، يدخل الأعضاء من المتصفح (الموقع قابل للتثبيت كتطبيق PWA على الجوال).
- الدخول برمز الجوال يحتاج مزوّد رسائل (مدفوع، مثل Unifonic أو Twilio Verify)، ولم يُربط.
- النموذج A: المنصة لا تستلم أموالاً ولا تحوّلها. أي تحصيل أو تحويل عبر مزوّد مدفوعات يحتاج دراسة ترخيص (ساما) قبل التنفيذ: `docs/COMPLIANCE_ASSESSMENT.md`.
