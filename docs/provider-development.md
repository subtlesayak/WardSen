# Provider Development

Credential providers implement `CredentialProvider`. Delivery providers implement `DeliveryProvider`.

Capability declarations are required. Do not approximate unsupported provider behavior. The UI and API must hide, disable or reject unsupported options with clear safe messages.

Provider integrations must use official CLIs or APIs only.
