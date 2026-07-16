# 12 - Business Rules

## الشرح

هذا الملف يوثق القواعد التجارية (Business Rules) الحاكمة للوحدات الجديدة: عمولات الوكلاء، صيانة الحافلات، إعدادات الشركة، وسجل أحداث الرحلات. كل قاعدة موضحة بمخطط Mermaid أو جدول، وجميعها تُنفَّذ في NestJS داخل Transactions، مع قيود PostgreSQL كخط الدفاع النهائي.

---

## 1. سياسة إنشاء عمولة الوكيل

العمولة تُنشأ فقط عندما يتأكد الحجز، وبشكل Idempotent عبر القيد `UNIQUE (agent_membership_id, booking_id)`. لا تُحسب اعتمادًا على Webhook الدفع وحده.

```mermaid
flowchart TD
    START["Booking transitions to CONFIRMED<br/>(CASH confirm or payment webhook)"]
    Q1{"booked_by_user_id linked to<br/>an active AGENT membership?"}
    Q2{"Booking status = CONFIRMED<br/>(verified in DB, not from webhook alone)?"}
    Q3{"Commission row already exists for<br/>(agent_membership_id, booking_id)?"}
    CREATE["INSERT agent_commission_transactions<br/>rate from company_memberships.commission_rate<br/>base_amount = booking.total_amount<br/>commission_amount = base * rate / 100<br/>status = EARNED, earned_at = now()"]
    SKIP1["No commission - end"]
    SKIP2["Do nothing - wait for confirmation"]
    SKIP3["Idempotent skip<br/>(unique constraint guarantees this)"]

    START --> Q1
    Q1 -->|No| SKIP1
    Q1 -->|Yes| Q2
    Q2 -->|No| SKIP2
    Q2 -->|Yes| Q3
    Q3 -->|Yes| SKIP3
    Q3 -->|No| CREATE
```

---

## 2. سياسة إلغاء العمولة

عند إلغاء الحجز، مصير العمولة يعتمد على حالتها. السجل المالي **لا يُحذف أبدًا**.

```mermaid
flowchart TD
    START["Booking transitions to CANCELLED<br/>or PARTIALLY_CANCELLED"]
    Q1{"Commission exists<br/>for this booking?"}
    Q2{"Commission status?"}
    CANCEL["UPDATE commission -> CANCELLED<br/>cancelled_at = now()"]
    SETTLE["Commission stays PAID.<br/>Open a separate financial settlement<br/>(clawback / deduction from next payout).<br/>Record is NEVER deleted."]
    NONE["Nothing to do"]

    START --> Q1
    Q1 -->|No| NONE
    Q1 -->|Yes| Q2
    Q2 -->|"PENDING or EARNED"| CANCEL
    Q2 -->|"PAID"| SETTLE
    Q2 -->|"CANCELLED"| NONE
```

| حالة العمولة عند إلغاء الحجز | الإجراء |
|---|---|
| PENDING / EARNED | تتحول إلى CANCELLED |
| PAID | تبقى PAID + تسوية مالية منفصلة، لا حذف |
| CANCELLED | لا شيء (Idempotent) |

---

## 3. سياسة منع حجز حافلة في الصيانة

`trips` تستشير `vehicle-maintenance` قبل جدولة الرحلة. تحديث `buses.status` يتم من NestJS داخل نفس الـ Transaction — بدون Trigger معقد في الـ MVP.

```mermaid
flowchart TD
    START["Manager creates / updates a trip<br/>with bus_id"]
    Q1{"Active maintenance record exists?<br/>vehicle_maintenance_records WHERE bus_id = X<br/>AND status IN (SCHEDULED, IN_PROGRESS)<br/>overlapping the trip window"}
    REJECT["409 Conflict<br/>bus is IN_MAINTENANCE<br/>trip not created"]
    OK["Trip created<br/>trip_events: TRIP_CREATED"]
    SIDE["Side rule: opening a maintenance record<br/>sets buses.status = IN_MAINTENANCE,<br/>closing it (COMPLETED / CANCELLED) restores it -<br/>both inside the same NestJS transaction"]

    START --> Q1
    Q1 -->|Yes| REJECT
    Q1 -->|No| OK
    SIDE -.- Q1
```

