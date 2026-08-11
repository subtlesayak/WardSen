# WardSen Improvement Roadmap

WardSen should stabilize the existing local credential retrieval to provider-hosted secure-link workflow before expanding providers. The next releases should focus on correctness, secret minimization, recoverability, and verifiable safety.

## Priority Summary

| Priority | Improvement | Why it matters |
| --- | --- | --- |
| **P0** | Freeze provider-expansion scope | Keeps the release focused on one safe core flow instead of partially implemented adapters |
| **P0** | Stop automatically sharing notes and authenticator seeds | Prevents accidental over-sharing and MFA compromise |
| **P0** | Fix Bitwarden Send revoke and status mapping | Aligns WardSen with current CLI behavior and truthful provider lifecycle states |
| **P0** | Fix bulk link handoff | Ensures created one-time URLs are visible long enough for operator handoff |
| **P0** | Enforce account-profile isolation | Prevents one account from accidentally using another account's Bitwarden profile |
| **P0** | Make auto-lock timer-driven | Locks idle vaults without requiring another API request |
| **P0** | Build releases from the exact tag | Prevents incorrectly labelled binaries |
| **P1** | Add per-recipient viewer attribution and leak alerts | Shows which assigned link was accessed and enables fast revoke/replacement without overclaiming device identity |
| **P1** | Add employee credential request catalog | Lets employees request approved credentials from their assigned email while giving admins a full audit trail |
| **P1** | Replace session-token files with authenticated IPC | Removes a sensitive disk handoff |
| **P1** | Add crash-safe delivery state and idempotency | Prevents orphaned or duplicate active links |
| **P1** | Introduce shared API contracts | Stops frontend/server response drift |
| **P1** | Sign and attest public releases | Establishes installer identity and provenance |
| **P2** | Improve database privacy, indexing and retention | Protects contact and audit metadata |
| **P3** | Add additional providers | Only after the core safety gates pass |

## Phase 0: Freeze Scope

Goal: keep WardSen focused on one safe release path.

Deliverables:

- Treat Bitwarden/KeePassXC to Bitwarden Send as the only prerelease delivery path.
- Hide planned providers from normal account creation.
- Mark unsigned builds as developer/security-review builds only.

Exit criteria:

- No planned provider appears as functional.
- Release notes clearly identify the build channel.

## Phase 1: Secret Minimization

Goal: prevent accidental credential over-sharing.

Deliverables:

- Exclude notes and TOTP/authenticator seeds by default.
- Add explicit credential field projection.
- Share username and password only by default.
- Use safer defaults: 24-hour expiry, one access, hidden text when supported.
- Add tests proving notes and authenticator seeds do not enter Send payloads by default.

Exit criteria:

- Selecting a credential cannot silently share notes or authenticator seeds.

## Phase 2: Bitwarden Send Correctness

Goal: make the current delivery adapter compatible and truthful.

Deliverables:

- Replace `bw send remove` with `bw send delete`.
- Support Send access passwords through encoded JSON/stdin, not process arguments.
- Distinguish `active`, `viewed`, `limit_reached`, `expired`, and `revoked`.
- Add fake CLI tests for command arguments, redaction, malformed output, and revoke.
- Add opt-in real Bitwarden CLI integration tests later.

Exit criteria:

- Revoke works against supported CLI behavior.
- Status reflects the actual Send lifecycle.

## Phase 3: Bulk Handoff Recovery

Goal: stop losing one-time URLs after bulk creation.

Deliverables:

- Consume `results[]` from the bulk response.
- Show per-recipient created/failed state.
- Provide copy/open-draft handoff actions for each successful recipient.
- Warn that links are session-only and may be unavailable after refresh.
- Exclude recipients without the required handoff contact.
- Add UI/API tests for visible bulk results.

Exit criteria:

- Every created bulk link has an explicit operator handoff path.

## Phase 4: Account and Profile Isolation

Goal: make account boundaries hard to misuse.

Deliverables:

- Remove ordinary caller-supplied `profileDirectory`.
- Use managed immutable provider profile directories.
- Reject duplicate canonical profile paths.
- Prevent provider/profile mutation while unlocked.
- Remove account sessions on account deletion.
- Add symlink/reparse-point duplicate tests where practical.

Exit criteria:

- One WardSen account cannot accidentally use another Bitwarden profile/session.

