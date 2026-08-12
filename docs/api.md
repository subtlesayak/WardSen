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
- `POST /api/accounts/:id/terminal-handoff`
- `POST /api/accounts/:id/terminal-handoff/claim`
- `POST /api/accounts/:id/unlock`
- `POST /api/accounts/:id/lock`
- `POST /api/accounts/:id/logout`
- `POST /api/accounts/:id/sync`
- `GET /api/accounts/:id/status`

`POST /api/accounts/:id/terminal-handoff` is available only to the authenticated local desktop session and returns a platform-specific Bitwarden command plus a five-minute expiry. Its paired `claim` endpoint accepts only `text/plain` session data with the matching one-time `X-WardSen-Terminal-Handoff` header. A desktop API token alone cannot claim a session. WardSen consumes the handoff after one attempt, keeps the session in memory, and does not persist the raw token, command authorization, or request body.

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

## Employee Credential Requests

- `GET /api/employees`
- `POST /api/employees`
- `POST /api/employees/bulk-from-people`
- `PUT /api/employees/:id`
- `POST /api/employees/:id/sign-in-code`
- `POST /api/employee-sessions`
- `GET /api/employee-portal/me`
- `GET /api/employee-portal/catalog`
- `GET /api/employee-portal/credential-requests`
- `POST /api/employee-portal/credential-requests`
- `POST /api/employee-sessions/current/logout`
- `GET /api/credential-catalog`
- `POST /api/credential-catalog`
- `PUT /api/credential-catalog/:id`
- `GET /api/employee-catalog`
- `GET /api/credential-requests`
- `POST /api/credential-requests`
- `POST /api/credential-requests/:id/approve`
- `POST /api/credential-requests/:id/deny`
- `POST /api/credential-requests/:id/replacement-link`

Employee catalog endpoints return credential metadata only, not raw passwords. Request creation requires the employee's admin-provisioned `assignedEmail`; arbitrary recipient addresses are rejected. `POST /api/employees` and `PUT /api/employees/:id` may include `personId` to link the employee request identity to an existing Person contact. When `personId` is present, the Person must be active, have an email and that email must match the employee assigned email. `POST /api/employees/bulk-from-people` creates linked Employee identities for selected People and requires `confirm: "PROVISION EMPLOYEES FROM PEOPLE"` plus `confirmRiskSummary: true`; missing emails and already-provisioned assigned emails are skipped. Catalog entries can include `allowedEmployeeIds`, `allowedTeams`, `allowedRoles` and an `autoApprovalPolicy` with max risk, max duration and ticket rules. The server grants request access only when the employee matches at least one catalog rule. Matching auto-approval policies can move a request to `approved`, but delivery link creation still requires admin confirmation of requester, credential, expiry and view limit. Break-glass request creation may set `breakGlass: true`, but the server requires `confirm: "BREAK GLASS <catalogEntryId>"`, `confirmRiskSummary: true` and `breakGlassJustification`; accepted requests use status `break_glass` and still require admin fulfillment before any delivery link is created. A Person contact alone does not grant employee request-portal access.

Employee portal sign-in is passwordless in the current MVP. An admin issues a short-lived one-time code for an employee; WardSen stores only the code hash. `POST /api/employees/:id/sign-in-code` may include `senderEmail` to prepare a sender-labelled email draft addressed to the employee's assigned email. The draft body is returned only with the one-time response and is not written to audit metadata. `POST /api/employee-sessions` accepts assigned email plus code and returns a short-lived employee session token. Portal endpoints require that token in `X-WardSen-Employee-Session` or `Authorization: Bearer <token>`. WardSen stores only the session-token hash.

Expired employee sign-in code hashes and expired or revoked employee session-token hashes can be pruned with `POST /api/retention/prune`. The request must include `confirm: "PRUNE RETENTION"` and an explicit `employeeAuthBefore` ISO timestamp. Future cutoffs are rejected so active codes and sessions are not pruned by mistake.

`POST /api/credential-requests/:id/replacement-link` requires `confirm: "REPLACE REQUEST <id>"`, `confirmRiskSummary: true`, and a `replacementReason`. It works only for fulfilled requests with an existing delivery. WardSen revokes the previous non-terminal provider link first, creates a fresh per-employee delivery link, updates the same request with `previousDeliveryId`, `replacementCount` and `lastReplacementAt`, and returns the new one-time URL only in that response.

See [Employee Credential Request Flow](employee-request-flow.md) for the employee-side request path. Client wording should say `Ravi's link was viewed`, not `Ravi viewed it`, unless a delivery provider returns verified viewer identity telemetry.

## Deliveries

- `POST /api/deliveries`
- `POST /api/deliveries/bulk`
- `GET /api/deliveries`
- `POST /api/deliveries/:id/refresh`
- `POST /api/deliveries/:id/retry`
- `DELETE /api/deliveries/:id`
- `POST /api/deliveries/:id/revoke-batch`
- `POST /api/delivery-providers/:id/clear-handoff-clipboard`

Delivery creation returns a transient `oneTimeDeliveryUrl`. WardSen stores provider delivery IDs and metadata, not complete secure-link contents.

For automated providers such as Bitwarden Send, `oneTimeDeliveryUrl` is the provider link to hand off to the recipient. For manual handoff providers such as Ente Paste, `oneTimeDeliveryUrl` can be the provider creation page and the delivery status is `handoff_pending`; clients must label this as a manual handoff action such as `Open Ente Paste`, not as a completed recipient link. Manual handoff providers may reject bulk delivery, refresh and revoke when the provider does not expose sender-visible lifecycle controls. After pasting the credential into the provider browser flow, clients can call `POST /api/delivery-providers/ente-paste/clear-handoff-clipboard`; it clears the local clipboard and records only the provider identifier in the audit log.

`POST /api/deliveries/:id/refresh` updates provider-reported lifecycle metadata such as delivery status, access count, expiry, revoke time and `lastCheckedAt`. When a provider first reports an accessed link, WardSen persists `firstViewedAt`; it means the assigned provider link was accessed, not that the named person or a specific device was verified. It does not expose the delivery secret again.

`POST /api/deliveries/:id/revoke-batch` is a containment action for suspicious bulk sends. It accepts only `confirm: "REVOKE BATCH LINKS <batchId>"`, revokes active links from the same batch, and returns counts plus safe per-link failures. It never expands to unrelated deliveries of the same credential.

Clients may pass `operationId` in the JSON body or `X-WardSen-Idempotency-Key` in the request headers for `POST /api/deliveries`. Reusing the same operation id with the same non-secret delivery policy returns the cached one-time URL only while the current app session still has it. After a restart, WardSen refuses to create a duplicate provider link with that operation id and asks the operator to review or retry intentionally.

## Batches And Audit

- `GET /api/batches/:id`
- `POST /api/batches/:id/cancel`
- `GET /api/audit-log`
- `POST /api/retention/prune`

Audit log entries store safe details only. `POST /api/retention/prune` can prune audit rows with an explicit `auditLogBefore` ISO timestamp, employee auth artifacts with `employeeAuthBefore`, or both. The request always requires `confirm: "PRUNE RETENTION"` and refuses future cutoffs.
