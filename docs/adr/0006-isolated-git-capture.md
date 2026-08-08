# ADR 0006: Config-isolated Git capture

- Status: Accepted
- Date: 2026-08-06

## Context

Git status and diff appear read-only, but repository configuration and attributes can make them invoke
filesystem-monitor hooks, clean/process filters, external diff tools, text converters, or nested
submodule operations. A repository selected by the user is data, not trusted application code.

## Decision

Run worktree inspection against a short-lived, permission-restricted Git metadata view. Copy the index
and required bounded metadata, attach the original object database for reads, use a detached commit ID,
and write only an allow-listed inert configuration. Strip Git control environment variables, disable
external/textconv diffs, ignore submodules, serialize captures, and enforce time, output, and file-count
limits. Never copy repository config, hooks, filter drivers, `info/attributes`, credentials, or fetch
settings into the view. Reject alternate object stores rather than following arbitrary paths.

## Consequences

A malicious repository cannot turn SavePoint capture into arbitrary helper execution through the Git
features above. The view is deleted after capture and the original index is not written. Common built-in
status semantics such as line-ending and filesystem handling are copied only after strict validation.
The security boundary intentionally sacrifices exact custom-filter behavior: a hydrated Git LFS or
other filtered file can be reported as modified after a stat change even when filter-aware Git considers
it clean. Supporting those repositories without executing their configured programs is future work.
