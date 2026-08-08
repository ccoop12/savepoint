# ADR 0005: Portable SQLite WASM

- Status: Accepted
- Date: 2026-08-06

## Context

Native SQLite bindings couple packaging to Electron’s Node ABI and required an unavailable Windows C++
toolchain during the first release build. SavePoint needs relational migrations but stores only bounded
metadata.

## Decision

Use `sql.js`, SQLite compiled to WebAssembly. Load the database into the main process and atomically
persist exported bytes after successful write transactions.

## Consequences

Packaging is deterministic across supported operating systems and CI runners without native addon
rebuilds. Mutations rewrite the database file and the working database resides in memory, so this choice
must be revisited if data volume grows materially. SQLite semantics and portable database files remain.
