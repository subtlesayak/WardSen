# Security Policy

## Supported Releases

WardSen is pre-1.0. Security fixes are applied to the current release candidate line and the next public release. Unsigned prerelease installers are validation builds for testers and security reviewers, not fully trusted end-user releases.

## Reporting A Vulnerability

Report suspected vulnerabilities privately through GitHub Security Advisories when available. If advisories are unavailable, open a minimal issue that says you have a security report to share, but do not include secrets, exploit payloads, private logs or credential material in public text.

Include:

- WardSen version or release tag.
- Operating system.
- Provider involved, if any.
- Whether the issue affects local metadata, provider CLI execution, delivery links or installer trust.
- Reproduction steps using fake credentials only.

## Public Installer Trust

Public end-user installers must be signed, verifiable and tied to release provenance. A release is not public-ready until:

- Windows artifacts pass Authenticode verification.
- macOS artifacts pass Developer ID signing and notarization validation.
- Checksums, `RELEASE-MANIFEST-*.json`, `WARDSEN-SBOM-*.json`, `PACKAGED-SMOKE-*.json`, public-release `SIGNING-EVIDENCE-*.json` and `PROVENANCE-EVIDENCE-*.json` are attached.
- Each final installer is covered by a formal GitHub artifact attestation and a hash-matched `INSTALL-LIFECYCLE-EVIDENCE-*.json` record from a disposable-machine install, upgrade and uninstall check.
- The release was built from the exact published tag.

Do not treat a Gatekeeper quarantine bypass as a normal installation path.
