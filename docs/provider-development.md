# Provider Development

Credential providers implement `CredentialProvider`. Delivery providers implement `DeliveryProvider`.

Capability declarations are required. Do not approximate unsupported provider behavior. The UI and API must hide, disable or reject unsupported options with clear safe messages.

Provider integrations must use official CLIs or APIs only.

## Manifest gate

Every built-in provider needs a `ProviderManifest` entry in `packages/core/src/providerManifest.ts`.

- `active` means the adapter can be registered in the functional provider registry and can appear in normal account creation.
- `planned` means the provider can appear only as roadmap/status information.
- `experimental` means the adapter may be tested locally, but must stay disabled by default until release evidence exists.

Do not register a planned or experimental provider in `buildApp()`. A scaffold package can keep placeholder code, but `/api/providers` must not list it as a selectable credential or delivery provider.

## Conformance gate

Before promoting a new provider to `active`:

- Add provider-specific unit tests for login/unlock, search/status, credential read or delivery creation, error redaction, timeout behavior, and unsupported options.
- Add provider conformance coverage with `verifyCredentialProviderConformance` or `verifyDeliveryProviderConformance`.
- Confirm the manifest id, display name, kind, maturity, and enabled-by-default state match the real adapter.
- Keep the provider disabled from normal account creation until these tests pass in the release packaging workflow.

For delivery candidates, also verify the provider's supported API or CLI contract, expiry and view-limit mapping, revoke behavior, access telemetry, endpoint/account isolation and whether link previews can consume a one-time secret. A public web page that can create a link is not sufficient evidence for an adapter.

Delivery providers that can look up provider-side metadata by WardSen `operationId` may implement `findDeliveryByOperationId`. The method must return status metadata only; do not return secure-link URLs from reconciliation paths, and do not infer viewer identity from access counts.

No partially implemented provider should appear as functional.
