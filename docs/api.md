# API

WardSen binds only to `127.0.0.1` and rejects non-local requests. Mutating requests must be same-origin.

## Core

- `GET /api/health`
- `GET /api/providers`

## Accounts

- `GET /api/accounts`
- `POST /api/accounts`
- `PUT /api/accounts/:id`
- `DELETE /api/accounts/:id`
- `POST /api/accounts/:id/login`
- `POST /api/accounts/:id/unlock`
- `POST /api/accounts/:id/lock`
- `POST /api/accounts/:id/logout`
- `POST /api/accounts/:id/sync`
- `GET /api/accounts/:id/status`

## Credentials

- `GET /api/credentials/search`

Credential search returns summaries only. It never returns passwords, notes, TOTP values or raw provider records.

## People

- `GET /api/people`
- `POST /api/people`
- `PUT /api/people/:id`
- `DELETE /api/people/:id`
- `POST /api/people/:id/restore`
- `POST /api/people/import`
- `GET /api/people/export`

`DELETE /api/people/:id` archives by default. Add `?hard=true` for permanent deletion.

## Deliveries

- `POST /api/deliveries`
- `POST /api/deliveries/bulk`
- `GET /api/deliveries`
- `POST /api/deliveries/:id/refresh`
- `POST /api/deliveries/:id/retry`
- `DELETE /api/deliveries/:id`

Delivery creation returns a transient `oneTimeDeliveryUrl`. WardSen stores provider delivery IDs and metadata, not complete secure-link contents.

## Batches And Audit

- `GET /api/batches/:id`
- `POST /api/batches/:id/cancel`
- `GET /api/audit-log`

Audit log entries store safe details only.
