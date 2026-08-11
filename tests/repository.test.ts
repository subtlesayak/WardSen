import { describe, expect, it } from "vitest";
import { InMemoryWardSenRepository } from "@wardsen/database";

describe("people repository", () => {
  it("paginates and filters arbitrary people records", async () => {
    const repo = new InMemoryWardSenRepository();
    for (let index = 0; index < 55; index += 1) {
      await repo.upsertPerson({
        name: `Person ${String(index).padStart(2, "0")}`,
        email: `person${index}@example.com`,
        groupName: index % 2 === 0 ? "Ops" : "Design",
        active: index !== 3
      });
    }

    const page = await repo.listPeople({ page: 2, pageSize: 10, groupName: "Ops" });
    expect(page.items).toHaveLength(10);
    expect(page.total).toBe(28);

    const inactive = await repo.listPeople({ page: 1, pageSize: 10, active: false });
    expect(inactive.items).toHaveLength(1);
  });

  it("detects duplicates by email or phone", async () => {
    const repo = new InMemoryWardSenRepository();
    await repo.upsertPerson({ name: "Mira", email: "mira@example.com", phone: "+1", active: true });
    await expect(repo.findDuplicatePeople({ email: "mira@example.com" })).resolves.toHaveLength(1);
    await expect(repo.findDuplicatePeople({ phone: "+1" })).resolves.toHaveLength(1);
  });

  it("lists delivery batches newest first", async () => {
    const repo = new InMemoryWardSenRepository();
    await repo.createBatch({ id: "batch-1", requestedCount: 2, completedCount: 2, failedCount: 0, cancelled: false, completedAt: "done" });
    await repo.createBatch({ id: "batch-2", requestedCount: 3, completedCount: 1, failedCount: 1, cancelled: false });

    const result = await repo.listBatches({ page: 1, pageSize: 10 });
    expect(result.total).toBe(2);
    expect(result.items.map((batch) => batch.id)).toEqual(["batch-2", "batch-1"]);
  });

  it("filters deliveries by batch", async () => {
    const repo = new InMemoryWardSenRepository();
    for (const [id, batchId] of [["delivery-1", "batch-1"], ["delivery-2", "batch-2"]] as const) {
      await repo.createDelivery({
        id,
        batchId,
        providerDeliveryId: id,
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        credentialName: "CMS",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        status: "active"
      });
    }

    const result = await repo.listDeliveries({ page: 1, pageSize: 10, batchId: "batch-2" });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("delivery-2");
  });

  it("finds deliveries by operation id and rejects duplicate operations", async () => {
    const repo = new InMemoryWardSenRepository();
    await repo.createDelivery({
      id: "delivery-1",
      operationId: "delivery-op-1",
      operationFingerprint: "fingerprint-1",
      providerDeliveryId: "provider-1",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      credentialName: "CMS",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: "active"
    });

    await expect(repo.getDeliveryByOperationId("delivery-op-1")).resolves.toMatchObject({ id: "delivery-1" });
    await expect(repo.createDelivery({
      id: "delivery-2",
      operationId: "delivery-op-1",
      operationFingerprint: "fingerprint-1",
      providerDeliveryId: "provider-2",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      credentialName: "CMS",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: "active"
    })).rejects.toThrow("Duplicate delivery operation id: delivery-op-1");
  });

  it("stores employee catalog requests without raw secret values", async () => {
    const repo = new InMemoryWardSenRepository();
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
      tags: ["prod", "prod"],
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

    expect(employee).toMatchObject({ personId: "person-ravi", assignedEmail: "ravi@example.com" });
    await expect(repo.upsertEmployee({
      id: "employee-duplicate-person",
      personId: "person-ravi",
      name: "Duplicate Ravi",
      assignedEmail: "duplicate@example.com"
    })).rejects.toThrow("Duplicate employee person link: person-ravi");
    expect(entry.tags).toEqual(["prod"]);
    expect(policyEntry).toMatchObject({ allowedEmployeeIds: [], allowedTeams: ["Ops"], allowedRoles: ["Engineer"] });
    expect((await repo.listCredentialCatalog({ page: 1, pageSize: 10, employeeId: employee.id, employeeTeam: employee.team, employeeRole: employee.role })).items).toHaveLength(2);
    expect((await repo.listCredentialCatalog({ page: 1, pageSize: 10, employeeId: "employee-other", employeeTeam: "Finance", employeeRole: "Analyst" })).items).toHaveLength(0);
    expect(request).toMatchObject({ assignedEmail: "ravi@example.com", status: "pending", replacementCount: 0 });
    await repo.updateCredentialAccessRequest(request.id, {
      deliveryId: "delivery-2",
      previousDeliveryId: "delivery-1",
      replacementCount: 1,
      lastReplacementAt: "2026-08-11T00:00:00.000Z"
    });
    expect(await repo.getCredentialAccessRequest(request.id)).toMatchObject({
      deliveryId: "delivery-2",
      previousDeliveryId: "delivery-1",
      replacementCount: 1
    });
    expect(JSON.stringify(await repo.listCredentialAccessRequests({ page: 1, pageSize: 10 }))).not.toContain("Password123");
  });

  it("stores employee sign-in codes and sessions as hashes", async () => {
    const repo = new InMemoryWardSenRepository();
    const employee = await repo.upsertEmployee({
      id: "employee-1",
      name: "Ravi",
      assignedEmail: "Ravi@Example.com"
    });
    const codeHash = "c".repeat(64);
    const tokenHash = "s".repeat(64);
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    const code = await repo.createEmployeeSignInCode({
      employeeId: employee.id,
      assignedEmail: "RAVI@example.com",
      codeHash,
      expiresAt
    });
    const session = await repo.createEmployeeSession({
      employeeId: employee.id,
      assignedEmail: "RAVI@example.com",
      tokenHash,
      expiresAt
    });

    expect(await repo.getEmployeeByAssignedEmail("ravi@example.com")).toMatchObject({ id: employee.id });
    expect(await repo.getEmployeeSignInCodeByHash(employee.id, codeHash)).toMatchObject({ id: code.id, assignedEmail: "ravi@example.com" });
    expect(await repo.getEmployeeSessionByTokenHash(tokenHash)).toMatchObject({ id: session.id, assignedEmail: "ravi@example.com" });
    await repo.updateEmployeeSignInCode(code.id, { usedAt: "used" });
    await repo.updateEmployeeSession(session.id, { revokedAt: "revoked" });
    expect(await repo.getEmployeeSignInCodeByHash(employee.id, codeHash)).toMatchObject({ usedAt: "used" });
    expect(await repo.getEmployeeSessionByTokenHash(tokenHash)).toMatchObject({ revokedAt: "revoked" });
  });
});
