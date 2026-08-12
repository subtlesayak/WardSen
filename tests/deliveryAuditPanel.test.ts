import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync("apps/web/src/main.tsx", "utf8");
const panelSource = readFileSync("apps/web/src/deliveryAuditPanel.tsx", "utf8");

describe("delivery audit panel boundary", () => {
  it("keeps audit rendering outside the main application screen", () => {
    expect(mainSource).toContain('import { DeliveryAuditPanel } from "./deliveryAuditPanel";');
    expect(mainSource).not.toContain("function DeliveryAuditPanel(");
    expect(panelSource).toContain("export function DeliveryAuditPanel");
  });

  it("offers a guarded revoke command only for high-priority access signals", () => {
    expect(panelSource).toContain('signal.level === "high"');
    expect(panelSource).toContain("canRevoke?.(delivery) === true");
    expect(panelSource).toContain("Revoke link");
    expect(panelSource).toContain("Revoke batch links");
    expect(panelSource).toContain("accessEvidenceLabel(delivery)");
    expect(mainSource).toContain("REVOKE DELIVERY ${delivery.id}");
    expect(mainSource).toContain("REVOKE BATCH LINKS ${delivery.batchId}");
    expect(mainSource).toContain("parseDeliveryRecord(await apiSend<unknown>");
    expect(mainSource).toContain("parseBatchDeliveryRevokeResult");
  });
});
