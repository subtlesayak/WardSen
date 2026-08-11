import { mkdtempSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteWardSenRepository } from "@wardsen/database";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("SqliteWardSenRepository", () => {
  it("persists people and deliveries without storing secure link contents", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const repo = new SqliteWardSenRepository(path.join(tempDir, "wardsen.sqlite"));

    const person = await repo.upsertPerson({ name: "Mira", email: "mira@example.com", active: true });
    const people = await repo.listPeople({ page: 1, pageSize: 10, search: "mira" });
    expect(people.items[0].id).toBe(person.id);

    const delivery = await repo.createDelivery({
      operationId: "delivery-op-1",
      operationFingerprint: "fingerprint-1",
      providerDeliveryId: "provider-id",
      sourceProviderId: "bitwarden",
      sourceAccountId: "source-account",
      sourceItemId: "item-id",
      deliveryProviderId: "bitwarden-send",
      deliveryAccountId: "delivery-account",
      credentialName: "CMS",
      personId: person.id,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: "active"
    });

    expect(JSON.stringify(await repo.listDeliveries({ page: 1, pageSize: 10 }))).not.toContain("https://");
    expect((await repo.listDeliveries({ page: 1, pageSize: 10, batchId: "missing" })).total).toBe(0);
    expect(delivery.providerDeliveryId).toBe("provider-id");
    expect(await repo.getDeliveryByOperationId("delivery-op-1")).toMatchObject({ id: delivery.id, operationFingerprint: "fingerprint-1" });
    repo.close();
  });

  it("persists delivery batches and safe audit rows", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const repo = new SqliteWardSenRepository(path.join(tempDir, "wardsen.sqlite"));

    await repo.createBatch({ id: "batch-1", requestedCount: 2, completedCount: 0, failedCount: 0, cancelled: false });
    await repo.updateBatch("batch-1", { completedCount: 1, failedCount: 1, completedAt: "done" });
    expect(await repo.getBatch("batch-1")).toMatchObject({ completedCount: 1, failedCount: 1 });
    expect((await repo.listBatches({ page: 1, pageSize: 10 })).items[0].id).toBe("batch-1");

    await repo.appendAuditLog({ action: "delivery.create", outcome: "failure", safeDetails: "redacted provider error" });
    const audit = await repo.listAuditLog({ page: 1, pageSize: 10 });
    expect(audit.items[0].safeDetails).toBe("redacted provider error");
    repo.close();
  });

  it("defaults saved people to active when active is omitted", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const repo = new SqliteWardSenRepository(path.join(tempDir, "wardsen.sqlite"));

    const person = await repo.upsertPerson({ name: "Nia" });
    const activePeople = await repo.listPeople({ page: 1, pageSize: 10, active: true });

    expect(person.active).toBe(true);
    expect(activePeople.items.map((item) => item.id)).toContain(person.id);
    repo.close();
  });

  it("hardens SQLite file permissions where POSIX modes are supported", async () => {
    if (process.platform === "win32") return;
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const databasePath = path.join(tempDir, "wardsen.sqlite");
    const repo = new SqliteWardSenRepository(databasePath);
    await repo.appendAuditLog({ action: "test", outcome: "success" });
    repo.close();

    expect(statSync(tempDir).mode & 0o777).toBe(0o700);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
  });

  it("enforces delivery metadata constraints", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const repo = new SqliteWardSenRepository(path.join(tempDir, "wardsen.sqlite"));

    await expect(repo.createDelivery({
      providerDeliveryId: "provider-id",
      sourceProviderId: "bitwarden",
      sourceAccountId: "source-account",
      sourceItemId: "item-id",
      deliveryProviderId: "bitwarden-send",
      deliveryAccountId: "delivery-account",
      credentialName: "CMS",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      viewLimit: 0,
      status: "active"
    })).rejects.toThrow("invalid delivery metadata");
    repo.close();
  });

  it("enforces unique delivery operation ids", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const repo = new SqliteWardSenRepository(path.join(tempDir, "wardsen.sqlite"));

    const baseDelivery = {
      operationId: "delivery-op-1",
      operationFingerprint: "fingerprint-1",
      providerDeliveryId: "provider-id",
      sourceProviderId: "bitwarden",
      sourceAccountId: "source-account",
      sourceItemId: "item-id",
      deliveryProviderId: "bitwarden-send",
      deliveryAccountId: "delivery-account",
      credentialName: "CMS",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: "active" as const
    };
    await repo.createDelivery(baseDelivery);

    await expect(repo.createDelivery({ ...baseDelivery, id: "delivery-2", providerDeliveryId: "provider-id-2" })).rejects.toThrow();
    repo.close();
  });

  it("persists employee credential request catalog metadata", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const repo = new SqliteWardSenRepository(path.join(tempDir, "wardsen.sqlite"));

    const employee = await repo.upsertEmployee({
      id: "employee-1",
      personId: "person-ravi",
      name: "Ravi",
      assignedEmail: "Ravi@Example.com",
      team: "Ops",
      role: "Engineer"
    });
    const entry = await repo.upsertCredentialCatalogEntry({
      id: "catalog-1",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      credentialName: "CMS Login",
      username: "ops",
      domain: "example.com",
      tags: ["prod"],
      riskTier: "high",
      allowedEmployeeIds: [employee.id]
    });
    const policyEntry = await repo.upsertCredentialCatalogEntry({
      id: "catalog-policy",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "deploy",
      credentialName: "Deploy Root",
      riskTier: "high",
      allowedTeams: ["Ops"],
      allowedRoles: ["Engineer"]
    });
    const request = await repo.createCredentialAccessRequest({
      employeeId: employee.id,
      assignedEmail: "RAVI@example.com",
      catalogEntryId: entry.id,
      sourceProviderId: entry.sourceProviderId,
      sourceAccountId: entry.sourceAccountId,
      sourceItemId: entry.sourceItemId,
      credentialName: entry.credentialName,
      reason: "Emergency deploy rollback"
    });
    await repo.updateCredentialAccessRequest(request.id, {
      status: "denied",
      approver: "admin@example.com",
      decidedAt: new Date().toISOString(),
      deliveryId: "delivery-2",
      previousDeliveryId: "delivery-1",
      replacementCount: 1,
      lastReplacementAt: "2026-08-11T00:00:00.000Z"
    });

    expect((await repo.listEmployees({ page: 1, pageSize: 10 })).items[0]).toMatchObject({ personId: "person-ravi", assignedEmail: "ravi@example.com" });
    expect(policyEntry).toMatchObject({ allowedEmployeeIds: [], allowedTeams: ["Ops"], allowedRoles: ["Engineer"] });
    expect((await repo.listCredentialCatalog({ page: 1, pageSize: 10, employeeId: employee.id, employeeTeam: employee.team, employeeRole: employee.role })).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ credentialName: "CMS Login", tags: ["prod"] }),
      expect.objectContaining({ credentialName: "Deploy Root", allowedTeams: ["Ops"], allowedRoles: ["Engineer"] })
    ]));
    expect((await repo.listCredentialCatalog({ page: 1, pageSize: 10, employeeId: "employee-other", employeeTeam: "Finance", employeeRole: "Analyst" })).items).toHaveLength(0);
    expect((await repo.listCredentialAccessRequests({ page: 1, pageSize: 10, status: "denied" })).items[0]).toMatchObject({
      id: request.id,
      approver: "admin@example.com",
      deliveryId: "delivery-2",
      previousDeliveryId: "delivery-1",
      replacementCount: 1
    });
    repo.close();
  });

  it("persists employee sign-in codes and sessions without raw code or token values", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const databasePath = path.join(tempDir, "wardsen.sqlite");
    const repo = new SqliteWardSenRepository(databasePath);
    const employee = await repo.upsertEmployee({
      id: "employee-1",
      name: "Ravi",
      assignedEmail: "Ravi@Example.com"
    });
    const rawCode = "EMPLOYEE-CODE-RAW";
    const rawToken = "employee_session_raw";
    const codeHash = "c".repeat(64);
    const tokenHash = "s".repeat(64);
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    const code = await repo.createEmployeeSignInCode({
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      codeHash,
      expiresAt
    });
    const session = await repo.createEmployeeSession({
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      tokenHash,
      expiresAt
    });
    await repo.updateEmployeeSignInCode(code.id, { usedAt: "used" });
    await repo.updateEmployeeSession(session.id, { revokedAt: "revoked" });

    expect(await repo.getEmployeeByAssignedEmail("ravi@example.com")).toMatchObject({ id: employee.id });
    expect(await repo.getEmployeeSignInCodeByHash(employee.id, codeHash)).toMatchObject({ usedAt: "used", codeHash });
    expect(await repo.getEmployeeSessionByTokenHash(tokenHash)).toMatchObject({ revokedAt: "revoked", tokenHash });
    const db = new DatabaseSync(databasePath);
    const codeRows = db.prepare("SELECT code_hash FROM employee_sign_in_codes").all();
    const sessionRows = db.prepare("SELECT token_hash FROM employee_sessions").all();
    db.close();
    expect(JSON.stringify(codeRows)).toContain(codeHash);
    expect(JSON.stringify(sessionRows)).toContain(tokenHash);
    expect(JSON.stringify(codeRows)).not.toContain(rawCode);
    expect(JSON.stringify(sessionRows)).not.toContain(rawToken);
    repo.close();
  });

  it("prunes audit rows older than the retention cutoff", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-sqlite-"));
    const databasePath = path.join(tempDir, "wardsen.sqlite");
    const repo = new SqliteWardSenRepository(databasePath);
    await repo.appendAuditLog({ action: "new", outcome: "success" });

    const db = new DatabaseSync(databasePath);
    db.prepare(`
      INSERT INTO audit_log (id, action, outcome, created_at)
      VALUES ('old-audit', 'old', 'success', '2020-01-01T00:00:00.000Z')
    `).run();
    db.close();

    expect(await repo.pruneAuditLogBefore("2021-01-01T00:00:00.000Z")).toBe(1);
    const audit = await repo.listAuditLog({ page: 1, pageSize: 10 });
    expect(audit.items.map((item) => item.action)).toEqual(["new"]);
    repo.close();
  });
});
