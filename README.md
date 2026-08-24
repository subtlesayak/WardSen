# WardSen

[![CI](https://github.com/subtlesayak/WardSen/actions/workflows/ci.yml/badge.svg)](https://github.com/subtlesayak/WardSen/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520.19%20%7C%20%E2%89%A522.12-43853d.svg)](package.json)
[![Tauri 2](https://img.shields.io/badge/desktop-Tauri%202-2f6f63.svg)](apps/desktop/src-tauri/tauri.conf.json)
[![Local-first](https://img.shields.io/badge/security-local--first-165b49.svg)](docs/security-design.md)
[![No telemetry](https://img.shields.io/badge/privacy-no%20telemetry-31564a.svg)](PRIVACY.md)

> **Local-first credential dispatch for teams.** Create time-bound delivery links from a password-manager vault without sending credential plaintext to a cloud backend.

WardSen is not a password manager. It uses supported local password-manager tools, creates short-lived links through supported delivery providers, and keeps credential plaintext in the local provider-to-localhost path only.

WardSen is an independent open-source project and is not affiliated with, endorsed by or sponsored by Bitwarden, 1Password, Proton, KeePassXC, Keeper or their respective companies.

## At a glance

| WardSen does | WardSen does not do |
| --- | --- |
| Retrieves a selected credential from a supported local vault. | Store vault plaintext, session tokens, or passwords in SQLite. |
| Creates expiring provider links and retains delivery metadata for audit, replacement, and revocation where supported. | Replace Bitwarden, KeePassXC, or another password manager. |
| Reports that an assigned link was accessed when a provider reports it. | Claim that a specific person or device opened a link without provider-verified telemetry. |

The password manager remains the source of truth. WardSen isolates provider sessions, auto-locks vault access, and requires exact server-enforced confirmation for destructive work.

## How it works

1. **Connect a vault** on the operator's device.
2. **Find a credential** without exposing it to the frontend or metadata database.
3. **Create a short-lived delivery** for a person, request, or simple copy handoff.
4. **Audit, replace, or revoke** the delivery when the chosen provider supports that lifecycle action.

For dedicated recipient links, say **"Asha's link was viewed"**, not **"Asha viewed it."** A provider link proves only that the assigned link was accessed unless the provider supplies verified identity telemetry.

## Release status

`v0.1.0-rc.65` is the current security-review release candidate. A trusted public installer release still requires Windows code signing and Apple Developer ID signing plus macOS notarization.

| Area | Current position |
| --- | --- |
| Security | Destructive actions have exact server-enforced confirmation; plaintext remains on the localhost backend. |
| Vaults | New accounts auto-lock after ten minutes of inactivity and show the remaining unlocked time. |
| Providers | Bitwarden needs the official `bw` CLI. Other delivery providers are configured in the local service environment. |
| Review installers | Windows MSI and macOS Apple Silicon DMG remain unsigned review artifacts. |

See the [current release notes](docs/release-notes/v0.1.0.md), [security design](docs/security-design.md), and [installer signing guide](docs/installer-signing.md) for detail.

## Get started

### 1. Install WardSen

Download the Windows MSI or macOS Apple Silicon DMG from [GitHub Releases](https://github.com/subtlesayak/WardSen/releases), together with its matching `SHA256SUMS-*.txt` file.

- **Windows:** verify the checksum before running the MSI. Treat SmartScreen or Defender blocks as a reportable release issue.
- **macOS:** verify the checksum before opening the DMG.

> [!WARNING]
> Current macOS builds are unsigned review artifacts, not normal end-user installers. Until signed and notarized releases are available, use them only for verified review testing. After dragging WardSen to Applications, run this exact command in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/WardSen.app
```

This removes macOS quarantine for that local review copy. It is not code signing or notarization. Do not run it for an app you did not obtain from WardSen's verified release page.

### 2. Connect a Bitwarden vault

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
5. Select that account in **Account Access** and choose **Terminal login / unlock**. The packaged WardSen desktop app opens Terminal on macOS or PowerShell on Windows and starts the short-lived handoff command. Enter the Bitwarden password only at Bitwarden's own prompt. If terminal launch is unavailable, use **Copy terminal command** and run it manually. Return to WardSen after the command confirms the local session handoff; the account should change to **Unlocked** automatically.

For a new password-manager account, create and secure the Bitwarden account first through Bitwarden's official app or website, then use the steps above to connect WardSen. Never paste a Bitwarden password, session key, recovery code, or API token into WardSen, email, chat, or a support ticket.

### 3. Send and manage a delivery

1. Search an unlocked vault and select the credential summary you need.
2. Choose a delivery provider and recipient, or use the simple copy option when no person is selected.
3. Set the expiry and access limit, then create the delivery.
4. Open **Delivery History** or **Delivery Audit** to refresh supported provider status, copy the handoff, replace a delivery, or revoke it.

**People** are contact records only. **Requests** contains separately managed employee sign-in identities and assigned email addresses. Importing People never grants credential access.

## Import people safely

WardSen imports People contact records from CSV. Use this exact header:

```csv
name,phone,email,group,role,notes,active
```

<details>
<summary><strong>Use an approved AI agent to prepare a contact CSV</strong></summary>

Give an approved agent only the minimum contact and work-organization fields required for import. Do not upload passwords, recovery codes, API keys, TOTP seeds, session tokens, employee IDs, home addresses, or sensitive HR notes.

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
</details>

<details>
<summary><strong>Bitwarden troubleshooting and vault controls</strong></summary>

WardSen uses Bitwarden through the official [`bw` CLI](https://bitwarden.com/help/cli/). If `npm install -g` reports `EACCES` on macOS, configure a user-owned npm prefix instead of using `sudo`: [npm's permission guide](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/). WardSen detects `~/.local/bin/bw` after a full app restart.

Enter Bitwarden passwords, approval codes, authenticator codes, and session tokens only in Bitwarden's visible CLI prompt. WardSen never asks for them in the app. After installing or updating `bw`, fully quit and reopen WardSen.

In Vault Accounts, **Select** makes an account active in Account Access, **Sync** fetches its latest provider changes, and **Lock** removes its WardSen session and asks the provider to lock. Sync requires an unlocked account.
</details>

## Delivery providers

Open **Settings > Provider Capabilities** for provider requirements, official documentation, and a local configuration check. WardSen never accepts provider API tokens in the desktop UI; configure them in the local service environment, then fully restart WardSen.

| Provider | Setup | WardSen lifecycle support |
| --- | --- | --- |
| **Bitwarden Send** | Install and unlock the official `bw` CLI. | Create, status, access count, revoke. |
| **Password Pusher** | Set `WARDSEN_PASSWORD_PUSHER_API_TOKEN`. Optionally set `WARDSEN_PASSWORD_PUSHER_BASE_URL` for a trusted HTTPS instance. | Create, status, revoke. No trustworthy access count or viewer identity. |
| **Onetime Secret** | Set `WARDSEN_ONETIME_SECRET_USERNAME` and `WARDSEN_ONETIME_SECRET_API_TOKEN`. Optionally set `WARDSEN_ONETIME_SECRET_BASE_URL`. | Create, receipt status, burn/revoke. No viewer identity or exact access count. |
| **Yopass** | Install the official `yopass` CLI. Run `yopass --version`; set `WARDSEN_YOPASS_CLI_PATH` only when discovery fails. | Disabled by default. Create only after an operator review and exact opt-in; the current CLI has no status lookup or sender-side revocation. |
| **Ente Paste** | Manual clipboard and browser handoff. | Disabled by default. Experimental manual handoff only after an operator review and exact opt-in; no WardSen upload, status, revoke, access-count, or viewer telemetry. |

For non-Bitwarden delivery providers, the selected **audit account** scopes WardSen metadata only. It is not the source of the external provider credential.

Ente Paste and Yopass are intentionally absent from normal delivery selection until enabled in **Settings > Optional Delivery Providers**. Their warning is not a claim about the recipient: WardSen cannot use either integration to prove viewer identity, device, IP address, user-agent, access count, or link lifecycle state.

<details>
<summary><strong>Run the opt-in external-provider contract tests</strong></summary>

The disposable contracts live in `tests/externalDeliveryProviders.live.test.ts`. Set only the matching `WARDSEN_PASSWORD_PUSHER_LIVE_TEST=true`, `WARDSEN_ONETIME_SECRET_LIVE_TEST=true`, or `WARDSEN_YOPASS_LIVE_TEST=true` switch before running that file. Yopass also requires `WARDSEN_YOPASS_LIVE_TEST_ALLOW_CREATE=true` because the current CLI cannot revoke the disposable link. The tests use generated non-production values and do not print provider credentials or link secrets.
</details>

## Develop and maintain

### Development

Requirements: Git, Node.js 20.19+ or 22.12+, and npm. Rust plus platform toolchains are needed only for desktop packaging.

```bash
git clone https://github.com/subtlesayak/WardSen.git
cd WardSen
npm ci
npm run dev
```

The local API runs on `http://127.0.0.1:4777`; the web interface runs on `http://127.0.0.1:5173`.

Run this before a change or release:

```bash
npm run check
npm test
npm run build
npm run security:test-canary
npm run security:scan-secrets
```

### Release work

Release evidence includes installers, checksums, manifests, SBOMs, packaged-smoke evidence, and provenance evidence. A trusted public release requires Windows code signing plus Apple Developer ID signing and notarization.

Follow [desktop packaging](docs/desktop-packaging.md), [installer signing](docs/installer-signing.md), and the [release checklist](docs/release-security-checklist.md).

## Security model

| Boundary | Protection |
| --- | --- |
| Data | No cloud backend, telemetry, or third-party frontend scripts. Credential plaintext and session tokens never enter SQLite, frontend responses, logs, or diagnostics. |
| Provider tools | CLI commands use `spawn` with `shell: false`; output is bounded and timed-out command trees are terminated. |
| Desktop service | Packaged sessions use a per-launch local API token held by the desktop runtime. The webview uses a bounded local-service proxy rather than a wildcard localhost connection, and the app prefers bundled or absolute trusted Node runtimes. |
| Sensitive actions | Login, unlock, terminal handoff, employee code, and local API routes have layered rate limits. Destructive actions require exact server confirmation. |
| Safety review | Destructive actions fetch an operator-visible impact preview before the exact confirmation phrase is accepted. Generated canaries prove provider errors do not leak into SQLite, audit/API output, diagnostics, or release-scanned web assets. |

## Project hygiene

WardSen is released under the [Apache-2.0 license](LICENSE). See [NOTICE](NOTICE) for distribution notices, [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor security bar, and [ADR 0002](docs/adr/0002-no-secret-persistence.md) for the no-secret-persistence decision.

## Documentation

| Need | Read |
| --- | --- |
| Security model and privacy | [Security design](docs/security-design.md), [threat model](THREAT_MODEL.md), [privacy policy](PRIVACY.md) |
| Employee access workflow | [Employee request flow](docs/employee-request-flow.md) |
| Provider behavior | [Delivery provider comparison](docs/delivery-provider-comparison.md), [third-party provider policy](docs/third-party-provider-policy.md) |
| Provider diagnostics | **Settings > Provider Capabilities** shows local CLI/API readiness, account/session state, capability support, and link-preview risk without exposing environment values. |
| API and desktop packaging | [API reference](docs/api.md), [desktop packaging](docs/desktop-packaging.md) |
| Release evidence and advisories | [Release checklist](docs/release-security-checklist.md), [RustSec notes](docs/rustsec-audit.md) |

## Independence

WardSen is an independent open-source compatibility layer. It is not affiliated with, endorsed by, sponsored by, or approved by Bitwarden, 1Password, Proton, KeePassXC, Keeper, or Ente. Users install and authenticate provider tools themselves; WardSen does not scrape vaults, use private APIs, or parse proprietary encrypted vault formats.
