# Release Security Checklist

Run this checklist before publishing a public WardSen build.

## v0.1.0-rc.54 Preparation

- Release candidate includes automatic Bitwarden terminal-handoff refresh, the macOS Finder environment fix for npm-installed Bitwarden CLI wrappers, five-minute default auto-lock and reactive provider capability settings.
- 2026-08-12 focused validation passed: `npm run check` and 76 targeted API/provider/UI tests. Full release validation is required before publishing.
- `v0.1.0-rc.54` is an unsigned security-review prerelease. Trusted end-user macOS distribution remains blocked until Apple Developer ID signing, notarization, and target-machine lifecycle evidence are available. The GitHub repository has no configured Apple signing secrets or `MACOS_SIGNING_ENABLED=true` variable.

## Latest Local Packaging Evidence

- 2026-08-10: `cmd /c npm run tauri:build -- --bundles nsis` passed on Windows and produced `apps/desktop/src-tauri/target/release/bundle/nsis/WardSen_0.1.0_x64-setup.exe`.
- 2026-08-10: `WARDSEN_BUNDLE_ROOT=apps/desktop/src-tauri/target/release/bundle/nsis npm run release:checksums` produced `apps/desktop/src-tauri/target/release/bundle/nsis/SHA256SUMS.txt` and `apps/desktop/src-tauri/target/release/bundle/nsis/RELEASE-MANIFEST.json`.
- Fresh NSIS installer SHA-256: `55A88CEC2A5EF9EEA8A94CE160F111ECB538F101C3EBC54580B888B589047609`.
- 2026-08-10: `cmd /c npm run tauri:build -- --bundles msi` compiled `wardsen.exe` but failed during WiX `light.exe`; do not treat the stale MSI currently in `target/release/bundle/msi` as current release evidence.
- Signing verification is still required before a public end-user installer release.

## Secret Handling

- Verify `npm run check`, `npm test` and `npm run build` pass.
- Confirm delivery creation never persists credential plaintext, TOTP secrets, access passwords, master passwords or provider session tokens.
- Run `npm run security:scan-secrets` after release smoke tests and attach the output to the release checklist.
- Run `npm run smoke:web` after `npm run build:web` for the bounded HTTP contract check. On a release machine, also run `npm run smoke:web:visual` and attach both desktop and mobile screenshot paths; its browser capture is capped at 10 seconds per viewport, so record an environment failure instead of waiting indefinitely when Chrome/Edge cannot render headlessly.
- Run `npm run smoke:packaged` after desktop packaging or confirm the release workflow uploaded `PACKAGED-SMOKE-<platform>.json` for each target platform.
- Confirm API delivery responses include only metadata and the provider delivery URL, never source credential fields.
- Confirm provider CLI secrets are supplied through stdin or environment variables, and configured redaction covers stdout and stderr.
- If Ente Paste is enabled, confirm it is labelled as an experimental manual handoff, returns `handoff_pending`, disables bulk/refresh/revoke/viewer telemetry, copies only title, username and password through the explicit local clipboard handoff, excludes URLs, TOTP secrets and notes, uses an opaque operation-based delivery id rather than a credential-derived fingerprint, offers the operator a clipboard-clear action after the browser paste, and does not place plaintext into React responses, logs, URLs or persisted metadata.
- Confirm SQLite migration tests cover delivery metadata constraints, audit outcome constraints, audit retention pruning and employee auth-artifact retention pruning.

## Account Isolation

- Confirm each account has a separate provider profile directory or local database unlock context.
- Confirm source account provider IDs are validated before credential retrieval.
- Confirm Bitwarden Send deliveries use a Bitwarden account session.
- Confirm same-account provider operations are serialized and different-account operations remain independent.

## Supply Chain

