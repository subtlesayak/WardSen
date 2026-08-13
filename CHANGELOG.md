# Changelog

## 0.1.0-rc.57 - 2026-08-13

- Added desktop-launched Bitwarden terminal handoff: WardSen now opens PowerShell on Windows or Terminal on macOS from an opaque one-time launch reference, with manual copy kept as fallback.
- Kept Bitwarden passwords and session tokens out of the app by fetching terminal commands through the trusted local desktop session and validating the command shape before opening a shell.
- Added generated employee delivery access codes for request fulfillment and replacement links when the selected delivery provider can enforce an access password.
- Added delivery metadata and audit tracking for access-code issuance and first observed access to code-protected deliveries.
- Improved responsive vault/account access layout and ensured body-less mutating API calls send an empty JSON object.

## 0.1.0-rc.56 - 2026-08-13

- Added open-source contribution rules for WardSen's local-first secret boundary, provider work, UI language, database/audit changes and release checks.
- Restored the full Apache-2.0 license text and added a project `NOTICE` file for clearer redistribution hygiene.
- Added ADR 0002 to record that credential secrets, provider sessions, delivery access passwords and secure URLs must not persist outside the provider/backend path.
- Extended `security:scan-secrets` with a WardSen canary prefix and regression coverage so release scans fail if synthetic credential material appears in generated artifacts.

## 0.1.0-rc.55 - 2026-08-13

- Added layered local API rate limits, including stricter limits for vault login, unlock, terminal handoff, terminal-handoff claim, and employee sign-in code endpoints.
- Hardened Ente Paste manual handoff so it copies only title, username and password, excludes URLs, TOTP secrets and notes, and uses opaque operation-based delivery IDs instead of credential-derived fingerprints.
- Improved People and Employee identity editing in the desktop UI while keeping employee assigned email immutable after creation.
- Renamed delivery-history copy actions from provider ID to delivery ID for clearer operator wording.
- Updated Fastify, Vite React plugin, tsx, React type packages, and release attestation action pins.
- Documented the remaining Rust/Tauri advisory compatibility blocker instead of suppressing Cargo resolver warnings.

## 0.1.0-rc.54 - 2026-08-12

- Reissued the verified `rc.53` session, auto-lock, vault-control and provider-capability updates with a CI-appropriate timeout for the locale date-format assertion used by delivery-audit coverage.

## 0.1.0-rc.53 - 2026-08-12

- Fixed Bitwarden terminal handoff status: after the terminal command succeeds, WardSen recognizes its memory-only session and refreshes the account to **Unlocked** without a manual status check or page refresh.
- Fixed Lock to clear WardSen's local session even when Bitwarden's CLI cannot report back. The lock command now uses the active Bitwarden session.
- Removed the normal-flow **Check terminal status** action. Account Access now uses **Refresh** only as a general data refresh.
- Added clear hover labels for vault actions: Select for account access, Sync latest provider changes, and Lock and remove WardSen session.
- Fixed Settings so Provider Capabilities change when the selected delivery provider changes.
- New vault accounts now default to a five-minute auto-lock. Unlocked vault rows show a live `Locks in M:SS` timer, and backend auto-lock enforcement runs at most five seconds after the timeout. Existing accounts keep their configured timeout.

## 0.1.0-rc.52 - 2026-08-12

- Fixed macOS Bitwarden CLI status checks after terminal login. Finder-launched WardSen now passes its already-running trusted Node.js runtime to npm-installed `bw` wrappers, preventing `env: node: No such file or directory` for vault search and Bitwarden Send.

## 0.1.0-rc.50 - 2026-08-12

- Fixed desktop recovery after a Force Quit: each packaged launch now selects a fresh loopback port and the UI obtains that exact trusted address from the desktop shell, so an orphaned prior service on port 4777 cannot receive the new desktop session's requests.
- Fixed macOS Bitwarden CLI discovery for npm's user-owned prefix. Vault search, Bitwarden Send, terminal fallback, and setup help now recognize `~/.local/bin/bw` after the official CLI is installed there.

### Safe Workarounds And Limits

