# Delivery Provider Candidates

WardSen currently has one active delivery adapter: Bitwarden Send through the user-installed `bw` CLI. Other providers stay planned until WardSen has a documented, supported integration path and provider-specific conformance tests.

## Candidate comparison

| Provider | Useful fit | Evidence to verify before an adapter | WardSen status |
| --- | --- | --- | --- |
| [Ente Paste](https://paste.ente.com/) | Private E2EE paste, one-time view and automatic deletion after 24 hours | Official API or CLI, link creation input, sender-visible status, revoke behavior and access telemetry | Planned |
| [Password Pusher](https://docs.pwpush.com/docs/api-v1/) | Documented JSON API with expiry and view controls; useful for self-hosted or controlled deployments | Instance authentication, deployment ownership, redaction, revoke semantics and audit/access fields | Planned |
| [Yopass](https://github.com/jhaals/yopass) | Self-hostable E2EE secret sharing with one-time URLs, expiry and an official CLI | Operator-controlled endpoint, API contract, status/revoke semantics and safe URL handling | Planned |
| [Onetime Secret](https://docs.onetimesecret.com/en/rest-api/) | REST API, configurable TTL and burn operations | Regional endpoint policy, authentication, sender status, deletion/revoke behavior and retention terms | Planned |
| [1Password item sharing](https://support.1password.com/share-items/) | Unique links with expiry and optional recipient restrictions | A supported API or CLI for creating and managing shares; current public guidance describes app and web workflows | Planned |

## Recommendation order

1. **Ente Paste** is the closest lightweight one-time-paste candidate for WardSen's local-first flow, but the public page is not by itself an integration contract.
2. **Password Pusher** is the strongest API-oriented candidate when an operator controls or trusts the deployment and needs view/expiry controls.
3. **Yopass** is a strong self-hosting candidate when browser-side encryption, a CLI and operator ownership matter more than provider-hosted analytics.
4. **Onetime Secret** is worth evaluating when REST and TTL/burn operations are the primary requirements.
5. **1Password item sharing** is useful for teams already using 1Password, but it should wait until a supported automation surface is confirmed.

## Safety gate for every candidate

Do not promote a candidate to `active` because it can produce a URL in a browser. The adapter must prove:

- secret payloads stay in the authorized provider path and never enter URLs, email bodies or logs;
- expiry, access limits, one-time behavior and revocation map to WardSen status values truthfully;
- sender-visible access telemetry is separated from viewer identity claims;
- provider errors are bounded and redacted;
- account or endpoint credentials are isolated per WardSen account;
- mocked provider tests and packaged release checks pass before normal account creation exposes the adapter.

See [Provider Development](provider-development.md) and [Third-Party Provider Policy](third-party-provider-policy.md) for the promotion and naming rules.
