import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const webSource = readFileSync("apps/web/src/main.tsx", "utf8");
const batchTablesSource = readFileSync("apps/web/src/deliveryBatchTables.tsx", "utf8");
const deliveryHistorySource = readFileSync("apps/web/src/deliveryHistoryTable.tsx", "utf8");
const employeePortalSource = readFileSync("apps/web/src/employeePortal.tsx", "utf8");
const styles = readFileSync("apps/web/src/styles.css", "utf8");

describe("web UI regression guards", () => {
  it("uses an in-app typed confirmation dialog for destructive UI actions", () => {
    const dialog = webSource.match(/function DestructiveConfirmationDialog[\s\S]*?\n}/)?.[0] ?? "";

    expect(webSource).toContain("function useDestructiveConfirmation");
    expect(dialog).toContain("Type the confirmation phrase to continue");
    expect(dialog).toContain("disabled={!isConfirmed}");
    expect(dialog).toContain("The local service will reject this action unless the phrase matches exactly.");
    expect(webSource).toContain("function confirmDestructivePreview");
    expect(webSource).toContain("Impact preview");
    expect(webSource).toContain("/operation-preview");
    expect(styles).toContain(".confirmationDialog p { white-space: pre-line;");
    expect(webSource).not.toContain("async function confirmDestructiveAction");
  });

  it("keeps the desktop sidebar independent from content scrolling", () => {
    expect(styles).toMatch(/body\s*{[\s\S]*overflow:\s*hidden;/);
    expect(styles).toMatch(/\.shell\s*{[\s\S]*height:\s*100vh;[\s\S]*overflow:\s*hidden;/);
    expect(styles).toMatch(/\.sidebar\s*{[\s\S]*position:\s*sticky;[\s\S]*height:\s*100vh;[\s\S]*overflow-y:\s*auto;/);
    expect(styles).toMatch(/\.workspace\s*{[\s\S]*height:\s*100vh;[\s\S]*overflow-y:\s*auto;[\s\S]*overflow-x:\s*hidden;/);
  });

  it("allows compact viewports to wrap instead of overflowing sideways", () => {
    expect(styles).toContain("grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));");
    expect(styles).toContain("grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));");
    expect(styles).toMatch(/\.row\s*{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/);
    expect(styles).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.workspace\s*{[\s\S]*height:\s*auto;[\s\S]*overflow:\s*visible;/);
  });

  it("keeps keyboard navigation, control names, and live announcements accessible", () => {
    expect(webSource).toContain("Skip to content");
    expect(webSource).toContain("id=\"main-content\"");
    expect(webSource).toContain("nav aria-label=\"Primary\"");
    expect(webSource).toContain("aria-current={active === id ? \"page\" : undefined}");
    expect(webSource).toContain("role=\"status\" aria-live=\"polite\"");
    expect(webSource).toContain("aria-label=\"Credential search query\"");
    expect(deliveryHistorySource).toContain("aria-label={copyStatus === \"copied\" ? `Delivery ID copied for ${delivery.credentialName}` : `Copy delivery ID for ${delivery.credentialName}`}");
    expect(batchTablesSource).toContain("aria-label={`Cancel batch ${batch.id}`}");
    expect(webSource).toContain("aria-pressed={form.mode === \"shared\"}");
    expect(styles).toMatch(/:focus-visible[\s\S]*outline:\s*3px solid #0f6bff;/);
    expect(styles).toMatch(/\.skipLink\s*{/);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
  });

  it("keeps error help visible as a floating toast while workspace content scrolls", () => {
    expect(styles).toMatch(/\.notice\.error\s*{[\s\S]*position:\s*sticky;[\s\S]*top:\s*12px;[\s\S]*z-index:\s*3;/);
  });

  it("summarizes noisy local-service request logs in desktop recovery diagnostics", () => {
    expect(webSource).toContain("summarizeLocalServiceOutput");
    expect(webSource).toContain("Recent service output:");
    expect(webSource).toContain("request log shows rejected desktop-session API calls");
    expect(webSource).not.toContain("Service output: ${status.lastOutput}");
  });

  it("renders provider help actions as opener-backed controls inside error toasts", () => {
    expect(webSource).toContain("noticeActions");
    expect(webSource).toContain("noticeActionLink");
    expect(webSource).toContain("openExternalUrl");
    expect(webSource).toContain("copyExternalUrl");
    expect(webSource).toContain("copyTextToClipboard");
    expect(webSource).toContain("setupChecklist");
    expect(webSource).toContain("Setup checklist");
    expect(webSource).toContain("Copy install link");
    expect(webSource).toContain("Copy terminal command");
    expect(webSource).toContain("selectTerminalCommand");
    expect(webSource).toContain("help.actionHref");
    expect(styles).toMatch(/\.noticeActions\s*{/);
    expect(styles).toMatch(/\.noticeActionLink\s*{/);
    expect(styles).toMatch(/\.setupChecklist\s*{/);
    expect(styles).toMatch(/\.terminalHelp\s*{/);
  });

  it("turns Bitwarden verification prompts into an inline recovery step", () => {
    expect(webSource).toContain("verificationNeeded");
    expect(webSource).toContain("verificationCodeRef");
    expect(webSource).toContain("Submit code and login");
    expect(webSource).toContain("Terminal login / unlock");
    expect(webSource).toContain("WardSen never accepts this password.");
    expect(webSource).toContain("one-time local handoff authorization");
    expect(webSource).toContain("WardSen will update this account automatically.");
    expect(webSource).not.toContain("Check terminal status");
    expect(webSource).toContain("Code type");
    expect(webSource).toContain("Email / new-device code");
    expect(webSource).toContain("Bitwarden is waiting for this code");
    expect(webSource).toContain("help.technicalDetail");
    expect(styles).toMatch(/\.attentionField\s*{/);
    expect(styles).toMatch(/\.fieldInstruction\s*{/);
    expect(styles).toMatch(/\.technicalDetail\s*{/);
  });

  it("updates Settings capabilities and explains vault control intents", () => {
    expect(webSource).toContain("selectedProviderId");
    expect(webSource).toContain("Provider capability selection");
    expect(webSource).toContain("value={selectedProvider?.id ?? \"\"}");
    expect(webSource).toContain("setSelectedProviderId(event.target.value)");
    expect(webSource).toContain("setConnectionCheck({ status: \"idle\" })");
    expect(webSource).toContain("connectionCheck.providerId === selectedProvider?.id");
    expect(webSource).toContain("Select for account access");
    expect(webSource).toContain("Sync latest provider changes");
    expect(webSource).toContain("Lock and remove WardSen session");
    expect(webSource).toContain("formatAutoLockCountdown");
    expect(webSource).toContain("Locks in ${minutes}:${seconds}");
    expect(webSource).toContain("autoLockMinutes: \"10\"");
    expect(webSource).toContain("Check Settings &gt; Provider Capabilities");
    expect(webSource).toContain("Only active delivery integrations are selectable.");
    expect(webSource).toContain("Open provider docs");
    expect(webSource).toContain("Check configuration");
    expect(webSource).toContain("Refresh diagnostics");
    expect(webSource).toContain("ProviderDiagnostics");
    expect(webSource).toContain("/api/provider-diagnostics/${encodeURIComponent(provider.id)}");
    expect(styles).toContain(".providerDiagnostics");
    expect(webSource).toContain("/api/delivery-providers/${encodeURIComponent(provider.id)}/test");
  });

  it("keeps delivery recipient copy aligned with the selected delivery mode", () => {
    expect(webSource).toContain("recipientPlaceholder");
    expect(webSource).toContain("Choose a person");
    expect(webSource).toContain("All active people");
    expect(webSource).toContain("personId: current.personId || activePeople[0]?.id || \"\"");
  });

  it("does not put bearer delivery links into external email or WhatsApp URLs", () => {
    expect(webSource).toContain("Paste the WardSen delivery link copied to your clipboard");
    expect(webSource).toContain("copyAndOpenDeliveryHandoff");
    expect(webSource).toContain("await openMailDraft(deliveryHandoffMailtoHref");
    expect(webSource).toContain("await openExternalUrl(deliveryWhatsAppHref");
    expect(webSource).toContain("Link copied; WhatsApp opened");
    expect(webSource).toContain("Copied to clipboard.");
    expect(webSource).toContain("copySuccess");
    expect(webSource).not.toContain("https://wa.me/?text=");
    expect(webSource).not.toContain("Secure link for ${label}: ${delivery.oneTimeDeliveryUrl}");
  });

  it("uses the selected delivery method only for an explicit post-creation handoff", () => {
    expect(webSource).toContain('method={form.deliveryMethod}');
    expect(webSource).toContain('recipient={form.mode === "individual" ? recipient : undefined}');
    expect(webSource).toContain("Copy and open email");
    expect(webSource).toContain("Copy and open WhatsApp");
  });

  it("keeps employee identities separate from People while allowing editable request records", () => {
    expect(webSource).toContain('title={editingEmployeeId ? "Edit Employee Identity" : "Add Employee Identity"}');
    expect(webSource).toContain('title="Employee Identities"');
    expect(webSource).toContain("function editEmployee");
    expect(webSource).toContain("Copy email");
    expect(webSource).toContain("Create a new employee identity to change it.");
    expect(webSource).not.toContain("employeePersonId");
    expect(webSource).not.toContain("function selectEmployeePerson");
    expect(webSource).not.toContain("function provisionEmployeesFromPeople");
    expect(webSource).not.toContain("PROVISION EMPLOYEES FROM PEOPLE");
    expect(webSource).toContain('title={editingPersonId ? "Edit Person" : "Add Person"}');
    expect(webSource).toContain("function editPerson");
    expect(webSource).toContain("Update person");
    expect(webSource).toContain("Copy shared link");
    expect(webSource).toContain("title=\"Admin Catalog Metadata\"");
    expect(webSource).toContain("Allowed teams");
    expect(webSource).toContain("Allowed roles");
    expect(webSource).toContain("allowedTeams");
    expect(webSource).toContain("allowedRoles");
    expect(webSource).toContain("function catalogEntryAllowsEmployee");
    expect(webSource).toContain("Add at least one allowed employee, team or role");
    expect(webSource).toContain("autoApprovalPolicy");
    expect(webSource).toContain("Auto-approve policy matches");
    expect(webSource).toContain("autoApprovalMaxRiskTier");
    expect(webSource).toContain("autoApprovalMaxExpectedDurationMinutes");
    expect(webSource).toContain("Policy approved");
    expect(webSource).toContain("function normalizeAccessRequestResponse");
    expect(webSource).toContain("accessRequest.status === \"approved\" ? \"Fulfill\" : \"Approve\"");
    expect(webSource).toContain("Emergency break-glass request");
    expect(webSource).toContain("function breakGlassRequestPayload");
    expect(webSource).toContain("BREAK GLASS ${catalogEntryId}");
    expect(webSource).toContain("function confirmBreakGlassSubmission");
    expect(webSource).toContain("Break-glass creates an audited emergency request");
    expect(webSource).toContain("title=\"Admin-Assisted Request\"");
    expect(webSource).toContain("title=\"Employee Sign-In Code\"");
    expect(webSource).toContain('import { EmployeePortalPage, isEmployeePortalView } from "./employeePortal";');
    expect(webSource).toContain("if (isEmployeePortalView()) return <EmployeePortalPage />;");
    expect(webSource).toContain("?view=employee");
    expect(employeePortalSource).toContain("export function EmployeePortalPage");
    expect(employeePortalSource).toContain("/api/employee-portal/catalog");
    expect(employeePortalSource).toContain("/api/employee-portal/credential-requests");
    expect(employeePortalSource).toContain("x-wardsen-employee-session");
    expect(employeePortalSource).not.toContain("raw password");
    expect(webSource).toContain("title=\"Admin Request Queue\"");
    expect(webSource).toContain("const assignedEmail = selectedRequestEmployee?.assignedEmail;");
    expect(webSource).toContain("Sender email");
    expect(webSource).toContain("Copy draft body");
    expect(webSource).toContain("Copy body and open draft");
    expect(webSource).toContain("openMailDraft");
    expect(webSource).toContain("employeeSignInMailtoHref");
    expect(webSource).toContain("replaceRequestLink");
    expect(webSource).toContain("/replacement-link");
    expect(webSource).toContain("REPLACE REQUEST ${accessRequest.id}");
    expect(webSource).toContain("Replacement reason");
    expect(webSource).toContain("previousDeliveryId");
    expect(webSource).toContain("replacementCount");
    expect(employeePortalSource).toContain("/api/employee-sessions");
    expect(employeePortalSource).toContain("/api/employee-portal/catalog");
    expect(employeePortalSource).toContain("\"x-wardsen-employee-session\"");
    expect(employeePortalSource).toContain("sessionToken");
    expect(employeePortalSource).toContain("readOnly aria-readonly=\"true\"");
    const mailtoHelper = webSource.match(/function employeeSignInMailtoHref[\s\S]*?\n}/)?.[0] ?? "";
    expect(mailtoHelper).toContain("mailto:");
    expect(mailtoHelper).not.toContain("body=");
    expect(webSource).not.toContain("assignedEmail: requestForm.assignedEmail");
    expect(webSource).not.toContain("localStorage");
    expect(styles).toMatch(/input\[readonly\]\s*{/);
    expect(styles).toMatch(/\.employeePortalShell\s*{/);
  });

  it("shows delivery provider candidates without enabling planned providers as functional", () => {
    expect(webSource).toContain("plannedProviders: ProviderInfo[]");
    expect(webSource).toContain("Planned Provider Candidates");
    expect(webSource).toContain("providerTelemetryLabel");
    expect(webSource).toContain("Promotion blockers");
    expect(webSource).toContain("viewer ${titleStatus(readiness.viewerIdentity)}");
    expect(webSource).toContain("provider.delivery?.promotionBlockedBy.join");
    expect(styles).toMatch(/\.tableHead\.providerCandidate,\s*\.tableRow\.providerCandidate/);
    expect(styles).toMatch(/\.providerTable\s*{/);
    expect(webSource).toContain("Planned Provider Candidates");
    expect(styles).toContain("minmax(248px, 1.2fr)");
    expect(styles).toContain("scrollbar-gutter: stable both-edges");
  });

  it("refreshes provider status from the delivery audit instead of only reloading local metadata", () => {
    expect(webSource).toContain("async function refreshProviderStatus");
    expect(webSource).toContain('title="Delivery Audit" action="Refresh provider status" onAction={() => void refreshProviderStatus()}');
    expect(webSource).toContain("isBitwardenStatusRefreshBlocked");
    expect(webSource).toContain("blockedAccountLabels");
    expect(webSource).toContain("api.accounts.map((account) => `${account.id}:${account.status}`)");
    expect(webSource).toContain("await api.refresh();");
    expect(webSource).toContain("function refreshSupportedDeliveryStatuses");
    expect(webSource).toContain("window.setInterval(() => void refreshProviderStatus(true), 2 * 60 * 1000)");
  });

  it("keeps CSV import discoverable and avoids duplicate people export actions", () => {
    expect(webSource).toContain('title="People Directory" action="Import CSV"');
    expect(webSource).toContain('name="peopleCsv"');
    expect(webSource).toContain('aria-hidden="true" /> Export CSV</button>');
    expect(webSource).not.toContain('title="People Directory" action="Export CSV"');
  });

  it("labels Ente Paste as a manual handoff and disables unsupported lifecycle controls", () => {
    expect(webSource).toContain("function deliveryOptionsForProvider");
    expect(webSource).toContain("approvalConfirmationMessage");
    expect(webSource).toContain("replacementConfirmationMessage");
    expect(webSource).toContain("Ente Paste approval handoff");
    expect(webSource).toContain("Ente Paste manual handoff");
    expect(webSource).toContain("Open Ente Paste");
    expect(webSource).toContain("Clear clipboard");
    expect(webSource).toContain("clear-handoff-clipboard");
    expect(webSource).toContain("handoff_pending");
    expect(deliveryHistorySource).toContain("disabled={!canRefresh(delivery)}");
    expect(webSource).toContain("canRefresh={(delivery) => deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, \"statusLookup\")}");
    expect(webSource).toContain("!deliveryProviderSupports(api.deliveryProviders, accessRequest.deliveryProviderId, \"revokeLink\")");
    expect(webSource).toContain("const approvalViewLimitValue = approvalCapabilities.arbitraryViewLimit ? approvalForm.viewLimit : \"\";");
    expect(webSource).toContain("viewLimit: capabilities.arbitraryViewLimit ? form.viewLimit || undefined : undefined");
    expect(styles).toMatch(/\.manualHandoffAction \.copyFeedbackStatus\s*{/);
  });
});
