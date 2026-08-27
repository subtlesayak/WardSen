# Security Design

WardSen uses a localhost-only backend, same-origin checks, rate limiting, secure headers, request-size limits, redaction and safe CLI execution.

Provider CLI execution is bounded: stdout and stderr capture is capped, timeouts terminate the provider process tree, commands run with `shell: false`, and secrets are supplied through stdin or explicit environment variables where providers allow it.

Provider executable resolution prefers absolute WardSen-managed paths and absolute operator-configured paths such as `WARDSEN_BITWARDEN_CLI_PATH` or `WARDSEN_KEEPASSXC_CLI_PATH`. Relative executable overrides are rejected. If no trusted candidate exists, WardSen keeps a command-name fallback only so the provider runner can return a clear missing-tool setup error.

Never store:

- Passwords
- TOTP secrets
- Secure notes
- Master passwords
- Session tokens
- Employee sign-in codes
- Employee session tokens
- Delivery-link access passwords
- Raw CLI output
- Complete secure-link contents

Employee request catalog records store assigned-email identities, catalog metadata, reasons and approval state only. They must not store raw credential values, and employee request creation must use the admin-provisioned assigned email instead of an arbitrary recipient address.

Catalog access policy can name exact employees, teams or roles. WardSen enforces those rules on the server before listing requestable metadata or accepting a credential request, and rejects catalog entries that do not name at least one allowed employee, team or role. Catalog auto-approval policy can mark matching requests `approved` based on max risk, max duration and ticket-reference rules, but it must not create a delivery link without a separate admin confirmation.

Employee request clients should derive the submitted email from the employee identity record where possible. The desktop UI keeps Employee identities separate from People delivery contacts, so changing a Person never changes request access or an Employee's assigned email. A Person contact is not a permission grant by itself. Employee portal sign-in is passwordless in the current MVP: admins issue short-lived one-time codes, and WardSen stores only code hashes and session-token hashes. Optional email draft handoff is addressed only to the assigned email and keeps the one-time code out of the `mailto:` URL. See [Employee Credential Request Flow](employee-request-flow.md) for the user-facing flow and attribution wording boundary.

Request-bound replacement links store only replacement metadata such as the previous delivery id, replacement count and replacement time. The new one-time delivery URL is returned only in the immediate replacement response and is not stored in the request record.

Viewer attribution is deliberately limited to the provider evidence. Per-recipient links can establish that a recipient's assigned link was accessed and support quick revoke or replacement, but WardSen must use wording such as "Asha's link was viewed." It must not claim that Asha, a particular device, IP address or browser viewed the credential unless that information comes from a provider and the collection and retention are configured explicitly.

Bitwarden terminal login uses a five-minute, one-time authenticated localhost handoff. WardSen creates the handoff only for the authenticated desktop session; the terminal pipes `bw unlock --raw` directly to the matching account claim endpoint, which accepts neither a desktop API token alone nor a reused/expired handoff. Before the backend holds the candidate session in memory, Bitwarden must report `unlocked` through `bw status --nointeraction` in the exact WardSen-managed profile, using that candidate only for the command environment. The parsed status must contain the configured account email after normalization, the canonical configured server URL and a non-empty Bitwarden user ID. The first verified user ID is stored as non-secret account metadata and every later handoff must match it. Legacy Bitwarden accounts without a configured login email must be edited before handoff. On any identity mismatch WardSen clears local access, attempts a best-effort `bw lock`, returns a generic failure and records only a reason code. The backend consumes the authorization before validation, keeps a verified session in memory only, and redacts the complete request body from logs. No raw session handoff file is created or read.

Account deletion uses a dedicated lifecycle service while preserving the server-confirmed destructive action. It blocks later operations for that account, validates that the stored provider profile is exactly WardSen's deterministic child directory, rejects symlinks, junctions and canonical redirects, clears in-memory sessions and local delivery/handoff caches, then attempts a short provider logout. It atomically moves the existing profile into a same-root quarantine before deleting SQLite metadata. If the database step fails, WardSen restores the profile; if final cleanup is blocked by an OS file lock, WardSen retains only account ID, quarantine name and time for an automatic startup retry. Cleanup enumerates filesystem entries with `lstat` and never follows links or removes a target outside the managed profile root. This is ordinary filesystem deletion, not secure erasure: SSD wear leveling, filesystem snapshots, backups and recovery behavior can preserve data outside WardSen's control.

Manual delivery handoffs are explicit local operator actions. For Ente Paste, WardSen copies only credential title, username and password to the local system clipboard. URLs, TOTP secrets and notes are excluded. WardSen returns the Ente Paste page as a handoff action, stores `handoff_pending` metadata only, and disables status refresh, revoke, bulk delivery and viewer-attribution controls because the public Ente Paste docs do not expose those sender-side lifecycle signals. After the operator has pasted into Ente, WardSen offers an explicit local clipboard-clear action; it writes no credential material to metadata or audit logs. Operators must still treat any clipboard-capable endpoint as sensitive.

Audit logging stores only safe details. Use counts, provider IDs and redacted error summaries; never write raw provider output or retrieved credential fields.

SQLite applies metadata constraints for delivery status, access counts, view limits, audit outcomes, employee sign-in code hashes and employee session-token hashes. Audit rows, expired employee sign-in code hashes, and expired or revoked employee session-token hashes are retention-managed through repository pruning APIs and the server-confirmed `POST /api/retention/prune` endpoint. That endpoint requires `confirm: "PRUNE RETENTION"` plus explicit retention cutoffs and rejects future cutoffs.

Release evidence is also metadata-only. A public release combines a hash manifest with SBOM, signed-installer evidence and GitHub provenance evidence. Installed-app evidence is generated only after a disposable-machine fresh-install, launch, upgrade, vault-account persistence and uninstall check; the evidence writer hashes the installer and the verifier rejects records that do not match the final manifest.
