# WardSen

WardSen is a local-first credential dispatch hub for password managers and secure-sharing providers.

WardSen is not a password manager. It retrieves credentials from supported password managers through official CLIs or APIs, creates secure expiring links through supported delivery providers, and keeps the sensitive credential content on the localhost backend only.

WardSen is an independent open-source project and is not affiliated with, endorsed by or sponsored by Bitwarden, 1Password, Proton, KeePassXC, Keeper or their respective companies.

## Status

This repository contains the first production-oriented application foundation:

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
- Windows and macOS prerequisite and desktop packaging scripts

## Install From Release

Most users should install WardSen from a release artifact, not from the source folder.

On GitHub Releases, download the installer for your operating system:

- Windows: `WardSen_<version>_x64-setup.exe` or `WardSen_<version>_x64.msi`
- macOS Apple Silicon: `WardSen_<version>_aarch64.dmg`
- macOS Intel: `WardSen_<version>_x64.dmg`

After downloading:

1. Run the Windows `.exe` or `.msi`, or open the macOS `.dmg`.
2. Install WardSen into the normal Applications or Program Files location.
3. Open WardSen from the Start menu, Applications folder or launcher.

Release users do not need the `WardSen` source folder, `npm ci`, Git, Rust or a terminal. They may still need provider tools such as the Bitwarden CLI or KeePassXC, depending on which vault provider they want to connect.

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

## Install From Source

### 1. Install prerequisites

Install these before running WardSen:

- Git
- Node.js 20.19.0 or newer, or Node.js 22.12.0 or newer
- npm, included with Node.js
- Bitwarden CLI, named `bw`, for Bitwarden vault and Send support
- KeePassXC, optional, for KeePassXC vault support
- Rust and platform build tools, only when building a desktop installer

On Windows, install Node.js LTS and Git first. The WardSen Windows helper can install provider tools through `winget`.

On macOS, install Node.js LTS, Git and Homebrew first. The WardSen macOS helper can install provider tools through Homebrew.

### 2. Get the code

Open a terminal in the folder where you keep projects.

Windows PowerShell example:

```powershell
cd D:\Projects
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
See `docs/desktop-packaging.md` for Tauri packaging details, `installers/windows/README.md` for Windows setup and `installers/macos/README.md` for macOS setup.
See `docs/release-security-checklist.md` before publishing public release artifacts.

## Security Principles

- No cloud backend
- No telemetry
- No third-party frontend scripts
- Sensitive credentials never return to the frontend
- Session tokens are kept in memory only
- SQLite stores metadata, never passwords, TOTP secrets, secure notes, master passwords, access passwords or raw CLI output
- CLI commands use `spawn` with `shell: false`

## Provider Requirements

WardSen uses official provider tooling only. It does not use browser scraping, accessibility automation, reverse-engineered APIs, unofficial browser extensions or direct parsing of proprietary encrypted vault formats.
