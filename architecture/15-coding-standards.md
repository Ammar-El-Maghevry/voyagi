# Voyagi Coding Standards

Status: Proposed

## Purpose
Defines mandatory coding conventions for all backend contributors and AI coding agents.

## Core Principles
- Readability over cleverness.
- Explicit business logic.
- One responsibility per class.
- No business logic in controllers.
- Prefer composition over inheritance.
- Keep functions small and deterministic.

## Naming
- Files: kebab-case
- Classes: PascalCase
- Variables/functions: camelCase
- Constants: UPPER_SNAKE_CASE

## Layer Rules
- Controllers call one application use case.
- Use cases orchestrate workflows.
- Domain contains business rules.
- Repositories perform persistence only.

## DTOs
- One DTO per request/response contract.
- Validate all public inputs.

## Errors
- Throw typed domain/application errors.
- Never expose SQL or stack traces.

## Logging
- Structured logs only.
- Never log secrets or tokens.

## Tests
- New business logic requires tests.
- Fixes for bugs should include regression tests.

## Pull Requests
- Small, focused changes.
- Documentation updated with behavior changes.
- Lint and tests must pass before merge.
