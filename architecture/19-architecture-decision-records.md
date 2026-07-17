# Voyagi Architecture Decision Records

**Status:** Accepted<br>
**Version:** 1.0<br>
**Applies to:** Voyagi platform<br>
**Purpose:** Define how architectural decisions are proposed, reviewed, recorded, superseded, and maintained.

---

## 1. Why ADRs Exist

Architecture Decision Records (ADRs) preserve the reasoning behind important technical decisions.

They prevent future contributors from having to guess:

- why a technology was selected;
- which alternatives were considered;
- which constraints influenced the decision;
- what consequences were accepted;
- whether a decision is still active;
- how a later decision replaced an earlier one.

An ADR is required when a decision affects multiple modules, long-term maintainability, security, deployment, data integrity, or operational cost.

---

## 2. ADR Location

Store ADR files under:

```text
architecture/adr/
```

Recommended structure:

```text
architecture/
  19-architecture-decision-records.md
  adr/
    README.md
    0001-use-modular-monolith.md
    0002-use-nestjs-for-backend.md
    0003-use-supabase-auth.md
```

---

## 3. Naming Convention

Use:

```text
NNNN-short-decision-title.md
```

Examples:

```text
0001-use-modular-monolith.md
0002-use-postgresql-as-system-of-record.md
0003-use-supabase-authentication.md
0004-require-idempotency-for-booking-commands.md
```

Rules:

- use four-digit sequential numbers;
- use lowercase kebab-case;
- never reuse an ADR number;
- never silently overwrite the meaning of an existing ADR.

---

## 4. ADR Statuses

Each ADR must have one status:

```text
Proposed
Accepted
Rejected
Deprecated
Superseded
```

### Proposed

The decision is under discussion and must not yet be treated as an architectural rule.

### Accepted

The decision is approved and must be followed.

### Rejected

The proposal was reviewed and not selected.

### Deprecated

The decision is no longer recommended but may still exist in legacy code.

### Superseded

A newer ADR explicitly replaces the decision.

When superseded, include:

```text
Superseded by: ADR-00XX
```

The replacement ADR should include:

```text
Supersedes: ADR-00YY
```

---

## 5. When an ADR Is Required

Create an ADR when deciding to:

- introduce a major framework or infrastructure dependency;
- change the backend architecture style;
- introduce Redis, queues, event brokers, or distributed locks;
- add or split a microservice;
- change authentication or authorization architecture;
- change database technology or data ownership;
- change API style or versioning strategy;
- introduce an external payment provider;
- change deployment topology;
- introduce an asynchronous workflow;
- select a cache strategy;
- accept a major security or consistency trade-off;
- introduce a repository-wide coding pattern;
- deviate from an accepted architecture document.

An ADR is usually not required for:

- small implementation details;
- local refactoring without architectural impact;
- dependency patch upgrades;
- minor endpoint additions following existing standards;
- ordinary bug fixes.

---

## 6. Decision Process

Every architectural decision should follow this process:

1. Identify the problem.
2. Document the context and constraints.
3. List realistic alternatives.
4. Evaluate benefits, risks, cost, and complexity.
5. Recommend one option.
6. Mark the ADR as `Proposed`.
7. Review the proposal.
8. Accept, reject, or revise it.
9. Merge the ADR before or with its implementation.
10. Update related architecture documents if necessary.

Implementation must not silently precede an ADR when the decision requires one.

---

## 7. Required ADR Template

Use the following template:

```markdown
# ADR-NNNN: Decision Title

**Status:** Proposed
**Date:** YYYY-MM-DD
**Decision owners:**
**Technical area:**
**Related documents:**

## Context

Describe the problem, current situation, constraints, and why a decision is needed.

## Decision Drivers

- Driver one
- Driver two
- Driver three

## Considered Options

1. Option A
2. Option B
3. Option C

## Decision

State the selected option clearly.

## Rationale

Explain why this option was selected.

## Consequences

### Positive

- Positive consequence

### Negative

- Negative consequence

### Risks

- Risk and mitigation

## Security Impact

Describe authentication, authorization, data protection, secrets, abuse, and audit implications.

## Data and Consistency Impact

Describe transactions, data ownership, migrations, concurrency, idempotency, and recovery implications.

## Operational Impact

Describe deployment, monitoring, logs, scaling, backups, cost, and incident response implications.

## Implementation Notes

List required implementation steps and boundaries.

## Validation

Explain how the decision will be tested or verified.

## Alternatives Rejected

Explain why each non-selected option was rejected.

## Review Date

Specify when this decision should be reviewed, if applicable.

## Supersedes

ADR-NNNN, if applicable.

## Superseded By

ADR-NNNN, if applicable.
```

