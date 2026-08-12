import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync("apps/web/src/main.tsx", "utf8");
const batchTablesSource = readFileSync("apps/web/src/deliveryBatchTables.tsx", "utf8");

describe("delivery batch table boundary", () => {
  it("keeps bulk batch rendering outside the main application screen", () => {
    expect(mainSource).toContain('import { BatchDeliveryTable, BatchTable } from "./deliveryBatchTables";');
    expect(mainSource).not.toContain("function BatchTable(");
    expect(mainSource).not.toContain("function BatchDeliveryTable(");
    expect(batchTablesSource).toContain("export function BatchTable");
    expect(batchTablesSource).toContain("export function BatchDeliveryTable");
  });

  it("keeps batch cancellation accessible while the parent owns confirmation and API calls", () => {
    expect(batchTablesSource).toContain("aria-label={`Cancel batch ${batch.id}`}");
    expect(batchTablesSource).toContain("onCancelBatch(batch)");
    expect(mainSource).toContain("CANCEL BATCH ${batch.id}");
    expect(mainSource).toContain("/api/batches/${batch.id}/cancel");
  });
});
