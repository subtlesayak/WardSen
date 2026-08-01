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
- Fixed desktop recovery when the bundled local service is unreachable: the banner now restarts the service before retrying instead of repeating the same failed fetch.
- Added desktop service diagnostics for failed recovery, including process state, port reachability, bundled runtime presence, server bundle presence and short service output.
- Added a visible app version label in the desktop interface so screenshots identify the installed build.
- Fixed Windows packaged local-service startup by normalizing bundled Node paths, selecting a writable data directory, creating SQLite/profile folders before startup and allowing trusted desktop preflight requests before token-authenticated API calls.
- Added `v0.1.0-rc.10` release notes for the responsive layout and destructive-confirmation fixes.
- Fixed desktop/tablet layout so the left sidebar stays anchored while the workspace scrolls independently.
- Replaced difficult typed destructive prompts in the UI with a normal confirmation dialog while keeping server-side destructive confirmation phrases.
- Added `v0.1.0-rc.11` release notes and missing provider-tool guidance so raw `spawn bw ENOENT` failures become install/PATH help.
- Added `v0.1.0-rc.12` release notes and provider setup buttons for users who do not know CLI or terminal commands.
- Added `v0.1.0-rc.13` release notes and fixed provider setup buttons so packaged desktop builds open official install pages through the system browser.
- Documented the macOS unsigned-prerelease `"WardSen" is damaged and can't be opened` Gatekeeper recovery step for testers.
