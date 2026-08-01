# Changelog

## 0.1.0 - 2026-07-30

- First-user install:
  - Windows users should download `WardSen_0.1.0_x64-setup.exe`, run it, allow the unsigned prerelease warning only if they trust the build, then open WardSen from the Start menu.
  - macOS Apple Silicon users should download `WardSen_0.1.0_aarch64.dmg`, drag WardSen into Applications, then allow the unsigned prerelease in **System Settings > Privacy & Security** if Gatekeeper blocks the first launch.
  - Optional checksum files are attached as `SHA256SUMS-windows-x64.txt` and `SHA256SUMS-macos-arm64.txt`.
- Initial open-source application foundation.
- Added provider-neutral credential and delivery architecture.
- Added Bitwarden, Bitwarden Send and KeePassXC adapter foundations.
- Added localhost-only API, React interface, SQLite persistence, batch/audit metadata, security docs, installer entrypoints and tests.
- Added clearer cross-origin error help, package updates, installer runtime checks and release artifact documentation.
