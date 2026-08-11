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
- Delivery-link access passwords
- Raw CLI output
- Complete secure-link contents

Audit logging stores only safe details. Use counts, provider IDs and redacted error summaries; never write raw provider output or retrieved credential fields.

SQLite applies metadata constraints for delivery status, access counts, view limits and audit outcomes. Audit rows are retention-managed through the repository pruning API so security review evidence can be kept without growing indefinitely.
