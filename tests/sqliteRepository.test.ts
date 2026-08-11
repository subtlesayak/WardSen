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