## Phase 5: Auto-Lock and Session Safety

Goal: make locking happen without waiting for another API request.

Deliverables:

- Add a timer-driven auto-lock scheduler.
- Defer lock only while active operations are running.
- Lock on desktop shutdown.
- Audit provider lock failures honestly.
- Replace session-token file handoff with authenticated IPC later.

Exit criteria:

- Idle vaults lock on time without user/API activity.

## Phase 6: Crash-Safe Delivery Creation

Goal: prevent orphaned or duplicate active links.

Deliverables:

- Create a delivery operation record before provider calls.
- Add idempotency keys/operation IDs.
- Store non-secret policy snapshots.
- Revoke provider Sends on partial failure where possible.
- Reconcile stuck `creating` and `handoff_pending` records on startup.

Exit criteria:

- Provider success plus local failure does not silently leave unmanaged links.

## Phase 7: Shared Contracts and UI Refactor

Goal: stop frontend/server drift.

Deliverables:

- Add a shared Zod contracts package.
- Parse API responses at runtime.
- Split `apps/web/src/main.tsx` into feature modules.
- Add browser-level tests for bulk handoff, malformed responses, planned provider hiding, and secret-field defaults.

Exit criteria:

- The frontend cannot silently drop server fields such as bulk result URLs again.

## Phase 8: Viewer Attribution and Leak Mitigation

Goal: show which assigned link was accessed without overclaiming who or which device viewed it.

WardSen should support viewer attribution as leak mitigation, not as proof that a specific human/device opened a link unless the delivery provider exposes verified logs. For Bitwarden Send, WardSen can track provider status such as `accessCount`, `viewed`, `limit_reached`, `expired`, and `revoked`, but current public CLI documentation does not show sender-visible device, IP address, or user-agent attribution.

Best UI wording: **"Asha's link was viewed"**, not **"Asha viewed it."**

Deliverables:

- Use one provider link per intended recipient.
- Add a delivery-audit panel with per-recipient unique links, first viewed time, last checked time, access count, limit reached status, expired/revoked status, and one-click revoke for suspicious deliveries.
- Add unexpected-access warnings and replacement-link workflow.
- Support provider-specific richer metadata only when the provider actually returns it and the privacy policy explains the collection.
- Avoid hidden tracking, fingerprinting, or silent device/IP collection by default.

Safe display model:

```text
Recipient:        Asha
Provider link:    Viewed
Access count:     1 / 1
First seen:        2026-08-08 18:42
Handoff method:   Email draft opened
Leak signal:      Low, single access on intended per-recipient link
```

This does not prove Asha personally opened the link. It proves that Asha's assigned link was accessed.

Future event model:

```ts
interface DeliveryAccessEvent {
  deliveryId: string;
  recipientId?: string;
  observedAt: string;
  accessCount: number;
  providerUserId?: string;
  providerEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceLabel?: string;
  source: "provider" | "wardsen_gateway";
  confidence: "provider_verified" | "recipient_link" | "self_reported" | "unknown";
}
```

Optional recipient verification:

- Use Bitwarden email-verified Sends where available.
- Prefer one-access links.
- Require access passwords sent over a separate channel.
- Use per-recipient access passwords.
- Alert when access count exceeds the expected count.
- Revoke all sibling links when a suspected leak is reported.

Exit criteria:

- WardSen can show which intended recipient's assigned link was accessed.
- WardSen never claims the actual viewer identity/device unless provider-verified telemetry exists.

## Phase 9: Employee Credential Request Catalog

Goal: let employees find and request credentials without granting broad direct secret visibility.

WardSen should support an employee-facing catalog where a worker can search credential records they are allowed to request, choose the required credential, and submit a reason from an admin-provisioned email identity. The default model should expose metadata and request controls, not raw password values.

Identity rule: each employee must use a set email provided by the organization. The employee should not type an arbitrary recipient address at request time. Admins map employee records to approved email addresses, and all request, approval, delivery, view-status, revoke, and replacement-link events must retain that assigned email in the audit trail.

Safe request model:

```text
Employee:         Ravi
Assigned email:   ravi@company.example
Credential:       GitHub Production
Reason:           Emergency deploy rollback
Request status:   Pending admin approval
Delivery status:  Not sent
```

Deliverables:

