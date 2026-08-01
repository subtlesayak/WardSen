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

## Highlights

- Localhost-only Fastify API bound to `127.0.0.1`
- React/Vite desktop administration interface
- Tauri 2 desktop shell for packaged builds
- Bitwarden credential adapter through the official `bw` CLI
- Bitwarden Send delivery adapter through the official `bw` CLI
- KeePassXC credential adapter through `keepassxc-cli`
- Provider-neutral scaffolds for 1Password, Proton Pass and Keeper
- SQLite metadata persistence with safe audit logs
- Cross-origin mutation protection and user-facing error help
- Windows and macOS setup helpers

## Quick Links

- [Install from release](#install-from-release)
- [Install from source](#install-from-source)
- [Release artifact structure](#release-artifact-structure)
- [Signing a trusted release](#signing-a-trusted-release)
- [API docs](docs/api.md)
- [Desktop packaging](docs/desktop-packaging.md)
- [Installer signing](docs/installer-signing.md)
- [Third-party provider policy](docs/third-party-provider-policy.md)
- [Security design](docs/security-design.md)
- [Threat model](THREAT_MODEL.md)
- [Release checklist](docs/release-security-checklist.md)

## Status

`v0.1.0-rc.17` is the latest installer prerelease. It is suitable for developer review, security review and platform packaging validation.

Unsigned Windows x64 and macOS Apple Silicon installers are attached to the GitHub prerelease. Windows SmartScreen and macOS Gatekeeper may warn until signing certificates and notarization are configured. See [installer signing](docs/installer-signing.md) before publishing a fully trusted end-user release.

This release contains:

- Provider-neutral credential and delivery interfaces
- Bitwarden credential adapter using the official `bw` CLI
- Bitwarden Send delivery adapter using the official `bw` CLI
- KeePassXC credential adapter using the official `keepassxc-cli`
- Typed scaffolds for 1Password, Proton Pass and Keeper
- Localhost-only Fastify API
- React/Vite desktop administration interface
- SQLite migration contract
- Delivery batch and safe audit-log persistence
- Safe CLI process runner
- API coverage for accounts, people CSV, delivery retry, bulk batches and safe delivery history
- Tests for sessions, view limits, people pagination, SQLite persistence and CLI behavior
- Tauri desktop shell that starts the local API server in packaged builds
- Visible app version label for release/debug screenshots
- Windows desktop local-service startup fixes for bundled Node paths, writable data directories and trusted desktop preflight requests
- Responsive desktop layout with an anchored left sidebar and independently scrolling workspace
- Easier destructive-action confirmations in the UI while preserving server-side confirmation tokens
- Sticky floating error help that stays visible while workspace content scrolls
- Actionable missing provider-tool help when `bw`, `keepassxc-cli` or another CLI is not installed or not visible on `PATH`
- Provider setup errors include install/download buttons for users who do not know terminal commands
- Provider setup buttons open official install pages through the packaged desktop app's system-browser opener
- Provider setup errors include copyable install links and terminal recovery commands
- Bitwarden CLI setup help now explains Windows and macOS native downloads, WardSen local tools folders, PATH, arm64/NPM installs and `bw --version` verification
- Bitwarden provider errors now include safe CLI details and timeout guidance instead of leaving login stuck on a generic loading state
- Third-party provider and trademark policy documents that WardSen is independent, user-installed-provider-tool based and not endorsed by supported providers
- macOS first-install docs cover the unsigned-prerelease `"WardSen" is damaged and can't be opened` Gatekeeper message
- Windows and macOS prerequisite and desktop packaging scripts

## Install From Release

Most users should install WardSen from a release artifact, not from the source folder.

Go to [GitHub Releases](https://github.com/subtlesayak/WardSen/releases) and download the installer for your operating system:

- Windows: `WardSen_0.1.0_x64-setup.exe` or `WardSen_0.1.0_x64_en-US.msi`
- macOS Apple Silicon: `WardSen_0.1.0_aarch64.dmg`
- macOS Intel: not attached to `v0.1.0-rc.17`; maintainers can build it from the manual Intel workflow

Windows first install:

1. Download `WardSen_0.1.0_x64-setup.exe`.
2. Run the installer.
3. If Windows SmartScreen warns that the publisher is unknown, choose **More info** and then **Run anyway** only if you trust this prerelease.
4. Open WardSen from the Start menu.
5. If WardSen says it cannot reach the local service, click **Restart service and retry**. If the same message returns, read the **Desktop service check** lines in the error banner and share them with the maintainer.

macOS Apple Silicon first install:

1. Download `WardSen_0.1.0_aarch64.dmg`.
2. Open the DMG.
3. Drag WardSen into the Applications folder.
4. Open WardSen from Applications.
5. If macOS blocks the app because it is from an unidentified developer, go to **System Settings > Privacy & Security** and allow WardSen only if you trust this prerelease.
6. If macOS says `"WardSen" is damaged and can't be opened`, keep WardSen in Applications, open **Terminal**, run the command below, then open WardSen again:

```bash
xattr -dr com.apple.quarantine /Applications/WardSen.app
```

Only remove quarantine for the WardSen prerelease you intentionally downloaded from this repository. A signed and notarized release should not require this step.

Optional checksum verification:

1. Download `SHA256SUMS-windows-x64.txt` or `SHA256SUMS-macos-arm64.txt`.
2. Compare the checksum with the installer before opening it.

Release users do not need the `WardSen` source folder, `npm ci`, Git, Rust or a terminal. They may still need provider tools such as the Bitwarden CLI or KeePassXC, depending on which vault provider they want to connect.

### Bitwarden CLI Setup For Release Users

WardSen uses Bitwarden through the official `bw` command-line tool. Installing WardSen alone does not install `bw`.

Beginner-friendly Windows path:

1. In WardSen, when the missing Bitwarden tool message appears, click **Open Bitwarden CLI install guide**.
2. On Bitwarden's page, choose **Native Executable** and download **Windows x64**.
3. Create this folder if it does not exist: `%LOCALAPPDATA%\WardSen\tools`.
4. Copy `bw.exe` into `%LOCALAPPDATA%\WardSen\tools\bw.exe`.
5. Close and reopen WardSen.
6. To verify outside the app, open **Command Prompt** or **PowerShell** and run:

```powershell
& "$env:LOCALAPPDATA\WardSen\tools\bw.exe" --version
```

Windows PATH option:

1. Extract the downloaded ZIP into a permanent folder, for example `C:\Tools\Bitwarden CLI`.
2. Add that folder to your Windows `PATH`.
3. Close and reopen WardSen.
4. To verify, open **Command Prompt** or **PowerShell** and run:

```powershell
bw --version
```

Windows users who already have Node.js can use the in-app **Copy terminal command** button and run:

```powershell
npm install -g @bitwarden/cli
```

Windows users who already have Chocolatey can run:

```powershell
choco install bitwarden-cli
```

Beginner-friendly macOS path:

1. In WardSen, when the missing Bitwarden tool message appears, click **Open Bitwarden CLI install guide**.
2. On Bitwarden's page, choose **Native Executable** and download **macOS x64** if you are on an Intel Mac.
3. Create this folder if it does not exist: `~/Library/Application Support/WardSen/tools`.
4. Put the downloaded `bw` executable in that folder.
5. Close and reopen WardSen.
6. To verify outside the app, open **Terminal** and run:

```bash
"$HOME/Library/Application Support/WardSen/tools/bw" --version
```

macOS PATH option:

1. Put the downloaded executable in a permanent folder that is on your `PATH`.
2. Close and reopen WardSen.
3. To verify, open **Terminal** and run:

```bash
bw --version
```

For macOS Apple Silicon or other arm64 devices, Bitwarden recommends NPM for the CLI. Install Node.js first, then use the in-app **Copy terminal command** button or run:

```bash
npm install -g @bitwarden/cli
```

## Release Artifact Structure

Maintainers build installers from the source checkout. End users only receive the final installer file.

Build output stays on the release machine under:

```text
apps/
  desktop/
    src-tauri/
      target/
        release/
          bundle/
            nsis/
              WardSen_<version>_x64-setup.exe
            msi/
              WardSen_<version>_x64.msi
            dmg/
              WardSen_<version>_aarch64.dmg
              WardSen_<version>_x64.dmg
            macos/
              WardSen.app
```

Upload only the installer artifacts to GitHub Releases. Do not ask users to download the full `target` folder, `bundle` folder, source checkout, `node_modules` or build cache directories.

## Signing A Trusted Release

`v0.1.0-rc.17` is intentionally published as an unsigned prerelease. To publish a trusted release later, maintainers need Windows Authenticode signing for `.exe` and `.msi` files, plus Apple Developer ID signing and notarization for macOS `.dmg` files.

High-level signing path:

1. Obtain a Windows code-signing certificate and an Apple Developer ID Application certificate.
2. Add the required GitHub Actions secrets for Windows and macOS signing.
3. Set `MACOS_SIGNING_ENABLED=true` only after all Apple signing and notarization secrets are present.
4. Run the `Release Installers` workflow for a new RC tag.
5. Verify downloaded artifacts with `signtool`, `spctl`, `xcrun stapler` and the attached checksum files.
6. Promote a final non-prerelease only after signed assets are attached and verified.

See [installer signing](docs/installer-signing.md) for the exact secret names, local commands and GitHub Actions flow.

## Install From Source

### 1. Install prerequisites

Install these before running WardSen:

- Git
- Node.js 20.19.0 or newer, or Node.js 22.12.0 or newer
- npm, included with Node.js
- Bitwarden CLI, named `bw`, for Bitwarden vault and Send support. Official options include native Windows/macOS x64 executables, NPM and Chocolatey on Windows; Bitwarden recommends NPM for arm64 devices.
- KeePassXC, optional, for KeePassXC vault support
- Rust and platform build tools, only when building a desktop installer

On Windows, install Node.js LTS and Git first. The WardSen Windows helper can install provider tools through `winget`.

On macOS, install Node.js LTS, Git and Homebrew first. The WardSen macOS helper can install provider tools through Homebrew.

Packaged desktop builds stage the release machine's Node.js executable into the installer at build time. If that bundled runtime is unavailable, WardSen looks for Node.js in standard trusted install locations, such as `C:\Program Files\nodejs\node.exe` on Windows or `/usr/local/bin/node` on macOS, before starting its local service. For a custom runtime location, set `WARDSEN_NODE_PATH` to the absolute path of the Node executable before launching WardSen.

### 2. Get the code

Open a terminal in the folder where you keep projects.

Windows PowerShell example:

```powershell
cd C:\Projects
git clone https://github.com/subtlesayak/WardSen.git
cd WardSen
```

macOS or Linux terminal example:

```bash
cd ~/Projects
git clone https://github.com/subtlesayak/WardSen.git
cd WardSen
```

If you already downloaded or extracted the project, open the terminal inside the `WardSen` folder instead.

On Windows, one easy way is to open the `WardSen` folder in File Explorer, right-click empty space, and choose **Open in Terminal**. In VS Code, open the `WardSen` folder, then use **Terminal > New Terminal**.

### 3. Install packages

Run this from inside the `WardSen` folder:

```bash
npm ci
```

Use `npm install` only when intentionally changing package versions. Normal installs should use `npm ci` so the exact lockfile versions are used.

### 4. Start WardSen for development

Run:

```bash
npm run dev
```

The local API starts on `http://127.0.0.1:4777`.
The web interface starts on `http://127.0.0.1:5173`.

Open `http://127.0.0.1:5173` in your browser. Do not open the interface through another hostname, preview proxy or random web server, because WardSen blocks cross-origin state-changing requests for safety.

### 5. Verify the app

Run these from the `WardSen` folder:

```bash
npm run check
npm test
npm run build
```

## Platform Helpers

Windows provider setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -ProvidersOnly
```

Windows development start:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -Start
```

Windows desktop package:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -PackageDesktop
```

macOS provider setup:

```bash
./installers/macos/macos-install.sh --providers-only
```

macOS development start:

```bash
./installers/macos/macos-install.sh --start
```

macOS desktop package:

```bash
./installers/macos/macos-install.sh --package-desktop
```

## Commands

```bash
npm ci
npm run dev
npm run check
npm test
npm run build
npm run desktop:build
```

The server binds to `127.0.0.1:4777`. The Vite interface binds to `127.0.0.1:5173`.

See `docs/api.md` for the local API surface.
See `docs/desktop-packaging.md` for Tauri packaging details, `docs/installer-signing.md` for platform signing, `installers/windows/README.md` for Windows setup and `installers/macos/README.md` for macOS setup. The `Release Installers` GitHub Actions workflow can build Windows and macOS artifacts from a release tag or manual run.
See `docs/release-security-checklist.md` and `docs/rustsec-audit.md` before publishing public release artifacts.

## Security Principles

- No cloud backend
- No telemetry
- No third-party frontend scripts
- Sensitive credentials never return to the frontend
- Session tokens are kept in memory only
- Packaged desktop sessions use a per-launch local API token
- SQLite stores metadata, never passwords, TOTP secrets, secure notes, master passwords, access passwords or raw CLI output
- SQLite metadata files use owner-only POSIX modes where supported; full local database encryption is planned after the pre-1.0 release
- CLI commands use `spawn` with `shell: false`
- The desktop launcher starts bundled Node.js first, then absolute trusted runtime paths, never a bare `PATH` lookup

## Third-Party Provider Policy

WardSen is an independent compatibility layer. Product and provider names are used only to identify the user-selected service or locally installed provider tool.

WardSen does not claim affiliation with, endorsement by, sponsorship from or approval by Bitwarden, 1Password, Proton, KeePassXC, Keeper or their respective companies.

WardSen does not bundle Bitwarden binaries or provider logos. Users install provider tools such as `bw` themselves from the provider's own download page, package manager listing or documented install path. WardSen only calls those local tools after the user has installed and authenticated them.

WardSen does not use browser scraping, accessibility automation, reverse-engineered private APIs, unofficial browser extensions or direct parsing of proprietary encrypted vault formats.

See [third-party provider policy](docs/third-party-provider-policy.md) for the maintainer rules used before publishing a release.
