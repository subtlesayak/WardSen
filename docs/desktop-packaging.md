# Desktop Packaging

WardSen uses Tauri 2 for the desktop shell and keeps the API server bound to `127.0.0.1:4777`.

## Runtime Model

1. Tauri loads the built React app from `apps/web/dist`.
2. On startup, Tauri launches the bundled server artifact `server/index.cjs` with Node.js from an absolute trusted runtime path.
3. The web UI detects the Tauri origin and sends API requests to `http://127.0.0.1:4777`.
4. The server still rejects non-local Host headers and untrusted cross-origin mutations.
5. When the main window is destroyed, Tauri stops the child server process.

## Build Commands

```bash
npm run build:server
npm run build:web
npm run desktop:build
```

`npm run desktop:build` requires Rust and the native platform toolchain for the target operating system. The root `npm run build` keeps a lightweight desktop placeholder so regular TypeScript/web/server verification does not require every platform bundler.

## Output Structure

Tauri writes release artifacts under:

```text
apps/
  desktop/
    src-tauri/
      target/
        release/
          bundle/
```

Expected platform outputs:

```text
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

The exact filenames can vary by Tauri target, CPU architecture and signing settings. The release artifact should be the final installer file, such as the `.exe`, `.msi` or `.dmg`; the full `target`, `bundle`, `node_modules` and source checkout folders are build-machine internals.

See [installer signing](installer-signing.md) before publishing these artifacts to users.

## Release Upload Layout

A GitHub Release should contain a small set of named installer files, for example:

```text
WardSen_0.1.0_windows_x64-setup.exe
WardSen_0.1.0_windows_x64.msi
WardSen_0.1.0_macos_aarch64.dmg
WardSen_0.1.0_macos_x64.dmg
SHA256SUMS.txt
```

Users download one installer for their platform. They should not need to clone the repository, open a terminal or run npm commands when installing from a release.

## Windows Release Check

Windows release machines can use:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -PackageDesktop
```

CI runs `cargo check` for the Tauri shell on Windows after building the server and web artifacts.

## macOS Release Check

macOS release machines can use:

```bash
./installers/macos/macos-install.sh --package-desktop
```

CI runs `cargo check` for the Tauri shell on macOS after building the server and web artifacts.

## Packaged Resources

The Tauri bundle includes:

- React frontend: `apps/web/dist`
- Local API server: `apps/server/dist/index.cjs` as `server/index.cjs`

Node.js is required on the target machine for the current pre-1.0 package. Future release hardening can replace this with a native sidecar binary.

WardSen resolves Node.js from:

- `WARDSEN_NODE_PATH`, when set to an absolute executable path
- Standard Windows install locations under `Program Files`
- Standard Unix/macOS locations such as `/usr/local/bin/node`, `/opt/homebrew/bin/node` and `/usr/bin/node`

The desktop launcher does not run a bare `node` command through `PATH`.
