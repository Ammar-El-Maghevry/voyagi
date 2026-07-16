# Voyagi Architecture — Final Reviewed Version

هذه الحزمة هي النسخة النهائية المجمدة معماريًا قبل كتابة الـSQL Migrations والكود.

أهم القرارات النهائية:

- Monolithic NestJS application في الـMVP، دون Microservices.
- PostgreSQL هو مصدر الحقيقة والقيود هي خط الدفاع النهائي.
- فصل Booking / Seat Reservation / Payment / Ticket / Commission.
- ENUMs صريحة للحالات الثابتة.
- إعدادات شركة موسعة مع Feature Flags محدودة.
- أسعار تاريخية وSnapshots للحجوزات.
- Append-only للأحداث والسجلات المالية.
- request_id وcorrelation_id للتتبع.
- Soft delete للجداول المرجعية فقط.

الخطوة التالية: تحويل `04-database-erd.md` و`12-business-rules.md` إلى Supabase SQL migrations.
