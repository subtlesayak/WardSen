# WardSen Roadmap

## Milestone 1: Production-Quality Open-Source Desktop Foundation

Status: implementation complete through Phase 24.

### Completed Phases

- Phase 1: Monorepo and shared types
- Phase 2: SQLite schema and migrations
- Phase 3: Safe CLI runner
- Phase 4: Provider registry
- Phase 5: Multi-account session manager
- Phase 6: Bitwarden credential adapter
- Phase 7: Bitwarden Send adapter
- Phase 8: People directory
- Phase 9: Credential-search interface
- Phase 10: Individual delivery flow
- Phase 11: Delivery history and revocation
- Phase 12: Bulk-delivery queue
- Phase 13: KeePassXC adapter
- Phase 14: Windows installer
- Phase 15: macOS installer
- Phase 16: Tauri packaging
- Phase 17: Provider scaffolds
- Phase 18: Security tests and docs

## Completed Phase 19: Release Risk Hardening

Status: complete

### Problem

WardSen now has the main product foundation, but the attached risk review identifies release-blocking security, isolation, supply-chain, bulk-action and messaging risks that need a dedicated hardening pass before a public release.

### Scope

- Plaintext credential handling audit across backend, provider adapters, delivery providers, frontend responses, logs, process execution and build artifacts.
- Strong account-isolation audit and tests proving one account cannot retrieve, deliver or mutate another account's credential/session context.
- Supply-chain security hardening for dependencies, provider CLI acquisition, release workflows, SBOM generation and dependency scanning.
- Bulk-action safeguards for wrong-credential/wrong-recipient blast radius, including confirmation, large-batch confirmation, cancellation, bounded concurrency, partial-failure reporting and batch revocation where supported.
- Honest security messaging explaining that expiry and view limits control link access but cannot prevent a recipient from saving a viewed credential.

### Acceptance Criteria

- No credential plaintext, TOTP secret, access password, master password or provider session token is persisted to SQLite, audit logs, frontend responses, command strings, shell history or temporary files.
- Provider CLI calls use isolated account profiles/environments, per-account session tokens and tests covering cross-account misuse attempts.
- CI includes dependency and code scanning, plus a documented release checklist for locked dependencies, provider CLI integrity and signed/reproducible release expectations.
- Bulk delivery requires a confirmation summary that includes credential name, source vault, delivery provider, recipient count, link mode, expiry and view limit, with an additional confirmation for large batches.
- Security docs and in-product copy avoid self-destruct claims and clearly state the limits of expiry, view limits and revocation.
- Risk-specific tests pass under `npm run check`, `npm test` and `npm run build`.

### Source

Added from the user-provided "Biggest risks for WardSen" risk review.

## Completed Phase 20: UI Responsiveness Regression Guards

Status: complete

### Problem

The first installer QA pass exposed UI friction and layout regressions: destructive confirmations were too hard to complete, content could force sideways overflow, and the left navigation could move with the page at desktop/tablet widths.

### Scope

- Guard destructive UI actions so they use an easier confirmation dialog while the backend still receives explicit confirmation phrases.
- Guard desktop shell CSS so the sidebar remains anchored and the workspace owns vertical scrolling.
- Guard responsive wrapping rules for metric grids, form grids and record rows.

### Acceptance Criteria

- `tests/uiRegression.test.ts` proves the UI no longer uses a typed destructive prompt helper.
- `tests/uiRegression.test.ts` proves the desktop shell uses independent sidebar/workspace scrolling.
- `tests/uiRegression.test.ts` proves compact viewports can wrap key content instead of overflowing horizontally.

## Completed Phase 21: RC10 Release Communication

Status: complete

### Problem

The next installer build needs release notes and install-facing documentation that match the build users will download, especially for the responsive layout and confirmation-flow fixes.

### Scope

- Update release notes to `v0.1.0-rc.10`.
- Add RC10 notes for anchored sidebar, responsive workspace and easier destructive confirmations.
- Refresh README status/release references from RC9 to RC10.

### Acceptance Criteria

- README status identifies `v0.1.0-rc.10` as the latest installer prerelease.
- Release notes include the UI fixes in the installer build.
- Changelog records the RC10 user-visible changes.

## Completed Phase 22: Missing Provider Tool Guidance

Status: complete

### Problem

Packaged users could see raw Node process errors such as `spawn bw ENOENT` when a required provider tool was not installed or not visible to WardSen.

### Scope

- Wrap missing provider executable failures in the shared CLI runner.
- Show provider-tool-specific frontend help instead of raw spawn errors.
- Add regression tests for missing CLI errors and frontend classification.

### Acceptance Criteria

- Missing `bw` and other provider executables produce actionable safe errors.
- Frontend error help identifies missing provider tools.
- Tests pass under `npm run check`, `npm test` and `npm run build`.

## Completed Phase 23: Sticky Error Toasts

Status: complete

### Problem

Action errors could scroll out of view while the user continued working down the page, hiding the cause and recovery step.

### Scope

- Make error notices sticky inside the scrollable workspace.
- Preserve existing compact error/retry behavior.
- Add regression coverage for sticky error styling.

### Acceptance Criteria

- Error notices stay visible while workspace content scrolls.
- Browser QA verifies the sticky notice remains in view after scrolling.
- Regression tests cover the sticky error rule.

## Completed Phase 24: Non-Terminal Provider Setup

Status: complete

### Problem

Provider setup guidance still assumed users understood CLI tools, terminal commands and PATH.

### Scope

- Add primary install/download actions for known missing provider tools.
- Link Bitwarden users to the official Bitwarden CLI install guide.
- Link KeePassXC users to the official KeePassXC download page.
- Keep terminal commands out of the primary recovery path.

### Acceptance Criteria

- Missing Bitwarden CLI errors include a clear official install-guide action.
- Missing KeePassXC CLI errors include a clear official download action.
- Error guidance says no terminal is required for the primary install path.
