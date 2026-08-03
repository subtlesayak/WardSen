# WardSen macOS Installer

WardSen's macOS bootstrap script verifies provider prerequisites, starts the development app, or builds the Tauri desktop package on a release machine.

## Prerequisites

- macOS 13 or later
- Node.js 20.19.0 or newer, or Node.js 22.12.0 or newer
- Homebrew for automatic KeePassXC installation
- Xcode Command Line Tools for desktop packaging

Install Xcode Command Line Tools with:

```bash
xcode-select --install
```

## First Install From an Unsigned Prerelease DMG

Unsigned WardSen prerelease builds can trigger macOS Gatekeeper messages such as `"WardSen" is damaged and can't be opened`. This is expected for developer-preview builds that are not signed with Apple Developer ID and notarized.

After downloading the DMG from the WardSen GitHub release:

1. Open the DMG.
2. Drag WardSen into `/Applications`.
3. If macOS shows the damaged-app dialog, open Terminal and run:

```bash
xattr -dr com.apple.quarantine /Applications/WardSen.app
```

If Terminal prints `Operation not permitted`, run:

```bash
sudo xattr -dr com.apple.quarantine /Applications/WardSen.app
```

Enter the Mac login password when Terminal asks. Terminal does not show password characters while typing.

4. Open WardSen again from Applications.

Only use this bypass for a WardSen prerelease you intentionally downloaded from this repository. Public end-user releases should be signed and notarized instead.

## Provider Setup

Open Terminal inside the `WardSen` project folder before running installer commands. For example, clone or move the project under `~/Projects`, then run `cd ~/Projects/WardSen`.

```bash
./installers/macos/macos-install.sh --providers-only
```

The script verifies Node.js LTS and the Bitwarden CLI. If `bw` is missing, it installs the official `@bitwarden/cli` package with NPM. It also installs KeePassXC through Homebrew Cask when Homebrew is available, because KeePassXC provider support uses `keepassxc-cli`.

Official Bitwarden CLI options for macOS include the native macOS x64 executable and NPM. Bitwarden recommends NPM for arm64 devices such as Apple Silicon Macs:

```bash
npm install -g @bitwarden/cli
```

If you download the native macOS x64 executable from Bitwarden's guide and do not want to edit `PATH`, put it in WardSen's local tools folder, close and reopen WardSen, then verify from Terminal:

```bash
mkdir -p "$HOME/Library/Application Support/WardSen/tools"
cp "$HOME/Downloads/bw" "$HOME/Library/Application Support/WardSen/tools/bw"
chmod +x "$HOME/Library/Application Support/WardSen/tools/bw"
"$HOME/Library/Application Support/WardSen/tools/bw" --version
```

Alternatively, put the native executable in a permanent folder that is on `PATH`. Verify the setup in a new Terminal window:

```bash
bw --version
```

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

## Signing, Notarization and Verification

Set the Tauri signing and notarization environment variables before packaging:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Publisher Name (TEAMID)"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
export APPLE_API_KEY="ABC123DEFG"
export APPLE_API_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
./installers/macos/macos-install.sh --package-desktop
```

Verify the signed app bundle and stapled DMG artifacts:

```bash
./installers/macos/verify-macos-artifacts.sh
```

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
