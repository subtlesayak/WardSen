# Account Isolation

Every account has isolated provider configuration, local cache, session state, command queue and environment variables.

For Bitwarden, WardSen sets a unique `BITWARDENCLI_APPDATA_DIR` per account. Session tokens are never persisted and all accounts return to locked or logged-out state after restart.