- Add an employee credential catalog showing allowed credential names, provider, account owner, tags, rotation age, and risk tier without exposing secret values.
- Add employee records with immutable or admin-controlled assigned email addresses.
- Require employees to submit access requests from their assigned email identity.
- Require a request reason, optional ticket/reference, and expected access duration.
- Add admin approval, denial, auto-approval policy, and emergency break-glass states.
- Deliver approved credentials only to the employee's assigned email or a provider-verified equivalent identity.
- Use per-employee, per-request delivery links and reuse the Phase 8 wording: "Ravi's link was viewed," not "Ravi viewed it."
- Add admin audit views for requested credential, requester email, reason, approver, delivery link status, access count, expiry, revoke, and replacement workflow.
- Add role-based catalog filtering so employees can request only credentials within their team, project, or policy scope.
- Add server-enforced authorization tests proving employees cannot request as another email, change their assigned email, view raw secrets directly, or access catalog entries outside their policy.

Current MVP status:

- Implemented employee identity records with normalized, admin-controlled assigned email addresses.
- Implemented optional Person-to-Employee linking with server validation that the linked contact email matches the assigned employee email.
- Implemented exact-confirmation bulk provisioning from selected People into linked Employee identities.
- Implemented requestable catalog metadata and per-employee catalog filtering.
- Implemented employee request creation, admin approval/denial and approval-to-delivery handoff.
- Implemented server tests for assigned-email enforcement, metadata-only catalog responses, approval confirmation and out-of-scope catalog request rejection.
- Implemented passwordless employee portal sessions with admin-issued one-time codes, code hashes and session-token hashes.
- Implemented sender-labelled email draft handoff for employee sign-in codes without placing the one-time code into a `mailto:` URL.
- Implemented request-bound replacement links that require `REPLACE REQUEST <id>`, revoke the previous delivery, and preserve replacement metadata on the original request.
- Implemented a local Requests view for admin setup, employee sign-in, employee-side request submission and admin review in one desktop screen.
- Implemented server-enforced catalog policy rules for exact employees, teams and roles.
- Implemented conservative catalog auto-approval policies that can mark matching requests as `approved` while still requiring admin confirmation before delivery.
- Documented the future employee portal flow in [Employee Credential Request Flow](employee-request-flow.md).
- Remaining: separate hosted employee portal, SMTP/magic-link delivery or SSO/OIDC and emergency break-glass workflow.

Exit criteria:

- Employees can request credentials from a catalog using only their assigned email identity.
- Admins can see request, approval, delivery, viewed-link, revoke, and replacement status.
- No employee-facing path lists or returns all raw passwords.

## Phase 10: Release Engineering

Goal: make releases fail closed.

Deliverables:

- Checkout the exact immutable release tag.
- Verify `HEAD` equals the tag commit.
- Pin GitHub Actions to full SHAs.
- Restrict workflow permissions.
- Remove installer-validation bypasses.
- Derive app/installer versions from the release tag.
- Embed version, tag, SHA, build timestamp, and schema version.
- Add SBOM, checksums, and provenance.

Exit criteria:

- A release named for a tag is built from exactly that tag.

## Phase 11: Security Beta Hardening

Goal: prepare for external security review.

Deliverables:

- Add bounded CLI output and process-tree termination.
- Resolve provider executables through absolute trusted paths.
- Add secret non-persistence scans.
- Add database constraints, indexes, and retention policy.
- Add packaged Windows/macOS end-to-end tests.
- Update threat model and ADRs.

Exit criteria:

- The core workflow survives failure, timeout, crash, and packaging tests without leaking secrets.

## Phase 12: Trusted Public Release

Goal: ship to ordinary users.

Deliverables:

- Windows code signing.
- macOS signing and notarization.
- Signature verification after upload.
- Install/upgrade/uninstall tests.
- Public security policy.
- No Gatekeeper/quarantine bypass as the normal user path.

Exit criteria:

- Public installers are signed, verifiable, and tied to build provenance.

## Phase 13: Provider Expansion

Goal: add more providers only after the core path is stable.

Deliverables:

- Add a provider manifest.
- Add a provider conformance suite.
- Implement one new provider at a time.
- Evaluate Ente Paste first among secure-link candidates, followed by API-oriented or self-hosted options documented in [Delivery Provider Candidates](delivery-provider-comparison.md).
- Mark new providers experimental first.
- Promote only after packaged tests pass.

Exit criteria:

- No partially implemented provider appears as functional.
