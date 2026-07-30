# WardSen macOS Installer

WardSen's macOS bootstrap script verifies provider prerequisites, starts the development app, or builds the Tauri desktop package on a release machine.

## Prerequisites

- macOS 13 or later
- Node.js 20.19.0 or newer, or Node.js 22.12.0 or newer
- Homebrew for automatic prerequisite installation
- Xcode Command Line Tools for desktop packaging

Install Xcode Command Line Tools with:

```bash
xcode-select --install
```

## Provider Setup

Open Terminal inside the `WardSen` project folder before running installer commands. For example, clone or move the project under `~/Projects`, then run `cd ~/Projects/WardSen`.

```bash
./installers/macos/macos-install.sh --providers-only
```

The script verifies Node.js LTS and the Bitwarden CLI. It also installs KeePassXC through Homebrew Cask when Homebrew is available, because KeePassXC provider support uses `keepassxc-cli`.

## Desktop Package

Run this from inside the `WardSen` folder on the macOS release machine:

```bash
./installers/macos/macos-install.sh --package-desktop
```

This verifies Node.js, Bitwarden CLI, Xcode Command Line Tools and Rustup, then runs:

```bash
npm ci
npm run build:server
npm run build:web
npm run desktop:build
```

Tauri writes macOS artifacts under `apps/desktop/src-tauri/target/release/bundle`.

## Development Start

Run this from inside the `WardSen` folder:

```bash
./installers/macos/macos-install.sh --start
```

This starts the local server and Vite web interface for development. Open `http://127.0.0.1:5173` in your browser.

## Update Existing Checkout

```bash
./installers/macos/macos-update.sh
```

The update script refreshes npm dependencies and rebuilds WardSen's server, web interface and aggregate build targets.
