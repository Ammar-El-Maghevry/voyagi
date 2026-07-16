# 07 - Seat Reservation State Diagram

## الشرح

آلة الحالة لمقعد داخل رحلة معينة.

نقطة جوهرية: **AVAILABLE ليست قيمة مخزنة في العمود `status`**، بل هي حالة افتراضية (Virtual State) تعني عدم وجود صف نشط في `seat_reservations` لهذا المقعد في هذه الرحلة بحالة `HELD` أو `CONFIRMED` أو `CHECKED_IN`. الفهرس الفريد الجزئي على `(trip_id, seat_number)` هو ما يضمن أن مقعدًا واحدًا لا يملك أكثر من صف نشط واحد في أي لحظة.

الحالات لم تتغير في هذه النسخة؛ فقط أصبحت مدة الحجز المؤقت **ديناميكية** تُقرأ من `company_settings.seat_hold_minutes` بدل قيمة ثابتة (10 دقائق).

```mermaid
stateDiagram-v2
    [*] --> AVAILABLE

    note right of AVAILABLE
        Virtual state - not stored in DB.
        Means: no active seat_reservations row
        (HELD / CONFIRMED / CHECKED_IN)
        exists for this trip_id + seat_number.
    end note

    AVAILABLE --> HELD : booking created<br/>INSERT row, held_until = now() +<br/>company_settings.seat_hold_minutes

    HELD --> CONFIRMED : payment SUCCEEDED (webhook)<br/>or CASH confirmed by staff
    HELD --> RELEASED : held_until expired<br/>(system scheduler / worker)
    HELD --> CANCELLED : booking cancelled while on hold

    CONFIRMED --> CHECKED_IN : QR scanned at boarding<br/>(driver / boarding employee)
    CONFIRMED --> CANCELLED : booking cancelled / refunded

    RELEASED --> [*]
    CANCELLED --> [*]
    CHECKED_IN --> [*]

    note right of RELEASED
        RELEASED and CANCELLED rows stay in DB
        for history, but no longer block the
        partial unique index - the seat becomes
        AVAILABLE again automatically.
    end note
```


## قاعدة نهائية

الحالة الافتراضية `AVAILABLE` تُحسب من غياب صف نشط، ولا تُحفظ في قاعدة البيانات. تحرير المقعد يتم بتغيير حالة الصف إلى `RELEASED` أو `CANCELLED`، وليس بحذفه.
