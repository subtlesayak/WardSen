# Threat Model

## Assets

- Password-manager session tokens
- Retrieved credential secrets
- Delivery-link access passwords
- Secure delivery links
- People directory metadata
- Delivery metadata and audit records

## Trust Boundaries

- React frontend is untrusted for secret storage.
- Fastify backend may temporarily hold sensitive credentials only while creating a delivery.
- SQLite stores metadata only and applies owner-only POSIX file modes where the OS supports them.
- Bitwarden CLI runs in isolated account profiles through `BITWARDENCLI_APPDATA_DIR`.
- KeePassXC local vault access stays behind explicit database unlock state.
- Provider CLIs are resolved from absolute WardSen-managed or operator-configured paths before falling back to command-name lookup for setup diagnostics.

## Controls

- Backend binds to `127.0.0.1`.
- Non-local and cross-origin mutations are rejected.
- CLI runner uses `spawn` and array arguments.
- CLI stdout and stderr capture is bounded to limit memory exposure from noisy or hostile provider tools.
- CLI timeouts terminate the provider process tree, not only the immediate child process.
- Provider CLI environment overrides must be absolute paths; relative overrides are rejected.
- Secrets are redacted from errors and command output.
- Session tokens are in-memory only and removed on lock/logout/shutdown.
- Database passwords, master passwords and delivery payloads are passed through stdin where provider CLIs allow it.
- The packaged desktop app adds a per-launch local API token between the Tauri shell and backend service.
- The desktop shell prefers bundled Node.js and otherwise resolves Node.js to an absolute trusted runtime path before launching the local backend.
- Bitwarden Send status refresh records access counts, expiry changes and revocation state without storing credential content.
- Unsupported provider capabilities fail explicitly.

## Adapter-Specific Notes

- Bitwarden credentials: one profile directory per WardSen account, session tokens are injected as `BW_SESSION`, malformed CLI JSON fails with safe messages.
- Bitwarden Send: Send payloads and optional access passwords are supplied through encoded JSON/stdin, redacted from command output, and never passed as process arguments. Disabled, expired and max-access sends map to WardSen delivery states.
- KeePassXC: local database path and optional key-file path are retained only as account unlock context; the database password is never written to SQLite and is cleared on lock/logout/auto-lock.

## Out of Scope

- Malware already running as the same OS user.
- Compromised provider CLIs.
- Public exposure of the localhost server by external tunneling tools.
- Full SQLite database encryption for local metadata.
