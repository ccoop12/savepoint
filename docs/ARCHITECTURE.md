# SavePoint architecture

## Overview

SavePoint is a three-boundary Electron application. The renderer presents checkpoint workflows; the
preload script exposes a small typed capability API; and the main process owns every privileged action.
Shared pure modules define validated domain contracts and keep capture, filtering, comparison, export,
and scheduling behavior testable without Electron.

```text
React renderer (untrusted content, no Node)
        │ named typed methods
        ▼
Context-isolated preload bridge
        │ validated IPC messages
        ▼
Electron main ── Git capture (simple-git)
        │       ├─ native dialogs / safe OS handoff
        │       └─ auto-checkpoint coordinator
        ▼
SQLite WASM database in Electron userData
```

## Process responsibilities

### Renderer

The React renderer owns navigation, forms, timeline presentation, filtering controls, accessible
dialogs, compare selection, and resume briefings. It receives plain serialized objects. It cannot load
Node modules and never receives raw filesystem or IPC access. Packaged renderer assets are served from
the private `savepoint://app` scheme with a restrictive content security policy instead of receiving
the elevated behavior historically associated with `file:` URLs.

The deterministic browser demonstration is a separate Vite build with demo mode enabled at compile
time. The Electron renderer build disables that flag and requires the typed preload bridge. If the
bridge is unavailable, the desktop UI fails closed with a recovery message instead of presenting
fictional repositories as real local state.

### Preload and IPC

The preload exposes only product capabilities such as `selectAndRegisterRepository`,
`createCheckpoint`, `listCheckpoints`, and `exportCheckpoint`. Repository selection and registration
are one main-process-owned native-dialog operation: the renderer never supplies an arbitrary path.
Every input is parsed with a bounded, channel-specific Zod schema in the main process. There is no
generic invoke, filesystem, SQL, Git, shell, or process method.

### Main process

The main process validates repository identity, coordinates Git reads, filters capture metadata,
persists checkpoints, schedules opt-in auto-checkpoints, handles native dialogs, and performs narrowly
defined operating-system handoffs. It does not execute renderer-provided command strings or destructive
Git operations.

## Persistence

SavePoint uses SQLite through `sql.js`, the official SQLite engine compiled to WebAssembly. Database
bytes are loaded from and atomically persisted to a file in `app.getPath('userData')`. Foreign keys,
indexes, versioned migrations, and transactions preserve relational behavior.

### Trade-off

`better-sqlite3` was considered first, but native addons must match Electron’s ABI and required a C++
toolchain on the release workstation. For a small metadata database, `sql.js` provides more reliable
cross-platform packaging and deterministic tests. Its cost is loading the database in memory and
rewriting the database file after mutations. Checkpoint payloads are deliberately small and contain no
source contents, so this is appropriate for v0.1.0. Large databases may motivate a reviewed native or
worker-backed alternative later.

## Git capture pipeline

1. Resolve and validate a user-selected non-bare working tree.
2. Create a permission-restricted temporary Git metadata view with a copied index, a fixed detached
   `HEAD`, a minimal allow-listed config, and the original object database attached read-only. The
   view contains no repository filters, hooks, diff drivers, submodule configuration, fetch helpers,
   or `info/attributes` file.
3. Read status, branch, full commit, bounded recent commits, and aggregate diff statistics through
   `simple-git` argument arrays. Commands have absolute time and output bounds, ignore submodules,
   disable external/textconv diffs, and run serially.
4. Normalize porcelain statuses into staged, modified, added, deleted, renamed, and untracked records.
5. Drop Git-ignored, user-excluded, and secret-like paths. A failed ignore check fails closed for the
   affected paths.
6. Redact token-shaped content in user-authored context.
7. Create a stable fingerprint from meaningful Git state and context, then skip duplicate automatic
   checkpoints.
8. Persist relational records in one transaction and remove the temporary Git view.

Source contents and complete patch text never enter the pipeline.

The isolated view deliberately does not execute clean/process filters, including Git LFS filters. If
Git must re-check a hydrated filtered file because its stat metadata changed, v0.1.0 can conservatively
report that file as modified even when a normal filter-aware Git command considers it clean. Safety
takes precedence over filter fidelity in this release.

## Automatic checkpoints

Automatic capture is disabled until explicitly enabled per repository. Repository state changes are
debounced, checked against a configurable interval (ten minutes by default), and compared with the last
meaningful fingerprint. Automatic entries are visibly labeled. Manual checkpoint creation is never
rate-limited.

## Threat model

### Assets

Local repository paths and metadata, user-authored context, the SQLite database, and exported files.

### Adversarial inputs

Repository names, branches, filenames, commit messages, links, malformed IPC payloads, symlinks,
unusually large worktrees, and token-shaped text. A renderer compromise is treated as unable to access
Node directly but able to call exposed preload methods.

### Mitigations

- Sandboxing, context isolation, disabled Node integration, restrictive navigation/window-open rules,
  the private application protocol, a content security policy, and hardened Electron fuses
- Channel-specific Zod validation, bounded text and collections, and repository-ID lookups before
  privileged actions
- Parameterized SQL and transactions
- Config-isolated, bounded Git reads with argument arrays, never renderer-provided commands
- Fixed VS Code executable candidates with `shell: false`
- Credential-free `https:` validation plus a cancel-default native confirmation for external links
- Native dialogs for repository and export selection
- Secret filtering and metadata-only capture
- React’s default escaping for all untrusted UI text
- No remote service, telemetry, or background upload channel

### Out of scope in v0.1.0

Defense against a fully compromised operating-system account, database encryption at rest, code
signing, source restoration, exact Git-filter/LFS semantics, and exhaustive recognition of secrets
pasted into freeform notes.

## Packaging

electron-vite produces separate main, preload, and renderer bundles. electron-builder packages unsigned
artifacts. GitHub Actions run platform-native jobs for Windows, macOS, and Linux, then publish artifacts
and SHA-256 checksums for tags. Code signing and automatic updates are intentionally deferred.
