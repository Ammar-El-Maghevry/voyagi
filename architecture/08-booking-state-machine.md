# 08 - Booking State Diagram

## الشرح

آلة الحالة للحجز (`bookings.status`) مع توضيح الجهة المخوّلة بتنفيذ كل انتقال:

- **System**: انتقالات آلية ينفذها NestJS أو الـ Scheduler.
- **Passenger**: عبر تطبيق Flutter.
- **Staff**: موظف الفرع أو الوكيل أو مدير الشركة عبر اللوحة.
- **Admin**: أدمن منصة Voyagi (تدخل استثنائي).

ملاحظة: `DRAFT` اختيارية وتُستخدم فقط إذا سمحنا للعميل ببناء الحجز على مراحل قبل تثبيت المقاعد؛ المسار المباشر يبدأ من `HELD`.

آثار جانبية متعلقة بالعمولات:

- عند الانتقال إلى `CONFIRMED` لحجز بواسطة وكيل، يُنشأ صف في `agent_commission_transactions` (بشكل Idempotent).
- عند الانتقال إلى `CANCELLED`، تُلغى العمولة المرتبطة إذا لم تكن `PAID`.
- إذا كانت العمولة `PAID` بالفعل، فالإلغاء يتطلب **تسوية مالية منفصلة**، ولا يُحذف سجل العمولة أبدًا.

```mermaid
stateDiagram-v2
    [*] --> DRAFT : client starts multi-step booking<br/>(System - optional path)
    [*] --> HELD : booking created with seats held<br/>(System)

    DRAFT --> HELD : seats successfully held<br/>(System)
    DRAFT --> CANCELLED : abandoned draft<br/>(Passenger / System)

    HELD --> PENDING_PAYMENT : payment attempt initiated<br/>(Passenger / Staff)
    HELD --> CONFIRMED : CASH confirmed immediately<br/>(Staff)
    HELD --> EXPIRED : held_until passed without payment<br/>(System scheduler)
    HELD --> CANCELLED : cancelled before payment<br/>(Passenger / Staff)

    PENDING_PAYMENT --> CONFIRMED : payment SUCCEEDED via webhook<br/>(System) or manual confirm (Staff)
    PENDING_PAYMENT --> EXPIRED : expires_at passed, payment never arrived<br/>(System scheduler)
    PENDING_PAYMENT --> CANCELLED : cancelled while awaiting payment<br/>(Passenger / Staff)

    CONFIRMED --> PARTIALLY_CANCELLED : some passengers cancelled<br/>(Staff / Passenger per policy / Admin)
    CONFIRMED --> CANCELLED : full cancellation before departure<br/>(Staff / Admin / Passenger per policy)
    CONFIRMED --> COMPLETED : trip completed<br/>(System / Driver closes trip)

    PARTIALLY_CANCELLED --> COMPLETED : trip completed for remaining passengers<br/>(System / Driver)
    PARTIALLY_CANCELLED --> CANCELLED : remaining passengers also cancelled<br/>(Staff / Admin)

    EXPIRED --> [*]
    CANCELLED --> [*]
    COMPLETED --> [*]

    note right of CONFIRMED
        Agent bookings: entering CONFIRMED
        creates an agent_commission_transactions
        row (status = EARNED) - idempotent via
        UNIQUE (agent_membership_id, booking_id).
    end note

    note right of CANCELLED
        Related commission (if any):
        - not PAID yet -> commission -> CANCELLED
        - already PAID -> separate financial
          settlement; the commission record
          is NEVER deleted.
    end note
```


## قاعدة نهائية لدورة الحياة

لا تُعاد الحجوزات من حالة نهائية إلى حالة سابقة. أي تصحيح مالي بعد `COMPLETED` أو بعد دفع عمولة ينفذ كسجل تسوية جديد، مع المحافظة على الحجز الأصلي وسجل التدقيق.
