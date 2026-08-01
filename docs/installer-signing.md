# Installer Signing

WardSen release installers should be signed before a public release is published. Signing is separate from building: Tauri creates the `.exe`, `.msi`, `.dmg` or `.app`, then the platform signing system proves who produced it and whether it was modified after signing.

## Current Release State

`v0.1.0-rc.16` is published as an unsigned prerelease with Windows x64 and macOS Apple Silicon installer artifacts attached. Treat it as a validation build, not a fully trusted end-user release.

Do not promote a final `v0.1.0` or "latest" release until Windows Authenticode signing and macOS Developer ID notarization are configured and verified, or until the release clearly states that the installers are unsigned.

Unsigned macOS DMGs can show `"WardSen" is damaged and can't be opened` after Safari downloads them. That is macOS quarantine/Gatekeeper blocking an unnotarized app. Testers who intentionally downloaded the WardSen prerelease can remove quarantine after dragging the app to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/WardSen.app
```

This is a tester workaround, not a substitute for signing and notarization.

## Maintainer Signing Quick Start

Use this path when preparing a signed update after the unsigned `v0.1.0-rc.16` validation release.

### 1. Get signing identities

Windows:

1. Buy or obtain a Windows code-signing certificate from a trusted certificate authority.
2. Export the certificate as a password-protected `.pfx` file, or install it into the Windows certificate store on the release machine.
3. Get the timestamp URL from the certificate authority.

macOS:

1. Join the Apple Developer Program.
2. Create a **Developer ID Application** certificate.
3. Export it as a password-protected `.p12` file for CI, or install it in the login keychain on a macOS release machine.
4. Create an App Store Connect API key with notarization access and download the `.p8` private key once.

Never commit certificate files, private keys, API keys or passwords to the repository.

### 2. Configure GitHub repository secrets

Open the GitHub repository, then go to **Settings > Secrets and variables > Actions**.

Add Windows secrets:

- `WINDOWS_CERTIFICATE_BASE64`: base64 text of the `.pfx` file
- `WINDOWS_CERTIFICATE_PASSWORD`: password for the `.pfx` file
- `WINDOWS_TIMESTAMP_URL`: timestamp server URL from the certificate authority

Add macOS secrets:

- `APPLE_CERTIFICATE`: base64 text of the `.p12` Developer ID Application certificate
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12` file
- `APPLE_SIGNING_IDENTITY`: exact identity, such as `Developer ID Application: Publisher Name (TEAMID)`
- `APPLE_API_ISSUER`: App Store Connect issuer UUID
- `APPLE_API_KEY`: App Store Connect key ID
- `APPLE_API_KEY_P8`: full contents of the downloaded `AuthKey_*.p8` file

After all macOS secrets are present, add repository variable:

- `MACOS_SIGNING_ENABLED`: `true`

Keep `MACOS_SIGNING_ENABLED` unset or any value other than `true` until the Apple certificate and notarization key are complete. The workflow intentionally builds unsigned macOS artifacts when this variable is not `true`.

### 3. Run a signed release candidate

1. Create or choose the next release candidate tag, such as `v0.1.0-rc.16`.
2. Push the tag, or open **Actions > Release Installers > Run workflow**.
3. Enter the tag.
4. Keep `prerelease` enabled.
5. Wait for Windows x64 and macOS Apple Silicon jobs to finish.
6. Confirm the GitHub release remains marked as a prerelease until signature checks pass.

### 4. Verify downloaded artifacts

Download the release assets from GitHub on clean machines and verify them.

Windows:

```powershell
signtool verify /pa /v .\WardSen_0.1.0_x64-setup.exe
signtool verify /pa /v .\WardSen_0.1.0_x64_en-US.msi
```

macOS:

```bash
spctl --assess --type open --verbose WardSen_0.1.0_aarch64.dmg
xcrun stapler validate WardSen_0.1.0_aarch64.dmg
```

Also compare each installer against the matching `SHA256SUMS-*.txt` file.

### 5. Promote the final release

1. Update the release notes so they no longer call the installers unsigned.
2. Tag the final release only after verification passes.
3. Run the release workflow for the final tag, or upload the verified signed assets with `gh release upload --clobber`.
4. Mark the final release as non-prerelease only after the signed Windows and macOS artifacts are attached.

## Windows

Windows signing uses Authenticode. Sign the final setup `.exe` and `.msi` artifacts after Tauri builds them.

### What You Need

- Windows release machine or Windows CI runner
- Visual Studio Build Tools with MSVC and Windows SDK
- Rust through `rustup`
- Windows code-signing certificate
- `signtool.exe`, included with the Windows SDK
- Timestamp server URL from the certificate authority

### Build

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\windows-install.ps1 -PackageDesktop
```

Expected output folder:

```text
apps\desktop\src-tauri\target\release\bundle\
```

### Sign With a Certificate in the Windows Certificate Store

```powershell
signtool sign /n "Publisher Name" /fd SHA256 /tr "https://timestamp.example.com" /td SHA256 "apps\desktop\src-tauri\target\release\bundle\nsis\WardSen_0.1.0_x64-setup.exe"
signtool sign /n "Publisher Name" /fd SHA256 /tr "https://timestamp.example.com" /td SHA256 "apps\desktop\src-tauri\target\release\bundle\msi\WardSen_0.1.0_x64.msi"
```

WardSen also includes a helper that signs every `.exe` and `.msi` under the bundle folder and then verifies each artifact:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\sign-windows-artifacts.ps1 -PublisherName "Publisher Name" -TimestampUrl "https://timestamp.example.com"
```

