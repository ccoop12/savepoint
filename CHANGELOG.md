# Changelog

All notable changes to SavePoint are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use Semantic Versioning.

## [Unreleased]

## [0.1.0] - 2026-08-08

Initial public release.

### Added

- Local Git repository registration and status capture
- Structured manual checkpoints and opt-in per-repository automatic checkpoints
- Persistent SQLite storage with versioned migrations
- Searchable and filterable multi-repository checkpoint timeline
- Checkpoint detail editing and confirmed deletion
- Same-repository metadata and context comparison
- Resume briefing with current-repository drift information
- Markdown and JSON export
- Secret-path exclusion and likely-token redaction
- Dark and light themes, keyboard shortcuts, onboarding, privacy, and settings views
- Unit, integration, deterministic renderer E2E, and real Electron backend test suites
- CI plus configured unsigned Windows, macOS, and Linux release builds, checksums, and GitHub Pages
  deployment

### Security

- Sandboxed, context-isolated renderer with Node integration disabled
- Narrow, typed, runtime-validated IPC boundary
- Private packaged application protocol and hardened Electron fuses
- Config-isolated, bounded Git capture that cannot inherit repository filters, hooks, diff drivers,
  credential helpers, or submodule commands
- No source contents, complete diffs, telemetry, accounts, or data uploads

[Unreleased]: https://github.com/ccoop12/savepoint/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ccoop12/savepoint/releases/tag/v0.1.0
