# Voyagi Security Architecture

Status: Proposed

## Security Goals
- Defense in depth
- Least privilege
- Tenant isolation
- Secure by default

## Authentication
- Supabase Auth (JWT)
- Validate issuer, audience and expiry.

## Authorization
- Roles + permissions.
- Verify active company membership.
- Enforce RLS.

## API Security
- HTTPS only
- Rate limiting
- Helmet/security headers
- DTO validation
- Parameterized SQL

## Secrets
- Environment variables only.
- Never commit secrets.

## Auditing
Log security-sensitive actions:
- login
- permission changes
- refunds
- cancellations
- ticket validation

## Incident Principles
- Sanitize errors.
- Preserve audit trail.
- Immutable financial history.