- **macOS Gatekeeper:** this release's macOS DMG is an unsigned security-review artifact. There is no supported end-user workaround for a `cannot be verified` or `is damaged` warning. Do not use `xattr`, `sudo xattr`, or disable Gatekeeper; wait for a signed and notarized build.
- **macOS Bitwarden CLI `EACCES`:** use a user-owned npm prefix, not `sudo`: create `~/.local/bin`, run `npm config set prefix "$HOME/.local"`, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zprofile`, restart Terminal, install `@bitwarden/cli`, run `bw --version`, then fully quit and reopen WardSen.
- **Legacy rc.49 Force Quit state:** if a prior build reports an untrusted desktop session after Force Quit, run `lsof -nP -iTCP:4777 -sTCP:LISTEN` in Terminal. Only end the reported process after confirming it is WardSen's old local Node service, then reopen WardSen. `rc.50` avoids this fixed-port collision.

## 0.1.0 - 2026-07-30

- First-user install:
  - Windows users should download the unsigned MSI-only prerelease, verify `SHA256SUMS-windows-x64.txt`, and leave it quarantined if Microsoft Defender blocks it.
  - macOS Apple Silicon users should treat the unsigned DMG as a security-review artifact: verify its checksum, and do not bypass Gatekeeper or a damaged-app warning. A signed and notarized build is required for normal use.
  - Optional checksum verification is available through the attached `SHA256SUMS-*.txt` files.
- Initial open-source application foundation.
- Added provider-neutral credential and delivery architecture.
- Added Bitwarden, Bitwarden Send and KeePassXC adapter foundations.
- Added localhost-only API, React interface, SQLite persistence, batch/audit metadata, security docs, installer entrypoints and tests.
- Added clearer cross-origin error help, package updates, installer runtime checks and release artifact documentation.
- Fixed desktop recovery when the bundled local service is unreachable: the banner now restarts the service before retrying instead of repeating the same failed fetch.
- Added desktop service diagnostics for failed recovery, including process state, port reachability, bundled runtime presence, server bundle presence and short service output.
- Added a visible app version label in the desktop interface so screenshots identify the installed build.
- Fixed Windows packaged local-service startup by normalizing bundled Node paths, selecting a writable data directory, creating SQLite/profile folders before startup and allowing trusted desktop preflight requests before token-authenticated API calls.
- Added `v0.1.0-rc.10` release notes for the responsive layout and destructive-confirmation fixes.
- Fixed desktop/tablet layout so the left sidebar stays anchored while the workspace scrolls independently.
- Replaced difficult typed destructive prompts in the UI with a normal confirmation dialog while keeping server-side destructive confirmation phrases.
- Added `v0.1.0-rc.11` release notes and missing provider-tool guidance so raw `spawn bw ENOENT` failures become install/PATH help.
- Added `v0.1.0-rc.12` release notes and provider setup buttons for users who do not know CLI or terminal commands.
- Added `v0.1.0-rc.13` release notes and fixed provider setup buttons so packaged desktop builds open official install pages through the system browser.
- Documented the macOS unsigned-prerelease `"WardSen" is damaged and can't be opened` Gatekeeper recovery step for testers.
- Added `v0.1.0-rc.14` release notes with copyable provider setup links and in-app terminal recovery commands.
- Added `v0.1.0-rc.15` release notes and Bitwarden CLI setup help for Windows/macOS users, including native download PATH guidance, arm64/NPM guidance, Chocolatey and `bw --version` verification.
- Added `v0.1.0-rc.16` release notes and a third-party provider/trademark policy clarifying independent compatibility, user-installed provider tools and no provider endorsement.
- Added `v0.1.0-rc.34` release notes and Bitwarden Send account readiness checks so locked or logged-out delivery accounts show unlock guidance before `bw send` runs.
- Pulled the unsigned `v0.1.0-rc.34` Windows artifacts after Microsoft Defender flagged the setup EXE as `Trojan:Win32/Wacatac.B!ml`; Windows packaging remains suspended pending investigation.
- Added `v0.1.0-rc.35` release notes and changed Windows release packaging to unsigned MSI-only, without the NSIS setup EXE.
- Added `v0.1.0-rc.36` release notes and fixed Bitwarden Send so delivery commands use the same isolated WardSen Bitwarden profile as Vaults.
- Added `v0.1.0-rc.37` release notes and fixed credential delivery payloads so real password fields are preserved internally while errors stay redacted.
- Added `v0.1.0-rc.42` release notes with MSI prerelease publishing fixes, MSI-compatible RC package versions, stale-installer checksum guards, release provenance manifests, pinned release workflow actions, public signing-readiness gates, shared API contracts and cleaner desktop-session trust diagnostics.
- Added `v0.1.0-rc.43` release notes with the employee request catalog MVP, passwordless employee portal sessions, request-bound replacement links, delivery idempotency/recovery and Bitwarden Send operation lookup.
- Added `v0.1.0-rc.44` release notes and fixed the macOS release-test ordering assumption in the employee replacement-link coverage.
- Added `v0.1.0-rc.45` release notes with catalog auto-approval policies, break-glass request metadata, macOS Bitwarden CLI path discovery, visible macOS terminal unlock prompts and macOS DMG smoke checks.
