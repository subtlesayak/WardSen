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

## About WardSen

WardSen is a local-first credential dispatch workspace for IT, operations, and security teams that need to provide time-bound access from a selected vault credential. It uses supported password-manager tools on the operator's device, creates provider-managed, short-lived delivery links where supported, and retains only the delivery metadata needed for audit, revocation, or replacement.

The password manager remains the source of truth. WardSen keeps credential plaintext in the local provider-and-localhost delivery path rather than its frontend or metadata database; it isolates provider sessions, auto-locks vault access, and requires exact confirmation for destructive work.

When each intended recipient receives a dedicated provider link, WardSen can report that the assigned link was accessed. It does not establish who opened it or which device they used unless the provider supplies verified telemetry. WardSen does not replace a password manager or add hidden recipient tracking.

## What It Does

- Retrieves credentials from Bitwarden or KeePassXC through their official local CLIs.
- Creates expiring links with Bitwarden Send, Password Pusher, Onetime Secret, or Yopass, and records only provider-supported recipient-link access signals without claiming human or device identity.
- Supports bulk dispatch, delivery revocation, replacement links, and metadata-only audit logs.
- Provides an employee request catalog for approved credential deliveries.
- Offers experimental Ente Paste manual handoff without sender-visible view, revoke, or device telemetry.

## Status

`v0.1.0-rc.56` is the current security-review release candidate. It remains unsigned; a trusted public installer release is still pending code signing and macOS notarization.

- **Scope:** Local-first credential dispatch, short-lived provider links, delivery audit signals, and employee request access.
- **Security:** Destructive actions require exact server-enforced confirmation; credential plaintext remains on the localhost backend.
- **Installers:** Windows MSI and macOS Apple Silicon DMG are unsigned review artifacts. A signed and notarized macOS build is required for normal use. Until then, the checksum-first macOS quarantine workaround below is required for a verified review copy.
- **Provider setup:** Bitwarden requires the official `bw` CLI. On macOS, install Node.js LTS if needed, install `@bitwarden/cli`, verify `bw --version`, then reopen WardSen.
- **Vault sessions:** New accounts auto-lock after ten minutes of inactivity. Unlocked vault rows show the remaining time; existing accounts keep their individually configured timeout.
- **Request protection:** Login, unlock, terminal handoff, employee code, and local API routes have layered rate limits to reduce brute-force and UI-loop abuse.
- **Secret handling:** Contributor guidance, ADRs, and release scans now use an explicit WardSen canary rule to catch accidental credential persistence outside the backend/provider path.

