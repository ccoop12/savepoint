# Security policy

## Supported versions

SavePoint v0.1.0 is currently a release candidate and is not code-signed. Before the first public
release, security fixes are applied to the current release-candidate source. After publication,
security fixes will be applied to the latest released version.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or accidental secret exposure. Use GitHub’s
private vulnerability reporting feature on this repository. Include the affected version, impact,
reproduction steps, and any suggested mitigation. Please allow a reasonable period for triage before
public disclosure.

## Security boundaries

- The renderer is sandboxed, context-isolated, and has Node integration disabled.
- Packaged UI assets use the private `savepoint://app` protocol, a restrictive content security
  policy, locked navigation and permissions, and Electron fuses that disable run-as-Node, Node
  options, CLI inspection, and loading application code outside the ASAR archive.
- A narrow preload bridge exposes named operations; it never exposes raw `ipcRenderer`, filesystem
  APIs, database handles, Git commands, or a generic shell function.
- Zod validates and bounds all renderer-to-main inputs. Database queries use parameters.
- External URLs must be credential-free `https:` URLs and require a cancel-default native
  confirmation before the operating system handles them.
- Repository selection and registration are one main-owned native-dialog operation. Export paths use
  a native save dialog; folder and editor actions resolve opaque repository IDs in the main process.
- VS Code launch checks fixed absolute installation candidates and uses argument arrays with
  `shell: false`.
- Worktree capture uses a short-lived, permission-restricted Git metadata view. It copies the index,
  allow-lists inert status configuration, strips Git control environment variables, bounds output and
  runtime, ignores submodules, disables external/textconv diffs, and never inherits repository hooks,
  filters, diff drivers, credential helpers, fetch configuration, or `info/attributes`.
- React escapes user-controlled repository names, branches, paths, commit messages, and notes.
- SavePoint stores metadata, not source contents or complete diffs, and filters likely secret paths.

## Residual risks and limitations

Secret-pattern matching cannot identify every sensitive value, especially secrets pasted into
freeform notes. A malicious local repository can contain extremely long or unusual filenames and Git
metadata; SavePoint bounds captured collections and relies on Git’s argument-safe process invocation.
Captures also have process-output and time bounds and fail closed when ignore checks or safety limits
fail. Repositories that use alternate Git object stores are rejected. Because configured
clean/process filters are never executed, hydrated Git LFS or other filtered files can be
conservatively reported as modified after a stat change even when filter-aware Git reports them clean.
Any process running as the same operating-system user may be able to read the local database. v0.1.0
does not encrypt the database at rest. Unsigned installers can be replaced if acquired from an
untrusted mirror, so use GitHub release checksums.

Dependencies are audited before release. Findings in development or packaging dependencies are
evaluated for reachability rather than changed blindly; meaningful remaining issues are recorded in
release notes.
