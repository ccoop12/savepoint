# ADR 0004: Narrow IPC trust boundary

- Status: Accepted
- Date: 2026-08-06

## Context

The renderer displays untrusted Git and user-authored strings. Exposing Node, raw IPC, a filesystem API,
or generic command execution would turn renderer compromise into broad local access.

## Decision

Enable sandboxing and context isolation, disable Node integration, and expose only named product
capabilities from preload. Validate and bound each payload in the main process with a dedicated Zod
schema. Combine repository selection and registration into one main-owned native-dialog operation, and
resolve later privileged paths from registered repository IDs. Serve packaged UI assets from a private
application protocol with a restrictive content security policy and hardened Electron fuses.

## Consequences

Adding a capability requires coordinated schema, preload, handler, and test changes. The extra ceremony
is intentional: it keeps the reviewable attack surface small and prevents renderer-supplied shell or SQL.