---

## 4. سياسة مدة حجز المقعد حسب إعدادات الشركة

المدة تُقرأ من `company_settings.seat_hold_minutes` لحظة إنشاء الحجز وتُثبَّت في صف الحجز نفسه.

```mermaid
flowchart TD
    START["POST /bookings"]
    READ["SELECT seat_hold_minutes<br/>FROM company_settings<br/>WHERE company_id = trip.company_id"]
    Q1{"Settings row exists?"}
    DEFAULT["Use platform default = 10 minutes"]
    FREEZE["held_until = now() + seat_hold_minutes<br/>expires_at frozen on the booking row"]
    NOTE["Changing seat_hold_minutes later<br/>affects NEW bookings only -<br/>existing held_until values never change"]

    START --> READ
    READ --> Q1
    Q1 -->|No| DEFAULT
    Q1 -->|Yes| FREEZE
    DEFAULT --> FREEZE
    FREEZE -.- NOTE
```

---

## 5. سياسة عدم قابلية trip_events للتعديل

`trip_events` هو Append-only Event Log: الكتابة `INSERT` فقط.

| القاعدة | التنفيذ |
|---|---|
| لا UPDATE ولا DELETE على الأحداث | لا يوفر NestJS أي Endpoint للتعديل أو الحذف؛ ويمكن سحب صلاحيتي UPDATE/DELETE من دور قاعدة البيانات على هذا الجدول |
| تصحيح حدث خاطئ | يُسجَّل حدث جديد معاكس أو تصحيحي (مثل `DELAYED` ثم `DEPARTED`) مع `metadata` توضيحية |
| الترتيب الزمني | يُقرأ عبر الفهرس `(trip_id, event_time DESC)` |
| ليس Event Store خارجيًا | جدول PostgreSQL عادي — ليس Kafka ولا نظام رسائل في الـ MVP |

```mermaid
flowchart LR
    W["trips module"] -->|"INSERT only"| T[("trip_events<br/>append-only table")]
    A["Admin / Manager dashboards"] -->|"SELECT only<br/>(timeline, monitoring)"| T
    N["notifications module"] -.->|"listens: DELAYED, CANCELLED"| T
    X["UPDATE / DELETE"] -. "forbidden" .-> T
```

---

## 6. سياسة عدم التأثير الرجعي لتعديلات company_settings

```mermaid
flowchart TD
    CHANGE["Manager updates company_settings<br/>(e.g. seat_hold_minutes 10 -> 15,<br/>new cancellation_policy)"]
    OLD["Existing bookings / trips:<br/>keep their frozen held_until, expires_at,<br/>boarding_closes_at and the policy snapshot<br/>they were created with - NO retroactive change"]
    NEW["New bookings / trips created after the change:<br/>read the NEW settings values"]

    CHANGE --> OLD
    CHANGE --> NEW
```

| اللحظة | القيمة المستخدمة |
|---|---|
| إنشاء الحجز | `seat_hold_minutes` و`cancellation_policy` الحاليتان تُقرآن وتُثبَّتان في صف الحجز |
| إنشاء الرحلة | `boarding_close_minutes` الحالية تُستخدم لحساب `boarding_closes_at` وتُثبَّت في صف الرحلة |
| تعديل الإعدادات لاحقًا | يسري على السجلات الجديدة فقط؛ الحجوزات المؤكدة والرحلات القائمة لا تتغير بأثر رجعي |


## 7. سياسة الأسعار التاريخية

- `routes.default_price_mru` هو السعر الافتراضي الحالي فقط.
- كل تغيير يسجل في `route_price_history`.
- عند إنشاء `trip` ينسخ السعر إلى `trips.price_mru`.
- عند إنشاء الحجز تنسخ المبالغ النهائية إلى `bookings`; لا يؤثر أي تعديل لاحق بأثر رجعي.

## 8. سياسة التتبع والحذف

- كل عملية حساسة تحمل `request_id` و`correlation_id`.
- لا حذف فعلي للحجوزات والمدفوعات والتذاكر والعمولات والأحداث والتدقيق.
- الجداول المرجعية تُعطّل بـ`is_active` أو `deleted_at`.
