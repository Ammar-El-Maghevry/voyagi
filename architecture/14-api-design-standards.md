# Voyagi API Design & Standards

**Status:** Proposed  
**Version:** 1.0  
**Applies to:** Voyagi Backend API  
**Base path:** `/api/v1`  
**Primary style:** REST over HTTPS  
**Documentation:** OpenAPI / Swagger  

---

## 1. Purpose

This document defines the official API design standards for Voyagi.

It ensures that all endpoints are:

- consistent;
- predictable;
- secure;
- easy to document;
- easy to consume from web and mobile applications;
- stable as the platform grows.

All new endpoints must follow this document unless an approved Architecture Decision Record explicitly defines an exception.

---

## 2. Core API Principles

1. Use nouns for resources.
2. Use HTTP methods according to their intended semantics.
3. Keep URLs stable and predictable.
4. Return consistent success and error envelopes.
5. Validate all input at the API boundary.
6. Never trust client-provided tenant identifiers.
7. Use idempotency for retryable write operations.
8. Use pagination for all list endpoints.
9. Use ISO 8601 timestamps.
10. Do not expose internal database structure unnecessarily.
11. Document every public endpoint in OpenAPI.
12. Breaking changes require versioning or a migration plan.

---

## 3. Base URL and Versioning

All API endpoints begin with:

```text
/api/v1
```

Examples:

```text
GET /api/v1/trips
POST /api/v1/bookings
GET /api/v1/bookings/{bookingId}
```

Rules:

- `v1` represents the public API contract.
- Backward-compatible additions may remain in the same version.
- Breaking changes require a new version such as `/api/v2`.
- Database changes do not automatically require an API version change.
- Internal refactoring must not change public API behavior.

---

## 4. Resource Naming

Use plural nouns in kebab-case.

Good:

```text
/companies
/company-memberships
/seat-layouts
/seat-reservations
/booking-events
```

Avoid:

```text
/getCompanies
/createBooking
/companyMembership
/seat_layouts
```

Nested routes are allowed only when the parent relationship is important.

Good:

```text
GET /companies/{companyId}/branches
GET /trips/{tripId}/seats
GET /bookings/{bookingId}/events
```

Avoid excessive nesting:

```text
/companies/{companyId}/branches/{branchId}/staff/{staffId}/permissions
```

Prefer a direct resource endpoint when nesting becomes difficult to maintain.

---

## 5. HTTP Method Semantics

### GET

Use for reading data.

```text
GET /trips
GET /bookings/{bookingId}
```

Must not change server state.

### POST

Use for:

- creating resources;
- commands;
- operations that are not naturally represented by CRUD.

Examples:

```text
POST /bookings
POST /payments/{paymentId}/confirm
POST /tickets/{ticketId}/validate
POST /trips/{tripId}/start
```

### PUT

Use only for complete replacement of a resource when full replacement semantics are intended.

### PATCH

Use for partial updates.

```text
PATCH /companies/{companyId}
PATCH /routes/{routeId}
```

### DELETE

Use for deletion only when deletion is allowed by business rules.

For immutable or auditable data, prefer a state-changing command.

Example:

```text
POST /bookings/{bookingId}/cancel
```

instead of:

```text
DELETE /bookings/{bookingId}
```

---

## 6. Standard Success Responses

### 6.1 Single resource

```json
{
  "success": true,
  "data": {
    "id": "..."
  },
  "requestId": "..."
}
```