---

## 8. Quality Rules

A good ADR must:

- describe the actual problem;
- include realistic alternatives;
- state the decision unambiguously;
- explain trade-offs honestly;
- include negative consequences;
- include security and operational impact;
- avoid promotional language;
- remain understandable without chat history;
- link to related architecture documents;
- be concise enough to review.

An ADR must not:

- hide uncertainty;
- claim benefits without explaining costs;
- contain implementation code as its primary purpose;
- retroactively justify an undocumented decision;
- combine unrelated decisions into one record.

---

## 9. Review Checklist

Before accepting an ADR, verify:

### Problem

- Is the problem clear?
- Is a decision genuinely necessary?
- Are constraints documented?

### Alternatives

- Are credible alternatives listed?
- Is the status quo considered?
- Are build-versus-buy options considered when relevant?

### Architecture

- Does the decision respect module boundaries?
- Does it introduce unnecessary coupling?
- Does it create a migration path?

### Security

- Does it preserve least privilege?
- Does it affect tenant isolation?
- Does it introduce new secrets or attack surfaces?
- Is auditing considered?

### Data

- Does it affect consistency?
- Does it affect transaction boundaries?
- Does it require migrations?
- Does it preserve historical and financial integrity?

### Operations

- Can it be deployed safely?
- Can it be monitored?
- Can it be rolled back?
- What is the maintenance cost?

### Decision

- Is the selected option explicit?
- Are negative consequences recorded?
- Is validation defined?

---

## 10. Initial ADR Backlog

The following existing decisions should eventually be formalized as ADRs:

```text
0001 — Use a Modular Monolith for Backend v1
0002 — Use NestJS as the Backend Framework
0003 — Use PostgreSQL as the System of Record
0004 — Use Supabase Auth for Identity
0005 — Use REST with /api/v1 Versioning
0006 — Enforce Tenant Isolation in API and RLS
0007 — Use Database Transactions for Booking Consistency
0008 — Require Idempotency for Booking and Payment Commands
0009 — Store Immutable Financial and Audit History
0010 — Use Provider-Neutral Payment Interfaces
```

These ADRs may be created progressively. Their absence does not invalidate already accepted architecture documents, but new major changes must follow the ADR process.

---

## 11. Relationship to Other Documents

ADRs complement, but do not replace:

- `13-backend-architecture.md`
- `14-api-design-standards.md`
- `15-coding-standards.md`
- `16-security-architecture.md`
- `17-testing-strategy.md`
- `18-backend-implementation-guide.md`

Architecture documents describe the current system contract.

ADRs explain why important contracts were chosen or changed.

If an accepted ADR conflicts with an existing architecture document, the architecture document must be updated in the same change.

---

## 12. Coding-Agent Rules

When Codex/OpenCode proposes an architectural change, it must:

1. identify that the change is architectural;
2. avoid implementing it silently;
3. create or request an ADR;
4. list alternatives and trade-offs;
5. wait for approval when the decision is not already accepted;
6. implement only after the ADR is accepted;
7. update affected documentation and tests.

Coding agents may not mark an ADR as `Accepted` unless explicitly authorized by the project owner or reviewer.

---

## 13. Final ADR Contract

For Voyagi:

1. Important architectural decisions must be written down.
2. Decisions must include context and trade-offs.
3. Existing ADRs must never be silently rewritten.
4. Replacements must use `Superseded`.
5. Implementation and documentation must remain synchronized.
6. Architectural deviations require explicit approval.
7. Chat discussions alone are not permanent architecture records.
