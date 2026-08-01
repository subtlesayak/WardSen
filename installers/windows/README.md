# WardSen Windows Installer

WardSen's Windows bootstrap script installs provider prerequisites and can build the Tauri desktop package on a release machine.

## Prerequisites

- Windows 10 or later
- PowerShell 5.1 or later
- Node.js 20.19.0 or newer, or Node.js 22.12.0 or newer
- `winget` for automatic prerequisite installation

## Provider Setup

Open PowerShell inside the `WardSen` project folder before running installer commands. In File Explorer, open the `WardSen` folder, right-click empty space, and choose **Open in Terminal**. In VS Code, open the `WardSen` folder, then use **Terminal > New Terminal**.

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -ProvidersOnly
```

The script verifies Node.js LTS and the Bitwarden CLI. By default it installs `bw` through `winget`.

For a pinned release-asset download instead, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -ProvidersOnly -DownloadBitwardenCli
```

That mode queries the current Bitwarden CLI release, requires SHA-256 integrity data, verifies the downloaded archive, and expands it under `.wardsen-providers\bin`.

## Desktop Package

Run this from inside the `WardSen` folder on the Windows release machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -PackageDesktop
```

This verifies Node.js, Bitwarden CLI and Rustup, then runs:

```powershell
npm ci
npm run build:server
npm run build:web
npm run desktop:build
```

Tauri writes Windows artifacts under `apps\desktop\src-tauri\target\release\bundle`.

## Signing and Verification

After a release build, sign every Windows installer artifact with either a certificate-store certificate:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\sign-windows-artifacts.ps1 -PublisherName "Publisher Name" -TimestampUrl "https://timestamp.example.com"
```

Or a PFX file supplied outside Git:

```powershell
$env:WINDOWS_CERTIFICATE_PASSWORD = "..."
powershell -ExecutionPolicy Bypass -File .\installers\windows\sign-windows-artifacts.ps1 -PfxPath ".\certs\wardsen-code-signing.pfx" -TimestampUrl "https://timestamp.example.com"
```

Verify already signed artifacts:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\verify-windows-artifacts.ps1
```

Generate checksums for release upload:

```powershell
npm run release:checksums
```

## Development Start

Run this from inside the `WardSen` folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -Start
```

This starts the local server and Vite web interface for development. Open `http://127.0.0.1:5173` in your browser.
