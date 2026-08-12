# WardSen

[![CI](https://github.com/subtlesayak/WardSen/actions/workflows/ci.yml/badge.svg)](https://github.com/subtlesayak/WardSen/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520.19%20%7C%20%E2%89%A522.12-43853d.svg)](package.json)
[![Tauri 2](https://img.shields.io/badge/desktop-Tauri%202-2f6f63.svg)](apps/desktop/src-tauri/tauri.conf.json)
[![Local-first](https://img.shields.io/badge/security-local--first-165b49.svg)](docs/security-design.md)
[![No telemetry](https://img.shields.io/badge/privacy-no%20telemetry-31564a.svg)](PRIVACY.md)

Local-first credential dispatch for teams that need to create short-lived secure links from password-manager vaults without moving credential plaintext into a cloud backend.

WardSen is not a password manager. It retrieves credentials from supported password managers through official CLIs or APIs, creates secure expiring links through supported delivery providers, and keeps the sensitive credential content on the localhost backend only.

WardSen is an independent open-source project and is not affiliated with, endorsed by or sponsored by Bitwarden, 1Password, Proton, KeePassXC, Keeper or their respective companies.

## What It Does

- Retrieves credentials from Bitwarden or KeePassXC through their official local CLIs.
- Creates expiring Bitwarden Send links and records recipient-link access signals without claiming human or device identity.
- Supports bulk dispatch, delivery revocation, replacement links, and metadata-only audit logs.
- Provides an employee request catalog for approved credential deliveries.
- Offers experimental Ente Paste manual handoff without sender-visible view, revoke, or device telemetry.

## Status

`v0.1.0-rc.49` is the latest security-review prerelease.

- **Scope:** Local-first credential dispatch, short-lived provider links, delivery audit signals, and employee request access.
- **Security:** Destructive actions require exact server-enforced confirmation; credential plaintext remains on the localhost backend.
- **Installers:** Windows MSI and macOS Apple Silicon DMG are unsigned review artifacts. A signed and notarized macOS build is required for normal use; do not bypass Gatekeeper.
- **Provider setup:** Bitwarden requires the official `bw` CLI. On macOS, install Node.js LTS if needed, install `@bitwarden/cli`, verify `bw --version`, then reopen WardSen.

See the [current release notes](docs/release-notes/v0.1.0.md), [getting-started steps](#get-started), [security design](docs/security-design.md), and [installer signing guide](docs/installer-signing.md) for detail.

## Get Started

### Release Users

Download the Windows MSI or macOS Apple Silicon DMG from [GitHub Releases](https://github.com/subtlesayak/WardSen/releases), together with its matching `SHA256SUMS-*.txt` file.

- **Windows:** Verify the checksum before running the MSI. Treat SmartScreen or Defender blocks as a reportable release issue.
- **macOS:** The current DMG is an unsigned review artifact, not a normal end-user installer. Do not use `xattr`, `sudo xattr`, or another override if macOS says WardSen cannot be verified or is damaged.

### New Users

- Install only the provider tools you need. WardSen does not bundle Bitwarden's `bw` CLI or KeePassXC's `keepassxc-cli`.
- Enter Bitwarden passwords, approval codes, authenticator codes, and session tokens only into the visible official CLI prompt. Never put them in WardSen, chat, or a support ticket.
- Fully quit and reopen WardSen after any Bitwarden CLI installation or update.

### Bitwarden CLI

WardSen uses Bitwarden through the official [`bw` CLI](https://bitwarden.com/help/cli/). On macOS, install Node.js LTS from [nodejs.org](https://nodejs.org/en/download), then run:

```bash
node -v && npm -v
npm install -g @bitwarden/cli
bw --version
```

If `npm install -g` reports `EACCES`, configure a user-owned npm prefix instead of using `sudo`: [npm's permission guide](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/).

For the first sign-in, select **Terminal login / unlock** in WardSen and run the copied command in your system terminal. WardSen receives a one-time, in-memory local session handoff; it never asks for the Bitwarden password or code in the app.

## Maintainers

Release artifacts include installers, checksums, manifests, SBOMs, packaged-smoke evidence, and provenance evidence. A trusted public release requires Windows code signing plus Apple Developer ID signing and notarization.

See [desktop packaging](docs/desktop-packaging.md), [installer signing](docs/installer-signing.md), and the [release checklist](docs/release-security-checklist.md) for the complete process.

## Development

Requirements: Git, Node.js 20.19+ or 22.12+, and npm. Rust plus platform toolchains are needed only for desktop packaging.

```bash
git clone https://github.com/subtlesayak/WardSen.git
cd WardSen
npm ci
npm run dev
```

The local API runs on `http://127.0.0.1:4777`; the web interface runs on `http://127.0.0.1:5173`.

Before a change or release:

```bash
npm run check
npm test
npm run build
npm run security:scan-secrets
```

## Security

- No cloud backend, telemetry, or third-party frontend scripts.
- Credential plaintext and session tokens never enter SQLite, frontend responses, logs, or diagnostics.
- CLI commands use `spawn` with `shell: false`; output is bounded and timed-out command trees are terminated.
- Packaged desktop sessions use a per-launch local API token and prefer bundled or absolute trusted Node runtimes.

## Documentation

- [Current release notes](docs/release-notes/v0.1.0.md)
- [Security design](docs/security-design.md) and [threat model](THREAT_MODEL.md)
- [Employee request flow](docs/employee-request-flow.md)
- [Delivery provider comparison](docs/delivery-provider-comparison.md)
- [API reference](docs/api.md)
- [Desktop packaging](docs/desktop-packaging.md) and [installer signing](docs/installer-signing.md)
- [Release checklist](docs/release-security-checklist.md) and [RustSec notes](docs/rustsec-audit.md)
- [Third-party provider policy](docs/third-party-provider-policy.md)

## Independence

WardSen is an independent open-source compatibility layer. It is not affiliated with, endorsed by, sponsored by, or approved by Bitwarden, 1Password, Proton, KeePassXC, Keeper, or Ente. Users install and authenticate provider tools themselves; WardSen does not scrape vaults, use private APIs, or parse proprietary encrypted vault formats.