- Use `npm ci`, not ad hoc dependency installs, on release builders.
- Confirm the `Release Installers` workflow checked out `RELEASE_TAG` and `npm run release:verify-ref` verified `HEAD` equals that tag commit with no tracked or untracked checkout changes.
- Confirm workflow `uses:` entries are pinned to full 40-character SHAs before publishing.
- Run `npm audit --audit-level=high`.
- Run `cargo audit` from `apps/desktop/src-tauri`.
- Review `docs/rustsec-audit.md` for known warning-class findings.
- Generate an SBOM with `npm run release:sbom` before checksums and attach each `WARDSEN-SBOM-*.json` artifact.
- Generate release checksums with `npm run release:checksums` and attach `SHA256SUMS-*.txt`, `RELEASE-MANIFEST-*.json` and `WARDSEN-SBOM-*.json`.
- Attach `PACKAGED-SMOKE-*.json` evidence showing the packaged server bundle booted with token enforcement, used a strict temporary SQLite data root, and recovered one metadata-only account after a forced server restart before publishing.
- Attach `SIGNING-EVIDENCE-*.json` for signed public installers and run `npm run release:verify-evidence` with `WARDSEN_PUBLIC_RELEASE=true`.
- Attach the formal GitHub `ATTESTATION-SUBJECTS-*.txt` and `PROVENANCE-EVIDENCE-*.json` files. Verify each public installer/SBOM attestation against the release repository before publishing.
- On a disposable Windows or macOS test account, run the matching lifecycle harness with a previous signed installer and the final signed installer. Confirm a harmless vault account persists across the upgrade, then attach the generated `INSTALL-LIFECYCLE-EVIDENCE-*.json` file.
- Regenerate checksums after lifecycle evidence is added, then run `WARDSEN_INSTALL_LIFECYCLE_REQUIRED=true npm run release:verify-evidence`. It must confirm the lifecycle record's installer path, SHA-256 and size match the final release manifest.
- When only one bundle backend is current, set `WARDSEN_BUNDLE_ROOT` to the exact fresh bundle folder before running `npm run release:checksums`; default checksum generation refuses mixed artifact timestamps to avoid blessing stale installers.
- Confirm each release manifest lists the release tag, verified git SHA, build timestamp, schema version, installer artifact paths, SBOM artifact path, packaged-smoke evidence and signing evidence for public releases.
- Review CodeQL, dependency-review and Dependabot status before tagging.
- Do not override Cargo's resolver to suppress a transitive Rust advisory. Record the upstream compatibility blocker and wait for a compatible Tauri update when its `gtk` dependency constrains the patched crate.
- Download provider CLIs from official package managers or verified release artifacts only.
- Use the `Release Installers` GitHub Actions workflow for repeatable Windows and macOS builds.
- Sign desktop release artifacts before publishing end-user installers, or clearly mark the release as unsigned/source-only.
- Confirm `npm run release:verify-public-readiness` passes when `WARDSEN_PUBLIC_RELEASE=true` for the target platform.
- Verify signed Windows artifacts with `signtool verify`.
- Verify macOS signing and notarization with `codesign`, `spctl` and `xcrun stapler validate`.
- Attach signing/notarization command output or CI logs to the release checklist before moving a release from draft to public.
- Confirm release notes and installer docs do not present Gatekeeper/quarantine bypasses as normal installation steps.
- Confirm packaged desktop builds include `runtime/node.exe` on Windows or `runtime/node` on macOS/Linux, or launch Node.js from an absolute trusted runtime path; otherwise mark the release as source-only.

## Third-Party Providers and Trademarks

- Review `docs/third-party-provider-policy.md`.
- Confirm README and release notes clearly say WardSen is independent and not affiliated with, endorsed by or sponsored by supported providers.
- Confirm provider names are used only for compatibility, setup instructions or provider selection labels.
- Confirm no provider logos, screenshots, brand styling or trademark-heavy release artwork were added.
- Confirm installer artifacts do not bundle provider binaries by default.
- Confirm provider setup links point to provider-controlled pages or documented package manager commands.
- Confirm release copy does not imply provider approval, partnership, certification or sponsorship.

## Bulk Delivery

- Confirm bulk sends show credential name, source vault, delivery provider, recipient count, link mode, expiry and view limit before creation.
- Confirm large batches require the typed phrase `SEND <recipient-count>`.
- Confirm partial failures are visible and batch records can be inspected after completion.

## Security Messaging

- Do not describe delivery links as self-destructing.
- State that expiry, view limits and revocation control future link access only.
- State that a recipient can save, copy, photograph or screenshot a credential after viewing it.
