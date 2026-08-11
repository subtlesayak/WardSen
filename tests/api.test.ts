import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { AccountSessionManager } from "@wardsen/core";
import type {
  ConnectionResult,
  CredentialProvider,
  CredentialProviderCapabilities,
  CredentialSummary,
  DeliveryProvider,
  DeliveryProviderCapabilities,
  DeliveryResult,
  DeliveryStatus,
  PaginationInput,
  ProviderLoginInput,
  ProviderUnlockInput,
  SensitiveCredential,
  CreateDeliveryInput
} from "@wardsen/core";
import { InMemoryWardSenRepository } from "@wardsen/database";
import { buildApp } from "../apps/server/src/app";

describe("WardSen API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("serves health only through local host requests", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().telemetry).toBe(false);
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    await app.close();
  });

  it("rejects non-local host headers before serving API data", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "wardsen.example.test" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("WardSen only accepts local requests");
    await app.close();
  });

  it("requires the desktop API token when configured", async () => {
    const app = await buildApp({ apiToken: "desktop-token" });
    const missing = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:4777" } });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error).toContain("desktop API token");

    const accepted = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:4777", "x-wardsen-api-token": "desktop-token" }
    });
    expect(accepted.statusCode).toBe(200);
    await app.close();
  });

  it("rejects missing desktop API tokens outside test or explicit unauthenticated modes", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAllow = process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API;
    process.env.NODE_ENV = "production";
    delete process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API;
    const app = await buildApp();

    try {
      const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:4777" } });
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toContain("desktop API token");
    } finally {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAllow === undefined) delete process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API;
      else process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API = previousAllow;
    }
  });

  it("allows trusted desktop preflight before token-authenticated requests", async () => {
    const app = await buildApp({ apiToken: "desktop-token" });
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/providers",
      headers: {
        host: "127.0.0.1:4777",
        origin: "tauri://localhost",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-wardsen-api-token,x-wardsen-employee-session"
      }
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("tauri://localhost");
    expect(preflight.headers["access-control-allow-headers"]).toContain("x-wardsen-api-token");
    expect(preflight.headers["access-control-allow-headers"]).toContain("x-wardsen-employee-session");

    const accepted = await app.inject({
      method: "GET",
      url: "/api/providers",
      headers: { host: "127.0.0.1:4777", origin: "tauri://localhost", "x-wardsen-api-token": "desktop-token" }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["access-control-allow-origin"]).toBe("tauri://localhost");
    await app.close();
  });

  it("rejects cross-origin state-changing requests", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers: { host: "127.0.0.1:4777", origin: "http://evil.example.test" },
      payload: { id: "ops", providerId: "bitwarden", label: "Operations" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Cross-origin request blocked");
    expect(response.json().error).toContain("Origin http://evil.example.test");
    expect(response.json().error).toContain("http://127.0.0.1:4777");
    await app.close();
  });

  it("accepts state-changing requests from the packaged Tauri origin", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers: { host: "127.0.0.1:4777", origin: "tauri://localhost" },
      payload: { id: "ops", providerId: "bitwarden", label: "Operations" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe("ops");
    await app.close();
  });

  it("lists provider capabilities", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/providers", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.credentialProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "bitwarden", maturity: "active", enabledByDefault: true }),
      expect.objectContaining({ id: "keepassxc", maturity: "active", enabledByDefault: true })
    ]));
    expect(body.credentialProviders.some((provider: { id: string }) => provider.id === "onepassword")).toBe(false);
    expect(body.plannedProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "onepassword", maturity: "planned", enabledByDefault: false }),
      expect.objectContaining({ id: "proton-pass", maturity: "planned", enabledByDefault: false }),
      expect.objectContaining({ id: "keeper", maturity: "planned", enabledByDefault: false })
    ]));
    expect(body.deliveryProviders.some((provider: { id: string }) => provider.id === "bitwarden-send")).toBe(true);
    await app.close();
  });

  it("rejects account creation for planned providers that are not registered as functional", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };

    const response = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "future", providerId: "onepassword", label: "Future provider" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Unknown credential provider: onepassword");
    await app.close();
  });

  it("creates, updates and deletes account metadata", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const created = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "ops", providerId: "bitwarden", label: "Operations", username: "ops@example.com" }
    });
    expect(created.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PUT",
      url: "/api/accounts/ops",
      headers,
      payload: { label: "Company Operations" }
    });
    expect(updated.json().label).toBe("Company Operations");

    const removed = await app.inject({ method: "DELETE", url: "/api/accounts/ops", headers, payload: { confirm: "DELETE ACCOUNT ops" } });
    expect(removed.statusCode).toBe(200);

    const audit = await app.inject({ method: "GET", url: "/api/audit-log", headers: { host: "127.0.0.1:4777" } });
    expect(audit.json().items.some((item: { action: string }) => item.action === "account.delete")).toBe(true);
    await app.close();
  });

  it("manages provider profile directories instead of accepting caller-supplied paths", async () => {
    const profileRoot = path.join(os.tmpdir(), "wardsen-test-profiles-api");
    const app = await buildApp({ profileRoot });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };

    const created = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "ops", providerId: "bitwarden", label: "Operations", profileDirectory: "D:\\Outside\\Bitwarden" }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().profileDirectory).toBe(path.resolve(profileRoot, "ops"));

    const updated = await app.inject({
      method: "PUT",
      url: "/api/accounts/ops",
      headers,
      payload: { label: "Operations 2", profileDirectory: "D:\\StillOutside" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().profileDirectory).toBe(path.resolve(profileRoot, "ops"));

    const escaped = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "..\\escape", providerId: "bitwarden", label: "Escape" }
    });
    expect(escaped.statusCode).toBe(400);
    expect(escaped.json().error).toContain("Account id cannot contain path separators");

    await app.close();
  });

  it("rejects provider changes after account creation to preserve profile isolation", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "ops", providerId: "bitwarden", label: "Operations" }
    });

    const changed = await app.inject({
      method: "PUT",
      url: "/api/accounts/ops",
      headers,
      payload: { providerId: "mock-source", label: "Moved" }
    });

    expect(changed.statusCode).toBe(400);
    expect(changed.json().error).toContain("Account provider cannot be changed");
    await app.close();
  });

  it("returns live in-memory session status with account metadata", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "mock-source", label: "Mock source" }
    });

    sessions.markUnlocked("source", "mock-source", "token");
    const accounts = await app.inject({ method: "GET", url: "/api/accounts", headers: { host: "127.0.0.1:4777" } });

    expect(accounts.json()[0]).toMatchObject({ id: "source", status: "unlocked" });
    expect(accounts.json()[0].lastActivity).toBeTruthy();
    await app.close();
  });

  it("imports and exports people CSV", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const imported = await app.inject({
      method: "POST",
      url: "/api/people/import",
      headers,
      payload: { csv: "name,email,group\nMira,mira@example.com,Ops" }
    });
    expect(imported.json().importedCount).toBe(1);

    const exported = await app.inject({ method: "GET", url: "/api/people/export", headers: { host: "127.0.0.1:4777" } });
    expect(exported.body).toContain("mira@example.com");
    await app.close();
  });

  it("edits, archives, restores and hard-deletes people", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const created = await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-1", name: "Mira", email: "mira@example.com" }
    });
    expect(created.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PUT",
      url: "/api/people/person-1",
      headers,
      payload: { groupName: "Ops" }
    });
    expect(updated.json().groupName).toBe("Ops");

    expect((await app.inject({ method: "DELETE", url: "/api/people/person-1", headers })).json().archived).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/people/person-1/restore", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/people/person-1?hard=true", headers, payload: { confirm: "DELETE PERSON person-1" } })).json().deleted).toBe(true);
    await app.close();
  });

  it("tracks cancellable delivery batches", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const batch = await app.inject({
      method: "POST",
      url: "/api/batches/example/cancel",
      headers
    });
    expect(batch.statusCode).toBe(400);

    const repositoryBatch = await app.inject({ method: "GET", url: "/api/batches/missing", headers: { host: "127.0.0.1:4777" } });
    expect(repositoryBatch.statusCode).toBe(404);
    await app.close();
  });

  it("enforces assigned-email credential requests and lets admins approve to delivery", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-ravi", name: "Ravi Menon", email: "ravi@example.com", groupName: "Ops", role: "Engineer" }
    });

    const employee = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-1", personId: "person-ravi", name: "Ravi", assignedEmail: "Ravi@Example.com", team: "Ops", role: "Engineer" }
    });
    expect(employee.statusCode).toBe(200);
    expect(employee.json()).toMatchObject({ id: "employee-1", personId: "person-ravi", assignedEmail: "ravi@example.com" });

    const mismatchedPersonLink = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-wrong-link", personId: "person-ravi", name: "Wrong Link", assignedEmail: "wrong@example.com" }
    });
    expect(mismatchedPersonLink.statusCode).toBe(400);
    expect(mismatchedPersonLink.json().error).toContain("must match the linked person's email");

    const otherEmployee = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-2", name: "Nia", assignedEmail: "nia@example.com", team: "Finance" }
    });
    expect(otherEmployee.statusCode).toBe(200);

    const emailChange = await app.inject({
      method: "PUT",
      url: "/api/employees/employee-1",
      headers,
      payload: { assignedEmail: "someone-else@example.com" }
    });
    expect(emailChange.statusCode).toBe(400);
    expect(emailChange.json().error).toContain("assigned email is admin-controlled");

    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-asha", name: "Asha Rao", email: "asha@example.com", groupName: "Support" }
    });
    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-nia", name: "Nia", email: "nia@example.com", groupName: "Finance" }
    });
    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-no-email", name: "No Email" }
    });
    const unconfirmedBulkProvision = await app.inject({
      method: "POST",
      url: "/api/employees/bulk-from-people",
      headers,
      payload: { personIds: ["person-asha"], confirmRiskSummary: true }
    });
    expect(unconfirmedBulkProvision.statusCode).toBe(400);

    const bulkProvision = await app.inject({
      method: "POST",
      url: "/api/employees/bulk-from-people",
      headers,
      payload: {
        personIds: ["person-asha", "person-nia", "person-no-email"],
        confirm: "PROVISION EMPLOYEES FROM PEOPLE",
        confirmRiskSummary: true,
        defaultRole: "Member"
      }
    });
    expect(bulkProvision.statusCode).toBe(200);
    expect(bulkProvision.json().created).toHaveLength(1);
    expect(bulkProvision.json().created[0]).toMatchObject({ personId: "person-asha", assignedEmail: "asha@example.com", team: "Support", role: "Member" });
    expect(bulkProvision.json().skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ personId: "person-nia", reason: "Assigned email already has an employee identity." }),
      expect.objectContaining({ personId: "person-no-email", reason: "Person has no assigned email." })
    ]));

    const catalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-1",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        credentialName: "CMS Login",
        username: "mira",
        domain: "example.com",
        tags: ["prod"],
        riskTier: "high",
        allowedEmployeeIds: ["employee-1"]
      }
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toMatchObject({ id: "catalog-1", allowedEmployeeIds: ["employee-1"], allowedTeams: [], allowedRoles: [] });

    const emptyPolicyCatalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-empty-policy",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "empty",
        credentialName: "Empty Policy",
        allowedEmployeeIds: []
      }
    });
    expect(emptyPolicyCatalog.statusCode).toBe(400);
    expect(emptyPolicyCatalog.json().error).toContain("at least one allowed employee, team or role");

    const teamCatalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-team",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "ops-runbook",
        credentialName: "Ops Runbook",
        riskTier: "medium",
        allowedTeams: ["Ops"]
      }
    });
    expect(teamCatalog.statusCode).toBe(200);
    expect(teamCatalog.json()).toMatchObject({ id: "catalog-team", allowedEmployeeIds: [], allowedTeams: ["Ops"], allowedRoles: [] });

    const roleCatalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-role",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "deploy-root",
        credentialName: "Deploy Root",
        riskTier: "high",
        allowedRoles: ["Engineer"]
      }
    });
    expect(roleCatalog.statusCode).toBe(200);
    expect(roleCatalog.json()).toMatchObject({ id: "catalog-role", allowedEmployeeIds: [], allowedTeams: [], allowedRoles: ["Engineer"] });

    const wrongCatalog = await app.inject({
      method: "GET",
      url: "/api/employee-catalog?employeeId=employee-1&assignedEmail=attacker@example.com",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(wrongCatalog.statusCode).toBe(400);
    expect(wrongCatalog.json().error).toBe("Credential requests must use the employee assigned email.");

    const employeeCatalog = await app.inject({
      method: "GET",
      url: "/api/employee-catalog?employeeId=employee-1&assignedEmail=ravi@example.com",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(employeeCatalog.statusCode).toBe(200);
    expect(employeeCatalog.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ credentialName: "CMS Login", username: "mira" }),
      expect.objectContaining({ credentialName: "Ops Runbook", allowedTeams: ["Ops"] }),
      expect.objectContaining({ credentialName: "Deploy Root", allowedRoles: ["Engineer"] })
    ]));
    expect(JSON.stringify(employeeCatalog.json())).not.toContain("Password123");

    const outsideCatalog = await app.inject({
      method: "GET",
      url: "/api/employee-catalog?employeeId=employee-2&assignedEmail=nia@example.com",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(outsideCatalog.statusCode).toBe(200);
    expect(outsideCatalog.json().items).toEqual([]);

    const wrongRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "other@example.com",
        catalogEntryId: "catalog-1",
        reason: "Emergency rollback"
      }
    });
    expect(wrongRequest.statusCode).toBe(400);

    const unauthorizedRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-2",
        assignedEmail: "nia@example.com",
        catalogEntryId: "catalog-1",
        reason: "Need production access"
      }
    });
    expect(unauthorizedRequest.statusCode).toBe(400);
    expect(unauthorizedRequest.json().error).toBe("Employee is not allowed to request this credential catalog entry.");

    const teamPolicyRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-team",
        reason: "Need team runbook access"
      }
    });
    expect(teamPolicyRequest.statusCode).toBe(200);

    const rolePolicyRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-role",
        reason: "Need deploy owner access"
      }
    });
    expect(rolePolicyRequest.statusCode).toBe(200);

    const accessRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-1",
        reason: "Emergency rollback",
        expectedDurationMinutes: 60
      }
    });
    expect(accessRequest.statusCode).toBe(200);
    expect(accessRequest.json()).toMatchObject({
      employeeId: "employee-1",
      assignedEmail: "ravi@example.com",
      credentialName: "CMS Login",
      status: "pending"
    });

    const approvalWithoutConfirmation = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${accessRequest.json().id}/approve`,
      headers,
      payload: {
        approver: "admin@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1
      }
    });
    expect(approvalWithoutConfirmation.statusCode).toBe(400);
    expect(approvalWithoutConfirmation.json().error).toContain("requires confirmation");

    const approved = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${accessRequest.json().id}/approve`,
      headers,
      payload: {
        approver: "admin@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1,
        viewOnce: true,
        confirmRiskSummary: true
      }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().request).toMatchObject({ status: "fulfilled", deliveryProviderId: "mock-delivery" });
    expect(approved.json().delivery.oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect(deliveryProvider.inputs[0].recipient).toMatchObject({ id: "employee-1", email: "ravi@example.com" });
    expect(JSON.stringify(approved.json())).not.toContain("Password123");

    const replacementWithoutConfirmation = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${accessRequest.json().id}/replacement-link`,
      headers,
      payload: {
        approver: "admin@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
        viewLimit: 1,
        viewOnce: true,
        replacementReason: "Unexpected access",
        confirmRiskSummary: true
      }
    });
    expect(replacementWithoutConfirmation.statusCode).toBe(400);
    expect(replacementWithoutConfirmation.json().error).toBe(`Destructive action requires confirmation phrase: REPLACE REQUEST ${accessRequest.json().id}`);

    const replacement = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${accessRequest.json().id}/replacement-link`,
      headers,
      payload: {
        approver: "security@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
        viewLimit: 1,
        viewOnce: true,
        replacementReason: "Unexpected access",
        confirmRiskSummary: true,
        confirm: `REPLACE REQUEST ${accessRequest.json().id}`
      }
    });
    expect(replacement.statusCode).toBe(200);
    expect(replacement.json().delivery.oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect(replacement.json().request).toMatchObject({
      id: accessRequest.json().id,
      status: "fulfilled",
      assignedEmail: "ravi@example.com",
      previousDeliveryId: approved.json().delivery.id,
      deliveryId: replacement.json().delivery.id,
      replacementCount: 1
    });
    expect(deliveryProvider.revoked).toContainEqual({ accountId: "delivery", deliveryId: "mock-1" });
    const previousDelivery = await app.inject({
      method: "GET",
      url: `/api/deliveries/${approved.json().delivery.id}`,
      headers: { host: "127.0.0.1:4777" }
    });
    expect(previousDelivery.json()).toMatchObject({ status: "revoked", revokedAt: expect.any(String) });
    expect(JSON.stringify(replacement.json())).not.toContain("Password123");

    const requestList = await app.inject({ method: "GET", url: "/api/credential-requests?page=1&pageSize=10", headers: { host: "127.0.0.1:4777" } });
    const listedReplacementRequest = requestList.json().items.find((item: { id: string }) => item.id === accessRequest.json().id);
    expect(listedReplacementRequest).toMatchObject({ status: "fulfilled", assignedEmail: "ravi@example.com", replacementCount: 1, previousDeliveryId: approved.json().delivery.id });
    await app.close();
  });

  it("lets employees sign in with one-time codes and request only allowed catalog entries", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });

    await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-1", name: "Ravi", assignedEmail: "ravi@example.com", team: "Ops" }
    });
    await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-2", name: "Nia", assignedEmail: "nia@example.com", team: "Finance" }
    });
    await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-1",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        credentialName: "CMS Login",
        username: "mira",
        domain: "example.com",
        tags: ["prod"],
        riskTier: "high",
        allowedEmployeeIds: ["employee-1"]
      }
    });
    await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-2",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms-backup",
        credentialName: "Finance Backup",
        riskTier: "medium",
        allowedEmployeeIds: ["employee-2"]
      }
    });

    const noSession = await app.inject({
      method: "GET",
      url: "/api/employee-portal/catalog?page=1&pageSize=10",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(noSession.statusCode).toBe(401);

    const issued = await app.inject({
      method: "POST",
      url: "/api/employees/employee-1/sign-in-code",
      headers,
      payload: { ttlMinutes: 10, senderEmail: "security@example.com" }
    });
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toMatchObject({
      employeeId: "employee-1",
      assignedEmail: "ravi@example.com",
      delivery: "email_draft",
      emailDraft: {
        senderEmail: "security@example.com",
        to: "ravi@example.com",
        subject: "WardSen employee portal sign-in code"
      }
    });
    expect(issued.json().code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
    expect(issued.json().emailDraft.body).toContain(issued.json().code);
    expect(issued.json().emailDraft.body).toContain("WardSen does not use a permanent employee password");
    expect(JSON.stringify(issued.json())).not.toContain("codeHash");

    const auditAfterIssue = await app.inject({ method: "GET", url: "/api/audit-log?page=1&pageSize=20", headers });
    expect(JSON.stringify(auditAfterIssue.json())).not.toContain(issued.json().code);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/employee-sessions",
      headers,
      payload: { assignedEmail: "ravi@example.com", code: "WRONGCODE" }
    });
    expect(rejected.statusCode).toBe(401);

    const signedIn = await app.inject({
      method: "POST",
      url: "/api/employee-sessions",
      headers,
      payload: { assignedEmail: "ravi@example.com", code: issued.json().code }
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toMatchObject({ employee: { id: "employee-1", assignedEmail: "ravi@example.com" } });
    expect(signedIn.json().sessionToken).toMatch(/^employee_/);

    const reused = await app.inject({
      method: "POST",
      url: "/api/employee-sessions",
      headers,
      payload: { assignedEmail: "ravi@example.com", code: issued.json().code }
    });
    expect(reused.statusCode).toBe(401);

    const employeeHeaders = {
      ...headers,
      "x-wardsen-employee-session": signedIn.json().sessionToken
    };
    const catalog = await app.inject({
      method: "GET",
      url: "/api/employee-portal/catalog?page=1&pageSize=10",
      headers: employeeHeaders
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().items).toEqual([expect.objectContaining({ id: "catalog-1", credentialName: "CMS Login" })]);
    expect(JSON.stringify(catalog.json())).not.toContain("Password123");
    expect(JSON.stringify(catalog.json())).not.toContain("Finance Backup");

    const deniedRequest = await app.inject({
      method: "POST",
      url: "/api/employee-portal/credential-requests",
      headers: employeeHeaders,
      payload: { catalogEntryId: "catalog-2", reason: "Need another team's secret" }
    });
    expect(deniedRequest.statusCode).toBe(400);

    const accessRequest = await app.inject({
      method: "POST",
      url: "/api/employee-portal/credential-requests",
      headers: employeeHeaders,
      payload: {
        catalogEntryId: "catalog-1",
        reason: "Emergency deploy rollback",
        ticketRef: "INC-123",
        expectedDurationMinutes: 60
      }
    });
    expect(accessRequest.statusCode).toBe(200);
    expect(accessRequest.json()).toMatchObject({
      employeeId: "employee-1",
      assignedEmail: "ravi@example.com",
      catalogEntryId: "catalog-1",
      status: "pending"
    });

    const ownRequests = await app.inject({
      method: "GET",
      url: "/api/employee-portal/credential-requests?page=1&pageSize=10",
      headers: employeeHeaders
    });
    expect(ownRequests.statusCode).toBe(200);
    expect(ownRequests.json().items[0]).toMatchObject({ id: accessRequest.json().id, assignedEmail: "ravi@example.com" });

    const logout = await app.inject({
      method: "POST",
      url: "/api/employee-sessions/current/logout",
      headers: employeeHeaders
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/employee-portal/me",
      headers: employeeHeaders
    });
    expect(afterLogout.statusCode).toBe(401);
    await app.close();
  });

  it("requires server-side confirmation for destructive actions", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
    await app.inject({ method: "POST", url: "/api/people", headers, payload: { id: "person-1", name: "Mira", email: "mira@example.com" } });

    const accountDelete = await app.inject({ method: "DELETE", url: "/api/accounts/source", headers });
    expect(accountDelete.statusCode).toBe(400);
    expect(accountDelete.json().error).toBe("Destructive action requires confirmation phrase: DELETE ACCOUNT source");

    const hardDelete = await app.inject({
      method: "DELETE",
      url: "/api/people/person-1?hard=true",
      headers,
      payload: { confirm: "DELETE PERSON wrong-id" }
    });
    expect(hardDelete.statusCode).toBe(400);
    expect(hardDelete.json().error).toBe("Destructive action requires confirmation phrase: DELETE PERSON person-1");

    const created = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });
    const deliveryId = created.json().id;
    const revoke = await app.inject({ method: "DELETE", url: `/api/deliveries/${deliveryId}`, headers });
    expect(revoke.statusCode).toBe(400);
    expect(revoke.json().error).toBe(`Destructive action requires confirmation phrase: REVOKE DELIVERY ${deliveryId}`);

    const bulk = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipients: [{ id: "person-1", name: "Mira", email: "mira@example.com" }],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        confirmRiskSummary: true
      }
    });
    const batchId = bulk.json().batchId;
    const cancelWithoutConfirmation = await app.inject({ method: "POST", url: `/api/batches/${batchId}/cancel`, headers });
    expect(cancelWithoutConfirmation.statusCode).toBe(400);
    expect(cancelWithoutConfirmation.json().error).toBe(`Destructive action requires confirmation phrase: CANCEL BATCH ${batchId}`);

    const cancelWithConfirmation = await app.inject({
      method: "POST",
      url: `/api/batches/${batchId}/cancel`,
      headers,
      payload: { confirm: `CANCEL BATCH ${batchId}` }
    });
    expect(cancelWithConfirmation.statusCode).toBe(400);
    expect(cancelWithConfirmation.json().error).toContain("Completed batches cannot be cancelled");
    await app.close();
  });

  it("runs a complete credential delivery workflow through injected providers", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const sessions = new AccountSessionManager();
    const app = await buildApp({
      sessions,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "mock-source", label: "Mock source" }
    });
    sessions.markUnlocked("source", "mock-source", "source-token");
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" }
    });
    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-1", name: "Mira", email: "mira@example.com" }
    });

    const search = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=mock-source&accountId=source&q=cms",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(search.json().items[0]).toMatchObject({ title: "CMS Login" });

    const created = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipient: { id: "person-1", name: "Mira", email: "mira@example.com" },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 2,
        viewOnce: true,
        deliveryMethod: "email"
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect(created.json().deliveryMethod).toBe("email");
    expect(deliveryProvider.inputs[0].viewOnce).toBe(true);
    expect(JSON.stringify(await app.inject({ method: "GET", url: "/api/deliveries", headers: { host: "127.0.0.1:4777" } }).then((response) => response.json()))).not.toContain("Password");

    const deliveryId = created.json().id;
    expect((await app.inject({ method: "GET", url: `/api/deliveries/${deliveryId}`, headers: { host: "127.0.0.1:4777" } })).json().deliveryMethod).toBe("email");
    const refreshed = (await app.inject({ method: "POST", url: `/api/deliveries/${deliveryId}/refresh`, headers })).json();
    expect(refreshed.accessCount).toBe(1);
    expect(refreshed.lastCheckedAt).toBeTruthy();
    expect((await app.inject({ method: "POST", url: `/api/deliveries/${deliveryId}/retry`, headers })).json().oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect((await app.inject({ method: "DELETE", url: `/api/deliveries/${deliveryId}`, headers, payload: { confirm: `REVOKE DELIVERY ${deliveryId}` } })).json().status).toBe("revoked");
    await app.close();
  });

  it("reuses an idempotent delivery operation without creating another provider link", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const payload = {
      operationId: "delivery-op-1",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      expiresAt,
      viewLimit: 1
    };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const first = await app.inject({ method: "POST", url: "/api/deliveries", headers, payload });
    const second = await app.inject({ method: "POST", url: "/api/deliveries", headers, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      id: first.json().id,
      operationId: "delivery-op-1",
      oneTimeDeliveryUrl: first.json().oneTimeDeliveryUrl
    });
    expect(deliveryProvider.inputs).toHaveLength(1);
    expect(deliveryProvider.inputs[0].operationId).toBe("delivery-op-1");
    await app.close();
  });

  it("rejects a reused delivery operation id with a different policy", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        operationId: "delivery-op-2",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt,
        viewLimit: 1
      }
    });
    const mismatch = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        operationId: "delivery-op-2",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms-backup",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt,
        viewLimit: 1
      }
    });

    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error).toBe("Delivery operation id was already used for a different request.");
    expect(deliveryProvider.inputs).toHaveLength(1);
    await app.close();
  });

  it("does not recreate a completed operation after restart when the one-time URL cache is gone", async () => {
    const repository = new InMemoryWardSenRepository();
    const firstProvider = new MockDeliveryProvider();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const payload = {
      operationId: "delivery-op-3",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      expiresAt,
      viewLimit: 1
    };
    const firstApp = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [firstProvider]
    });
    await firstApp.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await firstApp.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
    const created = await firstApp.inject({ method: "POST", url: "/api/deliveries", headers, payload });
    expect(created.statusCode).toBe(200);
    await firstApp.close();

    const secondProvider = new MockDeliveryProvider();
    const secondApp = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [secondProvider]
    });
    const replay = await secondApp.inject({ method: "POST", url: "/api/deliveries", headers, payload });

    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toContain("one-time URL is no longer available");
    expect(secondProvider.inputs).toHaveLength(0);
    await secondApp.close();
  });

  it("preflights Bitwarden Send account readiness before creating a secure link", async () => {
    const deliveryProvider = new NotReadyBitwardenSendProvider();
    const app = await buildApp({
      registerBuiltInProviders: false,
      credentialProviders: [new MockCredentialProvider(), new MockBitwardenCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "red", providerId: "bitwarden", label: "red" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "bitwarden-send",
        deliveryAccountId: "red",
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Bitwarden Send account "red" is not ready');
    expect(response.json().error).toContain("Unlock from terminal session");
    expect(response.json().error).toContain("You are not logged in");
    expect(deliveryProvider.createCalls).toBe(0);
    await app.close();
  });

  it("keeps a failed local delivery record when provider creation fails", async () => {
    const repository = new InMemoryWardSenRepository();
    const app = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new FailingCreateDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "failing-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("provider create failed");
    const deliveries = await repository.listDeliveries({ page: 1, pageSize: 10 });
    expect(deliveries.items[0]).toMatchObject({
      sourceItemId: "cms",
      credentialName: "CMS Login",
      status: "failed",
      viewLimit: 1
    });
    expect(deliveries.items[0].providerDeliveryId).toBeUndefined();
    await app.close();
  });

  it("revokes a provider link when local delivery finalization fails", async () => {
    const repository = new FinalizeFailingRepository();
    const deliveryProvider = new RevocationTrackingDeliveryProvider();
    const app = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "revocation-tracking",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("local finalize failed");
    expect(deliveryProvider.revoked).toEqual([{ accountId: "delivery", deliveryId: "provider-created" }]);
    const audit = await repository.listAuditLog({ page: 1, pageSize: 10 });
    expect(audit.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "delivery.create", outcome: "failure", deliveryAccountId: "delivery" })
    ]));
    await app.close();
  });

  it("reconciles stale creating deliveries on startup", async () => {
    const repository = new InMemoryWardSenRepository();
    const stale = await repository.createDelivery({
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      credentialName: "CMS Login",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      viewLimit: 1,
      status: "creating"
    });

    const app = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });

    expect(await repository.getDelivery(stale.id)).toMatchObject({ status: "failed" });
    const audit = await repository.listAuditLog({ page: 1, pageSize: 10 });
    expect(audit.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "delivery.reconcile",
        outcome: "failure",
        deliveryId: stale.id,
        safeDetails: "stuck_status=creating"
      })
    ]));
    await app.close();
  });

  it("recovers stale creating deliveries when the provider can find the operation", async () => {
    const repository = new InMemoryWardSenRepository();
    const stale = await repository.createDelivery({
      operationId: "delivery-op-recover",
      operationFingerprint: "fingerprint",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "recovery-delivery",
      deliveryAccountId: "delivery",
      credentialName: "CMS Login",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      viewLimit: 1,
      status: "creating"
    });
    const provider = new OperationRecoveryDeliveryProvider();

    const app = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [provider]
    });

    expect(await repository.getDelivery(stale.id)).toMatchObject({
      status: "viewed",
      providerDeliveryId: "provider-recovered",
      accessCount: 1
    });
    expect(provider.lookupCalls).toEqual([{ accountId: "delivery", operationId: "delivery-op-recover" }]);
    const audit = await repository.listAuditLog({ page: 1, pageSize: 10 });
    expect(audit.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "delivery.reconcile",
        outcome: "success",
        deliveryId: stale.id,
        safeDetails: "recovered_operation=delivery-op-recover"
      })
    ]));
    await app.close();
  });

  it("retries expired deliveries with a fresh future expiry using the original duration", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
    const created = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      }
    });
    const deliveryId = created.json().id;
    const retryNow = Date.now() + 24 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(retryNow);

    const retried = await app.inject({ method: "POST", url: `/api/deliveries/${deliveryId}/retry`, headers });
    const retryExpiresAt = new Date(retried.json().expiresAt).getTime();
    const expectedExpiresAt = retryNow + 2 * 60 * 60 * 1000;

    expect(retried.statusCode).toBe(200);
    expect(Math.abs(retryExpiresAt - expectedExpiresAt)).toBeLessThan(1000);
    await app.close();
  });

  it("rejects delivery when the source account belongs to another provider", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "bitwarden", label: "Wrong source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Source account does not belong to the requested credential provider");
    await app.close();
  });

  it("returns partial credential search errors without failing the whole search", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider(), new FailingSearchCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "ok", providerId: "mock-source", label: "OK" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "bad", providerId: "failing-search", label: "Failing provider" } });
    sessions.markUnlocked("ok", "mock-source", "ok-token");
    sessions.markUnlocked("bad", "failing-search", "bad-token");

    const response = await app.inject({ method: "GET", url: "/api/credentials/search?q=cms", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
    expect(response.json().errors[0]).toMatchObject({ accountId: "bad", providerId: "failing-search" });
    await app.close();
  });

  it("skips locked credential accounts unless the locked account is explicitly selected", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "unlocked", providerId: "mock-source", label: "Unlocked" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "locked", providerId: "mock-source", label: "Locked" } });
    sessions.markUnlocked("unlocked", "mock-source", "unlocked-token");

    const all = await app.inject({ method: "GET", url: "/api/credentials/search?q=cms", headers: { host: "127.0.0.1:4777" } });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(2);
    expect(all.json().items.every((item: CredentialSummary) => item.accountId === "unlocked")).toBe(true);
    expect(all.json().errors).toEqual([]);

    const selectedLocked = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=mock-source&accountId=locked&q=cms",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(selectedLocked.statusCode).toBe(200);
    expect(selectedLocked.json().items).toHaveLength(0);
    expect(selectedLocked.json().errors[0]).toMatchObject({
      accountId: "locked",
      providerId: "mock-source",
      safeMessage: "Vault is locked. Unlock this account before searching credentials."
    });
    await app.close();
  });

  it("paginates credential search results", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    sessions.markUnlocked("source", "mock-source", "source-token");

    const response = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=mock-source&accountId=source&q=cms&page=2&pageSize=1",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([expect.objectContaining({ id: "cms-backup", title: "CMS Backup" })]);
    await app.close();
  });

  it("creates individual bulk deliveries with persisted batch counts", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const bulk = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipients: [
          { id: "person-1", name: "Mira", email: "mira@example.com" },
          { id: "person-2", name: "Jon", email: "jon@example.com" }
        ],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1,
        concurrency: 2,
        confirmRiskSummary: true
      }
    });

    expect(bulk.statusCode).toBe(200);
    expect(bulk.json()).toMatchObject({ requestedCount: 2, completedCount: 2, failedCount: 0 });
    expect(bulk.json().results).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientId: "person-1", ok: true, delivery: expect.objectContaining({ oneTimeDeliveryUrl: expect.stringMatching(/^https:\/\/mock.local\/send\//) }) }),
      expect.objectContaining({ recipientId: "person-2", ok: true, delivery: expect.objectContaining({ oneTimeDeliveryUrl: expect.stringMatching(/^https:\/\/mock.local\/send\//) }) })
    ]));
    const batch = await app.inject({ method: "GET", url: `/api/batches/${bulk.json().batchId}`, headers: { host: "127.0.0.1:4777" } });
    expect(batch.json()).toMatchObject({ requestedCount: 2, completedCount: 2, failedCount: 0, cancelled: false });
    const batches = await app.inject({ method: "GET", url: "/api/batches?page=1&pageSize=10", headers: { host: "127.0.0.1:4777" } });
    expect(batches.json().items[0]).toMatchObject({ id: bulk.json().batchId, requestedCount: 2, completedCount: 2 });
    const batchDeliveries = await app.inject({ method: "GET", url: `/api/deliveries?batchId=${bulk.json().batchId}`, headers: { host: "127.0.0.1:4777" } });
    expect(batchDeliveries.json().items).toHaveLength(2);
    expect(batchDeliveries.json().items.every((delivery: { batchId: string }) => delivery.batchId === bulk.json().batchId)).toBe(true);
    await app.close();
  });

  it("requires explicit risk confirmation before bulk delivery", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipients: [{ id: "person-1", name: "Mira", email: "mira@example.com" }],
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Bulk delivery requires confirmation");
    await app.close();
  });

  it("requires a typed phrase for large bulk delivery", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipients: Array.from({ length: 26 }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}` })),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        confirmRiskSummary: true,
        largeBatchConfirmation: "SEND 25"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Large bulk delivery requires confirmation phrase: SEND 26");
    await app.close();
  });

  it("auto-locks inactive accounts using their configured timeout", async () => {
    const sessions = new AccountSessionManager();
    const provider = new LockTrackingCredentialProvider();
    const app = await buildApp({ sessions, credentialProviders: [provider] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "lock-tracking", label: "Lock tracking", autoLockMinutes: 1 }
    });
    sessions.markUnlocked("source", "lock-tracking", "token");
    ageSession(sessions, "source", new Date(Date.now() - 2 * 60 * 1000));

    const response = await app.inject({ method: "GET", url: "/api/accounts", headers: { host: "127.0.0.1:4777" } });

    expect(response.statusCode).toBe(200);
    expect(provider.locked).toEqual(["source"]);
    expect(() => sessions.getSessionToken("source", "lock-tracking")).toThrow();
    await app.close();
  });

  it("auto-locks inactive accounts from the background timer without another request", async () => {
    const sessions = new AccountSessionManager();
    const provider = new LockTrackingCredentialProvider();
    const app = await buildApp({ sessions, credentialProviders: [provider], autoLockIntervalMs: 1000 });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "lock-tracking", label: "Lock tracking", autoLockMinutes: 1 }
    });
    sessions.markUnlocked("source", "lock-tracking", "token");
    ageSession(sessions, "source", new Date(Date.now() - 2 * 60 * 1000));

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(provider.locked).toEqual(["source"]);
    expect(() => sessions.getSessionToken("source", "lock-tracking")).toThrow();
    await app.close();
  }, 10_000);

  it("audits auto-lock provider failures and still clears the local session", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new FailingLockCredentialProvider()], autoLockIntervalMs: 1000 });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "failing-lock", label: "Failing lock", autoLockMinutes: 1 }
    });
    sessions.markUnlocked("source", "failing-lock", "token");
    ageSession(sessions, "source", new Date(Date.now() - 2 * 60 * 1000));

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(() => sessions.getSessionToken("source", "failing-lock")).toThrow();
    const audit = await app.inject({ method: "GET", url: "/api/audit-log", headers: { host: "127.0.0.1:4777" } });
    expect(audit.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "account.auto_lock", outcome: "failure", sourceAccountId: "source" })
    ]));
    await app.close();
  }, 10_000);
});

class MockCredentialProvider implements CredentialProvider {
  readonly id: string = "mock-source";
  readonly displayName: string = "Mock Source";
  async getCapabilities(): Promise<CredentialProviderCapabilities> {
    return { searchItems: true, multipleAccounts: true, customServers: false, localVaults: false, synchronization: false, locking: false };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    return { ok: true, status: "unlocked" };
  }
  async login(_accountId: string, _input: ProviderLoginInput): Promise<void> {}
  async unlock(_accountId: string, _input: ProviderUnlockInput): Promise<void> {}
  async lock(_accountId: string): Promise<void> {}
  async logout(_accountId: string): Promise<void> {}
  async sync(_accountId: string): Promise<void> {}
  async search(accountId: string, _query: string, pagination: PaginationInput): Promise<CredentialSummary[]> {
    const rows: CredentialSummary[] = [
      { id: "cms", accountId, providerId: this.id, title: "CMS Login", username: "mira", domain: "example.com", itemType: "login" },
      { id: "cms-backup", accountId, providerId: this.id, title: "CMS Backup", username: "ops", domain: "example.com", itemType: "login" }
    ];
    const start = (pagination.page - 1) * pagination.pageSize;
    return rows.slice(start, start + pagination.pageSize);
  }
  async getCredential(_accountId: string, _itemId: string): Promise<SensitiveCredential> {
    return { title: "CMS Login", username: "mira", password: "Password123", urls: ["https://example.com"] };
  }
}

class MockBitwardenCredentialProvider extends MockCredentialProvider {
  readonly id: string = "bitwarden";
  readonly displayName: string = "Bitwarden";
}

class FailingSearchCredentialProvider extends MockCredentialProvider {
  readonly id = "failing-search";
  readonly displayName = "Failing Search";
  async search(_accountId: string, _query: string, _pagination: PaginationInput): Promise<CredentialSummary[]> {
    throw new Error("provider search failed");
  }
}

class MockDeliveryProvider implements DeliveryProvider {
  readonly id: string = "mock-delivery";
  readonly displayName: string = "Mock Delivery";
  readonly inputs: CreateDeliveryInput[] = [];
  readonly revoked: Array<{ accountId: string; deliveryId: string }> = [];
  private counter = 0;
  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return {
      externalLinks: true,
      recipientEmailRestriction: false,
      arbitraryViewLimit: true,
      viewOnce: true,
      customExpiry: true,
      accessPassword: false,
      hideText: false,
      revokeLink: true,
      accessCount: true
    };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    return { ok: true, status: "unlocked" };
  }
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    this.counter += 1;
    this.inputs.push(input);
    return { deliveryId: `mock-${this.counter}`, url: `https://mock.local/send/${this.counter}`, expiresAt: input.expiresAt, viewLimit: input.viewLimit };
  }
  async revoke(accountId: string, deliveryId: string): Promise<void> {
    this.revoked.push({ accountId, deliveryId });
  }
  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    return { deliveryId, status: "active", accessCount: 1 };
  }
}

