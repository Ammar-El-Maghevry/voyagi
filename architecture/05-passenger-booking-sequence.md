# 05 - Passenger Booking Sequence Diagram

## الشرح

تسلسل عملية الحجز الكاملة من تطبيق المسافر (Flutter): البحث، حجز المقعد بحالة HELD داخل Transaction محمية بالـ Partial Unique Index، ثم الدفع عبر مزود خارجي وتأكيد الحجز وإصدار التذكرة عبر Webhook.

ملاحظتان في هذه النسخة:

- مدة حجز المقعد **ليست Hardcoded**؛ يقرأ NestJS قيمة `company_settings.seat_hold_minutes` (وكذلك `boarding_close_minutes` عند التحقق من إغلاق الحجز) ويثبّتها في `held_until` و`expires_at` لحظة إنشاء الحجز.
- بعد نجاح الدفع، إذا كان `booked_by_user_id` مرتبطًا بعضوية `AGENT`، يُطلق النظام حدث `CommissionEligible` وتنشئ وحدة agent-commissions سجل العمولة بشكل Idempotent. هذا المسار لا ينطبق غالبًا على المسافر المباشر، لكنه يدعم الحجوزات التي **يبدأها وكيل ثم يكمل العميل دفعها إلكترونيًا**.

الحالات البديلة المغطاة:

1. المقعد محجوز مسبقًا → رد 409 Conflict.
2. الضغط المزدوج على زر الحجز → نفس الحجز يُعاد عبر Idempotency Key.
3. Webhook مكرر → معالجة Idempotent بلا تغيير.
4. فشل الدفع → تحديث الحالة والسماح بإعادة المحاولة ما دام الحجز ساريًا.
5. انتهاء المهلة قبل الدفع → تحرير المقعد وانتهاء الحجز.

```mermaid
sequenceDiagram
    autonumber
    actor U as Passenger
    participant F as Flutter App
    participant N as NestJS API
    participant DB as PostgreSQL (Supabase)
    participant P as Payment Provider (Bankily / Masrvi)

    U->>F: Search trip (origin, destination, date)
    F->>N: GET /trips/search
    N->>DB: SELECT open trips + seat availability
    DB-->>N: Trips list
    N-->>F: 200 OK - trips
    F-->>U: Show trips and seat map

    U->>F: Select trip, seat and passenger info
    F->>N: POST /bookings (Idempotency-Key header)

    alt Duplicate request (double click on book button)
        N->>DB: SELECT booking WHERE idempotency_key = key
        DB-->>N: Existing booking found
        N-->>F: 200 OK - same booking returned (no duplicate)
    else New request
        N->>DB: BEGIN TRANSACTION
        N->>DB: SELECT seat_hold_minutes, boarding_close_minutes<br/>FROM company_settings WHERE company_id = trip.company_id
        N->>DB: Verify trip status = OPEN and now() < boarding_closes_at<br/>(boarding_closes_at derived from boarding_close_minutes at trip creation)
        N->>DB: INSERT seat_reservations (status = HELD)
        Note over DB: Partial unique index on (trip_id, seat_number)<br/>WHERE status IN (HELD, CONFIRMED, CHECKED_IN)

        alt Seat already taken (unique violation)
            DB-->>N: Unique constraint violation
            N->>DB: ROLLBACK
            N-->>F: 409 Conflict - seat unavailable
            F-->>U: Seat taken, please choose another seat
        else Seat available
            N->>DB: INSERT booking (status = HELD) + passengers
            N->>DB: SET held_until = now() + seat_hold_minutes,<br/>expires_at (values frozen on the booking row)
            N->>DB: COMMIT
            N-->>F: 201 Created - booking HELD<br/>(expires in configured seat_hold_minutes)
            F-->>U: Show payment methods with countdown
        end
    end

    U->>F: Choose payment method (e.g. Bankily)
    F->>N: POST /bookings/:id/payments
    N->>DB: INSERT payment (status = PENDING, internal_reference)
    N->>DB: UPDATE booking -> PENDING_PAYMENT
    N->>P: Initiate payment request
    N->>DB: UPDATE payment -> PROCESSING
    P-->>U: Payment prompt on passenger phone
    U->>P: Approve payment

    P->>N: Webhook - payment result (signed)
    N->>N: Verify webhook signature + match internal_reference

    alt Duplicate webhook (already processed)
        N->>DB: SELECT payment - status already SUCCEEDED
        N-->>P: 200 OK - idempotent, no state change
    else Payment succeeded
        N->>DB: UPDATE payment -> SUCCEEDED (paid_at, provider_reference)
        N->>DB: UPDATE booking -> CONFIRMED
        N->>DB: UPDATE seat_reservations -> CONFIRMED
        N->>DB: INSERT ticket (ticket_number, qr_token_hash)

        opt booked_by_user_id linked to an AGENT membership
            N->>N: Emit CommissionEligible event
            N->>DB: agent-commissions module:<br/>INSERT agent_commission_transactions (status = EARNED)<br/>ON CONFLICT (agent_membership_id, booking_id) DO NOTHING
            Note over N,DB: Idempotent - duplicate events cannot<br/>create a second commission row.<br/>Applies to agent-initiated bookings<br/>paid online by the customer.
        end

        N-->>P: 200 OK
        N-->>F: Push / Realtime - booking confirmed
        F-->>U: Show e-ticket with QR code
    else Payment failed or rejected
        N->>DB: UPDATE payment -> FAILED
        N-->>P: 200 OK
        N-->>F: Payment failed - retry allowed while hold is active
        F-->>U: Offer retry or another payment method
    end

    opt Payment not received before held_until expires
        Note over N,DB: Scheduled job (future: BullMQ worker)
        N->>DB: UPDATE seat_reservations HELD -> RELEASED
        N->>DB: UPDATE booking -> EXPIRED
        N-->>F: Realtime - seat released, booking expired
    end
```


## ملاحظات نهائية على الاتساق

- يحمل طلب الحجز `Idempotency-Key` و`X-Correlation-Id`.
- سعر الرحلة المنسوخ إلى الحجز هو Snapshot ولا يتغير عند تعديل السعر الافتراضي للمسار لاحقًا.
- إعدادات الشركة تُقرأ قبل إنشاء الحجز، ثم تُثبت النتائج (`held_until`, الرسوم، العملة) في الحجز نفسه.