### 6.2 Collection

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  },
  "requestId": "..."
}
```

### 6.3 Command response

```json
{
  "success": true,
  "data": {
    "status": "confirmed"
  },
  "requestId": "..."
}
```

### 6.4 Empty successful response

Use `204 No Content` only when the client does not need a response body.

Otherwise return the standard success envelope.

---

## 7. Standard Error Responses

All errors must follow this shape:

```json
{
  "success": false,
  "error": {
    "code": "SEAT_ALREADY_RESERVED",
    "message": "The selected seat is no longer available.",
    "details": {
      "seatId": "..."
    }
  },
  "requestId": "..."
}
```

### 7.1 Error categories

Use stable machine-readable codes.

Examples:

```text
VALIDATION_ERROR
UNAUTHENTICATED
FORBIDDEN
RESOURCE_NOT_FOUND
TENANT_ACCESS_DENIED
BUSINESS_RULE_VIOLATION
CONFLICT
SEAT_ALREADY_RESERVED
BOOKING_NOT_CANCELLABLE
PAYMENT_ALREADY_CONFIRMED
TICKET_ALREADY_USED
RATE_LIMIT_EXCEEDED
DEPENDENCY_FAILURE
INTERNAL_ERROR
```

### 7.2 Error messages

Messages must be:

- clear;
- safe;
- user-readable;
- free from implementation details.

Do not expose:

- stack traces;
- SQL;
- table names when unnecessary;
- database credentials;
- provider secrets;
- raw internal exceptions.

---

## 8. HTTP Status Codes

Use status codes consistently.

```text
200 OK
201 Created
202 Accepted
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
```

Guidance:

- `400` for malformed requests.
- `401` for missing or invalid authentication.
- `403` for authenticated users without permission.
- `404` for inaccessible or missing resources.
- `409` for state conflicts or uniqueness conflicts.
- `422` for valid syntax but invalid business input.
- `429` for rate limits.
- `500` for unexpected internal failures.

---

## 9. Validation Standards

All request DTOs must validate:

- required fields;
- string length;
- format;
- enums;
- date validity;
- numeric ranges;
- pagination bounds;
- UUID format;
- phone and email format where applicable.

Unknown request fields should be rejected or stripped according to the global validation policy.

Example:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "details": {
      "fields": {
        "departureTime": [
          "departureTime must be a valid ISO 8601 datetime"
        ]
      }
    }
  },
  "requestId": "..."
}
```

Business validation must not be placed only in DTOs.

Examples of business validation:

- trip is open for booking;
- booking can still be cancelled;
- user belongs to the company;
- selected seat is available;
- payment transition is allowed.

---

## 10. Authentication Headers

Protected endpoints require:

```text
Authorization: Bearer <access-token>
```

The backend verifies the token and resolves the authenticated profile.

Never accept user identity directly from request bodies.

Forbidden:

```json
{
  "userId": "client-supplied-user-id"
}
```

unless the endpoint explicitly manages another user and permission checks are enforced.

---

## 11. Tenant Context

Tenant-scoped endpoints must resolve company context securely.

Possible mechanisms:

```text
X-Company-Id: <company-uuid>
```

or a route parameter:

```text
/companies/{companyId}/branches
```

Rules:

- the supplied company ID is untrusted;
- active membership must be verified;
- permissions must be checked;
- resource ownership must be enforced;
- database RLS remains active;
- cross-company access is denied by default.

Recommended header:

```text
X-Company-Id
```

Use it only for endpoints where company context is not already clear from the resource path.

---

## 12. Request and Correlation IDs

Each request must have a unique request ID.

Accepted incoming header:

```text
X-Request-Id
```

If absent, the backend generates one.

Returned response header:

```text
X-Request-Id
```

The same value appears in:

- response body;
- structured logs;
- error reports;
- audit context when applicable.

---

## 13. Pagination

Every list endpoint must support pagination.

Default query parameters:

```text
?page=1&pageSize=20
```

Rules:

- default `page` is `1`;
- default `pageSize` is `20`;
- maximum `pageSize` is `100`;
- invalid values return `400`;
- totals should be returned when reasonably efficient.

Example:

```text
GET /api/v1/trips?page=1&pageSize=20
```

