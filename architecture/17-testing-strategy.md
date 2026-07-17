# Voyagi Testing Strategy

Status: Proposed

## Testing Pyramid
1. Unit tests
2. Integration tests
3. End-to-end tests

## Unit Tests
Cover:
- domain rules
- calculations
- state transitions

## Integration Tests
Cover:
- repositories
- transactions
- RLS
- migrations

## End-to-End
Critical flows:
- login
- booking
- payment
- ticket issuance
- ticket validation
- cancellation
- cross-tenant access rejection

## CI Requirements
- Type check passes
- Lint passes
- Tests pass

## Regression Policy
Every production bug should receive a regression test.
