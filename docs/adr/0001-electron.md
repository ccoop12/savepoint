# ADR 0001: Electron desktop runtime

- Status: Accepted
- Date: 2026-08-06
- Updated: 2026-08-08

## Context

SavePoint needs native folder and export dialogs, local filesystem and Git access, durable local
storage, and a rich cross-platform interface. A browser-only application cannot provide these
capabilities safely without a companion service.

## Decision

Use Electron with React and TypeScript. Put privileged work in the main process, expose a small preload
bridge, and keep the renderer sandboxed and isolated. Compile the browser demonstration with an
explicit demo flag. Desktop builds require the preload bridge and show an initialization error if it
is missing; they never fall back to fictional demo data.

## Consequences

One product codebase can target Windows, macOS, and Linux and reuse the web accessibility ecosystem.
The release is larger than a native toolkit build and must track Electron security updates. Process
boundaries and native packaging require explicit testing.
The separate browser-demo build must remain visibly isolated from the desktop runtime contract.
