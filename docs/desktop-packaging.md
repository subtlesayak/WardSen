# Desktop Packaging

WardSen uses Tauri 2 for the desktop shell and keeps the API server bound to `127.0.0.1:4777`.

## Runtime Model

1. Tauri loads the built React app from `apps/web/dist`.
2. Before the Tauri Rust build and again before bundling, WardSen stages the release-machine Node.js executable under `apps/desktop/src-tauri/gen/runtime`.
3. On startup, Tauri launches the bundled server artifact `server/index.cjs` with the bundled Node.js runtime when present.
4. If the bundled runtime is unavailable, WardSen falls back to `WARDSEN_NODE_PATH` and then trusted system install locations.
5. The web UI detects the Tauri origin and sends API requests to `http://127.0.0.1:4777`.
6. The server still rejects non-local Host headers and untrusted cross-origin mutations.
7. When the main window is destroyed, Tauri stops the child server process.

## Data Persistence Across Updates

WardSen account metadata lives in the local SQLite file `wardsen.sqlite`, with provider profile folders under `profiles/` in the same data root. Desktop startup must preserve that data across app updates.

The desktop launcher and server both check update-era data root candidates before opening SQLite. The configured root remains the preferred stable location, but if an older WardSen app-data root contains more persisted records, WardSen uses that root or migrates it into the configured empty root. During migration, WardSen copies `profiles/` and rewrites stored `profile_directory` values from the old profile root to the new one.

Release upgrade testing should verify that vault accounts created before an update are still listed after installing the new app version. An update that opens with an empty account list while an older `wardsen.sqlite` still exists is a release blocker.

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
WardSen_0.11.4_windows_x64.msi
WardSen_0.11.4_macos_aarch64.dmg
WardSen_0.11.4_macos_x64.dmg
SHA256SUMS.txt
RELEASE-MANIFEST.json
WARDSEN-SBOM.json
SIGNING-EVIDENCE.json
ATTESTATION-SUBJECTS.txt
PROVENANCE-EVIDENCE.json
INSTALL-LIFECYCLE-EVIDENCE.json
```

Users download one installer for their platform. They should not need to clone the repository, open a terminal or run npm commands when installing from a release.

Each platform build also produces `SHA256SUMS-<platform>.txt`, `RELEASE-MANIFEST-<platform>.json`, `WARDSEN-SBOM-<platform>.json`, `PACKAGED-SMOKE-<platform>.json`, formal GitHub attestation subjects/evidence and, for signed artifacts, `SIGNING-EVIDENCE-<platform>.json`. The manifest records schema version, package version, release tag, verified git SHA, UTC build timestamp, bundle root and artifact hashes.

Each release builder also runs:

```bash
npm run smoke:packaged
```

The packaged smoke check verifies the Tauri resource contract, the built web bundle, the prepared Node.js runtime, and the built server bundle. It starts `apps/server/dist/index.cjs` on a fresh strict temporary data root with a desktop API token, confirms unauthenticated requests are rejected, confirms built-in providers load, writes one metadata-only account, forcibly terminates the server, restarts it against that same isolated root, and confirms that one account is recovered. Attach `PACKAGED-SMOKE-<platform>.json` beside the SBOM, checksum and manifest files.

Final public release builds also run:

```bash
npm run release:verify-evidence
```

When `WARDSEN_PUBLIC_RELEASE=true`, this verifier fails unless every installer in `RELEASE-MANIFEST.json` is covered by matching `SIGNING-EVIDENCE-<platform>.json` created after `signtool`, `codesign`, `spctl` and notarization verification.

Before publishing a final installer, run the platform-specific lifecycle harness on a disposable test machine with the previous and current installers. It verifies a fresh install, launch, upgrade, preserved vault account metadata and uninstall, then writes `INSTALL-LIFECYCLE-EVIDENCE-<platform>.json` beside the installer. Regenerate checksums, then use `WARDSEN_INSTALL_LIFECYCLE_REQUIRED=true npm run release:verify-evidence` to ensure that the evidence matches the final installer hash. This proof cannot be created by a source-only build or substituted with a CI smoke record.

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
- Node.js runtime: `apps/desktop/src-tauri/gen/runtime/node.exe` as `runtime/node.exe` on Windows, or `apps/desktop/src-tauri/gen/runtime/node` as `runtime/node` on macOS/Linux

Release packages stage Node.js from the release machine before bundling. `apps/desktop/src-tauri/gen/` is generated and ignored by Git; do not commit the runtime binary.

WardSen resolves Node.js from:

- Bundled desktop resource `runtime/node.exe` on Windows or `runtime/node` on macOS/Linux, when present
- `WARDSEN_NODE_PATH`, when set to an absolute executable path
- Standard Windows install locations under `Program Files`
- Standard Unix/macOS locations such as `/usr/local/bin/node`, `/opt/homebrew/bin/node` and `/usr/bin/node`

The desktop launcher does not run a bare `node` command through `PATH`.
