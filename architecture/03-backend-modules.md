# 03 - Backend Modules Diagram (NestJS)

## الشرح

مخطط وحدات NestJS واعتمادياتها. السهم `A --> B` يعني أن الوحدة A **تعتمد على** الوحدة B (تستورد خدماتها).

الوحدات مقسمة إلى طبقات منطقية:

- **Core**: auth, profiles.
- **Organization**: companies, company-settings, company-memberships, branches, staff-members.
- **Catalog**: cities, stations, seat-layouts, buses, routes.
- **Operations**: trips, trip-events, bookings, passengers, seat-reservations, payments, tickets, agent-commissions, vehicle-maintenance.
- **Cross-cutting**: notifications, audit-logs, reports, admin.

`audit-logs` و`notifications` وحدتان مستعرضتان (Cross-cutting) تستدعيهما وحدات العمليات عند الحاجة.

الوحدات المضافة في هذه النسخة:

- **company-settings**: تعتمد على companies، وتقرأ منها bookings مدة حجز المقعد وسياسة الإلغاء.
- **agent-commissions**: وحدة **مستقلة** (وليست جزءًا من payments)؛ تعتمد على bookings وcompany-memberships وcompanies، وتستقبل حدث `CommissionEligible` من payments بعد نجاح الدفع لحجز بواسطة وكيل.
- **vehicle-maintenance**: تعتمد على buses وcompanies وprofiles، وتستشيرها trips للتحقق من أن الحافلة ليست في صيانة فعالة قبل جدولة رحلة.
- **trip-events**: سجل أحداث الرحلات؛ تكتب فيها trips الأحداث (إنشاء، انطلاق، وصول، إلغاء...) عبر أسهم متقطعة (Events) لتجنب الاعتماد الدائري، ويمكن لـ notifications الاستماع إليها لإرسال تنبيهات التأخير والإلغاء.

```mermaid
flowchart LR
    subgraph Core["Core"]
        AUTH["auth"]
        PROFILES["profiles"]
    end

    subgraph Organization["Organization"]
        COMPANIES["companies"]
        COMPSET["company-settings"]
        MEMBERSHIPS["company-memberships"]
        BRANCHES["branches"]
        STAFF["staff-members"]
    end

    subgraph Catalog["Catalog"]
        CITIES["cities"]
        STATIONS["stations"]
        LAYOUTS["seat-layouts"]
        BUSES["buses"]
        ROUTES["routes"]
    end

    subgraph Operations["Operations"]
        TRIPS["trips"]
        TRIPEV["trip-events"]
        BOOKINGS["bookings"]
        PASSENGERS["passengers"]
        SEATS["seat-reservations"]
        PAYMENTS["payments"]
        TICKETS["tickets"]
        AGCOMM["agent-commissions"]
        VMAINT["vehicle-maintenance"]
    end

    subgraph CrossCutting["Cross-cutting"]
        NOTIF["notifications"]
        AUDIT["audit-logs"]
        REPORTS["reports"]
        ADMIN["admin"]
    end

    PROFILES --> AUTH
    COMPSET --> COMPANIES
    MEMBERSHIPS --> PROFILES
    MEMBERSHIPS --> COMPANIES
    MEMBERSHIPS --> BRANCHES
    BRANCHES --> COMPANIES
    BRANCHES --> CITIES
    STAFF --> COMPANIES
    STATIONS --> CITIES
    BUSES --> COMPANIES
    BUSES --> LAYOUTS
    ROUTES --> COMPANIES
    ROUTES --> STATIONS

    TRIPS --> ROUTES
    TRIPS --> BUSES
    TRIPS --> STAFF
    TRIPS --> COMPANIES
    TRIPS -->|"checks bus not in<br/>active maintenance"| VMAINT
    TRIPS -.->|"writes events: created,<br/>departed, arrived, cancelled"| TRIPEV

    TRIPEV --> PROFILES
    TRIPEV --> COMPANIES

    BOOKINGS --> TRIPS
    BOOKINGS --> PASSENGERS
    BOOKINGS --> SEATS
    BOOKINGS --> MEMBERSHIPS
    BOOKINGS -->|"reads seat_hold_minutes,<br/>cancellation_policy"| COMPSET

    PASSENGERS --> STATIONS
    SEATS --> TRIPS

    PAYMENTS --> BOOKINGS
    PAYMENTS -.->|"emits CommissionEligible<br/>on SUCCEEDED (agent bookings)"| AGCOMM

    AGCOMM --> BOOKINGS
    AGCOMM --> MEMBERSHIPS
    AGCOMM --> COMPANIES

    VMAINT --> BUSES
    VMAINT --> COMPANIES
    VMAINT --> PROFILES

    TICKETS --> BOOKINGS
    TICKETS --> PASSENGERS
    TICKETS --> SEATS

    BOOKINGS -.->|"emits events"| NOTIF
    PAYMENTS -.->|"emits events"| NOTIF
    TICKETS -.->|"emits events"| NOTIF
    TRIPEV -.->|"delay / cancellation alerts"| NOTIF

    BOOKINGS -.->|"writes"| AUDIT
    PAYMENTS -.->|"writes"| AUDIT
    TRIPS -.->|"writes"| AUDIT
    ADMIN -.->|"writes"| AUDIT

    REPORTS --> BOOKINGS
    REPORTS --> PAYMENTS
    REPORTS --> TRIPS
    REPORTS --> AGCOMM

    AGCOMM -.->|"writes"| AUDIT
    VMAINT -.->|"writes"| AUDIT

    ADMIN --> COMPANIES
    ADMIN --> REPORTS
```


## وحدات داعمة نهائية

- `pricing-history`: يسجل تغييرات السعر الافتراضي للمسار دون تعديل أسعار الرحلات أو الحجوزات السابقة.
- `observability`: Middleware/Interceptor يولد `request_id` و`correlation_id` ويربطهما بـ`audit-logs`.
- جميع الحالات والأنواع المشتركة تُصدر من `packages/shared-types`، وتبقى قاعدة البيانات المرجع النهائي للقيود.
