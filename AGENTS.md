# AGENTS.md

## Product boundary

SavePoint is a local-first Electron desktop application. Preserve the core promise: capture enough Git
metadata and human context to resume work without collecting source contents, complete diffs, global
activity, or secrets. Do not add cloud services, telemetry, arbitrary shell execution, automated Git
mutation, or paid APIs.

## Architecture map

- `src/main/`: Electron lifecycle, secure windows, IPC handlers, native dialogs, Git capture, SQLite
  persistence, and auto-checkpoint coordination
- `src/preload/`: the only renderer-to-main bridge; named and typed methods only
- `src/renderer/`: React UI; no Node, filesystem, process, Git, or database access
- `src/shared/`: Zod schemas, public domain types, capture normalization, secret filtering,
  deduplication, comparison, exports, and resume summaries
- `tests/unit/`: pure domain and boundary tests
- `tests/integration/`: database and temporary-Git-repository tests
- `tests/e2e/`: real renderer components backed by a deterministic demo adapter
- `docs/adr/`: architecture decisions; update these when a boundary changes

The SQLite engine is `sql.js`. After each transaction, the database export is written atomically to
the Electron user-data directory. This avoids native Electron ABI rebuilds while retaining a real,
portable SQLite file. Keep migration versions explicit and forward-only.

## Commands

- `npm run dev`: Electron development mode
- `npm run lint`: ESLint with zero warnings
- `npm run format:check`: formatting verification
- `npm run typecheck`: strict TypeScript compilation
- `npm test`: unit and integration tests
- `npm run test:coverage`: coverage report
- `npm run test:e2e`: primary UI workflow in deterministic demo mode
- `npm run test:electron`: built application, preload, IPC, Git capture, and persistence smoke test
- `npm run build`: production Electron build
- `npm run package`: unsigned Windows x64 installer
- `npm run verify`: noninteractive lint, format, type, tests, and build

## Conventions

Validate all IPC input with shared Zod schemas. Use discriminated or explicit domain types instead of
stringly typed payloads. Keep limits on arrays and freeform text. Use parameterized SQL. Treat repository
names, branches, filenames, commit messages, URLs, and user notes as untrusted. Spawn only fixed local
executables with argument arrays and `shell: false`. Never put a generic execute/open/read/write method
on the preload API.

Do not run worktree status or diff commands against repository configuration. Preserve the temporary
config-isolated Git view in `src/main/services/git-capture.ts`: no filters, hooks, diff drivers,
submodule recursion, fetch helpers, alternate object stores, or inherited `GIT_*` controls. Any change
to that boundary needs adversarial regression tests and an update to ADR 0006.

UI changes must preserve semantic labels, keyboard operation, visible focus, light/dark contrast, and
reduced motion. Demo and screenshot data must be fictional and use sanitized paths.

## Testing expectations

Add unit tests for pure behavior and integration tests for persistence or Git boundaries. Use generated
temporary repositories; never depend on a contributor’s projects, Git identity, global config, or user
database. A bug fix needs a regression test whenever practical. Run the narrow test first, then
`npm run verify` and `npm run test:e2e` before handoff.

## Completion checklist

- No new source-content, diff-content, secret, network-upload, or Git-mutation path
- IPC schema, types, implementation, preload, and tests updated together
- Database changes include a migration and data-model documentation
- Lint, formatting, typecheck, unit/integration, E2E, and build pass
- Visible changes inspected at common laptop width in dark and light themes
- User-facing behavior, privacy impact, changelog, and limitations documented