### Sign With a PFX File

```powershell
signtool sign /f ".\certs\wardsen-code-signing.pfx" /p "$env:WINDOWS_CERTIFICATE_PASSWORD" /fd SHA256 /tr "https://timestamp.example.com" /td SHA256 "apps\desktop\src-tauri\target\release\bundle\nsis\WardSen_0.1.0_x64-setup.exe"
signtool sign /f ".\certs\wardsen-code-signing.pfx" /p "$env:WINDOWS_CERTIFICATE_PASSWORD" /fd SHA256 /tr "https://timestamp.example.com" /td SHA256 "apps\desktop\src-tauri\target\release\bundle\msi\WardSen_0.1.0_x64.msi"
```

Helper equivalent:

```powershell
$env:WINDOWS_CERTIFICATE_PASSWORD = "..."
powershell -ExecutionPolicy Bypass -File .\installers\windows\sign-windows-artifacts.ps1 -PfxPath ".\certs\wardsen-code-signing.pfx" -TimestampUrl "https://timestamp.example.com"
```

### Verify

```powershell
signtool verify /pa /v "apps\desktop\src-tauri\target\release\bundle\nsis\WardSen_0.1.0_x64-setup.exe"
signtool verify /pa /v "apps\desktop\src-tauri\target\release\bundle\msi\WardSen_0.1.0_x64.msi"
```

Helper equivalent:

```powershell
powershell -ExecutionPolicy Bypass -File .\installers\windows\verify-windows-artifacts.ps1
```

### CI Secrets

If signing in GitHub Actions, store certificate material only as encrypted repository secrets.

Recommended secret names:

- `WINDOWS_CERTIFICATE_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_TIMESTAMP_URL`

Never commit `.pfx`, `.pvk`, private keys, certificate passwords or timestamp credentials.

## macOS

macOS distribution outside the Mac App Store needs Developer ID signing and Apple notarization.

### What You Need

- macOS release machine or macOS CI runner
- Xcode Command Line Tools
- Rust through `rustup`
- Apple Developer Program membership
- Developer ID Application certificate
- App Store Connect API key for notarization, or Apple ID notarization credentials

### Build, Sign and Notarize With Tauri Environment Variables

Set signing and notarization variables before building:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Publisher Name (TEAMID)"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
export APPLE_API_KEY="ABC123DEFG"
export APPLE_API_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
./installers/macos/macos-install.sh --package-desktop
```

Expected output folder:

```text
apps/desktop/src-tauri/target/release/bundle/
```

Targeted CI builds use target-specific bundle folders such as:

```text
apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/
apps/desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/
```

### Verify Signing

```bash
codesign --verify --deep --strict --verbose=2 "apps/desktop/src-tauri/target/release/bundle/macos/WardSen.app"
spctl --assess --type execute --verbose "apps/desktop/src-tauri/target/release/bundle/macos/WardSen.app"
```

### Verify Notarization Stapling

```bash
xcrun stapler validate "apps/desktop/src-tauri/target/release/bundle/dmg/WardSen_0.1.0_aarch64.dmg"
```

Helper verification:

```bash
./installers/macos/verify-macos-artifacts.sh
```

### CI Secrets

Recommended secret names:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY`
- `APPLE_API_KEY_P8`

Never commit `.p12`, `.p8`, keychain exports, Apple account passwords or API private keys.

## Release Upload Checklist

Before attaching files to GitHub Releases:

1. Build on the target platform.
2. Sign the final installer artifacts.
3. Notarize and staple macOS artifacts.
4. Verify signatures on a clean machine when practical.
5. Generate checksums.
6. Upload signed installers and checksums only.

Suggested checksum command:

```bash
npm run release:checksums
```

## GitHub Actions Release Build

WardSen includes a release workflow at `.github/workflows/release-installers.yml`.

Manual release flow for a new RC or signed update:

1. Open the repository on GitHub.
2. Go to `Actions`.
3. Select `Release Installers`.
4. Click `Run workflow`.
5. Enter a tag such as `v0.1.0-rc.16`.
6. Keep `prerelease` enabled until signed artifacts have been verified.
7. Review the draft GitHub release before publishing it.

Tag release flow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds:

- Windows x64 `.exe` and `.msi` artifacts on `windows-latest`
- macOS Apple Silicon `.dmg` release assets on `macos-14`
- Per-runner checksum files, such as `SHA256SUMS-windows-x64.txt`

macOS `.app` bundles are produced and verified before upload when signing secrets are configured; the `.dmg` is the release asset intended for users.

Intel Mac builds use the separate manual workflow at `.github/workflows/build-macos-intel.yml`. Use it when you specifically need a macOS x64 DMG for older Intel Macs; it runs on GitHub's `macos-13` runner pool, which can queue for longer than the main release workflow. Enter the source ref to build and the existing release tag to update. After it finishes, the workflow uploads the `wardsen-macos-x64` workflow artifact and attaches the DMG plus `SHA256SUMS-macos-x64.txt` to the matching prerelease when that release exists.

Configure these GitHub repository secrets before publishing signed installer releases:

- Windows: `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`, `WINDOWS_TIMESTAMP_URL`
- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8`

Set repository variable `MACOS_SIGNING_ENABLED` to `true` only after the macOS signing and notarization secrets are complete and verified. When the variable is unset or any other value, the workflow builds unsigned macOS RC artifacts instead of trying to import partial certificate material.

If signing secrets are not configured, the workflow can still produce developer-preview artifacts, but those artifacts must remain draft/prerelease or be clearly marked unsigned.
