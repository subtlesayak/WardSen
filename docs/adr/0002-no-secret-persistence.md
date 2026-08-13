# ADR 0002: Credential secrets do not persist outside the provider path

## Status

Accepted

## Context

WardSen retrieves credential material from local password-manager providers and creates temporary secure deliveries. The product becomes unsafe if credential plaintext, TOTP seeds, provider sessions, delivery access passwords or secure URLs drift into the browser, SQLite, logs, diagnostics or release artifacts.

The project already has provider interfaces, delivery metadata, a local API, audit rows and release scans. Contributors need a simple rule that keeps those surfaces from becoming accidental secret stores.

## Decision

- `SensitiveCredential` and provider unlock/session material may exist only in backend memory for the authorized provider or delivery operation.
- React, browser storage, SQLite, audit records, diagnostics, logs and release evidence must receive metadata only.
- Delivery-provider capabilities must describe where secret values travel, whether URLs are secret-bearing, what revoke/view signals mean and whether link previews can affect access semantics.
- Manual handoff providers may use the local clipboard only through an explicit operator action and must provide a clear local cleanup path when the platform allows it.
- The `security:scan-secrets` check includes a WardSen canary prefix so tests and release smoke runs can prove generated artifacts do not retain synthetic credential material.

## Consequences

- New providers need conformance tests for secret projection and unsupported lifecycle actions, not only happy-path delivery tests.
- New UI endpoints must be designed from metadata contracts instead of passing through provider payloads.
- Future secure storage, encrypted metadata or relay work requires a separate ADR before storing any integration secret or synchronizing any access-control data.
- Release readiness must include secret non-persistence evidence tied to the current build outputs, not just passing unit tests.
