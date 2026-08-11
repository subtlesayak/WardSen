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
    expect(webSource).toContain("If Terminal says you are already logged in");
    expect(webSource).toContain("Type the Bitwarden password at that terminal prompt, not in WardSen.");
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
    expect(webSource).toContain("Copied; WhatsApp opened");
    expect(webSource).not.toContain("https://wa.me/?text=");
    expect(webSource).not.toContain("Secure link for ${label}: ${delivery.oneTimeDeliveryUrl}");
  });
});
