# Security Design

WardSen uses a localhost-only backend, same-origin checks, rate limiting, secure headers, request-size limits, redaction and safe CLI execution.

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
