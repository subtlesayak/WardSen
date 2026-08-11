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

Employee request clients should derive the submitted email from the employee identity record where possible. Employee identities may link to a Person contact for shared name/email/team metadata, but server validation requires the linked Person email to match the assigned email. A Person contact is not a permission grant by itself, and bulk provisioning from People requires the exact confirmation phrase `PROVISION EMPLOYEES FROM PEOPLE`. Employee portal sign-in is passwordless in the current MVP: admins issue short-lived one-time codes, and WardSen stores only code hashes and session-token hashes. Optional email draft handoff is addressed only to the assigned email and keeps the one-time code out of the `mailto:` URL. See [Employee Credential Request Flow](employee-request-flow.md) for the user-facing flow and attribution wording boundary.

Request-bound replacement links store only replacement metadata such as the previous delivery id, replacement count and replacement time. The new one-time delivery URL is returned only in the immediate replacement response and is not stored in the request record.

Audit logging stores only safe details. Use counts, provider IDs and redacted error summaries; never write raw provider output or retrieved credential fields.

SQLite applies metadata constraints for delivery status, access counts, view limits and audit outcomes. Audit rows are retention-managed through the repository pruning API so security review evidence can be kept without growing indefinitely.
