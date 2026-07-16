# 11 - Monorepo Structure Diagram

## الشرح

هيكل الـ Monorepo على GitHub. التطبيقات الثلاثة تعيش في `apps/`، والكود المشترك في `packages/` (أهمها `shared-types` الذي يضمن توحيد الأنواع والـ Enums مثل حالات الحجز والدفع بين Backend وDashboard وMobile)، وكل ما يخص قاعدة البيانات (Migrations) في `supabase/`، والتوثيق في `docs/`.

البنية الأساسية لم تتغير؛ أُضيف فقط توضيح لمجلد `src/modules/` داخل `apps/backend` (ويشمل الوحدات الجديدة company-settings وagent-commissions وvehicle-maintenance وtrip-events)، وأربعة ملفات توثيق جديدة داخل `docs/architecture/`.

```mermaid
flowchart TD
    ROOT["voyagi/<br/>monorepo root"]

    APPS["apps/<br/>deployable applications"]
    BACKEND["backend/<br/>NestJS API - all booking & payment logic"]
    DASH["dashboard/<br/>Next.js - company / agent / admin panels"]
    MOBILE["mobile/<br/>Flutter passenger app"]

    PKGS["packages/<br/>shared internal packages"]
    TYPES["shared-types/<br/>TypeScript types, enums, DTOs<br/>(booking / payment / seat statuses)"]
    APICL["api-client/<br/>typed HTTP client for the NestJS API<br/>used by dashboard"]
    CONF["config/<br/>shared ESLint, TSConfig, Prettier"]

    SUPA["supabase/<br/>database as code"]
    MIG["migrations/<br/>versioned SQL migrations<br/>(tables, indexes, constraints)"]
    SEED["seed.sql<br/>seed data: cities, stations, demo company"]
    TOML["config.toml<br/>local Supabase CLI configuration"]

    MODS["src/modules/<br/>auth, bookings, payments, trips...<br/>+ company-settings/<br/>+ agent-commissions/<br/>+ vehicle-maintenance/<br/>+ trip-events/"]

    DOCS["docs/<br/>project documentation"]
    ARCH["architecture/<br/>architecture decisions & overviews"]
    DIAG["diagrams/<br/>these Mermaid diagram files"]
    BRULES["business-rules.md<br/>commission, maintenance,<br/>settings rules"]
    STRANS["state-transitions.md<br/>booking / payment / seat states"]
    CPOLICY["commission-policy.md<br/>when commissions are earned,<br/>paid or cancelled"]
    XPOLICY["cancellation-policy.md<br/>per-company cancellation rules"]
    APIDOC["api/<br/>REST API reference / OpenAPI"]

    DC["docker-compose.yml<br/>local dev services (Postgres, Redis)"]
    ENV[".env.example<br/>environment variables template"]
    RM["README.md<br/>setup & contribution guide"]

    ROOT --> APPS
    APPS --> BACKEND
    BACKEND --> MODS
    APPS --> DASH
    APPS --> MOBILE

    ROOT --> PKGS
    PKGS --> TYPES
    PKGS --> APICL
    PKGS --> CONF

    ROOT --> SUPA
    SUPA --> MIG
    SUPA --> SEED
    SUPA --> TOML

    ROOT --> DOCS
    DOCS --> ARCH
    ARCH --> DIAG
    ARCH --> BRULES
    ARCH --> STRANS
    ARCH --> CPOLICY
    ARCH --> XPOLICY
    DOCS --> APIDOC

    ROOT --> DC
    ROOT --> ENV
    ROOT --> RM

    BACKEND -.->|"imports"| TYPES
    DASH -.->|"imports"| TYPES
    DASH -.->|"imports"| APICL
    APICL -.->|"imports"| TYPES
```


## إضافات التوثيق والكود المشترك

- `packages/shared-types`: جميع Enums والعقود المشتركة.
- `apps/backend/src/modules/pricing-history`: سجل تغير الأسعار.
- `apps/backend/src/common/observability`: request/correlation IDs وstructured logging.
- `docs/architecture/data-lifecycle.md`: سياسات الحذف الناعم والاحتفاظ بالسجلات.