See the [current release notes](docs/release-notes/v0.1.0.md), [getting-started steps](#get-started), [security design](docs/security-design.md), and [installer signing guide](docs/installer-signing.md) for detail.

## Get Started

### First-Time Setup: No Node.js, `npm`, or `bw` Yet

WardSen does not bundle Bitwarden's command-line tool. Install it once on the operator machine that will open the vault; WardSen then keeps its own isolated local Bitwarden profile and does not ask for the master password in the app.

1. Install the current **Node.js LTS** release from [nodejs.org](https://nodejs.org/en/download). Node supplies `npm`, which installs the Bitwarden CLI.
2. Open a **new** terminal window and confirm both commands work:

   ```bash
   node -v
   npm -v
   ```

3. Install Bitwarden's official CLI:

   **Windows PowerShell or Command Prompt**

   ```powershell
   npm.cmd install -g @bitwarden/cli
   bw --version
   ```

   **macOS Terminal**

   ```bash
   npm install -g @bitwarden/cli
   bw --version
   ```

   If macOS reports `EACCES`, do not use `sudo`. Follow [npm's user-owned prefix guide](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/), then open a new Terminal and run `bw --version` again.

4. Fully quit WardSen, reopen it, then go to **Vaults**. Add a Bitwarden account with a label and email, keeping the ten-minute auto-lock unless your policy requires less.
5. Select that account in **Account Access**, choose **Terminal login / unlock**, paste the copied command into Terminal or PowerShell, and enter the Bitwarden password only at Bitwarden's own prompt. Return to WardSen after the command confirms the local session handoff; the account should change to **Unlocked** automatically.

For a new password-manager account, create and secure the Bitwarden account first through Bitwarden's official app or website, then use the steps above to connect WardSen. Never paste a Bitwarden password, session key, recovery code, or API token into WardSen, email, chat, or a support ticket.

### Release Users

Download the Windows MSI or macOS Apple Silicon DMG from [GitHub Releases](https://github.com/subtlesayak/WardSen/releases), together with its matching `SHA256SUMS-*.txt` file.

- **Windows:** Verify the checksum before running the MSI. Treat SmartScreen or Defender blocks as a reportable release issue.
- **macOS: Temporary required step until signed releases are available.** The current DMG is an unsigned review artifact, not a normal end-user installer. Verify its checksum and use it only for review testing. After dragging it to Applications, run this exact command in Terminal:

  ```bash
  xattr -dr com.apple.quarantine /Applications/WardSen.app
  ```

  This removes macOS quarantine for that local review copy. It is not equivalent to code signing or notarization; do not use it for an app you did not obtain from WardSen's verified release page.

### New Users

- Install only the provider tools you need. WardSen does not bundle Bitwarden's `bw` CLI or KeePassXC's `keepassxc-cli`.
- Enter Bitwarden passwords, approval codes, authenticator codes, and session tokens only into the visible official CLI prompt. Never put them in WardSen, chat, or a support ticket.
- Fully quit and reopen WardSen after any Bitwarden CLI installation or update.

### Prepare a People CSV with an AI Agent

WardSen can import contact records in **People** from a CSV. If your organization permits an approved AI agent to help clean a spreadsheet, provide only the minimum contact fields needed for import. Do not upload passwords, recovery codes, API keys, TOTP seeds, session tokens, employee IDs, addresses, personal notes, or other sensitive HR information.

Ask the agent to return CSV only, using this exact header:

```csv
name,phone,email,group,role,notes,active
```

Paste this prompt into the approved agent, then replace the bracketed text with a minimized source table:

```text
Convert the following employee contact list into RFC 4180-compatible CSV for WardSen.
Return CSV only, with this exact header and column order:
name,phone,email,group,role,notes,active

Rules:
- Keep only contact and work-organization information already in the source.
- Use true or false for active; use true when the source does not say the person is inactive.
- Leave unavailable optional cells empty.
- Escape commas, quotation marks, and line breaks correctly for CSV.
- Do not invent data.
- Omit passwords, recovery codes, API keys, TOTP seeds, session tokens, employee IDs, home addresses, and sensitive HR notes.

Source table:
[PASTE MINIMIZED CONTACT DATA HERE]
```

Review the generated CSV before importing it in **People**. People records are contacts only. Employee sign-in identities and their assigned email addresses are intentionally created and managed separately in **Requests**, so importing a People CSV never grants anyone access to credentials.

### Bitwarden CLI

WardSen uses Bitwarden through the official [`bw` CLI](https://bitwarden.com/help/cli/). On macOS, install Node.js LTS from [nodejs.org](https://nodejs.org/en/download), then run:

```bash
node -v && npm -v
npm install -g @bitwarden/cli
bw --version
```

If `npm install -g` reports `EACCES`, configure a user-owned npm prefix instead of using `sudo`: [npm's permission guide](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/). WardSen detects `~/.local/bin/bw` after a full app restart.

For the first sign-in, select **Terminal login / unlock** in WardSen and run the copied command in your system terminal. WardSen receives a one-time, in-memory local session handoff and changes the account to **Unlocked** automatically; it never asks for the Bitwarden password or code in the app.

In Vault Accounts, **Select** makes an account active in Account Access, **Sync** fetches its latest provider changes, and **Lock** removes its WardSen session and asks the provider to lock. Sync requires an unlocked account.

### Other Delivery Providers

Use **Settings > Provider Capabilities** to read each provider's requirements, open its official documentation, and run a local configuration check before creating a delivery. WardSen never accepts delivery-provider API tokens in the desktop UI.

- **Password Pusher:** set `WARDSEN_PASSWORD_PUSHER_API_TOKEN`; optionally set `WARDSEN_PASSWORD_PUSHER_BASE_URL` for a trusted HTTPS instance. It supports create, status checks and revoke, but does not provide a trustworthy access count or viewer identity.
- **Onetime Secret:** set `WARDSEN_ONETIME_SECRET_USERNAME` and `WARDSEN_ONETIME_SECRET_API_TOKEN`; optionally set `WARDSEN_ONETIME_SECRET_BASE_URL`. It supports one-time creation, receipt-status checks and burn/revoke, but not viewer identity or an exact access count.
- **Yopass:** install the official `yopass` CLI, verify `yopass --version`, and set `WARDSEN_YOPASS_CLI_PATH` when WardSen cannot discover it. It creates an encrypted one-time link, but the current CLI does not give WardSen status checks or sender-side revocation.
- **Ente Paste:** remains a manual clipboard/browser handoff. WardSen does not upload the paste or claim status, revoke, access-count, or viewer telemetry for it.

The selected **audit account** for non-Bitwarden delivery providers scopes WardSen's metadata only. It is not the source of the external provider credential. Configure those secrets only in the local service environment, then fully restart WardSen so its local service receives the updated environment.

Maintainers can run the opt-in disposable provider contracts in `tests/externalDeliveryProviders.live.test.ts`. Set only the matching `WARDSEN_PASSWORD_PUSHER_LIVE_TEST=true`, `WARDSEN_ONETIME_SECRET_LIVE_TEST=true`, or `WARDSEN_YOPASS_LIVE_TEST=true` environment switch before running the file. Yopass additionally requires `WARDSEN_YOPASS_LIVE_TEST_ALLOW_CREATE=true` because its current CLI cannot revoke the disposable link after creation. These tests use generated non-production values and do not print provider credentials or link secrets.

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
