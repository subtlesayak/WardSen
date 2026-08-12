import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps/web/src/employeePortal.tsx", "utf8");

describe("employee portal boundary", () => {
  it("uses only the employee-session endpoints after an assigned-email sign-in", () => {
    expect(source).toContain("assignedEmail: signIn.assignedEmail");
    expect(source).toContain("/api/employee-sessions");
    expect(source).toContain("/api/employee-portal/catalog");
    expect(source).toContain("/api/employee-portal/credential-requests");
    expect(source).toContain("/api/employee-sessions/current/logout");
    expect(source).not.toContain("/api/accounts");
    expect(source).not.toContain("/api/deliveries");
  });

  it("keeps emergency requests explicitly confirmed in the employee-only view", () => {
    expect(source).toContain("Break-glass requests require an emergency justification.");
    expect(source).toContain("Submit emergency break-glass request");
    expect(source).toContain("still require admin fulfillment");
  });
});
