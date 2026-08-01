# Installer Signing

WardSen release installers should be signed before a public release is published. Signing is separate from building: Tauri creates the `.exe`, `.msi`, `.dmg` or `.app`, then the platform signing system proves who produced it and whether it was modified after signing.

## Current Release State

`v0.1.0` is prepared as a source/developer-preview release until signed platform artifacts are attached. Do not publish it as an end-user installer release until the Windows and macOS signing steps below are completed or the release explicitly says the installers are unsigned.

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

Manual release flow:

1. Open the repository on GitHub.
2. Go to `Actions`.
3. Select `Release Installers`.
4. Click `Run workflow`.
5. Enter a tag such as `v0.1.0`.
6. Keep `prerelease` enabled until signed artifacts have been verified.
7. Review the draft GitHub release before publishing it.

Tag release flow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds:

- Windows x64 `.exe` and `.msi` artifacts on `windows-latest`
- macOS Intel `.dmg` release assets on `macos-13`
- macOS Apple Silicon `.dmg` release assets on `macos-14`
- Per-runner checksum files, such as `SHA256SUMS-windows-x64.txt`

macOS `.app` bundles are produced and verified before upload when signing secrets are configured; the `.dmg` is the release asset intended for users.

Configure these GitHub repository secrets before publishing signed installer releases:

- Windows: `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`, `WINDOWS_TIMESTAMP_URL`
- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8`

Set repository variable `MACOS_SIGNING_ENABLED` to `true` only after the macOS signing and notarization secrets are complete and verified. When the variable is unset or any other value, the workflow builds unsigned macOS RC artifacts instead of trying to import partial certificate material.

If signing secrets are not configured, the workflow can still produce developer-preview artifacts, but those artifacts must remain draft/prerelease or be clearly marked unsigned.
