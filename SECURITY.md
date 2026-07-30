# Security Policy

Report vulnerabilities through GitHub private vulnerability reporting when available.

WardSen handles credential metadata and creates secure delivery links, but it must never persist or expose credential secrets. Please include reproduction steps, affected platform, provider adapter and whether the issue exposes sensitive credential content.

## Supported Versions

Pre-1.0 releases are security-supported on the latest published version only.

## Local Boundary

WardSen is designed for localhost use only. Do not expose it through public domains, tunnels, port forwarding or public reverse proxies.

WardSen rejects non-local Host headers and cross-origin state-changing requests. Browser clients should use the bundled desktop/web entry points instead of embedding WardSen API calls into unrelated sites.

## Secret Handling

- Credential secrets are fetched on demand and are not stored in SQLite.
- Provider session tokens live in memory and are cleared on lock, logout and server shutdown.
- CLI stdout, stderr and safe API errors are redacted for known password, token, secret, session and key patterns.
- Bitwarden account data uses isolated CLI profile directories; KeePassXC database passwords are supplied through stdin.

## Delivery Limits

Expiry, view limits and revocation control future access to a delivery link. They cannot prevent a recipient from saving, copying, photographing or screenshotting a credential after viewing it.

Bulk delivery is intentionally guarded by a confirmation summary and an extra typed confirmation for large batches.

## Provider Scope

Bitwarden and KeePassXC adapters depend on the security posture of their official CLIs and local OS account. WardSen treats provider CLI compromise or malware running as the same OS user as out of scope for pre-1.0 releases.

See `docs/release-security-checklist.md` before publishing release artifacts.
