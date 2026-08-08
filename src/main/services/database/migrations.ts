export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

/**
 * Append-only database migrations. Existing entries must never be edited after
 * release; add a new migration instead.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_local_store',
    sql: `
      CREATE TABLE repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        auto_checkpoint_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_checkpoint_enabled IN (0, 1)),
        auto_checkpoint_interval_minutes INTEGER NOT NULL DEFAULT 10
          CHECK (auto_checkpoint_interval_minutes BETWEEN 1 AND 1440),
        exclusion_patterns_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('manual', 'automatic')),
        title TEXT NOT NULL DEFAULT '',
        goal TEXT NOT NULL DEFAULT '',
        completed TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        blockers TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        branch TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        short_commit_hash TEXT NOT NULL,
        is_clean INTEGER NOT NULL CHECK (is_clean IN (0, 1)),
        count_staged INTEGER NOT NULL DEFAULT 0,
        count_modified INTEGER NOT NULL DEFAULT 0,
        count_added INTEGER NOT NULL DEFAULT 0,
        count_deleted INTEGER NOT NULL DEFAULT 0,
        count_renamed INTEGER NOT NULL DEFAULT 0,
        count_copied INTEGER NOT NULL DEFAULT 0,
        count_untracked INTEGER NOT NULL DEFAULT 0,
        count_conflicted INTEGER NOT NULL DEFAULT 0,
        diff_files_changed INTEGER NOT NULL DEFAULT 0,
        diff_insertions INTEGER NOT NULL DEFAULT 0,
        diff_deletions INTEGER NOT NULL DEFAULT 0,
        recent_commits_json TEXT NOT NULL DEFAULT '[]',
        fingerprint TEXT NOT NULL
      );

      CREATE TABLE checkpoint_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        staged INTEGER NOT NULL CHECK (staged IN (0, 1)),
        previous_path TEXT,
        additions INTEGER,
        deletions INTEGER,
        UNIQUE(checkpoint_id, path, staged)
      );

      CREATE TABLE checkpoint_links (
        checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        url TEXT NOT NULL,
        PRIMARY KEY(checkpoint_id, position)
      );

      CREATE TABLE checkpoint_commands (
        checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        command TEXT NOT NULL,
        PRIMARY KEY(checkpoint_id, position)
      );

      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE checkpoint_tags (
        checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(checkpoint_id, tag_id)
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: 'query_indexes',
    sql: `
      CREATE INDEX checkpoints_repository_created_idx
        ON checkpoints(repository_id, created_at DESC);
      CREATE INDEX checkpoints_branch_idx ON checkpoints(branch);
      CREATE INDEX checkpoints_origin_idx ON checkpoints(origin);
      CREATE INDEX checkpoints_fingerprint_idx
        ON checkpoints(repository_id, fingerprint, created_at DESC);
      CREATE INDEX checkpoint_files_checkpoint_idx ON checkpoint_files(checkpoint_id);
      CREATE INDEX checkpoint_tags_tag_idx ON checkpoint_tags(tag_id, checkpoint_id);
    `
  }
]

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0
