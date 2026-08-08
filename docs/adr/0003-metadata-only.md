# ADR 0003: Metadata-only checkpoints

- Status: Accepted
- Date: 2026-08-06

## Context

Source contents and complete diffs would improve restoration fidelity but substantially increase secret,
storage, intellectual-property, and export risks.

## Decision

Do not store source-file contents or complete Git diffs in v0.1.0. Capture file paths and statuses,
aggregate insertion/deletion statistics, commits, branch, commit identifiers, and human-authored context.

## Consequences

Checkpoints explain a session but cannot restore code or provide source-level comparisons. The database
stays small, filtering is understandable, and accidental secret collection is reduced. Any future diff
snapshot must be encrypted and explicitly enabled.
