# ADR 0001: Employee access remains metadata-only and attribution remains link-scoped

## Status

Accepted

## Context

WardSen lets an administrator provision an employee identity from an assigned email, issue a short-lived one-time code, and approve a request for a credential from a policy-filtered catalog. The product also records provider delivery status for per-recipient links.

The system must prevent an employee portal from becoming a password browser and avoid overstating what a provider link-status signal proves.

## Decision

- The employee portal receives only server-authorized catalog, request and delivery metadata. Retrieved credentials and provider unlock material remain on the administrator/provider path.
- An employee session is bound to an administrator-provisioned assigned email. WardSen stores one-time-code and session-token hashes, not their raw values, and retains them only for the documented lifecycle.
- People records may supply shared contact metadata, but a Person record is not a permission grant. A linked Person email must match the employee assigned email.
- Per-recipient links are the default attribution unit. The UI says that an assigned link was viewed, never that the named human, device or browser viewed it, unless the provider returns that telemetry as verified data.
- Release trust claims require evidence tied to the exact installer hash. CI smoke output, a configured signing secret or a browser-side prompt is not substitute evidence for a real installed-app upgrade test.

## Consequences

- Operators can revoke or replace a suspicious recipient link quickly without collecting covert device fingerprints.
- The administrator must approve credential delivery even when a request is auto-approved by policy.
- Hosted SSO/OIDC, verified recipient identity and device telemetry remain future integrations with separate privacy, retention and provider-contract review.
- Final public releases need a disposable-machine lifecycle record in addition to CI, signing and provenance records.
