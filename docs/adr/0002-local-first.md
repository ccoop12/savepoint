# ADR 0002: Local-first product boundary

- Status: Accepted
- Date: 2026-08-06

## Context

Development-session metadata can reveal repository paths, unpublished work, customer names, and future
plans. SavePoint’s core value does not require collaboration or a hosted service.

## Decision

Store data only on the user’s device. Add no account, cloud backend, telemetry, analytics, or network
upload. Make automatic capture opt-in per repository.

## Consequences

The product works offline and has a small privacy surface. Users are responsible for backups and data
does not synchronize across machines. A future sync feature must be optional, encrypted, and reviewed
as a new trust boundary.
