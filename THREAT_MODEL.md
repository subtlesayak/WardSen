# Threat Model

## Assets

- Password-manager session tokens
- Retrieved credential secrets
- Delivery-link access passwords
- Secure delivery links
- People directory metadata
- Employee assigned-email identities, sign-in code hashes and session-token hashes
- Delivery metadata and audit records
- Release installers, checksum manifests, SBOMs, signing records and provenance records

## Trust Boundaries

- React frontend is untrusted for secret storage.
- Fastify backend may temporarily hold sensitive credentials only while creating a delivery.
- SQLite stores metadata only and applies owner-only POSIX file modes where the OS supports them.
- Bitwarden CLI runs in isolated account profiles through `BITWARDENCLI_APPDATA_DIR`.
- KeePassXC local vault access stays behind explicit database unlock state.
- Provider CLIs are resolved from absolute WardSen-managed or operator-configured paths before falling back to command-name lookup for setup diagnostics.
- The employee portal is a request-only client. It receives catalog and delivery metadata only after server-side assigned-email session validation.
- Provider access status is a delivery-link signal. It may show that an intended recipient's unique link was accessed, but it does not establish the human, device, IP address or browser unless a provider returns verified telemetry.
- Release evidence is trustworthy only when it is tied to the exact installer hash and produced by the named signing, attestation or disposable-machine lifecycle check.

## Controls

- Backend binds to `127.0.0.1`.
- Non-local and cross-origin mutations are rejected.
- CLI runner uses `spawn` and array arguments.
- CLI stdout and stderr capture is bounded to limit memory exposure from noisy or hostile provider tools.
- CLI timeouts terminate the provider process tree, not only the immediate child process.
- Provider CLI environment overrides must be absolute paths; relative overrides are rejected.
- Secrets are redacted from errors and command output.
- Session tokens are in-memory only and removed on lock/logout/shutdown.
- Account deletion is an exclusive per-account operation. WardSen validates the exact deterministic managed profile path, rejects links and canonical redirects, clears local session/link caches, quarantines the profile within its own managed root, then deletes the account record. Failed post-delete cleanup retains only an account-id cleanup tombstone for retry on startup; it never records filesystem contents.
- Profile cleanup is ordinary filesystem deletion, not secure erasure. SSD wear leveling, filesystem snapshots, backups and OS recovery behavior can retain data beyond WardSen's control; use device and storage disposal controls when secure destruction is required.
- Database passwords, master passwords and delivery payloads are passed through stdin where provider CLIs allow it.
- The packaged desktop app adds a per-launch local API token between the Tauri shell and backend service.
- The desktop shell prefers bundled Node.js and otherwise resolves Node.js to an absolute trusted runtime path before launching the local backend.
- Bitwarden Send status refresh records access counts, expiry changes and revocation state without storing credential content.
- Per-recipient delivery links support leak mitigation: WardSen may show "Asha's link was viewed" and offer revoke/replacement, but never claims that Asha personally viewed it from link access alone.
- Employee sign-in codes and sessions are passwordless, short-lived server artifacts. WardSen stores hashes only, binds use to the admin-assigned email and prunes expired, revoked or consumed artifacts through confirmed retention operations.
- Employee catalog authorization is enforced on the backend for exact employee, team and role policy before catalog listing or request creation. Employee-facing APIs never return raw secrets.
- Update data-root recovery carries forward SQLite metadata and provider profiles only. A release upgrade test must confirm that existing vault accounts remain visible after update.
- Public-release lifecycle evidence is accepted only when it names the exact installer path, SHA-256 and size, records fresh install, launch, upgrade, vault metadata preservation and uninstall, and identifies the disposable test environment.
- Unsupported provider capabilities fail explicitly.

## Adapter-Specific Notes

- Bitwarden credentials: one profile directory per WardSen account, session tokens are injected as `BW_SESSION`, malformed CLI JSON fails with safe messages. First-login terminal sessions use a one-time, five-minute authenticated localhost handoff and are held in memory only; the raw token is not written to a handoff file, SQLite, audit logs or frontend responses. Before WardSen retains a candidate terminal session, it runs `bw status --nointeraction` in that exact managed profile with the candidate token and requires `unlocked` status, the configured account email, the canonical configured server URL and a non-empty Bitwarden user ID. WardSen persists that non-secret user ID after the first verified handoff and requires it on later handoffs. Identity failures clear local access, attempt `bw lock`, and audit only a reason code.
- Bitwarden Send: Send payloads and optional access passwords are supplied through encoded JSON/stdin, redacted from command output, and never passed as process arguments. Disabled, expired and max-access sends map to WardSen delivery states.
- KeePassXC: local database path and optional key-file path are retained only as account unlock context; the database password is never written to SQLite and is cleared on lock/logout/auto-lock.

## Out of Scope

- Malware already running as the same OS user.
- Compromised provider CLIs.
- Public exposure of the localhost server by external tunneling tools.
- Full SQLite database encryption for local metadata.
- Determining the actual human or device behind a recipient link without provider-verified telemetry.
- Hosted employee identity, SSO/OIDC, endpoint posture or device management; the current employee portal uses an administrator-issued one-time code for an assigned email identity.
- Treating CI artifact creation, a signing configuration flag or an unsigned local build as proof of notarization, provenance or installed-app lifecycle success.
