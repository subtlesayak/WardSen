# Employee Credential Request Flow

WardSen supports employee credential requests as a metadata-first approval flow. Employees should be able to choose the credential they need from the request catalog, but they must not receive a screen that lists every raw password.

## Employee-Side User Flow

1. An admin creates or imports a Person contact with the organization-provided email, such as `ravi@company.example`.
2. An admin grants request access by creating an Employee identity and optionally linking it to that Person. The linked Person email must match the employee assigned email.
3. An admin publishes requestable credential metadata for that employee or a matching team/role policy, including name, username, domain, tags and risk tier.
4. An admin issues a short-lived one-time sign-in code for that employee.
5. WardSen can prepare an email handoff draft addressed to the assigned email and labelled with the approved sender mailbox.
6. The admin sends the draft from that approved mailbox, or delivers the code through another approved out-of-band channel.
7. The employee opens the Employee Portal panel.
8. The employee enters their assigned email and one-time code.
9. WardSen verifies the assigned email, code hash, expiry and unused state.
10. WardSen creates a short-lived employee session and stores only the session-token hash.
11. WardSen shows only credential metadata entries that the employee is allowed to request.
12. The employee chooses the required credential, adds a reason, optional ticket and expected duration, then submits the request.
13. WardSen creates a pending request in the admin queue using the employee's assigned email from the session.
14. An admin reviews the requester, assigned email, credential, reason, expiry and view limit.
15. If denied, the request records the admin decision without creating a delivery link.
16. If approved, WardSen retrieves the credential locally, creates a per-employee delivery link and addresses it only to the assigned email.
17. The employee receives or is handed off the approved link through the configured channel.
18. WardSen refreshes provider status to show link access signals such as `active`, `viewed`, `limit_reached`, `expired` or `revoked`.
19. Admin wording must say `Ravi's link was viewed`, not `Ravi viewed it`, unless the provider returns verified viewer identity telemetry.
20. If access looks unexpected, the admin uses the request queue replacement action to revoke the previous delivery and issue a fresh per-employee link if access is still needed.

## Current MVP Boundary

The current Requests view contains admin provisioning, sign-in-code issuing, sender-labelled email draft handoff, a passwordless Employee Portal panel, admin approval and request-bound replacement links in one local desktop screen. The employee sign-in code is shown to the local admin and can be copied into a pre-addressed mail draft. WardSen stores only code hashes and session-token hashes. The `mailto:` draft opens with recipient and subject only; the code is copied separately so it is not placed into an external URL.

People and Employees are related but not identical. People are contact records for delivery; Employees are permissioned request identities. Linking an Employee to a Person reuses the contact email as the assigned email source, but a Person does not gain request-portal access until an admin creates the Employee identity.

Admins can provision several linked Employee identities from selected People in one action. WardSen requires the exact confirmation phrase `PROVISION EMPLOYEES FROM PEOPLE`, skips People without email or with already-provisioned assigned emails, and records only created/skipped counts in audit metadata.

Catalog access rules can name exact employees, teams or roles. WardSen evaluates those rules on the server before showing requestable metadata or accepting a credential request. Empty catalog policy rules are rejected.

Replacement links stay tied to the original credential request. WardSen requires the admin confirmation phrase `REPLACE REQUEST <id>`, revokes the previous non-terminal provider link before creating the new link, records `previousDeliveryId`, `replacementCount` and `lastReplacementAt`, and returns the new one-time URL only in the immediate response.

Future work can replace draft-based code delivery with SMTP, magic-link email or company SSO/OIDC, but it must keep the same backend rules.

## Security Rules

- Do not store employee passwords for this flow.
- Do not store raw employee one-time codes or raw employee session tokens.
- Do not expose raw passwords in employee catalog or request endpoints.
- Do not let employees type arbitrary delivery addresses at request time.
- Do not treat a Person contact as an employee unless an admin explicitly creates or links an Employee identity.
- Do not bulk-provision Employee identities from People without an exact admin confirmation.
- Do not let employees request catalog entries outside their allowed employee id.
- Do not rely on UI filtering alone for team/role catalog access; the server must enforce the policy rule match.
- Do not claim a specific person or device viewed a link unless a provider supplies verified telemetry.
- Do not silently fingerprint, collect IP addresses or collect user agents without explicit operator configuration, recipient notice where appropriate and retention controls.
