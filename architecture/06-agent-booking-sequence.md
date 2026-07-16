# 06 - Agent / Branch Employee Booking Sequence Diagram

## الشرح

تسلسل حجز تذكرة من موظف فرع أو وكيل عبر لوحة Next.js، لمسافر يدفع نقدًا (CASH). يتحقق NestJS من صلاحيات الموظف عبر `company_memberships` (الشركة والفرع والدور)، ثم ينشئ الحجز ويؤكد الدفع النقدي فورًا ويصدر التذكرة ويسجل العملية في `audit_logs`.

إذا كان المستخدم وكيلًا (Agent):

1. يجلب NestJS قيمة `commission_rate` من `company_memberships`.
2. ينشئ صفًا في **`agent_commission_transactions`** بحالة `EARNED` لأن الحجز مؤكد.
3. `audit_logs` يسجل الحدث فقط؛ **السجل المالي الحقيقي هو صف `agent_commission_transactions`** وليس سطر التدقيق.
4. إذا أُلغي الحجز لاحقًا قبل دفع العمولة، تتحول العمولة إلى `CANCELLED` (انظر مخطط حالات الحجز).

```mermaid
sequenceDiagram
    autonumber
    actor E as Branch Employee / Agent
    participant D as Next.js Dashboard
    participant A as Supabase Auth
    participant N as NestJS API
    participant DB as PostgreSQL (Supabase)

    E->>D: Login (phone / email + password)
    D->>A: Sign-in request
    A-->>D: JWT (access + refresh tokens)

    E->>D: Search trip (route, date)
    D->>N: GET /trips/search (JWT)
    N->>A: Verify JWT
    N->>DB: SELECT company_memberships (user, company, branch, role, is_active)
    DB-->>N: Membership found and active
    N->>DB: SELECT trips of this company
    N-->>D: 200 OK - trips + seat map

    E->>D: Select seat, enter passenger name + phone, payment = CASH
    D->>N: POST /bookings (channel = BRANCH or AGENT, Idempotency-Key)
    N->>DB: Verify membership authorizes booking for this company / branch

    alt Not authorized for this company or branch
        N-->>D: 403 Forbidden
        D-->>E: Show permission error
    else Authorized
        N->>DB: BEGIN TRANSACTION
        N->>DB: INSERT seat_reservations (HELD) - partial unique index applies

        alt Seat already taken
            N->>DB: ROLLBACK
            N-->>D: 409 Conflict - seat unavailable
        else Seat available
            N->>DB: INSERT booking + passenger (booked_by_user_id = employee)
            N->>DB: INSERT payment (method = CASH, status = SUCCEEDED,<br/>confirmed_by_user_id = employee, paid_at = now())
            N->>DB: UPDATE booking -> CONFIRMED, seat_reservations -> CONFIRMED
            N->>DB: INSERT ticket (ticket_number, qr_token_hash)
            N->>DB: INSERT audit_logs (action = BOOKING_CREATED_CASH,<br/>actor_user_id, company_id, entity data)

            opt User role = AGENT
                N->>DB: SELECT commission_rate FROM company_memberships
                N->>DB: INSERT agent_commission_transactions<br/>(agent_membership_id, booking_id, company_id,<br/>commission_rate, base_amount = total_amount,<br/>commission_amount, status = EARNED, earned_at)
                Note over N,DB: UNIQUE (agent_membership_id, booking_id)<br/>makes this idempotent.<br/>audit_logs records the event, but the real<br/>financial record is this transaction row.<br/>If the booking is later cancelled before payout,<br/>status becomes CANCELLED.
            end

            N->>DB: COMMIT
            N-->>D: 201 Created - confirmed booking + ticket
            D-->>E: Print / share ticket with QR code
        end
    end
```


## ملاحظات نهائية على العمولة

- إنشاء العمولة Idempotent بالقيد `(agent_membership_id, booking_id)`.
- إذا أصبحت العمولة `PAID` ثم أُلغي الحجز، لا يُحذف السجل ولا يُعاد إلى `CANCELLED`؛ تنشأ تسوية مالية مستقلة ويُحفظ الأثر في Audit Log.
- كل العملية تشترك في `correlation_id` واحد.