Response:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 145,
    "totalPages": 8
  },
  "requestId": "..."
}
```

Cursor pagination may be introduced for:

- audit logs;
- booking events;
- very large histories;
- real-time feeds.

---

## 14. Filtering

Use query parameters for filters.

Examples:

```text
GET /trips?status=scheduled
GET /trips?originCityId=...&destinationCityId=...
GET /bookings?status=confirmed
GET /payments?provider=...
```

Rules:

- filter names use camelCase;
- enums must match documented API values;
- unsupported filters return `400`;
- tenant filtering is always implicit and secure;
- filters must be indexed when frequently used.

---

## 15. Sorting

Use:

```text
?sort=departureTime
?sort=-createdAt
```

Rules:

- ascending by default;
- prefix `-` means descending;
- only allow documented sortable fields;
- reject unsupported fields;
- define a deterministic secondary sort where needed.

Example:

```text
GET /trips?sort=departureTime
GET /bookings?sort=-createdAt
```

---

## 16. Search

Use:

```text
?q=nouakchott
```

Search behavior must be documented per endpoint.

Do not create a generic search that scans every column.

Search must be:

- bounded;
- indexed where necessary;
- tenant-scoped;
- protected from expensive wildcard abuse.

---

## 17. Sparse Field Selection

Sparse fieldsets are optional in v1.

If introduced, use:

```text
?fields=id,status,totalAmount
```

Only documented fields may be requested.

Do not implement this prematurely unless there is a clear performance benefit.

---

## 18. Includes and Related Resources

Use an explicit `include` query parameter only when necessary.

Example:

```text
GET /bookings/{bookingId}?include=passengers,tickets
```

Rules:

- default responses remain reasonably small;
- includes are documented;
- unsupported includes return `400`;
- avoid unbounded relation expansion;
- prevent N+1 queries.

---

## 19. Dates and Times

Use ISO 8601.

Example:

```text
2026-07-17T12:30:00Z
```

Rules:

- API timestamps include timezone information;
- canonical persisted timestamps use UTC;
- business timezone may be stored separately;
- ambiguous local datetimes are rejected;
- date-only fields use `YYYY-MM-DD`;
- time-only fields use a documented format.

Query ranges:

```text
?departureFrom=2026-07-17T00:00:00Z
&departureTo=2026-07-18T00:00:00Z
```

---

## 20. Money and Currency

Never use floating-point values for authoritative money calculations.

Recommended API representation:

```json
{
  "amount": "1250.00",
  "currency": "MRU"
}
```

Rules:

- amount is returned as a decimal string;
- currency uses ISO 4217 where applicable;
- all amounts include currency context;
- rounding rules are defined centrally;
- price snapshots are immutable;
- clients cannot submit authoritative totals.

---

## 21. Identifiers

Use UUIDs for public resource identifiers.

Example:

```text
/bookings/4fca7a4e-...
```

Rules:

- validate UUID format;
- do not expose sequential internal IDs;
- do not infer authorization from ID obscurity;
- booking references may be human-readable but are not authorization credentials.

---

## 22. Idempotency

Retryable write endpoints should support:

```text
Idempotency-Key: <unique-client-key>
```

Required initially for:

- booking creation;
- payment initiation;
- payment confirmation;
- refund requests;
- ticket issuance;
- webhook processing.

Rules:

- keys are scoped by tenant, actor, and operation;
- repeated identical requests return the original result;
- conflicting payloads with the same key return `409`;
- keys have a defined retention period;
- idempotency state must survive process restarts.

---

## 23. Optimistic Concurrency

Resources with a `version` field may require clients to send the expected version.

Example request:

```json
{
  "version": 3,
  "status": "cancelled"
}
```

If the current resource version differs, return:

```text
409 Conflict
```

Error code:

```text
VERSION_CONFLICT
```

This prevents accidental overwrites.

---

## 24. Command Endpoints

Business actions should use clear command endpoints.

Examples:

```text
POST /bookings/{bookingId}/cancel
POST /payments/{paymentId}/confirm
POST /payments/{paymentId}/refund
POST /tickets/{ticketId}/validate
POST /trips/{tripId}/start
POST /trips/{tripId}/complete
```

Command endpoints must:

- validate current state;
- be idempotent when retry is possible;
- produce audit or domain events;
- return the resulting state;
- reject invalid transitions.

---

## 25. Booking API Standards

Booking creation:

```text
POST /api/v1/bookings
```

Recommended request:

```json
{
  "tripId": "...",
  "passengers": [
    {
      "fullName": "Example Passenger",
      "phone": "+222..."
    }
  ],
  "seats": [
    {
      "seatId": "...",
      "passengerIndex": 0
    }
  ],
  "source": "passenger_app"
}
```

Rules:

- the backend calculates authoritative price;
- seat assignment occurs in one transaction;
- duplicate retries use idempotency;
- conflicts return `409`;
- booking events are created;
- partial bookings are not allowed.

---

## 26. Payment API Standards

Provider-specific details must be abstracted.

Examples:

```text
POST /payments
POST /payments/{paymentId}/confirm
POST /payments/{paymentId}/refund
POST /webhooks/payments/{provider}
```

Webhook endpoints must:

- verify signatures;
- support duplicate delivery;
- process idempotently;
- return quickly;
- avoid exposing internal errors;
- log provider event IDs safely.

---

## 27. Ticket API Standards

Examples:

```text
POST /bookings/{bookingId}/tickets
GET /tickets/{ticketId}
POST /tickets/{ticketId}/validate
POST /tickets/verify
```

Rules:

- ticket issuance requires valid booking/payment state;
- QR content must not expose sensitive data;
- verification is server-authoritative;
- repeated validation must be safe;
- revoked or refunded tickets are rejected;
- scans are auditable.

---

## 28. File Uploads

When file upload support is introduced:

- use multipart form data;
- limit file size;
- validate MIME type;
- validate extension;
- scan when appropriate;
- store files outside the database;
- return a stable file identifier;
- never trust original filenames;
- use signed access URLs for private files.

---

## 29. Rate Limiting

Rate limits must be endpoint-sensitive.

Examples:

- authentication endpoints: strict;
- trip search: moderate;
- booking creation: strict per user and IP;
- webhook endpoints: provider-aware;
- ticket validation: operationally appropriate.

Rate limit response:

```text
429 Too Many Requests
```

Recommended headers:

```text
Retry-After
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

