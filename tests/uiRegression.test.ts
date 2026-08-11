import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const webSource = readFileSync("apps/web/src/main.tsx", "utf8");
const styles = readFileSync("apps/web/src/styles.css", "utf8");

describe("web UI regression guards", () => {
  it("uses a simple confirmation dialog for destructive UI actions", () => {
    const helper = webSource.match(/async function confirmDestructiveAction[\s\S]*?\n}/)?.[0] ?? "";

    expect(helper).toContain("window.confirm");
    expect(helper).not.toContain("window.prompt");
    expect(helper).not.toContain("Type ${phrase} to continue");
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
    expect(webSource).toContain("aria-label={`Copy provider ID for ${delivery.credentialName}`}");
    expect(webSource).toContain("aria-label={`Cancel batch ${batch.id}`}");
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
    expect(webSource).toContain("unlockDisabledForVerification");
    expect(webSource).toContain("Submit code and login");
    expect(webSource).toContain("Terminal login / unlock");
    expect(webSource).toContain("runs Bitwarden login visibly");
    expect(webSource).toContain("Type that password in Terminal, not in WardSen.");
    expect(webSource).toContain("Code type");
    expect(webSource).toContain("Email / new-device code");
    expect(webSource).toContain("Unlock is available after Bitwarden login finishes");
    expect(webSource).toContain("disabled={unlockDisabledForVerification}");
    expect(webSource).toContain("Bitwarden is waiting for this code");
    expect(webSource).toContain("help.technicalDetail");
    expect(styles).toMatch(/\.attentionField\s*{/);
    expect(styles).toMatch(/\.buttonHint\s*{/);
    expect(styles).toMatch(/\.fieldInstruction\s*{/);
    expect(styles).toMatch(/\.technicalDetail\s*{/);
  });

  it("keeps delivery recipient copy aligned with the selected delivery mode", () => {
    expect(webSource).toContain("recipientPlaceholder");
    expect(webSource).toContain("Choose a person");
    expect(webSource).toContain("All active people");
    expect(webSource).toContain("personId: current.personId || activePeople[0]?.id || \"\"");
  });

  it("does not put bearer delivery links into external email or WhatsApp URLs", () => {
    expect(webSource).toContain("Paste the WardSen delivery link copied to your clipboard");
    expect(webSource).toContain("window.open(\"https://wa.me/\"");
    expect(webSource).toContain("Link copied; WhatsApp opened");
    expect(webSource).toContain("Link copied to clipboard.");
    expect(webSource).toContain("copySuccess");
    expect(webSource).not.toContain("https://wa.me/?text=");
    expect(webSource).not.toContain("Secure link for ${label}: ${delivery.oneTimeDeliveryUrl}");
  });

  it("keeps employee credential requests bound to admin-provisioned email identity", () => {
    expect(webSource).toContain("title=\"Admin Employee Identity\"");
    expect(webSource).toContain("Link person");
    expect(webSource).toContain("employeePersonId");
    expect(webSource).toContain("personId: employeeForm.personId || undefined");
    expect(webSource).toContain("function selectEmployeePerson");
    expect(webSource).toContain("title=\"Bulk Employee Provisioning\"");
    expect(webSource).toContain("/api/employees/bulk-from-people");
    expect(webSource).toContain("PROVISION EMPLOYEES FROM PEOPLE");
    expect(webSource).toContain("This grants Employee Portal request access");
    expect(webSource).toContain("function provisionEmployeesFromPeople");
    expect(webSource).toContain("checkboxLine");
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
    expect(webSource).toContain("title=\"Employee-Side Request\"");
    expect(webSource).toContain("title=\"Employee Sign-In Code\"");
    expect(webSource).toContain("title=\"Employee Portal Sign-In\"");
    expect(webSource).toContain("title=\"Employee Portal Request\"");
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
    expect(webSource).toContain("/api/employee-sessions");
    expect(webSource).toContain("/api/employee-portal/catalog");
    expect(webSource).toContain("\"x-wardsen-employee-session\"");
    expect(webSource).toContain("sessionToken: string;");
    expect(webSource).toContain("readOnly aria-readonly=\"true\" type=\"email\"");
    const mailtoHelper = webSource.match(/function employeeSignInMailtoHref[\s\S]*?\n}/)?.[0] ?? "";
    expect(mailtoHelper).toContain("mailto:");
    expect(mailtoHelper).not.toContain("body=");
    expect(webSource).not.toContain("assignedEmail: requestForm.assignedEmail");
    expect(webSource).not.toContain("localStorage");
    expect(styles).toMatch(/input\[readonly\]\s*{/);
  });
});
