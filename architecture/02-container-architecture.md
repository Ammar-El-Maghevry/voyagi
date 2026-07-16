# 02 - Container Architecture Diagram

## الشرح

مخطط الحاويات (Containers) يوضح المكونات التقنية الرئيسية وبروتوكولات الاتصال بينها.

القاعدة المعمارية الأهم: تطبيق Flutter ولوحة Next.js **لا ينفذان منطق الحجز أو الدفع مباشرة على قاعدة البيانات**، بل يرسلان الطلبات إلى NestJS عبر HTTPS REST API مع JWT، وNestJS هو الوحيد الذي يفتح Transactions على PostgreSQL. استخدام Supabase من العملاء يقتصر على تسجيل الدخول (Auth) والاستماع للتحديثات (Realtime) وقراءة الملفات العامة (Storage).

داخل NestJS Backend API توجد المحركات الداخلية التالية (كلها Modules داخل نفس التطبيق):

- **Booking Engine**: الحجز والمقاعد والتذاكر.
- **Commission Engine**: عمولات الوكلاء (agent_commission_transactions).
- **Maintenance Module**: سجلات صيانة الحافلات.
- **Trip Event Log**: أحداث الرحلات كجدول Append-only في PostgreSQL.

قواعد المرحلة الأولى (MVP): **لا Microservices**، PostgreSQL هو **مصدر الحقيقة الوحيد**، وRedis وBullMQ إضافتان مستقبليتان للمهام الخلفية فقط — **ليسا مخزنًا للحالة الأساسية**.

```mermaid
flowchart TB
    subgraph Clients["Client Applications"]
        FLUTTER["Flutter Mobile App<br/>(Passengers)"]
        NEXT["Next.js Dashboard<br/>(Company / Agents / Admin)"]
    end

    subgraph AppLayer["Application Layer"]
        NEST["NestJS Backend API - TypeScript<br/>internal engines (same app, no microservices):<br/>Booking Engine - Commission Engine<br/>Maintenance Module - Trip Event Log"]
        REDIS["Redis Cache<br/>(future)"]
        BULL["BullMQ Worker<br/>(future: hold expiry, notifications)"]
    end

    subgraph SupabasePlatform["Supabase Platform"]
        AUTH["Supabase Auth<br/>(JWT issuer)"]
        PG[("PostgreSQL Database")]
        STORAGE["Supabase Storage<br/>(logos, documents)"]
        RT["Supabase Realtime"]
    end

    subgraph ExternalProviders["External Providers"]
        PAY["Payment Providers<br/>Bankily / Masrvi"]
        MSGP["SMS / WhatsApp Provider"]
    end

    FLUTTER -->|"HTTPS REST API + JWT<br/>(search, booking, payment requests)"| NEST
    NEXT -->|"HTTPS REST API + JWT<br/>(management, staff booking)"| NEST
    FLUTTER -->|"HTTPS: sign-in / token refresh"| AUTH
    NEXT -->|"HTTPS: sign-in / token refresh"| AUTH
    NEST -->|"Verifies JWT signature"| AUTH
    NEST -->|"PostgreSQL connection<br/>(transactions, partial unique index)"| PG
    NEST -->|"Signed URLs / server-side uploads"| STORAGE
    FLUTTER <-->|"WebSocket: seat map / booking updates"| RT
    NEXT <-->|"WebSocket: live sales dashboard"| RT
    RT ---|"Listens to DB changes"| PG
    NEST -->|"HTTPS: initiate payment"| PAY
    PAY -->|"Webhooks: payment status (signed)"| NEST
    NEST -->|"HTTPS API: tickets, OTP, notifications"| MSGP
    NEST <-->|"Cache reads / distributed locks (future)"| REDIS
    NEST -->|"Enqueue background jobs (future)"| BULL
    BULL -->|"Processes jobs: release expired holds"| PG

    RULE["Architecture rule:<br/>Clients NEVER write bookings / seats / payments<br/>directly to the database.<br/>All sensitive logic lives in NestJS."]
    RULE -.- FLUTTER
    RULE -.- NEXT

    MVP["MVP rules:<br/>single NestJS application - no microservices.<br/>PostgreSQL is the single source of truth.<br/>Redis / BullMQ are future background-task<br/>additions, never primary state storage.<br/>trip_events is an append-only PostgreSQL table."]
    MVP -.- NEST
```


## حدود المسؤولية النهائية

- PostgreSQL هو مصدر الحقيقة الوحيد للحجز والمقعد والدفع والعمولة.
- Redis/BullMQ لا يحتفظان بالحالة الأساسية؛ يستخدمان Cache والمهام القابلة لإعادة التنفيذ فقط.
- جميع عمليات NestJS تحمل `request_id` و`correlation_id` لتتبع الحجز والدفع والـWebhook.
- Feature Flags وإعدادات الشركة تُقرأ من `company_settings`، بينما القيم المؤثرة على حجز قائم تُحفظ Snapshot داخل الحجز.
