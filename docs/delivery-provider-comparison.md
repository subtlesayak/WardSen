# Delivery Providers

WardSen currently has four automated delivery adapters: Bitwarden Send through the user-installed `bw` CLI, Password Pusher through its authenticated API, Onetime Secret through its authenticated receipt API, and Yopass through its local encryption CLI. Ente Paste is intentionally limited to an experimental manual browser handoff because current public documentation does not expose the sender lifecycle contract WardSen needs to automate it.

## Capability comparison

| Provider | Useful fit | WardSen lifecycle support | WardSen status |
| --- | --- | --- | --- |
| [Bitwarden Send](https://bitwarden.com/help/send-cli/) | Existing Bitwarden users who need per-recipient links | Create, status, access count, revoke. Access proves the assigned link was used, not who used it. | Active |
| [Password Pusher](https://docs.pwpush.com/docs/api-v1/) | API-oriented controlled or self-hosted deployments | Create, whole-day expiry, status and revoke. No reliable access-count or viewer-identity claim. | Active; requires local API token |
| [Onetime Secret](https://docs.onetimesecret.com/en/rest-api/) | REST delivery with TTL, optional passphrase and burn | Create, receipt status and burn/revoke. Receipt state is not human/device attribution and does not provide an exact access count. | Active; requires local API credentials |
| [Yopass](https://github.com/jhaals/yopass) | Self-hosted or public one-time encrypted sharing through a local CLI | Create one-time links with supported expiry presets. Current CLI contract has no WardSen status check or sender-side revoke. | Active; requires local CLI |
| [Ente Paste](https://paste.ente.com/) | Private E2EE browser paste | Operator copies projected credential text and creates a paste in the browser. No WardSen upload, status, revoke, access count or attribution. | Experimental manual handoff |
| [1Password item sharing](https://support.1password.com/share-items/) | Teams already sharing from 1Password | Public guidance describes app/web sharing; WardSen has no verified creation or lifecycle automation surface. | Planned |

## Configuration boundary

WardSen’s desktop UI never receives third-party provider API tokens. Password Pusher and Onetime Secret credentials live only in the local service environment; Yopass is discovered from trusted local executable paths or an explicit local path. The selected audit account for those providers scopes WardSen metadata and audit records only.

Use **Settings > Provider Capabilities** to view exact setup instructions, open provider documentation and run the non-secret local configuration check. Restart WardSen after changing the service environment so the local service inherits the new configuration.

## Live verification

Mocked conformance tests cover request construction, secret projection and lifecycle mapping. The opt-in `tests/externalDeliveryProviders.live.test.ts` suite can validate a configured target with generated non-production payloads: Password Pusher and Onetime Secret create, read and revoke a disposable one-access record; Yopass creates a disposable link only after the explicit `WARDSEN_YOPASS_LIVE_TEST_ALLOW_CREATE=true` acknowledgement because the current CLI has no revoke command. Provider tokens, passphrases and delivery URLs are never printed by the tests.

## Safety gate for every candidate

Do not promote a candidate to `active` because it can produce a URL in a browser. Manual handoff providers must stay clearly labelled and must not show provider lifecycle controls they cannot support. An automated adapter must prove:

- secret payloads stay in the authorized provider path and never enter URLs, email bodies or logs;
- expiry, access limits, one-time behavior and revocation map to WardSen status values truthfully;
- sender-visible access telemetry is separated from viewer identity claims;
- provider errors are bounded and redacted;
- endpoint credentials stay only in the local service environment and never enter the UI, SQLite metadata, logs or diagnostics;
- mocked provider tests and packaged release checks pass before normal account creation exposes the adapter.

See [Provider Development](provider-development.md) and [Third-Party Provider Policy](third-party-provider-policy.md) for the promotion and naming rules.
