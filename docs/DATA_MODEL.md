# Data model

SavePoint uses a normalized SQLite schema with forward-only migrations. Timestamps are ISO 8601 UTC
strings and IDs are application-generated UUIDs. Foreign-key enforcement is enabled for every database
connection.

## Tables

### `migrations`

Records each integer schema version and application timestamp. Migration application is transactional.

### `repositories`

One row per registered working tree: `id`, display `name`, canonical local `path`, timestamps,
`auto_checkpoint_enabled`, interval minutes, and JSON user-exclusion patterns. The canonical path is
unique.

### `checkpoints`

The checkpoint header and immutable Git snapshot: repository foreign key, origin, creation timestamp,
title, goal, completed summary, next action, blockers, notes, branch, full/short commit IDs, clean flag,
diff aggregates, recent commits JSON, and a meaningful-state fingerprint. Repository deletion cascades.

### `checkpoint_files`

One row per safe changed-file metadata record: checkpoint foreign key, path, status, optional previous
path, staged flag, and optional insertion/deletion counts. No source or diff content is stored. Indexed
by checkpoint.

### `checkpoint_links` and `checkpoint_commands`

Ordered HTTPS links and user-entered command values owned by a checkpoint. Commands are
display/copy-only and are never executed by SavePoint.

### `tags` and `checkpoint_tags`

Normalized case-insensitive tag names and a many-to-many join. Deleting a checkpoint cascades through
the join; unused tag cleanup is safe maintenance.

### `settings`

Key/value application preferences such as theme, onboarding completion, and default auto-checkpoint
interval. Values are validated when crossing the application boundary.

## Indexes

- Unique canonical repository path
- Checkpoints by repository and descending creation time
- Checkpoints by branch, origin, and fingerprint
- Files by checkpoint
- Tags by normalized name
- Join lookups by checkpoint and tag

Search in v0.1.0 uses escaped `LIKE` matching across user-authored checkpoint fields plus joined tags,
with repository, branch, tag, and origin filters applied as parameters. Payload size limits and timeline
pagination keep queries predictable.

## Deletion and updates

Checkpoint user-authored fields may be updated; captured Git state is immutable. Deletion is confirmed
in the renderer. Cascading foreign keys remove owned files, commands, links, and tag joins. Repository
deletion is not exposed in the primary v0.1.0 workflow.