class NotReadyBitwardenSendProvider extends MockDeliveryProvider {
  readonly id = "bitwarden-send";
  readonly displayName = "Bitwarden Send";
  createCalls = 0;
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    throw new Error('Provider command "bw send" failed. Detail: You are not logged in.');
  }
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    this.createCalls += 1;
    return super.createDelivery(input);
  }
}

class FailingCreateDeliveryProvider extends MockDeliveryProvider {
  readonly id = "failing-delivery";
  readonly displayName = "Failing Delivery";
  async createDelivery(_input: CreateDeliveryInput): Promise<DeliveryResult> {
    throw new Error("provider create failed");
  }
}

class RevocationTrackingDeliveryProvider extends MockDeliveryProvider {
  readonly id = "revocation-tracking";
  readonly displayName = "Revocation Tracking";
  readonly revoked: Array<{ accountId: string; deliveryId: string }> = [];
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    return { deliveryId: "provider-created", url: "https://mock.local/send/provider-created", expiresAt: input.expiresAt, viewLimit: input.viewLimit };
  }
  async revoke(accountId: string, deliveryId: string): Promise<void> {
    this.revoked.push({ accountId, deliveryId });
  }
}

class OperationRecoveryDeliveryProvider extends MockDeliveryProvider {
  readonly id = "recovery-delivery";
  readonly displayName = "Recovery Delivery";
  readonly lookupCalls: Array<{ accountId: string; operationId: string }> = [];
  async findDeliveryByOperationId(accountId: string, operationId: string): Promise<DeliveryStatus | undefined> {
    this.lookupCalls.push({ accountId, operationId });
    if (operationId !== "delivery-op-recover") return undefined;
    return {
      deliveryId: "provider-recovered",
      status: "viewed",
      accessCount: 1,
      expiresAt: new Date(Date.now() + 3600000)
    };
  }
}

class FinalizeFailingRepository extends InMemoryWardSenRepository {
  async updateDelivery(id: string, patch: Parameters<InMemoryWardSenRepository["updateDelivery"]>[1]) {
    if (patch.status === "active") {
      throw new Error("local finalize failed");
    }
    return super.updateDelivery(id, patch);
  }
}

class LockTrackingCredentialProvider extends MockCredentialProvider {
  readonly id = "lock-tracking";
  readonly displayName = "Lock Tracking";
  readonly locked: string[] = [];
  async lock(accountId: string): Promise<void> {
    this.locked.push(accountId);
  }
}

class FailingLockCredentialProvider extends MockCredentialProvider {
  readonly id = "failing-lock";
  readonly displayName = "Failing Lock";
  async lock(_accountId: string): Promise<void> {
    throw new Error("provider lock failed");
  }
}

function ageSession(sessions: AccountSessionManager, accountId: string, lastActivityAt: Date) {
  const exposed = sessions as unknown as { sessions: Map<string, { lastActivityAt?: Date }> };
  const session = exposed.sessions.get(accountId);
  if (!session) throw new Error(`Missing test session: ${accountId}`);
  session.lastActivityAt = lastActivityAt;
}
