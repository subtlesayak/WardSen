# Contributing

Contributions are welcome. WardSen is a local-first access-dispatch platform, so every change must preserve the boundary between credential secrets and metadata.

## Architecture Rule

Secret-containing values may be handled only by provider and backend service code during the authorized operation.

Never send raw credentials, TOTP seeds, provider session tokens, master passwords, access passwords or secure delivery URLs to:

- React state, props or browser storage
- SQLite metadata or audit rows
- logs, diagnostics or error payloads
- analytics, telemetry or remote reporting
- URL query strings, mailto links or chat prefill links

SQLite stores metadata. The frontend receives summaries and lifecycle state. Provider/session secrets remain backend-only and should be kept in memory unless an explicitly reviewed secure-store integration exists.

## Provider Work

Provider integrations must be official, typed and capability-driven:

- Use documented provider APIs or CLIs only.
- Declare only capabilities the provider genuinely supports.
- Keep provider credentials in the local service environment or the future secure-store layer, not in UI-submitted settings.
- Add conformance tests for manifest shape, lifecycle mapping, secret projection, timeout/error handling and unsupported actions.
- Document link-preview risk, revoke semantics, access-count semantics and attribution limits.

Do not add cloud dependencies, telemetry or unofficial provider scraping. Compatibility references to third-party products must stay nominative and follow `docs/third-party-provider-policy.md`.

## UI And Product Language

Use access-oriented language for user-facing workflows. Prefer "Access", "Requests", "Deliveries", "People", "Vaults", "Policies" and "Activity" over implementation-heavy provider terms when the user does not need to see the machinery.

Avoid workplace labels that imply protected-class or employment status decisions. Treat provider view signals as link-scoped unless the provider returns verified recipient/device telemetry under a reviewed privacy model.

## Database And Audit Changes

Database migrations must be append-only, deterministic and covered by repository tests. Audit records must remain metadata-only: provider IDs, delivery IDs, request IDs, counts, timestamps, status, policy snapshots and redacted errors are acceptable; raw provider output and secret-bearing payloads are not.

## Security Review Checklist

Before opening a pull request, ask:

- Could this persist or render a secret outside the provider/backend path?
- Could a local webpage, non-WardSen origin or forged Host header call the local API?
- Could retries or crashes create duplicate provider links?
- Does the UI overstate what a provider status signal proves?
- Are destructive actions server-enforced with exact confirmation where needed?
- Are logs and thrown errors redacted and bounded?
- Are release or signing claims backed by artifact-specific evidence?

## Required Checks

Run the focused checks relevant to your change. For ordinary code changes, start with:

```bash
npm run check
npm test
npm run security:scan-secrets
```

Release changes also need the release evidence scripts documented in `docs/release-security-checklist.md` and `docs/installer-signing.md`.
