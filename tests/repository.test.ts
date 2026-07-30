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
});
