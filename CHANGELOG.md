# Changelog

## 0.1.0 - 2026-07-30

- First-user install:
  - Windows users should download the unsigned MSI-only prerelease, verify `SHA256SUMS-windows-x64.txt`, and leave it quarantined if Microsoft Defender blocks it.
  - macOS Apple Silicon users should download `WardSen_0.1.0_aarch64.dmg`, drag WardSen into Applications, then allow the unsigned prerelease in **System Settings > Privacy & Security** if Gatekeeper blocks the first launch.
  - Optional checksum verification is available through the attached `SHA256SUMS-*.txt` files.
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
- Added `v0.1.0-rc.14` release notes with copyable provider setup links and in-app terminal recovery commands.
- Added `v0.1.0-rc.15` release notes and Bitwarden CLI setup help for Windows/macOS users, including native download PATH guidance, arm64/NPM guidance, Chocolatey and `bw --version` verification.
- Added `v0.1.0-rc.16` release notes and a third-party provider/trademark policy clarifying independent compatibility, user-installed provider tools and no provider endorsement.
- Added `v0.1.0-rc.34` release notes and Bitwarden Send account readiness checks so locked or logged-out delivery accounts show unlock guidance before `bw send` runs.
- Pulled the unsigned `v0.1.0-rc.34` Windows artifacts after Microsoft Defender flagged the setup EXE as `Trojan:Win32/Wacatac.B!ml`; Windows packaging remains suspended pending investigation.
- Added `v0.1.0-rc.35` release notes and changed Windows release packaging to unsigned MSI-only, without the NSIS setup EXE.
- Added `v0.1.0-rc.36` release notes and fixed Bitwarden Send so delivery commands use the same isolated WardSen Bitwarden profile as Vaults.
- Added `v0.1.0-rc.37` release notes and fixed credential delivery payloads so real password fields are preserved internally while errors stay redacted.
- Added `v0.1.0-rc.42` release notes with MSI prerelease publishing fixes, MSI-compatible RC package versions, stale-installer checksum guards, release provenance manifests, pinned release workflow actions, public signing-readiness gates, shared API contracts and cleaner desktop-session trust diagnostics.
- Added `v0.1.0-rc.43` release notes with the employee request catalog MVP, passwordless employee portal sessions, request-bound replacement links, delivery idempotency/recovery and Bitwarden Send operation lookup.
- Added `v0.1.0-rc.44` release notes and fixed the macOS release-test ordering assumption in the employee replacement-link coverage.
