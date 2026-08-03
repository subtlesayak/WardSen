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

  it("keeps error help visible as a floating toast while workspace content scrolls", () => {
    expect(styles).toMatch(/\.notice\.error\s*{[\s\S]*position:\s*sticky;[\s\S]*top:\s*12px;[\s\S]*z-index:\s*3;/);
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
});
