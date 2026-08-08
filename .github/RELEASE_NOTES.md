# SavePoint v0.1.0

SavePoint is a local-first desktop app that preserves the human and Git context of a development
session so you can resume work without reconstructing it from scratch.

## Highlights

- Structured manual and opt-in automatic checkpoints
- Git branch, commit, working-tree status, changed-file metadata, diff statistics, and recent commits
- Searchable timeline, checkpoint details, comparison, and practical resume briefing
- Markdown and JSON exports
- Local SQLite persistence with migrations
- Secret-path filtering and likely-token redaction
- Dark/light desktop UI, keyboard shortcuts, and accessible primary workflows

## Install

Download the artifact for your operating system and verify it against `SHA256SUMS.txt`. Windows uses the
`.exe` installer, macOS uses the `.dmg`, and Linux provides AppImage and Debian packages.

## Unsigned build warning

These binaries are not code-signed. Windows SmartScreen or macOS Gatekeeper may warn that the publisher
or developer is unidentified. Download only from this GitHub release and verify the checksum. Code
signing is planned for a later release.

## Privacy model

SavePoint has no account, cloud backend, telemetry, analytics, or automatic upload. It stores checkpoint
metadata locally, excludes Git-ignored and secret-like paths, and never stores source-file contents or
complete diffs.

## Known limitations

- Checkpoints explain state but do not restore files or switch branches.
- Automatic checkpoints run only while SavePoint is open.
- The local database is not encrypted at rest in v0.1.0.
- VS Code handoff recognizes supported default installation paths.
- Repositories using alternate Git object stores are rejected. Configured Git filters are never
  executed, so a hydrated Git LFS or other filtered file can be conservatively reported as modified
  after a stat change.
