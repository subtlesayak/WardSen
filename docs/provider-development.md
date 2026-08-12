# Provider Development

Credential providers implement `CredentialProvider`. Delivery providers implement `DeliveryProvider`.

Capability declarations are required. Do not approximate unsupported provider behavior. The UI and API must hide, disable or reject unsupported options with clear safe messages.

Provider integrations must use official CLIs or APIs only.

## Manifest gate

Every built-in provider needs a `ProviderManifest` entry in `packages/core/src/providerManifest.ts`.

- `active` means the adapter can be registered in the functional provider registry and can appear in normal account creation.
- `planned` means the provider can appear only as roadmap/status information.
- `experimental` means the adapter may appear in the functional provider registry only when it is deliberately labelled, feature-limited and covered by provider-specific tests. Experimental automated providers should stay disabled by default until release evidence exists.
- Delivery manifests must include readiness metadata for integration surface, secure-link creation, revoke, status lookup, access count, viewer identity confidence and promotion blockers.

Do not register a planned provider in `buildApp()`. A scaffold package can keep placeholder code, but `/api/providers` must not list a planned provider as a selectable credential or delivery provider.

Experimental manual delivery providers may be registered only when:

- The manifest sets `secureLinkCreation: "manual"`.
- Unsupported lifecycle capabilities such as revoke, status lookup, access count, arbitrary view limits and viewer identity are declared unsupported and disabled in UI/API paths.
- The UI labels the result as a handoff, not a completed provider link.
- Credential plaintext stays in an explicit local handoff path such as the system clipboard and never appears in React API responses, audit logs, URLs or persisted metadata. A manual provider may expose `clearHandoffClipboard()` so WardSen can offer an explicit operator-triggered cleanup action after the browser-side handoff.
- Provider-specific tests cover the manual handoff, unsupported lifecycle actions, character limits and secret non-persistence boundaries.

## Conformance gate

Before promoting a new provider to `active`:

- Add provider-specific unit tests for login/unlock, search/status, credential read or delivery creation, error redaction, timeout behavior, and unsupported options.
- Add provider conformance coverage with `verifyCredentialProviderConformance` or `verifyDeliveryProviderConformance`.
- Confirm the manifest id, display name, kind, maturity, and enabled-by-default state match the real adapter.
- Keep the provider disabled from normal account creation until these tests pass in the release packaging workflow.

For delivery candidates, also verify the provider's supported API or CLI contract, expiry and view-limit mapping, revoke behavior, access telemetry, endpoint/account isolation and whether link previews can consume a one-time secret. A public web page that can create a link is not sufficient evidence for an adapter.

Delivery providers that can look up provider-side metadata by WardSen `operationId` may implement `findDeliveryByOperationId`. The method must return status metadata only; do not return secure-link URLs from reconciliation paths, and do not infer viewer identity from access counts.

No partially implemented provider should appear as automated or fully functional.
