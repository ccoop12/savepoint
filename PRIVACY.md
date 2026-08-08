# SavePoint privacy statement

SavePoint is local-first. The application has no account, cloud service, telemetry, advertising,
analytics, or automatic network upload. Repository metadata and user-authored checkpoint context stay
in a SQLite database inside the operating system’s Electron user-data directory.

## What SavePoint stores

- Repository display name and local path
- Branch and commit identifiers
- Changed-file paths and status categories
- Aggregate Git diff statistics and a limited recent-commit list
- Checkpoint titles, goals, summaries, next actions, blockers, notes, tags, links, and commands entered
  directly into SavePoint
- Per-repository automatic-checkpoint preferences and application settings

## What SavePoint does not collect

- Source-file contents or complete Git diffs
- Global shell history, browser history, clipboard contents, editor telemetry, or environment variables
- Authentication tokens, private keys, credential stores, signing certificates, or GitHub credentials
- Data from repositories the user has not explicitly added

## Secret filtering

Before persistence, SavePoint drops Git-ignored files, conventional secret paths (`.env*`, private
keys, certificates, credentials, and similar locations), and user-defined exclusion patterns. Common
token-shaped values in user-entered context are redacted. Filtering is defense in depth, not a promise
that arbitrary text can never contain a secret; review checkpoint context before exporting or sharing.

## Exports and external actions

Markdown and JSON exports are written only to a location selected in the native save dialog. Opening a
link requires a cancel-default native confirmation before a credential-free `https:` URL is handed to
the operating system. Opening a repository or VS Code sends only the registered repository path to that
local application. SavePoint never changes Git branches or files.

## Deletion

Deleting a checkpoint removes its associated files, commands, links, and tags from the local database.
Uninstall behavior varies by operating system; remove SavePoint’s user-data directory to erase all
remaining local data. Backups made by the user are outside SavePoint’s control.

See [SECURITY.md](SECURITY.md) for reporting and technical boundaries.
