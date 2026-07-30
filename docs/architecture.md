# Architecture

WardSen separates credential retrieval from credential delivery.

```text
Password-manager account
        -> Credential provider adapter
        -> Normalized sensitive credential
        -> Delivery provider adapter
        -> Secure link
```

`SensitiveCredential` exists only in backend memory during delivery creation. The frontend receives credential summaries and delivery metadata, never passwords, notes, TOTP values or raw provider output.

Delivery batches and audit rows are stored as metadata. Audit rows accept only safe details: provider IDs, record IDs, counts and redacted errors. They must not contain raw CLI output, retrieved credential content or complete secure-link contents.
