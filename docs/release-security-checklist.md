# Release Security Checklist

Run this checklist before publishing a public WardSen build.

## Secret Handling

- Verify `npm run check`, `npm test` and `npm run build` pass.
- Confirm delivery creation never persists credential plaintext, TOTP secrets, access passwords, master passwords or provider session tokens.
- Confirm API delivery responses include only metadata and the provider delivery URL, never source credential fields.
- Confirm provider CLI secrets are supplied through stdin or environment variables, and configured redaction covers stdout and stderr.

## Account Isolation

- Confirm each account has a separate provider profile directory or local database unlock context.
- Confirm source account provider IDs are validated before credential retrieval.
- Confirm Bitwarden Send deliveries use a Bitwarden account session.
- Confirm same-account provider operations are serialized and different-account operations remain independent.

## Supply Chain

- Use `npm ci`, not ad hoc dependency installs, on release builders.
- Run `npm audit --audit-level=high`.
- Run `cargo audit` from `apps/desktop/src-tauri`.
- Review `docs/rustsec-audit.md` for known warning-class findings.
- Generate an SBOM with `npm run sbom` and attach it to release artifacts when practical.
- Review CodeQL, dependency-review and Dependabot status before tagging.
- Download provider CLIs from official package managers or verified release artifacts only.
- Sign desktop release artifacts before publishing end-user installers, or clearly mark the release as unsigned/source-only.
- Verify signed Windows artifacts with `signtool verify`.
- Verify macOS signing and notarization with `codesign`, `spctl` and `xcrun stapler validate`.
- Confirm packaged desktop builds launch Node.js from an absolute trusted runtime path, or mark the release as source-only until a trusted runtime is available.

## Bulk Delivery

- Confirm bulk sends show credential name, source vault, delivery provider, recipient count, link mode, expiry and view limit before creation.
- Confirm large batches require the typed phrase `SEND <recipient-count>`.
- Confirm partial failures are visible and batch records can be inspected after completion.

## Security Messaging

- Do not describe delivery links as self-destructing.
- State that expiry, view limits and revocation control future link access only.
- State that a recipient can save, copy, photograph or screenshot a credential after viewing it.