---

## 30. Caching

Use standard HTTP caching only for safe public or semi-static resources.

Examples:

- cities;
- stations;
- public route catalogs.

Sensitive tenant resources must not be publicly cached.

Use:

```text
ETag
Cache-Control
Last-Modified
```

only where behavior is clearly defined.

---

## 31. OpenAPI and Swagger

Every endpoint must document:

- summary;
- description;
- tags;
- authentication;
- path parameters;
- query parameters;
- request body;
- response DTO;
- error responses;
- examples;
- permission requirements where appropriate.

Swagger must be generated from source and kept synchronized with implementation.

Recommended local path:

```text
/api/docs
```

Production exposure should be controlled by configuration.

---

## 32. Deprecation

Deprecated endpoints must include:

```text
Deprecation: true
Sunset: <date>
Link: <replacement-documentation>
```

Deprecation requires:

- replacement path;
- migration guidance;
- removal date where possible;
- release-note communication.

---

## 33. Public and Internal Endpoints

Public endpoints must be explicitly marked.

Examples:

- authentication;
- public trip search;
- payment webhooks;
- health checks with limited data.

Internal operational endpoints must:

- require strong authentication;
- be separated by route or policy;
- never rely only on obscurity;
- be excluded from public client contracts.

---

## 34. Health Endpoints

Recommended endpoints:

```text
GET /health/live
GET /health/ready
```

`live` confirms the process is running.

`ready` confirms required dependencies are available.

Do not expose sensitive infrastructure details in public health responses.

---

## 35. Security Headers

The API should return appropriate security headers.

Examples:

```text
X-Content-Type-Options
Content-Security-Policy
Strict-Transport-Security
Referrer-Policy
```

CORS must use an explicit allowlist in production.

---

## 36. API Review Checklist

Before merging an endpoint, verify:

- resource name is correct;
- HTTP method is appropriate;
- path follows conventions;
- request DTO is validated;
- response envelope is correct;
- errors use stable codes;
- authentication is enforced;
- permissions are enforced;
- tenant context is enforced;
- pagination exists for lists;
- idempotency exists where required;
- transaction boundaries are correct;
- audit requirements are implemented;
- Swagger is complete;
- tests cover success and failure paths.

---

## 37. Definition of Done for an Endpoint

An endpoint is complete only when:

1. request and response contracts are defined;
2. DTO validation is implemented;
3. authorization is implemented;
4. tenant isolation is verified;
5. business rules are enforced;
6. stable error codes exist;
7. OpenAPI is updated;
8. unit or integration tests exist;
9. E2E coverage exists for critical flows;
10. logs include request context;
11. no sensitive information is exposed;
12. documentation matches actual behavior.

---

## 38. Initial API Roadmap

### Foundation

```text
GET /health/live
GET /health/ready
```

### Authentication and profile

```text
GET /auth/me
GET /profiles/me
```

### Companies and memberships

```text
GET /companies
GET /companies/{companyId}
PATCH /companies/{companyId}
GET /companies/{companyId}/memberships
POST /companies/{companyId}/memberships
```

### Branches and staff

```text
GET /branches
POST /branches
PATCH /branches/{branchId}
GET /staff-members
POST /staff-members
```

### Fleet and routes

```text
GET /buses
POST /buses
GET /seat-layouts
GET /routes
POST /routes
```

### Trips

```text
GET /trips
POST /trips
GET /trips/{tripId}
POST /trips/{tripId}/start
POST /trips/{tripId}/complete
```

### Bookings

```text
POST /bookings
GET /bookings
GET /bookings/{bookingId}
POST /bookings/{bookingId}/cancel
GET /bookings/{bookingId}/events
```

### Payments

```text
POST /payments
GET /payments/{paymentId}
POST /payments/{paymentId}/confirm
POST /payments/{paymentId}/refund
```

### Tickets

```text
POST /bookings/{bookingId}/tickets
GET /tickets/{ticketId}
POST /tickets/{ticketId}/validate
```

---

## 39. Final API Contract

The Voyagi API must remain:

- versioned;
- secure;
- multi-tenant;
- explicit;
- consistent;
- documented;
- testable;
- idempotent where retries are expected;
- stable for web and mobile clients.

Any endpoint that violates these standards must be corrected before merge.
