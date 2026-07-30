import { mkdtempSync, rmSync } from "node:fs";
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
});
