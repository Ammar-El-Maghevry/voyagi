# 01 - System Context Diagram

## الشرح

مخطط السياق العام لنظام Voyagi. يوضح جميع الأطراف البشرية (المسافر، مدير الشركة، موظف الفرع، الوكيل، السائق/موظف الصعود، الأدمن المركزي) والأنظمة الخارجية (Bankily، Masrvi، مزود SMS/WhatsApp، Supabase) وكيفية تفاعل كل طرف مع نظام Voyagi. شركة النقل ممثلة ككيان تنظيمي يتعامل مع النظام عبر مديرها وموظفيها ووكلائها.

لم يُضف أي Actor جديد في هذه النسخة؛ فقط توسّع وصف تفاعل **Company Manager** (إدارة سياسات الإلغاء، إعداد مدة حجز المقعد، متابعة صيانة الحافلات، مراجعة عمولات الوكلاء) ووصف **Super Admin** (مراقبة سجلات أحداث الرحلات، مراجعة نزاعات العمولات).

```mermaid
flowchart TB
    subgraph HumanActors["Human Actors"]
        PAX["Passenger"]
        MGR["Company Manager"]
        EMP["Branch Employee"]
        AGT["Agent"]
        DRV["Driver / Boarding Employee"]
        ADMIN["Voyagi Super Admin"]
    end

    TC["Transport Company<br/>(Organization)"]

    SYSTEM(("Voyagi System<br/>Booking & Ticketing Platform"))

    subgraph ExternalSystems["External Systems"]
        BANKILY["Bankily<br/>Payment Provider"]
        MASRVI["Masrvi<br/>Payment Provider"]
        MSG["SMS / WhatsApp Provider"]
        SUPA["Supabase<br/>Auth / PostgreSQL / Storage / Realtime"]
    end

    PAX -->|"Searches trips, books seats,<br/>pays online, receives e-ticket"| SYSTEM
    EMP -->|"Books tickets for cash-paying passengers,<br/>confirms CASH payments, checks in passengers"| SYSTEM
    AGT -->|"Sells tickets to passengers,<br/>earns commission per sale"| SYSTEM
    MGR -->|"Manages trips, buses, routes, branches, staff,<br/>configures cancellation policies and seat hold duration,<br/>tracks vehicle maintenance,<br/>reviews agent commissions and reports"| SYSTEM
    DRV -->|"Scans QR codes, boards passengers,<br/>closes boarding"| SYSTEM
    ADMIN -->|"Activates / suspends companies,<br/>monitors operations and trip event logs,<br/>reviews commission disputes, platform settings"| SYSTEM

    TC -.->|"Represented in the system by<br/>manager, employees and agents"| MGR
    TC -.-> EMP
    TC -.-> AGT
    TC -.-> DRV

    SYSTEM -->|"Initiates payment requests"| BANKILY
    SYSTEM -->|"Initiates payment requests"| MASRVI
    BANKILY -->|"Webhook: confirms or rejects transaction"| SYSTEM
    MASRVI -->|"Webhook: confirms or rejects transaction"| SYSTEM
    SYSTEM -->|"Sends tickets, OTP codes,<br/>booking notifications"| MSG
    SYSTEM <-->|"Authentication, data persistence,<br/>file storage, realtime updates"| SUPA
```


## قرارات نهائية

- مدير الشركة يدير سياسات الإلغاء، مدة حجز المقعد، قنوات الإشعارات، Feature Flags، الصيانة وعمولات الوكلاء.
- لا يسمح أي Actor بحذف السجل المالي؛ الإلغاء والتسوية يتمان عبر حالات موثقة وAudit Log.
