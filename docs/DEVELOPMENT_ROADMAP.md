# DEVELOPMENT ROADMAP

| المرحلة | المحتوى | البوابة | الحالة |
|---|---|---|---|
| 0 Discovery | فحص البيئة، REA، المهارة | — | ✅ |
| 1 Requirements & Architecture | SRS، البنية، ERD، الامتثال، النواة المالية | **Gate A** | ✅ معتمد بالنموذج A |
| 2 Core Platform | NestJS: Auth OTP ✅، JWT ✅، حدود الطلبات ✅، التدقيق ✅ — متبقٍ: Refresh tokens، KYC ورفع المستندات، أدوار المنصة، لوحة الإدارة | Gate B | جزئي |
| 3 Gam'eya Engine | إنشاء ✅ دعوة ✅ اتفاقية ✅ قرعة موثقة ✅ جدولة ✅ تسوية بين الأعضاء ✅ — متبقٍ: الترتيب بالتفضيلات/الثابت/المختلط، الانسحاب والاستبدال | Gate B + C | معظمه منفّذ |
| 4 Financial Engine | **مؤجل بقرار ADR-001**؛ يُعاد تعريفه كتقارير وتسويات إقرارات | — | مؤجل |
| 5 AI | مساعد ادخار، مُحسّن الأدوار، مؤشرات مخاطر قابلة للتفسير | Gate B | |
| 6 Notifications | WhatsApp Business API، بريد، Push | Gate B | |
| 7 Cross-platform | Flutter + Next.js، RTL/LTR، داكن/فاتح | Gate B | |
| 8 Enterprise testing | أمن، حمل، E2E (السيناريوهات 1–10) | Gate D | |
| 9 Deployment | بنية إنتاج داخل المملكة، مراقبة، نسخ احتياطي | Gate E + اعتماد قانوني | |
