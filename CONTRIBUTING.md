# Contributing to SavePoint

Thank you for helping improve SavePoint. The most useful contributions keep the product focused,
local-first, and safe around untrusted repositories.

## Before opening a pull request

1. Check existing issues and open a focused issue for substantial behavior or architecture changes.
2. Keep renderer code outside the filesystem and Git trust boundary.
3. Never add telemetry, remote uploads, source-content capture, arbitrary shell execution, or secrets.
4. Add tests that exercise the behavior rather than implementation details.
5. Run `npm run verify` and `npm run test:e2e`.

## Development

```bash
npm install
npm run dev
```

Use strict TypeScript, narrow Zod schemas at IPC boundaries, semantic HTML, visible keyboard focus,
and parameterized database statements. Format with Prettier and follow Conventional Commits where a
change naturally fits (for example, `feat: add branch filter`).

## Pull requests

Keep changes reviewable. Explain the user problem, security implications, testing performed, and any
deliberately deferred work. Screenshots are helpful for visible UI changes, but must use fictional
repositories and sanitized paths.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
